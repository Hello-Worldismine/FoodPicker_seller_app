-- ============================================================================
-- FoodPicker 픽업 마감 로직 전환 (2026-07-30)
--
-- [변경] "주문 후 N분 이내"(상대) → **"픽업 마감 시각"(절대)**
--   · 기존: products.pickup_deadline_minutes(30/60/90/120) 를 판매자가 고르고,
--           주문 시각 + N분 을 마감으로 계산했다. 같은 상품이라도 언제 주문하느냐에 따라
--           마감이 달라져 매장 운영(마감 시간에 일괄 정리)과 어긋났다.
--   · 변경: 판매자가 상품마다 **마감 시각 자체**를 지정한다(products.pickup_deadline_at).
--           주문은 그 시각을 그대로 스냅샷한다 → 모든 구매자의 마감이 동일하다.
--
-- [신규] 픽업 마감 30분 전 푸시 알림
--   · send_pickup_reminders() + pg_cron(5분 주기) → buyer_notifications INSERT
--     → 기존 push_buyer_notification 트리거(20260713000000)가 Expo Push 발송.
--   · orders.pickup_reminder_sent_at 으로 1회만 발송(멱등).
--   · 주문 시점에 이미 마감까지 30분 미만이면 create_order 가 즉시 1회 발송한다.
--
-- 하위 호환: pickup_deadline_minutes 컬럼은 남긴다(구 클라이언트 표시용).
--            create_order 가 '주문 시점 기준 남은 분' 으로 계속 채운다.
-- 재실행 안전(idempotent).
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1) 컬럼
-- ──────────────────────────────────────────────────────────────────────────────
alter table public.products add column if not exists pickup_deadline_at timestamptz;
alter table public.orders   add column if not exists pickup_reminder_sent_at timestamptz;

comment on column public.products.pickup_deadline_at is
  '픽업 마감 시각(절대). 판매자가 상품 등록 시 날짜+시각으로 지정한다. 소비기한(expiry_date) 이후일 수 없다.';
comment on column public.orders.pickup_reminder_sent_at is
  '픽업 마감 30분 전 알림 발송 시각. NULL 이면 미발송 — send_pickup_reminders() 의 멱등 키.';
comment on column public.products.pickup_deadline_minutes is
  '[DEPRECATED] 구 "주문 후 N분" 방식. 표시 호환용으로만 남긴다 — 정본은 pickup_deadline_at.';

-- 기존 상품 백필: 마감 시각이 없으면 소비기한을 마감으로 본다(소비기한 후 픽업은 무의미).
update public.products
   set pickup_deadline_at = expiry_date
 where pickup_deadline_at is null and expiry_date is not null;

-- 소비기한도 없는 예외 행: 등록 시각 + 1일.
update public.products
   set pickup_deadline_at = created_at + interval '1 day'
 where pickup_deadline_at is null;

-- 소비기한을 넘는 마감은 소비기한으로 클램프(아래 제약 조건 선행 정리).
update public.products
   set pickup_deadline_at = expiry_date
 where expiry_date is not null and pickup_deadline_at > expiry_date;

alter table public.products drop constraint if exists products_pickup_deadline_at_chk;
alter table public.products add constraint products_pickup_deadline_at_chk
  check (pickup_deadline_at is null or expiry_date is null or pickup_deadline_at <= expiry_date);

-- ⚠️ [CRITICAL] 컬럼 단위 UPDATE 권한.
-- products 는 테이블 UPDATE 가 회수되고 컬럼 화이트리스트만 부여된 상태다
-- (20260716000000_admin.sql:421-429). 신규 컬럼을 grant 하지 않으면 판매자앱의
-- 상품 등록/수정이 42501 permission denied 로 실패한다.
grant update (pickup_deadline_at) on public.products to authenticated;

