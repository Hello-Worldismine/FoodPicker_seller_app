-- ============================================================================
-- FoodPicker FAQ 백엔드 (2026-07-22)
--   관리자웹 FAQ 메뉴 + 소비자 앱 '자주 묻는 질문' 화면의 하드코딩 데이터 이관.
--   - faqs 테이블: 카테고리 4종(주문·결제/픽업/상품·가게/계정) + 노출순서/활성여부
--   - RLS: 활성 FAQ 는 anon 포함 공개 읽기, 관리자는 비활성 포함 전체 조회 + CRUD
--   - 시드: 소비자 앱 FAQScreen 의 기존 10건 그대로 (데이터가 이미 있으면 건너뜀)
-- 재실행 안전.
-- ============================================================================

-- ── 1) FAQS (자주 묻는 질문) ─────────────────────────────────────────────────
-- 시드 가드용: 이번 실행에서 테이블이 "새로 생성"되는지 기록.
-- (테이블이 비어 있는지가 아니라 최초 설치인지를 기준으로 시드해야,
--  관리자가 FAQ 를 전부 삭제한 상태에서 재실행해도 삭제 의도가 보존된다.)
drop table if exists _faqs_preexisted;
create temp table _faqs_preexisted as
  select (to_regclass('public.faqs') is not null) as existed;

create table if not exists public.faqs (
  id            uuid primary key default gen_random_uuid(),
  category      text not null,                     -- order_payment/pickup/product_store/account
  question      text not null,
  answer        text not null,
  display_order integer not null default 0,        -- 카테고리 내 노출 순서
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint faqs_category_chk check (category in ('order_payment','pickup','product_store','account'))
);
drop trigger if exists trg_faqs_updated on public.faqs;
create trigger trg_faqs_updated
  before update on public.faqs for each row execute function public.set_updated_at();
create index if not exists idx_faqs_category_order on public.faqs(category, display_order);

-- ── 2) RLS ──────────────────────────────────────────────────────────────────
-- 읽기: 소비자 앱(anon)도 활성 FAQ 조회. 관리자는 비활성 포함 전체(fetchFaqs 무필터 select).
-- 쓰기: 관리자만 (20260716 notices_admin_* 패턴)
alter table public.faqs enable row level security;
drop policy if exists faqs_public_select on public.faqs;
drop policy if exists faqs_admin_insert  on public.faqs;
drop policy if exists faqs_admin_update  on public.faqs;
drop policy if exists faqs_admin_delete  on public.faqs;
create policy faqs_public_select on public.faqs for select to anon, authenticated
  using (is_active = true or (select public.is_admin()));
create policy faqs_admin_insert on public.faqs for insert to authenticated
  with check ((select public.is_admin()));
create policy faqs_admin_update on public.faqs for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy faqs_admin_delete on public.faqs for delete to authenticated
  using ((select public.is_admin()));

-- ── 3) 시드 (소비자 앱 FAQScreen.js 하드코딩 10건 이관) ─────────────────────
--   멱등: 최초 설치(이번 실행에서 테이블 신규 생성)에만 시드.
--   기존 설치 재실행 시에는 관리자의 수정/전체 삭제 상태를 그대로 보존한다.
insert into public.faqs (category, question, answer, display_order)
select v.category, v.question, v.answer, v.display_order
from (values
  -- 주문 · 결제
  ('order_payment', '주문 취소는 어떻게 하나요?',
   '주문 후 픽업 준비가 시작되기 전까지 주문내역 화면에서 취소할 수 있습니다. 픽업 준비가 시작된 이후에는 고객센터로 문의해 주세요.', 1),
  ('order_payment', '결제 수단은 어떤 것을 지원하나요?',
   '신용카드, 체크카드, 카카오페이, 네이버페이를 지원합니다. 결제수단 관리에서 카드를 등록하면 빠르게 결제할 수 있어요.', 2),
  ('order_payment', '영수증 발급이 가능한가요?',
   '주문내역 화면에서 해당 주문을 선택한 후 영수증 발급 버튼을 눌러주세요. 현금영수증은 고객센터를 통해 요청하실 수 있습니다.', 3),
  -- 픽업
  ('pickup', '픽업 시간을 변경할 수 있나요?',
   '픽업 시간은 매장에서 설정한 시간 내에서만 가능하며, 임의로 변경은 어렵습니다. 불가피한 상황이라면 고객센터로 문의해 주세요.', 1),
  ('pickup', '픽업을 못 했어요. 환불이 되나요?',
   '픽업 시간 내에 방문하지 못한 경우 환불이 제한될 수 있습니다. 불가피한 상황이라면 픽업 시간 만료 전에 고객센터로 문의해 주세요.', 2),
  ('pickup', '픽업 장소가 어디인가요?',
   '상품 상세 페이지 및 주문 확인 화면에서 픽업 장소를 확인할 수 있습니다. 지도 탭에서도 가게 위치를 확인할 수 있어요.', 3),
  -- 상품 · 가게
  ('product_store', '상품 정보가 실제와 다를 수 있나요?',
   '상품 정보는 판매자가 직접 등록합니다. 실제 상품과 다소 차이가 있을 수 있으며, 문제가 발생하면 고객센터로 신고해 주세요.', 1),
  ('product_store', '마감 임박 상품은 언제 없어지나요?',
   '픽업 마감 시간이 지나거나 재고가 소진되면 자동으로 품절 처리됩니다. 관심 상품은 찜 목록에서 가격 알림을 설정해 보세요.', 2),
  -- 계정
  ('account', '회원 탈퇴 후 재가입이 가능한가요?',
   '탈퇴 후 30일 이내에는 동일 계정으로 재가입이 제한됩니다. 탈퇴 시 주문내역, 쿠폰, 찜 목록 등 모든 데이터가 삭제됩니다.', 1),
  ('account', '개인정보는 어떻게 관리되나요?',
   '개인정보는 관련 법령에 따라 안전하게 관리됩니다. 자세한 내용은 마이페이지 > 약관 및 개인정보처리방침에서 확인하실 수 있습니다.', 2)
) as v(category, question, answer, display_order)
where not (select existed from _faqs_preexisted)
  and not exists (select 1 from public.faqs);  -- 방어적 이중 가드

drop table if exists _faqs_preexisted;
