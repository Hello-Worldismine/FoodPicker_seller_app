import React, { createContext, useContext, useState } from 'react';

const AppContext = createContext(null);

export const PRODUCT_STATUS = {
  selling: { label: '판매중',   color: '#22A06B', bg: '#E9F8F1' },
  soldout: { label: '품절',     color: '#FF8A3D', bg: '#FFF4ED' },
  paused:  { label: '판매중지', color: '#9AA3AF', bg: '#F5F6F7' },
  hidden:  { label: '반려',     color: '#E5484D', bg: '#FFF0F0' },
};

export const ORDER_SELLER_STATUS = {
  new:       { label: '신규주문', userStatus: 'pending',   color: '#FF8A3D', bg: '#FFF4ED' },
  confirmed: { label: '픽업대기', userStatus: 'pending',   color: '#22A06B', bg: '#E9F8F1' },
  completed: { label: '픽업완료', userStatus: 'completed', color: '#9AA3AF', bg: '#F5F6F7' },
  cancelled: { label: '취소요청', userStatus: 'cancelled', color: '#E5484D', bg: '#FFF0F0' },
};

function todayISO(h, m = 0) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function todayEndISO() {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

export function computeBadges(product) {
  const badges = [];
  if (product.status === 'soldout') { badges.push('품절'); return badges; }
  if (product.status !== 'selling') return badges;
  const now = new Date();
  const expiry = new Date(product.expiryDate);
  const hoursUntilExpiry = (expiry - now) / 3600000;
  if (product.discountRate >= 60) badges.push(`할인${product.discountRate}%`);
  if (hoursUntilExpiry <= 3 && hoursUntilExpiry > 0) badges.push('마감임박');
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
  if (expiry <= endOfDay) badges.push('오늘까지');
  return badges;
}

export function storageToDisplay(short) {
  return { '냉장': '냉장 보관', '실온': '실온 보관', '냉동': '냉동 보관' }[short] || short;
}

export function allergensToString(arr) {
  if (!arr || arr.length === 0) return '해당 없음';
  return arr.join(', ') + ' 함유';
}

// TODO: GET /api/seller/products — 아래 Mock 데이터를 API 응답으로 대체
export const initialProducts = [
  {
    id: 1,
    name: '닭가슴살 샐러드',
    storeId: 1,
    thumbnail: null,
    emoji: '🥗',
    images: [],
    category: '샐러드',
    originalPrice: 8900,
    salePrice: 3900,
    discountRate: 56,
    startPrice: 4900,
    floorPrice: 2900,
    reductionAmount: 500,
    intervalMinutes: 30,
    stock: 3,
    pickupStart: todayISO(18),
    pickupEnd: todayISO(20),
    expiryDate: todayEndISO(),
    storage: '냉장 보관',
    storageMethod: '냉장(0~5°C) 보관, 개봉 후 즉시 섭취 권장',
    status: 'selling',
    badges: ['오늘까지', '마감임박'],
    description: '신선한 닭가슴살과 야채로 구성된 건강 샐러드입니다.',
    composition: '닭가슴살 150g, 로메인 80g, 방울토마토 30g, 드레싱 15ml',
    origin: '닭가슴살 국내산, 채소 국내산',
    allergyInfo: '달걀, 대두, 밀 함유',
    allergens: ['난류', '대두', '밀'],
    pickupAddress: '서울 강남구 테헤란로 123',
    cancelPolicy: '픽업 전까지 취소 가능. 픽업 후 단순 변심 환불 불가.',
    storeNotice: '픽업 시 영수증 또는 픽업번호를 보여주세요.',
    lat: 37.5012,
    lng: 127.0396,
    liked: false,
  },
  {
    id: 2,
    name: '모닝빵 세트',
    storeId: 1,
    thumbnail: null,
    emoji: '🥐',
    images: [],
    category: '빵',
    originalPrice: 6000,
    salePrice: 3500,
    discountRate: 42,
    stock: 0,
    pickupStart: todayISO(8),
    pickupEnd: todayISO(11),
    expiryDate: todayISO(14),
    storage: '실온 보관',
    storageMethod: '실온 보관, 당일 섭취 권장',
    status: 'soldout',
    badges: ['품절'],
    description: '갓 구운 모닝빵 5개 세트',
    composition: '모닝빵 5개',
    origin: '밀 국내산',
    allergyInfo: '밀, 달걀, 유제품 함유',
    allergens: ['밀', '난류', '우유'],
    pickupAddress: '서울 강남구 테헤란로 123',
    cancelPolicy: '픽업 전까지 취소 가능. 픽업 후 단순 변심 환불 불가.',
    storeNotice: '',
    lat: 37.5012,
    lng: 127.0396,
    liked: false,
  },
  {
    id: 3,
    name: '한식 도시락',
    storeId: 1,
    thumbnail: null,
    emoji: '🍱',
    images: [],
    category: '도시락',
    originalPrice: 9800,
    salePrice: 5900,
    discountRate: 40,
    startPrice: 6500,
    floorPrice: 4000,
    reductionAmount: 600,
    intervalMinutes: 20,
    stock: 5,
    pickupStart: todayISO(12),
    pickupEnd: todayISO(14),
    expiryDate: todayISO(18),
    storage: '냉장 보관',
    storageMethod: '냉장(0~5°C) 보관',
    status: 'selling',
    badges: ['오늘까지'],
    description: '제철 반찬으로 구성된 한식 도시락',
    composition: '밥 200g, 반찬 3종, 국 1종',
    origin: '쌀 국내산, 채소 국내산',
    allergyInfo: '대두, 밀 함유',
    allergens: ['대두', '밀'],
    pickupAddress: '서울 강남구 테헤란로 123',
    cancelPolicy: '픽업 전까지 취소 가능.',
    storeNotice: '',
    lat: 37.5012,
    lng: 127.0396,
    liked: false,
  },
  {
    id: 4,
    name: '크루아상',
    storeId: 1,
    thumbnail: null,
    emoji: '🥐',
    images: [],
    category: '빵',
    originalPrice: 4500,
    salePrice: 2500,
    discountRate: 44,
    stock: 2,
    pickupStart: todayISO(10),
    pickupEnd: todayISO(13),
    expiryDate: todayISO(17),
    storage: '실온 보관',
    storageMethod: '실온 보관, 당일 섭취 권장',
    status: 'hidden',
    badges: [],
    rejectReason: '상품 이미지가 실제 상품과 다릅니다. 정확한 상품 이미지로 교체 후 재등록해주세요.',
    description: '버터 크루아상',
    composition: '크루아상 1개',
    origin: '밀 국내산',
    allergyInfo: '밀, 달걀, 유제품 함유',
    allergens: ['밀', '난류', '우유'],
    pickupAddress: '서울 강남구 테헤란로 123',
    cancelPolicy: '픽업 전까지 취소 가능.',
    storeNotice: '',
    lat: 37.5012,
    lng: 127.0396,
    liked: false,
  },
];

// TODO: GET /api/seller/orders?sellerStatus=all — 아래 Mock 데이터를 API 응답으로 대체
export const initialOrders = [
  {
    id: 'FP-1024',
    productId: 1,
    productName: '닭가슴살 샐러드',
    store: '그린샐러드 강남점',
    storeAddress: '서울 강남구 테헤란로 123',
    quantity: 1,
    buyerName: '김**',
    safeNumber: '050-7135-1024',
    pickupStart: todayISO(18),
    pickupEnd: todayISO(20),
    pickupTime: '오늘 18:00~20:00',
    paymentStatus: '결제완료',
    sellerStatus: 'confirmed',
    status: 'pending',
    totalPrice: 4900,
    amount: 4900,
    fee: 490,
    orderedAt: new Date().toISOString(),
  },
  {
    id: 'FP-1023',
    productId: 3,
    productName: '한식 도시락',
    store: '그린샐러드 강남점',
    storeAddress: '서울 강남구 테헤란로 123',
    quantity: 2,
    buyerName: '이**',
    safeNumber: '050-7135-1023',
    pickupStart: todayISO(12),
    pickupEnd: todayISO(14),
    pickupTime: '오늘 12:00~14:00',
    paymentStatus: '결제완료',
    sellerStatus: 'new',
    status: 'pending',
    totalPrice: 11800,
    amount: 11800,
    fee: 1180,
    orderedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'FP-1022',
    productId: 1,
    productName: '닭가슴살 샐러드',
    store: '그린샐러드 강남점',
    storeAddress: '서울 강남구 테헤란로 123',
    quantity: 1,
    buyerName: '박**',
    safeNumber: '050-7135-1022',
    pickupStart: todayISO(18),
    pickupEnd: todayISO(20),
    pickupTime: '오늘 18:00~20:00',
    paymentStatus: '결제완료',
    sellerStatus: 'new',
    status: 'pending',
    totalPrice: 4900,
    amount: 4900,
    fee: 490,
    orderedAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: 'FP-1021',
    productId: 2,
    productName: '모닝빵 세트',
    store: '그린샐러드 강남점',
    storeAddress: '서울 강남구 테헤란로 123',
    quantity: 1,
    buyerName: '최**',
    safeNumber: '050-7135-1021',
    pickupStart: todayISO(8),
    pickupEnd: todayISO(11),
    pickupTime: '오늘 08:00~11:00',
    paymentStatus: '결제완료',
    sellerStatus: 'completed',
    status: 'completed',
    totalPrice: 3500,
    amount: 3500,
    fee: 350,
    orderedAt: new Date(Date.now() - 86400000 / 2).toISOString(),
  },
  {
    id: 'FP-1020',
    productId: 3,
    productName: '한식 도시락',
    store: '그린샐러드 강남점',
    storeAddress: '서울 강남구 테헤란로 123',
    quantity: 1,
    buyerName: '정**',
    safeNumber: '050-7135-1020',
    pickupStart: todayISO(12),
    pickupEnd: todayISO(14),
    pickupTime: '어제 12:00~14:00',
    paymentStatus: '결제완료',
    sellerStatus: 'cancelled',
    status: 'cancelled',
    totalPrice: 5900,
    amount: 5900,
    fee: 590,
    orderedAt: new Date(Date.now() - 86400000).toISOString(),
    cancelReason: '단순 변심으로 인한 취소입니다.',
    cancelledAt: new Date(Date.now() - 86400000 + 300000).toISOString(),
  },
];

// TODO: GET /api/seller/reviews — 아래 Mock 데이터를 API 응답으로 대체
export const initialReviews = [
  { id: 'R-001', user: '김민정', rating: 5, date: '2024.06.14', text: '샐러드가 정말 신선하고 맛있어요! 가성비 최고입니다. 매일 먹고 싶을 정도예요.', helpful: 8, ownerReply: '소중한 리뷰 감사해요! 앞으로도 신선하고 맛있는 샐러드로 보답하겠습니다 😊' },
  { id: 'R-002', user: '이준혁', rating: 5, date: '2024.06.12', text: '닭가슴살이 촉촉하고 드레싱도 맛있어요. 다이어트 중인데 딱 좋습니다.', helpful: 5, ownerReply: null },
  { id: 'R-003', user: '박소연', rating: 4, date: '2024.06.10', text: '신선하고 양이 충분해요. 다음에도 구매할 것 같아요.', helpful: 3, ownerReply: null },
  { id: 'R-004', user: '최현우', rating: 5, date: '2024.06.08', text: '픽업도 편하고 상품도 너무 좋았어요! 강추합니다.', helpful: 2, ownerReply: '방문해 주셔서 감사합니다! 또 만나요 🙏' },
];

// TODO: GET /api/seller/settlements?period=...&status=... — 아래 Mock 데이터를 API 응답으로 대체
export const initialSettlements = [
  { id: 'ST-001', orderId: 'FP-1021', productName: '모닝빵 세트',     amount: 3500, fee: 350, platformFee: 280, pgFee: 70, refund: 0, settlement: 3150, status: '정산완료', date: '2026-07-01' },
  { id: 'ST-002', orderId: 'FP-1019', productName: '닭가슴살 샐러드', amount: 4900, fee: 490, platformFee: 392, pgFee: 98, refund: 0, settlement: 4410, status: '정산예정', date: '2026-07-01' },
  { id: 'ST-003', orderId: 'FP-1018', productName: '한식 도시락',     amount: 5900, fee: 590, platformFee: 472, pgFee: 118, refund: 0, settlement: 5310, status: '보류',     date: '2026-06-25' },
];

// TODO: GET /api/seller/notifications — 아래 Mock 데이터를 API 응답으로 대체
export const initialNotifications = [
  { id: 'N-001', type: 'reject',     title: '상품 반려', message: '크루아상 상품이 반려되었습니다. 사유를 확인하고 재등록해주세요.', time: '방금 전', read: false },
  { id: 'N-002', type: 'cancel',     title: '주문 취소', message: 'FP-1020 한식 도시락 주문이 취소되었습니다.', time: '1시간 전', read: false },
  { id: 'N-003', type: 'settlement', title: '정산 완료', message: '6/23~6/29 정산금액 3,150원이 지급되었습니다.', time: '어제', read: true },
];

// TODO: GET /api/notices — 아래 Mock 데이터를 API 응답으로 대체
export const notices = [
  {
    id: 'NC-001',
    emoji: '📣',
    title: '여름 성수기 안내',
    content: '7~8월 성수기 기간 중 픽업 시간 변동에 유의하세요.\n\n주문량 증가로 픽업 대기 시간이 늘어날 수 있습니다. 픽업 종료 시간을 여유 있게 설정하시고, 재고 수량도 넉넉히 등록해 주시기 바랍니다.\n\n기간: 2026년 7월 1일 ~ 8월 31일',
    date: '2026-07-01',
  },
  {
    id: 'NC-002',
    emoji: '💳',
    title: '정산 계좌 변경 안내',
    content: '정산 계좌는 정산일(매주 수요일) 기준 3일 전까지만 변경 가능합니다.\n\n예를 들어 7월 9일(수) 정산일의 경우, 7월 6일(일)까지 계좌 변경이 가능합니다.\n\n계좌 변경은 매장관리 > 정보 변경 신청에서 진행하실 수 있습니다.',
    date: '2026-06-28',
  },
  {
    id: 'NC-003',
    emoji: '🎉',
    title: '신규 판매자 혜택 안내',
    content: '신규 판매자를 위한 특별 혜택을 안내드립니다!\n\n첫 달 플랫폼 수수료 50% 할인 이벤트를 진행 중입니다.\n\n· 대상: 2026년 7월 31일까지 신규 입점한 판매자\n· 혜택: 입점 후 첫 달 플랫폼 수수료 50% 할인\n· 문의: 고객센터 (02-1234-5678)',
    date: '2026-06-25',
  },
];

export function AppProvider({ children }) {
  // TODO: GET /api/seller/store — 아래 Mock 데이터를 API 응답으로 대체
  const [storeInfo, setStoreInfo] = useState({
    id: 1,
    name: '그린샐러드 강남점',
    bizNumber: '123-45-67890',
    ownerName: '홍길동',
    openHours: {
      allSame: true,
      sameOpen: '08:00',
      sameClose: '21:00',
      days: {
        mon: { isOpen: true,  open: '08:00', close: '21:00' },
        tue: { isOpen: true,  open: '08:00', close: '21:00' },
        wed: { isOpen: true,  open: '08:00', close: '21:00' },
        thu: { isOpen: true,  open: '08:00', close: '21:00' },
        fri: { isOpen: true,  open: '08:00', close: '21:00' },
        sat: { isOpen: true,  open: '08:00', close: '21:00' },
        sun: { isOpen: false, open: '08:00', close: '21:00' },
      },
    },
    closedDays: ['sun'],
    address: '서울 강남구 테헤란로 123',
    phone: '02-1234-5678',
    bankName: '국민은행',
    accountNumber: '123-456-789012',
    accountHolder: '홍길동',
    residentNumber: '880101-1',
    approvalStatus: 'approved',
    commissionRate: 10,
    contractStartDate: '2024-01-15',
    isSellingPaused: false,
    category: '샐러드·건강식',
    rating: 4.8,
    reviewCount: 124,
    lat: 37.5012,
    lng: 127.0396,
    description: '매일 신선한 재료로 만드는 건강 샐러드 전문점입니다.',
    notice: '픽업 시 영수증 또는 픽업번호를 보여주세요.',
    tags: ['샐러드', '건강식', '다이어트'],
    storeImage: null,
  });

  const [products, setProducts] = useState(initialProducts);
  const [orders, setOrders] = useState(initialOrders);
  const [settlements] = useState(initialSettlements);
  const [reviews, setReviews] = useState(initialReviews);
  const [notifications, setNotifications] = useState(initialNotifications);

  // TODO: PATCH /api/seller/notifications/:id/read
  const markNotificationRead = (id) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  // TODO: PATCH /api/seller/notifications/read-all
  const markAllNotificationsRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));

  // TODO: PATCH /api/seller/store/selling-status { isSellingPaused: boolean }
  const pauseSale = () => setStoreInfo(s => ({ ...s, isSellingPaused: true }));
  const resumeSale = () => setStoreInfo(s => ({ ...s, isSellingPaused: false }));

  // TODO: PATCH /api/seller/products/:id/stock { delta: number }
  const updateProductStock = (id, delta) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const newStock = Math.max(0, p.stock + delta);
      const newStatus = newStock === 0 && p.status === 'selling' ? 'soldout' : p.status;
      return { ...p, stock: newStock, status: newStatus, badges: computeBadges({ ...p, stock: newStock, status: newStatus }) };
    }));
  };

  // TODO: PATCH /api/seller/products/:id/status { status: string }
  const updateProductStatus = (id, status) => {
    setProducts(prev => prev.map(p =>
      p.id === id ? { ...p, status, pauseReason: null, badges: computeBadges({ ...p, status }) } : p
    ));
  };

  // TODO: 서버 스케줄러 처리 권장 (앱이 백그라운드일 때 클라이언트 감지 불가) — PATCH /api/seller/products/:id/status { status: 'paused', pauseReason: 'expiry' }
  const expireProduct = (id) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== id || p.status !== 'selling') return p;
      const updated = { ...p, status: 'paused', pauseReason: 'expiry' };
      return { ...updated, badges: computeBadges(updated) };
    }));
  };

  // TODO: POST /api/seller/products — 응답에서 서버 생성 id 사용
  const addProduct = (product) => {
    const newProduct = {
      ...product,
      id: Date.now(),
      storeId: storeInfo.id,
      status: 'selling',
      liked: false,
      badges: [],
      pickupAddress: storeInfo.address,
      lat: storeInfo.lat,
      lng: storeInfo.lng,
      store: storeInfo.name,
    };
    setProducts(prev => [...prev, newProduct]);
  };

  // TODO: PUT /api/seller/products/:id
  const updateProduct = (id, data) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, ...data };
      return { ...updated, badges: computeBadges(updated) };
    }));
  };

  // TODO: PATCH /api/seller/orders/:id/complete
  const completePickup = (orderId) => {
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, sellerStatus: 'completed', status: 'completed' } : o
    ));
  };

  // TODO: PATCH /api/seller/orders/:id/confirm
  const confirmOrder = (orderId) => {
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, sellerStatus: 'confirmed', status: 'pending' } : o
    ));
  };

  // TODO: PATCH /api/seller/orders/:id/cancel
  const cancelOrder = (orderId) => {
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, sellerStatus: 'cancelled', status: 'cancelled' } : o
    ));
  };

  // TODO: DELETE /api/seller/products/:id
  const deleteProduct = (id) => {
    setProducts(prev => prev.filter(p => p.id !== id));
  };

  // TODO: 서버 스케줄러 처리 권장 — PATCH /api/seller/products/:id/price { salePrice: number, discountRate: number }
  const reduceProductPrice = (id) => {
    setProducts(prev => prev.map(p => {
      if (p.id !== id || !p.reductionAmount || !p.floorPrice || p.status !== 'selling') return p;
      const newSalePrice = Math.max(p.floorPrice, p.salePrice - p.reductionAmount);
      const newDiscountRate = Math.round((1 - newSalePrice / p.originalPrice) * 100);
      const updated = { ...p, salePrice: newSalePrice, discountRate: newDiscountRate };
      return { ...updated, badges: computeBadges(updated) };
    }));
  };

  // TODO: PUT /api/seller/reviews/:id/reply { reply: string | null }
  const updateReviewReply = (reviewId, reply) => {
    setReviews(prev => prev.map(r =>
      r.id === reviewId ? { ...r, ownerReply: reply || null } : r
    ));
  };

  const value = {
    storeInfo, setStoreInfo,
    products, setProducts,
    orders, settlements,
    reviews,
    pauseSale, resumeSale,
    updateProductStock, updateProductStatus,
    addProduct, updateProduct, deleteProduct, reduceProductPrice, expireProduct,
    completePickup, confirmOrder, cancelOrder,
    updateReviewReply,
    notifications, markNotificationRead, markAllNotificationsRead,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
