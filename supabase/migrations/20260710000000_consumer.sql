-- ============================================================================
-- FoodPicker 소비자(구매자) 앱 백엔드 (2026-07-10)
--   판매자 앱과 동일한 Supabase 프로젝트를 공유. 구매자 = auth.users(role 없음).
--   1) favorites(찜: 상품/매장) · user_addresses(주소) · coupons · buyer_notifications
--   2) public_reviews 뷰(남의 리뷰 읽기) · public_stores 에 phone 추가
--   3) create_order / create_review RPC (설계상 클라 직접 INSERT 금지 → security definer)
--   4) Realtime(buyer_notifications) · 개발용 쿠폰 시드
-- 모두 재실행 안전.
-- ============================================================================

-- ── 1) 찜(favorites) — 상품 또는 매장 하나만 ──────────────────────────────
create table if not exists public.favorites (
  id         uuid primary key default gen_random_uuid(),
  buyer_id   uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  store_id   uuid references public.stores(id)   on delete cascade,
  created_at timestamptz not null default now(),
  constraint favorites_one_target check (num_nonnulls(product_id, store_id) = 1)
);
create unique index if not exists favorites_uq_product on public.favorites(buyer_id, product_id) where product_id is not null;
create unique index if not exists favorites_uq_store   on public.favorites(buyer_id, store_id)   where store_id is not null;
create index if not exists idx_favorites_buyer on public.favorites(buyer_id);

alter table public.favorites enable row level security;
drop policy if exists favorites_select on public.favorites;
drop policy if exists favorites_insert on public.favorites;
drop policy if exists favorites_delete on public.favorites;
create policy favorites_select on public.favorites for select to authenticated using (buyer_id = auth.uid());
create policy favorites_insert on public.favorites for insert to authenticated with check (buyer_id = auth.uid());
create policy favorites_delete on public.favorites for delete to authenticated using (buyer_id = auth.uid());

-- ── 2) 구매자 주소 ─────────────────────────────────────────────────────────
create table if not exists public.user_addresses (
  id         uuid primary key default gen_random_uuid(),
  buyer_id   uuid not null references auth.users(id) on delete cascade,
  label      text,                       -- '우리집' 등
  icon       text,                       -- home/building/pin
  address    text not null,
  detail     text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_user_addresses_buyer on public.user_addresses(buyer_id);
create trigger trg_user_addresses_updated
  before update on public.user_addresses for each row execute function public.set_updated_at();

alter table public.user_addresses enable row level security;
drop policy if exists addresses_all on public.user_addresses;
create policy addresses_all on public.user_addresses for all to authenticated
  using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());

-- ── 3) 쿠폰(전역 카탈로그) ─────────────────────────────────────────────────
create table if not exists public.coupons (
  id               uuid primary key default gen_random_uuid(),
  code             text unique,
  name             text not null,
  discount_type    text not null default 'amount' check (discount_type in ('amount','rate')),
  discount_value   integer not null,           -- amount=원, rate=%
  min_order_amount integer not null default 0,
  ends_on          date,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint coupons_value_chk check (discount_value > 0)
);
alter table public.coupons enable row level security;
drop policy if exists coupons_select on public.coupons;
create policy coupons_select on public.coupons for select to anon, authenticated using (is_active = true);

-- ── 4) 구매자 알림 ─────────────────────────────────────────────────────────
create table if not exists public.buyer_notifications (
  id             uuid primary key default gen_random_uuid(),
  buyer_id       uuid not null references auth.users(id) on delete cascade,
  type           text not null default 'system',   -- order/review/coupon/system
  title          text not null,
  message        text,
  is_read        boolean not null default false,
  reference_type text,
  reference_id   uuid,
  created_at     timestamptz not null default now()
);
create index if not exists idx_buyer_notifs on public.buyer_notifications(buyer_id, is_read, created_at desc);
alter table public.buyer_notifications enable row level security;
drop policy if exists buyer_notifs_select on public.buyer_notifications;
drop policy if exists buyer_notifs_update on public.buyer_notifications;
drop policy if exists buyer_notifs_delete on public.buyer_notifications;
create policy buyer_notifs_select on public.buyer_notifications for select to authenticated using (buyer_id = auth.uid());
create policy buyer_notifs_update on public.buyer_notifications for update to authenticated using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());
create policy buyer_notifs_delete on public.buyer_notifications for delete to authenticated using (buyer_id = auth.uid());
-- 컬럼 잠금: 읽음 플래그만 변경 가능
revoke update on public.buyer_notifications from authenticated;
grant update (is_read) on public.buyer_notifications to authenticated;

