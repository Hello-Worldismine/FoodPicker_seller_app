-- ============================================================================
-- FoodPicker 판매자 앱 — Supabase(PostgreSQL) 최종 마이그레이션
-- 통합 스키마(제안 A+B) + 검증 이슈 13건 반영본
--
-- 반영 요약(스키마 영향분):
--  · [CRITICAL] stores 컬럼단위 권한 잠금(approval_status/commission_rate/rating/
--               review_count/contract_start_date/seller_id 판매자 쓰기 차단)
--  · [HIGH]     reviews 컬럼단위 권한 잠금(판매자는 owner_reply/owner_replied_at 만)
--  · [MEDIUM]   orders 컬럼단위 권한 잠금(판매자는 seller_status/cancel_reason 만)
--  · [MEDIUM]   가입 role 게이트를 raw_user_meta_data → raw_app_meta_data 로 변경
--  · [LOW]      order_code_seq/settlement_code_seq 의 authenticated 권한 회수
--  · enum(storage/settlement/payment) 불일치는 "앱 매핑 계층"에서 해결 → followups
--  · 파생필드(pickupTime/review.date/notif.time)·storageMethod 는 컬럼 미추가 → followups
-- ============================================================================

-- 0) 확장 --------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;   -- gen_random_uuid()

-- 1) ENUM --------------------------------------------------------------------
-- 앱 라벨맵(PRODUCT_STATUS/ORDER_SELLER_STATUS)과 동일하게 "영문 키"로 통일.
-- settlement/payment 도 영문 키 유지 → 앱에 SETTLEMENT_STATUS/PAYMENT_STATUS 라벨맵 추가(followups).
create type product_status        as enum ('selling', 'soldout', 'paused', 'hidden');
create type order_seller_status   as enum ('new', 'confirmed', 'completed', 'cancelled');
create type store_approval_status as enum ('approved', 'pending', 'rejected');
create type storage_type          as enum ('실온', '냉장', '냉동');
create type settlement_status     as enum ('scheduled', 'completed', 'on_hold');
create type payment_status        as enum ('pending', 'paid', 'cancelled', 'refunded');
create type notification_type     as enum ('reject','cancel','settlement','order','review','notice','system');

-- 2) 공통 함수 ---------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- 3) 표시용 코드 시퀀스 -------------------------------------------------------
create sequence if not exists order_code_seq      start 1000;  -- FP-1000 ~
create sequence if not exists settlement_code_seq start 1;     -- ST-001 ~

-- ============================================================================
-- 4) STORES (매장) — 판매자 1인 = 매장 1개. 가입 트리거로 자동 생성.
-- ============================================================================
create table public.stores (
  id                  uuid primary key default gen_random_uuid(),
  seller_id           uuid not null references auth.users(id) on delete cascade,
  name                text not null default '내 매장',
  biz_number          text,
  owner_name          text,
  resident_number     text,                      -- 민감정보(앱 마스킹, 실서비스 암호화 권장)
  address             text,
  bank_name           text,
  account_number      text,
  account_holder      text,
  phone               text,
  category            text,
  description         text,
  notice              text,                      -- 매장 공지(구매자 노출)
  tags                text[] not null default '{}',
  store_image         text,
  open_hours          jsonb not null default '{
    "allSame": true, "sameOpen": "08:00", "sameClose": "21:00",
    "days": {
      "mon": {"isOpen": true,  "open": "08:00", "close": "21:00"},
      "tue": {"isOpen": true,  "open": "08:00", "close": "21:00"},
      "wed": {"isOpen": true,  "open": "08:00", "close": "21:00"},
      "thu": {"isOpen": true,  "open": "08:00", "close": "21:00"},
      "fri": {"isOpen": true,  "open": "08:00", "close": "21:00"},
      "sat": {"isOpen": true,  "open": "08:00", "close": "21:00"},
      "sun": {"isOpen": false, "open": "08:00", "close": "21:00"}
    }
  }'::jsonb,
  closed_days         text[] not null default '{}',
  lat                 double precision,
  lng                 double precision,
  approval_status     store_approval_status not null default 'pending',
  is_selling_paused   boolean not null default false,
  commission_rate     integer not null default 10,
  contract_start_date date,
  rating              numeric(2,1) not null default 0,   -- 리뷰 트리거로 갱신
  review_count        integer not null default 0,        -- 리뷰 트리거로 갱신
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint stores_commission_chk check (commission_rate between 0 and 100),
  constraint stores_rating_chk     check (rating >= 0 and rating <= 5),
  constraint stores_seller_uk      unique (seller_id),      -- 1인 1매장(멀티매장 확장 시 제거)
  constraint stores_id_seller_uk   unique (id, seller_id)   -- 하위 복합 FK 타깃
);
create trigger trg_stores_updated
  before update on public.stores for each row execute function public.set_updated_at();

