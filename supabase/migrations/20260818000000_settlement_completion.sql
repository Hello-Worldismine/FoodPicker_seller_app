-- ============================================================================
-- 20260818000000_settlement_completion.sql
-- 관리자 웹 "정산 관리" 미구현 백엔드 보완
--
--  1) admin_set_settlement_status : 정산예정일(p_settled_on) 지정 + 판매자 알림 발송
--     · notification_type enum 에 'settlement' 이 있는데도 정산 알림을 만드는 코드가
--       플랫폼 어디에도 없었다(판매자는 확정/보류를 앱에서 알 방법이 없었음).
--     · 기존 3-인자 시그니처는 drop 후 재생성(오버로드 모호성 방지). 호출자는 관리자 웹 뿐.
--  1-1) admin_set_settlement_memo : 상태 변경/알림 없이 관리자 메모만 갱신(메모 수정이 오알림을 내지 않게)
--  2) generate_settlements_range : 기간 지정 정산 생성 공통 로직(멱등 — 이미 정산행이 있는 주문은 skip)
--  3) generate_weekly_settlements : platform_settings.settlement_cycle(주간/격주/월간) 반영.
--     · 설정 화면의 '정산 주기' 셀렉트가 실제 배치에 전혀 반영되지 않던 문제 해결.
--     · 함수명/cron 잡 이름(foodpicker-weekly-settlements)은 유지 — cron 재등록 불필요.
--  4) admin_generate_settlements : 관리자가 기간을 지정해 수동으로 정산을 마감(배치 누락 복구).
--  5) default_commission_rate() + stores.commission_rate DEFAULT 연결
--     · platform_settings.default_commission_rate(설정 화면 '수수료율') 이 어디에도 쓰이지
--       않아 신규 매장이 항상 하드코딩 10% 로 생성되던 문제 해결.
--  6) admin_set_store_commission : 매장별 수수료율 변경 RPC(감사 로그 + 판매자 알림).
--     · stores 컬럼 잠금(init §RLS)으로 판매자는 수정 불가, 관리자용 경로도 없었다.
--
-- 멱등 — 재실행 안전.
-- ============================================================================

-- ── 1) 정산 상태 일괄 변경 (정산예정일 지정 + 판매자 알림) ───────────────────
drop function if exists public.admin_set_settlement_status(uuid[], settlement_status, text);

create or replace function public.admin_set_settlement_status(
  p_ids uuid[],
  p_status settlement_status,
  p_memo text default null,
  p_settled_on date default null
) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
  v_rec   record;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  update public.settlements
     set status     = p_status,
         admin_memo = coalesce(p_memo, admin_memo),
         -- 관리자가 정산예정일을 명시하면 그 값으로, 아니면 기존 동작(확정 시 오늘 KST) 유지
         settled_on = case
           when p_settled_on is not null then p_settled_on
           when p_status = 'completed'
             then coalesce(settled_on, (now() at time zone 'Asia/Seoul')::date)
           else settled_on
         end
   where id = any(p_ids);
  get diagnostics v_count = row_count;

  -- 판매자 알림 — 판매자 단위로 1건씩 묶어 발송(정산 행 수만큼 알림이 쏟아지지 않게)
  for v_rec in
    select seller_id,
           count(*)::int               as cnt,
           sum(settlement_amount)::int as total,
           min(period_start)           as p_start,
           max(period_end)             as p_end,
           max(settled_on)             as pay_on
      from public.settlements
     where id = any(p_ids)
     group by seller_id
  loop
    insert into public.notifications (seller_id, type, title, message, reference_type)
    values (
      v_rec.seller_id,
      'settlement',
      case p_status when 'completed' then '정산 확정'
                    when 'on_hold'   then '정산 보류'
                    else '정산예정 전환' end,
      coalesce(to_char(v_rec.p_start, 'MM/DD') || '~' || to_char(v_rec.p_end, 'MM/DD') || ' ', '')
        || '정산 ' || v_rec.cnt || '건('
        || to_char(v_rec.total, 'FM999,999,999,999') || '원)이 '
        || case p_status when 'completed' then '확정되었습니다.'
                         when 'on_hold'   then '보류되었습니다.'
                         else '정산예정 상태로 변경되었습니다.' end
        || case when p_status = 'completed' and v_rec.pay_on is not null
                then ' 정산예정일 ' || to_char(v_rec.pay_on, 'YYYY-MM-DD') || '.'
                else '' end
        || case when p_status = 'on_hold' and coalesce(p_memo, '') <> ''
                then ' 사유: ' || p_memo
                else '' end,
      'settlement'
    );
  end loop;

  perform public.log_admin_action(
    case p_status when 'completed' then '정산 확정'
                  when 'on_hold'   then '정산 보류'
                  else '정산 예정 전환' end,
    'settlement', array_to_string(p_ids, ','),
    coalesce(p_memo, '') || ' (' || v_count || '건'
      || case when p_settled_on is not null
              then ', 정산예정일 ' || to_char(p_settled_on, 'YYYY-MM-DD') else '' end
      || ')');
  return v_count;
