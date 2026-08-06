// Supabase 데이터 접근 계층 (API_SPEC.md §6 계약)
// DB(snake_case, enum) ↔ 앱(camelCase) 매핑 + 조회/변경 쿼리.
import { supabase } from './supabase';
import { uploadImages } from './storage';
import { formatPhone } from './format';

async function currentUid() {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// ───────── DB row → 앱 shape 매퍼 ─────────
export function mapStore(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    bizNumber: r.biz_number,
    ownerName: r.owner_name,
    residentNumber: r.resident_number,
    address: r.address,
    bankName: r.bank_name,
    accountNumber: r.account_number,
    accountHolder: r.account_holder,
    phone: formatPhone(r.phone),
    category: r.category,
    description: r.description,
    notice: r.notice,
    tags: r.tags || [],
    storeImage: r.store_image,
    openHours: r.open_hours,
    closedDays: r.closed_days || [],
    lat: r.lat,
    lng: r.lng,
    defaultPickupDeadlineMinutes: r.default_pickup_deadline_minutes ?? null,
    approvalStatus: r.approval_status,
    isSellingPaused: r.is_selling_paused,
    commissionRate: r.commission_rate,
    contractStartDate: r.contract_start_date,
    bizCertImage: r.biz_cert_image,
    rating: r.rating != null ? Number(r.rating) : 0,
    reviewCount: r.review_count,
  };
}

export function mapProduct(r) {
  return {
    id: r.id,
    storeId: r.store_id,
    name: r.name,
    category: r.category,
    emoji: r.emoji,
    thumbnail: r.thumbnail,
    images: r.images || [],
    originalPrice: r.original_price,
    startPrice: r.start_price,
    floorPrice: r.floor_price,
    salePrice: r.sale_price,
    discountRate: r.discount_rate,
    reductionAmount: r.reduction_amount,
    intervalMinutes: r.interval_minutes,
    lastReducedAt: r.last_reduced_at,
    createdAt: r.created_at,
    stock: r.stock,
    // 픽업 마감 정본 = 절대 시각(pickup_deadline_at). minutes 는 구 데이터 표시 호환용.
    pickupDeadlineAt: r.pickup_deadline_at ?? null,
    pickupDeadlineMinutes: r.pickup_deadline_minutes ?? null,
    expiryDate: r.expiry_date,
    storage: r.storage,
    storageDetail: r.storage_detail,
    status: r.status,
    pauseReason: r.pause_reason,
    rejectReason: r.reject_reason,
    description: r.description,
    composition: r.composition,
    origin: r.origin,
    allergens: r.allergens || [],
    cancelPolicy: r.cancel_policy,
    storeNotice: r.store_notice,
    pickupAddress: r.pickup_address,
    lat: r.lat,
    lng: r.lng,
    liked: false,
  };
}

export function mapOrder(r) {
  return {
    id: r.order_code, // 화면 표시용 주문번호(FP-####)
    productId: r.product_id,
    productName: r.product_name,
    productThumbnail: r.products?.thumbnail || null,
    productEmoji: r.products?.emoji || null,
    quantity: r.quantity,
    store: r.store_name,
    storeAddress: r.store_address,
    buyerName: r.buyer_name,
    safeNumber: r.safe_number,
    // 픽업 마감 기준(정본) — create_order v3 이 주문 시점에 스냅샷한다.
    pickupDeadlineMinutes: r.pickup_deadline_minutes ?? null,
    pickupDeadlineAt: r.pickup_deadline_at ?? null,
    // pickupStart/End 는 구 데이터·하위호환용(create_order v3 가 주문시각~마감시각으로 채운다)
    pickupStart: r.pickup_start,
    pickupEnd: r.pickup_end,
    orderedAt: r.ordered_at,
    confirmedAt: r.confirmed_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    paymentStatus: r.payment_status,
    sellerStatus: r.seller_status,
    totalPrice: r.total_price,
    amount: r.amount,
    fee: r.fee,
    cancelReason: r.cancel_reason,
    // 취소요청 흐름(마이그레이션 20260731000000) — seller_status enum 을 건드리지 않는
    // '플래그' 컬럼이다. 요청 대기(requested)여도 seller_status 는 new/confirmed 그대로다.
    cancelRequestStatus: r.cancel_request_status ?? null,
    cancelRequestedAt: r.cancel_requested_at ?? null,
    cancelRequestReason: r.cancel_request_reason ?? null,
    cancelRespondedAt: r.cancel_responded_at ?? null,
    cancelResponseReason: r.cancel_response_reason ?? null,
    // 실제 환불 금액(승인 시 결제금액 전액 — 수수료 차감 없음).
    refundAmount: r.refund_amount ?? 0,
    paymentKey: r.payment_key ?? null,
  };
}

