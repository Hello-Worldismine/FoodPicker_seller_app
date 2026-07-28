import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './authStore';
import * as api from '../lib/api';
import { uploadImageIfLocal } from '../lib/storage';
import { formatDeadlineMinutes } from '../lib/format';
import { supabase } from '../lib/supabase';

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

// 정산 상태 라벨맵 — DB settlement_status enum(영문 키)과 1:1.
export const SETTLEMENT_STATUS = {
  scheduled: { label: '정산예정', color: '#FF8A3D', bg: '#FFF4ED' },
  completed: { label: '정산완료', color: '#22A06B', bg: '#E9F8F1' },
  on_hold:   { label: '보류',     color: '#E5484D', bg: '#FFF0F0' },
};

// 결제 상태 라벨맵 — DB payment_status enum(영문 키)과 1:1.
export const PAYMENT_STATUS = {
  pending:   { label: '결제대기', color: '#FF8A3D' },
  paid:      { label: '결제완료', color: '#22A06B' },
  cancelled: { label: '결제취소', color: '#9AA3AF' },
  refunded:  { label: '환불',     color: '#E5484D' },
};

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

// created_at → 상대 시간 표기 (알림 목록).
export function formatRelativeTime(iso) {
  if (!iso) return '';
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return '어제';
  if (diffDay < 7) return `${diffDay}일 전`;
  return formatReviewDate(iso);
}

// created_at → 'YYYY.MM.DD' (리뷰 목록)
export function formatReviewDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function hhmm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 날짜 → '오늘' / '어제' / '내일' / 'M.D'
function dayLabelOf(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === -1) return '어제';
  if (diff === 1) return '내일';
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

// pickup_start/pickup_end → '오늘/어제/내일/M.D HH:MM~HH:MM'
// [구 데이터용] 픽업 정본 표기는 아래 formatPickupDeadline 을 쓴다.
export function formatPickupWindow(start, end) {
  if (!start) return '';
  const s = new Date(start);
  return `${dayLabelOf(s)} ${hhmm(s)}${end ? '~' + hhmm(new Date(end)) : ''}`;
}

// 픽업 마감(분) → '30분 이내' / '1시간 이내' / '1시간 30분 이내'
export function formatDeadlineDuration(minutes) {
  const label = formatDeadlineMinutes(minutes);
  return label ? `${label} 이내` : '';
}

// 픽업 마감 시각 → '오늘 18:30까지' / '어제 21:00까지'
// 인자: (order 객체) 또는 (pickup_deadline_at) 또는 (ordered_at, pickup_deadline_minutes).
// pickup_deadline_at 이 없는 구 주문도 ordered_at + 분으로 마감시각을 복원한다.
export function formatPickupDeadline(source, minutes) {
  let deadline = null;
  if (source && typeof source === 'object' && !(source instanceof Date)) {
    const o = source;
    if (o.pickupDeadlineAt) deadline = new Date(o.pickupDeadlineAt);
    else if (o.orderedAt) deadline = new Date(new Date(o.orderedAt).getTime() + (o.pickupDeadlineMinutes ?? 60) * 60000);
    else if (o.pickupEnd) deadline = new Date(o.pickupEnd); // 구 데이터 폴백
  } else if (source) {
    const base = new Date(source);
    const m = Number(minutes);
    deadline = Number.isFinite(m) && m > 0 ? new Date(base.getTime() + m * 60000) : base;
  }
  if (!deadline || Number.isNaN(deadline.getTime())) return '';
  return `${dayLabelOf(deadline)} ${hhmm(deadline)}까지`;
}

// complete_pickup RPC 의 대문자 에러상수 → 판매자용 한국어 안내.
export function pickupErrorMessage(err) {
  const msg = String(err?.message || '');
  if (msg.includes('ALREADY_COMPLETED')) return '이미 픽업 완료된 주문입니다.';
  if (msg.includes('ORDER_CANCELLED')) return '취소된 주문입니다.';
  if (msg.includes('NOT_PAID')) return '결제가 완료되지 않은 주문입니다.';
  if (msg.includes('ORDER_NOT_FOUND') || msg.includes('NOT_MY_ORDER')) return '우리 매장 주문이 아닙니다.';
  if (msg.includes('INVALID_CODE')) return '주문번호를 인식할 수 없습니다.';
  if (msg.includes('NOT_AUTHENTICATED')) return '로그인이 필요합니다. 다시 로그인해주세요.';
  return msg || '픽업 완료 처리에 실패했습니다.';
}

