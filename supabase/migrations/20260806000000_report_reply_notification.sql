-- ============================================================================
-- FoodPicker 1:1 문의 답변 알림 (2026-08-06)
--
-- [배경] 관리자 웹(ReportManagement.tsx)이 답변 등록 시 이미 report_logs 에
--        kind='reply' 행을 INSERT 하고 있다(admin 이 report_logs_admin_insert 정책으로
--        직접 insert 가능 — 신규 RPC 불필요). 하지만 지금은 그 INSERT 가 문의자에게
--        아무 알림도 트리거하지 않아, 구매자/판매자 앱에서 "답변이 왔는지" 확인할 방법이
--        폴링(직접 들어가 새로고침)뿐이었다.
--
-- [설계] report_logs AFTER INSERT(kind='reply') 트리거를 추가해 기존 알림 인프라에
--        그대로 편승시킨다:
--          · 문의자가 구매자(inquirer_type='buyer') → buyer_notifications insert
--            → 기존 trg_push_buyer_notification(20260713000000) 이 자동으로 Expo Push 전송
--          · 문의자가 판매자(inquirer_type='seller') → notifications insert
--            → 기존 trg_push_seller_notification(20260728020000) 이 자동으로 Expo Push 전송
--        즉 관리자 웹/기존 알림 파이프라인 코드는 전혀 손대지 않고, 새 트리거 하나만 얹는다.
--
-- [주의] notifications(판매자용) 은 type 이 notification_type ENUM, reference_type 에
--        CHECK 제약이 걸려 있어 'report' 를 그대로 못 쓴다.
--        ★ 현행 허용 목록은 init 의 (order/product/settlement/review/notice) 가 아니라
--          20260716000000_admin.sql:413-417 이 'coupon' 을 더한
--          (order/product/settlement/review/notice/coupon) 이다(그 마이그레이션은 DB 적용 완료).
--          아래 2) 는 그 목록에 'report' 만 더해 재생성한다 — 기존 값 제거 없음(순수 추가).
--        buyer_notifications 는 컬럼이 자유 text 라 별도 조치가 필요 없다.
--
-- ⚠️ 이 파일은 아직 Supabase 에 적용되지 않았습니다. 반드시 SQL Editor 등에서
--    직접 실행해야 실제로 동작합니다(관리자 웹/판매자 앱/사용자 앱 코드는 이미 이 트리거가
--    있다는 전제로 작성돼 있습니다 — 즉 실행 전까지는 답변 등록은 되지만 푸시는 안 갑니다).
-- 재실행 안전.
-- ============================================================================

-- ── 1) notification_type ENUM 에 문의 답변용 값 추가 ────────────────────────
alter type public.notification_type add value if not exists 'inquiry_reply';

-- ── 2) notifications.reference_type CHECK 제약에 'report' 추가 ─────────────
-- ★★ 'coupon' 을 절대 빼지 마라 ★★
--   이 제약은 drop 후 '전체 목록을 다시 쓰는' 방식이라, 한 값이라도 누락하면 그대로 회귀가 된다.
--   'coupon' 은 20260716000000_admin.sql:413-417 이 추가한 값이고 그 사유가 주석에 남아 있다
--   ("쿠폰 승인/반려 알림이 reference_type='coupon' 을 쓰는데 허용 목록에 없어 23514 로 실패").
--   여기서 'coupon' 을 지우면 두 가지가 동시에 깨진다:
--     (a) 이 문장 자체가 실패 — 운영 DB 의 notifications 에 reference_type='coupon' 인 기존 행이
--         하나라도 있으면 ADD CONSTRAINT 가 23514 로 거부되고, SQL Editor 는 파일을 한 트랜잭션으로
--         돌리므로 아래 3) 의 답변 알림 트리거까지 통째로 롤백된다(= 이 마이그레이션의 목적이 무산).
--     (b) 통과하더라도 쿠폰 기능이 죽는다 — notify_coupon_offer(20260722010000:56-67, 매장 지정 쿠폰
--         발급 요청)와 notify_coupon_decision(20260714000000:106-116 / 20260722010000:82-100,
--         쿠폰 승인·반려)이 reference_type='coupon' 으로 INSERT 한다. 둘 다 coupons 의
--         AFTER INSERT/UPDATE 트리거라 트리거 예외가 곧 coupons INSERT/UPDATE 롤백이 되고,
--         관리자 웹의 '매장 지정 쿠폰 발급'과 '쿠폰 승인/반려' 자체가 동작 불능이 된다.
--   ⇒ 이 목록을 다시 손댈 사람은 반드시 '기존 값 전부 + 새 값' 으로 쓸 것.
alter table public.notifications drop constraint if exists notifications_ref_chk;
alter table public.notifications add constraint notifications_ref_chk check (
  reference_type is null
  or reference_type in ('order','product','settlement','review','notice','coupon','report'));

