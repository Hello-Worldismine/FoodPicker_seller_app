-- ============================================================================
-- 매장 좌표 백필 (2026-08-06)
--
-- [문제] 사용자앱 지도가 '위치 정보가 없습니다' 로 폴백된다
--        (수정사항 시트 사용자앱 14번 '상품상세페이지 > 픽업장소', 15번·19번 '지도').
--        지도 컴포넌트(NaverMap)는 목업이 아니라 실제 네이버 지도 SDK 를 쓰는 WebView 다.
--        원인은 코드가 아니라 **데이터**다 — lat/lng 가 null 이면 지도를 그리지 않고 폴백한다.
--
--        판매자앱의 주소→좌표 변환(NaverGeocoder)이 한 번도 실행된 적이 없어
--        판매자가 등록한 매장 4곳의 lat/lng 가 전부 null 이고,
--        trg_stores_geo_sync 가 전파할 원본이 없어 products.lat/lng 도 전부 null 이다.
--
--        실측(2026-08-06):
--          public_stores    5곳 중 좌표 있음 1곳(시드 '그린샐러드 강남점')
--          public_products  좌표 있는 상품 0개
--
-- [해결] 아래 UPDATE 로 좌표를 직접 채운다. postgres 롤(SQL Editor)은 컬럼 GRANT 와 RLS 를
--        우회하므로 그대로 실행하면 된다.
--        trg_stores_geo_sync(20260728000000)가 해당 매장의 products.lat/lng/pickup_address 까지
--        자동 전파하므로 상품상세 픽업장소 지도도 함께 살아난다.
--        flag_store_reapproval 의 감시 컬럼에 lat/lng 가 없어 승인 상태는 흔들리지 않는다.
--
-- [좌표 출처] OpenStreetMap Nominatim 지오코딩 결과이며 대한민국 좌표 범위로 검증했다.
--             도로명 주소 기준이라 건물 단위 오차가 있을 수 있다. 정밀 보정이 필요하면
--             관리자페이지의 [매장 좌표 일괄 보정](네이버 지오코더)으로 덮어쓰면 된다.
--             ※ 그 기능은 20260731020000_admin_store_coords.sql 이 적용돼야 동작한다.
--
-- 재실행 안전(idempotent) — 같은 값을 다시 써도 무해하다.
-- ============================================================================

update public.stores as s
   set lat = v.lat,
       lng = v.lng
  from (values
    -- 테스트            | 서울 동대문구 겸재로 16
    ('0de5087e-f3e2-4b93-a63f-9356e7a422b7'::uuid, 37.584214, 127.069740),
    -- 테스트매장 신설동점 | 서울 동대문구 천호대로 1-1
    ('b670f589-ea4a-4bc0-9038-0d1a2d22d8a5'::uuid, 37.574318, 127.025730),
    -- 테스트  2. 신설동  | 서울 동대문구 천호대로 3
    ('c4c5a9e5-a6b9-4567-82e3-4ac9859a0012'::uuid, 37.574074, 127.038066)
  ) as v(id, lat, lng)
 where s.id = v.id;

-- '내 매장'(44673c33-f82e-438b-856a-479db32e2266) 은 address 자체가 null 이라 제외했다.
-- 판매자가 매장관리에서 주소를 먼저 입력해야 좌표를 넣을 수 있다.


-- ── 검증 ────────────────────────────────────────────────────────────────────
-- ① 매장 좌표 (내 매장 1건만 null 로 남아야 정상)
select name, address, lat, lng from public.stores order by (lat is null), name;

-- ② 트리거가 상품까지 전파했는지 — 상품상세 픽업장소 지도가 보는 값이다
select p.name, p.lat, p.lng, p.pickup_address, s.name as store
  from public.products p
  join public.stores s on s.id = p.store_id
 where p.status = 'selling'
 order by s.name, p.name;

-- ③ 사용자앱이 실제로 읽는 공개 뷰 (여기 lat 이 null 이면 앱에서 폴백된다)
select name, lat, lng from public.public_products order by name;
select name, lat, lng from public.public_stores  order by name;
