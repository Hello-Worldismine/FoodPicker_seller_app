-- ============================================================================
-- FoodPicker 토스페이먼츠 결제 연동 (2026-07-24)
--
-- [플로우]
--   사용자앱(WebView 결제창) → 토스 인증 성공(successUrl 쿼리: paymentKey/orderId/amount)
--   → Edge Function toss-confirm(사용자 JWT) → 토스 승인 API(/v1/payments/confirm)
--   → 승인 성공 시 service_role 로 create_order RPC 호출 → 주문 생성.
--   환불은 관리자웹 → Edge Function toss-cancel(관리자 JWT, admin_profiles 검증)
--   → 토스 취소 API(/v1/payments/{paymentKey}/cancel).
--
-- [보안 설계]
--   1) 결제 우회 차단: create_order 의 execute 권한을 authenticated 에서 회수하고
--      service_role 전용으로 전환 — 앱이 RPC 를 직접 호출해 "결제 없이 주문"을
--      만드는 경로를 원천 차단. 주문 생성은 반드시 toss-confirm(승인 완료 후)을
--      경유한다. (기존 앱의 직접 호출 경로는 사용자앱 결제 개편으로 제거됨.)
--   2) 금액 위변조 방지: 함수가 상품가·쿠폰으로 서버 측 최종금액(v_amount)을
--      재계산하고, 토스에 실제 승인된 금액(p_paid_amount)과 불일치하면 예외
--      ('amount mismatch') → toss-confirm 이 승인 건을 자동 취소(보상 트랜잭션).
--   3) 유료 주문 결제 강제: v_amount > 0 인데 p_payment_key 가 없으면 예외
--      ('payment required'). v_amount = 0(전액 쿠폰)만 무결제 주문 허용.
--   4) 중복 승인 멱등: orders.payment_key 부분 unique 인덱스로 동일 paymentKey
--      의 이중 주문 생성을 DB 레벨에서 차단.
-- 재실행 안전.
-- ============================================================================

-- ── 1) orders: 토스 결제 스냅샷 컬럼 ────────────────────────────────────────
alter table public.orders add column if not exists payment_key    text;  -- 토스 paymentKey(승인 건 고유, 취소 API 에 사용)
alter table public.orders add column if not exists toss_order_id  text;  -- 결제창 호출 시 생성한 토스 orderId(6~64자)
alter table public.orders add column if not exists payment_method text;  -- 승인 응답 method(한글: '카드'|'간편결제' 등)

-- 동일 paymentKey 로 주문이 두 번 생성되는 것을 차단(무결제 주문은 null 이라 제외).
create unique index if not exists idx_orders_payment_key
  on public.orders(payment_key) where payment_key is not null;

-- ── 2) create_order v2: 결제 검증 파라미터 추가(로직은 20260716 개정판 보존) ──
--   - p_buyer_id: Edge Function(service_role) 호출 시 auth.uid() 가 null 이므로
--     검증 완료한 구매자 uid 를 명시 전달. v_uid := coalesce(auth.uid(), p_buyer_id).
--   - p_paid_amount: 토스에 실제 승인된 금액. 서버 재계산 금액과 대조.
--   - p_payment_key / p_toss_order_id / p_payment_method: 주문 행에 스냅샷 기록.
drop function if exists public.create_order(uuid, integer, uuid[]);
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
  c public.coupons%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_quantity < 1 then raise exception 'invalid quantity'; end if;

  -- [v2] 행 잠금(for update): 동시 주문의 재고 오버셀 방지 — 재고 검증·차감이
  --      같은 락 구간에서 직렬화된다(실결제 도입으로 오버셀 = 실돈 환불 이슈).
  select * into v_prod from public.products where id = p_product_id for update;
  if not found then raise exception 'product not found'; end if;
  if v_prod.status <> 'selling' then raise exception 'product not on sale'; end if;
  if v_prod.stock < p_quantity then raise exception 'insufficient stock'; end if;
  select * into v_store from public.stores where id = v_prod.store_id;
  -- 매장 상태 게이트: 미승인/판매중지(자율)/관리자 이용정지 매장은 주문 불가
  if v_store.approval_status <> 'approved' then raise exception 'store not approved'; end if;
  if v_store.is_selling_paused or v_store.suspended_by_admin then
    raise exception 'store not accepting orders';
  end if;

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
      -- [v2] 쿠폰 이중 사용 방지: 동시 주문이 같은 쿠폰을 쓰면 한쪽은 0행 갱신 → 거부.
      --      (행 락으로 직렬화된 뒤의 재검증 — 할인액이 이미 반영됐으므로 필수.)
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

  -- [v2] 금액 위변조 방지: 토스 승인 금액과 서버 재계산 금액 불일치 → 주문 거부.
  --      호출측(toss-confirm)이 이 예외를 받으면 승인 건을 자동 취소한다.
  if p_paid_amount is not null and p_paid_amount <> v_amount then
    raise exception 'amount mismatch: server=%', v_amount;
  end if;
  -- [v2] 결제 우회 차단: 유료 주문은 승인된 paymentKey 없이 생성 불가.
  if v_amount > 0 and p_payment_key is null then
    raise exception 'payment required';
  end if;

  v_fee    := round(v_amount * coalesce(v_store.commission_rate, 10) / 100.0);

  select coalesce(nullif(raw_user_meta_data->>'name', ''), '구매자') into v_name from auth.users where id = v_uid;
  v_name := left(v_name, 1) || '**';

  insert into public.orders
    (seller_id, store_id, product_id, product_name, quantity, store_name, store_address,
     buyer_id, buyer_name, safe_number, pickup_start, pickup_end,
     payment_status, seller_status, total_price, amount, fee, coupon_id, coupon_discount_amount,
     payment_key, toss_order_id, payment_method)
  values
    (v_prod.seller_id, v_prod.store_id, v_prod.id, v_prod.name, p_quantity, v_store.name, v_store.address,
     v_uid, v_name, '050-0000-0000', v_prod.pickup_start, v_prod.pickup_end,
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
          v_prod.name || ' 주문이 접수되었습니다. 픽업 시간을 확인하세요.', 'order', v_order.id);

  return v_order;
end; $$;

-- ── 3) 권한: service_role 전용 ──────────────────────────────────────────────
-- authenticated 회수 = 앱이 결제 없이 RPC 로 주문을 만드는 우회 경로 차단.
-- (기존 앱의 create_order 직접 호출은 사용자앱 결제 개편으로 제거됨 — toss-confirm 경유.)
-- anon 까지 명시 회수 — Supabase 는 신규 함수에 anon/authenticated EXECUTE 를
-- default privileges 로 자동 부여하므로 public 만 회수하면 무인증 우회가 남는다.
revoke all on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) from public;
revoke all on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) from anon;
revoke all on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) from authenticated;
grant execute on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) to service_role;
