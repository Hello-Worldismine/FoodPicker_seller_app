// 비밀번호 변경 — 로그인 상태에서 매장관리 > 설정에서 진입한다.
// (로그인 전 '비밀번호 찾기'(FindPassword.jsx)와는 별개 화면이다)
//
// ★ 현재 비밀번호를 먼저 재확인한다. Supabase 의 'Secure password change' 옵션이 켜져 있으면
//   서버도 최근 재인증을 요구하므로, 여기서 signInWithPassword 로 확인해 두면 두 경우 모두 맞는다.
//   (signInWithPassword 는 같은 계정 세션을 재발급할 뿐이라 로그아웃되지 않는다)
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useAuth } from '../store/authStore';
import { changePassword, verifyCurrentPassword } from '../lib/auth';

export default function ChangePassword({ navigation }) {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [nextConfirm, setNextConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = current.length > 0 && next.length > 0 && nextConfirm.length > 0;

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    if (next.length < 6) {
      Alert.alert('입력 확인', '비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (next !== nextConfirm) {
      Alert.alert('입력 확인', '새 비밀번호가 일치하지 않습니다.');
      return;
    }
    if (next === current) {
      Alert.alert('입력 확인', '이전과 다른 비밀번호를 입력해주세요.');
      return;
    }
    if (!user?.email) {
      Alert.alert('오류', '계정 정보를 확인할 수 없습니다. 다시 로그인해주세요.');
      return;
    }

    setSubmitting(true);
    try {
      await verifyCurrentPassword(user.email, current);
      await changePassword(next);
      Alert.alert('변경 완료', '비밀번호가 변경되었습니다.', [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('변경 실패', e.message || '비밀번호 변경 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-softgray" edges={['top']}>
      <View className="flex-row items-center justify-between bg-white px-4 py-3.5 border-b border-gray-100">
        <TouchableOpacity onPress={() => navigation.goBack()} className="w-10">
          <ArrowLeft color="#1F2933" size={22} />
        </TouchableOpacity>
        <Text className="text-[17px] font-extrabold text-charcoal">비밀번호 변경</Text>
        <View className="w-10" />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 12 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View className="bg-white rounded-2xl p-4 gap-3">
            <View>
              <Text className="text-[15px] font-extrabold text-charcoal mb-1">계정</Text>
              <Text className="text-sm text-gray-500">{user?.email ?? '-'}</Text>
            </View>
          </View>

          <View className="bg-white rounded-2xl p-4">
            <Text className="text-[15px] font-extrabold text-charcoal mb-3">현재 비밀번호</Text>
            <TextInput
              value={current}
              onChangeText={setCurrent}
              placeholder="현재 사용 중인 비밀번호"
              placeholderTextColor="#9AA3AF"
              secureTextEntry
              autoCapitalize="none"
              className="bg-softgray rounded-xl px-3 py-3 text-sm text-charcoal border-[1.5px] border-softgray"
            />
          </View>

          <View className="bg-white rounded-2xl p-4 gap-3">
            <Text className="text-[15px] font-extrabold text-charcoal">새 비밀번호</Text>
            <TextInput
              value={next}
              onChangeText={setNext}
              placeholder="6자 이상"
              placeholderTextColor="#9AA3AF"
              secureTextEntry
              autoCapitalize="none"
              className="bg-softgray rounded-xl px-3 py-3 text-sm text-charcoal border-[1.5px] border-softgray"
            />
            <TextInput
              value={nextConfirm}
              onChangeText={setNextConfirm}
              placeholder="새 비밀번호 재입력"
              placeholderTextColor="#9AA3AF"
              secureTextEntry
              autoCapitalize="none"
              onSubmitEditing={handleSubmit}
              returnKeyType="done"
              className="bg-softgray rounded-xl px-3 py-3 text-sm text-charcoal border-[1.5px] border-softgray"
            />
          </View>

          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
            className={`rounded-2xl py-4 items-center mt-1 ${(!canSubmit || submitting) ? 'bg-gray-300' : 'bg-primary'}`}
          >
            <Text className="text-white text-base font-bold">{submitting ? '변경 중…' : '비밀번호 변경'}</Text>
          </TouchableOpacity>
          <Text className="text-xs text-gray-400 text-center mt-1">
            비밀번호가 기억나지 않으면 로그아웃 후 로그인 화면의 [비밀번호 찾기]를 이용해주세요
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
