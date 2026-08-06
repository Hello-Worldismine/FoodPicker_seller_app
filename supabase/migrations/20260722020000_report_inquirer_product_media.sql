-- ============================================================================
-- FoodPicker 후속 보강 (2026-07-22)
--   1) public_product_media 뷰 — 상태 무관 상품 미디어(emoji/thumbnail/images)
--      · public_products 는 status='selling' 만 노출하므로, 품절/판매종료 상품의
--        리뷰쓰기 화면에서 제품 사진을 띄울 수 없던 문제 해결(사용자앱 WriteReviewScreen).
--      · 미디어·식별자만 노출(가격/재고 등 미포함) — 민감정보 없음.
--   2) create_report 재정의 — p_inquirer 파라미터 추가
--      · 기존: 매장 보유 계정이면 무조건 inquirer_type='seller' 로 분류 →
--        판매자 계정으로 사용자앱에서 문의하면 관리자 웹 '판매자' 탭 유형 필터와 어긋남.
--      · p_inquirer='buyer'|'seller' 명시 시 이를 우선(단 'seller' 주장은 매장 보유 검증).
--        미지정(null)이면 기존 휴리스틱 유지 — 구버전 클라이언트 호환.
--      · 주문번호는 upper(trim()) 정규화 후 조회('fp-1234' 입력 방어).
-- 재실행 안전.
-- ============================================================================

-- ── 1) 상품 미디어 공개 뷰 ──────────────────────────────────────────────────
create or replace view public.public_product_media as
  select id, emoji, thumbnail, images from public.products;
grant select on public.public_product_media to authenticated;

-- ── 2) create_report 재정의 (p_inquirer 추가) ───────────────────────────────
-- PostgREST 오버로드 모호성 방지를 위해 구 시그니처는 제거하고 신 시그니처만 남긴다.
drop function if exists public.create_report(text, text, text, text, jsonb);

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
revoke all on function public.create_report(text,text,text,text,jsonb,text) from public;
grant execute on function public.create_report(text,text,text,text,jsonb,text) to authenticated;
