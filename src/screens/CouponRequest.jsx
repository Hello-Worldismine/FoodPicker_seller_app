import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, Alert, Switch, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ChevronLeft, Ticket } from 'lucide-react-native';
import { requestCoupon } from '../lib/api';

function onlyDigits(t) { return (t || '').replace(/[^0-9]/g, ''); }
function fmtDate(d) {
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CouponRequestScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [discountType, setDiscountType] = useState('amount'); // 'amount' | 'rate'
  const [discountValue, setDiscountValue] = useState('');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [endDate, setEndDate] = useState(null);
  const [showDate, setShowDate] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [allowStacking, setAllowStacking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isRate = discountType === 'rate';
  const canSubmit =
    name.trim().length > 0 &&
    Number(discountValue) > 0 &&
    (!isRate || Number(maxDiscount) > 0);

  function onDateChange(event, d) {
    if (Platform.OS === 'android') setShowDate(false);
    if (d) setEndDate(d);
  }

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await requestCoupon({
        name: name.trim(),
        discountType,
        discountValue: Number(discountValue),
        maxDiscountAmount: isRate ? Number(maxDiscount) : null,
        minOrderAmount: Number(minOrder) || 0,
        endsOn: endDate ? fmtDate(endDate) : null,
        totalQuantity: quantity ? Number(quantity) : null,
        allowStacking,
      });
      Alert.alert(
        '신청 완료',
        '쿠폰 발행을 신청했습니다.\n관리자 승인 후 발행됩니다.',
        [{ text: '확인', onPress: () => navigation.goBack() }],
      );
    } catch (e) {
      Alert.alert('신청 실패', e.message || '쿠폰 신청 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View className="flex-1 bg-softgray">
      {/* Header */}
      <View
        className="bg-white px-4 pb-3 border-b border-gray-100 flex-row items-center"
        style={{ paddingTop: insets.top + 16 }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3 p-1">
          <ChevronLeft color="#1F2933" size={22} />
        </TouchableOpacity>
        <Text className="text-lg font-bold text-charcoal">쿠폰 만들기</Text>
      </View>

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {/* 안내 */}
          <View className="mx-4 mt-3 bg-mint border border-primary/20 rounded-xl p-3 mb-2 flex-row items-start gap-2">
            <Ticket color="#22A06B" size={16} />
            <Text className="text-primary text-xs leading-4 flex-1">
              점주 발행 쿠폰은 <Text className="font-bold">부담 100% 점주</Text>로 신청되며, 관리자 승인 후 발행됩니다.
            </Text>
          </View>

          {/* 쿠폰명 */}
          <View className="mx-4 mb-3">
            <Text className="text-sm font-bold text-charcoal mb-2">쿠폰명 *</Text>
            <TextInput
              className="bg-white rounded-xl px-4 py-3 text-charcoal border border-gray-100"
              value={name}
              onChangeText={setName}
              placeholder="예: 첫 방문 감사 쿠폰"
              placeholderTextColor="#9AA3AF"
            />
          </View>

          {/* 할인 방식 */}
          <View className="mx-4 mb-3">
            <Text className="text-sm font-bold text-charcoal mb-2">할인 방식 *</Text>
            <View className="flex-row gap-2">
              {[{ k: 'amount', l: '정액 할인' }, { k: 'rate', l: '정률 할인' }].map(o => {
                const active = discountType === o.k;
                return (
                  <TouchableOpacity
                    key={o.k}
                    onPress={() => setDiscountType(o.k)}
                    className="flex-1 rounded-xl py-3 items-center border"
                    style={{
                      backgroundColor: active ? '#E9F8F1' : '#fff',
                      borderColor: active ? '#22A06B' : '#E5E7EB',
                    }}
                  >
                    <Text className="font-semibold" style={{ color: active ? '#22A06B' : '#9AA3AF' }}>{o.l}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* 할인 값 */}
          <View className="mx-4 mb-3">
            <Text className="text-sm font-bold text-charcoal mb-2">{isRate ? '할인율 (%) *' : '할인 금액 (원) *'}</Text>
            <TextInput
              className="bg-white rounded-xl px-4 py-3 text-charcoal border border-gray-100"
              value={discountValue}
              onChangeText={t => setDiscountValue(onlyDigits(t))}
              placeholder={isRate ? '예: 10' : '예: 1000'}
              placeholderTextColor="#9AA3AF"
              keyboardType="numeric"
            />
          </View>

          {/* 정률: 최대 할인 한도 (필수) */}
          {isRate && (
            <View className="mx-4 mb-3">
              <Text className="text-sm font-bold text-orange mb-2">최대 할인 한도 (원) *</Text>
              <TextInput
                className="bg-white rounded-xl px-4 py-3 text-charcoal"
                style={{ borderWidth: 1.5, borderColor: Number(maxDiscount) > 0 ? '#E5E7EB' : '#FF8A3D' }}
                value={maxDiscount}
                onChangeText={t => setMaxDiscount(onlyDigits(t))}
                placeholder="정률 할인의 상한 금액 (필수)"
                placeholderTextColor="#9AA3AF"
                keyboardType="numeric"
              />
              <Text className="text-gray-400 text-xs mt-1">고액 주문에서 예산 초과를 막기 위해 필수입니다.</Text>
            </View>
          )}

          {/* 최소 주문 금액 */}
          <View className="mx-4 mb-3">
            <Text className="text-sm font-bold text-charcoal mb-2">최소 주문 금액 (원)</Text>
            <TextInput
              className="bg-white rounded-xl px-4 py-3 text-charcoal border border-gray-100"
              value={minOrder}
              onChangeText={t => setMinOrder(onlyDigits(t))}
              placeholder="예: 5000 (없으면 0)"
              placeholderTextColor="#9AA3AF"
              keyboardType="numeric"
            />
          </View>

          {/* 사용 기간(종료일) */}
          <View className="mx-4 mb-3">
            <Text className="text-sm font-bold text-charcoal mb-2">사용 종료일</Text>
            <TouchableOpacity
              className="bg-white rounded-xl px-4 py-3 border border-gray-100 flex-row items-center justify-between"
              onPress={() => setShowDate(true)}
            >
              <Text className={endDate ? 'text-charcoal' : 'text-gray-400'}>{endDate ? fmtDate(endDate) : '종료일 선택 (없으면 무기한)'}</Text>
              {endDate && (
                <TouchableOpacity onPress={() => setEndDate(null)}>
                  <Text className="text-gray-400 text-xs">지우기</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          {/* 발행 수량 */}
          <View className="mx-4 mb-3">
            <Text className="text-sm font-bold text-charcoal mb-2">발행 수량</Text>
            <TextInput
              className="bg-white rounded-xl px-4 py-3 text-charcoal border border-gray-100"
              value={quantity}
              onChangeText={t => setQuantity(onlyDigits(t))}
              placeholder="예: 100 (없으면 무제한)"
              placeholderTextColor="#9AA3AF"
              keyboardType="numeric"
            />
          </View>

          {/* 중복 사용 여부 */}
          <View className="mx-4 mb-3 bg-white rounded-xl px-4 py-3.5 border border-gray-100 flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-sm font-bold text-charcoal">중복 사용 가능</Text>
              <Text className="text-gray-400 text-xs mt-0.5">다른 쿠폰과 함께 사용할 수 있게 허용</Text>
            </View>
            <Switch
              value={allowStacking}
              onValueChange={setAllowStacking}
              trackColor={{ false: '#E0E0E0', true: '#22A06B' }}
              thumbColor="#fff"
            />
          </View>

          <View className="h-20" />
        </ScrollView>

        {/* Submit */}
        <View className="bg-white border-t border-gray-100 px-4 py-3" style={{ paddingBottom: insets.bottom + 8 }}>
          <TouchableOpacity
            className="rounded-xl py-4 items-center"
            style={{ backgroundColor: canSubmit && !submitting ? '#22A06B' : '#E5E7EB' }}
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
          >
            <Text className="font-bold text-[15px]" style={{ color: canSubmit && !submitting ? '#fff' : '#9AA3AF' }}>
              {submitting ? '신청 중…' : '발행 신청하기'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Date picker */}
      {showDate && (
        Platform.OS === 'ios' ? (
          <Modal visible transparent animationType="slide">
            <View className="flex-1 justify-end bg-black/40">
              <View className="bg-white rounded-t-2xl">
                <View className="flex-row justify-between items-center px-4 py-3 border-b border-gray-100">
                  <TouchableOpacity onPress={() => setShowDate(false)}><Text className="text-gray-500 text-[15px]">취소</Text></TouchableOpacity>
                  <Text className="font-bold text-charcoal">종료일 선택</Text>
                  <TouchableOpacity onPress={() => setShowDate(false)}><Text className="text-primary font-semibold text-[15px]">확인</Text></TouchableOpacity>
                </View>
                <DateTimePicker
                  value={endDate || new Date()}
                  mode="date"
                  display="spinner"
                  minimumDate={new Date()}
                  onChange={(e, d) => { if (d) setEndDate(d); }}
                  locale="ko-KR"
                />
              </View>
            </View>
          </Modal>
        ) : (
          <DateTimePicker
            value={endDate || new Date()}
            mode="date"
            display="default"
            minimumDate={new Date()}
            onChange={onDateChange}
          />
        )
      )}
    </View>
  );
}
