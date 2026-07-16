-- ============================================================================
-- FoodPicker 소비자 앱 심화 기능 (2026-07-11)
--   감사에서 확인된 데이터 연동 갭 6건을 백엔드로 마감:
--   1) 가격 흐름 이력 공개 뷰 (조작된 클라 계산 → 실제 product_price_history)
--   2) 회원 탈퇴 RPC (auth.users 자기 삭제)
--   3) 가격 알림 테이블 + 발화 함수/크론 (목표가 도달 시 알림)
--   4) 쿠폰 소유/등록/사용 (user_coupons + redeem_coupon + create_order 사용 마킹)
--   5) 리뷰 사진 (reviews.images 컬럼 + review-images 버킷 + create_review 확장 + 공개뷰)
-- 모두 재실행 안전.
-- ============================================================================

-- ── 1) 가격 흐름 이력 공개 뷰 ────────────────────────────────────────────────
-- product_price_history 는 seller-only RLS 지만, 뷰(소유자=postgres)는 이를 우회.
-- 노출 컬럼엔 개인정보 없음(상품 가격/시각만). 소비자 상품상세 '오늘 가격 흐름'에 사용.
drop view if exists public.public_price_history;
create view public.public_price_history as
  select product_id, old_price, new_price, discount_rate, reason, created_at
    from public.product_price_history;
grant select on public.public_price_history to anon, authenticated;

-- ── 2) 회원 탈퇴 RPC ────────────────────────────────────────────────────────
-- 클라 SDK 는 자기 auth 계정을 못 지우므로 security definer 로 대행.
-- 연쇄: favorites/user_addresses/buyer_notifications/user_coupons/price_alerts = cascade,
--       orders.buyer_id → set null(판매자 기록 보존), reviews.reviewer_id → set null.
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = v_uid;
end; $$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- ── 3) 가격 알림 ────────────────────────────────────────────────────────────
create table if not exists public.price_alerts (
  id           uuid primary key default gen_random_uuid(),
  buyer_id     uuid not null references auth.users(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  target_price integer not null check (target_price > 0),
  notified_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint price_alerts_uq unique (buyer_id, product_id)
);
create index if not exists idx_price_alerts_buyer on public.price_alerts(buyer_id);
alter table public.price_alerts enable row level security;
drop policy if exists price_alerts_all on public.price_alerts;
create policy price_alerts_all on public.price_alerts for all to authenticated
  using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());

-- 발화: 판매중 상품의 현재가가 목표가 이하 & 미발송 → 구매자 알림 생성 후 발송표시
create or replace function public.check_price_alerts()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count int := 0; r record;
begin
  for r in
    select pa.id, pa.buyer_id, pa.product_id, pa.target_price, p.name, p.sale_price
      from public.price_alerts pa
      join public.products p on p.id = pa.product_id
     where pa.notified_at is null
       and p.status = 'selling'
       and p.sale_price <= pa.target_price
  loop
    insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
    values (r.buyer_id, 'price', '가격 알림',
            r.name || ' 가격이 ' || to_char(r.sale_price, 'FM999,999') || '원으로 내려갔어요!',
            'product', r.product_id);
    update public.price_alerts set notified_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;
revoke all on function public.check_price_alerts() from public;

-- pg_cron 5분 주기 (중복 등록 방지)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'foodpicker-price-alerts') then
    perform cron.schedule('foodpicker-price-alerts', '*/5 * * * *', $q$select public.check_price_alerts();$q$);
  end if;
end $$;

-- ── 4) 쿠폰 소유/등록/사용 ──────────────────────────────────────────────────
create table if not exists public.user_coupons (
  id         uuid primary key default gen_random_uuid(),
  buyer_id   uuid not null references auth.users(id) on delete cascade,
  coupon_id  uuid not null references public.coupons(id) on delete cascade,
  is_used    boolean not null default false,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint user_coupons_uq unique (buyer_id, coupon_id)
);
create index if not exists idx_user_coupons_buyer on public.user_coupons(buyer_id, is_used);
alter table public.user_coupons enable row level security;
drop policy if exists user_coupons_select on public.user_coupons;
create policy user_coupons_select on public.user_coupons for select to authenticated
  using (buyer_id = auth.uid());
-- insert/update 는 redeem_coupon / create_order (security definer) 를 통해서만.

-- 쿠폰 코드 등록: 유효한 활성 쿠폰이면 내 쿠폰함에 담기(멱등).
create or replace function public.redeem_coupon(p_code text)
returns public.coupons
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_coupon public.coupons;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_coupon from public.coupons
    where upper(code) = upper(trim(p_code)) and is_active
      and (ends_on is null or ends_on >= current_date);
  if not found then raise exception 'invalid coupon'; end if;

  insert into public.user_coupons (buyer_id, coupon_id)
  values (v_uid, v_coupon.id)
  on conflict (buyer_id, coupon_id) do nothing;

  insert into public.buyer_notifications (buyer_id, type, title, message, reference_type)
  values (v_uid, 'coupon', '쿠폰 등록', v_coupon.name || ' 쿠폰이 발급되었습니다.', 'coupon');

  return v_coupon;
end; $$;
revoke all on function public.redeem_coupon(text) from public;
grant execute on function public.redeem_coupon(text) to authenticated;

-- ── 5) 리뷰 사진 ────────────────────────────────────────────────────────────
alter table public.reviews add column if not exists images text[] not null default '{}';

-- 공개 리뷰 뷰에 images 추가(끝에 추가 → create or replace 허용)
create or replace view public.public_reviews as
  select id, store_id, product_id, reviewer_name, rating, content,
         helpful_count, owner_reply, owner_replied_at, created_at, images
    from public.reviews;
