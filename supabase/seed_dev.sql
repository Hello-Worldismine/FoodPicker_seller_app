-- ============================================================================
-- FoodPicker 판매자 개발용 시드 (SQL Editor에서 실행) — hsb5975@naver.com 기준
-- 프로비저닝(role=seller + 매장) + 상품/주문/리뷰/정산/알림 + 전역 공지.
-- 재실행 안전(해당 판매자 시드 삭제 후 재삽입). postgres 권한으로 RLS/컬럼잠금 우회.
-- ============================================================================
do $$
declare
  v_email text := 'hsb5975@naver.com';
  v_uid   uuid;
  v_store uuid;
  v_today date := (now() at time zone 'Asia/Seoul')::date;   -- KST 기준 오늘
begin
  select id into v_uid from auth.users where email = v_email;
  if v_uid is null then
    raise exception '% 계정이 없습니다. 앱에서 먼저 회원가입/인증하세요.', v_email;
  end if;

  -- 판매자 승격 + 이메일 인증(개발용)
  update auth.users set
    raw_app_meta_data  = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'seller'),
    email_confirmed_at = coalesce(email_confirmed_at, now())
  where id = v_uid;

  -- 매장 upsert (목 storeInfo 기반)
  insert into public.stores
    (seller_id, name, biz_number, owner_name, resident_number, address,
     bank_name, account_number, account_holder, phone, category, description, notice,
     tags, closed_days, approval_status, commission_rate, contract_start_date, lat, lng)
  values
    (v_uid, '그린샐러드 강남점', '123-45-67890', '홍길동', '880101-1', '서울 강남구 테헤란로 123',
     '국민은행', '123-456-789012', '홍길동', '02-1234-5678', '샐러드·건강식',
     '매일 신선한 재료로 만드는 건강 샐러드 전문점입니다.', '픽업 시 영수증 또는 픽업번호를 보여주세요.',
     array['샐러드','건강식','다이어트'], array['sun'], 'approved', 10, '2024-01-15', 37.5012, 127.0396)
  on conflict (seller_id) do update set
    name = excluded.name, category = excluded.category, description = excluded.description,
    approval_status = 'approved', contract_start_date = excluded.contract_start_date
  returning id into v_store;
  if v_store is null then select id into v_store from public.stores where seller_id = v_uid; end if;

  -- 기존 시드 정리(재실행 대비)
  delete from public.orders        where seller_id = v_uid;
  delete from public.settlements   where seller_id = v_uid;
  delete from public.reviews       where seller_id = v_uid;
  delete from public.products      where seller_id = v_uid;
  delete from public.notifications where seller_id = v_uid;

  -- 상품 4종
  insert into public.products
    (seller_id, store_id, name, category, emoji, original_price, start_price, floor_price, sale_price,
     discount_rate, reduction_amount, interval_minutes, stock, pickup_start, pickup_end, expiry_date,
     storage, storage_detail, status, reject_reason, description, composition, origin, allergens,
     cancel_policy, store_notice, pickup_address, lat, lng)
  values
   (v_uid, v_store, '닭가슴살 샐러드', '샐러드', '🥗', 8900, 4900, 2900, 3900, 56, 500, 30, 3,
     (v_today + time '18:00') at time zone 'Asia/Seoul', (v_today + time '20:00') at time zone 'Asia/Seoul',
     (v_today + time '23:59') at time zone 'Asia/Seoul',
     '냉장', '냉장(0~5°C) 보관, 개봉 후 즉시 섭취 권장', 'selling', null,
     '신선한 닭가슴살과 야채로 구성된 건강 샐러드입니다.', '닭가슴살 150g, 로메인 80g, 방울토마토 30g, 드레싱 15ml',
     '닭가슴살 국내산, 채소 국내산', array['난류','대두','밀'],
     '픽업 전까지 취소 가능. 픽업 후 단순 변심 환불 불가.', '픽업 시 영수증 또는 픽업번호를 보여주세요.',
     '서울 강남구 테헤란로 123', 37.5012, 127.0396),
   (v_uid, v_store, '모닝빵 세트', '빵', '🥐', 6000, null, null, 3500, 42, null, null, 0,
     (v_today + time '08:00') at time zone 'Asia/Seoul', (v_today + time '11:00') at time zone 'Asia/Seoul',
     (v_today + time '14:00') at time zone 'Asia/Seoul',
     '실온', '실온 보관, 당일 섭취 권장', 'soldout', null,
     '갓 구운 모닝빵 5개 세트', '모닝빵 5개', '밀 국내산', array['밀','난류','우유'],
     '픽업 전까지 취소 가능. 픽업 후 단순 변심 환불 불가.', '',
     '서울 강남구 테헤란로 123', 37.5012, 127.0396),
   (v_uid, v_store, '한식 도시락', '도시락', '🍱', 9800, 6500, 4000, 5900, 40, 600, 20, 5,
     (v_today + time '12:00') at time zone 'Asia/Seoul', (v_today + time '14:00') at time zone 'Asia/Seoul',
     (v_today + time '18:00') at time zone 'Asia/Seoul',
     '냉장', '냉장(0~5°C) 보관', 'selling', null,
     '제철 반찬으로 구성된 한식 도시락', '밥 200g, 반찬 3종, 국 1종', '쌀 국내산, 채소 국내산', array['대두','밀'],
     '픽업 전까지 취소 가능.', '', '서울 강남구 테헤란로 123', 37.5012, 127.0396),
   (v_uid, v_store, '크루아상', '빵', '🥐', 4500, null, null, 2500, 44, null, null, 2,
     (v_today + time '10:00') at time zone 'Asia/Seoul', (v_today + time '13:00') at time zone 'Asia/Seoul',
     (v_today + time '17:00') at time zone 'Asia/Seoul',
     '실온', '실온 보관, 당일 섭취 권장', 'hidden',
     '상품 이미지가 실제 상품과 다릅니다. 정확한 상품 이미지로 교체 후 재등록해주세요.',
     '버터 크루아상', '크루아상 1개', '밀 국내산', array['밀','난류','우유'],
     '픽업 전까지 취소 가능.', '', '서울 강남구 테헤란로 123', 37.5012, 127.0396);

  -- 주문 5건 (product_id는 이름으로 조회)
  insert into public.orders
    (seller_id, store_id, order_code, product_id, product_name, quantity, store_name, store_address,
     buyer_name, safe_number, pickup_start, pickup_end, ordered_at, confirmed_at, completed_at, cancelled_at,
     payment_status, seller_status, total_price, amount, fee, cancel_reason)
  values
   (v_uid, v_store, 'FP-1024', (select id from public.products where seller_id=v_uid and name='닭가슴살 샐러드'),
     '닭가슴살 샐러드', 1, '그린샐러드 강남점', '서울 강남구 테헤란로 123', '김**', '050-7135-1024',
     (v_today + time '18:00') at time zone 'Asia/Seoul', (v_today + time '20:00') at time zone 'Asia/Seoul',
     now(), now(), null, null, 'paid', 'confirmed', 4900, 4900, 490, null),
   (v_uid, v_store, 'FP-1023', (select id from public.products where seller_id=v_uid and name='한식 도시락'),
     '한식 도시락', 2, '그린샐러드 강남점', '서울 강남구 테헤란로 123', '이**', '050-7135-1023',
     (v_today + time '12:00') at time zone 'Asia/Seoul', (v_today + time '14:00') at time zone 'Asia/Seoul',
     now() - interval '1 hour', null, null, null, 'paid', 'new', 11800, 11800, 1180, null),
   (v_uid, v_store, 'FP-1022', (select id from public.products where seller_id=v_uid and name='닭가슴살 샐러드'),
     '닭가슴살 샐러드', 1, '그린샐러드 강남점', '서울 강남구 테헤란로 123', '박**', '050-7135-1022',
     (v_today + time '18:00') at time zone 'Asia/Seoul', (v_today + time '20:00') at time zone 'Asia/Seoul',
     now() - interval '2 hours', null, null, null, 'paid', 'new', 4900, 4900, 490, null),
   (v_uid, v_store, 'FP-1021', (select id from public.products where seller_id=v_uid and name='모닝빵 세트'),
     '모닝빵 세트', 1, '그린샐러드 강남점', '서울 강남구 테헤란로 123', '최**', '050-7135-1021',
     (v_today + time '08:00') at time zone 'Asia/Seoul', (v_today + time '11:00') at time zone 'Asia/Seoul',
     now() - interval '12 hours', now() - interval '11 hours', now() - interval '10 hours', null,
     'paid', 'completed', 3500, 3500, 350, null),
   (v_uid, v_store, 'FP-1020', (select id from public.products where seller_id=v_uid and name='한식 도시락'),
     '한식 도시락', 1, '그린샐러드 강남점', '서울 강남구 테헤란로 123', '정**', '050-7135-1020',
     (v_today - 1 + time '12:00') at time zone 'Asia/Seoul', (v_today - 1 + time '14:00') at time zone 'Asia/Seoul',
     now() - interval '1 day', null, null, now() - interval '1 day' + interval '5 minutes',
     'paid', 'cancelled', 5900, 5900, 590, '단순 변심으로 인한 취소입니다.');

  -- 리뷰 4건
  insert into public.reviews
    (seller_id, store_id, product_id, reviewer_name, rating, content, helpful_count, owner_reply, owner_replied_at, created_at)
  values
   (v_uid, v_store, (select id from public.products where seller_id=v_uid and name='닭가슴살 샐러드'),
     '김민정', 5, '샐러드가 정말 신선하고 맛있어요! 가성비 최고입니다. 매일 먹고 싶을 정도예요.', 8,
     '소중한 리뷰 감사해요! 앞으로도 신선하고 맛있는 샐러드로 보답하겠습니다 😊', now() - interval '20 days', '2024-06-14T12:00:00+09:00'),
   (v_uid, v_store, (select id from public.products where seller_id=v_uid and name='닭가슴살 샐러드'),
     '이준혁', 5, '닭가슴살이 촉촉하고 드레싱도 맛있어요. 다이어트 중인데 딱 좋습니다.', 5, null, null, '2024-06-12T12:00:00+09:00'),
   (v_uid, v_store, (select id from public.products where seller_id=v_uid and name='한식 도시락'),
     '박소연', 4, '신선하고 양이 충분해요. 다음에도 구매할 것 같아요.', 3, null, null, '2024-06-10T12:00:00+09:00'),
   (v_uid, v_store, (select id from public.products where seller_id=v_uid and name='닭가슴살 샐러드'),
     '최현우', 5, '픽업도 편하고 상품도 너무 좋았어요! 강추합니다.', 2,
     '방문해 주셔서 감사합니다! 또 만나요 🙏', now() - interval '25 days', '2024-06-08T12:00:00+09:00');

  -- 정산 3건
  insert into public.settlements
    (seller_id, store_id, settlement_code, order_code, product_name, amount, fee, platform_fee, pg_fee,
     refund, settlement_amount, status, settled_on)
  values
   (v_uid, v_store, 'ST-001', 'FP-1021', '모닝빵 세트',     3500, 350, 280, 70, 0, 3150, 'completed', '2026-07-01'),
   (v_uid, v_store, 'ST-002', 'FP-1019', '닭가슴살 샐러드', 4900, 490, 392, 98, 0, 4410, 'scheduled', '2026-07-01'),
   (v_uid, v_store, 'ST-003', 'FP-1018', '한식 도시락',     5900, 590, 472, 118, 0, 5310, 'on_hold',   '2026-06-25');

  -- 알림 3건
  insert into public.notifications (seller_id, type, title, message, is_read, created_at)
  values
   (v_uid, 'reject',     '상품 반려', '크루아상 상품이 반려되었습니다. 사유를 확인하고 재등록해주세요.', false, now()),
   (v_uid, 'cancel',     '주문 취소', 'FP-1020 한식 도시락 주문이 취소되었습니다.', false, now() - interval '1 hour'),
   (v_uid, 'settlement', '정산 완료', '6/23~6/29 정산금액 3,150원이 지급되었습니다.', true, now() - interval '1 day');

  raise notice '시드 완료: % (store=%)', v_email, v_store;
