-- ============================================================================
-- FoodPicker 쿠폰 기능 확장 (2026-07-14)
--   관리자 페이지 쿠폰 메뉴 구현에 따른 판매자/사용자 앱 + 공통 DB 반영.
--   - coupons: 부담주체/분담비율/중복사용/발행출처/점주발행/승인상태/정률최대한도/수량
--   - orders : 사용 쿠폰/쿠폰할인액 (정산 역산용)
--   - notification_type: coupon_approved / coupon_rejected
--   - request_coupon RPC(점주 발행 신청, 서버가 부담주체 강제)
--   - 승인/반려 시 판매자 알림 트리거
--   - create_order: 정률 최대한도 상한 + 주문에 쿠폰 기록
-- 재실행 안전.
-- ============================================================================

-- ── 1) coupons 확장 컬럼 ─────────────────────────────────────────────────────
alter table public.coupons add column if not exists cost_bearer        text not null default 'platform';
alter table public.coupons add column if not exists platform_share     integer;              -- 분담 시 본사 부담 %(0~100), 그 외 null
alter table public.coupons add column if not exists allow_stacking     boolean not null default false;
alter table public.coupons add column if not exists source             text not null default 'admin';   -- 'admin' | 'seller'
alter table public.coupons add column if not exists seller_id          uuid references auth.users(id) on delete cascade;  -- 점주 발행 신청자(=매장). null=전체 대상
alter table public.coupons add column if not exists request_status     text;                 -- 'pending'|'approved'|'rejected'. admin 발행은 null
alter table public.coupons add column if not exists reject_reason      text;
alter table public.coupons add column if not exists max_discount_amount integer;             -- 정률 할인 최대 한도(원). rate일 때만
alter table public.coupons add column if not exists total_quantity     integer;              -- 발행 수량(선택). null=무제한

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'coupons_cost_bearer_chk') then
    alter table public.coupons add constraint coupons_cost_bearer_chk check (cost_bearer in ('platform','seller','shared'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coupons_source_chk') then
    alter table public.coupons add constraint coupons_source_chk check (source in ('admin','seller'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coupons_reqstatus_chk') then
    alter table public.coupons add constraint coupons_reqstatus_chk check (request_status is null or request_status in ('pending','approved','rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coupons_share_chk') then
    alter table public.coupons add constraint coupons_share_chk check (platform_share is null or (platform_share between 0 and 100));
  end if;
end $$;

create index if not exists idx_coupons_seller on public.coupons(seller_id);

-- RLS: 활성 쿠폰은 모두 조회 + 점주는 본인 신청 쿠폰(대기/반려 포함) 조회
drop policy if exists coupons_select on public.coupons;
create policy coupons_select on public.coupons for select to anon, authenticated
  using (is_active = true or seller_id = auth.uid());

-- ── 2) orders 확장 (정산 역산용) ────────────────────────────────────────────
alter table public.orders add column if not exists coupon_id              uuid references public.coupons(id) on delete set null;
alter table public.orders add column if not exists coupon_discount_amount integer not null default 0;

-- ── 3) notification_type 값 추가 ────────────────────────────────────────────
alter type public.notification_type add value if not exists 'coupon_approved';
alter type public.notification_type add value if not exists 'coupon_rejected';

-- ── 4) 점주 발행 신청 RPC (서버가 부담주체/상태 강제) ────────────────────────
--   부담주체 선택 UI 는 앱에 노출하지 않으며, 클라이언트가 보내는 값과 무관하게
--   source='seller', cost_bearer='seller', platform_share=null, request_status='pending',
--   is_active=false, seller_id=auth.uid() 로 강제. 정률이면 최대한도 필수.
create or replace function public.request_coupon(
  p_name text,
  p_discount_type text,
  p_discount_value integer,
  p_min_order_amount integer default 0,
  p_ends_on date default null,
  p_allow_stacking boolean default false,
  p_max_discount_amount integer default null,
  p_total_quantity integer default null
) returns public.coupons
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.coupons;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_discount_type not in ('amount','rate') then raise exception 'invalid discount_type'; end if;
  if p_discount_value is null or p_discount_value <= 0 then raise exception 'invalid discount_value'; end if;
  if p_discount_type = 'rate' and (p_max_discount_amount is null or p_max_discount_amount <= 0) then
    raise exception 'max_discount_amount required for rate';
  end if;

  insert into public.coupons
    (code, name, discount_type, discount_value, min_order_amount, ends_on, is_active,
     cost_bearer, platform_share, allow_stacking, source, seller_id, request_status,
     max_discount_amount, total_quantity)
  values
    (null, p_name, p_discount_type, p_discount_value, coalesce(p_min_order_amount,0), p_ends_on, false,
     'seller', null, coalesce(p_allow_stacking,false), 'seller', v_uid, 'pending',
     case when p_discount_type='rate' then p_max_discount_amount else null end,
     p_total_quantity)
  returning * into v_row;

  return v_row;
end; $$;
revoke all on function public.request_coupon(text,text,integer,integer,date,boolean,integer,integer) from public;
grant execute on function public.request_coupon(text,text,integer,integer,date,boolean,integer,integer) to authenticated;

-- ── 5) 승인/반려 시 판매자 알림 (관리자가 request_status 를 바꾸면 자동 발송) ──
create or replace function public.notify_coupon_decision()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.seller_id is not null
     and new.request_status is distinct from old.request_status
     and new.request_status in ('approved','rejected') then
    insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
    values (
      new.seller_id,
      (case when new.request_status='approved' then 'coupon_approved' else 'coupon_rejected' end)::public.notification_type,
      (case when new.request_status='approved' then '쿠폰 발행 승인' else '쿠폰 발행 반려' end),
      (case when new.request_status='approved'
            then new.name || ' 쿠폰이 승인되어 발행되었습니다.'
            else new.name || ' 쿠폰이 반려되었습니다.' || coalesce(' 사유: ' || new.reject_reason, '') end),
      'coupon', new.id
    );
  end if;
  return new;
end; $$;

drop trigger if exists trg_notify_coupon_decision on public.coupons;
create trigger trg_notify_coupon_decision
  after update of request_status on public.coupons
  for each row execute function public.notify_coupon_decision();

-- ── 6) create_order: 정률 최대한도 상한 + 주문에 쿠폰 기록 ───────────────────
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
      where code = p_coupon_code and is_active
        and (request_status is null or request_status = 'approved')
        and (ends_on is null or ends_on >= current_date);
    if found and v_gross >= v_coupon.min_order_amount then
      v_disc := case when v_coupon.discount_type = 'amount'
                     then v_coupon.discount_value
                     else floor(v_gross * v_coupon.discount_value / 100.0) end;
      -- 정률: 최대 할인 한도 상한
      if v_coupon.discount_type = 'rate' and v_coupon.max_discount_amount is not null then
        v_disc := least(v_disc, v_coupon.max_discount_amount);
      end if;
      v_disc := least(v_disc, v_gross);
      update public.user_coupons
         set is_used = true, used_at = now()
       where buyer_id = v_uid and coupon_id = v_coupon.id and not is_used;
    end if;
  end if;

  v_amount := v_gross - v_disc;
  v_fee    := round(v_amount * coalesce(v_store.commission_rate, 10) / 100.0);

  select coalesce(nullif(raw_user_meta_data->>'name', ''), '구매자') into v_name from auth.users where id = v_uid;
  v_name := left(v_name, 1) || '**';

  insert into public.orders
    (seller_id, store_id, product_id, product_name, quantity, store_name, store_address,
     buyer_id, buyer_name, safe_number, pickup_start, pickup_end,
     payment_status, seller_status, total_price, amount, fee,
     coupon_id, coupon_discount_amount)
  values
    (v_prod.seller_id, v_prod.store_id, v_prod.id, v_prod.name, p_quantity, v_store.name, v_store.address,
     v_uid, v_name, '050-0000-0000', v_prod.pickup_start, v_prod.pickup_end,
     'paid', 'new', v_gross, v_amount, v_fee,
     v_coupon.id, v_disc)
  returning * into v_order;

  update public.products set stock = stock - p_quantity where id = v_prod.id;

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
