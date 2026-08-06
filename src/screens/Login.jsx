import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { mapAuthError } from '../lib/auth';

export default function LoginScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) {
      Alert.alert('입력 확인', '이메일과 비밀번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    // 에러 문구 매핑은 src/lib/auth.js 의 mapAuthError 로 일원화(재설정 화면과 문구를 맞춘다)
    if (error) Alert.alert('로그인 실패', mapAuthError(error.message));
    // 성공 시 AuthProvider의 onAuthStateChange가 세션을 갱신 → 게이트가 앱으로 전환
  }

  const input = {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#1F2933',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F5F6F7' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingTop: insets.top + 40, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 브랜드 */}
        <View style={{ alignItems: 'center', marginBottom: 36 }}>
          <View style={{ width: 72, height: 72, borderRadius: 20, backgroundColor: '#22A06B', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 36 }}>🥗</Text>
          </View>
          <Text style={{ fontSize: 24, fontWeight: '800', color: '#1F2933' }}>FoodPicker 판매자</Text>
          <Text style={{ fontSize: 14, color: '#9AA3AF', marginTop: 6 }}>판매자 센터에 로그인하세요</Text>
        </View>

        <Text style={{ fontSize: 13, color: '#6B7280', marginBottom: 6, fontWeight: '600' }}>
          이메일 <Text style={{ color: '#9AA3AF', fontWeight: '400' }}>(아이디는 가입하신 이메일 주소입니다)</Text>
        </Text>
        <TextInput
          style={[input, { marginBottom: 14 }]}
          placeholder="email@example.com"
          placeholderTextColor="#C4C9D0"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <Text style={{ fontSize: 13, color: '#6B7280', marginBottom: 6, fontWeight: '600' }}>비밀번호</Text>
        <TextInput
          style={[input, { marginBottom: 24 }]}
          placeholder="비밀번호"
          placeholderTextColor="#C4C9D0"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={handleLogin}
          returnKeyType="go"
        />

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleLogin}
          disabled={loading}
          style={{ backgroundColor: '#22A06B', borderRadius: 14, paddingVertical: 16, alignItems: 'center', opacity: loading ? 0.7 : 1 }}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>로그인</Text>
          )}
        </TouchableOpacity>

        {/* 아이디(=가입 이메일) 찾기 · 비밀번호 찾기 */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 18, gap: 12 }}>
          <TouchableOpacity onPress={() => navigation.navigate('FindId')} style={{ paddingVertical: 4 }}>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>아이디 찾기</Text>
          </TouchableOpacity>
          <Text style={{ color: '#E5E7EB', fontSize: 14 }}>|</Text>
          <TouchableOpacity onPress={() => navigation.navigate('FindPassword')} style={{ paddingVertical: 4 }}>
            <Text style={{ color: '#6B7280', fontSize: 14 }}>비밀번호 찾기</Text>
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 14, gap: 6 }}>
          <Text style={{ color: '#9AA3AF', fontSize: 14 }}>아직 판매자 계정이 없으신가요?</Text>
          <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
            <Text style={{ color: '#22A06B', fontSize: 14, fontWeight: '700' }}>회원가입</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
