import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './authStore';
import * as api from '../lib/api';
import { uploadImageIfLocal } from '../lib/storage';
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

// pickup_start/pickup_end → '오늘/어제/내일/M.D HH:MM~HH:MM' (주문 상세)
export function formatPickupWindow(start, end) {
  if (!start) return '';
  const s = new Date(start);
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sDay = new Date(s); sDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((sDay - today) / 86400000);
  const dayLabel = dayDiff === 0 ? '오늘' : dayDiff === -1 ? '어제' : dayDiff === 1 ? '내일' : `${s.getMonth() + 1}.${s.getDate()}`;
  return `${dayLabel} ${hm(s)}${end ? '~' + hm(new Date(end)) : ''}`;
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
      const [s, p, o, st, r, n, nc] = await Promise.all([
        api.fetchStore(),
        api.fetchProducts(),
        api.fetchOrders(),
        api.fetchSettlements(),
        api.fetchReviews(),
        api.fetchNotifications(),
        api.fetchNotices(),
      ]);
      setStoreInfoState(s);
      setProducts(p.map(withBadges));
      setOrders(o);
      setSettlements(st);
      setReviews(r);
      setNotifications(n);
      setNotices(nc);
    } catch (e) {
      console.warn('[appStore] 데이터 로드 실패:', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      setLoading(true);
      loadAll();
    } else {
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
    try { await api.insertProduct(storeInfo, product); await reloadProducts(); }
    catch (e) { console.warn('[상품 등록]', e.message); }
  };

  const updateProduct = async (id, data) => {
    try { await api.updateProductData(id, data); await reloadProducts(); }
    catch (e) { console.warn('[상품 수정]', e.message); }
  };

  const deleteProduct = async (id) => {
    try { await api.deleteProductRow(id); await reloadProducts(); }
    catch (e) { console.warn('[상품 삭제]', e.message); }
  };

  // ── 주문 (상태 전이 시각은 stamp 트리거가 자동 기록) ──
  const completePickup = async (orderId) => {
    try { await api.updateOrderStatus(orderId, 'completed'); await reloadOrders(); }
    catch (e) { console.warn('[픽업 완료]', e.message); }
  };
  const confirmOrder = async (orderId) => {
    try { await api.updateOrderStatus(orderId, 'confirmed'); await reloadOrders(); }
    catch (e) { console.warn('[주문 확인]', e.message); }
  };
  const cancelOrder = async (orderId, reason) => {
    const extra = reason && reason.trim() ? { cancel_reason: reason.trim() } : {};
    try { await api.updateOrderStatus(orderId, 'cancelled', extra); await reloadOrders(); }
    catch (e) { console.warn('[주문 취소]', e.message); }
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
    completePickup, confirmOrder, cancelOrder,
    updateReviewReply,
    notifications, markNotificationRead, markAllNotificationsRead, deleteNotification,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
