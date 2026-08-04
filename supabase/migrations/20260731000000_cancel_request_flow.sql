-- ============================================================================
-- FoodPicker 주문 취소: '구매자 요청 → 판매자 승인 → 수수료 0원 전액 환불' (2026-07-31)
--
-- [배경] 지금은 '요청' 이라는 개념이 DB 에 없다.
--   · 구매자앱이 toss-cancel(PG 전액취소) → cancel_my_order 를 연속 호출해 **즉시** 취소한다
--     (FoodPicker_customer_app/src/lib/api.js:250-277). 시간 제한도 판매자 개입도 없다.
--   · 판매자앱 '취소요청' 탭은 seller_status='cancelled'(이미 취소 확정) 주문을 보여주고,
--     '취소 승인' 버튼은 같은 값을 다시 쓰는 no-op 이다(src/screens/Orders.jsx:133,330-347).
--
-- [설계 결정] order_seller_status enum 을 확장하지 않는다.
--   ① alter type ... add value 는 같은 트랜잭션에서 새 값을 쓸 수 없어(부분 인덱스/백필/함수 검증)
--      '단일 파일 재실행 안전' 마이그레이션 스타일과 충돌한다.
--   ② 세 클라이언트가 seller_status 를 키로 하는 라벨맵을 갖고 있어(판매자앱 ORDER_SELLER_STATUS,
--      사용자앱 ORDER_STATUS, 관리자웹 ORDER_STATUS_KO) 미지의 값이 오면 라벨이 깨지고
--      판매자앱 탭 필터에서 주문이 사라진다. 앱은 아직 재빌드되지 않았다.
--   ③ 취소요청은 상태 전이가 아니라 new/confirmed 주문에 붙는 '플래그'다 — 거절되면
--      원래 상태로 그대로 돌아가야 한다.
--   → 별도 컬럼(cancel_request_status ...) 으로 표현한다. 구버전 클라이언트에는
--     요청 중인 주문이 계속 '신규주문/픽업대기' 로 보이고, 승인된 뒤에야 'cancelled' 가 된다.
--
-- [수수료 0원 100% 환불의 의미]
--   · 구매자 환불: toss-cancel 은 cancelAmount 없이 호출하는 **전액 취소**라 PG 만으로 충족된다.
--   · 판매자 수수료: settlements 는 seller_status='completed' 주문만 집계하므로
--     (20260715000000_coupon_checkout.sql:159-162) 취소건은 애초 정산행이 생기지 않는다.
--     그래도 orders.fee 가 남으면 판매자앱 '정산 정보' 패널이 수수료를 표시하고 회계가 흐려지므로
--     승인 시 fee=0 / refund_amount=amount 를 기록하고, 예외적으로 이미 존재하는 정산행은
--     방어적으로 0 원화한다(멱등: refund=0 인 행만).
--
-- [취소 경로가 둘이라는 점] 판매자는 ① 구매자 취소요청 승인(respond_order_cancel) 과
--   ② 자발 취소(seller_cancel_order, 판매자앱 [주문 취소]) 두 경로로 주문을 취소한다.
--   둘 다 결과는 '수수료 0원 전액 환불' 로 같아야 하므로 기록 로직은 공통 내부 함수
--   _apply_order_full_refund(§3-1) 하나뿐이고 두 RPC 가 그것을 호출한다.
--   (경로별로 UPDATE 를 복붙했다가 자발 취소만 payment_status/fee/refund_* 를 못 쓰는
--    사고가 났다 — 컬럼 화이트리스트 때문에 클라이언트 직접 UPDATE 로는 불가능하다.)
--
-- [컬럼 단위 권한] orders 는 authenticated 에 (seller_status, cancel_reason) 만 UPDATE 가 허용된다
--   (20260706000000_init.sql:490-493). 아래 신규 컬럼에는 **의도적으로 grant 하지 않는다** —
--   요청/승인 기록은 security definer RPC 만 수행해야 위조가 불가능하다.
--   (구매자는 orders UPDATE 정책 자체가 없다 — 20260707000000_followups.sql:115-118)
--
-- 선행: 20260730000000_pickup_deadline_at.sql 적용 후 실행한다.
-- 재실행 안전(idempotent). drop function 금지 — create or replace 만 사용한다.
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 0) 선행 마이그레이션 결함 보정 — products_pause_chk 확장
--    20260730000000_pickup_deadline_at.sql:103-108 의 expire_products() 가
--    pause_reason = 'pickup_closed' 를 쓰는데, init 의 체크 제약은 ('expiry','manual') 만
--    허용한다(20260706000000_init.sql:144). 그대로 두면 5분 주기 cron
--    foodpicker-expire-products 가 매번 23514 로 롤백되어 **소비기한 만료 상품까지**
--    판매중지되지 않는다(같은 트랜잭션이라 앞의 expiry UPDATE 도 함께 취소됨).
--    본 파일이 20260730000000 바로 다음 순번이라 여기서 함께 보정한다.
-- ──────────────────────────────────────────────────────────────────────────────
alter table public.products drop constraint if exists products_pause_chk;
alter table public.products add constraint products_pause_chk
  check (pause_reason is null or pause_reason in ('expiry', 'manual', 'pickup_closed'));

