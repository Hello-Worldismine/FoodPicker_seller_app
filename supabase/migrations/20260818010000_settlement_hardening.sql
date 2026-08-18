-- ============================================================================
-- 20260818010000_settlement_hardening.sql
-- 정산 다각도 감사(2026-08-18)에서 확인된 결함 수정. 20260818000000 의 후속.
--
--  1) [SECURITY·CRITICAL] generate_settlements_range / generate_weekly_settlements 가
--     anon·authenticated 에게 EXECUTE 노출된 상태였다. 두 함수는 security definer 인데
--     is_admin() 검사가 없어, 공개 anon 키만 있으면 누구나 정산 행을 생성할 수 있었다.
--     원인: `revoke all ... from public` 만 했는데 Supabase 는 public 스키마 함수에
--     alter default privileges 로 anon/authenticated 에 EXECUTE 를 자동 부여한다
--     (`from public` 은 이 역할별 명시 grant 를 제거하지 못한다).
--     → 역할을 명시해 revoke + 함수 내부에 PostgREST 경유 호출 차단 가드를 이중으로 건다.
--     (검증: has_function_privilege('anon', oid, 'EXECUTE') 가 true 였음)
--
--  2) [회계] admin_refund_order 가 status='scheduled' 정산행만 차감해 왔다.
--     관리자 화면의 보류 사유 1순위가 '환불 분쟁 확인 필요' 라 '보류 → 환불 → 보류해제 → 확정'
--     이 정상 업무 흐름인데, 이 흐름에서 환불액이 정산에서 빠지지 않아 과지급이 났다.
--     또 순매출(amount-fee)만 빼서 쿠폰 본사 보전분이 정산액에 남았다.
--     → 판매자 취소 경로(_apply_order_full_refund, 20260731)와 동일하게
--       status <> 'completed' 행을 fee/platform_fee/pg_fee/settlement_amount = 0 으로 정리.
--     → 이미 'completed'(지급 완료) 인 행은 금액을 건드리지 않되 admin_memo 에 회수 필요를
--       남기고 감사 로그에 건수를 기록한다(자동 차감은 불가 — 수동 회수 대상).
--
--  3) [정합성] admin_set_settlement_status 에 p_from_status 가드 추가.
--     관리자 웹은 판매자×기간 그룹 단위로 처리하는데, 한 그룹에 상태가 섞이면(예: 임시 마감 후
--     주간 배치가 같은 기간에 행을 추가) 그룹의 모든 행 id 가 무필터로 넘어와
--     이미 지급 완료된 행의 settled_on 이 덮이고 판매자에게 중복 금액 알림이 나갔다.
--     → 지정 시 해당 상태 행만 갱신하고, 알림/로그도 '실제로 바뀐 행' 기준으로 집계한다.
--
--  4) [경계] 격주(biweekly) 판정이 ISO 주차 패리티라 53주차 연도(2026 포함)의 연말·연초에서
--     홀수 주가 연달아 나와 한 주가 통째로 누락됐다. → 고정 에폭 기준 14일 주기로 교체.
--
--  5) [시한폭탄] settlements.settlement_code 기본값의 lpad(...,3) 은 PostgreSQL 에서
--     3자리를 넘는 문자열을 '절단'한다. 1000번째 정산에서 'ST-100' 이 되어 unique 위반 →
--     정산 생성 배치 전체가 실패한다. → 이미 존재하는 fmt_seq_code() 로 교체.
--
--  6) [정정 경로] 잘못 생성된 정산 행을 되돌릴 방법이 없었다(멱등 가드가 order_id 기준이라
--     재생성으로도 교정 불가). → admin_delete_settlements RPC(지급 완료 건 제외, 사유 필수).
--
-- 멱등 — 재실행 안전.
-- ============================================================================

-- ── 1) 배치 전용 함수 권한 회수 + 내부 가드 ─────────────────────────────────
-- PostgREST(REST API) 경유 호출이면 request.jwt.claims 가 세팅된다. pg_cron 등 DB 내부
-- 호출에는 없다. 즉 "API 로 들어온 호출은 관리자만" 이라는 뜻이며, 권한 회수가 어떤 이유로
-- 되돌아가도(마이그레이션 재적용 실수 등) 심층 방어가 남는다.
create or replace function public.generate_settlements_range(
  p_start date, p_end date, p_pay date
) returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  if current_setting('request.jwt.claims', true) is not null and not public.is_admin() then
    raise exception 'admin only';
  end if;

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
revoke all on function public.generate_settlements_range(date, date, date) from public, anon, authenticated;

