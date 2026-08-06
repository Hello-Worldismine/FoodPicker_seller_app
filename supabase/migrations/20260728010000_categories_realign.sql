-- ============================================================================
-- FoodPicker 카테고리 체계 정합 (2026-07-28)
--
-- [문제] 카테고리 분류가 3중으로 어긋나 있었다.
--   · categories 테이블 시드      : 빵 / 도시락 / 샐러드 / 반찬 / 디저트 / 음료 / 기타
--   · 판매자앱이 실제로 저장하는 값 : 베이커리·디저트 / 도시락·간편식 / 샐러드·건강식 /
--                                    반찬·밀키트 / 채소·과일 / 정육·수산 / 음료·기타
--   · 사용자앱 홈                  : 위 7종을 코드에 하드코딩(테이블 미조회)
--   결과 ① 관리자웹 '카테고리 관리'의 상품 수가 항상 0 (이름 문자열 매칭 실패)
--        ② 관리자가 이름·순서·아이콘을 바꿔도 사용자앱에 반영되지 않음
--        ③ 사용자앱 카테고리 상세/지도 필터가 모든 카테고리에서 0건
--
-- [정본] products.category 에 이미 데이터가 쌓여 있는 판매자앱 7종을 정본으로 삼는다.
--        → products / stores 데이터 UPDATE 불필요(가장 안전한 방향).
--        → categories 테이블의 이름·아이콘·순서만 정본에 맞춘다.
--        → 사용자앱은 이 테이블을 조회해 홈 카테고리를 렌더한다(같은 커밋의 앱 변경).
--
-- 재실행 안전(idempotent). 행을 삭제하지 않는다 — 이름만 옮기거나(구 행 재사용)
-- 구 행이 별도로 남은 경우 is_active=false 로 숨긴다.
-- ============================================================================

do $$
declare
  v record;
begin
  for v in
    select * from (values
      ('빵',      '베이커리·디저트', '🥐', 1),
      ('도시락',  '도시락·간편식',   '🍱', 2),
      ('샐러드',  '샐러드·건강식',   '🥗', 3),
      ('반찬',    '반찬·밀키트',     '🥘', 4),
      ('디저트',  '채소·과일',       '🥦', 5),   -- 디저트는 '베이커리·디저트'로 흡수되어 이 행을 재사용
      ('기타',    '정육·수산',       '🥩', 6),
      ('음료',    '음료·기타',       '🧋', 7)
    ) as t(old_name, new_name, icon, ord)
  loop
    if exists (select 1 from public.categories where name = v.new_name) then
      -- 이미 정본 이름이 있으면 아이콘/순서만 정렬하고 활성화
      update public.categories
         set icon = v.icon, display_order = v.ord, is_active = true
       where name = v.new_name;
      -- 구 이름 행이 따로 남아 있으면 목록에서 숨긴다(삭제하지 않음)
      update public.categories set is_active = false where name = v.old_name;
    elsif exists (select 1 from public.categories where name = v.old_name) then
      -- 구 행을 정본 이름으로 이동(id 유지 → 참조가 있어도 안전)
      update public.categories
         set name = v.new_name, icon = v.icon, display_order = v.ord, is_active = true
       where name = v.old_name;
    else
      insert into public.categories (name, icon, display_order, is_active)
      values (v.new_name, v.icon, v.ord, true);
    end if;
  end loop;
end $$;

-- 정본 7종 외에 남아 있는 활성 행이 있으면 순서를 뒤로 밀어 홈 그리드 배치를 흔들지 않게 한다.
update public.categories
   set display_order = greatest(display_order, 90)
 where is_active
   and name not in ('베이커리·디저트','도시락·간편식','샐러드·건강식','반찬·밀키트','채소·과일','정육·수산','음료·기타');

-- 확인용:
--   select name, icon, display_order, is_active from public.categories order by display_order;
