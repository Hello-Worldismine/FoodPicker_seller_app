// 비밀번호 찾기(재설정) — 6자리 이메일 OTP 방식 2스텝 화면
//
// Step 1: 이메일 입력 → 메일로 6자리 코드 발송
// Step 2: 코드 + 새 비밀번호 입력 → verifyOtp(복구 세션 획득) → updateUser(비밀번호 변경)
//
// ★ verifyOtp 가 성공하면 세션이 생긴다. authStore 의 recovering 플래그(PASSWORD_RECOVERY 수신)
//   와 App.js Gate 최상단 가드가 이 화면을 붙잡아 주지 않으면 화면이 즉시 사라진다.
// ★ 완료 후에는 반드시 signOut() 한다. 그냥 두면 심사중 계정이 PendingApprovalScreen 으로
//   튀어 '비밀번호가 바뀌었다'는 성공 피드백이 묻힌다.
// ★ 중도 이탈(뒤로가기) 시에도 recovering 을 되돌리고, 이미 복구 세션을 얻은 상태라면
//   로그아웃까지 해서 '비밀번호를 바꾸지 않은 채 로그인된' 상태로 남지 않게 한다.
import React, { useEffect, useRef, useState } from 'react';
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
import { useAuth } from '../store/authStore';
import { requestPasswordReset, verifyRecoveryOtp, changePassword } from '../lib/auth';

// Supabase 는 같은 주소에 대한 재발송을 60초 간격으로 제한한다.
const RESEND_COOLDOWN_SEC = 60;