comment on column public.products.pause_reason is
  '판매중지 사유: expiry(소비기한 경과) / pickup_closed(픽업 마감 경과) / manual(수동).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 1) orders: 취소요청/환불 컬럼
-- ──────────────────────────────────────────────────────────────────────────────
alter table public.orders add column if not exists cancel_request_status  text;
alter table public.orders add column if not exists cancel_requested_at    timestamptz;
alter table public.orders add column if not exists cancel_request_reason  text;
alter table public.orders add column if not exists cancel_responded_at    timestamptz;
alter table public.orders add column if not exists cancel_response_reason text;
alter table public.orders add column if not exists refund_amount          integer not null default 0;
alter table public.orders add column if not exists refunded_at            timestamptz;

alter table public.orders drop constraint if exists orders_cancel_req_status_chk;
alter table public.orders add constraint orders_cancel_req_status_chk
  check (cancel_request_status is null
         or cancel_request_status in ('requested', 'approved', 'rejected'));

alter table public.orders drop constraint if exists orders_refund_amount_chk;
alter table public.orders add constraint orders_refund_amount_chk
  check (refund_amount >= 0);

comment on column public.orders.cancel_request_status is
  '구매자 취소요청 상태: null(요청없음) / requested(판매자 승인 대기) / approved / rejected. '
  'seller_status 를 건드리지 않는 플래그라 구버전 클라이언트 호환.';
comment on column public.orders.cancel_requested_at is
  '취소요청 시각. 요청 가능 여부는 ordered_at + cancel_request_window() 로 판정한다.';
comment on column public.orders.cancel_request_reason is  '구매자가 입력한 취소 사유(선택).';
comment on column public.orders.cancel_responded_at is    '판매자 승인/거절 시각.';
comment on column public.orders.cancel_response_reason is '판매자 승인/거절 사유(거절 시 구매자에게 노출).';
comment on column public.orders.refund_amount is
  '실제 환불 금액(원). 취소요청 승인 시 amount 전액 — 수수료 차감 없음(fee 는 0 으로 기록).';
comment on column public.orders.refunded_at is '환불 확정 시각(판매자 승인 시점).';

-- 판매자앱 '취소요청' 탭 조회용 부분 인덱스(대기 건만).
create index if not exists idx_orders_cancel_requested
  on public.orders(seller_id, cancel_requested_at desc)
  where cancel_request_status = 'requested';

-- ⚠️ 신규 컬럼에 grant update 를 주지 않는다(위 [컬럼 단위 권한] 참조).
--    orders 는 테이블 UPDATE 가 회수된 상태라, 나중에 추가된 컬럼은 자동으로 권한이 없다.
--    아래 RPC 는 security definer 라 함수 소유자 권한으로 기록하므로 grant 가 불필요하다.

