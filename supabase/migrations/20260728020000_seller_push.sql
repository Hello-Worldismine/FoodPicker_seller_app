-- ============================================================================
-- FoodPicker 판매자 푸시 알림 (2026-07-28)
--
-- [배경] 관리자 쿠폰 '매장 지정 발급' 요구사항(수정사항 시트 관리자페이지 6행)에
--        "발급시 해당 판매자는 판매자 어플 푸시알림으로 쿠폰 발급 알림을 받게 되고" 가 있다.
--        그런데 푸시 경로가 구매자 전용이었다:
--          · push_tokens 테이블이 buyer_id 전용 (20260713000000_push_notifications.sql:13-21)
--          · Expo Push 트리거가 buyer_notifications INSERT 에만 부착 (같은 파일 :56-59)
--          · 판매자용 notifications 테이블에는 푸시 경로가 아예 없음
--        → 판매자는 앱을 열어 알림 목록을 봐야만 요청을 알 수 있었다.
--
-- [설계] 구매자 쪽 구조(push_tokens + push_buyer_notification)를 그대로 미러링한다.
--        push_tokens.buyer_id 를 nullable 로 바꾸는 대신 별도 테이블을 두어
--        기존 RLS/유니크 제약과 구매자 경로에 전혀 영향을 주지 않는다.
--
-- ※ 원격 푸시 수신은 Expo Go 가 아닌 EAS/dev 빌드 + 실기기에서만 동작한다
--   (20260713000000_push_notifications.sql 주석과 동일 제약).
-- 재실행 안전.
-- ============================================================================

create extension if not exists pg_net;

-- ── 1) 판매자 기기 푸시 토큰 ─────────────────────────────────────────────────
create table if not exists public.seller_push_tokens (
  id         uuid primary key default gen_random_uuid(),
  seller_id  uuid not null references auth.users(id) on delete cascade,
  token      text not null unique,
  platform   text,
  updated_at timestamptz not null default now()
);
create index if not exists idx_seller_push_tokens_seller on public.seller_push_tokens(seller_id);

drop trigger if exists trg_seller_push_tokens_updated on public.seller_push_tokens;
create trigger trg_seller_push_tokens_updated
  before update on public.seller_push_tokens for each row execute function public.set_updated_at();

alter table public.seller_push_tokens enable row level security;
drop policy if exists seller_push_tokens_all on public.seller_push_tokens;
create policy seller_push_tokens_all on public.seller_push_tokens for all to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());
grant select, insert, update, delete on public.seller_push_tokens to authenticated;

-- ── 2) notifications INSERT → 해당 판매자 기기로 Expo Push ────────────────────
-- notifications 는 쿠폰 지정발급 외 주문/정산/리뷰/공지 알림에도 쓰이므로
-- 판매자앱 알림 전반이 함께 푸시된다.
create or replace function public.push_seller_notification()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare r record;
begin
  if new.seller_id is null then return new; end if;

  for r in select token from public.seller_push_tokens where seller_id = new.seller_id loop
    perform net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'to',        r.token,
        'title',     new.title,
        'body',      new.message,
        'sound',     'default',
        'channelId', 'default',
        'priority',  'high',
        'data', jsonb_build_object(
          'type',           new.type,
          'reference_type', new.reference_type,
          'reference_id',   new.reference_id
        )
      )
    );
  end loop;
  return new;
end; $$;

drop trigger if exists trg_push_seller_notification on public.notifications;
create trigger trg_push_seller_notification
  after insert on public.notifications
  for each row execute function public.push_seller_notification();

-- ── 3) Realtime — 판매자앱이 알림을 즉시 수신하도록(이미 추가돼 있으면 무시) ──
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
