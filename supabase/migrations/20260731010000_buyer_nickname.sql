-- ============================================================================
-- FoodPicker 구매자 표시명 = '닉네임' 전체 표시로 전환 (2026-07-31)
--
-- [배경] '정**' 마스킹은 판매자앱 UI 가 아니라 DB RPC 가 만든다.
--   현행 코드는 어디서나 아래 두 줄 패턴이다.
--     select coalesce(nullif(raw_user_meta_data->>'name',''),'구매자') into v_name ...
--     v_name := left(v_name,1) || '**';
--   실효 정의는 3곳뿐이다 — create_order(20260730000000:282-283),
--   create_review(20260711000000:179-180), create_report(20260722020000:74-75).
--
-- [저장소] auth.users.raw_user_meta_data->>'nickname'
--   · 구매자용 profiles 테이블은 존재하지 않는다(admin_profiles 는 관리자 전용).
--     프로필성 필드를 raw_user_meta_data 에서 읽는 것은 이 저장소의 기존 규약이다
--     (20260706000000_init.sql:392-393).
--   · 클라이언트가 supabase.auth.updateUser({ data: { nickname } }) 로 저장한다.
--
-- [name(실명)과 분리] name 에는 실명이 들어간다 — 이메일 가입 폼의 '이름',
--   소셜 로그인의 full_name 이 그대로 저장된다. 그래서 마스킹만 걷어내면 실명이
--   판매자에게 전량 노출된다. **nickname 에 name 을 자동 대입하지 않는다.**
--   nickname 미설정 계정은 기존 마스킹으로 폴백하므로, 마이그레이션만 먼저 적용하고
--   앱 배포가 늦어도 회귀가 없다.
--
-- [주의] create_order/create_review/create_report 는 drop 금지. 동일 시그니처
--   create or replace 로만 교체한다 — drop 하면 Supabase default privileges 가
--   anon/authenticated 에 execute 를 재부여해 결제 우회 구멍이 생긴다
--   (20260730000000_pickup_deadline_at.sql:163-165 주석 참조).
--
-- 선행: 20260730000000_pickup_deadline_at.sql (create_order v4) 적용 후 실행한다.
-- 재실행 안전(idempotent).
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1) 표시명 단일 소스 헬퍼 = 닉네임 검증의 **정본**
--    security definer 이므로 create_order/create_review/create_report 내부에서
--    호출 시 소유자 권한으로 실행된다. 외부 호출 권한은 전부 회수한다
--    (클라이언트가 임의 uuid 로 타인 닉네임을 조회하지 못하게).
--
--    ⚠️ 닉네임의 실제 저장은 클라이언트가 supabase.auth.updateUser({data:{nickname}}) 로
--       직접 한다 — 서버가 가로챌 수 없는 경로다. 따라서 검증을 '저장 시점'(sync_my_display_name)
--       에만 두면 수정된 클라이언트로 nickname='푸드피커 운영자' 를 저장한 뒤 sync 를 건너뛰는
--       것만으로 우회된다. 그래서 길이/금칙어 검증을 **표시 경로**인 이 함수에 내려둔다.
--       여기만 통과시키면 create_order / create_review / create_report 가 전부 자동 보호된다.
--       위반 닉네임은 오류가 아니라 기존 마스킹('정**')으로 조용히 폴백한다.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.buyer_display_name(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with src as (
    select nullif(btrim(u.raw_user_meta_data->>'nickname'), '') as nick,
           nullif(btrim(u.raw_user_meta_data->>'name'),     '') as name
      from auth.users u
     where u.id = p_uid
  )
  select coalesce(
    -- ① 닉네임: 검증 통과 시에만 전체 표시.
    --    · 길이 2~12자(btrim 후 기준) — 상한이 있으므로 별도 절단이 필요 없다.
    --    · 금칙어(사칭 방지)는 대소문자 무시. sync_my_display_name 의 검증과 동일 규칙.
    case
      when nick is not null
       and char_length(nick) between 2 and 12
       and nick !~* '(운영자|관리자|푸드피커|admin|foodpicker)'
      then nick
    end,
    -- ② 폴백: 기존 규칙 그대로 성만 노출(닉네임 미설정 또는 검증 위반)
    left(coalesce(name, '구매자'), 1) || '**'
  )
  from src;
$$;

revoke all on function public.buyer_display_name(uuid) from public;
revoke all on function public.buyer_display_name(uuid) from anon;
revoke all on function public.buyer_display_name(uuid) from authenticated;

comment on function public.buyer_display_name(uuid) is
  '주문/리뷰/문의 표시명의 정본. 닉네임(2~12자 · 금칙어 없음)이면 전체 표시, 아니면 성+**. '
  '내부(definer) 전용 — 클라이언트 호출 금지.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2) create_order v5 — 20260730000000 의 v4 와 본문 동일, 표시명 계산 2줄만 교체.
--    시그니처 (uuid, integer, uuid[], uuid, text, text, text, integer) 는 불변이다.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.create_order(
  p_product_id     uuid,
  p_quantity       integer default 1,
  p_coupon_ids     uuid[]  default '{}',
  p_buyer_id       uuid    default null,
  p_payment_key    text    default null,
  p_toss_order_id  text    default null,
  p_payment_method text    default null,
  p_paid_amount    integer default null
) returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := coalesce(auth.uid(), p_buyer_id);
  v_prod   public.products;
  v_store  public.stores;
  v_gross  integer;
  v_disc   integer;
  v_total  integer := 0;
  v_amount integer;
  v_fee    integer;
  v_name   text;
  v_order  public.orders;
  v_ids    uuid[];
  v_first_coupon uuid := null;
  v_valid  int := 0;
  v_nonstack int := 0;
  v_coupon_rows int;
  v_deadline_at  timestamptz;
  v_left_min     integer;
  v_reminded_at  timestamptz := null;
  v_now    timestamptz := now();
  c public.coupons%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_quantity < 1 then raise exception 'invalid quantity'; end if;

  select * into v_prod from public.products where id = p_product_id for update;
  if not found then raise exception 'product not found'; end if;
  if v_prod.status <> 'selling' then raise exception 'product not on sale'; end if;
  if v_prod.stock < p_quantity then raise exception 'insufficient stock'; end if;
  select * into v_store from public.stores where id = v_prod.store_id;
  if v_store.approval_status <> 'approved' then raise exception 'store not approved'; end if;
  if v_store.is_selling_paused or v_store.suspended_by_admin then
    raise exception 'store not accepting orders';
  end if;

  -- [v4] 픽업 마감 시각 — 상품값이 정본. 없으면 소비기한, 그마저 없으면 1시간 뒤.
  v_deadline_at := coalesce(v_prod.pickup_deadline_at, v_prod.expiry_date, v_now + interval '1 hour');
  -- 마감이 지난 상품은 주문 불가(픽업할 수 없는 주문을 만들지 않는다).
  if v_deadline_at <= v_now then
    raise exception 'pickup deadline passed';
  end if;
  -- 하위 호환용 '남은 분'(구 클라이언트 표시). 최소 1분.
  v_left_min := greatest(1, ceil(extract(epoch from (v_deadline_at - v_now)) / 60))::int;

  v_gross := v_prod.sale_price * p_quantity;

  select coalesce(array_agg(distinct x), '{}')
    into v_ids
    from unnest(coalesce(p_coupon_ids, '{}')) as x
    where x is not null;

  if array_length(v_ids, 1) is not null then
    for c in
      select * from public.coupons
       where id = any(v_ids) and is_active
         and (request_status is null or request_status = 'approved')
         and (starts_on is null or starts_on <= current_date)
         and (ends_on is null or ends_on >= current_date)
         and exists (select 1 from public.user_coupons uc
                      where uc.coupon_id = coupons.id and uc.buyer_id = v_uid and not uc.is_used)
    loop
      if c.seller_id is not null and c.seller_id <> v_prod.seller_id then
        raise exception 'coupon not valid for this store';
      end if;
      if v_gross < c.min_order_amount then
        raise exception 'order below coupon minimum';
      end if;
      v_valid := v_valid + 1;
      if not c.allow_stacking then v_nonstack := v_nonstack + 1; end if;
      if v_first_coupon is null then v_first_coupon := c.id; end if;

      v_disc := case when c.discount_type = 'amount' then c.discount_value
                     else floor(v_gross * c.discount_value / 100.0) end;
      if c.discount_type = 'rate' and c.max_discount_amount is not null then
        v_disc := least(v_disc, c.max_discount_amount);
      end if;
      v_total := v_total + v_disc;

      update public.user_coupons set is_used = true, used_at = now()
       where buyer_id = v_uid and coupon_id = c.id and not is_used;
      get diagnostics v_coupon_rows = row_count;
      if v_coupon_rows = 0 then
        raise exception 'coupon already used';
      end if;
    end loop;

    if v_valid > 1 and v_nonstack > 0 then
      raise exception 'coupon not stackable';
    end if;
    v_total := least(v_total, v_gross);
  end if;

  v_amount := v_gross - v_total;

  if p_paid_amount is not null and p_paid_amount <> v_amount then
    raise exception 'amount mismatch: server=%', v_amount;
  end if;
  if v_amount > 0 and p_payment_key is null then
    raise exception 'payment required';
  end if;

  v_fee := round(v_amount * coalesce(v_store.commission_rate, 10) / 100.0);

  -- [v5] 표시명: 닉네임 전체 → 미설정이면 기존 마스킹('정**') 폴백.
  --      v4 의 두 줄(raw_user_meta_data->>'name' 조회 + left(...,1)||'**')을 대체한다.
  v_name := coalesce(public.buyer_display_name(v_uid), '구매자');

  -- 주문 시점에 이미 마감까지 30분 미만이면 사전 알림이 불가능하다 → 즉시 1회 발송하고
  -- 배치가 중복 발송하지 않도록 여기서 발송 시각을 찍는다.
  if v_deadline_at <= v_now + interval '30 minutes' then
    v_reminded_at := v_now;
  end if;

  insert into public.orders
    (seller_id, store_id, product_id, product_name, quantity, store_name, store_address,
     buyer_id, buyer_name, safe_number,
     pickup_start, pickup_end, pickup_deadline_minutes, pickup_deadline_at, pickup_reminder_sent_at,
     payment_status, seller_status, total_price, amount, fee, coupon_id, coupon_discount_amount,
     payment_key, toss_order_id, payment_method)
  values
    (v_prod.seller_id, v_prod.store_id, v_prod.id, v_prod.name, p_quantity, v_store.name, v_store.address,
     v_uid, v_name, '050-0000-0000',
     v_now, v_deadline_at, v_left_min, v_deadline_at, v_reminded_at,
     'paid', 'new', v_gross, v_amount, v_fee, v_first_coupon, v_total,
     p_payment_key, p_toss_order_id, p_payment_method)
  returning * into v_order;

  update public.products set stock = stock - p_quantity where id = v_prod.id;

  insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
  values (v_prod.seller_id, 'order', '신규 주문',
          v_order.order_code || ' · ' || v_prod.name || ' ' || p_quantity || '개 주문이 접수되었습니다.',
          'order', v_order.id);

  insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
  values (v_uid, 'order', '주문 완료',
          v_prod.name || ' 주문이 접수되었습니다. '
            || to_char(v_deadline_at at time zone 'Asia/Seoul', 'HH24:MI') || ' 까지 픽업해주세요.',
          'order', v_order.id);

  -- 마감 임박 주문: 사전 알림 대신 즉시 안내(사용자 선택 정책).
  if v_reminded_at is not null then
    insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
    values (v_uid, 'order', '픽업 마감 임박',
            v_prod.name || ' · 픽업 마감이 '
              || to_char(v_deadline_at at time zone 'Asia/Seoul', 'HH24:MI')
              || ' (약 ' || v_left_min || '분 뒤) 입니다. 지금 출발해주세요!',
            'order', v_order.id);
  end if;

  return v_order;
end; $$;

-- 권한 재확인(create or replace 는 권한을 보존하지만 v4 와 동일하게 방어적으로 재선언).
revoke all on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) from public;
revoke all on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) from anon;
revoke all on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) from authenticated;
grant execute on function public.create_order(uuid, integer, uuid[], uuid, text, text, text, integer) to service_role;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3) create_review — 20260711000000_consumer_features.sql:160-195 와 본문 동일,
--    표시명 계산 2줄(179-180)만 교체.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.create_review(
  p_order_code text, p_rating integer, p_content text, p_images text[] default '{}')