-- 기존 주문 백필(마감이 이미 지난 과거 주문은 알림 대상이 아니므로 발송됨으로 표시).
update public.orders
   set pickup_reminder_sent_at = now()
 where pickup_reminder_sent_at is null
   and (pickup_deadline_at is null or pickup_deadline_at <= now() + interval '30 minutes');

-- 마감 임박 조회용 인덱스(알림 배치 전용 — 미발송 건만).
create index if not exists idx_orders_pickup_reminder
  on public.orders(pickup_deadline_at)
  where pickup_reminder_sent_at is null and seller_status in ('new', 'confirmed');

-- ──────────────────────────────────────────────────────────────────────────────
-- 2) public_products 뷰 — pickup_deadline_at 노출
--    create or replace view 는 '기존 컬럼 순서 불변 + 맨 뒤 추가' 만 허용한다.
--    (20260728000000 에서 pickup_deadline_minutes 를 맨 뒤에 붙였으므로 그 뒤에 이어 붙인다)
-- ──────────────────────────────────────────────────────────────────────────────
create or replace view public.public_products as
  select id, store_id, name, category, emoji, thumbnail, images,
         original_price, sale_price, discount_rate, stock,
         pickup_start, pickup_end, expiry_date, storage, storage_detail,
         description, composition, origin, allergens, cancel_policy,
         store_notice, pickup_address, lat, lng, status, created_at, updated_at,
         pickup_deadline_minutes,
         pickup_deadline_at                          -- ★ 신규(맨 뒤)
    from public.products
   where status = 'selling';
grant select on public.public_products to anon, authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3) 마감 지난 상품 자동 판매중지
--    소비기한(expiry)과 별개로, 픽업 마감이 지난 상품도 더는 팔 수 없다.
--    pause_reason 을 구분해 판매자앱이 안내 문구를 다르게 낼 수 있게 한다.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.expire_products()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- 소비기한 경과
  update public.products
     set status = 'paused', pause_reason = 'expiry'
   where status = 'selling'
     and expiry_date is not null
     and expiry_date < now();

  -- 픽업 마감 경과
  update public.products
     set status = 'paused', pause_reason = 'pickup_closed'
   where status = 'selling'
     and pickup_deadline_at is not null
     and pickup_deadline_at < now();
end; $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4) 픽업 마감 30분 전 알림
--    buyer_notifications INSERT → push_buyer_notification 트리거가 Expo Push 발송.
--    cron 이 5분 주기이므로 실제 발송은 마감 25~30분 전 사이에 이뤄진다.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.send_pickup_reminders()
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  with due as (
    update public.orders o
       set pickup_reminder_sent_at = now()
     where o.pickup_reminder_sent_at is null
       and o.seller_status in ('new', 'confirmed')
       and o.payment_status = 'paid'
       and o.buyer_id is not null
       and o.pickup_deadline_at is not null
       and o.pickup_deadline_at > now()
       and o.pickup_deadline_at <= now() + interval '30 minutes'
    returning o.id, o.buyer_id, o.product_name, o.store_name, o.pickup_deadline_at
  ), ins as (
    insert into public.buyer_notifications
      (buyer_id, type, title, message, reference_type, reference_id)
    select
      d.buyer_id,
      'order',
      '픽업 마감 30분 전',
      d.product_name || ' · ' || coalesce(d.store_name, '매장') || ' 픽업 마감이 '
        || to_char(d.pickup_deadline_at at time zone 'Asia/Seoul', 'HH24:MI')
        || ' 입니다. 지금 출발해주세요!',
      'order',
      d.id
    from due d
    returning 1
  )
  select count(*)::int into v_count from ins;

  return coalesce(v_count, 0);
end; $$;

revoke all on function public.send_pickup_reminders() from public;  -- 배치 전용
revoke all on function public.send_pickup_reminders() from anon;
revoke all on function public.send_pickup_reminders() from authenticated;

-- 5분 주기(이름 기준 재등록 안전). expire_products / reduce_product_prices 와 동일 주기.
select cron.schedule('foodpicker-pickup-reminders', '*/5 * * * *',
  $$select public.send_pickup_reminders();$$);