-- ── 3) report_logs(kind='reply') INSERT → 문의자에게 알림 생성 ──────────────
-- new.message 에는 관리자 웹이 붙이는 "답변 등록: " 접두어가 그대로 들어있는데,
-- 앱에서 노출할 알림 본문은 접두어를 떼고 보여주는 게 자연스러워 정규식으로 제거한다.
create or replace function public.notify_report_reply()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_report public.reports;
  v_body   text;
begin
  if new.kind <> 'reply' then return new; end if;

  select * into v_report from public.reports where id = new.report_id;
  if not found or v_report.reporter_id is null then return new; end if;

  v_body := left(regexp_replace(new.message, '^답변 등록:\s*', ''), 120);

  if v_report.inquirer_type = 'buyer' then
    insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
    values (v_report.reporter_id, 'inquiry_reply', '문의 답변이 도착했어요', v_body, 'report', v_report.id);
  elsif v_report.inquirer_type = 'seller' then
    insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
    values (v_report.reporter_id, 'inquiry_reply'::public.notification_type, '문의 답변이 도착했어요', v_body, 'report', v_report.id);
  end if;

  return new;
end; $$;

drop trigger if exists trg_notify_report_reply on public.report_logs;
create trigger trg_notify_report_reply
  after insert on public.report_logs
  for each row execute function public.notify_report_reply();

-- ── 4) [정합화] push_tokens(구매자)를 seller_push_tokens 와 같은 정의로 맞춘다 ──
-- ※ 테이블 신설이 아니다. public.push_tokens 는 이미 존재한다
--   (20260713000000_push_notifications.sql:13-25, DB 적용 완료).
--   구매자 판(20260713000000)에는 seller 판(20260728020000:33-41)에 있는
--   set_updated_at 트리거와 명시적 grant 가 빠져 있다. 현재도 동작은 한다
--   (클라이언트 push.js 가 updated_at 을 직접 실어 보내고, Supabase default privileges 가
--    authenticated 에 grant 를 걸어 주기 때문) — 하지만 두 테이블 정의가 달라
--   운영/이관/감사 때 "왜 한쪽만 있지?" 로 시간을 쓰게 된다. 여기서 맞춰 둔다.
create index if not exists idx_push_tokens_buyer on public.push_tokens(buyer_id);

drop trigger if exists trg_push_tokens_updated on public.push_tokens;
create trigger trg_push_tokens_updated
  before update on public.push_tokens for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.push_tokens to authenticated;

-- ============================================================================
-- [사전 진단] 적용 '전' 에 아래를 먼저 돌려 보면, 위 2) 에서 'coupon' 을 유지해야 하는
--   근거가 숫자로 나온다. 1건이라도 나오면 'coupon' 이 빠진 버전은 23514 로 확실히 실패한다.
--
--   select count(*) from public.notifications where reference_type = 'coupon';
--
-- [검증] 적용 '후' 에 아래 4가지를 확인한다.
--
-- ① CHECK 제약 정의 — 출력에 coupon 과 report 가 '둘 다' 보여야 한다.
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.notifications'::regclass and conname = 'notifications_ref_chk';
--
-- ② ENUM 값 — 목록에 inquiry_reply 가 있어야 한다.
--   select enum_range(null::public.notification_type);
--
-- ③ 트리거 3종 부착 — 3행이 나와야 한다.
--    trg_notify_report_reply(report_logs) / trg_push_buyer_notification(buyer_notifications)
--    / trg_push_seller_notification(notifications)
--   select tgname, tgrelid::regclass as table_name
--     from pg_trigger
--    where not tgisinternal
--      and tgname in ('trg_notify_report_reply',
--                     'trg_push_buyer_notification',
--                     'trg_push_seller_notification')
--    order by tgname;
--
-- ④ 푸시 토큰 적재 현황 — 0행이면 그 앱은 푸시가 '절대' 오지 않는다.
--    seller_push_tokens 는 판매자앱 app.json 에 EAS projectId 가 없어 현재 0행일 것이다
--    (eas init → app.json extra.eas.projectId 기입 → dev build 설치 후 재확인).
--   select 'push_tokens' as tbl, count(*) from public.push_tokens
--   union all
--   select 'seller_push_tokens', count(*) from public.seller_push_tokens;
-- ============================================================================
