import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Linking,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  useApp,
  ORDER_SELLER_STATUS,
  formatPickupDeadline,
  formatDeadlineDuration,
  pickupErrorMessage,
} from '../store/appStore';
import { CheckCircle, Clock, Package, User, AlertTriangle, Phone, QrCode } from 'lucide-react-native';

function callSafeNumber(number) {
  if (!number) return;
  Alert.alert(
    '안심번호 전화 연결',
    `${number}로 전화를 연결합니다.\n실제 번호는 노출되지 않습니다.`,
    [
      { text: '취소', style: 'cancel' },
      { text: '전화하기', onPress: () => Linking.openURL(`tel:${number.replace(/-/g, '')}`) },
    ]
  );
}

const TABS = [
  { key: 'new',       label: '신규주문', color: '#FF8A3D' },
  { key: 'confirmed', label: '픽업대기', color: '#22A06B' },
  { key: 'completed', label: '픽업완료', color: '#9AA3AF' },
  { key: 'cancelled', label: '취소요청', color: '#E5484D' },
];

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const mo = d.getMonth() + 1;
  const da = d.getDate();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${mo}/${da} ${hh}:${mm}`;
}

function formatPrice(n) {
  return n.toLocaleString('ko-KR') + '원';
}

export default function OrdersScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { orders, confirmOrder, completePickup, cancelOrder } = useApp();

  const [activeTab, setActiveTab] = useState('new');
  const [pickupModal, setPickupModal] = useState(null);
  const [cancelModal, setCancelModal] = useState(null);

  function getCount(key) {
    return orders.filter(o => o.sellerStatus === key).length;
  }

  // 수동 픽업 완료(QR 훼손·카메라 불가 시 폴백). RPC 실패를 삼키지 않고 사유를 안내한다.
  async function handleCompletePickup(order) {
    setPickupModal(null);
    try {
      await completePickup(order.id);
      Alert.alert('픽업 완료', `${order.id} 주문의 픽업이 완료되었습니다.`);
    } catch (e) {
      Alert.alert('픽업 처리 불가', pickupErrorMessage(e));
    }
  }

  const filtered = orders.filter(o => o.sellerStatus === activeTab);

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F6F7' }}>
      {/* Header */}
      <View style={{ backgroundColor: '#fff', paddingTop: insets.top + 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: '#1F2933' }}>주문관리</Text>
          {/* QR 스캔 → 픽업 완료 */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('QrScan')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1F2933', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 }}
          >
            <QrCode color="#fff" size={16} />
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>QR 스캔</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {TABS.map(tab => {
              const count = getCount(tab.key);
              const active = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  activeOpacity={1}
                  onPress={() => setActiveTab(tab.key)}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingHorizontal: 12, paddingVertical: 10,
                    borderBottomWidth: active ? 2 : 0,
                    borderBottomColor: tab.color,
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: active ? tab.color : '#9AA3AF' }}>
                    {tab.label}
                  </Text>
                  {count > 0 && (
                    <View style={{
                      marginLeft: 6, width: 20, height: 20, borderRadius: 10,
                      backgroundColor: active ? tab.color : '#E5E7EB',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: active ? '#fff' : '#9AA3AF' }}>
                        {count}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 16 }} showsVerticalScrollIndicator={false}>
        {/* Cancelled banner */}
        {activeTab === 'cancelled' && getCount('cancelled') > 0 && (
          <View style={{ backgroundColor: '#FFF0F0', borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <AlertTriangle color="#E5484D" size={16} />
            <Text style={{ fontSize: 13, color: '#E5484D', fontWeight: '600' }}>
              취소 요청 접수됨 — 확인이 필요합니다
            </Text>
          </View>
        )}

        {/* 픽업대기 탭 — QR 스캔 진입 (현장에서 가장 많이 쓰는 동작) */}
        {activeTab === 'confirmed' && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate('QrScan')}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#22A06B', borderRadius: 12, paddingVertical: 14, marginBottom: 12 }}
          >
            <QrCode color="#fff" size={18} />
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>QR 스캔으로 픽업 완료</Text>
          </TouchableOpacity>
        )}

        {filtered.length === 0 ? (
          <View style={{ paddingVertical: 64, alignItems: 'center' }}>
            <View style={{ width: 64, height: 64, backgroundColor: '#F3F4F6', borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Package color="#9AA3AF" size={28} />
            </View>
            <Text style={{ color: '#9CA3AF', fontSize: 15 }}>주문이 없습니다</Text>
          </View>
        ) : (
          filtered.map(order => {
            const statusInfo = ORDER_SELLER_STATUS[order.sellerStatus];
            return (
              <TouchableOpacity
                key={order.id}
                activeOpacity={0.95}
                style={{ backgroundColor: '#fff', borderRadius: 14, marginBottom: 12, overflow: 'hidden', elevation: 1 }}
                onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
              >
                <View style={{ padding: 16 }}>
                  {/* Header: ID + date, status badge */}
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                    <View>
                      <Text style={{ fontSize: 12, color: '#9CA3AF' }}>{order.id}</Text>
                      <Text style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>{formatDateTime(order.orderedAt)}</Text>
                    </View>
                    <View style={{ backgroundColor: statusInfo?.bg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: statusInfo?.color }}>{statusInfo?.label}</Text>
                    </View>
                  </View>

                  {/* Product name */}
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2933', marginBottom: 4 }}>
                    {order.productName}
                  </Text>

                  {/* Qty | Price */}
                  <Text style={{ fontSize: 14, color: '#374151', marginBottom: 12 }}>
                    {order.quantity}개{'  |  '}{formatPrice(order.totalPrice)}
                  </Text>

                  {/* Buyer + Pickup(주문 후 N분 이내 → 마감시각) */}
                  <View style={{ marginBottom: 10, gap: 5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <User color="#9CA3AF" size={13} />
                      <Text style={{ fontSize: 13, color: '#6B7280' }}>{order.buyerName}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Clock color="#9CA3AF" size={13} />
                      <Text style={{ fontSize: 13, color: '#6B7280' }}>
                        픽업 마감 {formatPickupDeadline(order)}
                      </Text>
                      {!!order.pickupDeadlineMinutes && (
                        <Text style={{ fontSize: 12, color: '#9CA3AF' }}>
                          · 주문 후 {formatDeadlineDuration(order.pickupDeadlineMinutes)}
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* 안심번호 */}
                  {order.safeNumber && (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={(e) => { e.stopPropagation?.(); callSafeNumber(order.safeNumber); }}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F5F6F7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12 }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                        <Phone color="#9AA3AF" size={14} />
                        <Text style={{ fontSize: 13, color: '#6B7280' }}>안심번호</Text>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: '#1F2933', marginLeft: 4 }}>{order.safeNumber}</Text>
                      </View>
                      <View style={{ backgroundColor: '#22A06B', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 }}>
                        <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>전화</Text>
                      </View>
                    </TouchableOpacity>
                  )}

                  {/* Pickup number (confirmed only) */}
                  {order.sellerStatus === 'confirmed' && (
                    <View style={{ backgroundColor: '#E9F8F1', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <Text style={{ fontSize: 13, color: '#22A06B' }}>픽업번호</Text>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: '#1F2933', letterSpacing: 0.5 }}>
                        {order.id}
                      </Text>
                    </View>
                  )}

                  {/* Action buttons */}
                  {order.sellerStatus === 'new' && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        style={{ flex: 1, backgroundColor: '#22A06B', borderRadius: 10, alignItems: 'center', paddingVertical: 13 }}
                        onPress={(e) => { e.stopPropagation?.(); confirmOrder(order.id); }}
                      >
                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>주문 확인</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        style={{ flex: 1, backgroundColor: '#fff', borderRadius: 10, alignItems: 'center', paddingVertical: 13, borderWidth: 1, borderColor: '#E5E7EB' }}
                        onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
                      >
                        <Text style={{ color: '#6B7280', fontSize: 14 }}>주문 상세</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {order.sellerStatus === 'confirmed' && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        style={{ flex: 1, backgroundColor: '#1F2933', borderRadius: 10, alignItems: 'center', paddingVertical: 13 }}
                        onPress={(e) => { e.stopPropagation?.(); setPickupModal(order); }}
                      >
                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>픽업 완료 처리</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        style={{ flex: 1, backgroundColor: '#fff', borderRadius: 10, alignItems: 'center', paddingVertical: 13, borderWidth: 1, borderColor: '#E5E7EB' }}
                        onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
                      >
                        <Text style={{ color: '#6B7280', fontSize: 14 }}>주문 상세</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {order.sellerStatus === 'cancelled' && order.cancelReason && (
                    <View style={{ backgroundColor: '#FFF0F0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                      <AlertTriangle color="#E5484D" size={14} style={{ marginTop: 2 }} />
                      <Text style={{ fontSize: 13, color: '#E5484D', flex: 1, lineHeight: 19 }} numberOfLines={2}>
                        {order.cancelReason}
                      </Text>
                    </View>
                  )}
                  {order.sellerStatus === 'cancelled' && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        style={{ flex: 1, backgroundColor: '#E5484D', borderRadius: 10, alignItems: 'center', paddingVertical: 13 }}
                        onPress={(e) => { e.stopPropagation?.(); setCancelModal(order); }}
                      >
                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>취소 처리</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        style={{ flex: 1, backgroundColor: '#fff', borderRadius: 10, alignItems: 'center', paddingVertical: 13, borderWidth: 1, borderColor: '#E5E7EB' }}
                        onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
                      >
                        <Text style={{ color: '#6B7280', fontSize: 14 }}>주문 상세</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {order.sellerStatus === 'completed' && (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      style={{ backgroundColor: '#fff', borderRadius: 10, alignItems: 'center', paddingVertical: 13, borderWidth: 1, borderColor: '#E5E7EB' }}
                      onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
                    >
                      <Text style={{ color: '#6B7280', fontSize: 14 }}>주문 상세</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Pickup Complete Modal */}
      <Modal visible={!!pickupModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%' }}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ backgroundColor: '#E9F8F1', borderRadius: 50, padding: 12, marginBottom: 12 }}>
                <CheckCircle color="#22A06B" size={28} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2933', marginBottom: 8 }}>픽업 완료 확인</Text>
              <Text style={{ color: '#6B7280', fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
                {pickupModal?.productName} 주문의{'\n'}픽업이 완료되었나요?
              </Text>
              <Text style={{ color: '#9AA3AF', fontSize: 12, textAlign: 'center', marginTop: 8 }}>
                주문번호 {pickupModal?.id}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
                onPress={() => setPickupModal(null)}
              >
                <Text style={{ color: '#374151', fontWeight: '600', fontSize: 15 }}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#22A06B', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
                onPress={() => handleCompletePickup(pickupModal)}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>완료 확인</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Cancel Confirm Modal */}
      <Modal visible={!!cancelModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%' }}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ backgroundColor: '#FFF0F0', borderRadius: 50, padding: 12, marginBottom: 12 }}>
                <AlertTriangle color="#E5484D" size={28} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2933', marginBottom: 8 }}>취소 처리</Text>
              <Text style={{ color: '#6B7280', fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
                {cancelModal?.productName} 주문의{'\n'}취소를 승인하시겠습니까?
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
                onPress={() => setCancelModal(null)}
              >
                <Text style={{ color: '#374151', fontWeight: '600', fontSize: 15 }}>닫기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#E5484D', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
                onPress={() => { cancelOrder(cancelModal.id); setCancelModal(null); }}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>취소 승인</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
