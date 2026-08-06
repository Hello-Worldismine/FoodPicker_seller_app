-- ============================================================================
-- orders_pickup_deadline_chk 완화 (2026-08-06)  ★결제 차단 버그 수정★
--
-- [증상] 사용자앱에서 결제 후 주문 생성이 실패한다.
--        "주문 생성에 실패해 결제를 취소했습니다.
--         (new row for relation "orders" violates check constraint
--          "orders_pickup_deadline_chk")"
--        결제 승인은 났다가 toss-confirm 이 되돌리므로 돈은 빠져나가지 않지만,
--        **해당 상품은 아무도 주문할 수 없다.**
--
-- [원인] 제약과 값의 의미가 어긋났다.
--   · 제약(20260728000000:92-94):
--       check (pickup_deadline_minutes is null or pickup_deadline_minutes between 10 and 1440)
--     이 제약을 만들 당시 pickup_deadline_minutes 는 판매자가 직접 고르는 값이었다
--     ('주문 후 N분 이내'). 10분~24시간은 그때 기준으로 타당한 범위였다.
--
--   · 그런데 20260730000000 에서 픽업 마감이 **절대 시각(pickup_deadline_at)** 으로 바뀌었고,
--     create_order 는 주문 시점에 남은 시간을 계산해 이 컬럼에 스냅샷으로 넣는다:
--       v_left_min := greatest(1, ceil(extract(epoch from (v_deadline_at - v_now)) / 60))::int;
--     즉 더 이상 판매자가 고른 값이 아니라 '마감까지 남은 분' 이라는 파생값이다.
--     마감이 이틀 뒤인 상품(소비기한 = 마감인 경우가 대부분)은 3000분이 넘게 나오고,
--     마감 10분 전에 주문하면 10 미만이 나온다. 양쪽 다 제약에 걸린다.
--
--     실측(2026-08-06 17:39 KST): 판매중 상품 8건 중 5건의 pickup_deadline_at 이
--     2026-08-08 23:59 KST 였다 → 약 3260분 → 제약 위반으로 주문 불가 상태였다.
--
-- [해결] 값의 성격이 바뀌었으므로 제약도 그에 맞춘다. 범위 제한을 없애고 양수만 강제한다.
--        clamp(10~1440) 로 막지 않는 이유: 그러면 orders.pickup_deadline_minutes 에
--        '1440분' 같은 **거짓 값**이 저장된다. 이 컬럼을 읽는 구버전 표시 경로가
--        실제와 다른 시간을 보여주게 되므로, 진짜 값을 저장하고 제약을 푸는 편이 옳다.
--        픽업 마감의 정본은 pickup_deadline_at 이고 이 컬럼은 표시 호환용 스냅샷이다.
--
--        ※ stores_pickup_deadline_chk(default_pickup_deadline_minutes, 10~1440)는
--          **그대로 둔다**. 그쪽은 여전히 판매자가 직접 고르는 기본값이라 범위 제한이 유효하다.
--
-- [적용 후] 이미 등록된 상품을 다시 주문해 보면 바로 통과한다. create_order 는 손대지 않았다.
-- 재실행 안전(idempotent).
-- ============================================================================

alter table public.orders drop constraint if exists orders_pickup_deadline_chk;
alter table public.orders add constraint orders_pickup_deadline_chk
  check (pickup_deadline_minutes is null or pickup_deadline_minutes > 0);

comment on column public.orders.pickup_deadline_minutes is
  '주문 시점에 마감까지 남았던 분(파생 스냅샷, 표시 호환용). '
  '정본은 pickup_deadline_at 이다. 판매자가 고른 값이 아니므로 상한을 두지 않는다.';


-- ── 검증 ────────────────────────────────────────────────────────────────────
-- ① 제약이 바뀌었는지
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'orders_pickup_deadline_chk';
--    기대: CHECK (pickup_deadline_minutes IS NULL OR pickup_deadline_minutes > 0)
--
-- ② 지금 주문하면 몇 분으로 계산되는지 — 판매중 상품별 확인
-- select name,
--        pickup_deadline_at,
--        ceil(extract(epoch from (coalesce(pickup_deadline_at, expiry_date) - now())) / 60)::int as left_min
--   from public.public_products
--  order by left_min;
--    참고: 이전 제약에서는 left_min 이 10~1440 을 벗어난 행이 전부 주문 불가였다.
--
-- ③ 기존 주문 중 새 제약을 위반하는 행이 있는지(있으면 위 ALTER 가 실패한다)
-- select count(*) from public.orders where pickup_deadline_minutes is not null
--                                      and pickup_deadline_minutes <= 0;
--    기대: 0
-- ────────────────────────────────────────────────────────────────────────────
