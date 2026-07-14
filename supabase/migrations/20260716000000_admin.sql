-- ============================================================================
-- FoodPicker 관리자 웹(foodpicker_admin) 백엔드 (2026-07-14)
--   브라우저 SPA(anon key + Supabase Auth)가 전 판매자/전 주문 데이터에 접근하기 위한
--   관리자 판별·RLS·RPC·신규 테이블 일체.
--
--   설계 원칙
--   - 관리자 판별: admin_profiles 테이블 기반 is_admin() (service_role/Admin API 불필요,
--     비활성화 즉시 효력. JWT app_metadata 방식 대비 revoke가 쉬움)
--   - 읽기: admin RLS SELECT 정책 + 조인/집계가 필요한 곳은 is_admin() 게이트 뷰(admin_*)
--   - 쓰기: 컬럼 잠금(stores/orders/reviews)과 충돌하는 변경은 전부 security definer RPC
--     (내부에서 is_admin() 강제 + admin_action_logs 기록). 관리자 전용 테이블은 직접 CRUD.
--
--   ⚠️ 적용 순서: 20260706 ~ 20260715 마이그레이션이 모두 선행되어야 한다
--   (notices/coupons/user_coupons/buyer_notifications 등 참조). 특히
--   20260715000000_coupon_checkout.sql 먼저 실행 후 본 파일 실행.
--   재실행 안전. 적대적 검증(보안/정합/호환 3렌즈) 반영본.
-- ============================================================================

-- ── 0) 관리자 프로필 + is_admin() ────────────────────────────────────────────
create table if not exists public.admin_profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  name          text not null,
  email         text not null,
  role          text not null default 'viewer',   -- super/ops/settlement/cs/viewer
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint admin_profiles_role_chk check (role in ('super','ops','settlement','cs','viewer'))
);
drop trigger if exists trg_admin_profiles_updated on public.admin_profiles;
create trigger trg_admin_profiles_updated
  before update on public.admin_profiles for each row execute function public.set_updated_at();

-- 관리자 여부. security definer(소유자=postgres)라 admin_profiles RLS와 무관(재귀 없음).
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_profiles ap
    where ap.user_id = auth.uid() and ap.is_active
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.admin_profiles enable row level security;
drop policy if exists admin_profiles_select on public.admin_profiles;
create policy admin_profiles_select on public.admin_profiles for select to authenticated
  using ((select public.is_admin()));
-- insert/update 정책 없음 → admin_add_account/admin_update_account RPC 로만 변경.

