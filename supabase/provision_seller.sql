-- ============================================================================
-- 판매자 프로비저닝 (개발용) — Supabase 대시보드 SQL Editor에서 실행
-- ----------------------------------------------------------------------------
-- 순서:
--   1) 앱을 실행(npx expo start)하고 [회원가입]으로 판매자 계정을 만든다.
--   2) 아래 v_email 을 그 이메일로 바꾼다.
--   3) 전체를 SQL Editor에 붙여넣고 Run.  (재실행해도 안전)
--
-- 하는 일:
--   · app_metadata.role='seller' 부여  → 이후 이 계정은 판매자로 인식
--   · email_confirmed_at 세팅          → 이메일 인증 없이 바로 로그인 가능(개발용)
--   · stores 행 생성(없으면)           → 가입 시 입력한 매장명/대표자/전화 사용
-- postgres 권한으로 실행되어 RLS·컬럼잠금을 우회한다(운영에서는 관리자 플로우로 대체).
-- ============================================================================
do $$
declare
  v_email text := 'CHANGE_ME@example.com';   -- ★ 가입한 이메일로 변경
  v_uid uuid;
begin
  select id into v_uid from auth.users where email = v_email;
  if v_uid is null then
    raise exception '% 이메일의 계정이 없습니다. 앱에서 먼저 회원가입하세요.', v_email;
  end if;

  -- 판매자 승격 + 이메일 인증(개발용)
  update auth.users set
    raw_app_meta_data  = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'seller'),
    email_confirmed_at = coalesce(email_confirmed_at, now())
  where id = v_uid;

  -- 매장 생성(없으면). 가입 시 넣은 store_name/owner_name/phone 사용.
  insert into public.stores (seller_id, name, owner_name, phone, approval_status)
  select v_uid,
         coalesce(nullif(u.raw_user_meta_data->>'store_name', ''), '내 매장'),
         u.raw_user_meta_data->>'owner_name',
         u.raw_user_meta_data->>'phone',
         'approved'
  from auth.users u
  where u.id = v_uid
  on conflict (seller_id) do update set approval_status = 'approved';

  raise notice '판매자 프로비저닝 완료: % (uid=%)', v_email, v_uid;
end $$;

-- 확인용(선택): 실행 후 아래로 결과 조회
-- select id, email, raw_app_meta_data->>'role' as role, email_confirmed_at from auth.users where email = 'CHANGE_ME@example.com';
-- select seller_id, name, approval_status from public.stores;
