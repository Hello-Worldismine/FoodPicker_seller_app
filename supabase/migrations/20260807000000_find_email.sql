-- ============================================================================
-- FoodPicker 아이디(이메일) 찾기 — 20260807000000_find_email.sql
--
-- [설계 요지]
--   · '아이디' = 로그인 이메일이다. auth.users 는 클라이언트가 읽을 수 없으므로
--     security definer RPC 가 유일한 경로다(buyer_display_name / admin_add_account 와 동일 패턴).
--   · 로그인 **전** 화면에서 호출하므로 anon EXECUTE 가 필요하다. 이 저장소에서 anon 에 열린
--     함수는 is_admin() / store_coupons() / cancel_request_window() 3개뿐이었고 전부 PII 를
--     반환하지 않는다. 이 파일의 함수 2개가 최초의 'PII 인접 anon 함수' 이므로
--       ① 이메일 전체를 절대 반환하지 않고(고정 4별 마스킹)
--       ② IP 단위 레이트리밋을 함수 안에 내장하고
--       ③ '계정 없음' 을 raise 가 아니라 null 로 돌려준다(사유는 3) 절 주석 참조).
--   · ⚠️ Supabase 는 default privileges 로 신규 함수에 anon/authenticated EXECUTE 를
--     자동 부여한다(20260716000000_admin.sql:75-77). public 만 revoke 하면 열린 채로 남는다.
--     → 모든 신규 함수에 public / anon / authenticated **3중 revoke** 를 붙인 뒤
--       필요한 롤에만 다시 grant 한다.
--   · pgcrypto 는 extensions 스키마에 설치돼 있다(20260706000000_init.sql:17)
--     → digest() 는 반드시 extensions.digest(...) 로 스키마 한정 호출한다.
--   · 재실행 안전(idempotent). drop function 을 쓰지 않는다 — drop 하면 default privileges 가
--     재적용되어 권한 구멍이 생긴다(20260731010000_buyer_nickname.sql:23-26 주석 참조).
--
-- 선행: 20260706000000_init.sql (stores, public.set_updated_at)
-- 앱 계약: docs/API_SPEC.md §23 · DB 명세: docs/DB_SCHEMA.md §20
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 0) 정규화 · 마스킹 헬퍼 (immutable — 인덱스 식에 쓴다)
-- ──────────────────────────────────────────────────────────────────────────────