-- ── 1) 관리자 감사 로그 · 엑셀 다운로드 로그 ─────────────────────────────────
create table if not exists public.admin_action_logs (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references auth.users(id) on delete set null,
  admin_name  text not null default '',
  action      text not null,          -- 예: '판매자 승인', '주문 환불'
  target_type text,                   -- store/product/order/settlement/review/coupon/report/admin/notice/banner/category/settings
  target_id   text,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_admin_action_logs_created on public.admin_action_logs(created_at desc);
alter table public.admin_action_logs enable row level security;
drop policy if exists admin_action_logs_select on public.admin_action_logs;
drop policy if exists admin_action_logs_insert on public.admin_action_logs;
create policy admin_action_logs_select on public.admin_action_logs for select to authenticated
  using ((select public.is_admin()));
create policy admin_action_logs_insert on public.admin_action_logs for insert to authenticated
  with check ((select public.is_admin()) and admin_id = auth.uid());

-- RPC 내부에서 공용으로 쓰는 로그 헬퍼(definer 내부 전용).
-- Supabase 는 default privileges 로 신규 함수에 anon/authenticated EXECUTE 를 자동 부여하므로
-- public 만이 아니라 역할별로 명시 revoke 해야 클라 직접 호출(감사 로그 위조)이 차단된다.
-- (definer 함수 내부 호출은 소유자 권한으로 실행되므로 revoke 와 무관하게 동작)
create or replace function public.log_admin_action(p_action text, p_target_type text, p_target_id text, p_detail text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;  -- 심층 방어
  insert into public.admin_action_logs (admin_id, admin_name, action, target_type, target_id, detail)
  values (
    auth.uid(),
    coalesce((select name from public.admin_profiles where user_id = auth.uid()), ''),
    p_action, p_target_type, p_target_id, p_detail
  );
end; $$;
revoke all on function public.log_admin_action(text,text,text,text) from public, anon, authenticated;

create table if not exists public.download_logs (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid references auth.users(id) on delete set null,
  admin_name text not null default '',
  menu       text not null,
  filters    text not null default '없음',
  row_count  integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_download_logs_created on public.download_logs(created_at desc);
alter table public.download_logs enable row level security;
drop policy if exists download_logs_select on public.download_logs;
drop policy if exists download_logs_insert on public.download_logs;
create policy download_logs_select on public.download_logs for select to authenticated
  using ((select public.is_admin()));
create policy download_logs_insert on public.download_logs for insert to authenticated
  with check ((select public.is_admin()) and admin_id = auth.uid());

-- ── 2) 신규 도메인 테이블: 신고/문의(reports) + 처리 이력 ────────────────────
create sequence if not exists report_code_seq start 1;

-- 코드 발번 포맷터: 999 이하는 3자리 0패딩, 그 이상은 절단 없이 그대로(lpad 절단 → unique 충돌 방지)
create or replace function public.fmt_seq_code(n bigint)
returns text immutable language sql
as $$ select case when n < 1000 then lpad(n::text, 3, '0') else n::text end $$;

create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  receipt_code  text not null unique
                  default ('RPT-' || to_char(now() at time zone 'Asia/Seoul', 'YYMM')
                           || '-' || public.fmt_seq_code(nextval('report_code_seq'))),
  inquirer_type text not null check (inquirer_type in ('buyer','seller')),
  reporter_id   uuid references auth.users(id) on delete set null,
  type          text not null,                      -- 유형 텍스트(앱 프리셋)
  order_id      uuid references public.orders(id) on delete set null,
  order_code    text,                               -- 스냅샷
  buyer_name    text,                               -- 스냅샷(마스킹 표시명)
  store_id      uuid references public.stores(id) on delete set null,
  seller_id     uuid references auth.users(id) on delete set null,
  store_name    text,                               -- 스냅샷
  product_id    uuid references public.products(id) on delete set null,
  review_id     uuid references public.reviews(id) on delete set null,
  title         text not null,
  content       text,
  evidence      jsonb not null default '[]',        -- [{type:'image'|'video', url}]
  status        text not null default 'received'
                  check (status in ('received','checking','awaiting_seller','awaiting_buyer','refunded','closed')),
  manager       text,                               -- 담당 관리자 표시명
  admin_memo    text,                               -- CS 내부 메모(문의자 비노출)
  received_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_reports_status   on public.reports(status, received_at desc);
create index if not exists idx_reports_store    on public.reports(store_id);
create index if not exists idx_reports_reporter on public.reports(reporter_id);
create index if not exists idx_reports_review   on public.reports(review_id);
create index if not exists idx_reports_product  on public.reports(product_id);
-- 같은 사용자의 같은 리뷰 반복 신고 차단(report_count 부풀리기 방지)
create unique index if not exists reports_uq_review_reporter
  on public.reports(reporter_id, review_id) where review_id is not null;
drop trigger if exists trg_reports_updated on public.reports;
create trigger trg_reports_updated
  before update on public.reports for each row execute function public.set_updated_at();

alter table public.reports enable row level security;
drop policy if exists reports_admin_select    on public.reports;
drop policy if exists reports_admin_update    on public.reports;
drop policy if exists reports_reporter_select on public.reports;
create policy reports_admin_select on public.reports for select to authenticated
  using ((select public.is_admin()));
create policy reports_admin_update on public.reports for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- INSERT 정책 없음 → create_report RPC 로만 생성(스냅샷 서버 강제).
-- 문의자 본인 조회는 원본 테이블 정책이 아니라 아래 my_reports 뷰로만 제공
-- (행 정책 + 전컬럼 grant 조합이면 문의자가 ?select=admin_memo 로 CS 내부 메모를 읽을 수 있기 때문).

-- 문의자 앱 노출용 뷰: 내부 메모/담당자 등 CS 전용 컬럼 제외
drop view if exists public.my_reports;
create view public.my_reports with (security_barrier) as
  select id, receipt_code, inquirer_type, type, order_code, store_name,
         title, content, evidence, status, received_at, created_at, updated_at
    from public.reports
   where reporter_id = auth.uid();
grant select on public.my_reports to authenticated;

create table if not exists public.report_logs (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports(id) on delete cascade,
  admin_name text not null default '',
  kind       text not null default 'system' check (kind in ('status','reply','refund','memo','system')),
  message    text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_report_logs_report on public.report_logs(report_id, created_at);
alter table public.report_logs enable row level security;
drop policy if exists report_logs_admin_select    on public.report_logs;
drop policy if exists report_logs_admin_insert    on public.report_logs;
drop policy if exists report_logs_reporter_select on public.report_logs;
create policy report_logs_admin_select on public.report_logs for select to authenticated
  using ((select public.is_admin()));
create policy report_logs_admin_insert on public.report_logs for insert to authenticated
  with check ((select public.is_admin()));
-- 문의자는 '답변(reply)'만 조회 가능(앱의 답변 노출용)
create policy report_logs_reporter_select on public.report_logs for select to authenticated
  using (kind = 'reply' and exists (
    select 1 from public.reports r where r.id = report_id and r.reporter_id = auth.uid()));

-- 앱(구매자/판매자)에서 신고·문의 생성. 스냅샷은 서버가 채움.
create or replace function public.create_report(
  p_type text,
  p_title text,
  p_content text,
  p_order_code text default null,
  p_evidence jsonb default '[]'
) returns public.reports
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_store public.stores;
  v_order public.orders;
  v_row   public.reports;
  v_inquirer text := 'buyer';
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_title is null or trim(p_title) = '' then raise exception 'title required'; end if;

  select * into v_store from public.stores where seller_id = v_uid;
  if found then v_inquirer := 'seller'; end if;

  if p_order_code is not null then
    select * into v_order from public.orders where order_code = p_order_code
      and (buyer_id = v_uid or seller_id = v_uid);
    if not found then raise exception 'order not found'; end if;
  end if;

  insert into public.reports
    (inquirer_type, reporter_id, type, order_id, order_code, buyer_name,
     store_id, seller_id, store_name, product_id, title, content, evidence)
  values
    (v_inquirer, v_uid, coalesce(p_type, '기타'),
     v_order.id, v_order.order_code,
     case when v_inquirer = 'buyer' then coalesce(v_order.buyer_name,
       left(coalesce(nullif((select raw_user_meta_data->>'name' from auth.users where id = v_uid), ''), '구매자'), 1) || '**') end,
     coalesce(v_order.store_id, v_store.id),
     coalesce(v_order.seller_id, v_store.seller_id),
     coalesce(v_order.store_name, v_store.name),
     v_order.product_id,
     p_title, p_content, coalesce(p_evidence, '[]'::jsonb))
  returning * into v_row;

  return v_row;
end; $$;
revoke all on function public.create_report(text,text,text,text,jsonb) from public;
grant execute on function public.create_report(text,text,text,text,jsonb) to authenticated;

-- ── 3) 리뷰 모더레이션 컬럼 + 리뷰 신고 ─────────────────────────────────────
alter table public.reviews add column if not exists moderation_status text not null default 'normal';
alter table public.reviews add column if not exists report_count integer not null default 0;
alter table public.reviews add column if not exists admin_memo text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'reviews_moderation_chk') then
    alter table public.reviews add constraint reviews_moderation_chk check (moderation_status in
      ('normal','hidden','deleted','flagged','flagged_normal','flagged_hidden','flagged_deleted'));
  end if;
end $$;

-- 공개 리뷰 뷰: 숨김/삭제 처리된 리뷰 제외(컬럼 구성은 기존과 동일 + images)
create or replace view public.public_reviews as
  select id, store_id, product_id, reviewer_name, rating, content, helpful_count,
         owner_reply, owner_replied_at, created_at, images
    from public.reviews
   where moderation_status in ('normal','flagged','flagged_normal');
grant select on public.public_reviews to anon, authenticated;

-- 매장 평점 재집계: 숨김/삭제 리뷰 제외하도록 개정 + moderation 변경 시에도 재집계
create or replace function public.refresh_store_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_store uuid;
begin
  v_store := coalesce(new.store_id, old.store_id);
  update public.stores s set
    rating = coalesce((select round(avg(rating)::numeric, 1) from public.reviews r
                        where r.store_id = v_store
                          and r.moderation_status in ('normal','flagged','flagged_normal')), 0),
    review_count = (select count(*) from public.reviews r
                     where r.store_id = v_store
                       and r.moderation_status in ('normal','flagged','flagged_normal'))
  where s.id = v_store;
  return null;
end; $$;
drop trigger if exists trg_reviews_moderation_aggregate on public.reviews;
create trigger trg_reviews_moderation_aggregate
  after update of moderation_status on public.reviews
  for each row execute function public.refresh_store_rating();

-- 구매자 리뷰 신고(고객앱 연동 계약): reports 생성 + 카운트 증가 + 검토 플래그
create or replace function public.report_review(p_review_id uuid, p_reason text default null)
returns public.reports
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_review public.reviews;
  v_row public.reports;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_review from public.reviews where id = p_review_id;
  if not found then raise exception 'review not found'; end if;
  if exists (select 1 from public.reports where reporter_id = v_uid and review_id = p_review_id) then
    raise exception 'already reported';
  end if;

  insert into public.reports
    (inquirer_type, reporter_id, type, store_id, seller_id, store_name, product_id, review_id,
     title, content)
  select 'buyer', v_uid, '리뷰 신고', v_review.store_id, v_review.seller_id, s.name,
         v_review.product_id, v_review.id,
         '리뷰 신고: ' || coalesce(left(v_review.content, 30), ''), p_reason
    from public.stores s where s.id = v_review.store_id
  returning * into v_row;

  update public.reviews
     set report_count = report_count + 1,
         moderation_status = case when moderation_status = 'normal' then 'flagged' else moderation_status end
   where id = p_review_id;

  return v_row;
end; $$;
revoke all on function public.report_review(uuid,text) from public;
grant execute on function public.report_review(uuid,text) to authenticated;

-- ── 4) 배너 / 카테고리 / 플랫폼 설정 ────────────────────────────────────────
create table if not exists public.banners (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  image_url  text,
  link       text,
  position   text not null default 'main_top' check (position in ('main_top','main_middle','main_bottom')),
  start_date date,
  end_date   date,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_banners_updated on public.banners;
create trigger trg_banners_updated
  before update on public.banners for each row execute function public.set_updated_at();
alter table public.banners enable row level security;
drop policy if exists banners_public_select on public.banners;
drop policy if exists banners_admin_all     on public.banners;
create policy banners_public_select on public.banners for select to anon, authenticated
  using (is_active = true or (select public.is_admin()));
create policy banners_admin_all on public.banners for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  icon          text not null default '📦',
  display_order integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
drop trigger if exists trg_categories_updated on public.categories;
create trigger trg_categories_updated
  before update on public.categories for each row execute function public.set_updated_at();
alter table public.categories enable row level security;
drop policy if exists categories_public_select on public.categories;
drop policy if exists categories_admin_all     on public.categories;
create policy categories_public_select on public.categories for select to anon, authenticated
  using (is_active = true or (select public.is_admin()));
create policy categories_admin_all on public.categories for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.categories (name, icon, display_order) values
  ('빵', '🍞', 1), ('도시락', '🍱', 2), ('샐러드', '🥗', 3), ('반찬', '🥘', 4),
  ('디저트', '🍰', 5), ('음료', '🧃', 6), ('기타', '📦', 7)
on conflict (name) do nothing;

create table if not exists public.platform_settings (
  id                        integer primary key default 1 check (id = 1),  -- 단일 행
  site_name                 text not null default 'FoodPicker',
  notify_email              text not null default '',
  default_commission_rate   integer not null default 10 check (default_commission_rate between 0 and 100),
  settlement_cycle          text not null default 'weekly' check (settlement_cycle in ('weekly','biweekly','monthly')),
  auto_expire_check         boolean not null default true,
  report_threshold          integer not null default 3,
  max_report_before_suspend integer not null default 5,
  auto_pickup_timeout       integer not null default 30,
  allow_guest_order         boolean not null default false,
  updated_at                timestamptz not null default now()
);
insert into public.platform_settings (id) values (1) on conflict (id) do nothing;
drop trigger if exists trg_platform_settings_updated on public.platform_settings;
create trigger trg_platform_settings_updated
  before update on public.platform_settings for each row execute function public.set_updated_at();
alter table public.platform_settings enable row level security;
drop policy if exists platform_settings_admin_select on public.platform_settings;
drop policy if exists platform_settings_admin_update on public.platform_settings;
create policy platform_settings_admin_select on public.platform_settings for select to authenticated
  using ((select public.is_admin()));
create policy platform_settings_admin_update on public.platform_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── 5) 기존 테이블 관리자 컬럼 ───────────────────────────────────────────────
-- admin_memo 는 반려/정지/보류 '사유 통지' 겸용이라 해당 행 소유자(판매자)에게 보이는 것이 의도.
-- (CS 내부 전용 메모는 reports.admin_memo — my_reports 뷰로 문의자에게 숨김)
alter table public.stores      add column if not exists admin_memo text;
alter table public.orders      add column if not exists admin_memo text;
alter table public.settlements add column if not exists admin_memo text;
alter table public.products    add column if not exists admin_memo text;
-- 관리자 이용정지 전용 플래그: is_selling_paused(판매자 자율 토글, 판매자 UPDATE grant 포함)와 분리
-- → 판매자가 스스로 해제 불가. create_order 가 주문 생성을 차단(§11).
alter table public.stores      add column if not exists suspended_by_admin boolean not null default false;
-- 20260715 미적용 대비 가드(정산 회계 자체는 20260715 담당)
alter table public.settlements add column if not exists coupon_burden integer not null default 0;