export function mapReview(r) {
  return {
    id: r.id,
    user: r.reviewer_name,
    rating: r.rating,
    text: r.content,
    helpful: r.helpful_count,
    createdAt: r.created_at,
    ownerReply: r.owner_reply,
    ownerRepliedAt: r.owner_replied_at,
  };
}

export function mapSettlement(r) {
  return {
    id: r.settlement_code,
    orderId: r.order_code,
    productName: r.product_name,
    amount: r.amount,
    fee: r.fee,
    platformFee: r.platform_fee,
    pgFee: r.pg_fee,
    refund: r.refund,
    couponBurden: r.coupon_burden || 0,   // 쿠폰 할인 판매자 부담액
    settlement: r.settlement_amount,
    status: r.status,
    date: r.settled_on,
  };
}

export function mapNotification(r) {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    message: r.message,
    read: r.is_read,
    createdAt: r.created_at,
    referenceType: r.reference_type ?? null,
    referenceId: r.reference_id ?? null,
  };
}

export function mapNotice(r) {
  return {
    id: r.notice_code,
    emoji: r.emoji,
    title: r.title,
    content: r.content,
    date: r.published_at,
  };
}

export function mapCoupon(r) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    discountType: r.discount_type,        // 'amount' | 'rate'
    discountValue: r.discount_value,
    maxDiscountAmount: r.max_discount_amount,
    minOrderAmount: r.min_order_amount,
    endsOn: r.ends_on,
    isActive: r.is_active,
    allowStacking: r.allow_stacking,
    costBearer: r.cost_bearer,             // 'platform' | 'seller' | 'shared'
    platformShare: r.platform_share,
    source: r.source,                      // 'admin' | 'seller'
    sellerId: r.seller_id,
    requestStatus: r.request_status,       // 'pending' | 'approved' | 'rejected' | null
    rejectReason: r.reject_reason,
    totalQuantity: r.total_quantity,
    createdAt: r.created_at,
  };
}

// ───────── 앱 shape → DB 매퍼 ─────────
function productToDb(d) {
  const out = {
    name: d.name,
    category: d.category,
    emoji: d.emoji,
    thumbnail: d.thumbnail,
    images: d.images,
    original_price: d.originalPrice,
    start_price: d.startPrice ?? null,
    floor_price: d.floorPrice ?? null,
    sale_price: d.salePrice,
    discount_rate: d.discountRate,
    reduction_amount: d.reductionAmount ?? null,
    interval_minutes: d.intervalMinutes ?? null,
    stock: d.stock,
    // 픽업 마감은 '마감 시각'(절대)만 저장한다. pickup_deadline_minutes 는 DEPRECATED —
    // 주문 시점의 '남은 분'은 create_order v4 가 서버에서 계산해 채운다.
    pickup_deadline_at: d.pickupDeadlineAt ?? null,
    expiry_date: d.expiryDate,
    storage: d.storage,
    storage_detail: d.storageDetail,
    description: d.description,
    composition: d.composition,
    origin: d.origin,
    allergens: d.allergens || [],
    cancel_policy: d.cancelPolicy,
    store_notice: d.storeNotice,
  };
  Object.keys(out).forEach(k => out[k] === undefined && delete out[k]);
  return out;
}

