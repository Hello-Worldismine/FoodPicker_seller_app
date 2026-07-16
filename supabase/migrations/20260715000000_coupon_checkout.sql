-- ============================================================================
-- FoodPicker 쿠폰 결제 적용(스태킹) + 정산 반영 (2026-07-14)
--   - create_order: 다중 쿠폰(text[]) 적용, 단독사용/중복 규칙 서버 검증,
--     정률 최대한도, 매장전용(seller_id) 검증, 주문에 대표쿠폰+총할인 기록.
--   - settlements.coupon_burden(판매자 부담액) + 정산 배치 회계:
--     본사부담 → 판매자에 할인액 보전, 점주부담 → 보전 없음, 분담 → 비율만 보전.
-- 재실행 안전.
-- ============================================================================

-- ── 1) create_order: 단일 text → uuid[](다중/스태킹, 쿠폰 id + 소유 기준) ─────
--   점주 발행 쿠폰은 code 가 null(다운로드 방식)이라 코드가 아닌 쿠폰 id 로 적용.
--   본인이 소유(user_coupons, 미사용)한 쿠폰만 적용 가능.
drop function if exists public.create_order(uuid, integer, text);
create or replace function public.create_order(
  p_product_id uuid, p_quantity integer default 1, p_coupon_ids uuid[] default '{}'
) returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
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
  c public.coupons%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_quantity < 1 then raise exception 'invalid quantity'; end if;

  select * into v_prod from public.products where id = p_product_id;
  if not found then raise exception 'product not found'; end if;
  if v_prod.status <> 'selling' then raise exception 'product not on sale'; end if;
  if v_prod.stock < p_quantity then raise exception 'insufficient stock'; end if;
  select * into v_store from public.stores where id = v_prod.store_id;

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
    end loop;

    -- 단독사용(allow_stacking=false) 쿠폰은 다른 쿠폰과 함께 사용 불가
    if v_valid > 1 and v_nonstack > 0 then
      raise exception 'coupon not stackable';
    end if;
    v_total := least(v_total, v_gross);
  end if;

  v_amount := v_gross - v_total;
  v_fee    := round(v_amount * coalesce(v_store.commission_rate, 10) / 100.0);

  select coalesce(nullif(raw_user_meta_data->>'name', ''), '구매자') into v_name from auth.users where id = v_uid;
  v_name := left(v_name, 1) || '**';

  insert into public.orders
    (seller_id, store_id, product_id, product_name, quantity, store_name, store_address,
     buyer_id, buyer_name, safe_number, pickup_start, pickup_end,
     payment_status, seller_status, total_price, amount, fee, coupon_id, coupon_discount_amount)
  values
    (v_prod.seller_id, v_prod.store_id, v_prod.id, v_prod.name, p_quantity, v_store.name, v_store.address,
     v_uid, v_name, '050-0000-0000', v_prod.pickup_start, v_prod.pickup_end,
     'paid', 'new', v_gross, v_amount, v_fee, v_first_coupon, v_total)
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
revoke all on function public.create_order(uuid, integer, uuid[]) from public;
grant execute on function public.create_order(uuid, integer, uuid[]) to authenticated;

-- ── 2) 정산: 쿠폰 부담 반영 ──────────────────────────────────────────────────
alter table public.settlements add column if not exists coupon_burden integer not null default 0;

create or replace function public.generate_weekly_settlements()
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_start date := (date_trunc('week', (now() at time zone 'Asia/Seoul') - interval '7 days'))::date;
  v_end   date := v_start + 6;
  v_pay   date := (date_trunc('week', (now() at time zone 'Asia/Seoul')))::date + 2;
  v_count integer;
begin
  insert into public.settlements
    (seller_id, store_id, order_id, order_code, product_name,
     amount, fee, platform_fee, pg_fee, refund, settlement_amount, coupon_burden,
     status, settled_on, period_start, period_end)
  select
    o.seller_id, o.store_id, o.id, o.order_code, o.product_name,
    o.amount, o.fee,
    round(o.fee * 0.8), o.fee - round(o.fee * 0.8),
    0,
    -- 정산액 = (결제액 - 수수료) + 본사 보전액
    (o.amount - o.fee) + (case
      when o.coupon_id is null or o.coupon_discount_amount = 0 then 0
      when c.cost_bearer = 'platform' then o.coupon_discount_amount
      when c.cost_bearer = 'shared'   then round(o.coupon_discount_amount * coalesce(c.platform_share, 0) / 100.0)
      else 0
    end),
    -- 판매자 쿠폰 부담액(표시용) = 할인액 - 본사 보전액
    (case
      when o.coupon_id is null or o.coupon_discount_amount = 0 then 0
      when c.cost_bearer = 'platform' then 0
      when c.cost_bearer = 'shared'   then o.coupon_discount_amount - round(o.coupon_discount_amount * coalesce(c.platform_share, 0) / 100.0)
      else o.coupon_discount_amount
    end),
    'scheduled', v_pay, v_start, v_end
  from public.orders o
  left join public.coupons c on c.id = o.coupon_id
  where o.seller_status = 'completed'
    and o.completed_at is not null
    and (o.completed_at at time zone 'Asia/Seoul')::date between v_start and v_end
    and not exists (select 1 from public.settlements s where s.order_id = o.id);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
revoke all on function public.generate_weekly_settlements() from public;

-- ── 3) 매장 전용 쿠폰 조회/다운로드 ─────────────────────────────────────────
-- 매장 페이지에서 그 매장(점주 발행) 쿠폰 목록 조회. 소유자 uid 노출 없이 store_id 로.
create or replace function public.store_coupons(p_store_id uuid)
returns setof public.coupons
language sql security definer set search_path = public stable
as $$
  select c.* from public.coupons c
  join public.stores s on s.seller_id = c.seller_id
  where s.id = p_store_id
    and c.is_active
    and (c.request_status is null or c.request_status = 'approved')
    and (c.ends_on is null or c.ends_on >= current_date);
$$;
grant execute on function public.store_coupons(uuid) to anon, authenticated;

-- 쿠폰 다운로드(내 쿠폰함에 담기). 코드 없는 매장 쿠폰도 id 로 받음(멱등).
create or replace function public.claim_coupon(p_coupon_id uuid)
returns public.coupons
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_c public.coupons;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_c from public.coupons
   where id = p_coupon_id and is_active
     and (request_status is null or request_status = 'approved')
     and (ends_on is null or ends_on >= current_date);
  if not found then raise exception 'coupon not available'; end if;
  insert into public.user_coupons (buyer_id, coupon_id) values (v_uid, p_coupon_id)
    on conflict (buyer_id, coupon_id) do nothing;
  insert into public.buyer_notifications (buyer_id, type, title, message, reference_type)
    values (v_uid, 'coupon', '쿠폰 발급', v_c.name || ' 쿠폰을 받았습니다.', 'coupon');
  return v_c;
end; $$;
revoke all on function public.claim_coupon(uuid) from public;
grant execute on function public.claim_coupon(uuid) to authenticated;
