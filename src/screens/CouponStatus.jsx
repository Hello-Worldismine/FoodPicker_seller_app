import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, Plus, Ticket } from 'lucide-react-native';
import { fetchMyCoupons } from '../lib/api';

const STATUS_CFG = {
  pending:  { label: '승인 대기', color: '#FF8A3D', bg: '#FFF4ED' },
  approved: { label: '발행 완료', color: '#22A06B', bg: '#E9F8F1' },
  rejected: { label: '반려',      color: '#E5484D', bg: '#FFF0F0' },
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

  const load = useCallback(async () => {
    try {
      setCoupons(await fetchMyCoupons());
    } catch (e) {
      // 무시(빈 목록 유지)
    }
  }, []);

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
            const st = STATUS_CFG[c.requestStatus] || STATUS_CFG.pending;
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
                {c.requestStatus === 'rejected' && c.rejectReason ? (
                  <View className="mt-3 bg-alertred/10 rounded-lg px-3 py-2">
                    <Text className="text-alertred text-[12px]">반려 사유: {c.rejectReason}</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
