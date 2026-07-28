-- ============================================================================
-- FoodPicker 수정사항 시트 반영 (2026-07-28)
--
--   1) 픽업 마감 정책 전환 마무리 — "주문 후 N분 이내"
--      · products.pickup_deadline_minutes 를 마이그레이션으로 정식화
--        (지금까지 SQL Editor 수동 ALTER 로만 존재하는 '유령 컬럼' 이었다 →
--         새 환경에 마이그레이션을 적용하면 판매자앱 상품등록부터 실패한다)
--      · [CRITICAL] 컬럼 단위 UPDATE 권한 부여.
--        20260716000000_admin.sql:421-429 가 products 의 테이블 UPDATE 를 authenticated 에서
--        회수하고 컬럼 화이트리스트만 재부여했다. 그 뒤 수동 추가된 pickup_deadline_minutes 는
--        목록에 없어 **판매자앱의 '상품 수정'이 42501 permission denied 로 100% 실패**하는
--        상태였다(INSERT 는 통과하므로 등록만 되고 수정이 안 되는 증상).
--      · public_products 뷰에 pickup_deadline_minutes 노출  ← 시트 요청사항
--      · orders 에 pickup_deadline_minutes / pickup_deadline_at 추가 + create_order 스냅샷
--        ← 시트 요청사항. 사용자앱 mapOrder 가 이미 이 컬럼을 읽고 있었으나 존재하지 않아
--          주문내역·주문완료·QR 모달의 '픽업 마감' 이 전부 공백이었다.
--      · stores.default_pickup_deadline_minutes — 입점 신청 시 필수 설정(상품등록 기본값)
--
--   2) 매장 좌표(lat/lng) 정합성
--      판매자앱이 주소만 저장하고 좌표를 저장하지 않아 public_stores.lat/lng 가 전부 null →
--      사용자앱 지도 / 가게 상세 매장정보 지도 / 상품상세 픽업장소 지도가 모두
--      "위치 정보가 없습니다" 로 표시됐다. 앱에서 지오코딩해 stores.lat/lng 를 채우면
--      이 트리거가 해당 매장의 기존 상품 좌표·픽업주소 스냅샷까지 자동 동기화한다.
--      (flag_store_reapproval 트리거는 lat/lng 를 감시하지 않으므로 좌표만 갱신하는 것은
--       재승인 대기로 떨어지지 않는다 — 20260709000000_realtime_and_batch.sql:31-53)
--
--   3) QR 픽업완료 처리
--      사용자앱이 발행하는 QR 값 = orders.order_code(FP-####).
--      · lookup_order_for_pickup() : 스캔 직후 확인용 조회(RLS 로 본인 매장 주문만)
--      · complete_pickup()         : 원자적 상태 전이 + 사유 있는 에러코드 + 구매자 알림
--      기존 경로는 orders 테이블 직접 UPDATE 로 상태 전이 규칙 검증이 없었다.
--
--   4) 결제수단 관리
--      · user_payment_prefs   : 기본 결제수단(카드/간편결제 등) — 구매자가 직접 읽기/쓰기
--      · payment_methods      : 토스 빌링키 보관용. **authenticated 접근 전면 차단**
--                               (billing_key 노출 금지) — service_role 전용
--      · my_payment_methods   : 앱 노출용 뷰(billing_key 제외)
--      카드번호·유효기간·CVC 는 어디에도 저장하지 않는다.
--
-- 모두 재실행 안전(idempotent).
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1) 픽업 마감(분) 컬럼 정식화
-- ──────────────────────────────────────────────────────────────────────────────
alter table public.products add column if not exists pickup_deadline_minutes integer;
alter table public.stores   add column if not exists default_pickup_deadline_minutes integer;
alter table public.orders   add column if not exists pickup_deadline_minutes integer;
-- 절대 마감시각. 생성컬럼이 아닌 일반 컬럼 — 개별 주문 마감 연장 여지를 남기고
-- add column 시 테이블 rewrite 를 피한다.
alter table public.orders   add column if not exists pickup_deadline_at timestamptz;

