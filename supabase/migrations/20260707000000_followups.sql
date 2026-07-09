-- ============================================================================
-- FoodPicker 후속작업 마이그레이션 (2026-07-07) — 보안검증 4건 반영본
--   1) 상품 이미지 Storage 버킷(+MIME/크기 제한) + 정책(승인 판매자 폴더 격리)
--   2) 서버 스케줄러: 소비기한 만료 + 자동 시간차 할인 (pg_cron, 값 클램프)
--   3) 소비자/공개 접근 (안전 컬럼 뷰만 노출, 원본 테이블 RLS는 판매자 전용 유지)
-- ============================================================================

-- ── 1) STORAGE: product-images 버킷 ───────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/jpeg','image/png','image/webp'])   -- svg/html 제외(저장형 XSS 차단), 5MB 상한
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product_images_public_read"  on storage.objects;
drop policy if exists "product_images_seller_insert" on storage.objects;
drop policy if exists "product_images_seller_update" on storage.objects;
drop policy if exists "product_images_seller_delete" on storage.objects;

-- 공개 읽기(이미지 URL 노출용)
create policy "product_images_public_read"
  on storage.objects for select
  using (bucket_id = 'product-images');

-- 업로드/수정: 자기 폴더({uid}/...) + 승인된 판매자만(소비자 계정 악용 차단)
create policy "product_images_seller_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.stores s where s.seller_id = auth.uid() and s.approval_status = 'approved')
  );

create policy "product_images_seller_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.stores s where s.seller_id = auth.uid() and s.approval_status = 'approved')
  )
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.stores s where s.seller_id = auth.uid() and s.approval_status = 'approved')
  );

-- 삭제: 자기 폴더 파일만
create policy "product_images_seller_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── 2) 서버 스케줄러 (pg_cron) ────────────────────────────────────────────
create extension if not exists pg_cron;

-- 소비기한 만료: selling 인데 expiry 지난 상품 → paused/expiry
create or replace function public.expire_products()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.products
     set status = 'paused', pause_reason = 'expiry'
   where status = 'selling'
     and expiry_date is not null
     and expiry_date < now();
end; $$;

-- 자동 시간차 할인: interval_minutes 경과 상품 → sale_price -= reduction_amount (floor 하한).
-- discount_rate는 0~100으로 클램프(GREATEST/LEAST가 NULL 무시 → original_price=0/역전 케이스도 안전).
create or replace function public.reduce_product_prices()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.products p
     set sale_price      = greatest(p.floor_price, p.sale_price - p.reduction_amount),
         discount_rate   = least(100, greatest(0,
                             round((1 - greatest(p.floor_price, p.sale_price - p.reduction_amount)::numeric
                                       / nullif(p.original_price, 0)) * 100))),
         last_reduced_at = now()
   where p.status = 'selling'
     and p.reduction_amount is not null and p.reduction_amount > 0
     and p.floor_price is not null
     and p.original_price > 0
     and p.interval_minutes is not null and p.interval_minutes > 0
     and p.sale_price > p.floor_price
     and now() >= coalesce(p.last_reduced_at, p.created_at) + make_interval(mins => p.interval_minutes);
end; $$;

-- cron 등록(이름 기준, 재실행 시 갱신). 5분 주기.
select cron.schedule('foodpicker-expire-products', '*/5 * * * *', $$select public.expire_products();$$);
select cron.schedule('foodpicker-reduce-prices',   '*/5 * * * *', $$select public.reduce_product_prices();$$);

-- ── 3) 소비자/공개 접근 (안전 컬럼 뷰만) ───────────────────────────────────
-- 원본 테이블 RLS(판매자 전용)는 그대로 두고, 소비자에는 컬럼 제한 뷰만 공개.
-- (RLS는 행만 격리하므로 전체 컬럼 노출을 막으려면 뷰가 정답)

-- 3.1 판매중 상품 공개 뷰 (영업비밀 컬럼 제외: seller_id/start_price/floor_price/reduction_amount/interval_minutes/last_reduced_at/pause_reason/reject_reason)
create or replace view public.public_products as
  select id, store_id, name, category, emoji, thumbnail, images,
         original_price, sale_price, discount_rate, stock,
         pickup_start, pickup_end, expiry_date, storage, storage_detail,
         description, composition, origin, allergens, cancel_policy,
         store_notice, pickup_address, lat, lng, status, created_at, updated_at
    from public.products
   where status = 'selling';
grant select on public.public_products to anon, authenticated;

-- 3.2 매장 공개 뷰 (민감 컬럼 제외). 승인 매장만.
create or replace view public.public_stores as
  select id, name, category, description, notice, tags, store_image,
         open_hours, closed_days, lat, lng, address, rating, review_count
    from public.stores
   where approval_status = 'approved';
grant select on public.public_stores to anon, authenticated;

-- 3.3 구매자 본인 주문 조회 (주문 생성은 결제검증 서버/service_role 담당).
drop policy if exists orders_buyer_read on public.orders;
create policy orders_buyer_read on public.orders for select to authenticated
  using (buyer_id = auth.uid());

-- 3.4 구매자 본인 리뷰 조회 (리뷰 작성은 구매확인 서버 로직 경유 — 평점 조작 방지).
drop policy if exists reviews_buyer_read on public.reviews;
create policy reviews_buyer_read on public.reviews for select to authenticated
  using (reviewer_id = auth.uid());