-- ──────────────────────────────────────────────────────────────────────────────
-- 2) 취소 요청 가능 시간 정책 (요구사항: 주문 후 10분 이내)
--    기준을 confirmed_at 이 아니라 ordered_at 으로 잡는다 — confirmed_at 은 판매자가
--    '주문 확인' 을 눌러야만 찍히고(안 누르면 null) QR 픽업 시 뒤늦게 채워지기 때문
--    (20260728000000_pickup_deadline_geo_qr_paymethod.sql:389-392).
--    정책이 바뀌면 이 함수 하나만 고친다.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_request_window()
returns interval language sql immutable set search_path = pg_catalog
as $$ select interval '10 minutes' $$;
revoke all on function public.cancel_request_window() from public;
grant execute on function public.cancel_request_window() to anon, authenticated;

comment on function public.cancel_request_window() is
  '구매자 취소 요청 허용 시간(ordered_at 기준). 정책 변경 시 이 함수만 수정한다.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3) 구매자: 취소 요청 (PG 환불은 하지 않는다 — 판매자 승인 시점에 실행)
--    예외 메시지는 클라이언트 분기를 위해 대문자 상수로 고정한다(complete_pickup 규약과 동일).
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.request_order_cancel(
  p_order_code text,
  p_reason     text default null
) returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid  uuid        := auth.uid();
  v_code text        := upper(trim(coalesce(p_order_code, '')));
  v_now  timestamptz := now();
  v_o    public.orders;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if v_code = ''   then raise exception 'INVALID_CODE';      end if;

  -- 딥링크/공백이 섞여도 FP-#### 패턴만 추출(complete_pickup 과 동일 규칙).
  if v_code !~ '^FP-[0-9]+$' then
    v_code := coalesce((regexp_match(v_code, '(FP-[0-9]+)'))[1], v_code);
  end if;

  -- 동시 요청 직렬화(중복 요청/판매자 승인과의 경합 방지)
  select * into v_o from public.orders where order_code = v_code for update;
  if not found                                     then raise exception 'ORDER_NOT_FOUND';  end if;
  if v_o.buyer_id is null or v_o.buyer_id <> v_uid then raise exception 'NOT_MY_ORDER';     end if;
  if v_o.seller_status = 'cancelled'               then raise exception 'ALREADY_CANCELLED'; end if;
  if v_o.seller_status = 'completed'               then raise exception 'ALREADY_COMPLETED'; end if;
  if v_o.payment_status <> 'paid'                  then raise exception 'NOT_PAID';          end if;
  if v_o.cancel_request_status = 'requested'       then raise exception 'ALREADY_REQUESTED'; end if;
  if v_now > v_o.ordered_at + public.cancel_request_window() then
    raise exception 'WINDOW_EXPIRED';
  end if;

  -- seller_status 를 건드리지 않으므로 stamp_order_status(before update of seller_status)는
  -- 발동하지 않는다 → cancelled_at 이 잘못 찍히지 않는다.
  update public.orders
     set cancel_request_status  = 'requested',
         cancel_requested_at    = v_now,
         cancel_request_reason  = nullif(btrim(coalesce(p_reason, '')), ''),
         cancel_responded_at    = null,
         cancel_response_reason = null
   where id = v_o.id
  returning * into v_o;

  -- 판매자 알림 → notifications INSERT 트리거가 Expo Push 발송(20260728020000_seller_push.sql).
  insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
  values (v_o.seller_id, 'cancel', '취소 요청',
          v_o.order_code || ' · ' || v_o.product_name ||
          ' 주문에 취소 요청이 접수되었습니다. 승인하시면 수수료 없이 전액 환불됩니다.' ||
          coalesce(' 사유: ' || v_o.cancel_request_reason, ''),
          'order', v_o.id);

  insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
  values (v_uid, 'order', '취소 요청 접수',
          v_o.product_name || ' 주문의 취소를 요청했습니다. 판매자 승인 후 결제금액 전액이 환불됩니다.',
          'order', v_o.id);

  return v_o;
end; $$;
revoke all on function public.request_order_cancel(text, text) from public;
revoke all on function public.request_order_cancel(text, text) from anon;
grant execute on function public.request_order_cancel(text, text) to authenticated;

comment on function public.request_order_cancel(text, text) is
  '구매자 주문 취소 요청. ordered_at + cancel_request_window() 이내에만 허용하며 PG 환불은 하지 않는다.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3-1) 공통 내부 함수: '수수료 0원 전액 환불' 기록 (승인 경로 · 자발 취소 경로 공용)