comment on column public.products.pickup_deadline_minutes is
  '주문 후 픽업 마감까지의 분(판매자 선택: 30/60/90/120). null 이면 앱이 60분 폴백.';
comment on column public.stores.default_pickup_deadline_minutes is
  '입점 신청 시 설정하는 매장 기본 픽업 마감(분). 상품 등록 기본값으로 상속된다.';
comment on column public.orders.pickup_deadline_at is
  '주문 시점에 확정된 픽업 마감 시각(ordered_at + pickup_deadline_minutes).';

-- 기존 데이터 보정: pickup_start/pickup_end 간격(분) → 없으면 60분.
update public.products
   set pickup_deadline_minutes = least(1440, greatest(10,
         coalesce(round(extract(epoch from (pickup_end - pickup_start)) / 60)::int, 60)))
 where pickup_deadline_minutes is null;

update public.stores
   set default_pickup_deadline_minutes = 60
 where default_pickup_deadline_minutes is null;

update public.orders o
   set pickup_deadline_minutes = coalesce(p.pickup_deadline_minutes, 60)
  from public.products p
 where o.product_id = p.id and o.pickup_deadline_minutes is null;
update public.orders set pickup_deadline_minutes = 60 where pickup_deadline_minutes is null;
update public.orders
   set pickup_deadline_at = ordered_at + make_interval(mins => coalesce(pickup_deadline_minutes, 60))
 where pickup_deadline_at is null;

-- 신규 행 기본값(앱이 항상 명시 전달하지만 방어).
alter table public.products alter column pickup_deadline_minutes set default 60;
alter table public.stores   alter column default_pickup_deadline_minutes set default 60;
alter table public.orders   alter column pickup_deadline_minutes set default 60;

alter table public.products drop constraint if exists products_pickup_deadline_chk;
alter table public.products add constraint products_pickup_deadline_chk
  check (pickup_deadline_minutes is null or pickup_deadline_minutes between 10 and 1440);

alter table public.stores drop constraint if exists stores_pickup_deadline_chk;
alter table public.stores add constraint stores_pickup_deadline_chk
  check (default_pickup_deadline_minutes is null or default_pickup_deadline_minutes between 10 and 1440);

alter table public.orders drop constraint if exists orders_pickup_deadline_chk;
alter table public.orders add constraint orders_pickup_deadline_chk
  check (pickup_deadline_minutes is null or pickup_deadline_minutes between 10 and 1440);

-- 마감 초과 주문 조회/배치용 부분 인덱스
create index if not exists idx_orders_pickup_deadline
  on public.orders(pickup_deadline_at)
  where seller_status in ('new', 'confirmed');

-- ──────────────────────────────────────────────────────────────────────────────
-- 2) [CRITICAL] 컬럼 단위 UPDATE 권한 재부여
--    products/stores 는 테이블 UPDATE 가 회수되고 컬럼 화이트리스트만 부여된 상태다
--    (20260716000000_admin.sql:421-429 / 20260706000000_init.sql:480-486).
--    신규 컬럼은 반드시 개별 grant 해야 판매자 쓰기가 동작한다.
--    orders 는 판매자에게 (seller_status, cancel_reason) 만 허용된 상태를 그대로 유지한다
--    — 픽업 마감은 서버(create_order / complete_pickup)만 기록해야 하므로 grant 하지 않는다.
-- ──────────────────────────────────────────────────────────────────────────────
grant update (pickup_deadline_minutes)         on public.products to authenticated;
grant update (default_pickup_deadline_minutes) on public.stores   to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3) 공개 뷰 확장
--    create or replace view 는 '기존 컬럼의 이름/타입/순서 불변 + 맨 뒤 추가' 만 허용한다.
--    앞부분 컬럼 목록은 기존 정의와 한 글자도 달라선 안 된다(42P16 방지).
--      · public_products 현행 정의: 20260707000000_followups.sql:97-105
--      · public_stores  현행 정의: 20260710000000_consumer.sql:104-110 (phone 포함)
--    public_products 를 참조하는 DB 객체는 없다(admin_products 는 products 직접 참조)
--    → drop 없이 replace 가능하며 anon/authenticated grant 도 보존된다.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace view public.public_products as
  select id, store_id, name, category, emoji, thumbnail, images,
         original_price, sale_price, discount_rate, stock,
         pickup_start, pickup_end, expiry_date, storage, storage_detail,
         description, composition, origin, allergens, cancel_policy,
         store_notice, pickup_address, lat, lng, status, created_at, updated_at,
         pickup_deadline_minutes                     -- ★ 신규(맨 뒤)
    from public.products
   where status = 'selling';