-- ============================================================================
-- 5) PRODUCTS (상품)
-- ============================================================================
create table public.products (
  id                uuid primary key default gen_random_uuid(),
  seller_id         uuid not null references auth.users(id) on delete cascade,   -- RLS용
  store_id          uuid not null,
  name              text not null,
  category          text,
  emoji             text,
  thumbnail         text,                         -- 대표 이미지(images[0])
  images            text[] not null default '{}',
  original_price    integer not null,
  start_price       integer,                      -- 자동 인하 시작가
  floor_price       integer,                      -- 자동 인하 하한가
  sale_price        integer not null,             -- 현재 판매가
  discount_rate     integer not null default 0,   -- 표시 할인율(가격 변경 로직이 유지)
  reduction_amount  integer,                      -- 회당 인하액
  interval_minutes  integer,                      -- 인하 간격(분)
  last_reduced_at   timestamptz,                  -- 마지막 자동 인하 시각(스케줄러)
  stock             integer not null default 0,
  pickup_start      timestamptz,
  pickup_end        timestamptz,
  expiry_date       timestamptz,                  -- 소비기한
  storage           storage_type,                 -- 실온/냉장/냉동 (' 보관' 접미사는 앱 파생 storageToDisplay)
  storage_detail    text,                         -- 상세 보관(앱 storageDetail). 구 storageMethod 통합 대상
  status            product_status not null default 'selling',
  pause_reason      text,                         -- 'expiry' | 'manual'
  reject_reason     text,                         -- 반려(hidden) 사유
  description       text,
  composition       text,
  origin            text,
  allergens         text[] not null default '{}', -- 표시문자열(allergyInfo)은 클라 파생
  cancel_policy     text,
  store_notice      text,
  pickup_address    text,                         -- 스냅샷(매장 주소)
  lat               double precision,
  lng               double precision,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint products_original_chk  check (original_price >= 0),
  constraint products_sale_chk      check (sale_price >= 0),
  constraint products_start_chk     check (start_price is null or start_price >= 0),
  constraint products_floor_chk     check (floor_price is null or floor_price >= 0),
  constraint products_start_le_orig check (start_price is null or start_price <= original_price),
  constraint products_floor_le_start check (floor_price is null or start_price is null or floor_price <= start_price),
  constraint products_sale_ge_floor check (floor_price is null or sale_price >= floor_price),
  constraint products_stock_chk     check (stock >= 0),
  constraint products_discount_chk  check (discount_rate between 0 and 100),
  constraint products_reduction_chk check (reduction_amount is null or reduction_amount > 0),
  constraint products_interval_chk  check (interval_minutes is null or interval_minutes > 0),
  constraint products_pause_chk     check (pause_reason is null or pause_reason in ('expiry','manual')),
  constraint products_store_fk foreign key (store_id, seller_id)
    references public.stores(id, seller_id) on delete cascade,
  constraint products_id_seller_uk unique (id, seller_id)   -- price_history 복합 FK 타깃
);
create index idx_products_seller        on public.products(seller_id);
create index idx_products_store         on public.products(store_id);
create index idx_products_seller_status on public.products(seller_id, status);
create index idx_products_expiry        on public.products(expiry_date);
create trigger trg_products_updated
  before update on public.products for each row execute function public.set_updated_at();