// 매장 camelCase patch → DB. 매핑에 없는 키(approvalStatus 등)는 자동 제외(컬럼잠금 보호).
const STORE_COL = {
  name: 'name', bizNumber: 'biz_number', ownerName: 'owner_name', residentNumber: 'resident_number',
  address: 'address', bankName: 'bank_name', accountNumber: 'account_number', accountHolder: 'account_holder',
  phone: 'phone', category: 'category', description: 'description', notice: 'notice',
  tags: 'tags', storeImage: 'store_image', openHours: 'open_hours', closedDays: 'closed_days',
  lat: 'lat', lng: 'lng', isSellingPaused: 'is_selling_paused', bizCertImage: 'biz_cert_image',
  // [DEPRECATED] 매장 기본 픽업 마감(분) — 마감이 상품별 절대 시각으로 바뀌어 더 이상 쓰지 않는다.
  // 구 클라이언트/구 데이터 호환을 위해 매핑만 남긴다(앱에서 patch 하지 않는다).
  defaultPickupDeadlineMinutes: 'default_pickup_deadline_minutes',
};
export function storeToDb(patch) {
  const out = {};
  for (const k in patch) if (STORE_COL[k] && patch[k] !== undefined) out[STORE_COL[k]] = patch[k];
  return out;
}

// ───────── 조회 ─────────
export async function fetchStore() {
  const uid = await currentUid();
  if (!uid) return null;
  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .eq('seller_id', uid)
    .maybeSingle();
  if (error) throw error;
  return mapStore(data);
}
export async function fetchProducts() {
  const uid = await currentUid();
  if (!uid) return [];
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('seller_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapProduct);
}
export async function fetchOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('*, products(thumbnail, emoji)')
    .order('ordered_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapOrder);
}
export async function fetchReviews() {
  const { data, error } = await supabase.from('reviews').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapReview);
}
export async function fetchSettlements() {
  const { data, error } = await supabase.from('settlements').select('*').order('settled_on', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapSettlement);
}
export async function fetchNotifications() {
  const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapNotification);
}

// ── 1:1 문의(고객센터) — 관리자 웹 신고/문의관리(reports)와 연동 ──────────────────
// create_report RPC(20260722020000 마이그레이션)가 p_inquirer='seller' 로 호출 시
// 본인 매장 보유 여부를 서버에서 검증 후 inquirer_type='seller' 로 접수한다.
export async function createSellerInquiry(type, title, content) {
  const { data, error } = await supabase.rpc('create_report', {
    p_type: type, p_title: title, p_content: content, p_inquirer: 'seller',
  });
  if (error) throw error;
  return { id: data.id, receiptCode: data.receipt_code };
}

// 내 문의 내역 — my_reports 뷰(reporter_id=본인 행만 RLS 로 노출, 구매자/판매자 공용).
export async function fetchMyInquiries() {
  const { data, error } = await supabase
    .from('my_reports').select('*').order('received_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(r => ({
    id: r.id,
    receiptCode: r.receipt_code,
    type: r.type,
    title: r.title,
    content: r.content,
    status: r.status,
    orderCode: r.order_code ?? null,
    receivedAt: r.received_at,
  }));
}

// 문의 답변 이력 — report_logs 중 kind='reply' 만(RLS: 본인 문의 건 한정).
// 관리자 웹이 붙이는 "답변 등록: " 접두어는 노출용으로 제거한다.
export async function fetchInquiryReplies(reportId) {
  const { data, error } = await supabase
    .from('report_logs').select('id, message, created_at')
    .eq('report_id', reportId).eq('kind', 'reply')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(r => ({
    id: r.id,
    message: (r.message || '').replace(/^답변 등록:\s*/, ''),
    createdAt: r.created_at,
  }));
}
export async function fetchNotices() {
  // target: 관리자 웹이 공지 대상(all/buyer/seller)을 지정 — 판매자 앱은 전체·판매자 대상만 노출.
  // (20260716 마이그레이션 이전 DB 에는 target 컬럼이 없으므로 실패 시 필터 없이 재조회)
  let { data, error } = await supabase.from('notices').select('*')
    .eq('is_published', true).in('target', ['all', 'seller'])
    .order('published_at', { ascending: false });
  if (error) {
    ({ data, error } = await supabase.from('notices').select('*')
      .eq('is_published', true).order('published_at', { ascending: false }));
  }
  if (error) throw error;
  return (data || []).map(mapNotice);
}
// 본인이 발행 신청한 쿠폰(대기/승인/반려 포함). RLS: seller_id = auth.uid()
export async function fetchMyCoupons() {
  const seller_id = await currentUid();
  const { data, error } = await supabase.from('coupons').select('*')
    .eq('seller_id', seller_id).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapCoupon);
}
// 쿠폰 발행 신청(서버가 부담주체/상태 강제). 성공 시 생성된 쿠폰 반환.
export async function requestCoupon(d) {
  const { data, error } = await supabase.rpc('request_coupon', {
    p_name: d.name,
    p_discount_type: d.discountType,
    p_discount_value: d.discountValue,
    p_min_order_amount: d.minOrderAmount ?? 0,
    p_ends_on: d.endsOn || null,
    p_allow_stacking: !!d.allowStacking,
    p_max_discount_amount: d.discountType === 'rate' ? (d.maxDiscountAmount ?? null) : null,
    p_total_quantity: d.totalQuantity ?? null,
  });
  if (error) throw error;
  return mapCoupon(data);
}
// 관리자가 매장 지정 발급한 쿠폰(source='admin', pending) 수락/거절.
// 수락 시 서버가 approved+활성화 처리 → 사용자 앱 상점 상세에 노출. 갱신된 쿠폰 반환.
export async function respondCouponOffer(couponId, accept, reason = null) {
  const { data, error } = await supabase.rpc('respond_coupon_offer', {
    p_coupon_id: couponId,
    p_accept: accept,
    p_reason: reason,
  });
  if (error) throw error;
  return mapCoupon(data);
}

