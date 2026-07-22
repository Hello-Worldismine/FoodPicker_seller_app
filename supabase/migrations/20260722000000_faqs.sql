-- ============================================================================
-- FAQ (자주 묻는 질문) — 관리자 웹(foodpicker_admin)에서 등록/수정/삭제,
-- 소비자 앱(foodpicker_app)에서 공개 조회. 카테고리는 FAQScreen.js의 4개 고정 그룹과 동일.
-- ============================================================================
create table public.faqs (
  id            uuid primary key default gen_random_uuid(),
  category      text not null check (category in ('order_payment','pickup','product_store','account')),
  question      text not null,
  answer        text not null,
  display_order integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_faqs_category_order on public.faqs(category, display_order);
create trigger trg_faqs_updated
  before update on public.faqs for each row execute function public.set_updated_at();

alter table public.faqs enable row level security;

-- 공개 읽기: 활성 FAQ만 (소비자 앱은 인증 없이도 조회 가능해야 함)
create policy faqs_public_read
  on public.faqs for select
  using (is_active = true);

-- 관리자: 비활성 포함 전체 조회 + 쓰기(is_admin() 은 20260716000000_admin.sql 에서 정의된 security definer 함수)
create policy faqs_admin_read
  on public.faqs for select to authenticated
  using (public.is_admin());

create policy faqs_admin_insert
  on public.faqs for insert to authenticated
  with check (public.is_admin());

create policy faqs_admin_update
  on public.faqs for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy faqs_admin_delete
  on public.faqs for delete to authenticated
  using (public.is_admin());

-- 최초 1회 시드: 소비자 앱에 하드코딩되어 있던 기존 FAQ 10건을 그대로 이관(이미 데이터가 있으면 건너뜀)
do $$
begin
  if not exists (select 1 from public.faqs) then
    insert into public.faqs (category, question, answer, display_order) values
      ('order_payment', '주문 취소는 어떻게 하나요?', '주문 후 픽업 준비가 시작되기 전까지 주문내역 화면에서 취소할 수 있습니다. 픽업 준비가 시작된 이후에는 고객센터로 문의해 주세요.', 1),
      ('order_payment', '결제 수단은 어떤 것을 지원하나요?', '신용카드, 체크카드, 카카오페이, 네이버페이를 지원합니다. 결제수단 관리에서 카드를 등록하면 빠르게 결제할 수 있어요.', 2),
      ('order_payment', '영수증 발급이 가능한가요?', '주문내역 화면에서 해당 주문을 선택한 후 영수증 발급 버튼을 눌러주세요. 현금영수증은 고객센터를 통해 요청하실 수 있습니다.', 3),
      ('pickup', '픽업 시간을 변경할 수 있나요?', '픽업 시간은 매장에서 설정한 시간 내에서만 가능하며, 임의로 변경은 어렵습니다. 불가피한 상황이라면 고객센터로 문의해 주세요.', 1),
      ('pickup', '픽업을 못 했어요. 환불이 되나요?', '픽업 시간 내에 방문하지 못한 경우 환불이 제한될 수 있습니다. 불가피한 상황이라면 픽업 시간 만료 전에 고객센터로 문의해 주세요.', 2),
      ('pickup', '픽업 장소가 어디인가요?', '상품 상세 페이지 및 주문 확인 화면에서 픽업 장소를 확인할 수 있습니다. 지도 탭에서도 가게 위치를 확인할 수 있어요.', 3),
      ('product_store', '상품 정보가 실제와 다를 수 있나요?', '상품 정보는 판매자가 직접 등록합니다. 실제 상품과 다소 차이가 있을 수 있으며, 문제가 발생하면 고객센터로 신고해 주세요.', 1),
      ('product_store', '마감 임박 상품은 언제 없어지나요?', '픽업 마감 시간이 지나거나 재고가 소진되면 자동으로 품절 처리됩니다. 관심 상품은 찜 목록에서 가격 알림을 설정해 보세요.', 2),
      ('account', '회원 탈퇴 후 재가입이 가능한가요?', '탈퇴 후 30일 이내에는 동일 계정으로 재가입이 제한됩니다. 탈퇴 시 주문내역, 쿠폰, 찜 목록 등 모든 데이터가 삭제됩니다.', 1),
      ('account', '개인정보는 어떻게 관리되나요?', '개인정보는 관련 법령에 따라 안전하게 관리됩니다. 자세한 내용은 마이페이지 > 약관 및 개인정보처리방침에서 확인하실 수 있습니다.', 2);
  end if;
end $$;