-- ============================================================================
-- 6) PRODUCT_PRICE_HISTORY (가격 변동 이력)
-- ============================================================================
create table public.product_price_history (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null references auth.users(id) on delete cascade,
  product_id     uuid not null,
  old_price      integer,
  new_price      integer not null,
  discount_rate  integer,
  reason         text not null default 'auto',   -- 'initial' | 'auto' | 'manual'
  created_at     timestamptz not null default now(),
  constraint pph_reason_chk check (reason in ('initial','auto','manual')),
  constraint pph_product_fk foreign key (product_id, seller_id)
    references public.products(id, seller_id) on delete cascade
);
create index idx_pph_product on public.product_price_history(product_id, created_at desc);
create index idx_pph_seller  on public.product_price_history(seller_id);

-- ============================================================================
-- 7) ORDERS (주문) — 평면 스냅샷(조인 0). 생성은 구매자/플랫폼(service_role).
-- ============================================================================
create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  seller_id        uuid not null references auth.users(id) on delete cascade,  -- RLS용
  store_id         uuid not null,
  order_code       text not null unique default ('FP-' || nextval('order_code_seq')),  -- 앱 order.id
  product_id       uuid references public.products(id) on delete set null,
  product_name     text not null,                 -- 스냅샷
  quantity         integer not null default 1,
  store_name       text,                          -- 스냅샷(표시용, 조인 회피)
  store_address    text,                          -- 스냅샷
  buyer_id         uuid references auth.users(id) on delete set null,
  buyer_name       text,                          -- 마스킹 표시명 '김**'
  safe_number      text,                          -- 050 안심번호
  pickup_start     timestamptz,                   -- pickupTime 문자열은 앱 파생(OrderDetail 수정 필요, followups)
  pickup_end       timestamptz,
  ordered_at       timestamptz not null default now(),
  confirmed_at     timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  payment_status   payment_status not null default 'paid',  -- 표시 라벨은 앱 PAYMENT_STATUS(followups)
  seller_status    order_seller_status not null default 'new',  -- userStatus는 앱 파생
  total_price      integer not null,
  amount           integer not null,              -- 결제금액(OrderDetail가 별도 참조)
  fee              integer not null default 0,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint orders_total_chk  check (total_price >= 0),
  constraint orders_amount_chk check (amount >= 0),
  constraint orders_fee_chk    check (fee >= 0),
  constraint orders_qty_chk    check (quantity > 0),
  constraint orders_store_fk foreign key (store_id, seller_id)
    references public.stores(id, seller_id) on delete cascade
);
create index idx_orders_seller        on public.orders(seller_id);
create index idx_orders_store         on public.orders(store_id);
create index idx_orders_seller_status on public.orders(seller_id, seller_status);
create index idx_orders_ordered_at    on public.orders(seller_id, ordered_at desc);
create index idx_orders_product       on public.orders(product_id);
create trigger trg_orders_updated
  before update on public.orders for each row execute function public.set_updated_at();

-- ============================================================================
-- 8) REVIEWS (리뷰) — 구매자 작성. 판매자는 owner_reply 만 수정.
-- ============================================================================
create table public.reviews (
  id               uuid primary key default gen_random_uuid(),
  seller_id        uuid not null references auth.users(id) on delete cascade,  -- RLS용
  store_id         uuid not null,
  product_id       uuid references public.products(id) on delete set null,
  order_id         uuid references public.orders(id) on delete set null,
  reviewer_id      uuid references auth.users(id) on delete set null,
  reviewer_name    text not null,                 -- 앱 review.user
  rating           integer not null,
  content          text,                          -- 앱 review.text
  helpful_count    integer not null default 0,    -- 앱 review.helpful
  owner_reply      text,                          -- null = 미답변
  owner_replied_at timestamptz,
  created_at       timestamptz not null default now(),  -- 앱 review.date 포맷 원천
  updated_at       timestamptz not null default now(),
  constraint reviews_rating_chk  check (rating between 1 and 5),
  constraint reviews_helpful_chk check (helpful_count >= 0),
  constraint reviews_store_fk foreign key (store_id, seller_id)
    references public.stores(id, seller_id) on delete cascade
);
create index idx_reviews_seller     on public.reviews(seller_id);
create index idx_reviews_store       on public.reviews(store_id);
create index idx_reviews_product     on public.reviews(product_id);
create index idx_reviews_unanswered  on public.reviews(seller_id) where owner_reply is null;
create trigger trg_reviews_updated
  before update on public.reviews for each row execute function public.set_updated_at();