grant select on public.public_products to anon, authenticated;

create or replace view public.public_stores as
  select id, name, category, description, notice, tags, store_image,
         open_hours, closed_days, lat, lng, address, phone, rating, review_count,
         default_pickup_deadline_minutes             -- ★ 신규(맨 뒤)
    from public.stores
   where approval_status = 'approved';
grant select on public.public_stores to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4) create_order v3 — 픽업 마감 스냅샷
--    [주의] drop function 금지. 시그니처 동일 create or replace 로만 교체한다.
--    drop 하면 Supabase default privileges 가 anon/authenticated 에 execute 를 다시 부여해
--    '결제 없이 주문' 우회 구멍이 생긴다(20260724000000_toss_payments.sql:182-183 주석).
--    v2 의 결제·쿠폰·재고 검증 로직은 그대로 보존하고 픽업 마감 기록만 추가한다.
--    하위 호환: pickup_start/pickup_end 를 '주문시각 ~ 마감시각' 으로 채워
--    판매자앱·관리자웹의 기존 픽업 표기가 코드 수정 없이 살아나게 한다.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.create_order(
  p_product_id     uuid,
  p_quantity       integer default 1,
  p_coupon_ids     uuid[]  default '{}',
  p_buyer_id       uuid    default null,
  p_payment_key    text    default null,
  p_toss_order_id  text    default null,
  p_payment_method text    default null,
  p_paid_amount    integer default null
) returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := coalesce(auth.uid(), p_buyer_id);
  v_prod   public.products;
  v_store  public.stores;
  v_gross  integer;
  v_disc   integer;
  v_total  integer := 0;
  v_amount integer;
  v_fee    integer;
  v_name   text;
  v_order  public.orders;
  v_ids    uuid[];
  v_first_coupon uuid := null;
  v_valid  int := 0;
  v_nonstack int := 0;
  v_coupon_rows int;
  v_deadline_min integer;
  v_deadline_at  timestamptz;
  v_now    timestamptz := now();
  c public.coupons%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_quantity < 1 then raise exception 'invalid quantity'; end if;

  select * into v_prod from public.products where id = p_product_id for update;
  if not found then raise exception 'product not found'; end if;
  if v_prod.status <> 'selling' then raise exception 'product not on sale'; end if;
  if v_prod.stock < p_quantity then raise exception 'insufficient stock'; end if;
  select * into v_store from public.stores where id = v_prod.store_id;
  if v_store.approval_status <> 'approved' then raise exception 'store not approved'; end if;
  if v_store.is_selling_paused or v_store.suspended_by_admin then
    raise exception 'store not accepting orders';
  end if;

  -- [v3] 픽업 마감 — 상품값 우선, 없으면 매장 기본값, 최종 폴백 60분.
  v_deadline_min := coalesce(v_prod.pickup_deadline_minutes, v_store.default_pickup_deadline_minutes, 60);
  v_deadline_at  := v_now + make_interval(mins => v_deadline_min);

  v_gross := v_prod.sale_price * p_quantity;

  select coalesce(array_agg(distinct x), '{}')
    into v_ids
    from unnest(coalesce(p_coupon_ids, '{}')) as x
    where x is not null;

  if array_length(v_ids, 1) is not null then
    for c in
      select * from public.coupons
       where id = any(v_ids) and is_active
         and (request_status is null or request_status = 'approved')
         and (starts_on is null or starts_on <= current_date)
         and (ends_on is null or ends_on >= current_date)
         and exists (select 1 from public.user_coupons uc
                      where uc.coupon_id = coupons.id and uc.buyer_id = v_uid and not uc.is_used)
    loop
      if c.seller_id is not null and c.seller_id <> v_prod.seller_id then
        raise exception 'coupon not valid for this store';
      end if;
      if v_gross < c.min_order_amount then
        raise exception 'order below coupon minimum';
      end if;
      v_valid := v_valid + 1;
      if not c.allow_stacking then v_nonstack := v_nonstack + 1; end if;
      if v_first_coupon is null then v_first_coupon := c.id; end if;

      v_disc := case when c.discount_type = 'amount' then c.discount_value
                     else floor(v_gross * c.discount_value / 100.0) end;
      if c.discount_type = 'rate' and c.max_discount_amount is not null then
        v_disc := least(v_disc, c.max_discount_amount);
      end if;
      v_total := v_total + v_disc;

      update public.user_coupons set is_used = true, used_at = now()
       where buyer_id = v_uid and coupon_id = c.id and not is_used;
      get diagnostics v_coupon_rows = row_count;
      if v_coupon_rows = 0 then
        raise exception 'coupon already used';
      end if;
    end loop;

    if v_valid > 1 and v_nonstack > 0 then
      raise exception 'coupon not stackable';
    end if;
    v_total := least(v_total, v_gross);
  end if;

  v_amount := v_gross - v_total;

  if p_paid_amount is not null and p_paid_amount <> v_amount then
    raise exception 'amount mismatch: server=%', v_amount;
  end if;
  if v_amount > 0 and p_payment_key is null then
    raise exception 'payment required';
  end if;

  v_fee := round(v_amount * coalesce(v_store.commission_rate, 10) / 100.0);

  select coalesce(nullif(raw_user_meta_data->>'name', ''), '구매자') into v_name from auth.users where id = v_uid;
  v_name := left(v_name, 1) || '**';

  insert into public.orders
    (seller_id, store_id, product_id, product_name, quantity, store_name, store_address,
     buyer_id, buyer_name, safe_number,
     pickup_start, pickup_end, pickup_deadline_minutes, pickup_deadline_at,
     payment_status, seller_status, total_price, amount, fee, coupon_id, coupon_discount_amount,
     payment_key, toss_order_id, payment_method)
  values
    (v_prod.seller_id, v_prod.store_id, v_prod.id, v_prod.name, p_quantity, v_store.name, v_store.address,
     v_uid, v_name, '050-0000-0000',
     coalesce(v_prod.pickup_start, v_now), coalesce(v_prod.pickup_end, v_deadline_at),
     v_deadline_min, v_deadline_at,
     'paid', 'new', v_gross, v_amount, v_fee, v_first_coupon, v_total,
     p_payment_key, p_toss_order_id, p_payment_method)
  returning * into v_order;

  update public.products set stock = stock - p_quantity where id = v_prod.id;

  insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
  values (v_prod.seller_id, 'order', '신규 주문',
          v_order.order_code || ' · ' || v_prod.name || ' ' || p_quantity || '개 주문이 접수되었습니다.',
          'order', v_order.id);
  insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
  values (v_uid, 'order', '주문 완료',
          v_prod.name || ' 주문이 접수되었습니다. 주문 후 ' || v_deadline_min || '분 이내에 픽업해주세요.',
          'order', v_order.id);

  return v_order;
