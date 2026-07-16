-- ============================================================================
-- FoodPicker 관리자 웹 개발용 시드 (선택 — SQL Editor 에서 실행)
--   전제: 20260716000000_admin.sql 적용 + seed_dev.sql(판매자 시드) 적용 상태.
--   신고/문의·배너 샘플 데이터를 넣어 관리자 화면을 채운다. 재실행 안전(있으면 스킵).
-- ============================================================================

-- 신고/문의 샘플: 판매자 hsb5975@naver.com 의 매장/주문에 연결
do $$
declare
  v_seller uuid;
  v_store  public.stores;
  v_order  public.orders;
begin
  select id into v_seller from auth.users where email = 'hsb5975@naver.com';
  if v_seller is null then raise notice 'seed 판매자 없음 — seed_dev.sql 먼저 실행'; return; end if;
  select * into v_store from public.stores where seller_id = v_seller;
  select * into v_order from public.orders where seller_id = v_seller order by ordered_at desc limit 1;

  if not exists (select 1 from public.reports) then
    insert into public.reports
      (inquirer_type, type, order_id, order_code, buyer_name, store_id, seller_id, store_name,
       title, content, status, received_at)
    values
      ('buyer', '상품 상태가 설명과 달라요', v_order.id, v_order.order_code, coalesce(v_order.buyer_name, '구**'),
       v_store.id, v_seller, v_store.name,
       '상품 상태가 사진과 달랐어요', '수령한 상품이 상세 사진과 많이 달랐습니다. 확인 부탁드립니다.',
       'checking', now() - interval '1 day'),
      ('buyer', '결제/환불 문제가 있어요', v_order.id, v_order.order_code, coalesce(v_order.buyer_name, '구**'),
       v_store.id, v_seller, v_store.name,
       '취소 후 환불이 안 돼요', '주문을 취소했는데 환불 확인이 안 됩니다.',
       'received', now() - interval '3 hours'),
      ('seller', '정산 관련 문의', null, null, null,
       v_store.id, v_seller, v_store.name,
       '이번 주 정산 금액 확인 부탁드립니다', '정산 내역이 예상보다 적게 계산된 것 같습니다. 수수료 기준 확인 부탁드립니다.',
       'received', now() - interval '2 days');
  end if;
end $$;

-- 배너 샘플
insert into public.banners (title, link, position, start_date, end_date, is_active)
select * from (values
  ('소비기한 임박 특가!', '/sale', 'main_top', current_date - 10, current_date + 20, true),
  ('신규 판매자 모집', '/seller-join', 'main_middle', current_date - 5, current_date + 30, true),
  ('여름 시즌 음료 특가', '/category/drinks', 'main_bottom', current_date, current_date + 60, false)
) as v(title, link, position, start_date, end_date, is_active)
where not exists (select 1 from public.banners);

select '완료: reports ' || (select count(*) from public.reports) || '건, banners ' ||
       (select count(*) from public.banners) || '건' as result;
