import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Store as StoreIcon, LogOut } from 'lucide-react-native';
import { useApp } from '../store/appStore';
import { useAuth } from '../store/authStore';
import * as api from '../lib/api';

// 로그인은 됐지만 아직 매장이 없는(프로비저닝 전) 판매자 진입 화면.
// '판매자 등록 시작하기' → provision_my_store RPC 로 본인 매장 생성 → 데이터 재로딩 → 앱 진입.
export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { reload } = useApp();
  const { user, signOut } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  async function handleStart() {
    setSubmitting(true);
    try {
      await api.provisionMyStore();
      await reload(); // storeInfo 채워지면 Gate가 본 앱으로 전환
    } catch (e) {
      Alert.alert('등록 실패', e.message || '매장 생성 중 오류가 발생했습니다.');
      setSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: '#E9F8F1', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
          <StoreIcon color="#22A06B" size={40} />
        </View>
        <Text style={{ fontSize: 22, fontWeight: '800', color: '#1F2933', marginBottom: 10, textAlign: 'center' }}>
          판매자 등록을 시작하세요
        </Text>
        <Text style={{ fontSize: 15, color: '#6B7280', lineHeight: 23, textAlign: 'center', marginBottom: 4 }}>
          아직 등록된 매장이 없습니다.{'\n'}아래 버튼을 누르면 가입 시 입력한 정보로{'\n'}내 매장이 생성되고 바로 판매를 시작할 수 있어요.
        </Text>
        {!!user?.email && (
          <Text style={{ fontSize: 13, color: '#9AA3AF', marginTop: 12 }}>{user.email}</Text>
        )}
      </View>

      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={submitting}
          onPress={handleStart}
          style={{ backgroundColor: submitting ? '#9AD8BE' : '#22A06B', borderRadius: 14, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
        >
          {submitting && <ActivityIndicator color="#fff" size="small" />}
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
            {submitting ? '매장을 생성하는 중…' : '판매자 등록 시작하기'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          disabled={submitting}
          onPress={() => signOut()}
          style={{ paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
        >
          <LogOut color="#9AA3AF" size={16} />
          <Text style={{ color: '#9AA3AF', fontSize: 14, fontWeight: '600' }}>다른 계정으로 로그인</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