-- ============================================================================
-- 9) SETTLEMENTS (정산) — 조회 전용.
-- ============================================================================
create table public.settlements (
  id                uuid primary key default gen_random_uuid(),
  seller_id         uuid not null references auth.users(id) on delete cascade,  -- RLS용
  store_id          uuid not null,
  order_id          uuid references public.orders(id) on delete set null,
  settlement_code   text not null unique
                      default ('ST-' || lpad(nextval('settlement_code_seq')::text, 3, '0')),
  order_code        text,                          -- 앱 settlement.orderId 표시(스냅샷)
  product_name      text,                          -- 표시 스냅샷
  amount            integer not null default 0,    -- 판매금액
  fee               integer not null default 0,    -- 총 수수료(= platform_fee + pg_fee)
  platform_fee      integer not null default 0,
  pg_fee            integer not null default 0,
  refund            integer not null default 0,
  settlement_amount integer not null default 0,    -- 최종 정산금액
  status            settlement_status not null default 'scheduled',  -- 표시 라벨은 앱 SETTLEMENT_STATUS(followups)
  settled_on        date,                          -- 앱 settlement.date
  period_start      date,                          -- 정산 주기 시작(알림 '6/23~6/29')
  period_end        date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint settlements_amt_chk check (amount >= 0 and fee >= 0 and platform_fee >= 0
                                        and pg_fee >= 0 and refund >= 0),
  constraint settlements_store_fk foreign key (store_id, seller_id)
    references public.stores(id, seller_id) on delete cascade
);
create index idx_settlements_seller  on public.settlements(seller_id);
create index idx_settlements_order    on public.settlements(order_id);
create index idx_settlements_filter   on public.settlements(seller_id, status, settled_on desc);
create trigger trg_settlements_updated
  before update on public.settlements for each row execute function public.set_updated_at();

-- ============================================================================
-- 10) NOTIFICATIONS (알림) — 조회 + 읽음 update + 삭제. 생성은 플랫폼.
-- ============================================================================
create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null references auth.users(id) on delete cascade,
  type           notification_type not null,
  title          text not null,
  message        text,
  is_read        boolean not null default false,   -- 앱 read
  reference_type text,                             -- 딥링크 대상 종류
  reference_id   uuid,                             -- time('방금 전')은 created_at 에서 앱 파생
  created_at     timestamptz not null default now(),
  constraint notifications_ref_chk check (
    reference_type is null or reference_type in ('order','product','settlement','review','notice'))
);
create index idx_notifications_seller_unread
  on public.notifications(seller_id, is_read, created_at desc);

-- ============================================================================
-- 11) NOTICES (전역 공지) — seller_id 없음. 인증 판매자 조회 전용.
-- ============================================================================
create table public.notices (
  id           uuid primary key default gen_random_uuid(),
  notice_code  text unique,                        -- 'NC-001'
  emoji        text,
  title        text not null,
  content      text,
  published_at date,                               -- 앱 notice.date
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_notices_published on public.notices(is_published, published_at desc);
create trigger trg_notices_updated
  before update on public.notices for each row execute function public.set_updated_at();

-- ============================================================================
-- 12) 도메인 트리거 (정합성 — 어떤 클라이언트로 접근해도 불변식 유지)
-- ============================================================================