-- 쿠폰 승인/반려 알림(trg_notify_coupon_decision, 20260714)이 reference_type='coupon' 을 쓰는데
-- init 의 notifications_ref_chk 허용 목록에 없어 승인 UPDATE 가 23514 로 실패한다 → 'coupon' 추가.
alter table public.notifications drop constraint if exists notifications_ref_chk;
alter table public.notifications add constraint notifications_ref_chk check (
  reference_type is null or reference_type in ('order','product','settlement','review','notice','coupon'));

-- products: admin_memo 를 판매자가 못 쓰도록 컬럼 잠금(stores/orders/reviews 패턴).
-- 판매자 앱 productToDb 화이트리스트와 동일한 허용 목록만 재부여.
revoke update on public.products from authenticated;
grant update (
  name, category, emoji, thumbnail, images,
  original_price, start_price, floor_price, sale_price, discount_rate,
  reduction_amount, interval_minutes, stock,
  pickup_start, pickup_end, expiry_date, storage, storage_detail,
  status, pause_reason, description, composition, origin, allergens,
  cancel_policy, store_notice, pickup_address, lat, lng
) on public.products to authenticated;
-- 의도적 제외: seller_id, store_id, last_reduced_at(스케줄러), reject_reason(관리자), admin_memo(관리자)

-- coupons: 시작일/발급대상(관리자 페이지 입력 항목)
alter table public.coupons add column if not exists starts_on date;
alter table public.coupons add column if not exists target text not null default '전체';