returns public.reviews
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders;
  v_name  text;
  v_review public.reviews;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_rating < 1 or p_rating > 5 then raise exception 'invalid rating'; end if;

  select * into v_order from public.orders where order_code = p_order_code and buyer_id = v_uid;
  if not found then raise exception 'order not found'; end if;
  if v_order.seller_status <> 'completed' then raise exception 'order not completed'; end if;
  if exists (select 1 from public.reviews where order_id = v_order.id) then raise exception 'already reviewed'; end if;

  -- 표시명: 닉네임 전체 → 미설정이면 기존 마스킹 폴백.
  v_name := coalesce(public.buyer_display_name(v_uid), '구매자');

  insert into public.reviews
    (seller_id, store_id, product_id, order_id, reviewer_id, reviewer_name, rating, content, helpful_count, images)
  values
    (v_order.seller_id, v_order.store_id, v_order.product_id, v_order.id, v_uid, v_name, p_rating, p_content, 0,
     coalesce(p_images, '{}'))
  returning * into v_review;

  insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
  values (v_uid, 'review', '리뷰 등록', '소중한 리뷰 감사합니다.', 'review', v_review.id);

  return v_review;
end; $$;
revoke all on function public.create_review(text, integer, text, text[]) from public;
revoke all on function public.create_review(text, integer, text, text[]) from anon;
grant execute on function public.create_review(text, integer, text, text[]) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4) create_report — 20260722020000_report_inquirer_product_media.sql:25-86 과
--    본문 동일, buyer_name 마스킹 계산(74-75)만 교체.
--    (drop 하지 않는다 — 동일 시그니처 replace)
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.create_report(
  p_type text,
  p_title text,
  p_content text,
  p_order_code text default null,
  p_evidence jsonb default '[]',
  p_inquirer text default null      -- 'buyer' | 'seller' | null(휴리스틱)
) returns public.reports
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_store public.stores;
  v_order public.orders;
  v_row   public.reports;
  v_inquirer text := 'buyer';
  v_has_store boolean := false;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_title is null or trim(p_title) = '' then raise exception 'title required'; end if;
  if p_inquirer is not null and p_inquirer not in ('buyer','seller') then
    raise exception 'invalid inquirer';
  end if;

  select * into v_store from public.stores where seller_id = v_uid;
  v_has_store := found;

  if p_inquirer = 'buyer' then
    v_inquirer := 'buyer';
    v_store := null;                -- 구매자 문의에 본인 매장 정보가 붙지 않게 초기화
  elsif p_inquirer = 'seller' then
    if not v_has_store then raise exception 'not a seller'; end if;
    v_inquirer := 'seller';
  elsif v_has_store then
    v_inquirer := 'seller';         -- 기존 휴리스틱(구버전 클라이언트 호환)
  end if;

  if p_order_code is not null then
    select * into v_order from public.orders where order_code = upper(trim(p_order_code))
      and (buyer_id = v_uid or seller_id = v_uid);
    if not found then raise exception 'order not found'; end if;
  end if;

  insert into public.reports
    (inquirer_type, reporter_id, type, order_id, order_code, buyer_name,
     store_id, seller_id, store_name, product_id, title, content, evidence)
  values
    (v_inquirer, v_uid, coalesce(p_type, '기타'),
     v_order.id, v_order.order_code,
     -- 주문이 있으면 그 스냅샷을 재사용하고, 없으면 현재 표시명(닉네임 우선)을 만든다.
     case when v_inquirer = 'buyer'
          then coalesce(v_order.buyer_name, public.buyer_display_name(v_uid), '구매자') end,
     coalesce(v_order.store_id, v_store.id),
     coalesce(v_order.seller_id, v_store.seller_id),
     coalesce(v_order.store_name, v_store.name),
     v_order.product_id,
     p_title, p_content, coalesce(p_evidence, '[]'::jsonb))
  returning * into v_row;

  return v_row;