--    판매자가 주문을 취소하는 경로는 두 가지다.
--      ① 구매자 취소요청 승인 — respond_order_cancel(p_approve := true)
--      ② 판매자 자발 취소     — seller_cancel_order()
--    두 경로가 각자 UPDATE 를 복붙하면 DB 상태가 갈라진다(실제로 그렇게 사고가 났다:
--    자발 취소만 payment_status/fee/refund_* 를 못 써서 '돈은 나갔는데 장부는 결제완료').
--    → 기록 로직은 이 함수 하나뿐이고 두 경로 모두 여기를 호출한다. 수정도 여기서만 한다.
--
--    ⚠️ 이 함수는 **권한 검사를 하지 않는다**. 호출자(위 두 RPC)가 판매자 본인 여부와
--       상태 조건을 먼저 검증해야 한다. 그래서 외부 execute 는 전량 회수한다.
--    멱등: 이미 seller_status='cancelled' 면 아무것도 하지 않고 현재 행을 돌려준다
--          (재고/쿠폰 이중 복구 방지).
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public._apply_order_full_refund(
  p_order_id uuid,
  p_reason   text default null
) returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_now      timestamptz := now();
  v_reason   text        := nullif(btrim(coalesce(p_reason, '')), '');
  v_amount   integer;
  v_had_req  boolean;      -- 지금 '승인 대기 중인' 취소요청을 마감하는 건인가(알림 문구/마감 처리 분기)
  v_o        public.orders;
begin
  -- 호출자가 이미 for update 로 잠갔더라도 같은 트랜잭션이라 재잠금은 안전하다.
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  -- 멱등: 이미 취소 처리된 건은 그대로 반환(PG 취소 성공 후 RPC 재시도 복구 경로).
  if v_o.seller_status = 'cancelled' then return v_o; end if;
  if v_o.seller_status = 'completed' then raise exception 'ALREADY_COMPLETED'; end if;

  v_amount  := v_o.amount;
  -- ⚠️ 'requested' 일 때만 참이다. 'rejected'(한 번 거절한 뒤 판매자가 스스로 취소하는 경우)를
  --    포함시키면 자발 취소가 '취소 요청 승인' 으로 잘못 기록되고, 구매자에게도
  --    '취소 승인' 알림이 나가 사실과 어긋난다. null 비교이므로 is not distinct from 을 쓴다.
  v_had_req := v_o.cancel_request_status is not distinct from 'requested';

  -- cancelled_at 은 stamp_order_status 트리거가 자동 기록한다(20260706000000_init.sql:375-388).
  -- fee=0: 취소건에는 플랫폼 수수료를 부과하지 않는다(요구사항).
  -- 승인 대기 중인 요청을 마감하는 경우에만 'approved' 로 바꾸고,
  -- 자발 취소(null)나 이미 거절된 건('rejected')은 기존 값을 그대로 보존한다.
  update public.orders
     set seller_status          = 'cancelled',
         payment_status         = 'refunded',
         cancel_request_status  = case when v_had_req then 'approved' else v_o.cancel_request_status end,
         cancel_responded_at    = case when v_had_req then v_now      else v_o.cancel_responded_at end,
         cancel_response_reason = case when v_had_req then v_reason   else v_o.cancel_response_reason end,
         -- 구매자가 적은 요청 사유는 '그 요청을 승인하는' 경우에만 사유로 승계한다.
         -- 자발 취소에까지 끌어다 쓰면 판매자가 쓴 적 없는 사유가 기록된다.
         cancel_reason          = coalesce(
                                    v_reason,
                                    case when v_had_req then v_o.cancel_request_reason end,
                                    case when v_had_req
                                         then '구매자 취소요청 · 판매자 승인(수수료 면제 전액 환불)'
                                         else '판매자 주문 취소(수수료 면제 전액 환불)' end),
         fee                    = 0,
         refund_amount          = v_amount,
         refunded_at            = v_now
   where id = v_o.id
  returning * into v_o;

  -- 재고 복구(sync_product_stock_status 트리거가 soldout→selling 을 자동 복원한다).
  if v_o.product_id is not null then
    update public.products set stock = stock + v_o.quantity where id = v_o.product_id;
  end if;

  -- 쿠폰 복구 — cancel_my_order 에는 없던 처리.
  -- 한계: orders.coupon_id 는 create_order 가 '첫 번째 쿠폰'만 스냅샷하므로 중복 사용 건은
  --       1장만 복구된다. 다중 쿠폰 복구가 필요하면 order_coupons 이력 테이블이 선행돼야 한다.
  if v_o.coupon_id is not null and v_o.buyer_id is not null then
    update public.user_coupons
       set is_used = false, used_at = null
     where buyer_id = v_o.buyer_id and coupon_id = v_o.coupon_id and is_used;
  end if;

  -- 정산 방어 처리(정상 흐름에서는 취소건에 정산행이 없다 — generate_weekly_settlements 는
  -- completed 만 집계. 관리자 상태 조작 등 예외 경로 대비. refund=0 조건으로 이중 차감 방지).
  update public.settlements
     set refund            = v_amount,
         fee               = 0,
         platform_fee      = 0,
         pg_fee            = 0,
         settlement_amount = 0
   where order_id = v_o.id and status <> 'completed' and refund = 0;

  -- 알림(양쪽). 요청 승인인지 판매자 자발 취소인지에 따라 문구만 다르다.
  if v_o.buyer_id is not null then
    insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
    values (v_o.buyer_id, 'order',
            case when v_had_req then '취소 승인 · 환불 완료' else '주문 취소 · 환불 완료' end,
            v_o.product_name || ' 주문(' || v_o.order_code || ')이 ' ||
            case when v_had_req then '취소되었습니다. ' else '판매자에 의해 취소되었습니다. ' end ||
            '결제금액 ' || to_char(v_amount, 'FM999,999,999') || '원 전액이 환불됩니다(수수료 차감 없음).' ||
            coalesce(' 사유: ' || v_reason, ''),
            'order', v_o.id);
  end if;

  insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
  values (v_o.seller_id, 'cancel',
          case when v_had_req then '취소 승인 처리' else '주문 취소 처리' end,
          v_o.order_code || ' 주문' ||
          case when v_had_req then '의 취소를 승인했습니다. ' else '을 취소했습니다. ' end ||
          '전액 환불되었으며 수수료는 부과되지 않습니다.',
          'order', v_o.id);

  return v_o;
