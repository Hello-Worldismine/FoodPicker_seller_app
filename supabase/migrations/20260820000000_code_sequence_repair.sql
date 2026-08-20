-- ============================================================================
-- 20260820000000_code_sequence_repair.sql
-- 주문 코드 발번 충돌 수정 — "duplicate key value violates unique constraint
-- \"orders_order_code_key\"" 로 결제 직후 주문 생성이 실패하던 문제.
--
-- [원인]
--   orders.order_code 의 기본값은 'FP-' || nextval('order_code_seq') 이고
--   order_code_seq 는 1000 부터 시작한다(init:39,182).
--   그런데 개발 시드(seed_dev.sql:85~)가 order_code 를 **명시값으로** 넣는다
--   (FP-1018 ~ FP-1024, 7건). 명시 삽입은 시퀀스를 진행시키지 않으므로
--   시퀀스는 1000 에 머문 채 FP-1018 이 이미 점유된 상태가 된다.
--   → 실주문이 18건째에 도달하는 순간 FP-1018 부터 FP-1024 까지
--     **7건 연속으로 unique 위반**이 나고, create_order 가 롤백되며
--     앱은 결제를 취소한다(사용자에게는 "어떤 주문은 되고 어떤 주문은 안 되는"
--     간헐적 실패로 보인다 — nextval 은 롤백돼도 되돌아가지 않아 재시도마다
--     다음 번호로 넘어가고, 1025 에 닿으면 다시 성공하기 때문).
--
--   같은 구조의 시한폭탄이 두 곳 더 있다.
--     · settlements.settlement_code — 시드 ST-001~003 점유, 시퀀스는 1.
--       정산 생성 배치가 첫 3건에서 unique 위반으로 통째로 실패한다.
--     · notices.notice_code — 시드 NC-001~003 점유, 시퀀스는 1.
--
-- [수정]
--   1) 세 시퀀스를 기존 데이터의 최대 번호 위로 보정(setval).
--   2) 주문·정산 코드는 발번 함수로 감싸 **이미 존재하는 코드는 건너뛰게** 한다.
--      시드를 다시 넣거나 코드를 수동 삽입해 시퀀스가 또 어긋나도
--      결제·정산 배치가 실패하지 않는다.
--      (notices 는 관리자 수동 작성이라 실패해도 즉시 재시도로 끝나므로 보정만 한다.)
--
-- 멱등 — 재실행 안전.
-- ============================================================================

-- ── 1) 시퀀스 보정 ──────────────────────────────────────────────────────────
-- 코드에서 숫자만 뽑아 최대값을 구한다. 형식이 다른 과거 값이 섞여 있어도
-- 숫자 부분만 보면 되고, 행이 하나도 없으면 시퀀스 시작값을 유지한다.
do $$
declare v_max bigint;
begin
  select coalesce(max(nullif(regexp_replace(order_code, '\D', '', 'g'), '')::bigint), 0)
    into v_max from public.orders;
  if v_max >= (select last_value from public.order_code_seq) then
    perform setval('public.order_code_seq', v_max);   -- 다음 nextval = v_max + 1
  end if;

  select coalesce(max(nullif(regexp_replace(settlement_code, '\D', '', 'g'), '')::bigint), 0)
    into v_max from public.settlements;
  if v_max >= (select last_value from public.settlement_code_seq) then
    perform setval('public.settlement_code_seq', v_max);
  end if;

  select coalesce(max(nullif(regexp_replace(notice_code, '\D', '', 'g'), '')::bigint), 0)
    into v_max from public.notices;
  if v_max >= (select last_value from public.notice_code_seq) then
    perform setval('public.notice_code_seq', v_max);
  end if;
end $$;

-- ── 2) 충돌을 건너뛰는 발번 함수 ────────────────────────────────────────────
-- security definer 인 이유: 시퀀스 usage 가 authenticated 에서 회수돼 있고(init:506),
-- 기본값 표현식은 INSERT 를 실행하는 롤의 권한으로 평가되기 때문이다.
-- 동시성: nextval 은 원자적이라 동시 트랜잭션은 애초에 서로 다른 번호를 받는다.
-- 여기서 거르는 것은 '이미 커밋된 명시 삽입 행'과의 충돌뿐이다.
create or replace function public.next_order_code()
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_code text; v_i int := 0;
begin
  loop
    v_code := 'FP-' || nextval('public.order_code_seq');
    exit when not exists (select 1 from public.orders o where o.order_code = v_code);
    v_i := v_i + 1;
    -- 정상 상태라면 시드가 점유한 몇 건만 건너뛴다. 1000 을 넘으면 데이터가
    -- 예상과 다른 것이므로 무한 루프 대신 실패시켜 원인을 드러낸다.
    if v_i > 1000 then raise exception 'order_code allocation failed after % attempts', v_i; end if;
  end loop;
  return v_code;
end; $$;
revoke all on function public.next_order_code() from public, anon, authenticated;

create or replace function public.next_settlement_code()
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_code text; v_i int := 0;
begin
  loop
    v_code := 'ST-' || public.fmt_seq_code(nextval('public.settlement_code_seq'));
    exit when not exists (select 1 from public.settlements s where s.settlement_code = v_code);
    v_i := v_i + 1;
    if v_i > 1000 then raise exception 'settlement_code allocation failed after % attempts', v_i; end if;
  end loop;
  return v_code;
end; $$;
revoke all on function public.next_settlement_code() from public, anon, authenticated;

alter table public.orders      alter column order_code      set default public.next_order_code();
alter table public.settlements alter column settlement_code set default public.next_settlement_code();

-- ── 3) notices.notice_code 의 lpad 절단 제거 ────────────────────────────────
-- 20260818010000 이 settlement_code 에서 고친 것과 같은 결함이 여기 남아 있었다.
-- lpad('1000', 3, '0') = '100' — 1000번째 공지가 기존 NC-100 과 충돌해 unique 위반이 난다.
-- 발번 자체는 관리자 수동 작성 경로라 스킵 함수까지는 두지 않고 포맷터만 교체한다.
alter table public.notices
  alter column notice_code set default ('NC-' || public.fmt_seq_code(nextval('notice_code_seq')));

-- ── 검증 쿼리(수동) ─────────────────────────────────────────────────────────
-- 시퀀스가 데이터보다 앞서 있는지:
--   select last_value from order_code_seq;
--   select max(nullif(regexp_replace(order_code,'\D','','g'),'')::bigint) from orders;
-- 발번이 점유 구간을 건너뛰는지(값만 뽑아보고 롤백):
--   begin; select public.next_order_code(); rollback;   -- 주의: nextval 은 롤백되지 않는다
