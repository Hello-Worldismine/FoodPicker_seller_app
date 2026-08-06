// 1:1 문의 내역 — 진행중/완료 탭. 사용자 어플 InquiryListScreen.js 와 동일 컨셉.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Plus, MessageSquare } from 'lucide-react-native';
import { fetchMyInquiries } from '../lib/api';

const STATUS_LABEL = {
  received: '접수', checking: '확인중', awaiting_seller: '판매자 답변 대기',
  awaiting_buyer: '구매자 답변 대기', refunded: '환불 처리', closed: '종결',
};

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function InquiryList({ navigation }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('open');
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setInquiries(await fetchMyInquiries());
    } catch (e) {
      // 목록 로드 실패해도 화면은 빈 목록으로 유지(작성은 계속 가능)
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = inquiries.filter(i => (tab === 'done' ? i.status === 'closed' : i.status !== 'closed'));

  return (
    <SafeAreaView className="flex-1 bg-softgray" edges={['top']}>
      <View className="flex-row items-center justify-between bg-white px-4 py-3.5 border-b border-gray-100">
        <TouchableOpacity onPress={() => navigation.goBack()} className="w-10">
          <ArrowLeft color="#1F2933" size={22} />
        </TouchableOpacity>
        <Text className="text-[17px] font-extrabold text-charcoal">1:1 문의 내역</Text>
        <View className="w-10" />
      </View>

      <View className="flex-row bg-white px-4 gap-5 border-b border-gray-100">
        <TouchableOpacity className={`py-3 border-b-2 ${tab === 'open' ? 'border-primary' : 'border-transparent'}`} onPress={() => setTab('open')}>
          <Text className={`text-sm font-semibold ${tab === 'open' ? 'text-primary' : 'text-gray-400'}`}>진행중인 문의</Text>
        </TouchableOpacity>
        <TouchableOpacity className={`py-3 border-b-2 ${tab === 'done' ? 'border-primary' : 'border-transparent'}`} onPress={() => setTab('done')}>
          <Text className={`text-sm font-semibold ${tab === 'done' ? 'text-primary' : 'text-gray-400'}`}>완료된 문의</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#22A06B" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 10, flexGrow: 1 }}
          renderItem={({ item }) => {
            const done = item.status === 'closed';
            return (
              <TouchableOpacity
                className="bg-white rounded-2xl p-4"
                activeOpacity={0.8}
                onPress={() => navigation.navigate('InquiryDetail', { inquiry: item })}
              >
                <View className="flex-row items-center justify-between mb-2">
                  <View className={`rounded-full px-2.5 py-1 ${done ? 'bg-gray-100' : 'bg-mint'}`}>
                    <Text className={`text-[11px] font-bold ${done ? 'text-gray-500' : 'text-primary'}`}>
                      {STATUS_LABEL[item.status] || item.status}
                    </Text>
                  </View>
                  <Text className="text-xs text-gray-400">{formatDate(item.receivedAt)}</Text>
                </View>
                <Text className="text-[15px] font-bold text-charcoal mb-1" numberOfLines={1}>{item.title}</Text>
                <Text className="text-xs text-gray-400" numberOfLines={1}>{item.type}</Text>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center gap-2.5 pt-20">
              <MessageSquare color="#9AA3AF" size={40} />
              <Text className="text-sm text-gray-400">{tab === 'done' ? '완료된 문의가 없어요' : '진행중인 문의가 없어요'}</Text>
            </View>
          }
        />
      )}

      <TouchableOpacity
        className="absolute left-4 right-4 bg-primary rounded-2xl py-4 flex-row items-center justify-center gap-1.5 shadow-sm"
        style={{ elevation: 4, bottom: insets.bottom + 20 }}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('InquiryForm')}
      >
        <Plus color="#fff" size={18} />
        <Text className="text-white text-[15px] font-bold">새 문의 작성</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