end; $$;

-- 내부(definer) 전용 — 권한 검사가 없으므로 외부 execute 를 전량 회수한다.
revoke all on function public._apply_order_full_refund(uuid, text) from public;
revoke all on function public._apply_order_full_refund(uuid, text) from anon;
revoke all on function public._apply_order_full_refund(uuid, text) from authenticated;
revoke all on function public._apply_order_full_refund(uuid, text) from service_role;

comment on function public._apply_order_full_refund(uuid, text) is
  '[내부 전용] 주문 취소 = 수수료 0원 전액 환불 기록(상태/환불/재고/쿠폰/정산/알림). '
  'respond_order_cancel 승인 분기와 seller_cancel_order 가 공유한다. 권한 검사는 호출자 책임.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4) 판매자: 취소 요청 승인/거절
--    ⚠️ 호출 순서 규약(관리자웹 refundOrder / 구버전 사용자앱과 동일): **PG 취소 먼저, 이 RPC 나중**.
--       반대로 하면 'DB 는 취소인데 돈은 안 돌아간 상태'가 된다.
--       PG 성공 후 이 RPC 가 실패하면 주문은 cancel_request_status='requested' 로 남아
--       판매자앱 취소요청 탭에 계속 보이고, toss-cancel 은 ALREADY_CANCELED_PAYMENT 를 성공으로
--       처리하므로 승인 버튼 재시도로 복구된다. 그래서 아래 승인 분기는 멱등이어야 한다.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.respond_order_cancel(
  p_order_code text,
  p_approve    boolean,
  p_reason     text default null
) returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid    uuid        := auth.uid();
  v_code   text        := upper(trim(coalesce(p_order_code, '')));
  v_now    timestamptz := now();
  v_reason text        := nullif(btrim(coalesce(p_reason, '')), '');
  v_o      public.orders;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if v_code = ''   then raise exception 'INVALID_CODE';      end if;
  if v_code !~ '^FP-[0-9]+$' then
    v_code := coalesce((regexp_match(v_code, '(FP-[0-9]+)'))[1], v_code);
  end if;

  select * into v_o from public.orders where order_code = v_code for update;
  if not found              then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_o.seller_id <> v_uid then raise exception 'NOT_MY_ORDER';    end if;

  -- 멱등: 이미 승인 완료된 건에 같은 승인이 다시 오면 현재 행을 그대로 돌려준다.
  if v_o.cancel_request_status = 'approved' and v_o.seller_status = 'cancelled' then
    if p_approve then return v_o; else raise exception 'ALREADY_APPROVED'; end if;
  end if;
  if v_o.cancel_request_status is distinct from 'requested' then
    raise exception 'NO_PENDING_REQUEST';
  end if;

  -- ── 거절 ──────────────────────────────────────────────────────────────────
  if not p_approve then
    update public.orders
       set cancel_request_status  = 'rejected',
           cancel_responded_at    = v_now,
           cancel_response_reason = v_reason
     where id = v_o.id
    returning * into v_o;

    if v_o.buyer_id is not null then
      insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
      values (v_o.buyer_id, 'order', '취소 요청 거절',
              v_o.product_name || ' 주문의 취소 요청이 거절되었습니다.' ||
              coalesce(' 사유: ' || v_reason, '') || ' 픽업 시간을 확인해주세요.',
              'order', v_o.id);
    end if;
    return v_o;
  end if;

  -- ── 승인 = 수수료 없는 100% 환불 ──────────────────────────────────────────
  -- ALREADY_COMPLETED 는 공통 함수도 검사하지만, 예외 계약을 이 함수 본문에 남겨둔다.
  if v_o.seller_status = 'completed' then raise exception 'ALREADY_COMPLETED'; end if;

  -- 기록은 전부 공통 함수에 위임한다(seller_cancel_order 와 동일한 코드 = 동일한 DB 상태).
  -- cancel_request_status='requested' 이므로 공통 함수가 'approved' 로 마감하고
  -- cancel_responded_at / cancel_response_reason 도 함께 기록한다.
  return public._apply_order_full_refund(v_o.id, v_reason);