end; $$;
revoke all on function public.create_report(text,text,text,text,jsonb,text) from public;
revoke all on function public.create_report(text,text,text,text,jsonb,text) from anon;
grant execute on function public.create_report(text,text,text,text,jsonb,text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5) 닉네임 변경 반영 RPC
--    클라이언트가 supabase.auth.updateUser({ data: { nickname } }) 로 저장한 직후 호출한다.
--    · 완료/취소 주문의 buyer_name 은 스냅샷으로 보존한다(증빙·정산 이력).
--    · 진행 중(new/confirmed) 주문만 갱신 → 판매자가 픽업 현장에서 현재 닉네임을 본다.
--    · 리뷰(reviewer_name)는 작성 시점 스냅샷을 유지한다(작성 후 이름 세탁 방지).
--    반환: 실제 적용된 표시명.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.sync_my_display_name()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_name text;
  v_nick text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select nullif(btrim(u.raw_user_meta_data->>'nickname'), '')
    into v_nick
    from auth.users u where u.id = v_uid;

  -- [역할 구분] 여기의 raise 는 **사용자 피드백용**이다 — 앱이 '2~12자로 입력해주세요' 같은
  -- 안내를 띄우게 한다. 우회 방어(정본 검증)는 표시 경로인 buyer_display_name 안에 있다.
  -- 두 곳의 규칙(2~12자 / 금칙어 정규식)은 항상 같이 고쳐야 한다.
  if v_nick is not null then
    if char_length(v_nick) < 2 or char_length(v_nick) > 12 then
      raise exception 'NICKNAME_LENGTH';
    end if;
    if v_nick ~* '(운영자|관리자|푸드피커|admin|foodpicker)' then
      raise exception 'NICKNAME_RESERVED';
    end if;
  end if;

  v_name := coalesce(public.buyer_display_name(v_uid), '구매자');

  update public.orders
     set buyer_name = v_name
   where buyer_id = v_uid
     and seller_status in ('new', 'confirmed')
     and buyer_name is distinct from v_name;

  return v_name;
