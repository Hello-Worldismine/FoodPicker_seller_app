// 1:1 문의 작성 — 사용자 어플 InquiryScreen.js 와 동일 구조. 판매자 문의는 유형이 달라
// 관리자 웹 ReportManagement.tsx 의 SELLER_INQUIRY_TYPES 와 문자열을 정확히 맞춘다(필터 연동).
import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { createSellerInquiry } from '../lib/api';

const INQUIRY_TYPES = [
  '정산 관련 문의',
  '계정/정보 변경 요청',
  '상품 등록 오류',
  '이용정지/제재 이의제기',
  '플랫폼 정책 문의',
  '기타',
];

const MAX_TITLE = 60;
const MAX_CONTENT = 1000;

export default function InquiryForm({ navigation }) {
  const [type, setType] = useState(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef(null);
  // 내용 입력칸이 화면 중하단이라 포커스 시 키보드에 가려짐 — 포커스되면 하단까지 스크롤해 노출.
  const scrollToBottom = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

  const canSubmit = !!type && title.trim().length > 0 && content.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const { receiptCode } = await createSellerInquiry(type, title.trim(), content.trim());
      Alert.alert(
        '문의가 접수되었어요',
        `접수번호: ${receiptCode}\n답변까지 1~2일 정도 소요됩니다.`,
        [{ text: '확인', onPress: () => navigation.goBack() }],
      );
    } catch (e) {
      setSubmitting(false);
      Alert.alert('문의 접수 실패', e.message || '문의 접수 중 오류가 발생했습니다.');
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-softgray" edges={['top']}>
      <View className="flex-row items-center justify-between bg-white px-4 py-3.5 border-b border-gray-100">
        <TouchableOpacity onPress={() => navigation.goBack()} className="w-10">
          <ArrowLeft color="#1F2933" size={22} />
        </TouchableOpacity>
        <Text className="text-[17px] font-extrabold text-charcoal">1:1 문의</Text>
        <View className="w-10" />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 12 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="bg-white rounded-2xl p-4">
          <Text className="text-[15px] font-extrabold text-charcoal mb-3">문의 유형</Text>
          <View className="gap-2">
            {INQUIRY_TYPES.map(t => (
              <TouchableOpacity
                key={t}
                onPress={() => setType(t)}
                activeOpacity={0.7}
                className={`rounded-xl px-3.5 py-3 border-[1.5px] ${type === t ? 'border-primary bg-mint' : 'border-softgray bg-softgray'}`}
              >
                <Text className={`text-sm ${type === t ? 'text-primary font-bold' : 'text-charcoal'}`}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View className="bg-white rounded-2xl p-4">
          <Text className="text-[15px] font-extrabold text-charcoal mb-3">제목</Text>
          <TextInput
            value={title}
            onChangeText={v => setTitle(v.slice(0, MAX_TITLE))}
            placeholder="문의 제목을 입력해주세요"
            placeholderTextColor="#9AA3AF"
            className="bg-softgray rounded-xl px-3 py-3 text-sm text-charcoal border-[1.5px] border-softgray"
          />
        </View>

        <View className="bg-white rounded-2xl p-4">
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-[15px] font-extrabold text-charcoal">내용</Text>
            <Text className="text-xs text-gray-400">{content.length}/{MAX_CONTENT}</Text>
          </View>
          <TextInput
            value={content}
            onChangeText={v => setContent(v.slice(0, MAX_CONTENT))}
            onFocus={scrollToBottom}
            placeholder={'문의 내용을 자세히 적어주시면\n더 빠르고 정확한 답변이 가능해요.'}
            placeholderTextColor="#9AA3AF"
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            className="bg-softgray rounded-xl px-3 py-3 text-sm text-charcoal border-[1.5px] border-softgray"
            style={{ minHeight: 140, lineHeight: 22 }}
          />
        </View>

        <TouchableOpacity
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
          className={`rounded-2xl py-4 items-center mt-1 ${(!canSubmit || submitting) ? 'bg-gray-300' : 'bg-primary'}`}
        >
          <Text className="text-white text-base font-bold">{submitting ? '접수 중…' : '문의 접수하기'}</Text>
        </TouchableOpacity>
        <Text className="text-xs text-gray-400 text-center mt-1">접수된 문의는 고객센터 운영 시간 내에 순차적으로 답변드려요</Text>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
