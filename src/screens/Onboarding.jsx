import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Image, Platform, Modal, Alert, ActivityIndicator, Switch,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { Camera, ChevronLeft, MapPin, LogOut, Store as StoreIcon, Clock } from 'lucide-react-native';
import { useApp } from '../store/appStore';
import { useAuth } from '../store/authStore';
import * as api from '../lib/api';
import { uploadImageIfLocal } from '../lib/storage';
import DaumPostcodeModal from '../components/DaumPostcodeModal';

const CATEGORIES = ['한식', '일식', '중식', '양식', '분식', '카페/베이커리', '패스트푸드', '기타'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };
const TOTAL_STEPS = 6;

const STEP_META = {
  1: { title: '매장 기본 정보', sub: '매장명, 연락처, 카테고리를 설정해주세요' },
  2: { title: '매장 소개', sub: '고객에게 보여줄 사진과 소개글을 등록해주세요' },
  3: { title: '영업 시간', sub: '운영하는 요일과 시간을 설정해주세요' },
  4: { title: '사업자 정보', sub: '대표자 및 사업자 정보를 입력해주세요' },
  5: { title: '매장 주소', sub: '고객이 방문할 매장 위치를 입력해주세요' },
  6: { title: '정산 계좌', sub: '판매 수익을 정산받을 계좌를 입력해주세요' },
};

