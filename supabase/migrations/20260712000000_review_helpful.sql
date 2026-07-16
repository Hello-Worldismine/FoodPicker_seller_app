-- ============================================================================
-- FoodPicker 리뷰 '도움돼요' 투표 (2026-07-11)
--   helpful_count 는 여러 사용자가 공유하는 카운터이므로 서버에서 관리.
--   구매자당 리뷰 1회 토글(중복 방지) + reviews.helpful_count 증감.
-- 재실행 안전.
-- ============================================================================

create table if not exists public.review_helpful (
  id         uuid primary key default gen_random_uuid(),
  buyer_id   uuid not null references auth.users(id) on delete cascade,
  review_id  uuid not null references public.reviews(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint review_helpful_uq unique (buyer_id, review_id)
);
create index if not exists idx_review_helpful_buyer on public.review_helpful(buyer_id);

alter table public.review_helpful enable row level security;
drop policy if exists review_helpful_select on public.review_helpful;
create policy review_helpful_select on public.review_helpful for select to authenticated
  using (buyer_id = auth.uid());
-- insert/delete 는 toggle_review_helpful (security definer) 로만.

-- 토글: 내 투표가 있으면 취소(카운트 -1), 없으면 추가(카운트 +1). 새 상태 반환.
create or replace function public.toggle_review_helpful(p_review_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_voted boolean;
  v_count integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  if exists (select 1 from public.review_helpful where buyer_id = v_uid and review_id = p_review_id) then
    delete from public.review_helpful where buyer_id = v_uid and review_id = p_review_id;
    update public.reviews set helpful_count = greatest(0, helpful_count - 1)
      where id = p_review_id returning helpful_count into v_count;
    v_voted := false;
  else
    insert into public.review_helpful (buyer_id, review_id) values (v_uid, p_review_id);
    update public.reviews set helpful_count = helpful_count + 1
      where id = p_review_id returning helpful_count into v_count;
    v_voted := true;
  end if;

  return jsonb_build_object('helpful_count', coalesce(v_count, 0), 'voted', v_voted);
end; $$;
revoke all on function public.toggle_review_helpful(uuid) from public;
grant execute on function public.toggle_review_helpful(uuid) to authenticated;