end; $$;
revoke all on function public.admin_set_settlement_status(uuid[], settlement_status, text, date) from public;
grant execute on function public.admin_set_settlement_status(uuid[], settlement_status, text, date) to authenticated;

-- ── 1-1) 정산 관리자 메모만 갱신 (상태 변경/알림 없음) ──────────────────────
-- 메모 수정 때문에 판매자에게 "정산 상태 변경" 알림이 잘못 나가지 않도록 별도 경로로 분리한다.
create or replace function public.admin_set_settlement_memo(
  p_ids uuid[], p_memo text
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  update public.settlements set admin_memo = nullif(p_memo, '') where id = any(p_ids);
  get diagnostics v_count = row_count;

  perform public.log_admin_action('정산 메모 수정', 'settlement',
    array_to_string(p_ids, ','), coalesce(p_memo, '') || ' (' || v_count || '건)');
  return v_count;
end; $$;
revoke all on function public.admin_set_settlement_memo(uuid[], text) from public;
grant execute on function public.admin_set_settlement_memo(uuid[], text) to authenticated;

-- ── 2) 기간 지정 정산 생성 공통 로직 (배치/관리자 공용, 멱등) ────────────────
-- 회계식은 20260715(쿠폰 부담) 을 그대로 승계한다.
--   settlement_amount = (결제액 - 수수료) + 본사 보전액
--   coupon_burden     = 쿠폰 할인액 - 본사 보전액 (판매자 부담, 표시용)
create or replace function public.generate_settlements_range(
  p_start date, p_end date, p_pay date
) returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_count integer;
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
    (o.amount - o.fee) + (case
      when o.coupon_id is null or o.coupon_discount_amount = 0 then 0
      when c.cost_bearer = 'platform' then o.coupon_discount_amount
      when c.cost_bearer = 'shared'   then round(o.coupon_discount_amount * coalesce(c.platform_share, 0) / 100.0)
      else 0
    end),
    (case
      when o.coupon_id is null or o.coupon_discount_amount = 0 then 0
      when c.cost_bearer = 'platform' then 0
      when c.cost_bearer = 'shared'   then o.coupon_discount_amount - round(o.coupon_discount_amount * coalesce(c.platform_share, 0) / 100.0)
      else o.coupon_discount_amount
    end),
    'scheduled', p_pay, p_start, p_end
  from public.orders o
  left join public.coupons c on c.id = o.coupon_id
  where o.seller_status = 'completed'
    and o.completed_at is not null
    and (o.completed_at at time zone 'Asia/Seoul')::date between p_start and p_end
    and not exists (select 1 from public.settlements s where s.order_id = o.id);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;
revoke all on function public.generate_settlements_range(date, date, date) from public;  -- 배치/정의자 경유 전용

-- ── 3) 정기 배치 — 정산 주기 설정 반영 ──────────────────────────────────────
-- cron(foodpicker-weekly-settlements)은 매주 수요일 실행되지만, 실제 마감 여부/기간은
-- platform_settings.settlement_cycle 이 결정한다. 마감할 주기가 아니면 0 을 반환하고 끝난다.
create or replace function public.generate_weekly_settlements()
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_mon   date := (date_trunc('week', (now() at time zone 'Asia/Seoul')))::date;  -- 이번 주 월요일
  v_cycle text := coalesce((select settlement_cycle from public.platform_settings where id = 1), 'weekly');
  v_start date;
  v_end   date;
  v_pay   date := (date_trunc('week', (now() at time zone 'Asia/Seoul')))::date + 2;  -- 이번 주 수요일