end; $$;
revoke all on function public.respond_order_cancel(text, boolean, text) from public;
revoke all on function public.respond_order_cancel(text, boolean, text) from anon;
grant execute on function public.respond_order_cancel(text, boolean, text) to authenticated;

comment on function public.respond_order_cancel(text, boolean, text) is
  '판매자 취소요청 승인/거절. 승인은 PG 전액취소(Edge Function toss-cancel) 성공 후에 호출한다 — '
  'PG 먼저, DB 나중. 승인 분기는 멱등이며 기록은 _apply_order_full_refund 에 위임한다.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4-1) 판매자: 자발 주문 취소 (구매자 취소요청이 없는 건)
--    판매자앱 OrderDetail 의 [주문 취소] 버튼 경로다. 예전에는 orders 를 직접 UPDATE 했지만
--    authenticated 의 컬럼 화이트리스트가 (seller_status, cancel_reason) 뿐이라
--    payment_status/fee/refund_* 를 쓸 수 없었다 → PG 는 환불, 장부는 '결제완료 · 수수료 부과'.
--    이제 승인 경로와 **같은 공통 함수**를 호출해 두 경로의 DB 상태가 완전히 일치한다.
--
--    ⚠️ 호출 순서 규약은 승인 경로와 동일하다: **PG 전액취소(toss-cancel) 먼저, 이 RPC 나중**.
--       PG 성공 후 이 RPC 가 실패하면 주문은 그대로 남아 재시도로 복구되고,
--       toss-cancel 은 ALREADY_CANCELED_PAYMENT 를 성공으로 처리하므로 재시도가 막히지 않는다.
--    멱등: 이미 seller_status='cancelled' 면 현재 행을 그대로 반환한다.
--    예외: NOT_AUTHENTICATED / INVALID_CODE / ORDER_NOT_FOUND / NOT_MY_ORDER /
--          ALREADY_COMPLETED / NOT_CANCELLABLE
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.seller_cancel_order(
  p_order_code text,
  p_reason     text default null
) returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_code   text := upper(trim(coalesce(p_order_code, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_o      public.orders;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if v_code = ''   then raise exception 'INVALID_CODE';      end if;
  if v_code !~ '^FP-[0-9]+$' then
    v_code := coalesce((regexp_match(v_code, '(FP-[0-9]+)'))[1], v_code);
  end if;

  -- 구매자 취소요청/판매자 승인과의 경합 방지(공통 함수도 같은 행을 다시 잠근다).
  select * into v_o from public.orders where order_code = v_code for update;
  if not found                                       then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_o.seller_id is null or v_o.seller_id <> v_uid then raise exception 'NOT_MY_ORDER';    end if;

  -- 멱등: 이미 취소된 주문은 현재 행 그대로(PG 취소 성공 후 재시도 복구 경로).
  if v_o.seller_status = 'cancelled' then return v_o; end if;
  if v_o.seller_status = 'completed' then raise exception 'ALREADY_COMPLETED'; end if;
  if v_o.seller_status not in ('new', 'confirmed') then raise exception 'NOT_CANCELLABLE'; end if;

  -- 승인 대기 중인 취소요청('requested')이 걸려 있었다면 공통 함수가 'approved' 로 함께 마감한다
  -- (판매자가 요청을 승인하는 것과 결과가 같으므로 요청을 미결로 남기지 않는다).
  -- 이미 거절한 요청('rejected')은 그대로 보존한다 — 이 취소는 승인이 아니라 판매자의 자발 취소다.
  -- 사유 미입력 시 공통 함수가 기본 문구('판매자 주문 취소(수수료 면제 전액 환불)')를 넣는다.
  return public._apply_order_full_refund(v_o.id, v_reason);
end; $$;
revoke all on function public.seller_cancel_order(text, text) from public;
revoke all on function public.seller_cancel_order(text, text) from anon;
grant execute on function public.seller_cancel_order(text, text) to authenticated;

comment on function public.seller_cancel_order(text, text) is
  '판매자 자발 주문 취소(수수료 0원 전액 환불). PG 전액취소 성공 후 호출한다 — PG 먼저, DB 나중. '
  '기록은 respond_order_cancel 승인 분기와 동일한 _apply_order_full_refund 를 사용한다. 멱등.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 5) cancel_my_order 를 '요청 생성' 위임 shim 으로 교체
--    구버전 사용자앱(재빌드 전)이 이 RPC 로 즉시 취소하는 경로를 막는다.
--    [주의] drop function 금지 — create or replace 로만 교체해야 기존 grant 가 보존된다.
--    구버전 앱은 이 RPC 앞에 toss-cancel 을 먼저 호출하는데, toss-cancel 의 구매자 분기를
--    함께 제거해야(같은 배포에서) '돈은 나갔는데 주문은 살아있는' 상태가 생기지 않는다.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_my_order(p_order_code text)
returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  -- 2026-07-31: 즉시 취소 → '취소 요청' 으로 전환. 실제 취소/환불은 판매자 승인
  -- (respond_order_cancel) 시점에 이뤄진다.
  return public.request_order_cancel(p_order_code, '구매자 취소 요청');
end; $$;
revoke all on function public.cancel_my_order(text) from public;
revoke all on function public.cancel_my_order(text) from anon;
grant execute on function public.cancel_my_order(text) to authenticated;

comment on function public.cancel_my_order(text) is
  '[DEPRECATED] 구버전 사용자앱 호환 shim. 즉시 취소하지 않고 request_order_cancel 로 위임한다.';

-- ============================================================================
-- 운영 유틸 SQL (전부 주석 — 실행 여부는 운영자가 판단한다)
-- ============================================================================

-- ── [U1] 테스트 상품 소생 ────────────────────────────────────────────────────
--   증상: 사용자앱 홈/지도가 비어 있다. 원인은 public_products(= status='selling' 뷰)가 0행이라서다.
--   pg_cron(foodpicker-expire-products, 5분)이 소비기한(expiry_date) 또는
--   픽업 마감(pickup_deadline_at)이 지난 상품을 status='paused' 로 내린다.
--   ⚠️ 소비기한은 실제 식품 안전 정보다. 아래는 **개발/테스트 데이터 전용**이다.
--
--   -- (1) 진단: 왜 안 보이는지 먼저 확인
--   -- select id, name, status, pause_reason, stock, expiry_date, pickup_deadline_at
--   --   from public.products
--   --  order by (status = 'selling') desc, updated_at desc;
--   -- select count(*) as public_rows from public.public_products;
--
--   -- (2) 소생: 소비기한/픽업 마감을 미래로 밀고 판매중으로 복구.
--   --     stock > 0 조건 필수 — 재고 0 이면 sync_product_stock_status 트리거가 즉시 soldout 으로 되돌린다.
--   --     pickup_deadline_at <= expiry_date 제약(products_pickup_deadline_at_chk)을 지키려고
--   --     마감을 소비기한보다 앞에 둔다.
--   -- update public.products
--   --    set expiry_date        = now() + interval '7 days',
--   --        pickup_deadline_at = now() + interval '6 days',
--   --        status             = 'selling',
--   --        pause_reason       = null
--   --  where status = 'paused'
--   --    and pause_reason in ('expiry', 'pickup_closed')
--   --    and stock > 0;
--
--   -- (3) 검증: 사용자앱이 실제로 읽는 뷰
--   -- select id, name, status, expiry_date, pickup_deadline_at from public.public_products;

-- ── [U2] 대기 중인 취소요청 조회 ─────────────────────────────────────────────
--   판매자앱 '취소요청' 탭이 보게 되는 집합과 동일하다.
--   -- select order_code, store_name, product_name, amount,
--   --        seller_status, payment_status,
--   --        cancel_requested_at, cancel_request_reason,
--   --        ordered_at + public.cancel_request_window() as request_deadline
--   --   from public.orders
--   --  where cancel_request_status = 'requested'
--   --  order by cancel_requested_at desc;

-- ── [U3] 취소 결과 검증(수수료 0 / 전액 환불) ────────────────────────────────
--   승인 경로(cancel_request_status='approved')와 판매자 자발 취소(null) 를 함께 본다.
--   -- select order_code, seller_status, payment_status, amount, fee,
--   --        cancel_request_status, refund_amount, refunded_at, cancelled_at, cancel_reason
--   --   from public.orders
--   --  where refunded_at is not null
--   --  order by refunded_at desc;
--   -- 기대: seller_status='cancelled', payment_status='refunded', fee=0, refund_amount=amount,
--   --       refunded_at/cancelled_at 이 모두 채워져 있음.
--
--   -- 정산 방어 처리 결과(정상 흐름이면 0행이 정상이다)
--   -- select s.settlement_code, s.order_code, s.status, s.amount, s.fee, s.refund, s.settlement_amount
--   --   from public.settlements s
--   --   join public.orders o on o.id = s.order_id
--   --  where o.cancel_request_status = 'approved';

-- ── [U4] 신규 컬럼 권한 확인 ─────────────────────────────────────────────────
--   기대: seller_status, cancel_reason 두 컬럼만 나와야 한다.
--   cancel_request_* / refund_* 가 목록에 보이면 어딘가에서 grant 가 새어 나온 것이다.
--   -- select column_name, privilege_type
--   --   from information_schema.column_privileges
--   --  where table_schema = 'public' and table_name = 'orders'
--   --    and grantee = 'authenticated' and privilege_type = 'UPDATE'
--   --  order by column_name;
--
--   -- RPC 실행 권한 확인(authenticated 에만 execute 여야 한다.
--   --  단 _apply_order_full_refund 는 내부 전용이라 authenticated 가 없어야 한다)
--   -- select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--   --        p.prosecdef as security_definer, p.proacl
--   --   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   --  where n.nspname = 'public'
--   --    and p.proname in ('request_order_cancel', 'respond_order_cancel', 'seller_cancel_order',
--   --                      'cancel_request_window', 'cancel_my_order', '_apply_order_full_refund');
-- ============================================================================
