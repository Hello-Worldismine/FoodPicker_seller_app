-- ============================================================================
-- FoodPicker 후속작업 (2026-07-08) — 판매자 셀프 프로비저닝 + 서류/공지 갭 보강
--   1) stores.biz_cert_image  — 사업자등록증 이미지 URL 컬럼 + 판매자 UPDATE 권한
--   2) notices.notice_code    — NC-### 자동 발번 기본값
--   3) provision_my_store()   — 로그인 판매자가 '본인' 매장을 생성(RPC, security definer)
-- 모두 재실행 안전(if not exists / create or replace).
-- ============================================================================

-- ── 1) 사업자등록증 이미지 컬럼 ───────────────────────────────────────────
alter table public.stores add column if not exists biz_cert_image text;
-- 판매자가 자기 매장의 서류 이미지를 갱신할 수 있도록 컬럼 UPDATE 권한 부여
-- (승인 워크플로 도입 시, 이 컬럼 변경도 approval_status='pending' 트리거 대상에 포함 권장)
grant update (biz_cert_image) on public.stores to authenticated;

-- ── 2) 공지 코드 자동 발번 (NC-001 ...) ──────────────────────────────────
-- 기존: notice_code unique 이나 default 없음(플랫폼이 명시 발번). 누락 방지 위해 기본값 추가.
create sequence if not exists notice_code_seq start 1;
alter table public.notices
  alter column notice_code set default ('NC-' || lpad(nextval('notice_code_seq')::text, 3, '0'));
-- 공지 생성은 service_role 전용이므로 시퀀스 권한은 authenticated 에서 회수(코드 유추 방지)
revoke usage, select on sequence notice_code_seq from authenticated;

-- ── 3) 셀프 프로비저닝 RPC ────────────────────────────────────────────────
-- 로그인한 사용자가 '본인' 매장을 1회 생성한다(없을 때만, 멱등).
--   · security definer: stores 는 INSERT RLS 정책이 없고 컬럼이 잠겨 있으나, 이 함수는
--     반드시 seller_id = auth.uid() 로만 생성 → 타인 매장/타 판매자 사칭 불가.
--   · app_metadata.role='seller' self-assign 은 여전히 불가(플랫폼 통제). '매장 행'만 생성한다.
--   · 프로토타입 편의상 approval_status='approved' 로 생성(이미지 업로드 정책 EXISTS(approved) 통과).
--     운영 전환 시 'pending' + 관리자 승인 흐름(§9)으로 교체할 것.
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
    'approved'
  )
  returning * into v_store;

  return v_store;
end;
$$;

-- anon/public 실행 차단, 인증 사용자만 실행 가능(내부에서 auth.uid() 로 재검증)
revoke all on function public.provision_my_store() from public;
grant execute on function public.provision_my_store() to authenticated;
