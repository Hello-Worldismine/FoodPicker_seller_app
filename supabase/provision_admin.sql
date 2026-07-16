-- ============================================================================
-- FoodPicker 최초 관리자 부트스트랩 (SQL Editor 에서 실행)
--   전제: 20260716000000_admin.sql 적용 완료 + 대상 계정이 이미 가입되어 있을 것
--        (관리자 웹 로그인 화면의 '계정 만들기' 또는 기존 계정 사용).
--   이후 추가 관리자는 관리자 웹 '관리자 계정' 메뉴(admin_add_account RPC)로 등록.
-- ============================================================================

-- ▼ 대상 이메일/이름/역할을 수정해서 실행
with target as (
  select id, email from auth.users where lower(email) = lower('hsb5975@naver.com')
)
insert into public.admin_profiles (user_id, name, email, role)
select id, '김관리', email, 'super' from target
on conflict (user_id) do update
  set role = 'super', is_active = true;

-- 확인
select user_id, name, email, role, is_active from public.admin_profiles;
