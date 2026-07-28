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
  const { orders, products, confirmOrder, completePickup, cancelOrder } = useApp();
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

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

  const statusInfo = ORDER_SELLER_STATUS[order.sellerStatus];

  // 주문 확인 / 취소도 실패 사유를 반드시 노출한다(무반응처럼 보이는 것 방지).
  async function handleConfirmOrder() {
    try {
      await confirmOrder(order.id);
    } catch (e) {
      Alert.alert('주문 확인 불가', pickupErrorMessage(e));
    }
  }

  async function handleCancelOrder() {
    setShowCancelModal(false);
    try {
      await cancelOrder(order.id, cancelReason);
      navigation.goBack();
    } catch (e) {
      Alert.alert('주문 취소 불가', pickupErrorMessage(e));
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

        {/* Cancel Banner */}
        {order.sellerStatus === 'cancelled' && (
          <View className="mx-4 mt-3 bg-red-50 border border-red-100 rounded-xl p-4 flex-row items-center gap-3">
            <XCircle color="#E5484D" size={20} />
            <View style={{ flex: 1 }}>
              <Text className="text-alertred text-sm font-semibold">취소된 주문입니다</Text>
              {order.cancelledAt && (
                <Text style={{ fontSize: 11, color: '#E5484D', marginTop: 2, opacity: 0.75 }}>
                  {formatDateTime(order.cancelledAt)} 취소 요청
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

        {/* Pickup Number (when confirmed) */}
        {order.sellerStatus === 'confirmed' && (
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

        {/* Settlement Info */}
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
        </View>

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
          {order.sellerStatus === 'new' && (
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
          {order.sellerStatus === 'confirmed' && (
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
              취소 사유를 입력해주세요.{'\n'}구매자에게 전달됩니다.
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
    </View>
  );
}
