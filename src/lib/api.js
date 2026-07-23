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
    quantity: r.quantity,
    store: r.store_name,
    storeAddress: r.store_address,
    buyerName: r.buyer_name,
    safeNumber: r.safe_number,
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
    pickup_deadline_minutes: d.pickupDeadlineMinutes ?? null,
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
  // API_SPEC §6.2: 최신 등록순(created_at desc)
  const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapProduct);
}
export async function fetchOrders() {
  const { data, error } = await supabase.from('orders').select('*').order('ordered_at', { ascending: false });
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

// ───────── 변경 ─────────
export async function insertProduct(store, data) {
  const seller_id = await currentUid();
  const images = await uploadImages(data.images, seller_id, 'products');
  const row = {
    ...productToDb({ ...data, images, thumbnail: images[0] || null }),
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
  const { error } = await supabase
    .from('products')
    .update(productToDb({ ...data, images, thumbnail: images[0] || null }))
    .eq('id', id);
  if (error) throw error;
}
export async function deleteProductRow(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}
export async function updateOrderStatus(orderCode, sellerStatus, extra = {}) {
  const { error } = await supabase.from('orders').update({ seller_status: sellerStatus, ...extra }).eq('order_code', orderCode);
  if (error) throw error;
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