end; $$;

-- 권한 재확인(멱등) — service_role 전용 유지.
revoke all on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) from public;
revoke all on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) from anon;
revoke all on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) from authenticated;
grant execute on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) to service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5) 매장 좌표/주소 → 상품 스냅샷 동기화 트리거
--    products.lat/lng/pickup_address 는 등록 시점 매장 스냅샷이라 나중에 매장 좌표를
--    채워도 과거 상품은 null 로 남는다 → 상품상세 '픽업 장소' 지도가 계속 안 뜬다.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.sync_store_geo_to_products()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.products
     set lat = new.lat,
         lng = new.lng,
         pickup_address = coalesce(new.address, pickup_address)
   where store_id = new.id
     and (lat is distinct from new.lat
          or lng is distinct from new.lng
          or pickup_address is distinct from coalesce(new.address, pickup_address));
  return new;
end; $$;

drop trigger if exists trg_stores_geo_sync on public.stores;
create trigger trg_stores_geo_sync
  after update of lat, lng, address on public.stores
  for each row
  when (new.lat is distinct from old.lat
        or new.lng is distinct from old.lng
        or new.address is distinct from old.address)
  execute function public.sync_store_geo_to_products();

-- ──────────────────────────────────────────────────────────────────────────────
-- 6) QR 픽업완료 — 조회 RPC + 원자적 완료 RPC
-- ──────────────────────────────────────────────────────────────────────────────

