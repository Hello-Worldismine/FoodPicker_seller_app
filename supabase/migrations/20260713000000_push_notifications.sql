-- ============================================================================
-- FoodPicker 푸시 알림 (2026-07-11)
--   구매자 알림(buyer_notifications) 생성 시 등록된 기기로 Expo Push 전송.
--   전송은 pg_net(net.http_post)으로 Expo Push API 호출 → Expo 가 FCM/APNs 중계.
--   ※ 원격 푸시 수신은 Expo Go 가 아닌 EAS 개발/프로덕션 빌드 + 실기기에서만 동작.
-- 재실행 안전.
-- ============================================================================

-- HTTP 호출용 확장(이미 활성화돼 있으면 무시)
create extension if not exists pg_net;

-- 기기 푸시 토큰(구매자당 여러 기기 가능)
create table if not exists public.push_tokens (
  id         uuid primary key default gen_random_uuid(),
  buyer_id   uuid not null references auth.users(id) on delete cascade,
  token      text not null unique,
  platform   text,
  updated_at timestamptz not null default now()
);
create index if not exists idx_push_tokens_buyer on public.push_tokens(buyer_id);

alter table public.push_tokens enable row level security;
drop policy if exists push_tokens_all on public.push_tokens;
create policy push_tokens_all on public.push_tokens for all to authenticated
  using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());

-- buyer_notifications INSERT 시 해당 구매자 기기들로 Expo Push 전송
create or replace function public.push_buyer_notification()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare r record;
begin
  for r in select token from public.push_tokens where buyer_id = new.buyer_id loop
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

drop trigger if exists trg_push_buyer_notification on public.buyer_notifications;
create trigger trg_push_buyer_notification
  after insert on public.buyer_notifications
  for each row execute function public.push_buyer_notification();