end $$;

-- 전역 공지 (판매자 무관, 재실행 안전)
insert into public.notices (notice_code, emoji, title, content, published_at)
values
 ('NC-001', '📣', '여름 성수기 안내',
  E'7~8월 성수기 기간 중 픽업 시간 변동에 유의하세요.\n\n주문량 증가로 픽업 대기 시간이 늘어날 수 있습니다. 픽업 종료 시간을 여유 있게 설정하시고, 재고 수량도 넉넉히 등록해 주시기 바랍니다.\n\n기간: 2026년 7월 1일 ~ 8월 31일',
  '2026-07-01'),
 ('NC-002', '💳', '정산 계좌 변경 안내',
  E'정산 계좌는 정산일(매주 수요일) 기준 3일 전까지만 변경 가능합니다.\n\n예를 들어 7월 9일(수) 정산일의 경우, 7월 6일(일)까지 계좌 변경이 가능합니다.\n\n계좌 변경은 매장관리 > 정보 변경 신청에서 진행하실 수 있습니다.',
  '2026-06-28'),
 ('NC-003', '🎉', '신규 판매자 혜택 안내',
  E'신규 판매자를 위한 특별 혜택을 안내드립니다!\n\n첫 달 플랫폼 수수료 50% 할인 이벤트를 진행 중입니다.\n\n· 대상: 2026년 7월 31일까지 신규 입점한 판매자\n· 혜택: 입점 후 첫 달 플랫폼 수수료 50% 할인\n· 문의: 고객센터 (02-1234-5678)',
  '2026-06-25')
on conflict (notice_code) do update set
  emoji = excluded.emoji, title = excluded.title, content = excluded.content, published_at = excluded.published_at;