-- 6.1 스캔한 코드로 주문 1건 조회. security invoker → RLS(seller_id = auth.uid()) 적용
--     이라 타 매장 주문은 0행. 코드 정규화(대문자/공백 제거)만 서버에서 처리한다.
create or replace function public.lookup_order_for_pickup(p_order_code text)
returns table (
  order_code              text,
  product_name            text,
  quantity                integer,
  buyer_name              text,
  seller_status           public.order_seller_status,
  payment_status          public.payment_status,
  ordered_at              timestamptz,
  pickup_deadline_minutes integer,
  pickup_deadline_at      timestamptz,
  amount                  integer,
  total_price             integer
)
language sql security invoker stable set search_path = public
as $$
  select o.order_code, o.product_name, o.quantity, o.buyer_name,
         o.seller_status, o.payment_status, o.ordered_at,
         o.pickup_deadline_minutes, o.pickup_deadline_at,
         o.amount, o.total_price
    from public.orders o
   where o.order_code = upper(trim(coalesce(p_order_code, '')));
$$;
revoke all on function public.lookup_order_for_pickup(text) from public;
revoke all on function public.lookup_order_for_pickup(text) from anon;
grant execute on function public.lookup_order_for_pickup(text) to authenticated;

-- 6.2 픽업 완료 처리.
--     security definer 이지만 seller_id = auth.uid() 를 함수 안에서 재검증하므로
--     타 매장 주문을 완료 처리할 수 없다.
--     'new'(주문 확인 전) 스캔도 허용한다 — 현장 픽업이 곧 수락+완료이므로 두 단계를 함께 처리.
--     클라이언트가 분기할 수 있도록 예외 메시지를 대문자 상수로 고정한다.
create or replace function public.complete_pickup(p_order_code text)
returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_order_code, '')));
  v_o    public.orders;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if v_code = '' then raise exception 'INVALID_CODE'; end if;

  -- QR 에 딥링크/공백이 섞여도 FP-#### 패턴만 추출.
  if v_code !~ '^FP-[0-9]+$' then
    v_code := coalesce((regexp_match(v_code, '(FP-[0-9]+)'))[1], v_code);
  end if;

  -- 동시 스캔 직렬화(같은 QR 을 두 기기에서 스캔해도 1회만 성공)
  select * into v_o from public.orders where order_code = v_code for update;

  if not found                       then raise exception 'ORDER_NOT_FOUND';   end if;
  if v_o.seller_id <> v_uid          then raise exception 'NOT_MY_ORDER';      end if;
  if v_o.seller_status = 'completed' then raise exception 'ALREADY_COMPLETED'; end if;
  if v_o.seller_status = 'cancelled' then raise exception 'ORDER_CANCELLED';   end if;
  if v_o.payment_status <> 'paid'    then raise exception 'NOT_PAID';          end if;

  -- completed_at 은 stamp_order_status 트리거가 자동 기록한다.
  update public.orders
     set seller_status = 'completed',
         confirmed_at  = coalesce(confirmed_at, now())
   where id = v_o.id
  returning * into v_o;

  if v_o.buyer_id is not null then
    insert into public.buyer_notifications
      (buyer_id, type, title, message, reference_type, reference_id)
    values
      (v_o.buyer_id, 'order', '픽업 완료',
       v_o.product_name || ' 픽업이 완료되었습니다. 리뷰를 남겨주세요!', 'order', v_o.id);
  end if;

  return v_o;