-- notices: 대상/기간/중요 표시(관리자 공지 관리)
alter table public.notices add column if not exists target text not null default 'all';
alter table public.notices add column if not exists start_date date;
alter table public.notices add column if not exists end_date date;
alter table public.notices add column if not exists is_important boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'notices_target_chk') then
    alter table public.notices add constraint notices_target_chk check (target in ('all','buyer','seller'));
  end if;
end $$;

-- ── 6) 관리자 RLS 정책 (읽기 + 안전한 직접 쓰기) ─────────────────────────────
-- 읽기: 전 행 조회
drop policy if exists stores_admin_select      on public.stores;
drop policy if exists products_admin_select    on public.products;
drop policy if exists orders_admin_select      on public.orders;
drop policy if exists reviews_admin_select     on public.reviews;
drop policy if exists settlements_admin_select on public.settlements;
drop policy if exists pph_admin_select         on public.product_price_history;
-- (select public.is_admin()) 래핑 = initplan 강제 → 판매자/구매자 쿼리에서 행마다 재평가 방지(RLS 성능 가이드 패턴)
create policy stores_admin_select on public.stores for select to authenticated
  using ((select public.is_admin()));
create policy products_admin_select on public.products for select to authenticated
  using ((select public.is_admin()));
create policy orders_admin_select on public.orders for select to authenticated
  using ((select public.is_admin()));
create policy reviews_admin_select on public.reviews for select to authenticated
  using ((select public.is_admin()));
create policy settlements_admin_select on public.settlements for select to authenticated
  using ((select public.is_admin()));
create policy pph_admin_select on public.product_price_history for select to authenticated
  using ((select public.is_admin()));

-- coupons: 관리자는 비활성/대기/반려 포함 전체 조회 + 직접 발행/수정(컬럼 잠금 없음)
drop policy if exists coupons_select       on public.coupons;
drop policy if exists coupons_admin_insert on public.coupons;
drop policy if exists coupons_admin_update on public.coupons;
create policy coupons_select on public.coupons for select to anon, authenticated
  using (is_active = true or seller_id = auth.uid() or (select public.is_admin()));
create policy coupons_admin_insert on public.coupons for insert to authenticated
  with check ((select public.is_admin()));
create policy coupons_admin_update on public.coupons for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- notices: 관리자는 미게시 포함 전체 조회 + 직접 CRUD
drop policy if exists notices_admin_select on public.notices;
drop policy if exists notices_admin_write  on public.notices;
drop policy if exists notices_admin_update on public.notices;
drop policy if exists notices_admin_delete on public.notices;
create policy notices_admin_select on public.notices for select to authenticated
  using ((select public.is_admin()));
create policy notices_admin_write on public.notices for insert to authenticated
  with check ((select public.is_admin()));
create policy notices_admin_update on public.notices for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy notices_admin_delete on public.notices for delete to authenticated
  using ((select public.is_admin()));
-- notice_code default 발번용(INSERT 는 RLS 로 관리자만 가능. PostgREST 는 nextval 직접 노출 안 함)
-- 20260708 미적용 DB 방어: 시퀀스가 없으면 생성 후 default 도 부여
create sequence if not exists notice_code_seq start 1;
alter table public.notices alter column notice_code
  set default ('NC-' || lpad(nextval('notice_code_seq')::text, 3, '0'));
grant usage, select on sequence notice_code_seq to authenticated;

-- ── 7) 관리자 조회용 뷰 (auth.users 조인·집계 포함, is_admin() 게이트) ────────
drop view if exists public.admin_stores;
create view public.admin_stores with (security_barrier) as
  select s.*,
         u.email,
         (select count(*) from public.orders o where o.store_id = s.id)::int as total_orders,
         (select count(*) from public.reports r
           where r.store_id = s.id and r.inquirer_type = 'buyer')::int as report_count
    from public.stores s
    left join auth.users u on u.id = s.seller_id
   where (select public.is_admin());
grant select on public.admin_stores to authenticated;

drop view if exists public.admin_products;
create view public.admin_products with (security_barrier) as
  select p.*,
         s.name as store_name,
         (select count(*) from public.reports r where r.product_id = p.id)::int as report_count
    from public.products p
    left join public.stores s on s.id = p.store_id
   where (select public.is_admin());
grant select on public.admin_products to authenticated;

drop view if exists public.admin_reviews;
create view public.admin_reviews with (security_barrier) as
  select r.*,
         p.name as product_name,
         s.name as store_name
    from public.reviews r
    left join public.products p on p.id = r.product_id
    left join public.stores s   on s.id = r.store_id
   where (select public.is_admin());
grant select on public.admin_reviews to authenticated;

drop view if exists public.admin_settlements;
create view public.admin_settlements with (security_barrier) as
  select st.*,
         s.name as store_name,
         s.biz_number,
         s.bank_name,
         s.account_number,
         s.account_holder
    from public.settlements st
    left join public.stores s on s.id = st.store_id
   where (select public.is_admin());
grant select on public.admin_settlements to authenticated;

drop view if exists public.admin_coupons;
create view public.admin_coupons with (security_barrier) as
  select c.*,
         s.name as store_name,
         (select count(*) from public.user_coupons uc where uc.coupon_id = c.id)::int as claimed_count,
         (select count(*) from public.user_coupons uc where uc.coupon_id = c.id and uc.is_used)::int as used_count
    from public.coupons c
    left join public.stores s on s.seller_id = c.seller_id
   where (select public.is_admin());
grant select on public.admin_coupons to authenticated;

-- ── 8) 관리자 쓰기 RPC (컬럼 잠금 우회 + 감사 로그) ──────────────────────────
-- 매장 승인/반려
create or replace function public.admin_set_store_approval(
  p_store_id uuid, p_status store_approval_status, p_reason text default null
) returns public.stores
language plpgsql security definer set search_path = public
as $$
declare v_row public.stores;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.stores
     set approval_status = p_status,
         admin_memo = coalesce(p_reason, admin_memo)
   where id = p_store_id
  returning * into v_row;
  if not found then raise exception 'store not found'; end if;

  insert into public.notifications (seller_id, type, title, message, reference_type)
  values (v_row.seller_id,
          case when p_status = 'approved' then 'system'::notification_type else 'reject'::notification_type end,
          case when p_status = 'approved' then '매장 승인 완료'
               when p_status = 'rejected' then '매장 승인 반려'
               else '매장 심사 진행' end,
          case when p_status = 'approved' then '매장 정보가 승인되었습니다.'
               when p_status = 'rejected' then '매장 승인이 반려되었습니다.' || coalesce(' 사유: ' || p_reason, '')
               else '매장 정보가 심사 중입니다.' end,
          null);

  perform public.log_admin_action(
    case when p_status = 'approved' then '판매자 승인'
         when p_status = 'rejected' then '판매자 반려' else '판매자 심사중 전환' end,
    'store', p_store_id::text, coalesce(p_reason, ''));
  return v_row;
