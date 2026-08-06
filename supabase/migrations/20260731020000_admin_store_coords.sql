-- ============================================================================
-- FoodPicker 관리자 전용 매장 좌표 보정 RPC (2026-07-31)
--
-- [배경] 사용자앱 지도에 매장 핀이 뜨지 않는다. 원인 중 하나가 stores.lat/lng 미등록이다.
--   판매자앱은 매장관리 화면 진입 시 지오코딩으로 좌표를 채우지만, 그 화면을 열지 않은
--   매장은 좌표가 null 로 남는다. 좌표가 없는 매장은 사용자앱 MapScreen 에서 통째로 제외된다.
--
-- [왜 RPC 인가]
--   · public.stores 는 authenticated 에 대해 테이블 UPDATE 가 회수되고 컬럼 화이트리스트만
--     부여돼 있다(20260706000000_init.sql:479-486). lat/lng 는 화이트리스트에 있으나,
--   · RLS 에 stores 관리자 UPDATE 정책이 없다(20260716000000_admin.sql:449-455 는
--     stores_admin_select 뿐). → 관리자 세션의 직접 UPDATE 는 0행으로 조용히 실패한다.
--   · 따라서 admin.sql §8 규약대로 security definer RPC + is_admin() + log_admin_action
--     조합으로만 쓴다.
--
-- [연쇄효과 — 의도된 것]
--   · trg_stores_geo_sync(20260728000000:315-322)가 이 매장의 기존 products.lat/lng/
--     pickup_address 를 자동 동기화한다.
--   · flag_store_reapproval(20260709000000:30-48)의 감시 컬럼에 lat/lng 는 없으므로
--     좌표만 바꿔도 approval_status 가 pending 으로 떨어지지 않는다.
--
-- stores 에 새 컬럼을 추가하지 않으므로 admin_stores 뷰(select s.*)는 재생성이 불필요하다.
-- 재실행 안전(idempotent). drop function 금지 — create or replace 만 사용한다.
-- ============================================================================

create or replace function public.admin_set_store_coords(
  p_store_id uuid,
  p_lat      double precision,
  p_lng      double precision
) returns public.stores
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_row public.stores;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_store_id is null then raise exception 'store id required'; end if;
  if p_lat is null or p_lng is null then raise exception 'lat/lng required'; end if;

  -- 대한민국 영역 대략 검증.
  -- 지오코딩 응답의 x(경도)/y(위도)를 뒤바꿔 넣는 실수를 여기서 잡는다
  -- (네이버 응답은 x=경도, y=위도 — 서울은 lat 37.x / lng 127.x 라 swap 시 반드시 걸린다).
  if p_lat not between 33.0 and 38.7 or p_lng not between 124.5 and 132.0 then
    raise exception 'coords out of KR range: lat=%, lng=% (x/y swap 확인)', p_lat, p_lng;
  end if;

  update public.stores
     set lat = p_lat,
         lng = p_lng
   where id = p_store_id
  returning * into v_row;
  if not found then raise exception 'store not found'; end if;

  perform public.log_admin_action(
    '매장 좌표 보정', 'store', p_store_id::text,
    format('lat=%s, lng=%s', p_lat, p_lng));

  return v_row;
end; $$;

revoke all on function public.admin_set_store_coords(uuid, double precision, double precision)
  from public;
revoke all on function public.admin_set_store_coords(uuid, double precision, double precision)
  from anon;
grant execute on function public.admin_set_store_coords(uuid, double precision, double precision)
  to authenticated;

comment on function public.admin_set_store_coords(uuid, double precision, double precision) is
  '관리자 전용 매장 좌표 보정. 판매자앱 지오코딩이 실행되지 않아 lat/lng 가 null 로 남은 매장을 '
  '관리자웹(브라우저 네이버 지도 geocoder)에서 채우기 위한 RPC. '
  'trg_stores_geo_sync 가 상품 스냅샷까지 전파한다.';

-- ============================================================================
-- 운영 유틸 SQL (전부 주석 — 실행 여부는 운영자가 판단한다)
-- ============================================================================

-- ── [U1] 진단: 좌표가 비어 있는 매장 확인 ───────────────────────────────────
--   -- select id, name, address, lat, lng, approval_status, created_at
--   --   from public.stores
--   --  order by (lat is null) desc, created_at;
--   -- 기대: lat/lng 가 null 인 행이 보정 대상. approval_status='approved' 인 행만
--   --       public_stores 에 노출되므로 사용자앱 지도에도 그 행만 후보가 된다.

-- ── [U2] 즉시 언블록용 수동 백필 템플릿 ─────────────────────────────────────
--   (Supabase SQL Editor = postgres 롤 → 컬럼 grant / RLS 를 우회한다.
--    관리자웹 기능 배포를 기다리지 않고 오늘 지도를 살리려면 이걸 쓴다.)
--   [U1] 로 얻은 id 와, 네이버/카카오 지도에서 주소를 검색해 얻은 좌표를 넣는다.
--   ※ 위도(lat)=37.x, 경도(lng)=127.x 순서를 반드시 확인할 것.
--   -- update public.stores as s
--   --    set lat = v.lat, lng = v.lng
--   --   from (values
--   --     ('00000000-0000-0000-0000-000000000000'::uuid, 37.574400::double precision, 127.039800::double precision)
--   --     -- , ('...'::uuid, 37.000000, 127.000000)
--   --   ) as v(id, lat, lng)
--   --  where s.id = v.id;

-- ── [U3] 검증 ───────────────────────────────────────────────────────────────
--   -- 좌표가 상품 스냅샷까지 전파됐는지(trg_stores_geo_sync 동작 확인)
--   -- select p.id, p.name, p.store_id, p.lat, p.lng, p.pickup_address, p.status
--   --   from public.products p
--   --   join public.stores s on s.id = p.store_id
--   --  where s.lat is not null
--   --  order by p.updated_at desc
--   --  limit 20;
--
--   -- 사용자앱이 실제로 읽는 공개 뷰
--   -- select id, name, lat, lng, address from public.public_stores order by name;
--
--   -- 좌표 보정이 승인 상태를 흔들지 않았는지
--   -- select name, approval_status, lat, lng from public.stores order by name;
--
--   -- 감사 로그
--   -- select created_at, admin_name, action, target_id, detail
--   --   from public.admin_action_logs
--   --  where action = '매장 좌표 보정'
--   --  order by created_at desc limit 20;
-- ============================================================================