end; $$;
revoke all on function public.complete_pickup(text) from public;
revoke all on function public.complete_pickup(text) from anon;
grant execute on function public.complete_pickup(text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 7) 결제수단 관리
-- ──────────────────────────────────────────────────────────────────────────────

-- 7.1 기본 결제수단(구매자 소유 리소스 — user_addresses 패턴)
create table if not exists public.user_payment_prefs (
  buyer_id          uuid primary key references auth.users(id) on delete cascade,
  default_method    text not null default 'CARD',
  easy_pay_provider text,                                   -- 토스페이/카카오페이 등
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint user_payment_prefs_method_chk
    check (default_method in ('CARD', 'EASY_PAY', 'TRANSFER', 'VIRTUAL_ACCOUNT'))
);

drop trigger if exists trg_user_payment_prefs_updated on public.user_payment_prefs;
create trigger trg_user_payment_prefs_updated
  before update on public.user_payment_prefs for each row execute function public.set_updated_at();

alter table public.user_payment_prefs enable row level security;
drop policy if exists user_payment_prefs_owner_all on public.user_payment_prefs;
create policy user_payment_prefs_owner_all on public.user_payment_prefs
  for all to authenticated
  using (buyer_id = auth.uid())
  with check (buyer_id = auth.uid());
grant select, insert, update, delete on public.user_payment_prefs to authenticated;