end; $$;
revoke all on function public.admin_set_store_approval(uuid, store_approval_status, text) from public;
grant execute on function public.admin_set_store_approval(uuid, store_approval_status, text) to authenticated;

-- 매장 이용정지/해제 — 판매자가 못 되돌리는 전용 컬럼(suspended_by_admin) 사용.
-- 주문 차단은 create_order 게이트(§11)가 담당.
create or replace function public.admin_set_store_suspension(
  p_store_id uuid, p_suspended boolean, p_reason text default null
) returns public.stores
language plpgsql security definer set search_path = public
as $$
declare v_row public.stores;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.stores
     set suspended_by_admin = p_suspended,
         admin_memo = coalesce(p_reason, admin_memo)
   where id = p_store_id
  returning * into v_row;
  if not found then raise exception 'store not found'; end if;

  insert into public.notifications (seller_id, type, title, message)
  values (v_row.seller_id, 'system',
          case when p_suspended then '판매 이용정지 안내' else '이용정지 해제 안내' end,
          case when p_suspended then '관리자에 의해 판매가 정지되었습니다.' || coalesce(' 사유: ' || p_reason, '')
               else '이용정지가 해제되었습니다. 판매를 재개할 수 있습니다.' end);

  perform public.log_admin_action(
    case when p_suspended then '판매자 이용정지' else '판매자 이용정지 해제' end,
    'store', p_store_id::text, coalesce(p_reason, ''));
  return v_row;
end; $$;
revoke all on function public.admin_set_store_suspension(uuid, boolean, text) from public;
grant execute on function public.admin_set_store_suspension(uuid, boolean, text) to authenticated;

