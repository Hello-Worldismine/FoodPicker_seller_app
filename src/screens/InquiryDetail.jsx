// 1:1 문의 상세(원문 + 관리자 답변 스레드). route.params: { inquiry } 또는 { reportId }(알림 딥링크).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, MessageSquare } from 'lucide-react-native';
import { fetchMyInquiries, fetchInquiryReplies } from '../lib/api';

const STATUS_LABEL = {
  received: '접수', checking: '확인중', awaiting_seller: '판매자 답변 대기',
  awaiting_buyer: '구매자 답변 대기', refunded: '환불 처리', closed: '종결',
};

function formatDateTime(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function InquiryDetail({ route, navigation }) {
  const { inquiry: passedInquiry, reportId } = route.params || {};
  const [inquiry, setInquiry] = useState(passedInquiry || null);
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(!passedInquiry);

  const load = useCallback(async () => {
    try {
      const id = passedInquiry?.id || reportId;
      if (!passedInquiry) {
        const list = await fetchMyInquiries();
        setInquiry(list.find(i => i.id === reportId) || null);
      }
      if (id) setReplies(await fetchInquiryReplies(id));
    } catch (e) {
      // 답변 로드 실패해도 문의 원문은 그대로 노출
    } finally {
      setLoading(false);
    }
  }, [passedInquiry, reportId]);

  useEffect(() => { load(); }, [load]);

  const Header = (
    <View className="flex-row items-center justify-between bg-white px-4 py-3.5 border-b border-gray-100">
      <TouchableOpacity onPress={() => navigation.goBack()} className="w-10">
        <ArrowLeft color="#1F2933" size={22} />
      </TouchableOpacity>
      <Text className="text-[17px] font-extrabold text-charcoal">문의 상세</Text>
      <View className="w-10" />
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-softgray" edges={['top']}>
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#22A06B" /></View>
      </SafeAreaView>
    );
  }

  if (!inquiry) {
    return (
      <SafeAreaView className="flex-1 bg-softgray" edges={['top']}>
        {Header}
        <View className="flex-1 items-center justify-center"><Text className="text-sm text-gray-400">문의를 찾을 수 없어요</Text></View>
      </SafeAreaView>
    );
  }

  const done = inquiry.status === 'closed';

  return (
    <SafeAreaView className="flex-1 bg-softgray" edges={['top']}>
      {Header}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 12 }} showsVerticalScrollIndicator={false}>
        <View className="bg-white rounded-2xl p-4">
          <View className="flex-row items-center justify-between mb-2.5">
            <View className={`rounded-full px-2.5 py-1 ${done ? 'bg-gray-100' : 'bg-mint'}`}>
              <Text className={`text-[11px] font-bold ${done ? 'text-gray-500' : 'text-primary'}`}>
                {STATUS_LABEL[inquiry.status] || inquiry.status}
              </Text>
            </View>
            <Text className="text-xs text-gray-400">{inquiry.receiptCode}</Text>
          </View>
          <Text className="text-[17px] font-extrabold text-charcoal mb-1.5">{inquiry.title}</Text>
          <Text className="text-xs text-gray-400 mb-3">{inquiry.type}{inquiry.orderCode ? ` · ${inquiry.orderCode}` : ''}</Text>
          <Text className="text-sm text-charcoal mb-3" style={{ lineHeight: 22 }}>{inquiry.content}</Text>
          <Text className="text-[11px] text-gray-400">{formatDateTime(inquiry.receivedAt)} 접수</Text>
        </View>

        <Text className="text-xs font-bold text-gray-400 mt-1">답변 {replies.length > 0 ? `(${replies.length})` : ''}</Text>
        {replies.length === 0 ? (
          <View className="bg-white rounded-2xl p-6 items-center gap-2.5">
            <MessageSquare color="#9AA3AF" size={28} />
            <Text className="text-[13px] text-gray-400 text-center" style={{ lineHeight: 20 }}>
              아직 답변 등록 전이에요{'\n'}조금만 기다려주세요
            </Text>
          </View>
        ) : (
          replies.map(r => (
            <View key={r.id} className="bg-mint rounded-2xl p-4">
              <Text className="text-xs font-bold text-primary mb-1.5">푸드피커 고객센터</Text>
              <Text className="text-sm text-charcoal mb-2" style={{ lineHeight: 22 }}>{r.message}</Text>
              <Text className="text-[11px] text-gray-400">{formatDateTime(r.createdAt)}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
