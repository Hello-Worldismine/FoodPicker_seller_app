-- ============================================================================
-- FoodPicker 판매자 서류 업로드 정책 보강 (2026-07-22)
--   증상: 매장관리 > 정보 변경 신청 제출 시
--         "new row violates row-level security policy" 오류.
--   원인: product-images 버킷의 업로드 정책(20260707)이
--         approval_status='approved' 매장의 판매자에게만 INSERT 를 허용 —
--         승인대기/반려/재심사 상태의 판매자는 사업자등록증(documents 폴더)을
--         업로드할 수 없다. 서류 제출은 오히려 승인 전에 필요한 작업이다.
--   조치: 서류(documents)·매장 이미지(store) 폴더는 "본인 매장 행 보유"만 요구
--         (승인 여부 무관). 상품 이미지 등 그 외 폴더는 기존대로 승인 판매자 전용.
--         소비자 계정 악용 차단은 매장 행 존재 조건이 그대로 담당한다.
--   경로 규약: {uid}/{folder}/{filename} — (storage.foldername(name))[2] = folder.
-- 재실행 안전.
-- ============================================================================

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
