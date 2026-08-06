-- ============================================================================
-- FoodPicker 카테고리 아이콘 이미지 + 쿠폰 매장 지정 발급 (2026-07-22)
--   A) categories.image_url 컬럼 + 'category-icons' 스토리지 버킷
--      (공개 읽기 / 관리자 쓰기 — 20260716 banner-images 패턴)
--   B) 쿠폰 매장 지정 발급 플로우 (관리자 → 판매자 수락)
--      관리자가 seller_id 지정 + request_status='pending' + is_active=false 로 발행
--      → 판매자에게 'coupon_assigned' 알림(트리거)
--      → 판매자가 respond_coupon_offer 로 수락/거절
--      → 수락 시 request_status='approved' + is_active=true 가 되어
--        store_coupons 게이트(is_active + approved)를 통과, 사용자 앱 매장
--        페이지에 노출. 거절 시 rejected + 비활성 유지.
-- 재실행 안전.
-- ============================================================================

-- ── 1) 카테고리 아이콘 이미지 ───────────────────────────────────────────────
-- 아이콘 이미지 URL. null 이면 기존 이모지(icon) 폴백.
alter table public.categories add column if not exists image_url text;

-- Storage: 카테고리 아이콘 버킷 (공개 읽기 / 관리자 쓰기, 5MB, 이미지+SVG)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('category-icons', 'category-icons', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/svg+xml'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "category_icons_public_read"  on storage.objects;
drop policy if exists "category_icons_admin_insert" on storage.objects;
drop policy if exists "category_icons_admin_update" on storage.objects;
drop policy if exists "category_icons_admin_delete" on storage.objects;
create policy "category_icons_public_read"
  on storage.objects for select using (bucket_id = 'category-icons');
create policy "category_icons_admin_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'category-icons' and public.is_admin());
create policy "category_icons_admin_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'category-icons' and public.is_admin());
create policy "category_icons_admin_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'category-icons' and public.is_admin());

-- ── 2) notification_type 값 추가 ────────────────────────────────────────────
alter type public.notification_type add value if not exists 'coupon_assigned';

-- ── 3) 매장 지정 발급 시 판매자 알림 (관리자 INSERT → 자동 발송) ────────────
--   coupons 에 source='admin' + seller_id 지정 + request_status='pending' 행이
--   INSERT 되면 해당 판매자에게 수락 요청 알림.
create or replace function public.notify_coupon_offer()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.source = 'admin' and new.seller_id is not null and new.request_status = 'pending' then
    insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
    values (
      new.seller_id,
      'coupon_assigned'::public.notification_type,
      '매장 지정 쿠폰 발급 요청',
      new.name || ' 쿠폰('
        || (case when new.discount_type = 'amount'
                 then new.discount_value || '원 할인'
                 else new.discount_value || '% 할인'
                      || coalesce(' · 최대 ' || new.max_discount_amount || '원', '') end)
        || ') 발급이 요청되었습니다. 수락하면 사용자 앱 매장 페이지에 노출됩니다.',
      'coupon', new.id
    );
  end if;
  return new;
end; $$;

drop trigger if exists trg_notify_coupon_offer on public.coupons;
create trigger trg_notify_coupon_offer
  after insert on public.coupons
  for each row execute function public.notify_coupon_offer();

-- ── 4) notify_coupon_decision 재정의 (source='seller' 가드 추가) ────────────
--   관리자 지정 쿠폰(source='admin')을 판매자가 수락/거절하면 request_status 가
--   바뀌는데, 기존 트리거는 이때도 '쿠폰 발행 승인/반려' 알림을 판매자 본인에게
--   발송했다. 점주 발행 신청(source='seller') 건에만 발송하도록 가드.
--   (트리거 trg_notify_coupon_decision 은 20260714 그대로 유지)
create or replace function public.notify_coupon_decision()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.source = 'seller'
     and new.seller_id is not null
     and new.request_status is distinct from old.request_status
     and new.request_status in ('approved','rejected') then
    insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
    values (
      new.seller_id,
      (case when new.request_status='approved' then 'coupon_approved' else 'coupon_rejected' end)::public.notification_type,
      (case when new.request_status='approved' then '쿠폰 발행 승인' else '쿠폰 발행 반려' end),
      (case when new.request_status='approved'
            then new.name || ' 쿠폰이 승인되어 발행되었습니다.'
            else new.name || ' 쿠폰이 반려되었습니다.' || coalesce(' 사유: ' || new.reject_reason, '') end),
      'coupon', new.id
    );
  end if;
  return new;
end; $$;

-- ── 5) 판매자 수락/거절 RPC ─────────────────────────────────────────────────
--   본인에게 지정된(seller_id=auth.uid()) 관리자 발행 대기(pending) 쿠폰만 처리.
--   수락 → approved + 활성화(사용자 앱 노출). 거절 → rejected + 비활성 유지.
create or replace function public.respond_coupon_offer(
  p_coupon_id uuid,
  p_accept boolean,
  p_reason text default null
) returns public.coupons
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.coupons;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  -- 수락/거절 모두 되돌릴 수 없는 상태 전이 — null 이 조용히 거절로 처리되지 않게 명시 검증
  if p_accept is null then raise exception 'p_accept is required'; end if;

  select * into v_row from public.coupons where id = p_coupon_id for update;
  if not found then raise exception 'coupon not found'; end if;
  if v_row.seller_id is distinct from v_uid then raise exception 'not your coupon'; end if;
  if v_row.source <> 'admin' then raise exception 'not an admin-assigned coupon'; end if;
  if v_row.request_status is distinct from 'pending' then raise exception 'coupon not pending'; end if;

  if p_accept then
    update public.coupons
       set request_status = 'approved', is_active = true, reject_reason = null
     where id = p_coupon_id
     returning * into v_row;
  else
    update public.coupons
       set request_status = 'rejected', is_active = false,
           reject_reason = coalesce(nullif(trim(p_reason), ''), '판매자 거절')
     where id = p_coupon_id
     returning * into v_row;
  end if;

  return v_row;
end; $$;
revoke all on function public.respond_coupon_offer(uuid, boolean, text) from public;
grant execute on function public.respond_coupon_offer(uuid, boolean, text) to authenticated;

-- ── 6) admin_stores 뷰 재정의: total_review_count 추가 ──────────────────────
--   stores.review_count 는 공개 리뷰(normal/flagged/flagged_normal)만 집계하므로
--   관리자 리뷰 관리(숨김/삭제 포함 전체 목록)와 수치가 어긋난다.
--   관리자 화면용 전체 리뷰 수를 별도 컬럼으로 제공 (20260716 정의 + 컬럼 1개).
drop view if exists public.admin_stores;
create view public.admin_stores with (security_barrier) as
  select s.*,
         u.email,
         (select count(*) from public.orders o where o.store_id = s.id)::int as total_orders,
         (select count(*) from public.reports r
           where r.store_id = s.id and r.inquirer_type = 'buyer')::int as report_count,
         (select count(*) from public.reviews rv
           where rv.store_id = s.id)::int as total_review_count
    from public.stores s
    left join auth.users u on u.id = s.seller_id
   where (select public.is_admin());
grant select on public.admin_stores to authenticated;