// ───────── 변경 ─────────
export async function insertProduct(store, data) {
  const seller_id = await currentUid();
  const images = await uploadImages(data.images, seller_id, 'products');
  const cols = productToDb({ ...data, images, thumbnail: images[0] || null });
  // 픽업 마감 시각은 필수값이다 — 비어 있으면 create_order 가 소비기한/1시간 뒤로 대체하므로
  // 판매자가 의도하지 않은 마감이 잡힌다. 구 화면 경로로 값이 없으면 소비기한을 마감으로 본다
  // (마이그레이션 20260730000000 의 백필 규칙과 동일. DB 제약: 마감 <= 소비기한).
  if (!cols.pickup_deadline_at) cols.pickup_deadline_at = data.expiryDate ?? null;
  const row = {
    ...cols,
    seller_id,
    store_id: store?.id,
    status: 'selling',
    pickup_address: store?.address,
    lat: store?.lat,
    lng: store?.lng,
  };
  const { error } = await supabase.from('products').insert(row);
  if (error) throw error;
}
export async function updateProductRow(id, patch) {
  const { error } = await supabase.from('products').update(patch).eq('id', id);
  if (error) throw error;
}
export async function updateProductData(id, data) {
  const seller_id = await currentUid();
  const images = await uploadImages(data.images, seller_id, 'products');
  const patch = productToDb({ ...data, images, thumbnail: images[0] || null });

  // 마감 시각을 넘기지 않은 호출(구 화면 경로)이 기존 마감을 null 로 덮어쓰지 않게 한다.
  if (patch.pickup_deadline_at == null) delete patch.pickup_deadline_at;

  // 자동 판매중지(status='paused')된 상품은 기한을 미래로 고쳐도 status 가 그대로여서
  // 사용자앱에 다시 뜨지 않았다. 서버 expire_products() 가 중지시키는 두 사유
  //   · pause_reason='expiry'        → 소비기한 경과
  //   · pause_reason='pickup_closed' → 픽업 마감 경과 (20260730000000)
  // 에 대해, 소비기한과 픽업 마감이 모두 미래일 때만 판매중으로 되살린다.
  // (품절/관리자 숨김 상태는 건드리지 않는다)
  if (patch.expiry_date && new Date(patch.expiry_date).getTime() > Date.now()) {
    const { data: row } = await supabase
      .from('products').select('status, pause_reason, stock, pickup_deadline_at').eq('id', id).maybeSingle();
    const nextStock = patch.stock != null ? patch.stock : row?.stock;
    // 마감은 이번 patch 값이 우선, 없으면 현재 저장값 기준으로 판단한다.
    const nextDeadline = patch.pickup_deadline_at ?? row?.pickup_deadline_at;
    const futureDeadline = !nextDeadline || new Date(nextDeadline).getTime() > Date.now();
    const autoPaused = row?.pause_reason === 'expiry' || row?.pause_reason === 'pickup_closed';
    if (row && row.status === 'paused' && autoPaused && futureDeadline && nextStock > 0) {
      patch.status = 'selling';
      patch.pause_reason = null;
    }
  }

  const { error } = await supabase.from('products').update(patch).eq('id', id);
  if (error) throw error;
}
export async function deleteProductRow(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}
// 주문 확인(confirm) / 취소(cancel) 전용. 픽업 완료는 complete_pickup RPC 를 쓴다.
//
// [주의] PostgREST 의 update 는 조건에 맞는 행이 0개여도 error 가 null 이다.
//   RLS(orders_update: seller_id = auth.uid()) 에 걸리거나 order_code 가 틀리면
//   "성공했지만 아무것도 안 바뀐" 상태가 되어 버튼이 먹통인 것처럼 보인다.
//   → select() 로 갱신된 행을 돌려받아 0건이면 명시적으로 throw 한다.
export async function updateOrderStatus(orderCode, sellerStatus, extra = {}) {
  const { data, error } = await supabase
    .from('orders')
    .update({ seller_status: sellerStatus, ...extra })
    .eq('order_code', orderCode)
    .select('order_code, seller_status');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(`주문(${orderCode})을 변경할 수 없습니다. 우리 매장 주문이 아니거나 이미 처리된 주문일 수 있습니다.`);
  }
  return mapOrder({ ...data[0] });
}