end; $$;

revoke all on function public.sync_my_display_name() from public;
revoke all on function public.sync_my_display_name() from anon;
grant execute on function public.sync_my_display_name() to authenticated;

comment on function public.sync_my_display_name() is
  '닉네임 저장 직후 호출. 진행 중(new/confirmed) 본인 주문의 buyer_name 만 갱신하고 최종 표시명을 반환한다.';

-- ============================================================================
-- 운영 유틸 SQL (전부 주석 — 실행 여부는 운영자가 판단한다)
-- ============================================================================

-- ── [U1] 기존 마스킹 행 백필 ────────────────────────────────────────────────
--   이미 닉네임을 설정한 계정에 한해 진행 중 주문만 새 표시명으로 교체한다.
--   앱 배포 이후 1회 실행 권장(완료/취소 주문은 손대지 않는다).
--   -- update public.orders o
--   --    set buyer_name = public.buyer_display_name(o.buyer_id)
--   --  where o.seller_status in ('new','confirmed')
--   --    and o.buyer_id is not null
--   --    and exists (select 1 from auth.users u
--   --                 where u.id = o.buyer_id
--   --                   and nullif(btrim(u.raw_user_meta_data->>'nickname'), '') is not null)
--   --    and o.buyer_name is distinct from public.buyer_display_name(o.buyer_id);

-- ── [U2] 확인용 ─────────────────────────────────────────────────────────────
--   -- select order_code, buyer_name, seller_status, ordered_at
--   --   from public.orders order by ordered_at desc limit 10;
--
--   -- 닉네임 설정 현황(개인정보이므로 집계로만 확인)
--   -- select count(*) filter (where nullif(btrim(raw_user_meta_data->>'nickname'), '') is not null) as with_nick,
--   --        count(*) as total
--   --   from auth.users;
--
--   -- 함수 시그니처가 의도대로 1개씩만 존재하는지(오버로드 사고 방지)
--   -- select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef
--   --   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   --  where n.nspname = 'public'
--   --    and p.proname in ('create_order','create_review','create_report',
--   --                      'buyer_display_name','sync_my_display_name')
--   --  order by p.proname;
-- ============================================================================
