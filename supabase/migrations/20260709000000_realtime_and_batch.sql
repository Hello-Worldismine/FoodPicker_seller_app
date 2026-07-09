-- ============================================================================
-- FoodPicker 후속작업 (2026-07-09) — 실시간 · 매장 승인 워크플로 · 정산 배치
--   1) Realtime 발행(supabase_realtime)에 판매자 테이블 추가 → 앱 실시간 수신
--   2) 매장 민감정보 변경 시 approval_status='pending' 자동 전환 트리거(§9 승인 워크플로)
--   3) 주간 정산 자동 생성 함수 + pg_cron (전주 완료주문 → settlements)
-- 모두 재실행 안전.
-- ============================================================================

-- ── 1) Realtime 발행 대상 추가 ────────────────────────────────────────────
-- postgres_changes 는 RLS를 따르므로 각 판매자는 '본인 행' 이벤트만 수신한다.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['orders','notifications','products','reviews','settlements','stores'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ── 2) 매장 승인 워크플로 트리거 ──────────────────────────────────────────
-- 판매자가 민감정보(상호/사업자번호/주민번호/주소/계좌/서류)를 변경하면 자동으로
-- approval_status='pending' 으로 전환한다. approval_status 는 판매자 쓰기 잠금이라
-- 앱은 이 컬럼을 보내지 못하지만, BEFORE UPDATE 트리거는 NEW 를 직접 설정할 수 있다.
-- (기존 stamp_order_status / refresh_store_rating 트리거와 동일 패턴)
create or replace function public.flag_store_reapproval()
returns trigger language plpgsql as $$
begin
  if (   new.name            is distinct from old.name
      or new.biz_number      is distinct from old.biz_number
      or new.resident_number is distinct from old.resident_number
      or new.address         is distinct from old.address
      or new.bank_name       is distinct from old.bank_name
      or new.account_number  is distinct from old.account_number
      or new.account_holder  is distinct from old.account_holder
      or new.biz_cert_image  is distinct from old.biz_cert_image)
     -- 플랫폼이 approval_status 를 명시적으로 바꾸는 UPDATE(승인/반려)는 존중(덮어쓰지 않음)
     and new.approval_status = old.approval_status
  then
    new.approval_status := 'pending';
  end if;
  return new;
end; $$;

drop trigger if exists trg_stores_reapproval on public.stores;
create trigger trg_stores_reapproval
  before update on public.stores for each row
  execute function public.flag_store_reapproval();

-- ── 3) 주간 정산 자동 생성 ────────────────────────────────────────────────
-- 전주(월~일, KST) 완료 주문을 집계해 settlements 를 생성한다(미생성분만).
-- 수수료 분해는 시드 관례(플랫폼:PG = 8:2)를 따른다.
create or replace function public.generate_weekly_settlements()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_start date := (date_trunc('week', (now() at time zone 'Asia/Seoul') - interval '7 days'))::date; -- 지난주 월
  v_end   date := v_start + 6;                                                                        -- 지난주 일
  v_pay   date := (date_trunc('week', (now() at time zone 'Asia/Seoul')))::date + 2;                  -- 이번주 수요일(지급예정)
  v_count integer;
begin
  insert into public.settlements
    (seller_id, store_id, order_id, order_code, product_name,
     amount, fee, platform_fee, pg_fee, refund, settlement_amount,
     status, settled_on, period_start, period_end)
  select
    o.seller_id, o.store_id, o.id, o.order_code, o.product_name,
    o.amount, o.fee,
    round(o.fee * 0.8), o.fee - round(o.fee * 0.8),   -- 플랫폼:PG = 8:2 (시드 관례)
    0, o.amount - o.fee,
    'scheduled', v_pay, v_start, v_end
  from public.orders o
  where o.seller_status = 'completed'
    and o.completed_at is not null
    and (o.completed_at at time zone 'Asia/Seoul')::date between v_start and v_end
    and not exists (select 1 from public.settlements s where s.order_id = o.id);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

revoke all on function public.generate_weekly_settlements() from public;  -- 배치/서버 전용

-- 매주 수요일 00:00 UTC(=09:00 KST) 실행. (재등록 안전 — 이름 기준 갱신)
select cron.schedule('foodpicker-weekly-settlements', '0 0 * * 3',
  $$select public.generate_weekly_settlements();$$);