// ───────── 취소·환불 (마이그레이션 20260731000000) ─────────
// [순서 규약] **PG 취소 먼저, DB 나중**. 관리자웹 refundOrder / 사용자앱 cancelOrder 와 동일하다.
//   반대로 하면 'DB 는 취소인데 돈은 안 돌아간' 더 나쁜 상태가 된다.
//   toss-cancel 은 이미 취소된 결제를 성공으로 간주(멱등)하므로
//   'PG 성공 → DB 실패' 후 승인 버튼을 다시 눌러도 여기서 막히지 않는다.
//
// 결제(payment_key)가 없는 주문은 PG 취소 대상이 아니므로 건너뛴다(false 반환).
async function cancelTossPayment(orderCode, cancelReason) {
  const { data: row, error: findError } = await supabase
    .from('orders').select('payment_key').eq('order_code', orderCode).maybeSingle();
  if (findError) throw findError;
  if (!row || !row.payment_key) return false;

  const { data, error } = await supabase.functions.invoke('toss-cancel', {
    body: { paymentKey: row.payment_key, cancelReason },
  });
  if (error) {
    // 4xx(FunctionsHttpError)이면 함수가 내려준 { error } 메시지를 꺼내 한국어로 던진다.
    let msg = error.message;
    try {
      if (error.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        if (body && body.error) msg = body.error;
      }
    } catch (e) {}
    throw new Error(msg || '결제 취소(환불)에 실패했습니다.');
  }
  if (data && data.error) throw new Error(data.error);
  return true;
}

// 구매자 취소요청에 대한 판매자 응답.
//   · 승인(approve=true)  : PG 전액취소 성공 → respond_order_cancel(수수료 0원·전액 환불 기록)
//   · 거절(approve=false) : PG 를 건드리지 않고 RPC 만(주문은 원래 상태 그대로 유지된다)
// 실패 시 error.message 가 대문자 상수(NO_PENDING_REQUEST/ALREADY_APPROVED/NOT_MY_ORDER 등) —
// 호출부에서 pickupErrorMessage 로 한국어 안내로 바꾼다.
export async function respondOrderCancel(orderCode, approve, reason = null) {
  const p_reason = reason && reason.trim() ? reason.trim() : null;
  if (approve) {
    await cancelTossPayment(orderCode, '구매자 취소요청 승인(수수료 면제 전액 환불)');
  }
  const { data, error } = await supabase.rpc('respond_order_cancel', {
    p_order_code: orderCode,
    p_approve: !!approve,
    p_reason,
  });
  if (error) throw error;
  return mapOrder(data);
}

