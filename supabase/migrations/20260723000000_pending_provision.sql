-- ============================================================================
-- FoodPicker 입점 신청 플로우 전환 (2026-07-23)
--   1) provision_my_store() — approval_status='approved' → 'pending' 변경
--      프로토타입 단계에서는 'approved'로 생성했으나, 실제 입점 심사 플로우로 전환.
--   2) 스토리지 정책: documents/store 폴더는 pending 상태에서도 업로드 허용
--      (이 정책이 아직 적용 안 된 경우를 위해 재실행 안전하게 포함)
-- 재실행 안전.
-- ============================================================================

-- ── 1) provision_my_store: pending 으로 생성 ─────────────────────────────
create or replace function public.provision_my_store()
returns public.stores
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_meta  jsonb;
  v_store public.stores;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- 이미 있으면 그대로 반환(멱등)
  select * into v_store from public.stores where seller_id = v_uid;
  if found then
    return v_store;
  end if;

  -- 가입 시 넣은 프로필성 메타데이터(store_name/owner_name/phone) 사용
  select raw_user_meta_data into v_meta from auth.users where id = v_uid;

  insert into public.stores (seller_id, name, owner_name, phone, approval_status)
  values (
    v_uid,
    coalesce(nullif(v_meta->>'store_name', ''), '내 매장'),
    coalesce(v_meta->>'owner_name', ''),
    v_meta->>'phone',
    'pending'
  )
  returning * into v_store;

  return v_store;
end;
$$;

revoke all on function public.provision_my_store() from public;
grant execute on function public.provision_my_store() to authenticated;

-- ── 2) 스토리지 정책: documents/store 폴더 = 매장 행 보유면 업로드 허용 ──
-- (20260722030000 미적용 환경 대비 — 이미 적용된 경우 idempotent)
drop policy if exists "product_images_seller_insert" on storage.objects;
drop policy if exists "product_images_seller_update" on storage.objects;

create policy "product_images_seller_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      exists (select 1 from public.stores s
               where s.seller_id = auth.uid() and s.approval_status = 'approved')
      or ((storage.foldername(name))[2] in ('documents', 'store')
          and exists (select 1 from public.stores s where s.seller_id = auth.uid()))
    )
  );

create policy "product_images_seller_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      exists (select 1 from public.stores s
               where s.seller_id = auth.uid() and s.approval_status = 'approved')
      or ((storage.foldername(name))[2] in ('documents', 'store')
          and exists (select 1 from public.stores s where s.seller_id = auth.uid()))
    )
  )
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      exists (select 1 from public.stores s
               where s.seller_id = auth.uid() and s.approval_status = 'approved')
      or ((storage.foldername(name))[2] in ('documents', 'store')
          and exists (select 1 from public.stores s where s.seller_id = auth.uid()))
    )
  );