-- 12.1 재고 <-> 판매상태 동기화 (selling<->soldout 만 자동, paused/hidden 보존)
create or replace function public.sync_product_stock_status()
returns trigger language plpgsql as $$
begin
  if new.stock = 0 and new.status = 'selling' then
    new.status = 'soldout';
  elsif new.stock > 0 and new.status = 'soldout' then
    new.status = 'selling';
  end if;
  return new;
end; $$;
create trigger trg_products_stock_status
  before insert or update of stock, status on public.products
  for each row execute function public.sync_product_stock_status();

-- 12.2 판매가 변경 -> 가격이력 자동 기록
create or replace function public.log_product_price_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.product_price_history(seller_id, product_id, old_price, new_price, discount_rate, reason)
    values (new.seller_id, new.id, null, new.sale_price, new.discount_rate, 'initial');
  elsif new.sale_price is distinct from old.sale_price then
    insert into public.product_price_history(seller_id, product_id, old_price, new_price, discount_rate, reason)
    values (new.seller_id, new.id, old.sale_price, new.sale_price, new.discount_rate,
            case when new.last_reduced_at is distinct from old.last_reduced_at then 'auto' else 'manual' end);
  end if;
  return new;
end; $$;
create trigger trg_products_price_log
  after insert or update of sale_price on public.products
  for each row execute function public.log_product_price_change();

-- 12.3 리뷰 집계 -> stores.rating / review_count
create or replace function public.refresh_store_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_store uuid;
begin
  v_store := coalesce(new.store_id, old.store_id);
  update public.stores s set
    rating = coalesce((select round(avg(rating)::numeric, 1) from public.reviews r where r.store_id = v_store), 0),
    review_count = (select count(*) from public.reviews r where r.store_id = v_store)
  where s.id = v_store;
  return null;
end; $$;
create trigger trg_reviews_aggregate
  after insert or update of rating or delete on public.reviews
  for each row execute function public.refresh_store_rating();

-- 12.4 주문 상태 전이 시각 자동 기록
create or replace function public.stamp_order_status()
returns trigger language plpgsql as $$
begin
  if new.seller_status is distinct from old.seller_status then
    if new.seller_status = 'confirmed' and new.confirmed_at is null then new.confirmed_at := now(); end if;
    if new.seller_status = 'completed' and new.completed_at is null then new.completed_at := now(); end if;
    if new.seller_status = 'cancelled' and new.cancelled_at is null then new.cancelled_at := now(); end if;
  end if;
  return new;
end; $$;
create trigger trg_orders_status_stamp
  before update of seller_status on public.orders
  for each row execute function public.stamp_order_status();

-- 12.5 판매자 가입 시 매장 자동 생성
--   [MEDIUM 반영] role 게이트를 raw_app_meta_data(서버/service_role 만 설정 가능)로 변경.
--   raw_user_meta_data 는 signUp 시 클라이언트가 임의 지정 가능 → self-assign role='seller' 취약점 차단.
--   프로필성 필드(store_name/owner_name/phone)는 비권한 정보이므로 raw_user_meta_data 에서 계속 읽음.
create or replace function public.handle_new_seller()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.raw_app_meta_data->>'role') = 'seller' then
    insert into public.stores (seller_id, name, owner_name, phone)
    values (
      new.id,
      coalesce(nullif(new.raw_user_meta_data->>'store_name', ''), '내 매장'),
      coalesce(new.raw_user_meta_data->>'owner_name', ''),
      coalesce(new.raw_user_meta_data->>'phone', new.phone)
    );
  end if;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_seller();

-- ============================================================================
-- 13) RLS — 테넌트 격리(행 단위)
-- ============================================================================
alter table public.stores                enable row level security;
alter table public.products              enable row level security;
alter table public.product_price_history enable row level security;
alter table public.orders                enable row level security;
alter table public.reviews               enable row level security;
alter table public.settlements           enable row level security;
alter table public.notifications         enable row level security;
alter table public.notices               enable row level security;

-- STORES : 조회 + 수정 (생성=가입 트리거/security definer, 삭제 없음)
create policy stores_select on public.stores for select to authenticated
  using (seller_id = auth.uid());