// 판매자 자발 취소(신규주문·픽업대기 단계의 '주문 취소').
// [순서 규약] 위와 동일하게 **PG 전액취소 먼저, DB(RPC) 나중**.
// [주의] 여기서 orders 를 직접 UPDATE 하면 안 된다 — authenticated 의 컬럼 화이트리스트가
//   (seller_status, cancel_reason) 뿐이라 payment_status='refunded' / fee=0 / refund_amount /
//   refunded_at 을 쓸 수 없다. 즉 '돈은 나갔는데 장부는 결제완료·수수료 부과' 로 갈라진다.
//   → 승인 경로(respond_order_cancel)와 같은 기록을 남기는 security definer RPC
//     seller_cancel_order 를 쓴다(수수료 0원·전액 환불 기록 + 재고·쿠폰 복구 + 양쪽 알림).
//   RPC 는 멱등이다(이미 cancelled 면 현재 행 반환) — 'PG 성공 → RPC 실패' 후 재시도해도 안전하다.
// 결제(payment_key)가 없는 주문은 cancelTossPayment 가 PG 호출을 건너뛰고 false 를 반환한다.
// 실패 시 error.message 가 대문자 상수(NOT_CANCELLABLE/ALREADY_COMPLETED/NOT_MY_ORDER 등) —
// 호출부에서 pickupErrorMessage 로 한국어 안내로 바꾼다.
export async function cancelOrderWithRefund(orderCode, reason) {
  const trimmed = reason && reason.trim() ? reason.trim() : '';
  await cancelTossPayment(orderCode, trimmed || '판매자 주문 취소');
  const { data, error } = await supabase.rpc('seller_cancel_order', {
    p_order_code: orderCode,
    p_reason: trimmed || null,
  });
  if (error) throw error;
  return mapOrder(data);
}

// ───────── QR 픽업 (20260728000000 마이그레이션 §6) ─────────
// QR 값/직접 입력에서 주문번호(FP-####)만 추출. 딥링크·공백·소문자를 흡수한다.
export function parseOrderCode(raw) {
  const s = String(raw ?? '').trim().toUpperCase();
  const m = s.match(/FP-\d+/);
  return m ? m[0] : null;
}

// 스캔 직후 확인용 조회. security invoker + RLS 이므로 본인 매장 주문만 보인다(없으면 null).
export async function lookupOrderForPickup(code) {
  const p_order_code = parseOrderCode(code) || String(code ?? '').trim();
  const { data, error } = await supabase.rpc('lookup_order_for_pickup', { p_order_code });
  if (error) throw error;
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return null;
  // 반환 컬럼이 orders 전체가 아닌 확인용 부분집합 → mapOrder 대신 전용 매핑.
  return {
    id: r.order_code,
    productName: r.product_name,
    quantity: r.quantity,
    buyerName: r.buyer_name,
    sellerStatus: r.seller_status,
    paymentStatus: r.payment_status,
    orderedAt: r.ordered_at,
    pickupDeadlineMinutes: r.pickup_deadline_minutes ?? null,
    pickupDeadlineAt: r.pickup_deadline_at ?? null,
    amount: r.amount,
    totalPrice: r.total_price,
  };
}

// 픽업 완료(원자적 상태 전이 + 구매자 알림). 실패 시 error.message 가 대문자 상수
// (NOT_AUTHENTICATED/INVALID_CODE/ORDER_NOT_FOUND/NOT_MY_ORDER/ALREADY_COMPLETED/
//  ORDER_CANCELLED/NOT_PAID) — 호출부에서 분기해 한국어 안내로 바꾼다.
export async function completePickupByQr(code) {
  const p_order_code = parseOrderCode(code) || String(code ?? '').trim();
  const { data, error } = await supabase.rpc('complete_pickup', { p_order_code });
  if (error) throw error;
  return mapOrder(data);
}
export async function updateReviewReplyRow(reviewId, reply) {
  const { error } = await supabase.from('reviews').update({
    owner_reply: reply || null,
    owner_replied_at: reply ? new Date().toISOString() : null,
  }).eq('id', reviewId);
  if (error) throw error;
}
export async function markNotifRead(id) {
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  if (error) throw error;
}
export async function markAllNotifRead() {
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
  if (error) throw error;
}
export async function deleteNotification(id) {
  const { error } = await supabase.from('notifications').delete().eq('id', id);
  if (error) throw error;
}
export async function updateStoreRow(dbPatch) {
  const seller_id = await currentUid();
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await supabase.from('stores').update(dbPatch).eq('seller_id', seller_id);
  if (error) throw error;
}

// ───────── 온보딩 ─────────
// 로그인했으나 매장이 없는 판매자가 본인 매장을 생성(멱등). 생성된 stores 행을 매핑해 반환.
export async function provisionMyStore() {
  const { data, error } = await supabase.rpc('provision_my_store');
  if (error) throw error;
  return mapStore(data);
}