export default function FindPasswordScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { setRecovering } = useAuth();

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // 언마운트 정리에서 최신 값을 읽기 위한 ref(상태는 클로저에 갇힌다)
  const verifiedRef = useRef(false); // 복구 세션을 획득했는가
  const doneRef = useRef(false);     // 비밀번호 변경까지 마쳤는가

  // 재발송 쿨다운 타이머
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // ★ 중도 이탈 방어. 이 화면을 벗어나면 게이트를 원상 복구하고,
  //   비밀번호를 바꾸지 않은 채 얻은 복구 세션은 폐기한다.
  useEffect(() => {
    return () => {
      setRecovering(false);
      if (verifiedRef.current && !doneRef.current) {
        supabase.auth.signOut().catch(() => {});
      }
    };
  }, [setRecovering]);

  async function handleSendCode() {
    const target = email.trim();
    if (!target) {
      Alert.alert('입력 확인', '가입하신 이메일을 입력해주세요.');
      return;
    }
    setLoading(true);
    try {
      await requestPasswordReset(target);
      setCooldown(RESEND_COOLDOWN_SEC);
      setStep(2);
      // 계정 존재 여부를 알려주지 않는다(계정 열거 방지) — 항상 같은 문구.
      Alert.alert(
        '인증코드 발송',
        '입력하신 주소로 6자리 인증코드를 보냈습니다.\n메일함(스팸함 포함)을 확인해주세요.'
      );
    } catch (e) {
      Alert.alert('발송 실패', e.message);
    } finally {
      setLoading(false);
    }
  }

  // 이미 얻은 복구 세션을 폐기하고 처음 상태로 되돌린다(코드 재발송 / 이메일 다시 입력).
  async function discardRecoverySession() {
    if (!verifiedRef.current) return;
    verifiedRef.current = false;
    await supabase.auth.signOut().catch(() => {});
    setRecovering(false);
  }

  async function handleResend() {
    if (cooldown > 0 || loading) return;
    setLoading(true);
    try {
      await discardRecoverySession();
      await requestPasswordReset(email.trim());
      setCode('');
      setCooldown(RESEND_COOLDOWN_SEC);
      Alert.alert('재발송 완료', '인증코드를 다시 보냈습니다.');
    } catch (e) {
      Alert.alert('발송 실패', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    const token = code.trim();
    if (token.length < 6) {
      Alert.alert('입력 확인', '메일로 받은 6자리 인증코드를 입력해주세요.');
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

    setLoading(true);
    try {
      // ① 코드 검증 → 복구 세션 획득(이 시점에 PASSWORD_RECOVERY 발생 → recovering=true)
      //    ★ 인증코드는 1회용이다. ②가 실패해 다시 시도하는 경우 이미 소비된 코드를 다시
      //      검증하면 '만료된 코드' 로 막히므로, 검증에 성공했으면 ①을 건너뛴다.
      if (!verifiedRef.current) {
        await verifyRecoveryOtp(email.trim(), token);
        verifiedRef.current = true;
      }
      setRecovering(true); // 이벤트를 놓치는 경우까지 대비해 명시적으로도 세운다
      // ② 새 비밀번호 적용
      await changePassword(password);
      doneRef.current = true;
      // ③ 로그아웃 → 로그인 화면 복귀.
      //    ★ 순서 주의: recovering 을 먼저 내리면 세션이 아직 살아 있는 한 프레임 동안
      //      Gate 가 앱 본체(심사중 화면 등)로 넘어가 이 화면이 언마운트된다.
      //      signOut 이 발행하는 SIGNED_OUT 이 recovering 과 session 을 동시에 정리해 준다.
      await supabase.auth.signOut();
      setRecovering(false);
      Alert.alert(
        '변경 완료',
        '비밀번호가 변경되었습니다.\n새 비밀번호로 로그인해주세요.',
        [{ text: '확인', onPress: () => navigation.navigate('Login') }]
      );
    } catch (e) {
      Alert.alert('재설정 실패', e.message);
    } finally {
      setLoading(false);
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
        <TouchableOpacity
          onPress={() => {
            if (step !== 2) { navigation.goBack(); return; }
            discardRecoverySession();
            setCode('');
            setStep(1);
          }}
          style={{ marginRight: 10, padding: 4 }}
        >
          <ChevronLeft color="#1F2933" size={24} />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#1F2933' }}>비밀번호 찾기</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 1 ? (
            <>
              <Text style={{ fontSize: 15, color: '#6B7280', lineHeight: 22, marginBottom: 20 }}>
                가입하신 이메일로 6자리 인증코드를 보내드립니다.{'\n'}
                코드를 입력하면 비밀번호를 새로 설정할 수 있습니다.
              </Text>

              <Text style={label}>이메일</Text>
              <TextInput
                style={input}
                placeholder="email@example.com"
                placeholderTextColor="#C4C9D0"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={handleSendCode}
                returnKeyType="send"
              />

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleSendCode}
                disabled={loading}
                style={{ backgroundColor: '#22A06B', borderRadius: 14, paddingVertical: 16, alignItems: 'center', opacity: loading ? 0.7 : 1, marginTop: 6 }}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>인증코드 받기</Text>}
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20, gap: 6 }}>
                <Text style={{ color: '#9AA3AF', fontSize: 14 }}>이메일이 기억나지 않으시나요?</Text>
                <TouchableOpacity onPress={() => navigation.navigate('FindId')}>
                  <Text style={{ color: '#22A06B', fontSize: 14, fontWeight: '700' }}>아이디 찾기</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 15, color: '#6B7280', lineHeight: 22, marginBottom: 20 }}>
                <Text style={{ color: '#1F2933', fontWeight: '700' }}>{email.trim()}</Text>
                {' 로 보낸 6자리 코드를 입력하고\n새 비밀번호를 설정해주세요.'}
              </Text>

              <Text style={label}>인증코드</Text>
              <TextInput
                style={[input, { letterSpacing: 6, fontSize: 20, fontWeight: '700', textAlign: 'center' }]}
                placeholder="000000"
                placeholderTextColor="#C4C9D0"
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={t => setCode(t.replace(/[^0-9]/g, ''))}
              />

              <TouchableOpacity onPress={handleResend} disabled={cooldown > 0 || loading} style={{ alignSelf: 'flex-end', marginTop: -6, marginBottom: 16, padding: 4 }}>
                <Text style={{ color: cooldown > 0 ? '#C4C9D0' : '#22A06B', fontSize: 13, fontWeight: '700' }}>
                  {cooldown > 0 ? `재발송 (${cooldown}초)` : '코드 재발송'}
                </Text>
              </TouchableOpacity>

              <Text style={label}>새 비밀번호</Text>
              <TextInput
                style={input}
                placeholder="6자 이상"
                placeholderTextColor="#C4C9D0"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              <Text style={label}>새 비밀번호 확인</Text>
              <TextInput
                style={input}
                placeholder="비밀번호 재입력"
                placeholderTextColor="#C4C9D0"
                secureTextEntry
                value={passwordConfirm}
                onChangeText={setPasswordConfirm}
                onSubmitEditing={handleReset}
                returnKeyType="done"
              />

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleReset}
                disabled={loading}
                style={{ backgroundColor: '#22A06B', borderRadius: 14, paddingVertical: 16, alignItems: 'center', opacity: loading ? 0.7 : 1, marginTop: 6 }}
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>비밀번호 변경</Text>}
              </TouchableOpacity>

              <View style={{ backgroundColor: '#FFF4ED', borderRadius: 12, padding: 14, marginTop: 20 }}>
                <Text style={{ fontSize: 12, color: '#B45309', lineHeight: 18 }}>
                  메일이 오지 않으면 스팸함을 확인해주세요. 인증코드는 일정 시간이 지나면 만료되며,
                  만료된 경우 [코드 재발송]으로 새 코드를 받을 수 있습니다.
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
