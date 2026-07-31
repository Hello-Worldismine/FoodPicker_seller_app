import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Image,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  useApp,
  ORDER_SELLER_STATUS,
  CANCEL_REQUEST_STATUS,
  PAYMENT_STATUS,
  formatPickupDeadline,
  formatDeadlineDuration,
  pickupErrorMessage,
} from '../store/appStore';
import {
  ChevronLeft,
  Package,
  User,
  Clock,
  CreditCard,
  Hash,
  XCircle,
  CheckCircle,
  MessageSquare,
  QrCode,
  AlertTriangle,
} from 'lucide-react-native';

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const da = d.getDate().toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${yyyy}.${mo}.${da} ${hh}:${mm}`;
}

function formatPrice(n) {
  return n.toLocaleString('ko-KR') + '원';
}

export default function OrderDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const {
    orders, products, confirmOrder, completePickup, cancelOrder,
    approveCancelRequest, rejectCancelRequest,
  } = useApp();
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { orderId } = route.params || {};
  const order = orders.find(o => o.id === orderId);
  const product = order ? products.find(p => p.id === order.productId) : null;

  if (!order) {
    return (
      <View className="flex-1 bg-softgray items-center justify-center">
        <Text className="text-gray-400">주문을 찾을 수 없습니다</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} className="mt-4">
          <Text className="text-primary">돌아가기</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 취소요청 대기 건은 seller_status(신규주문/픽업대기) 대신 요청 상태를 배지로 보여준다.
  const cancelRequested = order.cancelRequestStatus === 'requested';
  const statusInfo = cancelRequested
    ? CANCEL_REQUEST_STATUS.requested
    : ORDER_SELLER_STATUS[order.sellerStatus];
  // 환불 표시 기준액 — 승인 RPC 가 기록한 refund_amount 가 정본이고,
  // 판매자 자발 취소 등 기록이 없는 건은 결제금액(전액 환불)으로 본다.
  const refundAmount = order.refundAmount > 0 ? order.refundAmount : order.amount;

  // 주문 확인 / 취소도 실패 사유를 반드시 노출한다(무반응처럼 보이는 것 방지).
  async function handleConfirmOrder() {
    try {
      await confirmOrder(order.id);
    } catch (e) {
      Alert.alert('주문 확인 불가', pickupErrorMessage(e));
    }
  }

  // 판매자 자발 취소 — PG 전액취소(api.cancelOrderWithRefund) 후 상태를 바꾼다.
  async function handleCancelOrder() {
    setShowCancelModal(false);
    try {
      await cancelOrder(order.id, cancelReason);
      navigation.goBack();
    } catch (e) {
      Alert.alert('주문 취소 불가', pickupErrorMessage(e));
    }
  }

  // ── 구매자 취소요청 응답 ───────────────────────────────────────────────────
  // 승인은 PG 전액취소가 먼저 실행되므로 되돌릴 수 없다 → 한 번 더 확인받는다.
  function confirmApproveCancel() {
    Alert.alert(
      '취소 요청 승인',
      `${order.productName} 주문의 취소 요청을 승인합니다.\n\n결제금액 ${formatPrice(order.amount)} 전액이 환불되며\n수수료는 부과되지 않습니다.`,
      [
        { text: '닫기', style: 'cancel' },
        { text: '취소 승인', style: 'destructive', onPress: handleApproveCancel },
      ]
    );
  }

  async function handleApproveCancel() {
    try {
      await approveCancelRequest(order.id);
      Alert.alert('취소 승인', '결제금액 전액이 환불되었습니다. 수수료는 부과되지 않습니다.', [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('취소 승인 불가', pickupErrorMessage(e));
    }
  }

  async function handleRejectCancel() {
    setShowRejectModal(false);
    try {
      await rejectCancelRequest(order.id, rejectReason);
      Alert.alert('요청 거절', '취소 요청을 거절했습니다. 구매자에게 사유가 전달됩니다.');
    } catch (e) {
      Alert.alert('요청 거절 불가', pickupErrorMessage(e));
    }
  }

  // 수동 픽업 완료(폴백). complete_pickup RPC 실패 사유를 그대로 안내한다.
  async function handleCompletePickup() {
    try {
      await completePickup(order.id);
      Alert.alert('픽업 완료', `${order.id} 주문의 픽업이 완료되었습니다.`, [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('픽업 처리 불가', pickupErrorMessage(e));
    }
  }

  return (
    <View className="flex-1 bg-softgray">
      {/* Header */}
      <View
        className="bg-white px-4 pb-3 border-b border-gray-100 flex-row items-center"
        style={{ paddingTop: insets.top + 12 }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3 p-1">
          <ChevronLeft color="#1F2933" size={24} />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-charcoal">주문 상세</Text>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Status Card */}
        <View className="mx-4 mt-4 bg-white rounded-xl p-4 shadow-sm" style={{ elevation: 1 }}>
          <View className="flex-row items-center justify-between mb-3">
            <Text className="font-semibold text-gray-500 text-sm">주문번호</Text>
            <Text className="font-bold text-charcoal font-mono">{order.id}</Text>
          </View>
          <View className="flex-row items-center justify-between mb-3">
            <Text className="font-semibold text-gray-500 text-sm">주문시각</Text>
            <Text className="text-charcoal text-sm">{formatDateTime(order.orderedAt)}</Text>
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-gray-500 text-sm">주문상태</Text>
            <View
              className="rounded-full px-3 py-1"
              style={{ backgroundColor: statusInfo?.bg }}
            >
              <Text className="font-semibold text-sm" style={{ color: statusInfo?.color }}>
                {statusInfo?.label}
              </Text>
            </View>
          </View>
        </View>

        {/* 취소요청 대기 배너 — 승인 시 수수료 없이 전액 환불된다 */}
        {cancelRequested && (
          <View className="mx-4 mt-3 bg-red-50 border border-red-100 rounded-xl p-4 flex-row items-start gap-3">
            <AlertTriangle color="#E5484D" size={20} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text className="text-alertred text-sm font-semibold">구매자가 취소를 요청했습니다</Text>
              {order.cancelRequestedAt && (
                <Text style={{ fontSize: 11, color: '#E5484D', marginTop: 2, opacity: 0.75 }}>
                  {formatDateTime(order.cancelRequestedAt)} 요청
                </Text>
              )}
              <Text style={{ fontSize: 13, color: '#374151', marginTop: 6, lineHeight: 19 }}>
                {order.cancelRequestReason || '사유가 입력되지 않았습니다.'}
              </Text>
              <Text style={{ fontSize: 12, color: '#E5484D', marginTop: 6, fontWeight: '600' }}>
                승인 시 수수료 없이 결제금액 전액이 환불됩니다.
              </Text>
            </View>
          </View>
        )}

        {/* 취소요청 거절 안내 — 주문은 그대로 유지된다 */}
        {order.cancelRequestStatus === 'rejected' && order.sellerStatus !== 'cancelled' && (
          <View className="mx-4 mt-3 bg-orange-50 border border-orange-100 rounded-xl p-4 flex-row items-start gap-3">
            <MessageSquare color="#FF8A3D" size={20} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#FF8A3D' }}>취소 요청을 거절했습니다</Text>
              {order.cancelRespondedAt && (
                <Text style={{ fontSize: 11, color: '#FF8A3D', marginTop: 2, opacity: 0.8 }}>
                  {formatDateTime(order.cancelRespondedAt)} 처리
                </Text>
              )}
              {!!order.cancelResponseReason && (
                <Text style={{ fontSize: 13, color: '#374151', marginTop: 6, lineHeight: 19 }}>
                  {order.cancelResponseReason}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Cancel Banner */}
        {order.sellerStatus === 'cancelled' && (
          <View className="mx-4 mt-3 bg-red-50 border border-red-100 rounded-xl p-4 flex-row items-center gap-3">
            <XCircle color="#E5484D" size={20} />
            <View style={{ flex: 1 }}>
              <Text className="text-alertred text-sm font-semibold">취소된 주문입니다</Text>
              {order.cancelledAt && (
                <Text style={{ fontSize: 11, color: '#E5484D', marginTop: 2, opacity: 0.75 }}>
                  {formatDateTime(order.cancelledAt)} 취소 처리
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Product Info */}
        <View className="mx-4 mt-3 bg-white rounded-xl p-4 shadow-sm" style={{ elevation: 1 }}>
          <View className="flex-row items-center gap-2 mb-3">
            <Package color="#22A06B" size={16} />
            <Text className="font-bold text-charcoal text-[15px]">상품 정보</Text>
          </View>
          <View className="flex-row items-center gap-3">
            <View className="w-14 h-14 bg-softgray rounded-xl items-center justify-center overflow-hidden">
              {order.productThumbnail ? (
                <Image source={{ uri: order.productThumbnail }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <Text className="text-3xl">{order.productEmoji || product?.emoji || '🛍️'}</Text>
              )}
            </View>
            <View className="flex-1">
              <Text className="font-bold text-charcoal text-[15px]">{order.productName}</Text>
              <Text className="text-gray-500 text-sm mt-1">{order.quantity}개</Text>
            </View>
            <Text className="font-bold text-charcoal text-[15px]">{formatPrice(order.totalPrice)}</Text>
          </View>
        </View>

        {/* Pickup Number (when confirmed) — 취소요청 대기 중에는 픽업을 유도하지 않는다 */}
        {order.sellerStatus === 'confirmed' && !cancelRequested && (
          <View className="mx-4 mt-3 bg-mint rounded-xl p-4 items-center shadow-sm" style={{ elevation: 1 }}>
            <View className="flex-row items-center gap-2 mb-2">
              <Hash color="#22A06B" size={16} />
              <Text className="font-bold text-primary text-[15px]">픽업번호</Text>
            </View>
            {/* 구매자 QR 값과 동일한 전체 주문번호 — 육안 대조가 되도록 잘라내지 않는다 */}
            <Text className="text-4xl font-bold text-primary tracking-wider">{order.id}</Text>
            <Text className="text-primary/70 text-xs mt-2">구매자 QR 의 주문번호와 같은지 확인하세요</Text>
          </View>
        )}

        {/* Buyer Info */}
        <View className="mx-4 mt-3 bg-white rounded-xl p-4 shadow-sm" style={{ elevation: 1 }}>
          <View className="flex-row items-center gap-2 mb-3">
            <User color="#22A06B" size={16} />
            <Text className="font-bold text-charcoal text-[15px]">구매자 정보</Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-gray-500 text-sm">구매자</Text>
            <Text className="text-charcoal text-sm font-semibold">{order.buyerName}</Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-gray-500 text-sm">픽업 마감</Text>
            <Text className="text-charcoal text-sm font-semibold">{formatPickupDeadline(order)}</Text>
          </View>
          {!!order.pickupDeadlineMinutes && (
            <View className="flex-row justify-between mb-2">
              <Text className="text-gray-500 text-sm">픽업 조건</Text>
              <Text className="text-charcoal text-sm font-semibold">
                주문 후 {formatDeadlineDuration(order.pickupDeadlineMinutes)}
              </Text>
            </View>
          )}
          <View className="flex-row justify-between">
            <Text className="text-gray-500 text-sm">결제 상태</Text>
            <Text className="text-primary text-sm font-semibold">{PAYMENT_STATUS[order.paymentStatus]?.label || order.paymentStatus}</Text>
          </View>
        </View>

        {/* 정산 정보 / 환불 정보
            취소된 주문은 정산 대상이 아니다(generate_weekly_settlements 는 completed 만 집계).
            수수료도 0 이 되므로 '정산 예정액 = 결제금액' 으로 오독되지 않게 패널을 통째로 바꾼다. */}
        {order.sellerStatus === 'cancelled' ? (
          <View className="mx-4 mt-3 bg-white rounded-xl p-4 shadow-sm" style={{ elevation: 1 }}>
            <View className="flex-row items-center gap-2 mb-3">
              <CreditCard color="#E5484D" size={16} />
              <Text className="font-bold text-charcoal text-[15px]">환불 정보</Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-gray-500 text-sm">결제 금액</Text>
              <Text className="text-charcoal text-sm">{formatPrice(order.amount)}</Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-gray-500 text-sm">환불 금액</Text>
              <Text className="text-alertred text-sm font-semibold">{formatPrice(refundAmount)}</Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-gray-500 text-sm">수수료</Text>
              <Text className="text-charcoal text-sm">0원</Text>
            </View>
            <View className="h-px bg-gray-100 my-2" />
            <View className="flex-row justify-between">
              <Text className="text-gray-700 text-sm font-bold">정산 예정액</Text>
              <Text className="text-gray-500 text-sm font-bold">0원</Text>
            </View>
            <Text style={{ fontSize: 12, color: '#9AA3AF', marginTop: 8, lineHeight: 18 }}>
              수수료 면제 100% 환불 — 취소된 주문에는 플랫폼 수수료가 부과되지 않습니다.
            </Text>
          </View>
        ) : (
          <View className="mx-4 mt-3 bg-white rounded-xl p-4 shadow-sm" style={{ elevation: 1 }}>
            <View className="flex-row items-center gap-2 mb-3">
              <CreditCard color="#22A06B" size={16} />
              <Text className="font-bold text-charcoal text-[15px]">정산 정보</Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-gray-500 text-sm">결제 금액</Text>
              <Text className="text-charcoal text-sm">{formatPrice(order.amount)}</Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-gray-500 text-sm">수수료 ({order.amount > 0 ? Math.round((order.fee / order.amount) * 100) : 0}%)</Text>
              <Text className="text-alertred text-sm">-{formatPrice(order.fee)}</Text>
            </View>
            <View className="h-px bg-gray-100 my-2" />
            <View className="flex-row justify-between">
              <Text className="text-gray-700 text-sm font-bold">정산 예정액</Text>
              <Text className="text-primary text-sm font-bold">{formatPrice(order.amount - order.fee)}</Text>
            </View>
            {cancelRequested && (
              <Text style={{ fontSize: 12, color: '#E5484D', marginTop: 8, lineHeight: 18 }}>
                취소 요청을 승인하면 수수료 없이 전액 환불되어 정산 대상에서 제외됩니다.
              </Text>
            )}
          </View>
        )}

        {/* Cancel Reason */}
        {order.sellerStatus === 'cancelled' && (
          <View className="mx-4 mt-3 bg-white rounded-xl p-4 shadow-sm" style={{ elevation: 1 }}>
            <View className="flex-row items-center gap-2 mb-3">
              <MessageSquare color="#E5484D" size={16} />
              <Text className="font-bold text-charcoal text-[15px]">취소 사유</Text>
            </View>
            {order.cancelReason ? (
              <View style={{ backgroundColor: '#FFF0F0', borderRadius: 10, padding: 14 }}>
                <Text style={{ fontSize: 14, color: '#374151', lineHeight: 22 }}>{order.cancelReason}</Text>
              </View>
            ) : (
              <Text style={{ fontSize: 14, color: '#9AA3AF' }}>취소 사유가 입력되지 않았습니다.</Text>
            )}
          </View>
        )}

        <View className="h-24" />
      </ScrollView>

      {/* Fixed Bottom Action Button */}
      {(order.sellerStatus === 'new' || order.sellerStatus === 'confirmed') && (
        <View
          className="bg-white border-t border-gray-100 px-4 py-3"
          style={{ paddingBottom: insets.bottom + 8 }}
        >
          {/* 취소요청 대기 — 승인/거절이 유일한 다음 행동이다(픽업·확인 버튼을 덮는다) */}
          {cancelRequested && (
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 rounded-xl py-3.5 items-center"
                style={{ borderWidth: 1, borderColor: '#E5E7EB' }}
                onPress={() => { setRejectReason(''); setShowRejectModal(true); }}
              >
                <Text className="text-gray-600 font-semibold">요청 거절</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 rounded-xl py-3.5 items-center"
                style={{ backgroundColor: '#E5484D' }}
                onPress={confirmApproveCancel}
              >
                <Text className="text-white font-semibold">취소 승인</Text>
              </TouchableOpacity>
            </View>
          )}
          {order.sellerStatus === 'new' && !cancelRequested && (
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 border border-alertred rounded-xl py-3.5 items-center"
                onPress={() => { setCancelReason(''); setShowCancelModal(true); }}
              >
                <Text className="text-alertred font-semibold">주문 취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-primary rounded-xl py-3.5 items-center"
                onPress={handleConfirmOrder}
              >
                <Text className="text-white font-semibold">주문 확인</Text>
              </TouchableOpacity>
            </View>
          )}
          {order.sellerStatus === 'confirmed' && !cancelRequested && (
            <View className="flex-row gap-3">
              {/* QR 스캔이 정상 경로 — 수동 처리는 QR 훼손·카메라 불가 시 폴백 */}
              <TouchableOpacity
                className="flex-1 bg-primary rounded-xl py-3.5 items-center flex-row justify-center gap-2"
                onPress={() => navigation.navigate('QrScan')}
              >
                <QrCode color="#fff" size={17} />
                <Text className="text-white font-semibold text-[15px]">QR 스캔</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 rounded-xl py-3.5 items-center"
                style={{ backgroundColor: '#3B82F6' }}
                onPress={handleCompletePickup}
              >
                <Text className="text-white font-semibold text-[15px]">픽업 완료 처리</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* 주문 취소 사유 입력 모달 */}
      <Modal visible={showCancelModal} transparent animationType="fade" onRequestClose={() => setShowCancelModal(false)}>
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full">
            <Text className="text-lg font-bold text-charcoal mb-1 text-center">주문 취소</Text>
            <Text className="text-gray-500 text-sm text-center leading-5 mb-4">
              취소 사유를 입력해주세요. 구매자에게 전달됩니다.{'\n'}
              결제금액 전액이 환불되며 수수료는 부과되지 않습니다.
            </Text>
            <TextInput
              className="bg-softgray rounded-xl px-4 py-3 text-charcoal mb-5"
              value={cancelReason}
              onChangeText={setCancelReason}
              placeholder="예: 재고 소진으로 준비가 어렵습니다."
              placeholderTextColor="#9AA3AF"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              style={{ minHeight: 76 }}
            />
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 border border-gray-200 rounded-xl py-3 items-center"
                onPress={() => setShowCancelModal(false)}
              >
                <Text className="text-gray-600 font-semibold">닫기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 rounded-xl py-3 items-center"
                style={{ backgroundColor: cancelReason.trim() ? '#E5484D' : '#F0B4B6' }}
                disabled={!cancelReason.trim()}
                onPress={handleCancelOrder}
              >
                <Text className="text-white font-semibold">취소 처리</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 취소요청 거절 사유 입력 모달 — PG 는 건드리지 않고 주문은 그대로 유지된다 */}
      <Modal visible={showRejectModal} transparent animationType="fade" onRequestClose={() => setShowRejectModal(false)}>
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full">
            <Text className="text-lg font-bold text-charcoal mb-1 text-center">취소 요청 거절</Text>
            <Text className="text-gray-500 text-sm text-center leading-5 mb-4">
              거절 사유를 입력해주세요.{'\n'}구매자에게 그대로 전달되며 주문은 유지됩니다.
            </Text>
            <TextInput
              className="bg-softgray rounded-xl px-4 py-3 text-charcoal mb-5"
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="예: 이미 상품 준비가 끝났습니다."
              placeholderTextColor="#9AA3AF"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              style={{ minHeight: 76 }}
            />
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 border border-gray-200 rounded-xl py-3 items-center"
                onPress={() => setShowRejectModal(false)}
              >
                <Text className="text-gray-600 font-semibold">닫기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 rounded-xl py-3 items-center"
                style={{ backgroundColor: rejectReason.trim() ? '#1F2933' : '#C9CDD2' }}
                disabled={!rejectReason.trim()}
                onPress={handleRejectCancel}
              >
                <Text className="text-white font-semibold">요청 거절</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