-- ── 2) 정기 배치 — 격주 판정을 고정 에폭 기준으로 교체 + 권한 회수 ──────────
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
  if current_setting('request.jwt.claims', true) is not null and not public.is_admin() then
    raise exception 'admin only';
  end if;

  if v_cycle = 'monthly' then
    -- 매월 1회 — 그 달의 첫 실행(1~7일)에만 전월 전체를 마감
    if extract(day from v_today)::int > 7 then return 0; end if;
    v_start := (date_trunc('month', v_today) - interval '1 month')::date;
    v_end   := (date_trunc('month', v_today))::date - 1;
  elsif v_cycle = 'biweekly' then
    -- 격주 — 고정 에폭(2026-01-05 월)부터 14일 주기. ISO 주차 패리티는 53주차 연도(2026 등)의
    -- 연말·연초에서 홀수 주가 연달아 나와 한 주를 통째로 건너뛰므로 쓰지 않는다.
    if mod(abs((v_mon - date '2026-01-05') / 7), 2) <> 0 then return 0; end if;
    v_start := v_mon - 14;
    v_end   := v_mon - 1;
  else
    v_start := v_mon - 7;
    v_end   := v_mon - 1;
  end if;

  return public.generate_settlements_range(v_start, v_end, v_pay);
end; $$;
revoke all on function public.generate_weekly_settlements() from public, anon, authenticated;

-- ── 3) 주문 환불 — 보류 정산 반영 + 쿠폰 보전분까지 정리 ────────────────────
create or replace function public.admin_refund_order(p_order_id uuid, p_reason text default null)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_row  public.orders;
  v_paid integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into v_row from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_row.payment_status = 'refunded' then raise exception 'already refunded'; end if;

  update public.orders
     set payment_status = 'refunded',
         seller_status  = 'cancelled',
         cancel_reason  = coalesce(p_reason, cancel_reason)
   where id = p_order_id
  returning * into v_row;

  -- 미지급 정산(정산예정 + 보류) 전액 정리. 판매자 취소 경로(_apply_order_full_refund)와 동일한
  -- 술어·결과를 쓴다 — 순매출만 빼던 기존 식은 쿠폰 본사 보전분을 남겨 정산액이 0 이 되지 않았다.
  update public.settlements
     set refund            = v_row.amount,
         fee               = 0,
         platform_fee      = 0,
         pg_fee            = 0,
         settlement_amount = 0
   where order_id = v_row.id and status <> 'completed' and refund = 0;

  -- 이미 지급 완료된 정산은 금액을 건드리지 않는다(회계상 소급 불가) — 대신 회수 대상임을 남긴다.
  update public.settlements
     set admin_memo = case when coalesce(admin_memo, '') = '' then '' else admin_memo || ' / ' end
                      || '[환불 발생] ' || v_row.order_code || ' ' || v_row.amount
                      || '원 환불 — 지급 완료된 정산이라 자동 차감되지 않음. 수동 회수 필요.'
   where order_id = v_row.id and status = 'completed';
  get diagnostics v_paid = row_count;

  if v_row.buyer_id is not null then
    insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
    values (v_row.buyer_id, 'order', '환불 처리 완료',
            v_row.product_name || ' 주문(' || v_row.order_code || ')이 환불 처리되었습니다.',
            'order', v_row.id);
  end if;
  insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
  values (v_row.seller_id, 'cancel', '주문 환불 처리',
          v_row.order_code || ' 주문이 관리자에 의해 환불 처리되었습니다.', 'order', v_row.id);

  perform public.log_admin_action('주문 환불', 'order', v_row.order_code,
    coalesce(p_reason, '')
    || case when v_paid > 0
            then ' ⚠ 지급완료 정산 ' || v_paid || '건은 자동 차감 불가(수동 회수 필요)'
            else '' end);
  return v_row;
end; $$;
revoke all on function public.admin_refund_order(uuid, text) from public, anon;
grant execute on function public.admin_refund_order(uuid, text) to authenticated;

