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
--        CHECK 제약(order/product/settlement/review/notice)이 걸려 있어 'report' 를 그대로
--        못 쓴다. 아래에서 ENUM 값과 CHECK 제약을 추가(기존 값 제거 없음 — 순수 추가)한다.
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
alter table public.notifications drop constraint if exists notifications_ref_chk;
alter table public.notifications add constraint notifications_ref_chk check (
  reference_type is null or reference_type in ('order','product','settlement','review','notice','report'));

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