-- 매장 관리자 메모
create or replace function public.admin_set_store_memo(p_store_id uuid, p_memo text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.stores set admin_memo = p_memo where id = p_store_id;
  if not found then raise exception 'store not found'; end if;
end; $$;
revoke all on function public.admin_set_store_memo(uuid, text) from public;
grant execute on function public.admin_set_store_memo(uuid, text) to authenticated;

-- 상품 상태 변경(숨김/판매중지/재개) + 메모
create or replace function public.admin_set_product_status(
  p_product_id uuid, p_status product_status, p_reason text default null
) returns public.products
language plpgsql security definer set search_path = public
as $$
declare v_row public.products;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into v_row from public.products where id = p_product_id;
  if not found then raise exception 'product not found'; end if;

  if p_status = 'selling' and v_row.expiry_date is not null and v_row.expiry_date < now() then
    raise exception 'expired product cannot resume';
  end if;

  update public.products
     set status = p_status,
         pause_reason = case when p_status = 'paused' then 'manual'
                             when p_status = 'selling' then null
                             else pause_reason end,
         reject_reason = case when p_status = 'hidden' then coalesce(p_reason, reject_reason)
                              when p_status = 'selling' then null
                              else reject_reason end,
         admin_memo = coalesce(p_reason, admin_memo)
   where id = p_product_id
  returning * into v_row;

  if p_status in ('hidden','paused') then
    insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
    values (v_row.seller_id, 'reject',
            case when p_status = 'hidden' then '상품 숨김 처리' else '상품 판매중지 처리' end,
            v_row.name || ' 상품이 관리자에 의해 ' ||
            case when p_status = 'hidden' then '숨김' else '판매중지' end || ' 처리되었습니다.' ||
            coalesce(' 사유: ' || p_reason, ''),
            'product', v_row.id);
  end if;

  perform public.log_admin_action(
    case p_status when 'hidden' then '상품 숨김' when 'paused' then '상품 판매중지'
                  when 'selling' then '상품 판매재개' else '상품 상태 변경' end,
    'product', p_product_id::text, coalesce(p_reason, ''));
  return v_row;
end; $$;
revoke all on function public.admin_set_product_status(uuid, product_status, text) from public;
grant execute on function public.admin_set_product_status(uuid, product_status, text) to authenticated;

-- 주문 상태 변경(사유 필수 — 감사 로그)
create or replace function public.admin_set_order_status(
  p_order_id uuid, p_status order_seller_status, p_reason text
) returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_row public.orders;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_reason is null or trim(p_reason) = '' then raise exception 'reason required'; end if;
  update public.orders
     set seller_status = p_status,
         cancel_reason = case when p_status = 'cancelled' then p_reason else cancel_reason end
   where id = p_order_id
  returning * into v_row;
  if not found then raise exception 'order not found'; end if;

  perform public.log_admin_action('주문 상태 변경(' || p_status || ')', 'order', v_row.order_code, p_reason);
  return v_row;
end; $$;
revoke all on function public.admin_set_order_status(uuid, order_seller_status, text) from public;
grant execute on function public.admin_set_order_status(uuid, order_seller_status, text) to authenticated;

-- 주문 환불 처리(결제취소 + 주문취소 + 정산 차감 + 구매자 알림). 멱등 — 이미 환불이면 예외.
create or replace function public.admin_refund_order(p_order_id uuid, p_reason text default null)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_row public.orders;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into v_row from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_row.payment_status = 'refunded' then raise exception 'already refunded'; end if;

  update public.orders
     set payment_status = 'refunded',
         seller_status = 'cancelled',
         cancel_reason = coalesce(p_reason, cancel_reason)
   where id = p_order_id
  returning * into v_row;

  -- 정산 미지급분이 있으면 환불 반영(프로토타입 회계: 정산액에서 순매출 차감. refund=0 행만 → 이중 차감 방지)
  update public.settlements
     set refund = v_row.amount,
         settlement_amount = settlement_amount - (v_row.amount - v_row.fee)
   where order_id = v_row.id and status = 'scheduled' and refund = 0;

  if v_row.buyer_id is not null then
    insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
    values (v_row.buyer_id, 'order', '환불 처리 완료',
            v_row.product_name || ' 주문(' || v_row.order_code || ')이 환불 처리되었습니다.',
            'order', v_row.id);
  end if;
  insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
  values (v_row.seller_id, 'cancel', '주문 환불 처리',
          v_row.order_code || ' 주문이 관리자에 의해 환불 처리되었습니다.', 'order', v_row.id);

  perform public.log_admin_action('주문 환불', 'order', v_row.order_code, coalesce(p_reason, ''));
  return v_row;
end; $$;
revoke all on function public.admin_refund_order(uuid, text) from public;
grant execute on function public.admin_refund_order(uuid, text) to authenticated;

-- 주문 관리자 메모
create or replace function public.admin_set_order_memo(p_order_id uuid, p_memo text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.orders set admin_memo = p_memo where id = p_order_id;
  if not found then raise exception 'order not found'; end if;
end; $$;
revoke all on function public.admin_set_order_memo(uuid, text) from public;
grant execute on function public.admin_set_order_memo(uuid, text) to authenticated;

-- 리뷰 모더레이션(숨김/삭제/신고검토 결과) + 메모
create or replace function public.admin_moderate_review(
  p_review_id uuid, p_status text, p_memo text default null
) returns public.reviews
language plpgsql security definer set search_path = public
as $$
declare v_row public.reviews;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_status not in ('normal','hidden','deleted','flagged','flagged_normal','flagged_hidden','flagged_deleted') then
    raise exception 'invalid moderation status';
  end if;
  update public.reviews
     set moderation_status = p_status,
         admin_memo = coalesce(p_memo, admin_memo)
   where id = p_review_id
  returning * into v_row;
  if not found then raise exception 'review not found'; end if;

  perform public.log_admin_action('리뷰 모더레이션(' || p_status || ')', 'review', p_review_id::text, coalesce(p_memo, ''));
  return v_row;
end; $$;
revoke all on function public.admin_moderate_review(uuid, text, text) from public;
grant execute on function public.admin_moderate_review(uuid, text, text) to authenticated;

-- 정산 상태 일괄 변경(판매자×기간 그룹 = settlements 행 배열)
create or replace function public.admin_set_settlement_status(
  p_ids uuid[], p_status settlement_status, p_memo text default null
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.settlements
     set status = p_status,
         admin_memo = coalesce(p_memo, admin_memo),
         settled_on = case when p_status = 'completed'
                           then coalesce(settled_on, (now() at time zone 'Asia/Seoul')::date)
                           else settled_on end
   where id = any(p_ids);
  get diagnostics v_count = row_count;

  perform public.log_admin_action(
    case p_status when 'completed' then '정산 확정'
                  when 'on_hold' then '정산 보류' else '정산 예정 전환' end,
    'settlement', array_to_string(p_ids, ','), coalesce(p_memo, '') || ' (' || v_count || '건)');
  return v_count;
end; $$;
revoke all on function public.admin_set_settlement_status(uuid[], settlement_status, text) from public;
grant execute on function public.admin_set_settlement_status(uuid[], settlement_status, text) to authenticated;

-- 신고 환불 처리(신고 상태 + 연결 주문 환불을 원자적으로)
create or replace function public.admin_report_refund(p_report_id uuid, p_reason text default null)
returns public.reports
language plpgsql security definer set search_path = public
as $$
declare v_row public.reports;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into v_row from public.reports where id = p_report_id;
  if not found then raise exception 'report not found'; end if;

  if v_row.order_id is not null then
    perform public.admin_refund_order(v_row.order_id, coalesce(p_reason, '신고 건 환불: ' || v_row.receipt_code));
  end if;

  update public.reports set status = 'refunded' where id = p_report_id returning * into v_row;
  insert into public.report_logs (report_id, admin_name, kind, message)
  values (p_report_id,
          coalesce((select name from public.admin_profiles where user_id = auth.uid()), ''),
          'refund', '환불 처리 완료' || coalesce(' — ' || p_reason, ''));
  return v_row;
end; $$;
revoke all on function public.admin_report_refund(uuid, text) from public;
grant execute on function public.admin_report_refund(uuid, text) to authenticated;

-- ── 9) 관리자 계정 관리 RPC ─────────────────────────────────────────────────
-- 최초 1명은 supabase/provision_admin.sql(SQL Editor) 로 부트스트랩.
create or replace function public.admin_add_account(p_email text, p_name text, p_role text default 'viewer')
returns public.admin_profiles
language plpgsql security definer set search_path = public
as $$
declare
  v_target uuid;
  v_row public.admin_profiles;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if (select role from public.admin_profiles where user_id = auth.uid()) <> 'super' then
    raise exception 'super admin only';
  end if;
  if p_role not in ('super','ops','settlement','cs','viewer') then raise exception 'invalid role'; end if;

  select id into v_target from auth.users where lower(email) = lower(trim(p_email));
  if not found then
    raise exception 'user not found: 대상자가 먼저 관리자 웹에서 회원가입해야 합니다';
  end if;

  insert into public.admin_profiles (user_id, name, email, role)
  values (v_target, coalesce(nullif(trim(p_name), ''), split_part(p_email, '@', 1)), lower(trim(p_email)), p_role)
  on conflict (user_id) do update
    set name = excluded.name, role = excluded.role, is_active = true
  returning * into v_row;

  perform public.log_admin_action('관리자 계정 추가', 'admin', v_target::text, p_email || ' → ' || p_role);
  return v_row;
end; $$;
revoke all on function public.admin_add_account(text, text, text) from public;
grant execute on function public.admin_add_account(text, text, text) to authenticated;

create or replace function public.admin_update_account(
  p_user_id uuid, p_name text default null, p_role text default null, p_is_active boolean default null
) returns public.admin_profiles
language plpgsql security definer set search_path = public
as $$
declare v_row public.admin_profiles;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if (select role from public.admin_profiles where user_id = auth.uid()) <> 'super' then
    raise exception 'super admin only';
  end if;
  if p_role is not null and p_role not in ('super','ops','settlement','cs','viewer') then
    raise exception 'invalid role';
  end if;
  -- 마지막 활성 super 를 스스로 강등/비활성화하는 사고 방지
  if p_user_id = auth.uid() and (coalesce(p_role, 'super') <> 'super' or p_is_active = false) then
    if (select count(*) from public.admin_profiles where role = 'super' and is_active and user_id <> p_user_id) = 0 then
      raise exception 'cannot demote the last active super admin';
    end if;
  end if;

  update public.admin_profiles
     set name = coalesce(p_name, name),
         role = coalesce(p_role, role),
         is_active = coalesce(p_is_active, is_active)
   where user_id = p_user_id
  returning * into v_row;
  if not found then raise exception 'admin not found'; end if;

  perform public.log_admin_action('관리자 계정 수정', 'admin', p_user_id::text,
    coalesce('role=' || p_role, '') || coalesce(' active=' || p_is_active::text, ''));
  return v_row;
end; $$;
revoke all on function public.admin_update_account(uuid, text, text, boolean) from public;
grant execute on function public.admin_update_account(uuid, text, text, boolean) to authenticated;

-- 로그인 시각 기록(로그인 직후 클라이언트가 호출)
create or replace function public.touch_admin_login()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.admin_profiles set last_login_at = now()
   where user_id = auth.uid() and is_active;
end; $$;
revoke all on function public.touch_admin_login() from public;
grant execute on function public.touch_admin_login() to authenticated;

-- ── 10) 대시보드/환경 통계 집계 RPC ──────────────────────────────────────────
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_out jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select jsonb_build_object(
    'todayRevenue',     coalesce((select sum(amount) from orders
                          where (ordered_at at time zone 'Asia/Seoul')::date = v_today
                            and payment_status = 'paid'), 0),
    'yesterdayRevenue', coalesce((select sum(amount) from orders
                          where (ordered_at at time zone 'Asia/Seoul')::date = v_today - 1
                            and payment_status = 'paid'), 0),
    'todayOrders',      (select count(*) from orders
                          where (ordered_at at time zone 'Asia/Seoul')::date = v_today),
    'yesterdayOrders',  (select count(*) from orders
                          where (ordered_at at time zone 'Asia/Seoul')::date = v_today - 1),
    'todayPickups',     (select count(*) from orders
                          where completed_at is not null
                            and (completed_at at time zone 'Asia/Seoul')::date = v_today),
    'todayCancels',     (select count(*) from orders
                          where cancelled_at is not null
                            and (cancelled_at at time zone 'Asia/Seoul')::date = v_today),
    'newSellerApps',    (select count(*) from stores where approval_status = 'pending'),
    'newReportsToday',  (select count(*) from reports
                          where (received_at at time zone 'Asia/Seoul')::date = v_today),
    'unresolvedReports',(select count(*) from reports
                          where status not in ('refunded','closed')),
    'pendingSettlements',(select count(*) from settlements where status = 'on_hold'),
    'onHoldStores',     coalesce((select jsonb_agg(distinct s.name)
                          from settlements st join stores s on s.id = st.store_id
                          where st.status = 'on_hold'), '[]'::jsonb),
    'expiryPausedCount',(select count(*) from products where status = 'paused' and pause_reason = 'expiry'),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'date', to_char(d.day, 'MM/DD'),
               'orders', coalesce(o.cnt, 0),
               'revenue', coalesce(o.revenue, 0),
               'completedQty', coalesce(o.completed_qty, 0)) order by d.day), '[]'::jsonb)
        from (select generate_series(v_today - 6, v_today, interval '1 day')::date as day) d
        left join (
          select (ordered_at at time zone 'Asia/Seoul')::date as day,
                 count(*) as cnt,
                 sum(amount) filter (where payment_status = 'paid') as revenue,
                 sum(quantity) filter (where seller_status = 'completed') as completed_qty
            from orders
           where (ordered_at at time zone 'Asia/Seoul')::date >= v_today - 6
           group by 1
        ) o on o.day = d.day
    ),
    'categoryStats', (
      select coalesce(jsonb_agg(jsonb_build_object('name', category, 'value', cnt) order by cnt desc), '[]'::jsonb)
        from (select coalesce(p.category, '기타') as category, count(*) as cnt
                from orders o join products p on p.id = o.product_id
               group by 1) t
    ),
    'hourlyPickups', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'hour', lpad(h.h::text, 2, '0') || '시',
               'count', coalesce(o.cnt, 0)) order by h.h), '[]'::jsonb)
        from generate_series(9, 20) as h(h)
        left join (
          select extract(hour from completed_at at time zone 'Asia/Seoul')::int as h, count(*) as cnt
            from orders where completed_at is not null
           group by 1
        ) o on o.h = h.h
    ),
    'highCancelStores', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'rate', rate) order by rate desc), '[]'::jsonb)
        from (select s.name,
                     round(100.0 * count(*) filter (where o.seller_status = 'cancelled') / count(*))::int as rate
                from orders o join stores s on s.id = o.store_id
               group by s.id, s.name
              having count(*) >= 3
                 and round(100.0 * count(*) filter (where o.seller_status = 'cancelled') / count(*))::int >= 15
               order by rate desc
               limit 5) t
    )
  ) into v_out;
  return v_out;