-- 7.2 토스 빌링키 보관 (2단계 — 자동결제 사용 승인 후 활성화)
--     [보안] billing_key 는 클라이언트에 절대 노출하지 않는다.
--     RLS 를 켜고 정책을 만들지 않으며 anon/authenticated 권한을 회수한다 → service_role 전용.
create table if not exists public.payment_methods (
  id                 uuid primary key default gen_random_uuid(),
  buyer_id           uuid not null references auth.users(id) on delete cascade,
  provider           text not null default 'toss',
  method_type        text not null default 'card',
  billing_key        text not null,            -- 토스 빌링키(자동결제 승인용) — 노출 금지
  customer_key       text not null,            -- 토스 customerKey(= buyer uuid)
  card_company       text,                     -- 표시용
  card_number_masked text,                     -- 표시용(마스킹)
  card_type          text,                     -- '신용' | '체크'
  alias              text,
  is_default         boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_payment_methods_buyer on public.payment_methods(buyer_id, created_at desc);
create unique index if not exists idx_payment_methods_default
  on public.payment_methods(buyer_id) where is_default;

drop trigger if exists trg_payment_methods_updated on public.payment_methods;
create trigger trg_payment_methods_updated
  before update on public.payment_methods for each row execute function public.set_updated_at();

alter table public.payment_methods enable row level security;
-- 정책을 만들지 않는다(= authenticated 접근 전면 차단). 명시 회수까지 함께.
revoke all on public.payment_methods from anon;
revoke all on public.payment_methods from authenticated;

-- 7.3 앱 노출용 뷰 — billing_key/customer_key 제외.
--     security_invoker 를 켜지 않으므로 뷰 소유자 권한으로 실행되고, where 절이 본인 행만 남긴다.
create or replace view public.my_payment_methods as
  select id, provider, method_type, card_company, card_number_masked, card_type,
         alias, is_default, created_at
    from public.payment_methods
   where buyer_id = auth.uid();
grant select on public.my_payment_methods to authenticated;

-- 7.4 기본 결제수단 지정 / 삭제 (본인 행만 — 부분 unique 충돌 회피 포함)
create or replace function public.set_default_payment_method(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  update public.payment_methods set is_default = false
   where buyer_id = v_uid and is_default and id <> p_id;

  update public.payment_methods set is_default = true
   where id = p_id and buyer_id = v_uid;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'PAYMENT_METHOD_NOT_FOUND'; end if;

  return true;
end; $$;
revoke all on function public.set_default_payment_method(uuid) from public;
revoke all on function public.set_default_payment_method(uuid) from anon;
grant execute on function public.set_default_payment_method(uuid) to authenticated;

create or replace function public.delete_my_payment_method(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  delete from public.payment_methods where id = p_id and buyer_id = v_uid;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'PAYMENT_METHOD_NOT_FOUND'; end if;
  return true;
end; $$;
revoke all on function public.delete_my_payment_method(uuid) from public;
revoke all on function public.delete_my_payment_method(uuid) from anon;
grant execute on function public.delete_my_payment_method(uuid) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8) 관리자 뷰 재생성 — `select p.*` / `select s.*` 는 생성 시점에 컬럼 목록이 고정된다
--
--    admin_products(20260716000000_admin.sql:513-521) 와 admin_stores(20260722010000:152-164)는
--    `p.*` / `s.*` 로 정의됐지만 Postgres 는 뷰 생성 시점에 `*` 를 컬럼 목록으로 전개해 저장한다.
--    따라서 위 1) 에서 추가한 products.pickup_deadline_minutes / stores.default_pickup_deadline_minutes
--    는 재생성 없이는 관리자웹에 내려오지 않는다.
--
--    뒤에 파생 컬럼(store_name/report_count/…)이 붙어 있어 create or replace 로는 중간 삽입이 되지
--    않으므로 drop + create 한다. 정의는 최신 정의를 그대로 옮겼고 security_barrier·is_admin() 게이트·
--    grant 를 모두 재적용한다.
-- ──────────────────────────────────────────────────────────────────────────────
drop view if exists public.admin_products;
create view public.admin_products with (security_barrier) as
  select p.*,
         s.name as store_name,
         (select count(*) from public.reports r where r.product_id = p.id)::int as report_count
    from public.products p
    left join public.stores s on s.id = p.store_id
   where (select public.is_admin());
grant select on public.admin_products to authenticated;

drop view if exists public.admin_stores;
create view public.admin_stores with (security_barrier) as
  select s.*,
         u.email,
         (select count(*) from public.orders o where o.store_id = s.id)::int as total_orders,
         (select count(*) from public.reports r
           where r.store_id = s.id and r.inquirer_type = 'buyer')::int as report_count,
         (select count(*) from public.reviews rv
           where rv.store_id = s.id)::int as total_review_count
    from public.stores s
    left join auth.users u on u.id = s.seller_id
   where (select public.is_admin());
grant select on public.admin_stores to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 9) 참고 — 소비기한 만료로 자동 판매중지된 상품 진단/복구
--
--    사용자앱 홈이 비어 있던 근본 원인:
--    pg_cron 잡 foodpicker-expire-products 가 5분마다 `expiry_date < now()` 인 selling 상품을
--    status='paused', pause_reason='expiry' 로 바꾼다(20260707000000_followups.sql:58-66,89).
--    판매자앱 상품등록의 소비기한 기본값이 '오늘 23:59' 였기 때문에 등록 당일 자정에
--    전 상품이 사용자앱에서 사라졌다. 앱 쪽은 이 커밋에서 수정됐다
--    (기본값 '내일 23:59' + 과거 소비기한 차단 + 소비기한 연장 시 판매중 자동 복구).
--
--    이미 만료된 라이브 상품을 되살리려면 아래를 **판단 후 직접** 실행하라.
--    소비기한은 실제 식품 안전 정보이므로 자동 연장을 마이그레이션에 포함하지 않았다.
--
--    -- 진단
--    -- select id, name, expiry_date, stock, status, pause_reason
--    --   from public.products where status = 'paused' and pause_reason = 'expiry';
--
--    -- 개발/테스트 데이터 일괄 복구 (stock > 0 조건 필수 — 없으면 즉시 soldout 으로 되돌아간다)
--    -- update public.products
--    --    set expiry_date = now() + interval '7 days', status = 'selling', pause_reason = null
--    --  where status = 'paused' and pause_reason = 'expiry' and stock > 0;
--
--    -- 기존 매장 좌표 백필: 판매자앱 매장관리 화면에 진입하면 자동 지오코딩되지만,
--    -- 즉시 채우려면 주소로 좌표를 구해 아래처럼 매장별 실행(상품 좌표는 트리거가 동기화).
--    -- update public.stores set lat = ?, lng = ? where id = '...';
-- ──────────────────────────────────────────────────────────────────────────────