-- ──────────────────────────────────────────────────────────────────────────────
-- 5) create_order v4 — 마감 '시각' 스냅샷 + 임박 주문 즉시 알림
--    [주의] drop function 금지. 시그니처 동일 create or replace 로만 교체한다
--    (drop 하면 default privileges 로 anon/authenticated 에 execute 가 재부여되어
--     결제 우회 구멍이 생긴다 — 20260724000000 주석 참조).
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
  v_deadline_at  timestamptz;
  v_left_min     integer;
  v_reminded_at  timestamptz := null;
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

  -- [v4] 픽업 마감 시각 — 상품값이 정본. 없으면 소비기한, 그마저 없으면 1시간 뒤.
  v_deadline_at := coalesce(v_prod.pickup_deadline_at, v_prod.expiry_date, v_now + interval '1 hour');
  -- 마감이 지난 상품은 주문 불가(픽업할 수 없는 주문을 만들지 않는다).
  if v_deadline_at <= v_now then
    raise exception 'pickup deadline passed';
  end if;
  -- 하위 호환용 '남은 분'(구 클라이언트 표시). 최소 1분.
  v_left_min := greatest(1, ceil(extract(epoch from (v_deadline_at - v_now)) / 60))::int;

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

  -- 주문 시점에 이미 마감까지 30분 미만이면 사전 알림이 불가능하다 → 즉시 1회 발송하고
  -- 배치가 중복 발송하지 않도록 여기서 발송 시각을 찍는다.
  if v_deadline_at <= v_now + interval '30 minutes' then
    v_reminded_at := v_now;
  end if;

  insert into public.orders
    (seller_id, store_id, product_id, product_name, quantity, store_name, store_address,
     buyer_id, buyer_name, safe_number,
     pickup_start, pickup_end, pickup_deadline_minutes, pickup_deadline_at, pickup_reminder_sent_at,
     payment_status, seller_status, total_price, amount, fee, coupon_id, coupon_discount_amount,
     payment_key, toss_order_id, payment_method)
  values
    (v_prod.seller_id, v_prod.store_id, v_prod.id, v_prod.name, p_quantity, v_store.name, v_store.address,
     v_uid, v_name, '050-0000-0000',
     v_now, v_deadline_at, v_left_min, v_deadline_at, v_reminded_at,
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
          v_prod.name || ' 주문이 접수되었습니다. '
            || to_char(v_deadline_at at time zone 'Asia/Seoul', 'HH24:MI') || ' 까지 픽업해주세요.',
          'order', v_order.id);

  -- 마감 임박 주문: 사전 알림 대신 즉시 안내(사용자 선택 정책).
  if v_reminded_at is not null then
    insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
    values (v_uid, 'order', '픽업 마감 임박',
            v_prod.name || ' · 픽업 마감이 '
              || to_char(v_deadline_at at time zone 'Asia/Seoul', 'HH24:MI')
              || ' (약 ' || v_left_min || '분 뒤) 입니다. 지금 출발해주세요!',
            'order', v_order.id);
  end if;

  return v_order;
end; $$;

revoke all on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) from public;
revoke all on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) from anon;
revoke all on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) from authenticated;
grant execute on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) to service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 6) admin_products 뷰 재생성 — `select p.*` 는 생성 시점에 컬럼이 고정된다.
--    (20260728000000 §8 과 동일 이유 — 신규 pickup_deadline_at 을 관리자웹에 내리려면 필요)
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

-- ──────────────────────────────────────────────────────────────────────────────
-- 확인용
--   select name, pickup_deadline_at, expiry_date, status, pause_reason from public.products;
--   select public.send_pickup_reminders();           -- 수동 1회 실행(발송 건수 반환)
--   select jobname, schedule from cron.job where jobname like 'foodpicker-%';
-- ──────────────────────────────────────────────────────────────────────────────