-- ── 4) 정산 상태 변경 — 원천 상태 가드 + '실제로 바뀐 행' 기준 알림/로그 ────
drop function if exists public.admin_set_settlement_status(uuid[], settlement_status, text, date);

create or replace function public.admin_set_settlement_status(
  p_ids uuid[],
  p_status settlement_status,
  p_memo text default null,
  p_settled_on date default null,
  p_from_status settlement_status default null   -- 지정 시 이 상태인 행만 변경(혼합 그룹 보호)
) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_changed uuid[];
  v_count   integer;
  v_rec     record;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  with upd as (
    update public.settlements
       set status     = p_status,
           admin_memo = coalesce(p_memo, admin_memo),
           settled_on = case
             when p_settled_on is not null then p_settled_on
             when p_status = 'completed'
               then coalesce(settled_on, (now() at time zone 'Asia/Seoul')::date)
             else settled_on
           end
     where id = any(p_ids)
       and (p_from_status is null or status = p_from_status)
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_changed from upd;
  v_count := coalesce(array_length(v_changed, 1), 0);
  if v_count = 0 then return 0; end if;

  -- 판매자 알림 — 실제로 바뀐 행만, 판매자 단위로 1건씩
  for v_rec in
    select seller_id,
           count(*)::int               as cnt,
           sum(settlement_amount)::int as total,
           min(period_start)           as p_start,
           max(period_end)             as p_end,
           max(settled_on)             as pay_on
      from public.settlements
     where id = any(v_changed)
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
                  when 'on_hold' then '정산 보류'
                  else '정산 예정 전환' end,
    'settlement', array_to_string(v_changed, ','),
    coalesce(p_memo, '') || ' (' || v_count || '건'
      || case when p_settled_on is not null
              then ', 정산예정일 ' || to_char(p_settled_on, 'YYYY-MM-DD') else '' end
      || case when array_length(p_ids, 1) > v_count
              then ', 상태 불일치로 제외 ' || (array_length(p_ids, 1) - v_count) || '건' else '' end
      || ')');
  return v_count;
end; $$;
revoke all on function public.admin_set_settlement_status(uuid[], settlement_status, text, date, settlement_status) from public, anon;
grant execute on function public.admin_set_settlement_status(uuid[], settlement_status, text, date, settlement_status) to authenticated;

-- ── 5) 정산 코드 발번 절단 방지 ─────────────────────────────────────────────
-- lpad(x, 3, '0') 은 3자리 초과 문자열을 '절단'한다: lpad('1000',3,'0') = '100'.
-- 1000번째 정산에서 기존 'ST-100' 과 충돌해 unique 위반 → 정산 생성이 영구 실패한다.
-- fmt_seq_code(20260716) 는 999 이하만 0패딩하고 그 이상은 그대로 둔다.
alter table public.settlements
  alter column settlement_code set default ('ST-' || public.fmt_seq_code(nextval('settlement_code_seq')));

-- ── 6) 잘못 생성된 정산 행 삭제(정정용) ─────────────────────────────────────
-- 지급 완료(completed) 건은 삭제 불가 — 회계 기록을 지우지 않는다.
-- 삭제하면 해당 주문은 멱등 가드(order_id)에서 풀려 재생성 대상이 된다.
create or replace function public.admin_delete_settlements(
  p_ids uuid[], p_reason text
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason required'; end if;

  delete from public.settlements
   where id = any(p_ids) and status <> 'completed';
  get diagnostics v_count = row_count;

  perform public.log_admin_action('정산 행 삭제', 'settlement',
    array_to_string(p_ids, ','), p_reason || ' (' || v_count || '건 삭제)');
  return v_count;
end; $$;
revoke all on function public.admin_delete_settlements(uuid[], text) from public, anon;
grant execute on function public.admin_delete_settlements(uuid[], text) to authenticated;

-- ── 검증 쿼리(수동) ─────────────────────────────────────────────────────────
-- 1) 권한이 실제로 닫혔는지:
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('generate_settlements_range','generate_weekly_settlements');
--    -- 둘 다 false 여야 한다.
-- 2) 코드 발번 기본값:
-- select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
--   join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
--  where d.adrelid = 'public.settlements'::regclass and a.attname = 'settlement_code';

notify pgrst, 'reload schema';
