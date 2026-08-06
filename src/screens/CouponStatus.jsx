import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator,
  Modal, TextInput, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, Plus, Ticket } from 'lucide-react-native';
import { fetchMyCoupons, respondCouponOffer } from '../lib/api';

// 점주 발행 신청(source='seller') 관점: 관리자의 승인을 기다리는 상태.
const STATUS_CFG = {
  pending:  { label: '승인 대기', color: '#FF8A3D', bg: '#FFF4ED' },
  approved: { label: '발행 완료', color: '#22A06B', bg: '#E9F8F1' },
  rejected: { label: '반려',      color: '#E5484D', bg: '#FFF0F0' },
};
// 관리자 발급(source='admin') 관점: pending 의 의미가 반대(내가 수락할 차례) — 라벨 별도 구성.
const ADMIN_STATUS_CFG = {
  pending:  { label: '수락 대기',       color: '#FF8A3D', bg: '#FFF4ED' },
  approved: { label: '수락됨(노출 중)', color: '#22A06B', bg: '#E9F8F1' },
  rejected: { label: '거절함',          color: '#E5484D', bg: '#FFF0F0' },
};

function discountLabel(c) {
  if (c.discountType === 'rate') {
    return `${c.discountValue}% 할인` + (c.maxDiscountAmount ? ` (최대 ${c.maxDiscountAmount.toLocaleString()}원)` : '');
  }
  return `${(c.discountValue || 0).toLocaleString()}원 할인`;
}