-- 숫자만 남긴다. '010-1234-5678' / '01012345678' / '010 1234 5678' 를 같은 조회 키로 만든다.
-- 사업자등록번호('123-45-67890')에도 그대로 쓴다.
create or replace function public.normalize_phone(p_raw text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$ select nullif(regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g'), '') $$;

comment on function public.normalize_phone(text) is
  '전화번호/사업자번호를 숫자만 남긴 조회 키로 정규화. immutable — stores 인덱스 식에 사용된다.';

-- 이메일 마스킹.
-- ★ 별표 개수를 **고정 4개**로 둔다. 원본 로컬파트 길이만큼 찍으면 길이 정보가 새어
--   사전 대입이 쉬워진다(ab****@gmail.com 은 로컬파트가 3자든 12자든 동일한 모양).
-- ★ 도메인은 남긴다 — 남기지 않으면 사용자가 자기 계정을 식별하지 못해 기능 자체가 무의미해진다.
create or replace function public.mask_email(p_email text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then null
    else (
      -- 로컬파트가 1~2자면 앞글자를 남기지 않는다. left(...,1) 로 두면 1자 계정은
      -- 그 한 글자가 곧 로컬파트 전체라 사실상 원본이 그대로 노출된다.
      case when char_length(split_part(p_email, '@', 1)) <= 2
           then ''
           else left(split_part(p_email, '@', 1), 2)
      end
      || '****@' || split_part(p_email, '@', 2)
    )
  end;
$$;

comment on function public.mask_email(text) is
  '아이디 찾기 응답용 이메일 마스킹(ab****@gmail.com). 별표는 고정 4개 — 로컬파트 길이 노출 방지.';

-- 헬퍼 자체는 클라이언트가 호출할 이유가 없다(임의 이메일을 넣어 마스킹 규칙을 역산할 필요 없음).
revoke all on function public.normalize_phone(text) from public;
revoke all on function public.normalize_phone(text) from anon;
revoke all on function public.normalize_phone(text) from authenticated;

revoke all on function public.mask_email(text) from public;
revoke all on function public.mask_email(text) from anon;
revoke all on function public.mask_email(text) from authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1) 구매자 연락처 — 본인확인 인자
--
--   [왜 별도 테이블인가] 이 저장소의 구매자 프로필 규약은 auth.users.raw_user_meta_data 다
--   (20260706000000_init.sql:392-393, 20260731010000 nickname). 그러나 아이디 찾기는
--   **익명 호출자가 준 번호로 역조회**하는 경로라 인덱스가 필수인데, auth 스키마를 건드리지
--   않는다는 이 저장소 규약상 jsonb 키에 인덱스를 만들 수 없다.
--   인덱스 없는 익명 역조회는 그 자체가 DoS 벡터다 → public 스키마에 전용 테이블을 둔다.
--
--   [검증 수준] 저장소에 SMS 발송 수단이 전무하므로 이 번호는 '자기신고값'이다.
--   소유 증명이 아니라 **지식 요소**로 쓴다 — 공격자는 피해자의 번호를 바꿔 심을 수 없으므로
--   이름+번호 조합은 유효한 확인 수단이다. SMS 를 도입하면 verified_at 컬럼만 추가하면 된다.
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.buyer_contacts (
  buyer_id   uuid primary key references auth.users(id) on delete cascade,
  phone_norm text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint buyer_contacts_phone_chk check (phone_norm ~ '^01[0-9]{8,9}$')
);

create index if not exists idx_buyer_contacts_phone on public.buyer_contacts(phone_norm);

drop trigger if exists trg_buyer_contacts_updated on public.buyer_contacts;
create trigger trg_buyer_contacts_updated
  before update on public.buyer_contacts
  for each row execute function public.set_updated_at();

alter table public.buyer_contacts enable row level security;

-- 본인만 '등록됨' 여부를 확인한다. 쓰기는 RPC 전용 — 정규화·형식 검증을 서버가 강제해야 하므로
-- 테이블 직접 INSERT/UPDATE 권한을 아예 주지 않는다.
drop policy if exists buyer_contacts_owner_select on public.buyer_contacts;
create policy buyer_contacts_owner_select on public.buyer_contacts
  for select to authenticated using (buyer_id = auth.uid());

revoke all on public.buyer_contacts from anon;
revoke all on public.buyer_contacts from authenticated;
grant select on public.buyer_contacts to authenticated;

comment on table public.buyer_contacts is
  '구매자 휴대폰(아이디 찾기 본인확인용). 자기신고값이며 SMS 미검증. 쓰기는 set_my_phone RPC 전용.';
comment on column public.buyer_contacts.phone_norm is
  '숫자만 남긴 휴대폰(normalize_phone 결과). 원본 하이픈 표기는 저장하지 않는다.';

-- 본인 휴대폰 등록/변경. 반환값 = 실제 저장된 정규화 번호(앱이 화면에 되비출 때 사용).
create or replace function public.set_my_phone(p_phone text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_p   text := public.normalize_phone(p_phone);
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- 아무것도 입력하지 않은 경우와 형식이 틀린 경우를 구분해 앱이 다른 안내를 띄우게 한다.
  -- (여기의 raise 는 **사용자 피드백용**이다. 최종 방어는 buyer_contacts_phone_chk CHECK 이며
  --  두 곳의 규칙은 항상 같이 고쳐야 한다 — sync_my_display_name 과 동일한 역할 분담.)
  if v_p is null then raise exception 'INVALID_INPUT'; end if;
  if v_p !~ '^01[0-9]{8,9}$' then raise exception 'PHONE_INVALID'; end if;

  insert into public.buyer_contacts (buyer_id, phone_norm)
  values (v_uid, v_p)
  on conflict (buyer_id) do update
    set phone_norm = excluded.phone_norm;   -- updated_at 은 trg_buyer_contacts_updated 가 찍는다

  return v_p;
end; $$;

revoke all on function public.set_my_phone(text) from public;
revoke all on function public.set_my_phone(text) from anon;
revoke all on function public.set_my_phone(text) from authenticated;
grant execute on function public.set_my_phone(text) to authenticated;

comment on function public.set_my_phone(text) is
  '구매자 본인 휴대폰 등록/변경. 정규화 후 저장하고 저장값을 반환. 예외: NOT_AUTHENTICATED / INVALID_INPUT / PHONE_INVALID.';

-- 본인 휴대폰 삭제(아이디 찾기 비활성화). 없는 행을 지워도 오류가 아니다(멱등).
create or replace function public.clear_my_phone()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  delete from public.buyer_contacts where buyer_id = v_uid;
end; $$;

revoke all on function public.clear_my_phone() from public;
revoke all on function public.clear_my_phone() from anon;
revoke all on function public.clear_my_phone() from authenticated;
grant execute on function public.clear_my_phone() to authenticated;

comment on function public.clear_my_phone() is
  '구매자 본인 휴대폰 삭제(멱등). 삭제 후에는 아이디 찾기로 이 계정을 찾을 수 없다.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2) 무차별 대입 방지 — 시도 로그 + 쿼터
--
--   이 저장소에는 레이트리밋 수단이 전무했다. Supabase Auth 의 내장 레이트리밋은
--   /auth/v1 엔드포인트에만 걸리고 PostgREST RPC 에는 걸리지 않는다 → 함수 안에서 직접 센다.
--
--   호출자 식별은 PostgREST 가 노출하는 요청 헤더를 쓴다. ⚠️ 이 저장소 최초 사용 선례다.
--   x-forwarded-for 가 비어 오면 모두가 'unknown' 한 버킷을 공유하게 되어 정상 사용자까지
--   막힐 수 있다 → unknown 버킷만 한도를 크게 잡는다(아래 v_limit 분기).
--   IP 원문은 저장하지 않고 pgcrypto 로 해시한다(extensions.digest 로 스키마 한정 호출).
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.identity_lookup_attempts (
  id          uuid primary key default gen_random_uuid(),
  client_hash text not null,
  scope       text not null,                       -- 'buyer' | 'seller'
  matched     boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint identity_lookup_attempts_scope_chk check (scope in ('buyer', 'seller'))
);

create index if not exists idx_identity_lookup_attempts_client
  on public.identity_lookup_attempts(client_hash, created_at desc);
create index if not exists idx_identity_lookup_attempts_created
  on public.identity_lookup_attempts(created_at);

-- RLS 를 켜고 정책을 하나도 만들지 않는다 → definer 함수 외에는 누구도 읽거나 쓸 수 없다
-- (payment_methods 와 동일 규약).
alter table public.identity_lookup_attempts enable row level security;
revoke all on public.identity_lookup_attempts from anon;
revoke all on public.identity_lookup_attempts from authenticated;

comment on table public.identity_lookup_attempts is
  '아이디 찾기 시도 로그(레이트리밋용). IP 는 해시로만 보관하고 입력값은 저장하지 않는다. definer 함수 전용 — 정책 없음.';

-- 쿼터 검사 + 호출자 키 반환. definer 내부 전용(log_admin_action 과 동일 규약).
--
-- p_scope 에는 '무엇을 조회하는가'를 식별하는 값(정규화된 휴대폰/사업자번호 등)을 넘긴다.
-- 쿼터 키를 IP 단독이 아니라 **IP + 대상** 으로 잡기 위한 것이다. 이유는 아래 두 가지다.
--
-- ⚠️ [1] x-forwarded-for 의 맨 앞 값은 신뢰할 수 없다.
--    XFF 는 프록시가 **뒤에 덧붙이는** 헤더라, 클라이언트가 처음부터
--    `X-Forwarded-For: 1.2.3.4` 를 실어 보내면 그 값이 맨 앞에 남는다.
--    맨 앞을 호출자 IP 로 쓰면 공격자가 매 요청 다른 값을 넣어 쿼터를 통째로 무력화할 수 있다
--    (client_hash 가 매번 달라진다). 이 함수는 anon 에 열린 조회의 유일한 방어선이므로
--    **cf-connecting-ip → x-real-ip → XFF 의 마지막 요소** 순으로 읽는다.
--    앞의 두 헤더는 엣지가 직접 세팅하므로 클라이언트가 위조해도 덮어써진다.
--
-- ⚠️ [2] IP 를 못 얻었을 때 전역 단일 버킷을 쓰면 안 된다.
--    모든 호출자가 한 줄을 공유하면 (a) 누군가 한도를 소진시키는 것만으로 전체 사용자의
--    아이디 찾기가 막히고(누구나 유발 가능한 기능 단위 DoS) (b) 방어 관점에서도
--    그 한도만큼의 무차별 대입을 허용하게 된다.
--    → 폴백 키에 조회 대상(p_scope)을 섞어 '같은 대상 반복' 만 막고 서로 다른 사용자는
--      간섭하지 않게 한다. 운영 중 헤더 유실을 탐지할 수 있도록 'noip' 표식도 남긴다.
create or replace function public.assert_lookup_quota(p_scope text)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hdr    text;
  v_json   json;
  v_xff    text[];
  v_ip     text;
  v_key    text;
  v_hash   text;
  v_limit  int;
  v_recent int;
begin
  begin
    v_hdr  := coalesce(nullif(current_setting('request.headers', true), ''), '{}');
    v_json := v_hdr::json;
    -- 엣지가 세팅하는 헤더 우선. 마지막 폴백인 XFF 는 **마지막 요소**(가장 바깥 프록시가
    -- 기록한 실제 접속 IP)를 쓴다. 맨 앞은 클라이언트가 위조할 수 있다.
    v_xff := string_to_array(coalesce(v_json ->> 'x-forwarded-for', ''), ',');
    v_ip  := coalesce(
               nullif(btrim(coalesce(v_json ->> 'cf-connecting-ip', '')), ''),
               nullif(btrim(coalesce(v_json ->> 'x-real-ip', '')), ''),
               nullif(btrim(coalesce(v_xff[array_length(v_xff, 1)], '')), '')
             );
  exception when others then
    v_ip := null;                                  -- 헤더 파싱에 실패해도 기능은 계속된다
  end;

  if v_ip is null then
    -- 헤더 유실. 대상별로 버킷을 나눠 정상 사용자끼리 간섭하지 않게 한다.
    v_key   := 'noip|' || coalesce(nullif(btrim(coalesce(p_scope, '')), ''), 'unknown');
    v_limit := 10;
  else
    v_key   := v_ip;
    v_limit := 10;
  end if;

  v_hash := encode(extensions.digest(v_key || '|fp-idlookup-v1', 'sha256'), 'hex');

  select count(*) into v_recent
    from public.identity_lookup_attempts
   where client_hash = v_hash
     and created_at > now() - interval '1 hour';

  if v_recent >= v_limit then
    -- ★ 여기서 raise 하면 이 호출의 시도 로그도 함께 롤백되지만, 이미 기록된 v_limit 건이
    --   1시간 동안 남아 카운터 역할을 하므로 무제한 재시도가 되지는 않는다.
    raise exception 'LOOKUP_RATE_LIMIT';
  end if;

  return v_hash;
end; $$;

revoke all on function public.assert_lookup_quota(text) from public;
revoke all on function public.assert_lookup_quota(text) from anon;
revoke all on function public.assert_lookup_quota(text) from authenticated;

comment on function public.assert_lookup_quota(text) is
  '아이디 찾기 IP 쿼터(1시간 10회, IP 미상이면 200회). 통과 시 client_hash 반환. definer 내부 전용.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3) 구매자 아이디 찾기 — 이름 + 휴대폰 → 마스킹 이메일
--
--   ★ '일치하는 계정 없음' 은 예외가 아니라 **null 반환**이다.
--     raise 로 처리하면 함수 트랜잭션이 롤백되어 방금 남긴 시도 로그(= 레이트리밋 카운터)까지
--     같이 사라지고, 그러면 공격자가 '항상 실패하는 입력' 으로 무제한 재시도를 할 수 있다.
--     이 저장소의 다른 RPC 는 실패 시 raise 가 관례지만(create_order 등) 이 함수와
--     find_email_by_seller 만은 **의도적 예외**다. 고치지 말 것.
--   ★ 여러 건이 걸려도 건수를 노출하지 않고 가장 먼저 가입한 1건만 준다
--     ('2건이 조회되었습니다' 류의 응답은 그 자체가 계정 열거 신호가 된다).
--   ★ auth.users 는 소프트 삭제 컬럼(deleted_at)을 가지므로 탈퇴 계정이 걸리지 않게 필터한다.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.find_email_by_buyer(p_name text, p_phone text)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash  text;
  v_name  text := nullif(lower(btrim(coalesce(p_name, ''))), '');
  v_phone text := public.normalize_phone(p_phone);
  v_email text;
begin
  -- 조회 대상(정규화된 휴대폰)을 함께 넘긴다. IP 헤더가 유실된 환경에서 쿼터가
  -- 전역 단일 버킷이 되어 '한 명이 한도를 소진하면 전원이 막히는' 상태가 되지 않게 하는 장치다.
  v_hash := public.assert_lookup_quota('buyer:' || coalesce(v_phone, ''));

  -- 빈 값/형식 미달은 즉시 미일치 처리. ★ 빈 값 매칭을 절대 허용하지 않는다.
  if v_name is null or v_phone is null or v_phone !~ '^01[0-9]{8,9}$' then
    insert into public.identity_lookup_attempts (client_hash, scope, matched)
    values (v_hash, 'buyer', false);
    return null;
  end if;

  select u.email
    into v_email
    from public.buyer_contacts bc
    join auth.users u on u.id = bc.buyer_id
   where bc.phone_norm = v_phone
     -- 저장된 실명도 반드시 non-empty 여야 한다(빈 이름 계정을 빈 입력으로 긁는 것을 차단).
     and nullif(btrim(coalesce(u.raw_user_meta_data ->> 'name', '')), '') is not null
     and lower(btrim(coalesce(u.raw_user_meta_data ->> 'name', ''))) = v_name
     and u.deleted_at is null
   order by u.created_at
   limit 1;

  insert into public.identity_lookup_attempts (client_hash, scope, matched)
  values (v_hash, 'buyer', v_email is not null);

  return public.mask_email(v_email);
end; $$;

revoke all on function public.find_email_by_buyer(text, text) from public;
revoke all on function public.find_email_by_buyer(text, text) from anon;
revoke all on function public.find_email_by_buyer(text, text) from authenticated;
grant execute on function public.find_email_by_buyer(text, text) to anon;
grant execute on function public.find_email_by_buyer(text, text) to authenticated;

comment on function public.find_email_by_buyer(text, text) is
  '구매자 아이디 찾기. 이름+휴대폰 일치 시 마스킹 이메일, 아니면 null(예외 아님). 익명 호출 가능 — IP 쿼터 내장.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4) 판매자 아이디 찾기 — 대표자명 + (휴대폰 | 사업자등록번호) → 마스킹 이메일
--
--   ★ 함정: 판매자 가입 폼이 owner_name/phone 을 필수로 막지 않아(SignUp.jsx:28-44)
--     stores.owner_name = '' , phone = '' 인 행이 실제로 존재한다.
--     **저장값과 입력값 양쪽이 non-empty 일 때만 매칭**해야 한다 — 그렇지 않으면 공격자가
--     아무 값도 넣지 않고 임의 판매자의 이메일을 긁어갈 수 있다.
--     · owner_name : 아래 where 절에서 저장값 non-empty 를 명시적으로 강제한다.
--     · phone/biz  : normalize_phone('') 이 null 을 돌려주므로 `null = v_phone` 이 되어
--                    저장값이 빈 행은 자동으로 제외된다(입력값은 함수 앞부분에서 검증).
--   ★ biz_number 는 변경 시 flag_store_reapproval 이 재심사를 강제하므로(20260709000000:31-53)
--     승인(approved) 매장에서는 관리자가 서류로 검증한 값이다 → 앱은 이쪽을 기본 탭으로 둘 것.
--   ★ resident_number(주민번호)는 조회 인자에서 영구히 제외한다.
-- ──────────────────────────────────────────────────────────────────────────────
create index if not exists idx_stores_owner_name_lookup
  on public.stores (lower(btrim(owner_name)));
create index if not exists idx_stores_phone_norm
  on public.stores (public.normalize_phone(phone));
create index if not exists idx_stores_biz_norm
  on public.stores (public.normalize_phone(biz_number));

create or replace function public.find_email_by_seller(
  p_owner_name text,
  p_phone      text default null,
  p_biz_number text default null
) returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash  text;
  v_owner text := nullif(lower(btrim(coalesce(p_owner_name, ''))), '');
  v_phone text := public.normalize_phone(p_phone);
  v_biz   text := public.normalize_phone(p_biz_number);
  v_email text;
begin
  -- 조회 대상을 함께 넘긴다(위 find_email_by_buyer 와 같은 이유 — 전역 버킷 방지).
  v_hash := public.assert_lookup_quota('seller:' || coalesce(v_biz, v_phone, ''));

  -- 대표자명 필수 + 2요소(휴대폰/사업자번호) 중 최소 1개 필수. 형식 미달은 즉시 미일치.
  if v_owner is null
     or (v_phone is null and v_biz is null)
     or (v_phone is not null and char_length(v_phone) < 9)
     or (v_biz   is not null and char_length(v_biz) <> 10)   -- 사업자등록번호는 10자리
  then
    insert into public.identity_lookup_attempts (client_hash, scope, matched)
    values (v_hash, 'seller', false);
    return null;
  end if;

  select u.email
    into v_email
    from public.stores s
    join auth.users u on u.id = s.seller_id
   where nullif(btrim(coalesce(s.owner_name, '')), '') is not null   -- 저장값 빈칸 제외
     and lower(btrim(s.owner_name)) = v_owner
     and (
           (v_phone is not null and public.normalize_phone(s.phone)      = v_phone)
        or (v_biz   is not null and public.normalize_phone(s.biz_number) = v_biz)
         )
     and u.deleted_at is null
   order by u.created_at
   limit 1;

  insert into public.identity_lookup_attempts (client_hash, scope, matched)
  values (v_hash, 'seller', v_email is not null);

  return public.mask_email(v_email);
end; $$;

revoke all on function public.find_email_by_seller(text, text, text) from public;
revoke all on function public.find_email_by_seller(text, text, text) from anon;
revoke all on function public.find_email_by_seller(text, text, text) from authenticated;
grant execute on function public.find_email_by_seller(text, text, text) to anon;
grant execute on function public.find_email_by_seller(text, text, text) to authenticated;

comment on function public.find_email_by_seller(text, text, text) is
  '판매자 아이디 찾기. 대표자명 + (휴대폰|사업자번호) 일치 시 마스킹 이메일, 아니면 null(예외 아님). 익명 호출 가능.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 5) 시도 로그 정리 (pg_cron) — 20260711000000_consumer_features.sql:79-86 의 재실행 안전 패턴
-- ──────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'foodpicker-lookup-attempts-cleanup') then
    perform cron.schedule(
      'foodpicker-lookup-attempts-cleanup',
      '17 4 * * *',
      $q$delete from public.identity_lookup_attempts where created_at < now() - interval '7 days';$q$
    );
  end if;
end $$;

-- ============================================================================
-- 적용 후 검증 (주석 — 운영자가 판단해 실행)
-- ============================================================================
--   -- ① 함수 권한이 의도대로인지: anon_exec 이 true 인 함수는 딱 2개
--   --    (find_email_by_buyer / find_email_by_seller) 여야 한다.
--   -- select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef,
--   --        has_function_privilege('anon',          p.oid, 'execute') as anon_exec,
--   --        has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
--   --   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   --  where n.nspname = 'public'
--   --    and p.proname in ('mask_email','normalize_phone','set_my_phone','clear_my_phone',
--   --                      'assert_lookup_quota','find_email_by_buyer','find_email_by_seller')
--   --  order by p.proname;
--
--   -- ② 판매자 중 아이디 찾기가 불가능한 계정(대표자명/전화/사업자번호가 빈칸) 규모 파악
--   -- select count(*) filter (where nullif(btrim(coalesce(owner_name,'')),'') is null) as no_owner,
--   --        count(*) filter (where public.normalize_phone(phone) is null)             as no_phone,
--   --        count(*) filter (where public.normalize_phone(biz_number) is null)        as no_biz,
--   --        count(*) as total
--   --   from public.stores;
--
--   -- ③ 마스킹 포맷 확인(별표가 항상 4개인지)
--   -- select public.mask_email('a@gmail.com'), public.mask_email('abcdefghijk@naver.com');
--
--   -- ④ 레이트리밋 동작 확인(같은 IP 로 11회 호출 시 11번째가 LOOKUP_RATE_LIMIT)
--   -- select public.find_email_by_seller('홍길동', '01000000000', null);
--
--   -- ⑤ cron 잡 등록 확인
--   -- select jobname, schedule, active from cron.job where jobname like 'foodpicker-%';
-- ============================================================================