end; $$;
revoke all on function public.admin_dashboard_stats() from public;
grant execute on function public.admin_dashboard_stats() to authenticated;

create or replace function public.admin_env_stats()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_out jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;

  select jsonb_build_object(
    'totalSoldQty', coalesce((select sum(quantity) from orders where seller_status = 'completed'), 0),
    'totalDiscountAmount', coalesce((
      select sum(greatest(p.original_price * o.quantity - o.total_price, 0))
        from orders o join products p on p.id = o.product_id
       where o.seller_status = 'completed'), 0),
    'monthly', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'month', extract(month from m.mon)::int || '월',
               'products', coalesce(o.qty, 0)) order by m.mon), '[]'::jsonb)
        from (select generate_series(
                date_trunc('month', v_today) - interval '5 months',
                date_trunc('month', v_today), interval '1 month')::date as mon) m
        left join (
          select date_trunc('month', (completed_at at time zone 'Asia/Seoul'))::date as mon,
                 sum(quantity) as qty
            from orders
           where seller_status = 'completed' and completed_at is not null
           group by 1
        ) o on o.mon = m.mon
    ),
    'categoryStats', (
      select coalesce(jsonb_agg(jsonb_build_object('name', category, 'value', qty) order by qty desc), '[]'::jsonb)
        from (select coalesce(p.category, '기타') as category, sum(o.quantity) as qty
                from orders o join products p on p.id = o.product_id
               where o.seller_status = 'completed'
               group by 1) t
    ),
    'regionStats', (
      select coalesce(jsonb_agg(jsonb_build_object('region', region, 'qty', qty) order by qty desc), '[]'::jsonb)
        from (select coalesce(nullif(trim(split_part(s.address, ' ', 1) || ' ' || split_part(s.address, ' ', 2)), ''), '기타') as region,
                     sum(o.quantity) as qty
                from orders o join stores s on s.id = o.store_id
               where o.seller_status = 'completed'
               group by 1) t
    )
  ) into v_out;
  return v_out;
end; $$;
revoke all on function public.admin_env_stats() from public;
grant execute on function public.admin_env_stats() to authenticated;

