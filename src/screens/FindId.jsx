// 아이디 찾기 — 판매자 로그인 아이디는 '가입 이메일'이다.
//
// 본인확인(대표자명 + 사업자등록번호) 후 **마스킹된 이메일**만 알려준다.
// 전체 이메일을 그대로 주면 이름+번호만으로 타인 계정을 수집할 수 있다(계정 열거).
//
// ★ 확인 인자는 사업자등록번호 하나로 고정한다. '매장 전화' 는 쓰지 않는다 —
//   매장 전화번호는 public_stores 뷰로 로그인 없이 누구나 조회 가능한 공개 값이라
//   본인확인 인자가 되지 못한다(2요소처럼 보이지만 실제로는 대표자명 1요소).
//   사업자등록번호는 공개 뷰에 없고, 승인 매장의 값은 관리자가 서류로 검증한 것이라 신뢰도가 높다.
// ★ 서버(find_email_by_seller)는 '일치하는 계정 없음'을 예외가 아니라 null 로 돌려준다.
//   화면도 존재 여부를 유추할 수 있는 힌트를 주지 않고 단일 문구로만 안내한다.
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
import { findMySellerEmail } from '../lib/api';
import { formatBizNumber } from '../lib/format';

export default function FindIdScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [ownerName, setOwnerName] = useState('');
  const [bizNumber, setBizNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);   // 마스킹 이메일
  const [notFound, setNotFound] = useState(false);

  async function handleFind() {
    const name = ownerName.trim();
    if (!name) {
      Alert.alert('입력 확인', '대표자명을 입력해주세요.');
      return;
    }
    const bizDigits = bizNumber.replace(/[^0-9]/g, '');
    if (bizDigits.length !== 10) {
      Alert.alert('입력 확인', '사업자등록번호 10자리를 입력해주세요.');
      return;
    }

    setLoading(true);
    setResult(null);
    setNotFound(false);
    try {
      const email = await findMySellerEmail(name, { bizNumber: bizDigits });
      if (email) setResult(email);
      else setNotFound(true);
    } catch (e) {
      Alert.alert('조회 실패', e.message);
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
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 10, padding: 4 }}>
          <ChevronLeft color="#1F2933" size={24} />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#1F2933' }}>아이디 찾기</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={{ fontSize: 15, color: '#6B7280', lineHeight: 22, marginBottom: 20 }}>
            판매자 아이디는 <Text style={{ color: '#1F2933', fontWeight: '700' }}>가입하신 이메일 주소</Text>입니다.{'\n'}
            매장 정보로 본인 확인 후 일부를 가린 형태로 알려드립니다.
          </Text>

          {/* ⚠️ '매장 전화' 탭은 의도적으로 제거했다. 되살리지 말 것.
              매장 전화번호는 public_stores 뷰로 **로그인 없이 누구나 조회할 수 있는 공개 값**이다
              (20260710000000_consumer.sql / 20260728000000 의 뷰 정의).
              그 값을 본인확인 인자로 쓰면 2요소처럼 보이지만 실제로는 대표자명 하나뿐인 1요소가 되고,
              공격자가 전 매장의 전화번호를 덤프한 뒤 대표자명만 대입하면
              '이 매장 대표자 성명 확인 + 마스킹 이메일' 을 수집할 수 있다(판매자 표적 피싱 재료).
              사업자등록번호는 공개 뷰에 없고 승인 매장의 경우 관리자가 서류로 검증한 값이라 안전하다. */}
          <Text style={label}>대표자명</Text>
          <TextInput
            style={input}
            placeholder="가입 시 입력한 대표자 성명"
            placeholderTextColor="#C4C9D0"
            value={ownerName}
            onChangeText={setOwnerName}
          />

          <Text style={label}>사업자등록번호</Text>
          <TextInput
            style={input}
            placeholder="123-45-67890"
            placeholderTextColor="#C4C9D0"
            keyboardType="number-pad"
            maxLength={12}
            value={bizNumber}
            onChangeText={t => setBizNumber(formatBizNumber(t))}
            onSubmitEditing={handleFind}
            returnKeyType="search"
          />

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleFind}
            disabled={loading}
            style={{ backgroundColor: '#22A06B', borderRadius: 14, paddingVertical: 16, alignItems: 'center', opacity: loading ? 0.7 : 1, marginTop: 6 }}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>아이디 찾기</Text>}
          </TouchableOpacity>

          {/* 결과 */}
          {result && (
            <View style={{ backgroundColor: '#E9F8F1', borderRadius: 12, padding: 18, marginTop: 20, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: '#6B7280', marginBottom: 8 }}>가입하신 아이디(이메일)</Text>
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#1F2933', letterSpacing: 0.5 }}>{result}</Text>
              <Text style={{ fontSize: 12, color: '#9AA3AF', marginTop: 8, textAlign: 'center', lineHeight: 18 }}>
                개인정보 보호를 위해 일부를 가려서 보여드립니다.
              </Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('FindPassword')}
                style={{ marginTop: 14, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#22A06B' }}
              >
                <Text style={{ color: '#22A06B', fontWeight: '700', fontSize: 14 }}>비밀번호도 잊으셨나요?</Text>
              </TouchableOpacity>
            </View>
          )}

          {notFound && (
            <View style={{ backgroundColor: '#FFF0F0', borderRadius: 12, padding: 16, marginTop: 20 }}>
              <Text style={{ fontSize: 14, color: '#E5484D', fontWeight: '700', marginBottom: 6 }}>
                일치하는 계정이 없습니다
              </Text>
              <Text style={{ fontSize: 12, color: '#B45309', lineHeight: 18 }}>
                가입 시 입력한 대표자명과 매장 정보가 정확한지 확인해주세요.
                매장 정보를 아직 등록하지 않았다면 조회되지 않을 수 있습니다.
                계속 찾을 수 없다면 고객센터로 문의해주세요.
              </Text>
            </View>
          )}

          <View style={{ backgroundColor: '#F5F6F7', borderRadius: 12, padding: 14, marginTop: 20 }}>
            <Text style={{ fontSize: 12, color: '#9AA3AF', lineHeight: 18 }}>
              무단 조회를 막기 위해 조회 횟수가 제한됩니다. 여러 번 실패했다면 잠시 후 다시 시도해주세요.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
