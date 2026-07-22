import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useApp, ORDER_SELLER_STATUS, formatRelativeTime } from '../store/appStore';
import { Plus, ClipboardList, AlertTriangle, Bell, X } from 'lucide-react-native';

function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatPrice(n) {
  return n.toLocaleString('ko-KR') + '원';
}

const NOTIF_TYPE_COLOR = {
  reject:     { color: '#E5484D', bg: '#FFF0F0' },
  cancel:     { color: '#FF8A3D', bg: '#FFF4ED' },
  settlement: { color: '#22A06B', bg: '#E9F8F1' },
};

export default function HomeScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { storeInfo, products, orders, pauseSale, resumeSale, confirmOrder, completePickup, notifications, markNotificationRead, markAllNotificationsRead, deleteNotification, notices } = useApp();
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [bannerIdx, setBannerIdx] = useState(0);

  const sellingCount = products.filter(p => p.status === 'selling').length;
  const newOrderCount = orders.filter(o => o.sellerStatus === 'new').length;
  const pickupWaitCount = orders.filter(o => o.sellerStatus === 'confirmed').length;
  const completedCount = orders.filter(o => o.sellerStatus === 'completed').length;
  const unreadCount = notifications.filter(n => !n.read).length;

  const recentOrders = orders
    .filter(o => o.sellerStatus === 'new' || o.sellerStatus === 'confirmed')
    .slice(0, 5);

  // 롤링 배너 - 화면 포커스 기준으로 관리
  useFocusEffect(
    useCallback(() => {
      if (notices.length === 0) return undefined;
      const interval = setInterval(() => {
        setBannerIdx(i => (i + 1) % notices.length);
      }, 4000);
      return () => clearInterval(interval);
    }, [notices.length])
  );

  function handleToggle() {
    if (storeInfo.isSellingPaused) {
      resumeSale();
    } else {
      setShowPauseModal(true);
    }
  }

  function handleConfirmPause() {
    pauseSale();
    setShowPauseModal(false);
  }

  const headerBg = storeInfo.isSellingPaused ? '#6B7280' : '#22A06B';

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F6F7' }}>
      {/* Header */}
      <View style={{ backgroundColor: headerBg, paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: 20 }}>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, marginBottom: 6 }}>
          푸드피커 판매 점포
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 21, fontWeight: '700', marginBottom: 6 }}>
              {storeInfo.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{
                width: 8, height: 8, borderRadius: 4, marginRight: 6,
                backgroundColor: storeInfo.isSellingPaused ? '#FCA5A5' : '#fff',
              }} />
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
                {storeInfo.isSellingPaused ? '판매 일시중지 중' : '판매중'}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 }}>
            {/* 알림 벨 */}
            <TouchableOpacity
              onPress={() => setShowNotifModal(true)}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Bell color="#fff" size={18} />
              {unreadCount > 0 && (
                <View style={{ position: 'absolute', top: -2, right: -2, backgroundColor: '#E5484D', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={1}
              onPress={handleToggle}
              style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 }}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
                {storeInfo.isSellingPaused ? '판매 재개' : '오늘 판매 일시중지'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* 롤링 배너 */}
        {notices.length > 0 && (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate('NoticeDetail', { noticeId: notices[bannerIdx % notices.length].id })}
          style={{ backgroundColor: '#1F2933', paddingHorizontal: 16, paddingVertical: 10 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text numberOfLines={1} style={{ flex: 1, color: '#E5E7EB', fontSize: 13 }}>
              {notices[bannerIdx % notices.length].emoji} {notices[bannerIdx % notices.length].title}
            </Text>
            <Text style={{ color: '#6B7280', fontSize: 11, marginLeft: 8 }}>
              {(bannerIdx % notices.length) + 1}/{notices.length}
            </Text>
          </View>
        </TouchableOpacity>
        )}

        {/* Stats Card */}
        <View style={{ marginHorizontal: 16, marginTop: 16, marginBottom: 12, backgroundColor: '#fff', borderRadius: 16, padding: 16, elevation: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#1F2933', marginBottom: 12 }}>오늘 판매 현황</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            <View style={{ flex: 1, backgroundColor: '#F5F6F7', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 }}>
              <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>판매중 상품</Text>
              <Text style={{ fontSize: 24, fontWeight: '700', color: '#1F2933' }}>
                {sellingCount}<Text style={{ fontSize: 16 }}>개</Text>
              </Text>
            </View>
            <View style={{ flex: 1, backgroundColor: '#F5F6F7', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 }}>
              <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>예약 건수</Text>
              <Text style={{ fontSize: 24, fontWeight: '700', color: '#FF8A3D' }}>
                {newOrderCount}<Text style={{ fontSize: 16 }}>건</Text>
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <View style={{ flex: 1, backgroundColor: '#F5F6F7', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 }}>
              <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>픽업대기</Text>
              <Text style={{ fontSize: 24, fontWeight: '700', color: '#1F2933' }}>
                {pickupWaitCount}<Text style={{ fontSize: 16 }}>건</Text>
              </Text>
            </View>
            <View style={{ flex: 1, backgroundColor: '#F5F6F7', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12 }}>
              <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>판매완료</Text>
              <Text style={{ fontSize: 24, fontWeight: '700', color: '#1F2933' }}>
                {completedCount}<Text style={{ fontSize: 16 }}>건</Text>
              </Text>
            </View>
          </View>

        </View>

        {/* Quick Action Buttons */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, gap: 12, marginBottom: 16 }}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: '#22A06B', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 15 }}
            onPress={() => navigation.navigate('ProductForm')}
          >
            <Plus color="#fff" size={20} />
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>상품 빠른 등록</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: '#1F2933', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 15, elevation: 1 }}
            onPress={() => navigation.navigate('Orders')}
          >
            {newOrderCount > 0 && (
              <View style={{
                position: 'absolute', top: -6, right: -4,
                backgroundColor: '#E5484D', borderRadius: 10, minWidth: 20, height: 20,
                alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
                zIndex: 1,
              }}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{newOrderCount}</Text>
              </View>
            )}
            <ClipboardList color="#fff" size={20} />
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>주문 확인하기</Text>
          </TouchableOpacity>
        </View>

        {/* Recent Orders */}
        <View style={{ marginHorizontal: 16, marginBottom: 24, backgroundColor: '#fff', borderRadius: 16, elevation: 1, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
            <Text style={{ fontWeight: '700', color: '#1F2933', fontSize: 16 }}>최근 주문</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Orders')}>
              <Text style={{ color: '#22A06B', fontSize: 14 }}>전체보기</Text>
            </TouchableOpacity>
          </View>

          {recentOrders.length === 0 ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <Text style={{ color: '#9CA3AF', fontSize: 14 }}>처리할 주문이 없습니다</Text>
            </View>
          ) : (
            recentOrders.map((order, idx) => {
              const statusInfo = ORDER_SELLER_STATUS[order.sellerStatus];
              return (
                <View
                  key={order.id}
                  style={{
                    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
                    borderBottomWidth: idx < recentOrders.length - 1 ? 1 : 0,
                    borderBottomColor: '#F3F4F6',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 2 }}>{order.id}</Text>
                      <Text style={{ fontWeight: '600', color: '#1F2933', fontSize: 16, marginBottom: 3 }}>{order.productName}</Text>
                      <Text style={{ color: '#6B7280', fontSize: 13 }}>
                        {order.quantity}개 · 픽업 {formatTime(order.pickupStart)}~{formatTime(order.pickupEnd)}
                      </Text>
                      <Text style={{ color: '#9CA3AF', fontSize: 12, marginTop: 1 }}>{order.buyerName}</Text>
                    </View>
                    <View style={{ backgroundColor: statusInfo?.bg || '#F5F6F7', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: statusInfo?.color || '#9AA3AF' }}>
                        {statusInfo?.label}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      style={{ flex: 1, backgroundColor: '#1F2933', borderRadius: 10, alignItems: 'center', paddingVertical: 11 }}
                      onPress={() => order.sellerStatus === 'new' ? confirmOrder(order.id) : completePickup(order.id)}
                    >
                      <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
                        {order.sellerStatus === 'new' ? '주문 확인' : '픽업 확인'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flex: 1, backgroundColor: '#fff', borderRadius: 10, alignItems: 'center', paddingVertical: 11, borderWidth: 1, borderColor: '#E5E7EB' }}
                      onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
                    >
                      <Text style={{ color: '#6B7280', fontSize: 14 }}>주문 상세</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* Pause Modal */}
      <Modal visible={showPauseModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%' }}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ backgroundColor: 'rgba(255,138,61,0.1)', borderRadius: 50, padding: 12, marginBottom: 12 }}>
                <AlertTriangle color="#FF8A3D" size={28} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2933', marginBottom: 8 }}>판매 일시중지</Text>
              <Text style={{ color: '#6B7280', fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
                판매를 일시중지하면 구매자가 상품을{'\n'}주문할 수 없게 됩니다.{'\n'}계속하시겠습니까?
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
                onPress={() => setShowPauseModal(false)}
              >
                <Text style={{ color: '#374151', fontWeight: '600', fontSize: 15 }}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#FF8A3D', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
                onPress={handleConfirmPause}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>일시중지</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 알림 Modal */}
      <Modal visible={showNotifModal} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: insets.bottom + 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#1F2933' }}>알림</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                {unreadCount > 0 && (
                  <TouchableOpacity onPress={markAllNotificationsRead}>
                    <Text style={{ fontSize: 13, color: '#22A06B', fontWeight: '600' }}>모두 읽음</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setShowNotifModal(false)}>
                  <X color="#9AA3AF" size={22} />
                </TouchableOpacity>
              </View>
            </View>
            {notifications.length === 0 ? (
              <View style={{ paddingVertical: 48, alignItems: 'center' }}>
                <Text style={{ color: '#9CA3AF', fontSize: 14 }}>새 알림이 없습니다</Text>
              </View>
            ) : (
              notifications.map((notif, idx) => {
                const typeStyle = NOTIF_TYPE_COLOR[notif.type] || { color: '#9AA3AF', bg: '#F5F6F7' };
                return (
                  <TouchableOpacity
                    key={notif.id}
                    activeOpacity={0.85}
                    onPress={() => markNotificationRead(notif.id)}
                    style={{
                      flexDirection: 'row', alignItems: 'flex-start', gap: 12,
                      paddingHorizontal: 16, paddingVertical: 14,
                      borderBottomWidth: idx < notifications.length - 1 ? 1 : 0,
                      borderBottomColor: '#F3F4F6',
                      backgroundColor: notif.read ? '#fff' : '#FAFFFE',
                    }}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: typeStyle.bg, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                      <Bell color={typeStyle.color} size={16} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: typeStyle.color }}>{notif.title}</Text>
                        <Text style={{ fontSize: 11, color: '#9CA3AF' }}>{formatRelativeTime(notif.createdAt)}</Text>
                      </View>
                      <Text style={{ fontSize: 13, color: '#374151', lineHeight: 19 }}>{notif.message}</Text>
                    </View>
                    <View style={{ alignItems: 'center', gap: 8, marginTop: 2 }}>
                      {!notif.read && (
                        <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#E5484D' }} />
                      )}
                      <TouchableOpacity
                        onPress={() => deleteNotification(notif.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{ padding: 2 }}
                      >
                        <X color="#C4C9D0" size={16} />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