begin
  if v_cycle = 'monthly' then
    -- 매월 1회 — 그 달의 첫 실행(1~7일)에만 전월 전체를 마감
    if extract(day from v_today)::int > 7 then return 0; end if;
    v_start := (date_trunc('month', v_today) - interval '1 month')::date;
    v_end   := (date_trunc('month', v_today))::date - 1;
  elsif v_cycle = 'biweekly' then
    -- 격주 — ISO 주차가 짝수인 주에만 직전 2주를 한 번에 마감
    if (extract(week from v_today)::int % 2) <> 0 then return 0; end if;
    v_start := v_mon - 14;
    v_end   := v_mon - 1;
  else
    v_start := v_mon - 7;
    v_end   := v_mon - 1;
  end if;

  return public.generate_settlements_range(v_start, v_end, v_pay);
end; $$;
revoke all on function public.generate_weekly_settlements() from public;  -- 배치 전용

-- ── 4) 관리자 수동 정산 생성(기간 지정) ─────────────────────────────────────
create or replace function public.admin_generate_settlements(
  p_start date, p_end date, p_pay date default null
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer; v_pay date;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_start is null or p_end is null then raise exception 'period required'; end if;
  if p_end < p_start then raise exception 'invalid period'; end if;
  if (p_end - p_start) > 93 then raise exception 'period too long (max 94 days)'; end if;

  v_pay   := coalesce(p_pay, (date_trunc('week', (now() at time zone 'Asia/Seoul')))::date + 2);
  v_count := public.generate_settlements_range(p_start, p_end, v_pay);

  perform public.log_admin_action(
    '정산 생성', 'settlement',
    to_char(p_start, 'YYYY-MM-DD') || '~' || to_char(p_end, 'YYYY-MM-DD'),
    v_count || '건 생성(정산예정일 ' || to_char(v_pay, 'YYYY-MM-DD') || ')');
  return v_count;
end; $$;
revoke all on function public.admin_generate_settlements(date, date, date) from public;
grant execute on function public.admin_generate_settlements(date, date, date) to authenticated;

-- ── 5) 기본 수수료율 설정을 신규 매장에 실제 적용 ───────────────────────────
-- platform_settings 는 관리자 전용 RLS 라서 판매자 INSERT 경로에서 읽으려면 security definer 가 필요.
create or replace function public.default_commission_rate()
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce((select ps.default_commission_rate from public.platform_settings ps where ps.id = 1), 10)
$$;
grant execute on function public.default_commission_rate() to authenticated, anon;
alter table public.stores alter column commission_rate set default public.default_commission_rate();

-- ── 6) 매장별 수수료율 변경 RPC ─────────────────────────────────────────────
-- stores 컬럼 권한 잠금(init)으로 판매자는 수정 불가 — 관리자만 이 RPC 로 변경한다.
create or replace function public.admin_set_store_commission(
  p_store_id uuid, p_rate integer
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_row public.stores;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_rate is null or p_rate < 0 or p_rate > 100 then raise exception 'invalid rate'; end if;

  update public.stores set commission_rate = p_rate
   where id = p_store_id
  returning * into v_row;
  if not found then raise exception 'store not found'; end if;

  insert into public.notifications (seller_id, type, title, message, reference_type)
  values (v_row.seller_id, 'settlement', '수수료율 변경 안내',
          '매장 수수료율이 ' || p_rate || '% 로 변경되었습니다. 변경 시점 이후 발생하는 주문부터 적용됩니다.',
          'settlement');

  perform public.log_admin_action('수수료율 변경', 'store', v_row.name, p_rate || '%');
  return p_rate;
end; $$;
revoke all on function public.admin_set_store_commission(uuid, integer) from public;
grant execute on function public.admin_set_store_commission(uuid, integer) to authenticated;

-- ── 검증 쿼리(수동) ─────────────────────────────────────────────────────────
-- select public.admin_generate_settlements(date '2026-08-10', date '2026-08-16');
-- select settlement_code, order_code, status, settled_on, period_start, period_end,
--        amount, fee, refund, coupon_burden, settlement_amount from public.settlements order by created_at desc limit 20;
-- select type, title, message, created_at from public.notifications where type = 'settlement' order by created_at desc limit 10;

-- PostgREST 스키마 캐시 갱신(새 RPC 를 즉시 인식시키기 위함 — 보통 자동이지만 안전장치)
notify pgrst, 'reload schema';