grant select on public.public_reviews to anon, authenticated;

-- review-images 스토리지 버킷(공개 읽기, 본인 폴더 업로드)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-images', 'review-images', true, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "review-images public read"   on storage.objects;
drop policy if exists "review-images owner insert"   on storage.objects;
drop policy if exists "review-images owner delete"   on storage.objects;
create policy "review-images public read" on storage.objects for select
  using (bucket_id = 'review-images');
create policy "review-images owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'review-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "review-images owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'review-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- create_review 에 사진 배열 파라미터 추가(기존 3-arg 제거 후 4-arg 재정의)
drop function if exists public.create_review(text, integer, text);
create or replace function public.create_review(
  p_order_code text, p_rating integer, p_content text, p_images text[] default '{}')
returns public.reviews
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders;
  v_name  text;
  v_review public.reviews;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_rating < 1 or p_rating > 5 then raise exception 'invalid rating'; end if;

  select * into v_order from public.orders where order_code = p_order_code and buyer_id = v_uid;
  if not found then raise exception 'order not found'; end if;
  if v_order.seller_status <> 'completed' then raise exception 'order not completed'; end if;
  if exists (select 1 from public.reviews where order_id = v_order.id) then raise exception 'already reviewed'; end if;

  select coalesce(nullif(raw_user_meta_data->>'name', ''), '구매자') into v_name from auth.users where id = v_uid;
  v_name := left(v_name, 1) || '**';

  insert into public.reviews
    (seller_id, store_id, product_id, order_id, reviewer_id, reviewer_name, rating, content, helpful_count, images)
  values
    (v_order.seller_id, v_order.store_id, v_order.product_id, v_order.id, v_uid, v_name, p_rating, p_content, 0,
     coalesce(p_images, '{}'))
  returning * into v_review;

  insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
  values (v_uid, 'review', '리뷰 등록', '소중한 리뷰 감사합니다.', 'review', v_review.id);

  return v_review;
end; $$;
revoke all on function public.create_review(text, integer, text, text[]) from public;
grant execute on function public.create_review(text, integer, text, text[]) to authenticated;

-- ── 6) create_order: 적용된 쿠폰을 내 쿠폰함에서 사용처리 ──────────────────
create or replace function public.create_order(p_product_id uuid, p_quantity integer default 1, p_coupon_code text default null)
returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_prod   public.products;
  v_store  public.stores;
  v_coupon public.coupons;
  v_gross  integer;
  v_disc   integer := 0;
  v_amount integer;
  v_fee    integer;
  v_name   text;
  v_order  public.orders;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_quantity < 1 then raise exception 'invalid quantity'; end if;

  select * into v_prod from public.products where id = p_product_id;
  if not found then raise exception 'product not found'; end if;
  if v_prod.status <> 'selling' then raise exception 'product not on sale'; end if;
  if v_prod.stock < p_quantity then raise exception 'insufficient stock'; end if;

  select * into v_store from public.stores where id = v_prod.store_id;

  v_gross := v_prod.sale_price * p_quantity;

  if p_coupon_code is not null then
    select * into v_coupon from public.coupons
      where code = p_coupon_code and is_active and (ends_on is null or ends_on >= current_date);
    if found and v_gross >= v_coupon.min_order_amount then
      v_disc := case when v_coupon.discount_type = 'amount'
                     then v_coupon.discount_value
                     else floor(v_gross * v_coupon.discount_value / 100.0) end;
      v_disc := least(v_disc, v_gross);
      -- 내 쿠폰함에 있으면 사용처리(없으면 무시)
      update public.user_coupons
         set is_used = true, used_at = now()
       where buyer_id = v_uid and coupon_id = v_coupon.id and not is_used;
    end if;
  end if;

  v_amount := v_gross - v_disc;                                    -- 결제금액
  v_fee    := round(v_amount * coalesce(v_store.commission_rate, 10) / 100.0);

  select coalesce(nullif(raw_user_meta_data->>'name', ''), '구매자') into v_name from auth.users where id = v_uid;
  v_name := left(v_name, 1) || '**';

  insert into public.orders
    (seller_id, store_id, product_id, product_name, quantity, store_name, store_address,
     buyer_id, buyer_name, safe_number, pickup_start, pickup_end,
     payment_status, seller_status, total_price, amount, fee)
  values
    (v_prod.seller_id, v_prod.store_id, v_prod.id, v_prod.name, p_quantity, v_store.name, v_store.address,
     v_uid, v_name, '050-0000-0000', v_prod.pickup_start, v_prod.pickup_end,
     'paid', 'new', v_gross, v_amount, v_fee)
  returning * into v_order;

  update public.products set stock = stock - p_quantity where id = v_prod.id;  -- soldout 트리거 자동

  insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
  values (v_prod.seller_id, 'order', '신규 주문',
          v_order.order_code || ' · ' || v_prod.name || ' ' || p_quantity || '개 주문이 접수되었습니다.',
          'order', v_order.id);

  insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
  values (v_uid, 'order', '주문 완료',
          v_prod.name || ' 주문이 접수되었습니다. 픽업 시간을 확인하세요.', 'order', v_order.id);

  return v_order;
end; $$;
revoke all on function public.create_order(uuid, integer, text) from public;
grant execute on function public.create_order(uuid, integer, text) to authenticated;

-- ── 7) Realtime: price_alerts / user_coupons ────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='user_coupons') then
      alter publication supabase_realtime add table public.user_coupons;
    end if;
  end if;
end $$;