create policy stores_update on public.stores for update to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());

-- PRODUCTS : 전체 CRUD
create policy products_select on public.products for select to authenticated
  using (seller_id = auth.uid());
create policy products_insert on public.products for insert to authenticated
  with check (seller_id = auth.uid());
create policy products_update on public.products for update to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());
create policy products_delete on public.products for delete to authenticated
  using (seller_id = auth.uid());

-- PRODUCT_PRICE_HISTORY : 조회 전용 (기록은 트리거/service_role)
create policy pph_select on public.product_price_history for select to authenticated
  using (seller_id = auth.uid());

-- ORDERS : 조회 + 상태 update (생성/삭제는 구매자/플랫폼)
create policy orders_select on public.orders for select to authenticated
  using (seller_id = auth.uid());
create policy orders_update on public.orders for update to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());

-- REVIEWS : 조회 + 답변 update (생성/삭제는 구매자/플랫폼)
create policy reviews_select on public.reviews for select to authenticated
  using (seller_id = auth.uid());
create policy reviews_update on public.reviews for update to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());

-- SETTLEMENTS : 조회 전용
create policy settlements_select on public.settlements for select to authenticated
  using (seller_id = auth.uid());

-- NOTIFICATIONS : 조회 + 읽음 update + 삭제 (생성은 플랫폼)
create policy notifications_select on public.notifications for select to authenticated
  using (seller_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (seller_id = auth.uid());

-- NOTICES : 게시된 공지 조회만. 쓰기 정책 없음 = 판매자 거부(관리자는 service_role).
create policy notices_select on public.notices for select to authenticated
  using (is_published = true);

-- ============================================================================
-- 13.5) 컬럼 단위 권한 (RLS는 '행'만 격리 → '열' 위조를 별도 차단)
--   Supabase 기본 default privilege 는 authenticated 에 테이블 전체 UPDATE 를 부여하므로,
--   민감/플랫폼 통제 컬럼을 재부여 목록에서 제외해 판매자 쓰기를 원천 차단한다.
--   (SELECT/INSERT/DELETE 는 유지 → RLS 정책이 최종 게이트)
-- ============================================================================

-- [CRITICAL] STORES: 판매자 self-approval / commission 0% / rating 위조 차단
revoke update on public.stores from authenticated;
grant update (
  name, biz_number, owner_name, resident_number, address,
  bank_name, account_number, account_holder, phone, category,
  description, notice, tags, store_image, open_hours,
  closed_days, lat, lng, is_selling_paused
) on public.stores to authenticated;
-- 의도적 제외: seller_id, approval_status, commission_rate, rating, review_count, contract_start_date
-- (approval_status='pending' 전환 및 rating/review_count 갱신은 플랫폼/트리거 담당)

-- [MEDIUM] ORDERS: 금액(total_price/amount/fee)·결제상태·PII 스냅샷 위조 차단.
--   판매자는 상태 전이/취소사유만 기록(타임스탬프는 stamp 트리거가 설정).
revoke update on public.orders from authenticated;
grant update (seller_status, cancel_reason) on public.orders to authenticated;

-- [HIGH] REVIEWS: 구매자 저작 컬럼(rating/content/reviewer_name/helpful_count) 위조 및
--   rating 재집계를 통한 매장 평점 인플레 차단. 판매자는 답변만.
revoke update on public.reviews from authenticated;
grant update (owner_reply, owner_replied_at) on public.reviews to authenticated;

-- ============================================================================
-- 14) 시퀀스 권한
--   [LOW 반영] 판매자는 orders/settlements INSERT 정책이 없어(생성=service_role) 시퀀스가 불필요.
--   authenticated 에 부여 시 nextval 로 코드 시퀀스를 소진(FP/ST 넘버 갭·물량 유추)시킬 수 있어 회수.
--   service_role 은 RLS/권한을 우회하므로 실제 주문/정산 생성은 영향 없음.
-- ============================================================================
revoke usage, select on sequence order_code_seq, settlement_code_seq from authenticated;