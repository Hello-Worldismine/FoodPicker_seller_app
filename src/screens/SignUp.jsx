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
import { ChevronLeft } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { formatPhone } from '../lib/format';

export default function SignUpScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [storeName, setStoreName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignUp() {
    if (!email.trim() || !password) {
      Alert.alert('입력 확인', '이메일과 비밀번호를 입력해주세요.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('입력 확인', '비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (password !== passwordConfirm) {
      Alert.alert('입력 확인', '비밀번호가 일치하지 않습니다.');
      return;
    }
    if (!storeName.trim()) {
      Alert.alert('입력 확인', '매장명을 입력해주세요.');
      return;
    }
    // ★ 대표자명·매장 전화는 '아이디 찾기'의 본인확인 인자다(find_email_by_seller RPC).
    //   예전에는 빈 값도 통과해서 stores.owner_name='' 인 매장이 만들어졌고, 그 계정은
    //   영원히 아이디 찾기가 불가능했다. 그래서 여기서 필수로 막는다.
    if (!ownerName.trim()) {
      Alert.alert('입력 확인', '대표자명을 입력해주세요.\n아이디(이메일) 찾기 시 본인 확인에 사용됩니다.');
      return;
    }
    if (phone.replace(/[^0-9]/g, '').length < 9) {
      Alert.alert('입력 확인', '매장 전화번호를 정확히 입력해주세요.\n아이디(이메일) 찾기 시 본인 확인에 사용됩니다.');
      return;
    }

    setLoading(true);
    // options.data → raw_user_meta_data. 판매자 승격(app_metadata.role) 후 매장 자동 생성 시 사용됨.
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: 'foodpicker-seller://auth-callback',
        data: {
          store_name: storeName.trim(),
          owner_name: ownerName.trim(),
          phone: phone.trim(),
        },
      },
    });
    setLoading(false);

    if (error) {
      const msg = error.message.includes('already registered')
        ? '이미 가입된 이메일입니다.'
        : error.message;
      Alert.alert('회원가입 실패', msg);
      return;
    }

    if (data.session) {
      // 이메일 확인이 꺼져 있으면 즉시 세션 발급 → 게이트가 앱으로 전환
      Alert.alert('가입 완료', '판매자 계정이 생성되었습니다.');
    } else {
      // 이메일 확인이 켜져 있으면 인증 후 로그인 필요
      Alert.alert(
        '가입 신청 완료',
        '입력하신 이메일로 인증 메일을 보냈습니다.\n인증 완료 후 로그인해주세요.',
        [{ text: '확인', onPress: () => navigation.goBack() }]
      );
    }
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
    marginBottom: 14,
  };
  const label = { fontSize: 13, color: '#6B7280', marginBottom: 6, fontWeight: '600' };

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F6F7' }}>
      {/* 헤더 */}
      <View style={{ backgroundColor: '#fff', paddingTop: insets.top + 12, paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 10, padding: 4 }}>
          <ChevronLeft color="#1F2933" size={24} />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#1F2933' }}>판매자 회원가입</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#1F2933', marginBottom: 14 }}>계정 정보</Text>
          <Text style={label}>이메일 <Text style={{ color: '#E5484D' }}>*</Text></Text>
          <TextInput style={input} placeholder="email@example.com" placeholderTextColor="#C4C9D0" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail} />
          <Text style={label}>비밀번호 <Text style={{ color: '#E5484D' }}>*</Text></Text>
          <TextInput style={input} placeholder="6자 이상" placeholderTextColor="#C4C9D0" secureTextEntry value={password} onChangeText={setPassword} />
          <Text style={label}>비밀번호 확인 <Text style={{ color: '#E5484D' }}>*</Text></Text>
          <TextInput style={input} placeholder="비밀번호 재입력" placeholderTextColor="#C4C9D0" secureTextEntry value={passwordConfirm} onChangeText={setPasswordConfirm} />

          <Text style={{ fontSize: 15, fontWeight: '700', color: '#1F2933', marginTop: 10, marginBottom: 14 }}>매장 정보</Text>
          <Text style={label}>매장명 <Text style={{ color: '#E5484D' }}>*</Text></Text>
          <TextInput style={input} placeholder="예: 그린샐러드 강남점" placeholderTextColor="#C4C9D0" value={storeName} onChangeText={setStoreName} />
          <Text style={label}>대표자명 <Text style={{ color: '#E5484D' }}>*</Text></Text>
          <TextInput style={input} placeholder="대표자 성명" placeholderTextColor="#C4C9D0" value={ownerName} onChangeText={setOwnerName} />
          <Text style={label}>매장 전화 <Text style={{ color: '#E5484D' }}>*</Text></Text>
          <TextInput style={input} placeholder="02-1234-5678" placeholderTextColor="#C4C9D0" keyboardType="phone-pad" value={phone} onChangeText={t => setPhone(formatPhone(t))} maxLength={13} />
          <Text style={{ fontSize: 12, color: '#9AA3AF', lineHeight: 18, marginTop: -6, marginBottom: 14 }}>
            대표자명과 매장 전화는 아이디(이메일)를 잊으셨을 때 본인 확인에 사용됩니다.
          </Text>

          <View style={{ backgroundColor: '#FFF4ED', borderRadius: 12, padding: 14, marginBottom: 20 }}>
            <Text style={{ fontSize: 12, color: '#B45309', lineHeight: 18 }}>
              가입 후 관리자 승인을 거쳐 판매자로 활성화됩니다. 승인 전에는 일부 기능이 제한될 수 있습니다.
            </Text>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleSignUp}
            disabled={loading}
            style={{ backgroundColor: '#22A06B', borderRadius: 14, paddingVertical: 16, alignItems: 'center', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>회원가입</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
