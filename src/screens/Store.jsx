import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Image,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Switch,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../store/appStore';
import { useAuth } from '../store/authStore';
import { uploadImageIfLocal } from '../lib/storage';
import { formatPhone } from '../lib/format';
import DaumPostcodeModal from '../components/DaumPostcodeModal';
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Camera,
  Edit2,
  Star,
  Phone,
  MapPin,
  Building2,
  Clock,
  CreditCard,
  FileText,
  Bell,
  HelpCircle,
  LogOut,
  X,
  Plus,
  Check,
  Eye,
  Navigation,
  MessageSquare,
  Heart,
  Ticket,
} from 'lucide-react-native';

const APPROVAL_CONFIG = {
  approved: { label: '입점 승인', color: '#22A06B', bg: '#E9F8F1' },
  pending:  { label: '심사 중',  color: '#FF8A3D', bg: '#FFF4ED' },
  rejected: { label: '승인 거절', color: '#E5484D', bg: '#FFF0F0' },
};

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };

function formatBizNum(raw) {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

function maskResident(rn) {
  if (!rn) return '';
  const [front = '', back = ''] = rn.split('-');
  return `${front}-${back}●●●●●●`;
}

function formatTime(timeStr) {
  return timeStr || '00:00';
}

function parseTimeToDate(timeStr) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function formatDateFromDate(date) {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

// ─── AdminEditScreen (Modal) ───────────────────────────────────
function AdminEditScreen({ visible, onClose, storeInfo, setStoreInfo }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(storeInfo.name);
  const [bizNumber, setBizNumber] = useState(storeInfo.bizNumber);
  const [bizCertFile, setBizCertFile] = useState(null);
  const [showBizUpload, setShowBizUpload] = useState(false);
  const [residentFront, setResidentFront] = useState(storeInfo.residentNumber?.split('-')[0] || '');
  const [residentBack, setResidentBack] = useState(storeInfo.residentNumber?.split('-')[1] || '');
  const [address, setAddress] = useState(storeInfo.address);
  const [showPostcode, setShowPostcode] = useState(false);
  const [bankName, setBankName] = useState(storeInfo.bankName);
  const [accountNumber, setAccountNumber] = useState(storeInfo.accountNumber);
  const [accountHolder, setAccountHolder] = useState(storeInfo.accountHolder);
  const [changeReason, setChangeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const originalBiz = storeInfo.bizNumber;
  const bizChanged = bizNumber !== originalBiz;

  const canSubmit = changeReason.trim().length > 0 && (!bizChanged || bizCertFile);

  async function pickBizCert() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('권한 필요', '사진 접근 권한이 필요합니다.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      setBizCertFile(result.assets[0].uri);
    }
  }

  function handleBizNumberChange(text) {
    const formatted = formatBizNum(text);
    setBizNumber(formatted);
    setShowBizUpload(formatted !== originalBiz);
  }

  // 변경 신청: 허용 컬럼은 setStoreInfo가 storeToDb→updateStoreRow로 DB 영속.
  // 사업자등록증 이미지는 Storage 업로드 후 URL만 저장. approval_status는 판매자 쓰기 잠금이라
  // storeToDb가 자동 제외 → 로컬 '심사중' 표시만 되고 실제 pending 전환은 서버 승인 워크플로(§9) 담당.
  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      let bizCertImage = storeInfo.bizCertImage;
      if (bizChanged && bizCertFile) {
        bizCertImage = await uploadImageIfLocal(bizCertFile, null, 'documents');
      }
      setStoreInfo(prev => ({
        ...prev,
        name,
        bizNumber,
        residentNumber: `${residentFront}-${residentBack}`,
        address,
        bankName,
        accountNumber,
        accountHolder,
        bizCertImage,
        approvalStatus: 'pending', // 낙관적 UI(로컬). DB에는 컬럼 잠금으로 반영되지 않음.
      }));
      Alert.alert('신청 완료', '변경 신청이 접수되었습니다.\n관리자 검토 후 승인됩니다.', [
        { text: '확인', onPress: onClose },
      ]);
    } catch (e) {
      Alert.alert('오류', e.message || '제출 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    // Reset
    setName(storeInfo.name);
    setBizNumber(storeInfo.bizNumber);
    setBizCertFile(null);
    setShowBizUpload(false);
    setResidentFront(storeInfo.residentNumber?.split('-')[0] || '');
    setResidentBack(storeInfo.residentNumber?.split('-')[1] || '');
    setAddress(storeInfo.address);
    setBankName(storeInfo.bankName);
    setAccountNumber(storeInfo.accountNumber);
    setAccountHolder(storeInfo.accountHolder);
    setChangeReason('');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View className="flex-1 bg-softgray">
        {/* Header */}
        <View
          className="bg-white px-4 pb-3 border-b border-gray-100 flex-row items-center justify-between"
          style={{ paddingTop: insets.top + 16 }}
        >
          <TouchableOpacity onPress={handleClose} className="p-1">
            <X color="#1F2933" size={22} />
          </TouchableOpacity>
          <Text className="text-lg font-bold text-charcoal">정보 변경 신청</Text>
          <View className="w-8" />
        </View>

        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <View className="mx-4 mt-3 bg-orange/10 border border-orange/20 rounded-xl p-3 mb-2">
              <Text className="text-orange text-xs leading-4">
                이 정보는 관리자 승인이 필요합니다. 변경 시 심사 중 상태로 전환됩니다.
              </Text>
            </View>

            {/* Store Name */}
            <View className="mx-4 mb-3">
              <Text className="text-sm font-bold text-charcoal mb-2">매장명</Text>
              <TextInput
                className="bg-white rounded-xl px-4 py-3 text-charcoal border border-gray-100"
                value={name}
                onChangeText={setName}
                placeholder="매장명"
                placeholderTextColor="#9AA3AF"
              />
            </View>

            {/* Biz Number */}
            <View className="mx-4 mb-3">
              <Text className="text-sm font-bold text-charcoal mb-2">사업자등록번호</Text>
              <TextInput
                className="bg-white rounded-xl px-4 py-3 text-charcoal border border-gray-100"
                value={bizNumber}
                onChangeText={handleBizNumberChange}
                placeholder="000-00-00000"
                placeholderTextColor="#9AA3AF"
                keyboardType="numeric"
              />
              {showBizUpload && (
                <View className="mt-2">
                  <Text className="text-xs text-orange mb-1.5">
                    사업자등록번호 변경 시 사업자등록증 재업로드가 필요합니다
                  </Text>
                  <TouchableOpacity
                    onPress={pickBizCert}
                    className="border-2 border-dashed border-orange/40 rounded-xl p-4 items-center"
                    style={{ backgroundColor: '#FFF8F4' }}
                  >
                    {bizCertFile ? (
                      <View className="items-center">
                        <Image source={{ uri: bizCertFile }} className="w-full h-32 rounded-lg" resizeMode="cover" />
                        <Text className="text-primary text-xs mt-2">탭하여 다시 선택</Text>
                      </View>
                    ) : (
                      <View className="items-center">
                        <Camera color="#FF8A3D" size={24} />
                        <Text className="text-orange text-sm mt-1.5 font-semibold">사업자등록증 업로드</Text>
                        <Text className="text-gray-400 text-xs mt-0.5">이미지 파일 선택</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Resident Number */}
            <View className="mx-4 mb-3">
              <Text className="text-sm font-bold text-charcoal mb-2">대표자 주민등록번호</Text>
              <View className="flex-row gap-2 items-center">
                <TextInput
                  className="flex-1 bg-white rounded-xl px-4 py-3 text-charcoal border border-gray-100"
                  value={residentFront}
                  onChangeText={t => setResidentFront(t.replace(/\D/g, '').slice(0, 6))}
                  placeholder="앞 6자리"
                  placeholderTextColor="#9AA3AF"
                  keyboardType="numeric"
                  maxLength={6}
                />
                <Text className="text-gray-400 text-lg">-</Text>
                <TextInput
                  className="w-20 bg-white rounded-xl px-4 py-3 text-charcoal border border-gray-100"
                  value={residentBack}
                  onChangeText={t => setResidentBack(t.replace(/\D/g, '').slice(0, 1))}
                  placeholder="1자리"
                  placeholderTextColor="#9AA3AF"
                  keyboardType="numeric"
                  maxLength={1}
                  secureTextEntry
                />
              </View>
            </View>

            {/* Address */}
            <View className="mx-4 mb-3">
              <Text className="text-sm font-bold text-charcoal mb-2">매장 주소</Text>
              <TouchableOpacity
                className="bg-white rounded-xl px-4 py-3 flex-row items-center gap-2 border border-gray-100"
                onPress={() => setShowPostcode(true)}
              >
                <MapPin color="#9AA3AF" size={16} />
                <Text className={address ? 'text-charcoal flex-1' : 'text-gray-400 flex-1'}>
                  {address || '주소를 검색하세요'}
                </Text>
                <Text className="text-primary text-sm font-semibold">검색</Text>
              </TouchableOpacity>
            </View>

            {/* Bank Info */}
            <View className="mx-4 mb-3 bg-white rounded-xl p-4" style={{ elevation: 1 }}>
              <Text className="text-sm font-bold text-charcoal mb-3">계좌 정보</Text>
              <View className="mb-2">
                <Text className="text-xs text-gray-500 mb-1">은행명</Text>
                <TextInput
                  className="bg-softgray rounded-lg px-3 py-2.5 text-charcoal"
                  value={bankName}
                  onChangeText={setBankName}
                  placeholder="예: 국민은행"
                  placeholderTextColor="#9AA3AF"
                />
              </View>
              <View className="mb-2">
                <Text className="text-xs text-gray-500 mb-1">계좌번호</Text>
                <TextInput
                  className="bg-softgray rounded-lg px-3 py-2.5 text-charcoal"
                  value={accountNumber}
                  onChangeText={t => setAccountNumber(t.replace(/[^0-9-]/g, ''))}
                  placeholder="계좌번호 (숫자와 하이픈)"
                  placeholderTextColor="#9AA3AF"
                  keyboardType="numeric"
                />
              </View>
              <View>
                <Text className="text-xs text-gray-500 mb-1">예금주</Text>
                <TextInput
                  className="bg-softgray rounded-lg px-3 py-2.5 text-charcoal"
                  value={accountHolder}
                  onChangeText={setAccountHolder}
                  placeholder="예금주명"
                  placeholderTextColor="#9AA3AF"
                />
              </View>
            </View>

            {/* Change Reason */}
            <View className="mx-4 mb-3">
              <Text className="text-sm font-bold text-charcoal mb-2">변경 사유 *</Text>
              <TextInput
                className="bg-white rounded-xl px-4 py-3 text-charcoal border border-gray-100"
                value={changeReason}
                onChangeText={setChangeReason}
                placeholder="변경 사유를 입력해주세요"
                placeholderTextColor="#9AA3AF"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            <View className="h-20" />
          </ScrollView>

          {/* Submit Button */}
          <View
            className="bg-white border-t border-gray-100 px-4 py-3"
            style={{ paddingBottom: insets.bottom + 8 }}
          >
            <TouchableOpacity
              className="rounded-xl py-4 items-center"
              style={{ backgroundColor: canSubmit && !submitting ? '#22A06B' : '#E5E7EB' }}
              onPress={handleSubmit}
              disabled={!canSubmit || submitting}
            >
              <Text
                className="font-bold text-[15px]"
                style={{ color: canSubmit && !submitting ? '#fff' : '#9AA3AF' }}
              >
                {submitting ? '제출 중…' : '변경 신청하기'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        <DaumPostcodeModal
          visible={showPostcode}
          onClose={() => setShowPostcode(false)}
          onSelect={addr => setAddress(addr)}
        />
      </View>
    </Modal>
  );
}

// ─── UserEditScreen (Modal) ────────────────────────────────────
function UserEditScreen({ visible, onClose, storeInfo, setStoreInfo }) {
  const insets = useSafeAreaInsets();
  const [ownerName, setOwnerName] = useState(storeInfo.ownerName);
  const [phone, setPhone] = useState(storeInfo.phone);
  const [description, setDescription] = useState(storeInfo.description);
  const [notice, setNotice] = useState(storeInfo.notice);
  const [days, setDays] = useState(
    JSON.parse(JSON.stringify(storeInfo.openHours.days))
  );

  // Time picker state
  const [timePicker, setTimePicker] = useState(null); // { dayKey, field: 'open'|'close' }
  const [timePickerVisible, setTimePickerVisible] = useState(false);
  const [timePickerValue, setTimePickerValue] = useState(new Date());

  function openTimePicker(dayKey, field) {
    const t = days[dayKey]?.[field] || '09:00';
    setTimePickerValue(parseTimeToDate(t));
    setTimePicker({ dayKey, field });
    setTimePickerVisible(true);
  }

  function handleTimeChange(event, date) {
    if (Platform.OS === 'android') setTimePickerVisible(false);
    if (!date || !timePicker) return;
    const formatted = formatDateFromDate(date);
    setDays(prev => ({
      ...prev,
      [timePicker.dayKey]: {
        ...prev[timePicker.dayKey],
        [timePicker.field]: formatted,
      },
    }));
  }

  function toggleDay(dayKey) {
    setDays(prev => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        isOpen: !prev[dayKey].isOpen,
      },
    }));
  }

  function handleSave() {
    const closedDays = DAY_KEYS.filter(k => !days[k].isOpen);
    setStoreInfo(prev => ({
      ...prev,
      ownerName,
      phone,
      description,
      notice,
      closedDays,
      openHours: {
        ...prev.openHours,
        days,
      },
    }));
    onClose();
  }

  function handleClose() {
    setOwnerName(storeInfo.ownerName);
    setPhone(storeInfo.phone);
    setDescription(storeInfo.description);
    setNotice(storeInfo.notice);
    setDays(JSON.parse(JSON.stringify(storeInfo.openHours.days)));
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View className="flex-1 bg-softgray">
        {/* Header */}
        <View
          className="bg-white px-4 pb-3 border-b border-gray-100 flex-row items-center justify-between"
          style={{ paddingTop: insets.top + 16 }}
        >
          <TouchableOpacity onPress={handleClose} className="p-1">
            <X color="#1F2933" size={22} />
          </TouchableOpacity>
          <Text className="text-lg font-bold text-charcoal">매장 정보 수정</Text>
          <View className="w-8" />
        </View>

        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {/* Owner Name */}
            <View className="mx-4 mt-4 mb-3">
              <Text className="text-sm font-bold text-charcoal mb-2">대표자명</Text>
              <TextInput
                className="bg-white rounded-xl px-4 py-3 text-charcoal border border-gray-100"
                value={ownerName}
                onChangeText={setOwnerName}
                placeholder="대표자명"
                placeholderTextColor="#9AA3AF"
              />
            </View>

            {/* Phone */}
            <View className="mx-4 mb-3">
              <Text className="text-sm font-bold text-charcoal mb-2">전화번호</Text>
              <TextInput
                className="bg-white rounded-xl px-4 py-3 text-charcoal border border-gray-100"
                value={phone}
                onChangeText={t => setPhone(formatPhone(t))}
                placeholder="전화번호"
                placeholderTextColor="#9AA3AF"
                keyboardType="phone-pad"
              />
            </View>

            {/* Open Hours - per day table */}
            <View className="mx-4 mb-3 bg-white rounded-xl overflow-hidden" style={{ elevation: 1 }}>
              <View className="px-4 py-3 border-b border-gray-100">
                <Text className="text-sm font-bold text-charcoal">영업시간</Text>
              </View>
              {DAY_KEYS.map((dayKey, idx) => {
                const dayData = days[dayKey];
                const isLast = idx === DAY_KEYS.length - 1;
                return (
                  <View
                    key={dayKey}
                    className="flex-row items-center px-4 py-3"
                    style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#F3F4F6' }}
                  >
                    {/* Day label */}
                    <View className="w-6 items-center mr-3">
                      <Text
                        className="text-sm font-bold"
                        style={{
                          color: dayKey === 'sun' ? '#E5484D' : dayKey === 'sat' ? '#3B82F6' : '#1F2933'
                        }}
                      >
                        {DAY_LABELS[dayKey]}
                      </Text>
                    </View>

                    {/* Toggle Open/Closed */}
                    <TouchableOpacity
                      onPress={() => toggleDay(dayKey)}
                      className="rounded-full px-2.5 py-1 mr-3"
                      style={{
                        backgroundColor: dayData.isOpen ? '#E9F8F1' : '#F5F6F7',
                      }}
                    >
                      <Text
                        className="text-xs font-semibold"
                        style={{ color: dayData.isOpen ? '#22A06B' : '#9AA3AF' }}
                      >
                        {dayData.isOpen ? '영업' : '휴무'}
                      </Text>
                    </TouchableOpacity>

                    {/* Time inputs */}
                    {dayData.isOpen ? (
                      <View className="flex-1 flex-row items-center gap-2">
                        <TouchableOpacity
                          onPress={() => openTimePicker(dayKey, 'open')}
                          className="flex-1 bg-softgray rounded-lg px-2 py-1.5 items-center"
                        >
                          <Text className="text-charcoal text-sm">{dayData.open}</Text>
                        </TouchableOpacity>
                        <Text className="text-gray-400 text-xs">~</Text>
                        <TouchableOpacity
                          onPress={() => openTimePicker(dayKey, 'close')}
                          className="flex-1 bg-softgray rounded-lg px-2 py-1.5 items-center"
                        >
                          <Text className="text-charcoal text-sm">{dayData.close}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View className="flex-1">
                        <Text className="text-gray-400 text-sm">휴무</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            {/* Description */}
            <View className="mx-4 mb-3">
              <Text className="text-sm font-bold text-charcoal mb-2">매장소개</Text>
              <TextInput
                className="bg-white rounded-xl px-4 py-3 text-charcoal border border-gray-100"
                value={description}
                onChangeText={setDescription}
                placeholder="매장 소개를 입력하세요"
                placeholderTextColor="#9AA3AF"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {/* Notice */}
            <View className="mx-4 mb-3">
              <Text className="text-sm font-bold text-charcoal mb-2">매장공지</Text>
              <TextInput
                className="bg-white rounded-xl px-4 py-3 text-charcoal border border-gray-100"
                value={notice}
                onChangeText={setNotice}
                placeholder="구매자에게 전달할 공지사항"
                placeholderTextColor="#9AA3AF"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            <View className="h-20" />
          </ScrollView>

          {/* Save Button */}
          <View
            className="bg-white border-t border-gray-100 px-4 py-3"
            style={{ paddingBottom: insets.bottom + 8 }}
          >
            <TouchableOpacity
              className="bg-primary rounded-xl py-4 items-center"
              onPress={handleSave}
            >
              <Text className="text-white font-bold text-[15px]">저장하기</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        {/* Time Picker */}
        {timePickerVisible && (
          Platform.OS === 'ios' ? (
            <Modal visible transparent animationType="slide">
              <View className="flex-1 justify-end bg-black/40">
                <View className="bg-white rounded-t-2xl">
                  <View className="flex-row justify-between items-center px-4 py-3 border-b border-gray-100">
                    <TouchableOpacity onPress={() => setTimePickerVisible(false)}>
                      <Text className="text-gray-500 text-[15px]">취소</Text>
                    </TouchableOpacity>
                    <Text className="font-bold text-charcoal">시간 선택</Text>
                    <TouchableOpacity onPress={() => setTimePickerVisible(false)}>
                      <Text className="text-primary font-semibold text-[15px]">확인</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={timePickerValue}
                    mode="time"
                    display="spinner"
                    onChange={(e, d) => {
                      if (d) { setTimePickerValue(d); handleTimeChange(e, d); }
                    }}
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
      </View>
    </Modal>
  );
}

// ─── Terms Modal ───────────────────────────────────────────────
function TermsModal({ visible, title, content, onClose }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-white">
        <View
          className="px-4 pb-3 border-b border-gray-100 flex-row items-center"
          style={{ paddingTop: insets.top + 16 }}
        >
          <TouchableOpacity onPress={onClose} className="mr-3 p-1">
            <X color="#1F2933" size={22} />
          </TouchableOpacity>
          <Text className="text-lg font-bold text-charcoal">{title}</Text>
        </View>
        <ScrollView className="flex-1 px-4 py-4">
          <Text className="text-gray-600 text-sm leading-6">{content}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Tag Edit Bottom Sheet ─────────────────────────────────────
function TagEditModal({ visible, tags, onSave, onClose }) {
  const insets = useSafeAreaInsets();
  const [localTags, setLocalTags] = useState([...tags]);
  const [newTag, setNewTag] = useState('');

  function addTag() {
    const t = newTag.trim();
    if (t && !localTags.includes(t) && localTags.length < 5) {
      setLocalTags(prev => [...prev, t]);
      setNewTag('');
    }
  }

  function removeTag(tag) {
    setLocalTags(prev => prev.filter(t => t !== tag));
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity
        className="flex-1 bg-black/40"
        activeOpacity={1}
        onPress={onClose}
      />
      <View
        className="bg-white rounded-t-2xl"
        style={{ paddingBottom: insets.bottom + 8 }}
      >
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100">
          <Text className="font-bold text-charcoal text-[16px]">태그 편집</Text>
          <TouchableOpacity onPress={onClose}><X color="#9AA3AF" size={20} /></TouchableOpacity>
        </View>
        <View className="px-4 pt-4 pb-2">
          <View className="flex-row flex-wrap gap-2 mb-4">
            {localTags.map(tag => (
              <View
                key={tag}
                className="flex-row items-center gap-1 bg-mint rounded-full px-3 py-1.5"
              >
                <Text className="text-primary text-sm">#{tag}</Text>
                <TouchableOpacity onPress={() => removeTag(tag)}>
                  <X color="#22A06B" size={12} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
          <View className="flex-row gap-2">
            <TextInput
              className="flex-1 bg-softgray rounded-xl px-4 py-2.5 text-charcoal"
              placeholder="태그 입력 (최대 5개)"
              placeholderTextColor="#9AA3AF"
              value={newTag}
              onChangeText={setNewTag}
              onSubmitEditing={addTag}
              returnKeyType="done"
            />
            <TouchableOpacity
              className="bg-primary rounded-xl px-4 py-2.5 items-center justify-center"
              onPress={addTag}
            >
              <Plus color="#fff" size={18} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            className="bg-primary rounded-xl py-3.5 items-center mt-4"
            onPress={() => { onSave(localTags); onClose(); }}
          >
            <Text className="text-white font-bold">저장</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Store Screen ─────────────────────────────────────────
export default function StoreScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { storeInfo, setStoreInfo, products } = useApp();
  const { signOut } = useAuth();

  const [showAdminEdit, setShowAdminEdit] = useState(false);
  const [showUserEdit, setShowUserEdit] = useState(false);
  const [showTagEdit, setShowTagEdit] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showCustomerCenter, setShowCustomerCenter] = useState(false);
  const [bizUploading, setBizUploading] = useState(false);

  const approvalCfg = APPROVAL_CONFIG[storeInfo.approvalStatus] || APPROVAL_CONFIG.pending;

  async function pickStoreImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('권한 필요', '사진 접근 권한이 필요합니다.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      setStoreInfo(prev => ({ ...prev, storeImage: result.assets[0].uri }));
    }
  }

  async function uploadBizCert() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('권한 필요', '사진 접근 권한이 필요합니다.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setBizUploading(true);
    try {
      // Storage 업로드 후 public URL을 stores.biz_cert_image에 영속(setStoreInfo→updateStoreRow).
      const url = await uploadImageIfLocal(result.assets[0].uri, null, 'documents');
      setStoreInfo(prev => ({ ...prev, bizCertImage: url }));
      Alert.alert('업로드 완료', '사업자등록증이 재업로드되었습니다.');
    } catch (e) {
      Alert.alert('업로드 실패', e.message || '이미지 업로드에 실패했습니다.');
    } finally {
      setBizUploading(false);
    }
  }

  // Format closed days label
  const closedDayLabel = storeInfo.closedDays.length === 0
    ? '없음'
    : storeInfo.closedDays.map(k => DAY_LABELS[k]).join(', ') + '요일';

  return (
    <View className="flex-1 bg-softgray">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <View style={{ paddingTop: insets.top + 16 }} className="bg-white pb-4 mb-3">
          <View className="px-4">
            {/* Store image + info row */}
            <View className="flex-row items-start gap-4 mb-3">
              <TouchableOpacity onPress={pickStoreImage}>
                <View className="w-20 h-20 rounded-2xl bg-softgray overflow-hidden items-center justify-center border-2 border-gray-100">
                  {storeInfo.storeImage ? (
                    <Image source={{ uri: storeInfo.storeImage }} className="w-full h-full" resizeMode="cover" />
                  ) : (
                    <View className="items-center">
                      <Building2 color="#9AA3AF" size={24} />
                      <Text className="text-[9px] text-gray-400 mt-0.5">사진 등록</Text>
                    </View>
                  )}
                  <View className="absolute bottom-0 right-0 bg-primary rounded-full p-1">
                    <Camera color="#fff" size={10} />
                  </View>
                </View>
              </TouchableOpacity>

              <View className="flex-1">
                <View className="flex-row items-center gap-2 mb-1">
                  <Text className="text-[20px] font-bold text-charcoal">{storeInfo.name}</Text>
                  <View
                    className="rounded-full px-2 py-0.5"
                    style={{ backgroundColor: approvalCfg.bg }}
                  >
                    <Text className="text-[10px] font-bold" style={{ color: approvalCfg.color }}>
                      {approvalCfg.label}
                    </Text>
                  </View>
                </View>
                <Text className="text-gray-500 text-[15px] mb-1">{storeInfo.category}</Text>
                <View className="flex-row items-center gap-3">
                  <View className="flex-row items-center gap-1">
                    <Star size={13} color="#FBBF24" fill="#FBBF24" />
                    <Text className="text-charcoal text-[16px] font-semibold">{storeInfo.rating}</Text>
                    <Text className="text-gray-400 text-[13px]">({storeInfo.reviewCount})</Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <Phone size={13} color="#9AA3AF" />
                    <Text className="text-gray-500 text-[15px]">{storeInfo.phone}</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Tags */}
            <View className="flex-row items-center gap-2 flex-wrap mb-3">
              {storeInfo.tags.map(tag => (
                <View key={tag} className="bg-mint rounded-full px-2.5 py-1">
                  <Text className="text-primary text-[13px]">#{tag}</Text>
                </View>
              ))}
              <TouchableOpacity
                onPress={() => setShowTagEdit(true)}
                className="border border-dashed border-primary rounded-full px-2.5 py-1 flex-row items-center gap-1"
              >
                <Edit2 color="#22A06B" size={10} />
                <Text className="text-primary text-xs">편집</Text>
              </TouchableOpacity>
            </View>

            {/* Preview Button */}
            <TouchableOpacity
              onPress={() => setShowPreview(true)}
              style={{ backgroundColor: '#E9F8F1', borderRadius: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Eye color="#22A06B" size={15} />
              <Text style={{ color: '#22A06B', fontSize: 14, fontWeight: '600' }}>소비자 화면 미리보기</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Block 1: Admin-approved info */}
        <View className="mx-4 mb-3 bg-white rounded-xl overflow-hidden shadow-sm" style={{ elevation: 1 }}>
          <View
            className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100"
            style={{ borderLeftWidth: 3, borderLeftColor: '#FF8A3D' }}
          >
            <View>
              <Text className="font-bold text-charcoal text-[16px]">관리자 승인이 필요한 정보</Text>
              <Text className="text-[13px] text-gray-400 mt-0.5">변경 시 재승인이 필요합니다</Text>
            </View>
          </View>

          <InfoRow label="매장명" value={storeInfo.name} />
          <InfoRow label="사업자등록번호" value={storeInfo.bizNumber} />
          <InfoRow label="대표자 주민등록번호" value={maskResident(storeInfo.residentNumber)} />
          <InfoRow label="매장 주소" value={storeInfo.address} />
          <InfoRow
            label="계좌정보"
            value={`${storeInfo.bankName} ${storeInfo.accountNumber} (${storeInfo.accountHolder})`}
            isLast
          />

          <TouchableOpacity
            className="mx-4 mb-4 mt-3 bg-primary rounded-xl py-3 items-center"
            onPress={() => setShowAdminEdit(true)}
          >
            <Text className="text-white font-semibold">정보 변경 신청하기</Text>
          </TouchableOpacity>
        </View>

        {/* Block 2: Instantly reflected info */}
        <View className="mx-4 mb-3 bg-white rounded-xl overflow-hidden shadow-sm" style={{ elevation: 1 }}>
          <View
            className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100"
            style={{ borderLeftWidth: 3, borderLeftColor: '#22A06B' }}
          >
            <View>
              <Text className="font-bold text-charcoal text-[16px]">바로 반영되는 정보</Text>
              <Text className="text-[13px] text-gray-400 mt-0.5">수정 즉시 앱에 반영됩니다</Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowUserEdit(true)}
              className="bg-mint rounded-lg px-3 py-1.5 flex-row items-center gap-1"
            >
              <Edit2 color="#22A06B" size={12} />
              <Text className="text-primary text-[15px] font-semibold">수정</Text>
            </TouchableOpacity>
          </View>

          <InfoRow label="대표자명" value={storeInfo.ownerName} />

          {/* Open Hours */}
          <View className="px-4 py-3 border-b border-gray-50">
            <Text className="text-[13px] text-gray-400 mb-2">영업시간</Text>
            {DAY_KEYS.map(key => {
              const d = storeInfo.openHours.days[key];
              return (
                <View key={key} className="flex-row items-center mb-1">
                  <Text
                    className="w-5 text-[13px] font-semibold mr-2"
                    style={{
                      color: key === 'sun' ? '#E5484D' : key === 'sat' ? '#3B82F6' : '#1F2933'
                    }}
                  >
                    {DAY_LABELS[key]}
                  </Text>
                  <Text className="text-charcoal text-[15px]">
                    {d.isOpen ? `${d.open} ~ ${d.close}` : '휴무'}
                  </Text>
                </View>
              );
            })}
          </View>

          <InfoRow label="휴무일" value={closedDayLabel} />
          <InfoRow label="전화번호" value={storeInfo.phone} />
          <InfoRow label="매장소개" value={storeInfo.description} />
          <InfoRow label="매장공지" value={storeInfo.notice} isLast />
        </View>

        {/* Contract & Settlement Info */}
        <View className="mx-4 mb-3 bg-white rounded-xl overflow-hidden shadow-sm" style={{ elevation: 1 }}>
          <View className="px-4 py-3 border-b border-gray-100">
            <Text className="font-bold text-charcoal text-[16px]">계약 및 정산 정보</Text>
          </View>
          <InfoRow label="판매 수수료율" value={`${storeInfo.commissionRate}%`} />
          <InfoRow label="계약 시작일" value={storeInfo.contractStartDate} isLast />
        </View>

        {/* Review Management */}
        <View className="mx-4 mb-3 bg-white rounded-xl overflow-hidden shadow-sm" style={{ elevation: 1 }}>
          <TouchableOpacity
            className="flex-row items-center justify-between px-4 py-3.5"
            onPress={() => navigation.navigate('Reviews')}
          >
            <View className="flex-row items-center gap-3">
              <Star color="#22A06B" size={18} />
              <Text className="font-semibold text-charcoal text-[16px]">리뷰 관리</Text>
            </View>
            <ChevronRight color="#9AA3AF" size={18} />
          </TouchableOpacity>
        </View>

        {/* Coupon Management */}
        <View className="mx-4 mb-3 bg-white rounded-xl overflow-hidden shadow-sm" style={{ elevation: 1 }}>
          <View className="px-4 py-3 border-b border-gray-100">
            <Text className="font-bold text-charcoal text-[16px]">쿠폰 관리</Text>
          </View>
          <TouchableOpacity
            className="flex-row items-center justify-between px-4 py-3.5 border-b border-gray-50"
            onPress={() => navigation.navigate('CouponRequest')}
          >
            <View className="flex-row items-center gap-3">
              <Ticket color="#22A06B" size={18} />
              <Text className="font-semibold text-charcoal text-[16px]">쿠폰 만들기</Text>
            </View>
            <ChevronRight color="#9AA3AF" size={18} />
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-row items-center justify-between px-4 py-3.5"
            onPress={() => navigation.navigate('CouponStatus')}
          >
            <View className="flex-row items-center gap-3">
              <FileText color="#9AA3AF" size={18} />
              <Text className="font-semibold text-charcoal text-[16px]">신청 현황</Text>
            </View>
            <ChevronRight color="#9AA3AF" size={18} />
          </TouchableOpacity>
        </View>

        {/* Documents */}
        <View className="mx-4 mb-3 bg-white rounded-xl overflow-hidden shadow-sm" style={{ elevation: 1 }}>
          <View className="px-4 py-3 border-b border-gray-100">
            <Text className="font-bold text-charcoal text-[16px]">서류</Text>
          </View>
          <View className="px-4 py-3 flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <FileText color="#22A06B" size={18} />
              <View>
                <Text className="text-charcoal text-[15px] font-semibold">사업자등록증</Text>
                <Text
                  className="text-[13px] mt-0.5"
                  style={{ color: storeInfo.bizCertImage ? '#22A06B' : '#9AA3AF' }}
                >
                  {storeInfo.bizCertImage ? '등록 완료' : '미등록'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={uploadBizCert}
              disabled={bizUploading}
              className="bg-softgray border border-gray-200 rounded-lg px-3 py-1.5"
            >
              <Text className="text-gray-600 text-xs font-semibold">{bizUploading ? '업로드 중…' : '재업로드'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Settings */}
        <View className="mx-4 mb-3 bg-white rounded-xl overflow-hidden shadow-sm" style={{ elevation: 1 }}>
          <View className="px-4 py-3 border-b border-gray-100">
            <Text className="font-bold text-charcoal text-[16px]">설정</Text>
          </View>
          <TouchableOpacity
            className="flex-row items-center justify-between px-4 py-3.5 border-b border-gray-50"
            onPress={() => Linking.openSettings()}
          >
            <View className="flex-row items-center gap-3">
              <Bell color="#9AA3AF" size={18} />
              <Text className="text-charcoal text-[16px]">알림 설정</Text>
            </View>
            <ChevronRight color="#9AA3AF" size={18} />
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-row items-center justify-between px-4 py-3.5"
            onPress={() => setShowCustomerCenter(true)}
          >
            <View className="flex-row items-center gap-3">
              <HelpCircle color="#9AA3AF" size={18} />
              <Text className="text-charcoal text-[16px]">고객센터</Text>
            </View>
            <ChevronRight color="#9AA3AF" size={18} />
          </TouchableOpacity>
        </View>

        {/* 공지사항 */}
        <View className="mx-4 mb-3 bg-white rounded-xl overflow-hidden shadow-sm" style={{ elevation: 1 }}>
          <TouchableOpacity
            className="flex-row items-center justify-between px-4 py-3.5"
            onPress={() => navigation.navigate('NoticeList')}
          >
            <View className="flex-row items-center gap-3">
              <FileText color="#9AA3AF" size={18} />
              <Text className="text-charcoal text-[16px]">공지사항</Text>
            </View>
            <ChevronRight color="#9AA3AF" size={18} />
          </TouchableOpacity>
        </View>

        {/* Logout */}
        <View className="mx-4 mb-3">
          <TouchableOpacity
            className="bg-white rounded-xl py-4 items-center flex-row justify-center gap-2 shadow-sm"
            style={{ elevation: 1 }}
            onPress={() => setShowLogoutConfirm(true)}
          >
            <LogOut color="#E5484D" size={18} />
            <Text className="text-alertred font-semibold text-[16px]">로그아웃</Text>
          </TouchableOpacity>
        </View>

        {/* Terms */}
        <View className="mx-4 mb-6 flex-row justify-center gap-4">
          <TouchableOpacity onPress={() => setShowTerms(true)}>
            <Text className="text-gray-400 text-xs underline">판매자 이용약관</Text>
          </TouchableOpacity>
          <Text className="text-gray-300 text-xs">|</Text>
          <TouchableOpacity onPress={() => setShowPrivacy(true)}>
            <Text className="text-gray-400 text-xs underline">개인정보 처리방침</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Modals */}
      <AdminEditScreen
        visible={showAdminEdit}
        onClose={() => setShowAdminEdit(false)}
        storeInfo={storeInfo}
        setStoreInfo={setStoreInfo}
      />

      <UserEditScreen
        visible={showUserEdit}
        onClose={() => setShowUserEdit(false)}
        storeInfo={storeInfo}
        setStoreInfo={setStoreInfo}
      />

      <TagEditModal
        visible={showTagEdit}
        tags={storeInfo.tags}
        onSave={tags => setStoreInfo(prev => ({ ...prev, tags }))}
        onClose={() => setShowTagEdit(false)}
      />

      {/* Logout Confirm */}
      <Modal visible={showLogoutConfirm} transparent animationType="fade">
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full">
            <Text className="text-lg font-bold text-charcoal mb-2 text-center">로그아웃</Text>
            <Text className="text-gray-500 text-sm text-center leading-5 mb-5">
              정말 로그아웃 하시겠습니까?
            </Text>
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 border border-gray-200 rounded-xl py-3 items-center"
                onPress={() => setShowLogoutConfirm(false)}
              >
                <Text className="text-gray-600 font-semibold">취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-alertred rounded-xl py-3 items-center"
                onPress={() => { setShowLogoutConfirm(false); signOut(); }}
              >
                <Text className="text-white font-semibold">로그아웃</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 고객센터 */}
      <Modal visible={showCustomerCenter} transparent animationType="fade" onRequestClose={() => setShowCustomerCenter(false)}>
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full">
            <Text className="text-lg font-bold text-charcoal mb-1 text-center">고객센터</Text>
            <Text className="text-gray-500 text-xs text-center mb-5">평일 09:00 ~ 18:00 (주말·공휴일 휴무)</Text>
            <TouchableOpacity
              className="flex-row items-center justify-center gap-2 bg-mint rounded-xl py-3.5 mb-2.5"
              onPress={() => Linking.openURL('tel:0212345678')}
            >
              <Phone color="#22A06B" size={16} />
              <Text className="text-primary font-semibold text-[15px]">전화 문의 · 02-1234-5678</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-row items-center justify-center gap-2 bg-softgray rounded-xl py-3.5 mb-4"
              onPress={() => Linking.openURL('mailto:help@foodpicker.co.kr')}
            >
              <MessageSquare color="#374151" size={16} />
              <Text className="text-gray-700 font-semibold text-[15px]">이메일 문의</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="border border-gray-200 rounded-xl py-3 items-center"
              onPress={() => setShowCustomerCenter(false)}
            >
              <Text className="text-gray-600 font-semibold">닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <StorePreviewModal
        visible={showPreview}
        onClose={() => setShowPreview(false)}
        storeInfo={storeInfo}
        products={products}
        navigation={navigation}
      />

      <TermsModal
        visible={showTerms}
        title="이용약관"
        content={[
          '제1조 (목적)',
          '본 약관은 의무기록발급대행 대표 김동식(이하 "사업자")이 운영하는 \'Food Picker(푸드피커)\' 모바일 애플리케이션(이하 "푸드피커")에서 제공하는 폐기 임박 식품 중개 및 관련 제반 서비스(이하 "서비스")를 이용함에 있어 "사업자"와 "이용자", "판매 점포(또는 판매자)"의 권리, 의무 및 책임 사항을 규정함을 목적으로 합니다.',
          '',
          '제2조 (용어의 정의)',
          '① 푸드피커: 사업자가 식품 폐기 감소 및 자원 순환을 목적으로 유통기한 또는 소비기한이 임박한 식품을 판매하는 판매자(이하 "점포")와 구매하고자 하는 회원(이하 "이용자") 간의 거래를 중개하는 디지털 플랫폼을 말합니다.',
          '② 회원: 푸드피커에 개인정보를 제공하여 회원 등록을 한 자로서, 푸드피커의 정보를 지속적으로 제공받으며 서비스를 계속적으로 이용할 수 있는 자를 말합니다.',
          '③ 폐기 임박 식품: 유통기한, 소비기한, 품질 유지 기한이 조만간 만료되거나 당일 판매되지 않으면 폐기되는 식품 및 마감 할인 상품을 의미합니다.',
          '④ 판매 점포(또는 판매자): 푸드피커에 입점하여 회원에게 유통기한 임박 식품 및 마감 할인 상품을 등록·판매하는 사업자 또는 개인을 말합니다.',
          '',
          '제3조 (서비스의 내용 및 특수성)',
          '① 푸드피커는 다음과 같은 업무를 수행합니다.',
          '  1. 위치 기반 폐기 임박 식품 정보 제공 및 검색 서비스',
          '  2. 점포와 회원 간의 식품 주문 및 결제 중개 서비스',
          '  3. 기타 푸드피커가 정하는 이용자 편의 부가 서비스',
          '② 본 서비스에서 거래되는 상품은 \'폐기 임박 식품\' 또는 \'마감 세일 상품\'이라는 특수성을 가집니다. 회원은 상품 상세 페이지에 표시된 유통기한(소비기한) 및 수령 마감 시간을 반드시 확인하고 구매해야 합니다.',
          '',
          '제4조 (이용요금 및 결제)',
          '① 회원은 푸드피커 내에서 제공하는 전자결제 수단(신용카드, 간편결제 등)을 통해 상품 대금을 결제할 수 있습니다.',
          '② 상품의 판매가, 할인율 및 수령 가능 시간은 각 점포에서 실시간으로 등록한 기준에 따릅니다.',
          '③ 판매 점포 수수료 및 정산:',
          '  1. "사업자"는 중개 서비스 제공의 대가로 "판매 점포"와 약정한 중개 수수료를 상품 판매 대금에서 공제할 수 있습니다.',
          '  2. "사업자"는 회원이 구매를 완료하고 상품 수령이 확인된 건에 대하여, "판매 점포"와 사전에 약정한 정산 주기 및 방식에 따라 판매 대금을 정산하여 지급합니다.',
          '',
          '제5조 (취소, 환불 및 수령 의무)',
          '① 본 서비스의 상품은 당일 폐기 또는 즉시 소비를 전제로 하는 \'시간 임박 상품\'이므로, 점포의 상품 준비가 시작되거나 수령 지정 시간이 경과한 후에는 회원의 단순 변심에 의한 주문 취소 및 환불이 제한될 수 있습니다.',
          '② 회원은 점포가 지정한 운영 시간 또는 약속된 수령 시간 내에 직접 점포를 방문하여 상품을 수령해야 합니다. 회원의 부주의로 지정된 시간 내에 상품을 수령하지 않아 발생한 식품의 변질이나 폐기에 대해서는 환불이 불가합니다.',
          '③ 다만, 수령 시점에 이미 식품이 부패했거나 점포의 과실로 인해 주문한 상품과 명백히 다른 상품이 인도된 경우, 회원은 현장에서 즉시 점포 또는 푸드피커 고객센터를 통해 환불 또는 교환을 요청할 수 있으며, 이때 "판매 점포"는 환불 처리 등 고객 응대에 적극 협조해야 합니다.',
          '',
          '제6조 (판매 점포의 의무 및 상품 관리 책임)',
          '① "판매 점포"는 관련 법령(식품위생법, 표시광고법 등)을 준수하여 상품을 위생적으로 관리하고 정확한 정보(유통기한·소비기한, 알레르기 유발 물질 등)를 앱 내에 등록해야 합니다. 허위 정보를 등록하여 발생한 모든 법적 책임은 "판매 점포"에 있습니다.',
          '② "판매 점포"는 회원이 지정된 시간에 상품을 수령할 수 있도록 상품을 안전하게 포장 및 보관하여야 합니다.',
          '③ "판매 점포"는 정당한 사유 없이 회원의 주문을 일방적으로 취소하거나 차별 대우를 해서는 안 되며, 매장 사정으로 처리가 불가능할 경우 즉시 앱을 통해 판매 중지 처리 등을 진행해야 합니다.',
          '',
          '제7조 (사업자의 의무 및 면책)',
          '① 사업자는 관련 법령과 본 약관이 금지하거나 공서양속에 반하는 행위를 하지 않으며 지속적이고 안정적인 서비스를 제공하기 위해 최선을 다합니다.',
          '② 거래 중개에 대한 면책: 푸드피커는 점포와 회원 간의 식품 거래를 중개하는 플랫폼 시스템을 제공할 뿐이며, 점포가 등록한 식품의 개별 품질, 위생 상태, 유통기한의 정확성에 대해 직접적인 책임을 지지 않습니다. 식품위생법 등 관련 법령에 따른 개별 상품의 책임은 상품을 제조·통신판매하는 각 점포에 있습니다.',
          '③ 사업자는 천재지변, 점포의 갑작스러운 휴업, 통신망 장애 등 불가항력적인 사유로 서비스를 제공할 수 없는 경우 이로 인한 손해에 대해 책임을 면합니다.',
          '',
          '제7조 (회원의 의무)',
          '회원은 다음 행위를 하여서는 안 됩니다.',
          '① 신청 또는 변경 시 허위 내용의 등록',
          '② 타인의 정보 또는 결제 수단 도용',
          '③ 정상적인 거래 의사 없이 상습적으로 주문 후 미수령(노쇼)하여 점포의 영업을 방해하는 행위',
          '④ 푸드피커의 서비스 운영 및 타인의 서비스 이용을 방해하는 행위',
          '',
          '제8조 (재판권 및 준거법)',
          '① 사업자와 회원(이용자 및 판매 점포 포함) 간에 발생한 전자거래 분쟁에 관한 소송은 사업자의 사업장 소재지를 관할하는 의정부지방법원 남양주지원을 전속 관할로 합니다.',
          '② 사업자와 회원 간에 제기된 소송에는 대한민국 법을 적용합니다.',
        ].join('\n')}
        onClose={() => setShowTerms(false)}
      />

      <TermsModal
        visible={showPrivacy}
        title="개인정보 처리방침"
        content={[
          '의무기록발급대행 김동식 대표가 운영하는 \'Food Picker(푸드피커)\'(이하 "푸드피커")는 이용자 및 판매점포의 개인정보를 소중히 다루며, 개인정보보호법 등 관련 법령을 준수하고 있습니다.',
          '',
          '본 개인정보처리방침은 푸드피커 서비스 이용 시 회원(이용자 및 판매점포)들의 개인정보가 어떻게 수집, 이용, 제공되는지 안내합니다.',
          '',
          '제1조 (개인정보의 수집·이용 목적 및 항목)',
          '푸드피커는 원활한 마감 할인 식품 중개 및 주문 수령을 위해 필요한 최소한의 개인정보를 수집하며, 수집된 정보는 다음의 목적 외의 용도로는 사용되지 않습니다.',
          '',
          '[필수 정보]',
          '· 수집·이용 목적: 회원 가입 및 식별, 본인 확인, 주문·결제 처리, 점포 방문 수령 확인 안내',
          '· 수집 항목: 성명, 연락처(휴대폰 번호), 생년월일, 이메일 주소, 로그인 ID, 비밀번호',
          '· 보유 기간: 회원 탈퇴 시까지 또는 법정 의무 보유 기간까지',
          '',
          '[위치 정보]',
          '· 수집·이용 목적: 내 주변 폐기 임박 식품 점포 검색, 거리 계산 및 지도 표시 서비스 제공',
          '· 수집 항목: 이용자의 실시간 GPS 위치 데이터 (앱 실행 중 동의 시)',
          '· 보유 기간: 서비스 이용 목적 달성 및 위치정보법에 따른 기간',
          '',
          '[판매 점포(판매자)]',
          '· 수집·이용 목적: 판매자 입점 계약 체결 및 신원 확인, 상품 등록 관리, 판매 대금 정산 및 세금신고, 고객 민원 처리',
          '· 수집 항목: 상호명, 대표자 성명, 사업자등록번호, 점포 주소, 점포 연락처, 정산 계좌 정보(은행명, 계좌번호, 예금주명)',
          '· 보유 기간: 입점 계약 종료(퇴점) 시까지 또는 부가가치세법 등 관련 법령에 따른 보존 기간까지',
          '',
          '[선택 정보]',
          '· 수집·이용 목적: 맞춤형 마감 할인 알림(Push), 이벤트 안내 및 마케팅 활용',
          '· 수집 항목: 선호 식품 카테고리, 알림 수신 동의 여부',
          '· 보유 기간: 동의 철회 시 또는 회원 탈퇴 시까지',
          '',
          '제2조 (개인정보의 제3자 제공)',
          '① 푸드피커는 회원이 주문한 폐기 임박 식품의 정확한 확인 및 원활한 수령(픽업)을 위해, 회원의 동의를 얻어 필요한 최소한의 정보를 판매자(점포)에게 제공합니다.',
          '',
          '1. 회원 정보 제공',
          '· 제공받는 자: 회원이 상품을 주문한 해당 푸드피커 입점 점포(판매자)',
          '· 제공목적: 주문확인, 상품준비, 점포방문 수령시 본인확인 및 고객 응대',
          '· 제공항목: 주문자 성명, 주문 번호, 주문 내역, 연락처(필요 시에 한함)',
          '· 보유 및 이용 기간: 상품 수령 완료 및 거래 종료 시까지',
          '',
          '2. 판매 점포 정보 제공',
          '· 제공받는 자: 푸드피커 일반 회원(구매자)',
          '· 제공목적: 구매 상품의 픽업 위치 안내, 식품위생 및 품질 관련 문의·환불 처리',
          '· 제공항목: 상호명, 점포 주소, 점포 연락처, 대표자 성명',
          '· 보유 및 이용 기간: 앱 내 서비스 노출 기간 및 거래 증빙 만료 시까지',
          '',
          '② 회원(이용자 및 판매점포)은 본 제3자 제공 동의를 거부할 권리가 있습니다. 다만, 동의를 거부할 경우 푸드피커를 통한 상품 주문, 판매 및 점포 수령 서비스 이용이 불가능합니다.',
          '',
          '제3조 (이용자의 권리와 그 행사방법)',
          '① 회원(이용자 및 판매점포)은 언제든지 푸드피커 앱 내 설정 메뉴 또는 고객센터를 통해 자신의 개인정보에 대한 열람, 오류 정정, 삭제 및 처리 정지를 요구할 수 있습니다.',
          '② 회원이 개인정보의 오류에 대한 정정을 요청한 경우, 정정을 완료하기 전까지 당해 개인정보를 이용 또는 제공하지 않습니다.',
          '',
          '제4조 (개인정보의 파기)',
          '① 푸드피커는 개인정보 보유기간의 경과, 처리목적 달성 등 개인정보가 필요하지 않게 되었을 때에는 지체 없이 해당 개인정보를 파기합니다.',
          '② 전자적 파일 형태의 정보는 기록을 재생할 수 없는 기술적 방법을 사용하여 파기하며, 종이 문서에 출력된 개인정보는 분쇄기로 분쇄하거나 소각하여 파기합니다.',
        ].join('\n')}
        onClose={() => setShowPrivacy(false)}
      />
    </View>
  );
}

// ─── Store Preview Modal (소비자 앱 StoreScreen과 동일한 스타일) ─────
function fmtPreviewTime(iso) {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function StorePreviewModal({ visible, onClose, storeInfo, products, navigation }) {
  const insets = useSafeAreaInsets();
  const [previewTab, setPreviewTab] = useState('products');
  const [previewProduct, setPreviewProduct] = useState(null);

  const sellingProducts = (products || []).filter(p => p.status === 'selling');
  const soldoutProducts = (products || []).filter(p => p.status === 'soldout');

  // 미리보기(소비자 화면 시뮬레이션)의 액션도 실제 매장 정보로 동작.
  function openDirections() {
    const q = storeInfo.address || storeInfo.name || '';
    Linking.openURL('https://maps.google.com/?q=' + encodeURIComponent(q));
  }
  function callStore() {
    const tel = (storeInfo.phone || '').replace(/[^0-9]/g, '');
    if (tel) Linking.openURL('tel:' + tel);
  }
  function goReviews() {
    onClose();
    navigation?.navigate('Reviews');
  }

  const pickupTime = sellingProducts.length > 0 && sellingProducts[0].pickupStart
    ? `${fmtPreviewTime(sellingProducts[0].pickupStart)} ~ ${fmtPreviewTime(sellingProducts[0].pickupEnd)}`
    : null;

  function buildSummaryHours() {
    const days = storeInfo.openHours?.days;
    if (!days) return '-';
    const first = DAY_KEYS.find(k => days[k]?.isOpen);
    if (!first) return '휴무';
    return `${days[first].open} ~ ${days[first].close}`;
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#F5F6F7' }}>
        {/* 녹색 헤더 */}
        <View style={{ backgroundColor: '#22A06B', paddingTop: insets.top }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
            <TouchableOpacity onPress={onClose} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
              <ChevronLeft size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>미리보기</Text>
            </View>
          </View>

          {/* 히어로 — 가로 레이아웃 */}
          <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }}>
            <View style={{ width: 72, height: 72, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
              {storeInfo.storeImage ? (
                <Image source={{ uri: storeInfo.storeImage }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <Building2 color="#fff" size={30} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 20, fontWeight: '900', color: '#fff', marginBottom: 4 }}>{storeInfo.name}</Text>
              <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginBottom: 8 }}>{storeInfo.category}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 }}
                  onPress={goReviews}
                >
                  <Star size={12} color="#FFD700" fill="#FFD700" />
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{storeInfo.rating}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>({storeInfo.reviewCount})</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* 액션 버튼 3개 — 열(column) 레이아웃 */}
        <View style={{ flexDirection: 'row', gap: 8, backgroundColor: '#fff', padding: 12, paddingHorizontal: 16, marginBottom: 8 }}>
          <TouchableOpacity onPress={openDirections} style={{ flex: 1, alignItems: 'center', gap: 5, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, backgroundColor: '#E9F8F1' }}>
            <Navigation size={18} color="#22A06B" />
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#22A06B' }}>길찾기</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={callStore} style={{ flex: 1, alignItems: 'center', gap: 5, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, backgroundColor: '#F5F6F7' }}>
            <Phone size={18} color="#1F2933" />
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#1F2933' }}>전화</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={goReviews} style={{ flex: 1, alignItems: 'center', gap: 5, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, backgroundColor: '#F5F6F7' }}>
            <MessageSquare size={18} color="#1F2933" />
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#1F2933' }}>리뷰</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          {/* 매장 기본 정보 */}
          <View style={{ backgroundColor: '#fff', marginBottom: 8, paddingHorizontal: 16, paddingVertical: 4 }}>
            <PreviewInfoRow icon={<MapPin size={15} color="#9AA3AF" />} label="주소" value={storeInfo.address} />
            <PreviewInfoRow icon={<Phone size={15} color="#9AA3AF" />} label="전화" value={storeInfo.phone} />
            <PreviewInfoRow icon={<Clock size={15} color="#9AA3AF" />} label="영업시간" value={buildSummaryHours()} />
            {pickupTime && (
              <PreviewInfoRow icon={<Clock size={15} color="#FF8A3D" />} label="픽업시간" value={pickupTime} highlight isLast />
            )}
            {!!storeInfo.description && (
              <Text style={{ fontSize: 13, color: '#9AA3AF', lineHeight: 21, paddingVertical: 12 }}>{storeInfo.description}</Text>
            )}
          </View>

          {/* 해시태그 */}
          {storeInfo.tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, backgroundColor: '#fff', padding: 10, paddingHorizontal: 16, marginBottom: 8 }}>
              {storeInfo.tags.map(tag => (
                <View key={tag} style={{ backgroundColor: '#E9F8F1', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 12, color: '#22A06B', fontWeight: '600' }}>#{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* 탭 바 */}
          <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 2, borderBottomColor: '#F5F6F7', marginBottom: 8 }}>
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setPreviewTab('products')}
              style={{ flex: 1, paddingVertical: 13, alignItems: 'center', borderBottomWidth: 2.5, borderBottomColor: previewTab === 'products' ? '#22A06B' : 'transparent', marginBottom: -2 }}
            >
              <Text style={{ fontSize: 14, color: previewTab === 'products' ? '#22A06B' : '#9AA3AF', fontWeight: previewTab === 'products' ? '800' : '400' }}>
                {`판매 상품 ${sellingProducts.length}개`}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setPreviewTab('info')}
              style={{ flex: 1, paddingVertical: 13, alignItems: 'center', borderBottomWidth: 2.5, borderBottomColor: previewTab === 'info' ? '#22A06B' : 'transparent', marginBottom: -2 }}
            >
              <Text style={{ fontSize: 14, color: previewTab === 'info' ? '#22A06B' : '#9AA3AF', fontWeight: previewTab === 'info' ? '800' : '400' }}>매장 정보</Text>
            </TouchableOpacity>
          </View>

          {/* 탭 콘텐츠 */}
          {previewTab === 'products' ? (
            <View>
              {sellingProducts.length === 0 && soldoutProducts.length === 0 ? (
                <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 16 }}>
                  <Text style={{ fontSize: 40, marginBottom: 10 }}>🛒</Text>
                  <Text style={{ fontSize: 14, color: '#9AA3AF' }}>현재 판매 중인 상품이 없습니다</Text>
                </View>
              ) : (
                <>
                  {sellingProducts.map(product => (
                    <PreviewProductRow key={product.id} product={product} storeInfo={storeInfo} onPress={setPreviewProduct} />
                  ))}
                  {soldoutProducts.length > 0 && (
                    <View>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#9AA3AF', marginBottom: 10, marginTop: 8, paddingHorizontal: 16 }}>품절 / 판매 종료</Text>
                      {soldoutProducts.map(product => (
                        <PreviewProductRow key={product.id} product={product} storeInfo={storeInfo} soldout />
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>
          ) : (
            <View style={{ paddingTop: 12, paddingHorizontal: 16 }}>
              {!!storeInfo.notice && (
                <View style={{ backgroundColor: '#FFF8E6', borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#FF8A3D', marginBottom: 6 }}>📢 매장 공지</Text>
                  <Text style={{ fontSize: 13, color: '#7A5C1E', lineHeight: 20 }}>{storeInfo.notice}</Text>
                </View>
              )}

              {/* 지도 플레이스홀더 */}
              <View style={{ height: 160, borderRadius: 14, backgroundColor: '#E8F4E8', overflow: 'hidden', marginBottom: 12, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 28 }}>📍</Text>
                <View style={{ marginTop: 6, backgroundColor: '#22A06B', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>{storeInfo.name}</Text>
                </View>
              </View>

              {/* 상세 주소 + 길찾기 */}
              <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#1F2933', marginBottom: 6 }}>상세 주소</Text>
                <Text style={{ fontSize: 13, color: '#9AA3AF', marginBottom: 12 }}>{storeInfo.address || '-'}</Text>
                <TouchableOpacity
                  onPress={openDirections}
                  style={{ backgroundColor: '#E9F8F1', borderRadius: 10, padding: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <Navigation size={15} color="#22A06B" />
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#22A06B' }}>길찾기</Text>
                </TouchableOpacity>
              </View>

              {/* 영업시간 (요일별) */}
              <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#1F2933', marginBottom: 10 }}>영업시간</Text>
                {DAY_KEYS.map(k => {
                  const d = storeInfo.openHours?.days?.[k];
                  return (
                    <View key={k} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                      <Text
                        style={{
                          width: 20, fontSize: 13, fontWeight: '600',
                          color: k === 'sun' ? '#E5484D' : k === 'sat' ? '#3B82F6' : '#374151',
                        }}
                      >
                        {DAY_LABELS[k]}
                      </Text>
                      <Text style={{ fontSize: 13, color: d?.isOpen ? '#1F2933' : '#9CA3AF', flex: 1 }}>
                        {d?.isOpen ? `${d.open} ~ ${d.close}` : '휴무'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>

      <ProductPreviewModal
        visible={!!previewProduct}
        product={previewProduct}
        storeInfo={storeInfo}
        onClose={() => setPreviewProduct(null)}
      />
    </Modal>
  );
}

function PreviewInfoRow({ icon, label, value, highlight = false, isLast = false }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 9, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#F5F6F7' }}>
      <View style={{ width: 24, marginTop: 1 }}>{icon}</View>
      <Text style={{ fontSize: 12, color: '#9AA3AF', width: 52, flexShrink: 0 }}>{label}</Text>
      <Text
        style={{ flex: 1, fontSize: 13, color: highlight ? '#FF8A3D' : '#1F2933', fontWeight: highlight ? '700' : '400', lineHeight: 18 }}
        numberOfLines={2}
      >
        {value || '-'}
      </Text>
    </View>
  );
}

function getPreviewBadgeStyle(b) {
  if (b.includes('마감') || b === '오늘까지') return { bg: '#FFF7ED', text: '#C2410C' };
  if (b.includes('할인')) return { bg: '#EFF6FF', text: '#1D4ED8' };
  return { bg: '#E9F8F1', text: '#15803D' };
}

function PreviewProductRow({ product, storeInfo, soldout = false, onPress }) {
  const badges = (product.badges || []).filter(b => b !== '품절');
  return (
    <TouchableOpacity
      activeOpacity={soldout ? 1 : 0.75}
      onPress={() => !soldout && onPress?.(product)}
      style={{
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
        paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#EFEFEF',
        gap: 14, opacity: soldout ? 0.55 : 1,
      }}
    >
      {/* 이미지 */}
      <View style={{ width: 110, height: 110, borderRadius: 12, overflow: 'hidden', backgroundColor: '#F0F5F2', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {product.thumbnail ? (
          <Image source={{ uri: product.thumbnail }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <Text style={{ fontSize: 42 }}>{product.emoji}</Text>
        )}
        {soldout && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>품절</Text>
          </View>
        )}
      </View>

      {/* 정보 */}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#1F2933', marginBottom: 2 }} numberOfLines={1}>{product.name}</Text>
        <Text style={{ fontSize: 12, color: '#9AA3AF', marginBottom: 4 }} numberOfLines={1}>{storeInfo.name}</Text>

        {/* 가격 행 */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5, marginBottom: 5 }}>
          <Text style={{ fontSize: 15, fontWeight: '900', color: '#E53935' }}>{product.discountRate}%</Text>
          <Text style={{ fontSize: 15, fontWeight: '900', color: '#1F2933' }}>{product.salePrice.toLocaleString()}원</Text>
          <Text style={{ fontSize: 12, color: '#9AA3AF', textDecorationLine: 'line-through' }}>{product.originalPrice.toLocaleString()}원</Text>
        </View>

        {/* 별점 · 남은 수량 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Star size={11} color="#FACC15" fill="#FACC15" />
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#1F2933' }}>{storeInfo.rating}</Text>
          <Text style={{ fontSize: 11, color: '#9AA3AF' }}>({storeInfo.reviewCount})</Text>
          <Text style={{ fontSize: 11, color: '#CCC' }}>·</Text>
          <Text style={{ fontSize: 11, color: '#9AA3AF' }}>남은 수량 {product.stock}개</Text>
        </View>

        {/* 픽업 시간 */}
        {!!product.pickupStart && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
            <Clock size={11} color="#FF8A3D" />
            <Text style={{ fontSize: 12, color: '#FF8A3D' }}>
              픽업 {fmtPreviewTime(product.pickupStart)}~{fmtPreviewTime(product.pickupEnd)}
            </Text>
          </View>
        )}

        {/* 뱃지 */}
        {badges.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
            {badges.map((b, i) => {
              const s = getPreviewBadgeStyle(b);
              return (
                <View key={i} style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: s.bg }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: s.text }}>{b}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <Heart size={20} color="#CACACA" />
    </TouchableOpacity>
  );
}

// ─── Product Preview Modal (소비자 앱 ProductDetailScreen과 동일한 스타일) ──
function fmtPreviewDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ProductPreviewModal({ visible, product, storeInfo, onClose }) {
  const [qty, setQty] = useState(1);
  const [expandedSection, setExpandedSection] = useState(null);

  if (!product) return null;

  const now = new Date();
  const isExpired = new Date(product.expiryDate) < now;
  const isPickupEnded = new Date(product.pickupEnd) < now;
  const isSoldout = product.status === 'soldout' || product.stock === 0;

  let btnLabel = `${(product.salePrice * qty).toLocaleString()}원 예약하기`;
  let btnDisabled = false;
  if (isSoldout) { btnLabel = '품절된 상품입니다'; btnDisabled = true; }
  else if (isPickupEnded || isExpired) { btnLabel = '판매가 종료되었습니다'; btnDisabled = true; }

  const allergyInfo = (product.allergens?.length ?? 0) > 0
    ? `${product.allergens.join(', ')} 함유`
    : '해당 없음';

  const sections = [
    { key: 'composition', label: '상품 구성', content: product.composition || '-' },
    { key: 'origin', label: '원산지 정보', content: product.origin || '-' },
    { key: 'allergy', label: '알레르기 정보', content: allergyInfo },
    { key: 'storage', label: '보관 방법', content: product.storageDetail || product.storage || '-' },
    { key: 'expiry', label: '소비기한', content: fmtPreviewDate(product.expiryDate) },
    { key: 'pickupTime', label: '픽업 가능 시간', content: `${fmtPreviewTime(product.pickupStart)} ~ ${fmtPreviewTime(product.pickupEnd)}` },
    { key: 'cancel', label: '취소/환불 규정', content: product.cancelPolicy || '-' },
    ...(product.storeNotice ? [{ key: 'notice', label: '매장 공지', content: product.storeNotice }] : []),
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#F5F6F7' }}>
        <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
          {/* 이미지 영역 (오버레이 헤더 포함) */}
          <View style={{ height: 280, backgroundColor: '#E8F0E8', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {product.thumbnail ? (
              <Image source={{ uri: product.thumbnail }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} resizeMode="cover" />
            ) : (
              <Text style={{ fontSize: 100 }}>{product.emoji}</Text>
            )}

            {/* 상단 버튼 바 */}
            <View style={{ position: 'absolute', top: 44, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14 }}>
              <TouchableOpacity onPress={onClose} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' }}>
                <ChevronLeft size={20} color="#1F2933" />
              </TouchableOpacity>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' }}>
                <Heart size={18} color="#1F2933" />
              </View>
            </View>

            {/* 배지 */}
            {product.badges?.length > 0 && (
              <View style={{ position: 'absolute', bottom: 12, left: 12, flexDirection: 'row', gap: 6 }}>
                {product.badges.map(b => (
                  <View
                    key={b}
                    style={{
                      backgroundColor: (b.includes('마감') || b.includes('오늘까지')) ? '#FF8A3D' : b.includes('할인') ? '#3B82F6' : '#22A06B',
                      paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8,
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{b}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* 기본 정보 카드 */}
          <View style={{ backgroundColor: '#fff', padding: 16, marginBottom: 8 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#1F2933', marginBottom: 6 }}>{product.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 16, paddingTop: 2 }}>
              <Building2 size={13} color="#22A06B" />
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#22A06B' }}>{storeInfo.name}</Text>
            </View>

            <View style={{ marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Text style={{ fontSize: 13, color: '#9AA3AF', textDecorationLine: 'line-through' }}>정가 {product.originalPrice.toLocaleString()}원</Text>
                <View style={{ backgroundColor: '#FEE2E2', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#E5484D' }}>{product.discountRate}%</Text>
                </View>
              </View>
              <Text style={{ fontSize: 28, fontWeight: '900', color: '#22A06B' }}>{product.salePrice.toLocaleString()}원</Text>
            </View>
          </View>

          {/* 정보 그리드 카드 */}
          <View style={{ backgroundColor: '#fff', padding: 16, marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {[
                { label: '남은 수량', value: isSoldout ? '품절' : `${product.stock}개`, warn: isSoldout },
                { label: '픽업 가능 시간', value: `${fmtPreviewTime(product.pickupStart)}~${fmtPreviewTime(product.pickupEnd)}` },
                { label: '소비기한', value: fmtPreviewDate(product.expiryDate), warn: isExpired },
                { label: '보관 방법', value: product.storage },
              ].map(item => (
                <View key={item.label} style={{ width: '47%', backgroundColor: '#F5F6F7', borderRadius: 10, padding: 12 }}>
                  <Text style={{ fontSize: 11, color: '#9AA3AF', marginBottom: 4 }}>{item.label}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: item.warn ? '#E5484D' : '#1F2933' }}>{item.value}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* 구매 전 주의사항 */}
          <View style={{ backgroundColor: '#FFF8E6', padding: 16, marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#FF8A3D' }}>⚠ 구매 전 꼭 확인해주세요</Text>
            </View>
            {[
              '이 상품은 소비기한이 임박한 상품입니다.',
              '구매 후 지정된 시간 안에 매장에서 직접 픽업해야 합니다.',
              '픽업 후에는 식품 특성상 단순 변심 환불이 어려울 수 있습니다.',
              '알레르기 정보와 보관 방법을 확인해주세요.',
            ].map((t, i) => (
              <Text key={i} style={{ fontSize: 13, color: '#7A5C1E', lineHeight: 22, marginTop: 2 }}>• {t}</Text>
            ))}
          </View>

          {/* 픽업 장소 지도 */}
          <View style={{ backgroundColor: '#fff', padding: 16, marginBottom: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#9AA3AF', marginBottom: 12 }}>픽업 장소</Text>
            <View style={{ height: 160, borderRadius: 14, backgroundColor: '#E8F4E8', overflow: 'hidden', marginBottom: 12, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 28 }}>📍</Text>
              <View style={{ marginTop: 6, backgroundColor: '#22A06B', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>{storeInfo.name}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MapPin size={13} color="#9AA3AF" />
              <Text style={{ flex: 1, fontSize: 13, color: '#9AA3AF' }}>{product.pickupAddress || storeInfo.address}</Text>
            </View>
          </View>

          {/* 상세 섹션 (아코디언) */}
          <View style={{ backgroundColor: '#fff', marginBottom: 8 }}>
            {sections.map((sec, idx) => (
              <View key={sec.key} style={idx > 0 ? { borderTopWidth: 1, borderTopColor: '#F5F6F7' } : undefined}>
                <TouchableOpacity
                  style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, paddingHorizontal: 16 }}
                  onPress={() => setExpandedSection(expandedSection === sec.key ? null : sec.key)}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#1F2933' }}>{sec.label}</Text>
                  {expandedSection === sec.key
                    ? <ChevronUp size={16} color="#9AA3AF" />
                    : <ChevronDown size={16} color="#9AA3AF" />}
                </TouchableOpacity>
                {expandedSection === sec.key && (
                  <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
                    <Text style={{ fontSize: 13, color: '#1F2933', lineHeight: 21 }}>{sec.content}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>

          <View style={{ height: 120 }} />
        </ScrollView>

        {/* 고정 하단 바 */}
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#F5F6F7', padding: 12, paddingBottom: 24, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          {!btnDisabled && (
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#E8EAED', borderRadius: 12, overflow: 'hidden' }}>
              <TouchableOpacity onPress={() => setQty(q => Math.max(1, q - 1))} style={{ width: 40, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 20, color: '#1F2933', fontWeight: '500' }}>−</Text>
              </TouchableOpacity>
              <Text style={{ width: 32, textAlign: 'center', fontSize: 16, fontWeight: '700', color: '#1F2933' }}>{qty}</Text>
              <TouchableOpacity onPress={() => setQty(q => Math.min(product.stock, q + 1))} style={{ width: 40, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 20, color: '#1F2933', fontWeight: '500' }}>+</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: btnDisabled ? '#9AA3AF' : '#22A06B', borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
            onPress={() => !btnDisabled && Alert.alert('미리보기', '실제 소비자 화면에서는 이 버튼으로 예약이 진행됩니다.')}
            disabled={btnDisabled}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{btnLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Helper Components ─────────────────────────────────────────
function InfoRow({ label, value, isLast = false }) {
  return (
    <View
      className="px-4 py-3"
      style={{ borderBottomWidth: isLast ? 0 : 1, borderBottomColor: '#F9FAFB' }}
    >
      <Text className="text-[13px] text-gray-400 mb-0.5">{label}</Text>
      <Text className="text-charcoal text-[15px]" numberOfLines={2}>{value || '-'}</Text>
    </View>
  );
}