function withBadges(p) {
  return { ...p, badges: computeBadges(p) };
}

export function AppProvider({ children }) {
  const { user } = useAuth();
  const [storeInfo, setStoreInfoState] = useState(null);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const prevUidRef = React.useRef(null);

  const reloadProducts = useCallback(async () => {
    setProducts((await api.fetchProducts()).map(withBadges));
  }, []);
  const reloadOrders = useCallback(async () => { setOrders(await api.fetchOrders()); }, []);
  const reloadReviews = useCallback(async () => { setReviews(await api.fetchReviews()); }, []);
  const reloadNotifications = useCallback(async () => { setNotifications(await api.fetchNotifications()); }, []);
  const reloadSettlements = useCallback(async () => { setSettlements(await api.fetchSettlements()); }, []);
  const reloadStore = useCallback(async () => { setStoreInfoState(await api.fetchStore()); }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, o, st, r, n, nc] = await Promise.allSettled([
        api.fetchStore(),
        api.fetchProducts(),
        api.fetchOrders(),
        api.fetchSettlements(),
        api.fetchReviews(),
        api.fetchNotifications(),
        api.fetchNotices(),
      ]);
      // 스토어는 Gate 분기의 핵심 — 실패해도 null로 명시 설정(다음 로드 시 재시도 가능)
      if (s.status === 'fulfilled') setStoreInfoState(s.value);
      else console.warn('[appStore] fetchStore 실패:', s.reason?.message);
      if (p.status === 'fulfilled') setProducts(p.value.map(withBadges));
      if (o.status === 'fulfilled') setOrders(o.value);
      if (st.status === 'fulfilled') setSettlements(st.value);
      if (r.status === 'fulfilled') setReviews(r.value);
      if (n.status === 'fulfilled') setNotifications(n.value);
      if (nc.status === 'fulfilled') setNotices(nc.value);
    } catch (e) {
      console.warn('[appStore] 데이터 로드 실패:', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      // 계정이 바뀌었으면(토큰 갱신이 아닌 실제 유저 전환) 이전 유저 데이터를 즉시 비운다.
      if (prevUidRef.current !== user.id) {
        setStoreInfoState(null);
        setProducts([]);
        setOrders([]);
        setSettlements([]);
        setReviews([]);
        setNotifications([]);
        setNotices([]);
      }
      prevUidRef.current = user.id;
      setLoading(true);
      loadAll();
    } else {
      prevUidRef.current = null;
      setStoreInfoState(null);
      setProducts([]);
      setOrders([]);
      setSettlements([]);
      setReviews([]);
      setNotifications([]);
      setNotices([]);
      setLoading(false);
    }
  }, [user, loadAll]);

  // Realtime: 서버 변경(신규주문·정산·알림·리뷰 등)을 실시간 반영.
  // postgres_changes는 RLS를 따르므로 본인(seller_id=auth.uid()) 행 이벤트만 수신한다.
  useEffect(() => {
    if (!user) return undefined;
    const channel = supabase
      .channel('seller-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, reloadOrders)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, reloadNotifications)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, reloadProducts)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, reloadReviews)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, reloadSettlements)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, reloadStore)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, reloadOrders, reloadNotifications, reloadProducts, reloadReviews, reloadSettlements, reloadStore]);

  // ── 매장: 로컬 즉시 반영 + 허용 컬럼만 DB 영속(approval_status 등은 storeToDb에서 자동 제외) ──
  const setStoreInfo = (updater) => {
    const next = typeof updater === 'function' ? updater(storeInfo) : updater;
    setStoreInfoState(next);
    (async () => {
      try {
        let toPersist = next;
        // 로컬 매장 이미지면 Storage 업로드 후 URL로 교체
        if (next?.storeImage && !/^https?:\/\//.test(next.storeImage)) {
          const url = await uploadImageIfLocal(next.storeImage, null, 'store');
          toPersist = { ...next, storeImage: url };
          setStoreInfoState(toPersist);
        }
        await api.updateStoreRow(api.storeToDb(toPersist || {}));
      } catch (e) { console.warn('[store 저장]', e.message); }
    })();
  };

  const pauseSale = () => setStoreInfo(s => ({ ...s, isSellingPaused: true }));
  const resumeSale = () => setStoreInfo(s => ({ ...s, isSellingPaused: false }));

  // ── 상품 ──
  const updateProductStock = async (id, delta) => {
    const p = products.find(x => x.id === id);
    if (!p) return;
    const newStock = Math.max(0, p.stock + delta);
    try { await api.updateProductRow(id, { stock: newStock }); await reloadProducts(); }
    catch (e) { console.warn('[재고 변경]', e.message); }
  };

  const updateProductStatus = async (id, status) => {
    try { await api.updateProductRow(id, { status, pause_reason: null }); await reloadProducts(); }
    catch (e) { console.warn('[상태 변경]', e.message); }
  };

  // 소비기한 만료 자동중지·자동 시간차 인하는 서버 스케줄러(pg_cron: expire_products /
  // reduce_product_prices, 5분 주기)가 단독 처리한다. 클라이언트 중복 실행 금지(API_SPEC §9/§12).

  const addProduct = async (product) => {
    await api.insertProduct(storeInfo, product);
    await reloadProducts();
  };

  const updateProduct = async (id, data) => {
    await api.updateProductData(id, data);
    await reloadProducts();
  };

  const deleteProduct = async (id) => {
    try { await api.deleteProductRow(id); await reloadProducts(); }
    catch (e) { console.warn('[상품 삭제]', e.message); }
  };

  // ── 주문 (상태 전이 시각은 stamp 트리거가 자동 기록) ──
  // 픽업 완료는 complete_pickup RPC 단독 경로 — 상태/결제 검증과 동시 스캔 직렬화를 서버가 한다.
  // 실패를 삼키면 판매자가 완료된 줄 알고 상품을 내주게 되므로 반드시 throw 한다(호출부에서 Alert).
  const completePickup = async (orderCode) => {
    const order = await api.completePickupByQr(orderCode);
    await reloadOrders();
    return order;
  };
  // 스캔 직후 확인 시트용 조회(본인 매장 주문이 아니면 null).
  const lookupOrderForPickup = (orderCode) => api.lookupOrderForPickup(orderCode);
  // 주문 확인/취소도 실패를 삼키지 않는다 — 삼키면 버튼이 먹통인 것처럼 보여
  // 판매자가 원인을 알 수 없다(호출부에서 try/catch + Alert).
  const confirmOrder = async (orderCode) => {
    await api.updateOrderStatus(orderCode, 'confirmed');
    await reloadOrders();
  };
  const cancelOrder = async (orderCode, reason) => {
    const extra = reason && reason.trim() ? { cancel_reason: reason.trim() } : {};
    await api.updateOrderStatus(orderCode, 'cancelled', extra);
    await reloadOrders();
  };

  // ── 리뷰 ──
  const updateReviewReply = async (reviewId, reply) => {
    try { await api.updateReviewReplyRow(reviewId, reply); await reloadReviews(); }
    catch (e) { console.warn('[리뷰 답글]', e.message); }
  };

  // ── 알림 (낙관적 반영) ──
  const markNotificationRead = (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    api.markNotifRead(id).catch(e => console.warn('[알림 읽음]', e.message));
  };
  const markAllNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    api.markAllNotifRead().catch(e => console.warn('[알림 모두읽음]', e.message));
  };
  const deleteNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    api.deleteNotification(id).catch(e => { console.warn('[알림 삭제]', e.message); reloadNotifications(); });
  };

  const value = {
    loading,
    reload: loadAll,
    storeInfo, setStoreInfo,
    products, setProducts,
    orders, settlements,
    reviews,
    notices,
    pauseSale, resumeSale,
    updateProductStock, updateProductStatus,
    addProduct, updateProduct, deleteProduct,
    completePickup, lookupOrderForPickup, confirmOrder, cancelOrder,
    updateReviewReply,
    notifications, markNotificationRead, markAllNotificationsRead, deleteNotification,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