function parseTimeToDate(t) {
  const [h, m] = (t || '09:00').split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0); return d;
}
function formatDateToTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function formatBizNum(raw) {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}
function formatPhone(raw) {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

const defaultDays = () => ({
  mon: { open: '09:00', close: '21:00', isOpen: true },
  tue: { open: '09:00', close: '21:00', isOpen: true },
  wed: { open: '09:00', close: '21:00', isOpen: true },
  thu: { open: '09:00', close: '21:00', isOpen: true },
  fri: { open: '09:00', close: '21:00', isOpen: true },
  sat: { open: '09:00', close: '21:00', isOpen: true },
  sun: { open: '09:00', close: '21:00', isOpen: false },
});

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { reload } = useApp();
  const { user, signOut } = useAuth();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showPendingModal, setShowPendingModal] = useState(false);

  // Step 1
  const [name, setName] = useState(user?.user_metadata?.store_name || '');
  const [phone, setPhone] = useState(user?.user_metadata?.phone || '');
  const [category, setCategory] = useState('');

  // Step 2
  const [storeImage, setStoreImage] = useState(null);
  const [description, setDescription] = useState('');

  // Step 3
  const [days, setDays] = useState(defaultDays);
  const [timePicker, setTimePicker] = useState(null);
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [timePickerValue, setTimePickerValue] = useState(new Date());

  // Step 4
  const [ownerName, setOwnerName] = useState(user?.user_metadata?.owner_name || '');
  const [bizNumber, setBizNumber] = useState('');
  const [bizCertFile, setBizCertFile] = useState(null);
  const [residentFront, setResidentFront] = useState('');
  const [residentBack, setResidentBack] = useState('');
  const residentBackRef = useRef(null);

  // Step 5
  const [address, setAddress] = useState('');
  const [showPostcode, setShowPostcode] = useState(false);

  // Step 6
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState('');

  const canGoNext = () => {
    if (step === 1) return name.trim().length > 0 && phone.trim().length > 0 && category.length > 0;
    if (step === 2) return true;
    if (step === 3) return true;
    if (step === 4) return ownerName.trim().length > 0 && bizNumber.replace(/\D/g, '').length >= 10;
    if (step === 5) return address.trim().length > 0;
    if (step === 6) return !!(bankName.trim() && accountNumber.trim() && accountHolder.trim());
    return true;
  };

  async function pickImage(setter) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '사진 라이브러리 접근 권한이 필요합니다.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) setter(result.assets[0].uri);
  }

  function openTimePicker(dayKey, field) {
    setTimePicker({ dayKey, field });
    setTimePickerValue(parseTimeToDate(days[dayKey][field]));
    setTimePickerVisible(true);
  }

  function handleTimeChange(_, date) {
    if (Platform.OS === 'android') setTimePickerVisible(false);
    if (!date || !timePicker) return;
    setTimePickerValue(date);
    setDays(prev => ({
      ...prev,
      [timePicker.dayKey]: { ...prev[timePicker.dayKey], [timePicker.field]: formatDateToTime(date) },
    }));
  }

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await api.provisionMyStore();

      const storeImageUrl = storeImage ? await uploadImageIfLocal(storeImage, null, 'store') : null;
      const bizCertUrl = bizCertFile ? await uploadImageIfLocal(bizCertFile, null, 'documents') : null;
      const closedDays = DAY_KEYS.filter(k => !days[k].isOpen);

      await api.updateStoreRow(api.storeToDb({
        name: name.trim(),
        phone: phone.trim(),
        category,
        description: description.trim(),
        storeImage: storeImageUrl,
        ownerName: ownerName.trim(),
        bizNumber,
        bizCertImage: bizCertUrl,
        residentNumber: residentFront && residentBack ? `${residentFront}-${residentBack}` : undefined,
        address: address.trim(),
        bankName: bankName.trim(),
        accountNumber: accountNumber.trim(),
        accountHolder: accountHolder.trim(),
        openHours: { days },
        closedDays,
        isSellingPaused: false,
        tags: [],
      }));

      setShowPendingModal(true);
    } catch (e) {
      Alert.alert('오류', e.message || '등록 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  const S = {
    label: { fontSize: 14, fontWeight: '700', color: '#1F2933', marginBottom: 8 },
    input: {
      backgroundColor: '#F5F6F7',
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 15,
      color: '#1F2933',
    },
  };

  // ── Welcome screen (step 0) ──
  if (step === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top, paddingBottom: insets.bottom + 20 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <View style={{
            width: 108, height: 108, borderRadius: 54,
            backgroundColor: '#E9F8F1',
            alignItems: 'center', justifyContent: 'center', marginBottom: 32,
          }}>
            <StoreIcon color="#22A06B" size={52} />
          </View>
          <Text style={{ fontSize: 28, fontWeight: '800', color: '#1F2933', textAlign: 'center', lineHeight: 36, marginBottom: 14 }}>
            매장 정보를{'\n'}입력해볼게요
          </Text>
          <Text style={{ fontSize: 15, color: '#6B7280', textAlign: 'center', lineHeight: 24 }}>
            고객에게 보여줄 매장 정보를{'\n'}순서대로 입력하면 입점 신청을{'\n'}완료할 수 있어요.
          </Text>
        </View>
        <View style={{ paddingHorizontal: 20, gap: 10 }}>
          <TouchableOpacity
            onPress={() => setStep(1)}
            style={{ backgroundColor: '#22A06B', borderRadius: 14, paddingVertical: 17, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>시작하기</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={signOut}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 6 }}
          >
            <LogOut color="#C4C9D0" size={15} />
            <Text style={{ color: '#9AA3AF', fontSize: 14 }}>다른 계정으로 로그인</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Step content renderer ──
  function renderContent() {
    switch (step) {
      // Step 1: 매장 기본 정보
      case 1: return (
        <View style={{ gap: 20 }}>
          <View>
            <Text style={S.label}>매장명 *</Text>
            <TextInput
              style={S.input}
              value={name}
              onChangeText={setName}
              placeholder="예: 그린샐러드 강남점"
              placeholderTextColor="#C4C9D0"
            />
          </View>
          <View>
            <Text style={S.label}>대표 연락처 *</Text>
            <TextInput
              style={S.input}
              value={phone}
              onChangeText={t => setPhone(formatPhone(t))}
              placeholder="02-1234-5678"
              placeholderTextColor="#C4C9D0"
              keyboardType="phone-pad"
            />
          </View>
          <View>
            <Text style={S.label}>카테고리 *</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CATEGORIES.map(cat => {
                const active = category === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => setCategory(cat)}
                    style={{
                      paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
                      backgroundColor: active ? '#E9F8F1' : '#F5F6F7',
                      borderWidth: active ? 1.5 : 0,
                      borderColor: active ? '#22A06B' : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '600', color: active ? '#22A06B' : '#6B7280' }}>{cat}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      );

      // Step 2: 매장 소개
      case 2: return (
        <View style={{ gap: 20 }}>
          <View>
            <Text style={S.label}>매장 대표 사진</Text>
            <TouchableOpacity
              onPress={() => pickImage(setStoreImage)}
              style={{
                height: 200, borderRadius: 16, overflow: 'hidden',
                backgroundColor: '#F5F6F7', alignItems: 'center', justifyContent: 'center',
                borderWidth: storeImage ? 0 : 2, borderStyle: 'dashed', borderColor: '#D1D5DB',
              }}
            >
              {storeImage ? (
                <>
                  <Image source={{ uri: storeImage }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  <View style={{ position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
                    <Text style={{ color: '#fff', fontSize: 12 }}>변경</Text>
                  </View>
                </>
              ) : (
                <View style={{ alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' }}>
                    <Camera color="#9AA3AF" size={26} />
                  </View>
                  <Text style={{ color: '#9AA3AF', fontSize: 14 }}>사진을 선택해주세요</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
          <View>
            <Text style={S.label}>매장 소개</Text>
            <TextInput
              style={{ ...S.input, height: 110, textAlignVertical: 'top', paddingTop: 14 }}
              value={description}
              onChangeText={setDescription}
              placeholder="고객에게 전달하고 싶은 매장 소개글을 입력해주세요"
              placeholderTextColor="#C4C9D0"
              multiline
              numberOfLines={4}
            />
          </View>
        </View>
      );

      // Step 3: 영업 시간
      case 3: return (
        <View style={{ backgroundColor: '#fff', borderRadius: 16 }}>
          {DAY_KEYS.map((key, idx) => {
            const day = days[key];
            return (
              <View
                key={key}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingVertical: 14, paddingHorizontal: 4,
                  borderBottomWidth: idx < 6 ? 1 : 0,
                  borderBottomColor: '#F3F4F6',
                }}
              >
                <Text style={{ width: 28, fontSize: 15, fontWeight: '700', color: day.isOpen ? '#1F2933' : '#C4C9D0' }}>
                  {DAY_LABELS[key]}
                </Text>
                {day.isOpen ? (
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 10 }}>
                    <TouchableOpacity
                      onPress={() => openTimePicker(key, 'open')}
                      style={{ backgroundColor: '#F5F6F7', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '600', color: '#1F2933' }}>{day.open}</Text>
                    </TouchableOpacity>
                    <Text style={{ color: '#C4C9D0', fontSize: 13 }}>~</Text>
                    <TouchableOpacity
                      onPress={() => openTimePicker(key, 'close')}
                      style={{ backgroundColor: '#F5F6F7', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '600', color: '#1F2933' }}>{day.close}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={{ flex: 1, color: '#C4C9D0', fontSize: 14, marginHorizontal: 10 }}>휴무</Text>
                )}
                <Switch
                  value={day.isOpen}
                  onValueChange={v => setDays(prev => ({ ...prev, [key]: { ...prev[key], isOpen: v } }))}
                  trackColor={{ false: '#E0E0E0', true: '#22A06B' }}
                  thumbColor="#fff"
                />
              </View>
            );
          })}
        </View>
      );

      // Step 4: 사업자 정보
      case 4: return (
        <View style={{ gap: 20 }}>
          <View>
            <Text style={S.label}>대표자명 *</Text>
            <TextInput
              style={S.input}
              value={ownerName}
              onChangeText={setOwnerName}
              placeholder="대표자 성명"
              placeholderTextColor="#C4C9D0"
            />
          </View>
          <View>
            <Text style={S.label}>사업자등록번호 *</Text>
            <TextInput
              style={S.input}
              value={bizNumber}
              onChangeText={t => setBizNumber(formatBizNum(t))}
              placeholder="000-00-00000"
              placeholderTextColor="#C4C9D0"
              keyboardType="numeric"
            />
          </View>
          <View>
            <Text style={S.label}>사업자등록증 사진</Text>
            <TouchableOpacity
              onPress={() => pickImage(setBizCertFile)}
              style={{
                height: 140, borderRadius: 12, overflow: 'hidden',
                backgroundColor: '#F5F6F7', alignItems: 'center', justifyContent: 'center',
                borderWidth: 2, borderStyle: 'dashed', borderColor: '#D1D5DB',
              }}
            >
              {bizCertFile ? (
                <>
                  <Image source={{ uri: bizCertFile }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  <View style={{ position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: '#fff', fontSize: 11 }}>변경</Text>
                  </View>
                </>
              ) : (
                <View style={{ alignItems: 'center', gap: 8 }}>
                  <Camera color="#9AA3AF" size={24} />
                  <Text style={{ color: '#9AA3AF', fontSize: 14 }}>사업자등록증 사진 선택</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
          <View>
            <Text style={S.label}>대표자 주민등록번호</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                style={{ ...S.input, flex: 1 }}
                value={residentFront}
                onChangeText={t => {
                  const digits = t.replace(/\D/g, '').slice(0, 6);
                  setResidentFront(digits);
                  if (digits.length === 6) {
                    residentBackRef.current?.focus();
                  }
                }}
                placeholder="앞 6자리"
                placeholderTextColor="#C4C9D0"
                keyboardType="numeric"
                maxLength={6}
                returnKeyType="next"
              />
              <Text style={{ color: '#9AA3AF', fontSize: 18 }}>-</Text>
              <TextInput
                ref={residentBackRef}
                style={{ ...S.input, width: 52 }}
                value={residentBack}
                onChangeText={t => setResidentBack(t.replace(/\D/g, '').slice(0, 1))}
                placeholder="1"
                placeholderTextColor="#C4C9D0"
                keyboardType="numeric"
                maxLength={1}
                secureTextEntry
              />
              <Text style={{ color: '#C4C9D0', fontSize: 14, letterSpacing: 3 }}>●●●●●●</Text>
            </View>
          </View>
        </View>
      );

      // Step 5: 매장 주소
      case 5: return (
        <View style={{ gap: 16 }}>
          <TouchableOpacity
            onPress={() => setShowPostcode(true)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              backgroundColor: '#F5F6F7', borderRadius: 14, padding: 18,
            }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#E9F8F1', alignItems: 'center', justifyContent: 'center' }}>
              <MapPin color="#22A06B" size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, color: '#9AA3AF', marginBottom: 2 }}>매장 주소 *</Text>
              <Text style={{ fontSize: 15, color: address ? '#1F2933' : '#C4C9D0', fontWeight: address ? '600' : '400' }}>
                {address || '주소를 검색해주세요'}
              </Text>
            </View>
            <View style={{ backgroundColor: '#22A06B', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>검색</Text>
            </View>
          </TouchableOpacity>
          {address ? (
            <View style={{ backgroundColor: '#E9F8F1', borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Text style={{ fontSize: 18 }}>📍</Text>
              <Text style={{ flex: 1, fontSize: 14, color: '#1F2933', lineHeight: 22 }}>{address}</Text>
            </View>
          ) : (
            <View style={{ backgroundColor: '#F5F6F7', borderRadius: 12, padding: 16, alignItems: 'center' }}>
              <Text style={{ color: '#9AA3AF', fontSize: 13, lineHeight: 20, textAlign: 'center' }}>
                도로명 주소 또는 지번 주소로{'\n'}검색하실 수 있습니다.
              </Text>
            </View>
          )}
        </View>
      );

      // Step 6: 정산 계좌
      case 6: return (
        <View style={{ gap: 20 }}>
          <View style={{ backgroundColor: '#FFF8ED', borderRadius: 12, padding: 14 }}>
            <Text style={{ fontSize: 12, color: '#B45309', lineHeight: 18 }}>
              정산 금액은 매주 수요일에 등록된 계좌로 입금됩니다.{'\n'}정확한 계좌 정보를 입력해주세요.
            </Text>
          </View>
          <View>
            <Text style={S.label}>은행명 *</Text>
            <TextInput
              style={S.input}
              value={bankName}
              onChangeText={setBankName}
              placeholder="예: 국민은행"
              placeholderTextColor="#C4C9D0"
            />
          </View>
          <View>
            <Text style={S.label}>계좌번호 *</Text>
            <TextInput
              style={S.input}
              value={accountNumber}
              onChangeText={t => setAccountNumber(t.replace(/[^0-9-]/g, ''))}
              placeholder="숫자만 입력"
              placeholderTextColor="#C4C9D0"
              keyboardType="numeric"
            />
          </View>
          <View>
            <Text style={S.label}>예금주 *</Text>
            <TextInput
              style={S.input}
              value={accountHolder}
              onChangeText={setAccountHolder}
              placeholder="예금주명"
              placeholderTextColor="#C4C9D0"
            />
          </View>
        </View>
      );

      default: return null;
    }
  }

  const meta = STEP_META[step] || {};
  const isLastStep = step === TOTAL_STEPS;
  const progressPct = `${Math.round((step / TOTAL_STEPS) * 100)}%`;
  const nextEnabled = canGoNext() && !submitting;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#fff' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 20, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
          <TouchableOpacity
            onPress={() => step > 1 && setStep(s => s - 1)}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: 10, opacity: step > 1 ? 1 : 0 }}
            pointerEvents={step > 1 ? 'auto' : 'none'}
          >
            <ChevronLeft color="#1F2933" size={24} />
          </TouchableOpacity>
          <View style={{ flex: 1, height: 4, backgroundColor: '#F0F0F0', borderRadius: 2 }}>
            <View style={{ height: 4, borderRadius: 2, backgroundColor: '#22A06B', width: progressPct }} />
          </View>
          <Text style={{ fontSize: 13, color: '#9AA3AF', fontWeight: '600', marginLeft: 12, minWidth: 30, textAlign: 'right' }}>
            {step}/{TOTAL_STEPS}
          </Text>
        </View>
        <Text style={{ fontSize: 26, fontWeight: '800', color: '#1F2933', lineHeight: 34 }}>{meta.title}</Text>
        <Text style={{ fontSize: 14, color: '#9AA3AF', marginTop: 6, lineHeight: 20 }}>{meta.sub}</Text>
      </View>

      {/* Scrollable content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {renderContent()}
      </ScrollView>

      {/* Bottom CTA */}
      <View style={{
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: insets.bottom + 14,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        backgroundColor: '#fff',
      }}>
        <TouchableOpacity
          onPress={isLastStep ? handleSubmit : () => setStep(s => s + 1)}
          disabled={!nextEnabled}
          activeOpacity={0.85}
          style={{
            borderRadius: 14,
            paddingVertical: 17,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            backgroundColor: nextEnabled ? '#22A06B' : '#E5E7EB',
          }}
        >
          {submitting && <ActivityIndicator color="#fff" size="small" />}
          <Text style={{
            fontSize: 17,
            fontWeight: '800',
            color: nextEnabled ? '#fff' : '#9AA3AF',
          }}>
            {submitting ? '신청 중…' : isLastStep ? '입점 신청하기' : '다음'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Daum 주소 검색 */}
      <DaumPostcodeModal
        visible={showPostcode}
        onClose={() => setShowPostcode(false)}
        onSelect={addr => { setAddress(addr); setShowPostcode(false); }}
      />

      {/* 입점 신청 완료 모달 */}
      <Modal visible={showPendingModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 28, width: '100%', alignItems: 'center' }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFF8ED', alignItems: 'center', justifyContent: 'center', marginBottom: 18 }}>
              <Clock color="#FF8A3D" size={30} />
            </View>
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#1F2933', marginBottom: 10, textAlign: 'center' }}>
              입점 신청이 완료되었습니다
            </Text>
            <Text style={{ fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
              입점 검토까지 약 1~2일이 소요됩니다.{'\n'}승인 완료 시 모든 서비스를 이용하실 수 있습니다.
            </Text>
            <TouchableOpacity
              onPress={() => reload()}
              style={{ backgroundColor: '#22A06B', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40, width: '100%', alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Time picker */}
      {timePickerVisible && (
        Platform.OS === 'ios' ? (
          <Modal visible transparent animationType="slide">
            <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
              <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: insets.bottom }}>
                <View style={{
                  flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                  paddingHorizontal: 20, paddingVertical: 14,
                  borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
                }}>
                  <TouchableOpacity onPress={() => setTimePickerVisible(false)}>
                    <Text style={{ color: '#6B7280', fontSize: 15 }}>취소</Text>
                  </TouchableOpacity>
                  <Text style={{ fontWeight: '700', color: '#1F2933', fontSize: 16 }}>시간 선택</Text>
                  <TouchableOpacity onPress={() => setTimePickerVisible(false)}>
                    <Text style={{ color: '#22A06B', fontWeight: '700', fontSize: 15 }}>확인</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={timePickerValue}
                  mode="time"
                  display="spinner"
                  onChange={handleTimeChange}
                  locale="ko-KR"
                />
              </View>
            </View>
          </Modal>
        ) : (
          <DateTimePicker
            value={timePickerValue}
            mode="time"
            display="default"
            onChange={handleTimeChange}
          />
        )
      )}
    </KeyboardAvoidingView>
  );
}
