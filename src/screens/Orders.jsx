import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Linking,
  Alert,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import {
  useApp,
  ORDER_SELLER_STATUS,
  CANCEL_REQUEST_STATUS,
  pickupErrorMessage,
  formatPickupDeadline,
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
  { key: 'new',             label: '신규주문', color: '#FF8A3D' },
  { key: 'confirmed',       label: '픽업대기', color: '#22A06B' },
  { key: 'completed',       label: '픽업완료', color: '#9AA3AF' },
  { key: 'cancelRequested', label: '취소요청', color: '#E5484D' },
  { key: 'cancelled',       label: '취소완료', color: '#9AA3AF' },
];

// 탭 필터 술어 — '취소요청' 은 seller_status 가 아니라 cancel_request_status 플래그다
// (마이그레이션 20260731000000: 요청 중에도 seller_status 는 new/confirmed 그대로).
// 요청 대기 건이 신규주문·픽업대기 탭에 중복 노출되지 않도록 그쪽에서 제외한다.
const TAB_FILTER = {
  new:             o => o.sellerStatus === 'new' && o.cancelRequestStatus !== 'requested',
  confirmed:       o => o.sellerStatus === 'confirmed' && o.cancelRequestStatus !== 'requested',
  completed:       o => o.sellerStatus === 'completed',
  cancelRequested: o => o.cancelRequestStatus === 'requested',
  cancelled:       o => o.sellerStatus === 'cancelled',
};

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const mo = d.getMonth() + 1;
  const da = d.getDate();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${mo}/${da} ${hh}:${mm}`;
}

// 픽업 표기 — 마감 시각(정본) 기준. formatPickupDeadline 이 pickupDeadlineAt 을 우선 쓰고
// 없는 구 주문만 ordered_at + 남은 분으로 복원한다(마이그레이션 20260730000000).
function formatPickupLabel(order) {
  const label = formatPickupDeadline(order);
  return label ? `픽업 마감 ${label}` : '';
}

function formatPrice(n) {
  return n.toLocaleString('ko-KR') + '원';
}

export default function OrdersScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { orders, confirmOrder, completePickup, approveCancelRequest, rejectCancelRequest } = useApp();

  const [activeTab, setActiveTab] = useState('new');
  const [pickupModal, setPickupModal] = useState(null);
  const [cancelModal, setCancelModal] = useState(null);   // 취소요청 승인 확인
  const [rejectModal, setRejectModal] = useState(null);   // 취소요청 거절(사유 입력)
  const [rejectReason, setRejectReason] = useState('');
  // QR 스캔 상태(qrScanVisible/qrScanned/cameraPermission)는 QrScan 화면으로 옮겨 제거했다.

  // 홈의 '취소요청 N건' 카드에서 넘어오면 해당 탭을 연다.
  // 탭 화면의 params 는 한 번 들어오면 남아 있어(다음에 탭바로 들어와도 탭이 강제로 바뀐다)
  // 적용 직후 비운다.
  useFocusEffect(
    useCallback(() => {
      const next = route.params?.initialTab;
      if (next && TAB_FILTER[next]) {
        setActiveTab(next);
        navigation.setParams({ initialTab: undefined });
      }
    }, [route.params?.initialTab, navigation])
  );

  // 픽업대기 탭의 QR 스캔은 전용 화면(QrScan)으로 보낸다.
  //
  // 이전에는 이 화면 안에 인라인 QR 모달이 따로 있었고, 홈·주문상세는 QrScan 화면을 쓰는
  // 이중 구현 상태였다. 같은 'QR 찍어 픽업완료' 인데 경로마다 동작이 달랐고,
  // 인라인 쪽은 아래 세 가지가 빠져 있었다.
  //   · 로컬 orders 배열에서 sellerStatus==='confirmed' 인 건만 찾아 매칭 →
  //     아직 '주문 확인'을 누르지 않은 new 상태 주문의 QR 은 서버 RPC(lookup_order_for_pickup)가
  //     허용하는데도 '주문 없음' 으로 거부됐다. 판매자 입장에서는 멀쩡한 QR 이 안 먹는 것으로 보인다.
  //   · 주문번호 파싱 없이 raw 문자열을 그대로 비교 → QR 형식이 조금만 달라도 실패.
  //   · 확인 시트(수량·픽업 마감·금액)·사유별 안내·주문번호 직접입력 폴백 없음.
  // 진입점을 하나로 모아 어느 경로로 들어와도 같은 검증을 타게 한다.
  function openQrScanner() {
    navigation.navigate('QrScan');
  }

  function getCount(key) {
    const predicate = TAB_FILTER[key];
    return predicate ? orders.filter(predicate).length : 0;
  }

  // ── 상태 전이 공통 핸들러 ────────────────────────────────────────────────
  // appStore 의 confirmOrder/cancelOrder/completePickup 은 실패를 삼키지 않고 throw 한다
  // (0행 갱신·RLS·이미 처리된 주문 등). 감싸지 않으면 unhandled rejection 이 되어
  // 버튼이 '먹통' 으로 보이므로 반드시 사유를 노출한다.
  async function runOrderAction(fn, failTitle) {
    try {
      await fn();
    } catch (e) {
      Alert.alert(failTitle, pickupErrorMessage(e));
    }
  }

  const filtered = orders.filter(TAB_FILTER[activeTab] || (() => false));

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F6F7' }}>
      {/* Header */}
      <View style={{ backgroundColor: '#fff', paddingTop: insets.top + 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#1F2933', marginBottom: 12 }}>주문관리</Text>
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
        {/* QR 스캔 배너 (픽업대기 탭) */}
        {activeTab === 'confirmed' && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={openQrScanner}
            style={{ backgroundColor: '#22A06B', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 14 }}
          >
            <QrCode color="#fff" size={22} />
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>고객 QR 스캔하여 픽업 완료</Text>
          </TouchableOpacity>
        )}

        {/* 취소요청 대기 배너 */}
        {activeTab === 'cancelRequested' && getCount('cancelRequested') > 0 && (
          <View style={{ backgroundColor: '#FFF0F0', borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <AlertTriangle color="#E5484D" size={16} />
            <Text style={{ fontSize: 13, color: '#E5484D', fontWeight: '600', flex: 1, lineHeight: 19 }}>
              취소 요청 · 승인 시 수수료 없이 전액 환불됩니다
            </Text>
          </View>
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
            // 취소요청 대기 건은 seller_status(신규주문/픽업대기) 대신 요청 상태를 배지로 보여준다.
            const cancelRequested = order.cancelRequestStatus === 'requested';
            const statusInfo = cancelRequested
              ? CANCEL_REQUEST_STATUS.requested
              : ORDER_SELLER_STATUS[order.sellerStatus];
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

                  {/* Buyer + Pickup */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <User color="#9CA3AF" size={13} />
                      <Text style={{ fontSize: 13, color: '#6B7280' }}>{order.buyerName}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Clock color="#9CA3AF" size={13} />
                      <Text style={{ fontSize: 13, color: '#6B7280' }}>
                        {formatPickupLabel(order)}
                      </Text>
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

                  {/* 취소요청 상세 — 요청 시각 + 구매자가 입력한 사유 */}
                  {cancelRequested && (
                    <View style={{ backgroundColor: '#FFF0F0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12 }}>
                      <Text style={{ fontSize: 12, color: '#E5484D', fontWeight: '700' }}>
                        {formatDateTime(order.cancelRequestedAt)} 취소 요청
                      </Text>
                      <Text style={{ fontSize: 13, color: '#374151', marginTop: 4, lineHeight: 19 }}>
                        {order.cancelRequestReason || '사유가 입력되지 않았습니다.'}
                      </Text>
                    </View>
                  )}

                  {/* Pickup number (confirmed only) */}
                  {order.sellerStatus === 'confirmed' && !cancelRequested && (
                    <View style={{ backgroundColor: '#E9F8F1', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <Text style={{ fontSize: 13, color: '#22A06B' }}>픽업번호</Text>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: '#1F2933', letterSpacing: 0.5 }}>
                        {order.id}
                      </Text>
                    </View>
                  )}

                  {/* Action buttons */}
                  {cancelRequested && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        style={{ flex: 1, backgroundColor: '#E5484D', borderRadius: 10, alignItems: 'center', paddingVertical: 13 }}
                        onPress={(e) => { e.stopPropagation?.(); setCancelModal(order); }}
                      >
                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>취소 승인</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        style={{ flex: 1, backgroundColor: '#fff', borderRadius: 10, alignItems: 'center', paddingVertical: 13, borderWidth: 1, borderColor: '#E5E7EB' }}
                        onPress={(e) => { e.stopPropagation?.(); setRejectReason(''); setRejectModal(order); }}
                      >
                        <Text style={{ color: '#6B7280', fontSize: 14 }}>요청 거절</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {order.sellerStatus === 'new' && !cancelRequested && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        style={{ flex: 1, backgroundColor: '#22A06B', borderRadius: 10, alignItems: 'center', paddingVertical: 13 }}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          runOrderAction(() => confirmOrder(order.id), '주문 확인 불가');
                        }}
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
                  {order.sellerStatus === 'confirmed' && !cancelRequested && (
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
                  {/* 취소완료 — 이미 확정된 주문이라 별도 처리 버튼이 없다(과거의 '취소 처리' 는 no-op 이었다) */}
                  {order.sellerStatus === 'cancelled' && (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      style={{ backgroundColor: '#fff', borderRadius: 10, alignItems: 'center', paddingVertical: 13, borderWidth: 1, borderColor: '#E5E7EB' }}
                      onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
                    >
                      <Text style={{ color: '#6B7280', fontSize: 14 }}>주문 상세</Text>
                    </TouchableOpacity>
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
                onPress={() => {
                  const target = pickupModal;
                  setPickupModal(null);
                  runOrderAction(() => completePickup(target.id), '픽업 처리 불가');
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>완료 확인</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* QR 스캔 모달은 제거했다 — QrScan 전용 화면으로 일원화(openQrScanner 주석 참조). */}

      {/* 취소요청 승인 확인 모달 — 승인 시 PG 전액취소가 먼저 실행된다(appStore/api) */}
      <Modal visible={!!cancelModal} transparent animationType="fade" onRequestClose={() => setCancelModal(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%' }}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ backgroundColor: '#FFF0F0', borderRadius: 50, padding: 12, marginBottom: 12 }}>
                <AlertTriangle color="#E5484D" size={28} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2933', marginBottom: 8 }}>취소 요청 승인</Text>
              <Text style={{ color: '#6B7280', fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
                {cancelModal?.productName} 주문의{'\n'}취소 요청을 승인하시겠습니까?
              </Text>
              <View style={{ backgroundColor: '#FFF0F0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, marginTop: 12, width: '100%' }}>
                <Text style={{ fontSize: 13, color: '#E5484D', textAlign: 'center', lineHeight: 19 }}>
                  결제금액 전액이 환불되며{'\n'}수수료는 부과되지 않습니다.
                </Text>
              </View>
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
                onPress={() => {
                  const target = cancelModal;
                  setCancelModal(null);
                  runOrderAction(() => approveCancelRequest(target.id), '취소 승인 불가');
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>취소 승인</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 취소요청 거절 모달 — PG 는 건드리지 않고 사유만 구매자에게 전달한다 */}
      <Modal visible={!!rejectModal} transparent animationType="fade" onRequestClose={() => setRejectModal(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 24, width: '100%' }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2933', textAlign: 'center', marginBottom: 6 }}>취소 요청 거절</Text>
            <Text style={{ color: '#6B7280', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 14 }}>
              거절 사유를 입력해주세요.{'\n'}구매자에게 그대로 전달되며 주문은 유지됩니다.
            </Text>
            <TextInput
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="예: 이미 상품 준비가 끝났습니다."
              placeholderTextColor="#9AA3AF"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              style={{ backgroundColor: '#F5F6F7', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#1F2933', minHeight: 76, marginBottom: 18 }}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
                onPress={() => setRejectModal(null)}
              >
                <Text style={{ color: '#374151', fontWeight: '600', fontSize: 15 }}>닫기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: rejectReason.trim() ? '#1F2933' : '#C9CDD2', borderRadius: 12, paddingVertical: 13, alignItems: 'center' }}
                disabled={!rejectReason.trim()}
                onPress={() => {
                  const target = rejectModal;
                  const reason = rejectReason;
                  setRejectModal(null);
                  runOrderAction(() => rejectCancelRequest(target.id, reason), '요청 거절 불가');
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>요청 거절</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