export default function CouponStatusScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [respondingId, setRespondingId] = useState(null); // 수락/거절 처리 중인 쿠폰 id(중복 탭 방지)
  const [rejectTarget, setRejectTarget] = useState(null); // 거절 사유 입력 모달 대상 쿠폰
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    try {
      setCoupons(await fetchMyCoupons());
    } catch (e) {
      // 무시(빈 목록 유지)
    }
  }, []);

  // 관리자 발급 쿠폰 수락/거절 → 성공 시 목록 재조회
  const respond = useCallback(async (id, accept, reason = null) => {
    if (respondingId) return; // 처리 중 중복 탭 방지
    setRespondingId(id);
    try {
      await respondCouponOffer(id, accept, reason);
      await load();
    } catch (e) {
      Alert.alert('처리 실패', e.message || '쿠폰 처리 중 오류가 발생했습니다.');
    } finally {
      setRespondingId(null);
    }
  }, [respondingId, load]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', async () => {
      await load();
      setLoading(false);
    });
    return unsub;
  }, [navigation, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View className="flex-1 bg-softgray">
      {/* Header */}
      <View
        className="bg-white px-4 pb-3 border-b border-gray-100 flex-row items-center justify-between"
        style={{ paddingTop: insets.top + 16 }}
      >
        <View className="flex-row items-center">
          <TouchableOpacity onPress={() => navigation.goBack()} className="mr-3 p-1">
            <ChevronLeft color="#1F2933" size={22} />
          </TouchableOpacity>
          <Text className="text-lg font-bold text-charcoal">쿠폰 신청 현황</Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('CouponRequest')}
          className="bg-mint rounded-lg px-3 py-1.5 flex-row items-center gap-1"
        >
          <Plus color="#22A06B" size={14} />
          <Text className="text-primary text-[13px] font-semibold">만들기</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#22A06B" /></View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22A06B" />}
        >
          {coupons.length === 0 ? (
            <View className="items-center pt-24">
              <Ticket color="#C8CDD3" size={44} />
              <Text className="text-gray-400 mt-3 text-[15px]">신청한 쿠폰이 없습니다</Text>
              <TouchableOpacity
                className="bg-primary rounded-xl px-5 py-3 mt-5"
                onPress={() => navigation.navigate('CouponRequest')}
              >
                <Text className="text-white font-semibold">쿠폰 만들기</Text>
              </TouchableOpacity>
            </View>
          ) : coupons.map(c => {
            const isAdmin = c.source === 'admin'; // 관리자가 우리 매장에 지정 발급한 쿠폰
            const cfg = isAdmin ? ADMIN_STATUS_CFG : STATUS_CFG;
            // 관리자가 응답 전에 발급을 회수한 쿠폰 — 판매자가 거절한 것처럼 보이지 않게 구분
            const isRevoked = isAdmin && c.requestStatus === 'rejected' && c.rejectReason === '관리자 회수';
            // request_status 없는 관리자 쿠폰(요청 플로우 이전 발급)은 활성 여부로 판단.
            // 수락 후 관리자가 비활성화한 쿠폰은 '노출 중'으로 단정하지 않는다(store_coupons 게이트는 is_active 필요).
            const st = isRevoked
              ? { label: '발급 회수됨', color: '#6B7280', bg: '#F2F4F6' }
              : (isAdmin && c.requestStatus === 'approved' && !c.isActive)
                ? { label: '수락됨(비활성)', color: '#6B7280', bg: '#F2F4F6' }
                : cfg[c.requestStatus] || (isAdmin && c.isActive ? cfg.approved : cfg.pending);
            const busy = respondingId === c.id;
            return (
              <View key={c.id} className="bg-white rounded-2xl p-4 mb-3 shadow-sm" style={{ elevation: 1 }}>
                <View className="flex-row items-start justify-between mb-1">
                  <Text className="text-[16px] font-bold text-charcoal flex-1 pr-2" numberOfLines={1}>{c.name}</Text>
                  <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: st.bg }}>
                    <Text className="text-[11px] font-bold" style={{ color: st.color }}>{st.label}</Text>
                  </View>
                </View>
                <Text className="text-primary text-[15px] font-bold mb-2">{discountLabel(c)}</Text>
                <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                  <Text className="text-gray-500 text-[13px]">최소주문 {(c.minOrderAmount || 0).toLocaleString()}원</Text>
                  {c.endsOn ? <Text className="text-gray-500 text-[13px]">~{String(c.endsOn).replace(/-/g, '.')}</Text> : <Text className="text-gray-500 text-[13px]">무기한</Text>}
                  {c.totalQuantity ? <Text className="text-gray-500 text-[13px]">{c.totalQuantity.toLocaleString()}장</Text> : null}
                  {c.allowStacking ? <Text className="text-blue-500 text-[13px]">중복가능</Text> : null}
                </View>
                {isAdmin && c.requestStatus === 'pending' ? (
                  <>
                    {/* 관리자 발급 요청 안내 + 수락/거절 */}
                    <View className="mt-3 rounded-lg px-3 py-2" style={{ backgroundColor: '#FFF4ED' }}>
                      <Text className="text-[12px] leading-4" style={{ color: '#B05A1C' }}>
                        관리자가 우리 매장에 발급을 요청한 쿠폰입니다. 수락하면 사용자 앱 매장 페이지에 노출됩니다.
                      </Text>
                    </View>
                    <View className="flex-row gap-3 mt-3">
                      <TouchableOpacity
                        className="flex-1 border border-gray-200 rounded-xl py-2.5 items-center"
                        disabled={!!respondingId}
                        onPress={() => { setRejectReason(''); setRejectTarget(c); }}
                      >
                        <Text className="text-gray-600 font-semibold text-[14px]">거절</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        className="flex-1 rounded-xl py-2.5 items-center"
                        style={{ backgroundColor: respondingId ? '#9FDBC0' : '#22A06B' }}
                        disabled={!!respondingId}
                        onPress={() => respond(c.id, true)}
                      >
                        {busy
                          ? <ActivityIndicator color="#FFFFFF" size="small" />
                          : <Text className="text-white font-semibold text-[14px]">수락</Text>}
                      </TouchableOpacity>
                    </View>
                  </>
                ) : null}
                {isRevoked ? (
                  <View className="mt-3 rounded-lg px-3 py-2" style={{ backgroundColor: '#F2F4F6' }}>
                    <Text className="text-gray-500 text-[12px]">관리자가 발급을 회수했습니다.</Text>
                  </View>
                ) : c.requestStatus === 'rejected' && c.rejectReason ? (
                  <View className="mt-3 bg-alertred/10 rounded-lg px-3 py-2">
                    <Text className="text-alertred text-[12px]">{isAdmin ? '거절 사유' : '반려 사유'}: {c.rejectReason}</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* 관리자 발급 쿠폰 거절 사유 입력 모달(사유 선택 입력) */}
      <Modal visible={!!rejectTarget} transparent animationType="fade" onRequestClose={() => setRejectTarget(null)}>
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full">
            <Text className="text-lg font-bold text-charcoal mb-1 text-center">발급 거절</Text>
            <Text className="text-gray-500 text-sm text-center leading-5 mb-4">
              거절 사유를 입력해주세요. (선택){'\n'}관리자에게 전달됩니다.
            </Text>
            <TextInput
              className="bg-softgray rounded-xl px-4 py-3 text-charcoal mb-5"
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="예: 진행 중인 자체 할인과 중복되어 어렵습니다."
              placeholderTextColor="#9AA3AF"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              style={{ minHeight: 76 }}
            />
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 border border-gray-200 rounded-xl py-3 items-center"
                onPress={() => setRejectTarget(null)}
              >
                <Text className="text-gray-600 font-semibold">닫기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 rounded-xl py-3 items-center"
                style={{ backgroundColor: '#E5484D' }}
                onPress={() => {
                  const target = rejectTarget;
                  setRejectTarget(null);
                  respond(target.id, false, rejectReason.trim() || null);
                }}
              >
                <Text className="text-white font-semibold">거절하기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