-- ── 11) 쿠폰 RPC 개정: starts_on(시작일) 검증 추가 ───────────────────────────
-- 관리자가 시작일이 미래인 쿠폰을 발행할 수 있게 되므로, 사용/다운로드 경로에 시작일 가드.
drop function if exists public.create_order(uuid, integer, text);
create or replace function public.create_order(
  p_product_id uuid, p_quantity integer default 1, p_coupon_ids uuid[] default '{}'
) returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
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
  c public.coupons%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_quantity < 1 then raise exception 'invalid quantity'; end if;

  select * into v_prod from public.products where id = p_product_id;
  if not found then raise exception 'product not found'; end if;
  if v_prod.status <> 'selling' then raise exception 'product not on sale'; end if;
  if v_prod.stock < p_quantity then raise exception 'insufficient stock'; end if;
  select * into v_store from public.stores where id = v_prod.store_id;
  -- 매장 상태 게이트: 미승인/판매중지(자율)/관리자 이용정지 매장은 주문 불가
  if v_store.approval_status <> 'approved' then raise exception 'store not approved'; end if;
  if v_store.is_selling_paused or v_store.suspended_by_admin then
    raise exception 'store not accepting orders';
  end if;

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
    end loop;

    if v_valid > 1 and v_nonstack > 0 then
      raise exception 'coupon not stackable';
    end if;
    v_total := least(v_total, v_gross);
  end if;

  v_amount := v_gross - v_total;
  v_fee    := round(v_amount * coalesce(v_store.commission_rate, 10) / 100.0);

  select coalesce(nullif(raw_user_meta_data->>'name', ''), '구매자') into v_name from auth.users where id = v_uid;
  v_name := left(v_name, 1) || '**';

  insert into public.orders
    (seller_id, store_id, product_id, product_name, quantity, store_name, store_address,
     buyer_id, buyer_name, safe_number, pickup_start, pickup_end,
     payment_status, seller_status, total_price, amount, fee, coupon_id, coupon_discount_amount)
  values
    (v_prod.seller_id, v_prod.store_id, v_prod.id, v_prod.name, p_quantity, v_store.name, v_store.address,
     v_uid, v_name, '050-0000-0000', v_prod.pickup_start, v_prod.pickup_end,
     'paid', 'new', v_gross, v_amount, v_fee, v_first_coupon, v_total)
  returning * into v_order;

  update public.products set stock = stock - p_quantity where id = v_prod.id;

  insert into public.notifications (seller_id, type, title, message, reference_type, reference_id)
  values (v_prod.seller_id, 'order', '신규 주문',
          v_order.order_code || ' · ' || v_prod.name || ' ' || p_quantity || '개 주문이 접수되었습니다.',
          'order', v_order.id);
  insert into public.buyer_notifications (buyer_id, type, title, message, reference_type, reference_id)
  values (v_uid, 'order', '주문 완료',
          v_prod.name || ' 주문이 접수되었습니다. 픽업 시간을 확인하세요.', 'order', v_order.id);

  return v_order;
end; $$;
revoke all on function public.create_order(uuid, integer, uuid[]) from public;
grant execute on function public.create_order(uuid, integer, uuid[]) to authenticated;

create or replace function public.redeem_coupon(p_code text)
returns public.coupons
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_coupon public.coupons;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_coupon from public.coupons
    where upper(code) = upper(trim(p_code)) and is_active
      and (request_status is null or request_status = 'approved')
      and (starts_on is null or starts_on <= current_date)
      and (ends_on is null or ends_on >= current_date);
  if not found then raise exception 'invalid coupon'; end if;

  insert into public.user_coupons (buyer_id, coupon_id) values (v_uid, v_coupon.id)
    on conflict (buyer_id, coupon_id) do nothing;
  insert into public.buyer_notifications (buyer_id, type, title, message, reference_type)
  values (v_uid, 'coupon', '쿠폰 등록', v_coupon.name || ' 쿠폰이 등록되었습니다.', 'coupon');
  return v_coupon;
end; $$;
revoke all on function public.redeem_coupon(text) from public;
grant execute on function public.redeem_coupon(text) to authenticated;

create or replace function public.store_coupons(p_store_id uuid)
returns setof public.coupons
language sql security definer set search_path = public stable
as $$
  select c.* from public.coupons c
  join public.stores s on s.seller_id = c.seller_id
  where s.id = p_store_id
    and c.is_active
    and (c.request_status is null or c.request_status = 'approved')
    and (c.starts_on is null or c.starts_on <= current_date)
    and (c.ends_on is null or c.ends_on >= current_date);
$$;
grant execute on function public.store_coupons(uuid) to anon, authenticated;

create or replace function public.claim_coupon(p_coupon_id uuid)
returns public.coupons
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_c public.coupons;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_c from public.coupons
   where id = p_coupon_id and is_active
     and (request_status is null or request_status = 'approved')
     and (starts_on is null or starts_on <= current_date)
     and (ends_on is null or ends_on >= current_date);
  if not found then raise exception 'coupon not available'; end if;
  insert into public.user_coupons (buyer_id, coupon_id) values (v_uid, p_coupon_id)
    on conflict (buyer_id, coupon_id) do nothing;
  insert into public.buyer_notifications (buyer_id, type, title, message, reference_type)
    values (v_uid, 'coupon', '쿠폰 발급', v_c.name || ' 쿠폰을 받았습니다.', 'coupon');
  return v_c;
end; $$;
revoke all on function public.claim_coupon(uuid) from public;
grant execute on function public.claim_coupon(uuid) to authenticated;

-- ── 12) Storage: 배너 이미지 · 신고 증빙 버킷 ────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banner-images', 'banner-images', true, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "banner_images_public_read"  on storage.objects;
drop policy if exists "banner_images_admin_insert" on storage.objects;
drop policy if exists "banner_images_admin_update" on storage.objects;
drop policy if exists "banner_images_admin_delete" on storage.objects;
create policy "banner_images_public_read"
  on storage.objects for select using (bucket_id = 'banner-images');
create policy "banner_images_admin_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'banner-images' and public.is_admin());
create policy "banner_images_admin_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'banner-images' and public.is_admin());
create policy "banner_images_admin_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'banner-images' and public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-evidence', 'report-evidence', true, 20971520,
        array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "report_evidence_public_read" on storage.objects;
drop policy if exists "report_evidence_own_insert"  on storage.objects;
drop policy if exists "report_evidence_own_delete"  on storage.objects;
create policy "report_evidence_public_read"
  on storage.objects for select using (bucket_id = 'report-evidence');
create policy "report_evidence_own_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'report-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "report_evidence_own_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'report-evidence' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── 13) Realtime 발행 추가(reports·coupons — RLS 를 따르므로 관리자만 전체 수신) ─
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reports') then
      alter publication supabase_realtime add table public.reports;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'coupons') then
      alter publication supabase_realtime add table public.coupons;
    end if;
  end if;
end $$;