-- ── 5) 남의 리뷰 읽기용 공개 뷰 (reviewer_id 등 제외) ──────────────────────
create or replace view public.public_reviews as
  select id, store_id, product_id, reviewer_name, rating, content,
         helpful_count, owner_reply, owner_replied_at, created_at
    from public.reviews;
grant select on public.public_reviews to anon, authenticated;

-- ── 6) public_stores 에 phone 추가(소비자 전화 연결용) ─────────────────────
-- 기존 뷰 중간에 컬럼을 삽입하면 create or replace 가 컬럼명 변경으로 간주해 거부(42P16)하므로
-- drop 후 재생성한다(공개 뷰라 의존 객체 없음).
drop view if exists public.public_stores;
create view public.public_stores as
  select id, name, category, description, notice, tags, store_image,
         open_hours, closed_days, lat, lng, address, phone, rating, review_count
    from public.stores
   where approval_status = 'approved';
grant select on public.public_stores to anon, authenticated;

-- ── 7) 주문 생성 RPC (결제/재고/발번 서버 처리) ────────────────────────────
--   설계상 orders 는 구매자 INSERT 정책이 없으므로 security definer 로 서버 대행.
--   프로토타입: 실 PG 없이 payment_status='paid' 로 즉시 확정. 재고 차감 + 판매자/구매자 알림.
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

-- ── 8) 리뷰 작성 RPC (구매 확인 서버 처리) ─────────────────────────────────
--   본인의 '픽업완료(completed)' 주문에 대해서만, 주문당 1회. refresh_store_rating 트리거로 평점 갱신.
create or replace function public.create_review(p_order_code text, p_rating integer, p_content text)
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
    (seller_id, store_id, product_id, order_id, reviewer_id, reviewer_name, rating, content, helpful_count)
  values
    (v_order.seller_id, v_order.store_id, v_order.product_id, v_order.id, v_uid, v_name, p_rating, p_content, 0)
  returning * into v_review;

  insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
  values (v_uid, 'review', '리뷰 등록', '소중한 리뷰 감사합니다.', 'review', v_review.id);

  return v_review;
end; $$;
revoke all on function public.create_review(text, integer, text) from public;
grant execute on function public.create_review(text, integer, text) to authenticated;

-- ── 8.5) 구매자 주문 취소 RPC ──────────────────────────────────────────────
--   본인 주문이 아직 픽업 전(new/confirmed)일 때만 취소. 재고 복구 + 판매자 알림.
create or replace function public.cancel_my_order(p_order_code text)
returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_order from public.orders where order_code = p_order_code and buyer_id = v_uid for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.seller_status not in ('new', 'confirmed') then raise exception 'not cancellable'; end if;

  update public.orders
     set seller_status = 'cancelled', cancel_reason = '구매자 취소'
   where id = v_order.id
  returning * into v_order;

  -- 재고 복구(상품이 남아있으면)
  update public.products set stock = stock + v_order.quantity where id = v_order.product_id;

  insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
  values (v_order.seller_id, 'cancel', '주문 취소',
          v_order.order_code || ' 주문이 구매자에 의해 취소되었습니다.', 'order', v_order.id);

  return v_order;
end; $$;
revoke all on function public.cancel_my_order(text) from public;
grant execute on function public.cancel_my_order(text) to authenticated;

-- ── 9) Realtime: 구매자 알림 실시간 ────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'buyer_notifications')
  then
    alter publication supabase_realtime add table public.buyer_notifications;
  end if;
end $$;

-- ── 10) 개발용 쿠폰 시드 ───────────────────────────────────────────────────
insert into public.coupons (code, name, discount_type, discount_value, min_order_amount, ends_on)
values
  ('CPN-001', '신규 가입 할인 쿠폰', 'amount', 1000, 5000, '2026-12-31'),
  ('CPN-002', '환경 챔피언 쿠폰',   'rate',   10,   3000, '2026-12-31')
on conflict (code) do update set
  name = excluded.name, discount_type = excluded.discount_type,
  discount_value = excluded.discount_value, min_order_amount = excluded.min_order_amount,
  ends_on = excluded.ends_on, is_active = true;
