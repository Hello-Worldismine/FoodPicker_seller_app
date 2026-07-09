import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Image,
  Alert,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../store/appStore';
import {
  ChevronLeft,
  ChevronDown,
  Camera,
  Calendar,
  Clock,
  CheckSquare,
  Square,
  Plus,
  Minus,
  X,
} from 'lucide-react-native';

const CATEGORIES = [
  { key: '베이커리·디저트', emoji: '🥐' },
  { key: '도시락·간편식', emoji: '🍱' },
  { key: '샐러드·건강식', emoji: '🥗' },
  { key: '반찬·밀키트', emoji: '🥘' },
  { key: '채소·과일', emoji: '🥦' },
  { key: '정육·수산', emoji: '🥩' },
  { key: '음료·기타', emoji: '🧋' },
];
const STORAGE_METHODS = ['실온', '냉장', '냉동'];
const ALLERGEN_LIST = ['난류', '우유', '메밀', '땅콩', '대두', '밀', '고등어', '게', '새우', '돼지고기', '복숭아', '토마토'];
const INTERVAL_PRESETS = [
  { label: '10분',  minutes: 10 },
  { label: '30분',  minutes: 30 },
  { label: '1시간', minutes: 60 },
  { label: '2시간', minutes: 120 },
  { label: '3시간', minutes: 180 },
];

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const da = d.getDate().toString().padStart(2, '0');
  return `${yyyy}-${mo}-${da}`;
}

function formatTime(date) {
  if (!date) return '';
  const d = new Date(date);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function parseTimeToDate(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function parseDateStr(dateStr) {
  if (!dateStr) return new Date();
  const [y, mo, da] = dateStr.split('-').map(Number);
  const d = new Date();
  d.setFullYear(y, mo - 1, da);
  return d;
}

function formatIntervalLabel(minutes) {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  }
  return `${minutes}분`;
}

function formatDuration(hours, mins) {
  if (hours > 0 && mins > 0) return `${hours}시간 ${mins}분`;
  if (hours > 0) return `${hours}시간`;
  return `${mins}분`;
}

function getCategoryEmoji(cat) {
  return CATEGORIES.find(c => c.key === cat)?.emoji || '🛍️';
}

function toComma(raw) {
  if (!raw) return '';
  const n = parseInt(raw.replace(/,/g, ''), 10);
  return isNaN(n) ? '' : n.toLocaleString('ko-KR');
}
function fromComma(val) {
  return val.replace(/[^0-9]/g, '');
}

export default function ProductFormScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { products, addProduct, updateProduct } = useApp();

  const { productId } = route.params || {};
  const editProduct = productId ? products.find(p => p.id === productId) : null;
  const isEdit = !!editProduct;

  const [images, setImages] = useState(editProduct?.images?.length ? editProduct.images : (editProduct?.thumbnail ? [editProduct.thumbnail] : []));
  const [name, setName] = useState(editProduct?.name || '');
  const [category, setCategory] = useState(editProduct?.category || '');
  const [originalPrice, setOriginalPrice] = useState(editProduct?.originalPrice?.toString() || '');
  const [startPrice, setStartPrice] = useState(editProduct?.startPrice?.toString() || editProduct?.salePrice?.toString() || '');
  const [floorPrice, setFloorPrice] = useState(editProduct?.floorPrice?.toString() || '');
  const [reductionAmount, setReductionAmount] = useState(editProduct?.reductionAmount?.toString() || '');
  const [intervalMinutes, setIntervalMinutes] = useState(editProduct?.intervalMinutes || 30);
  const [stock, setStock] = useState(editProduct?.stock?.toString() || '');
  const [expiryDate, setExpiryDate] = useState(
    editProduct?.expiryDate ? formatDate(editProduct.expiryDate) : formatDate(new Date())
  );
  const [expiryTime, setExpiryTime] = useState(
    editProduct?.expiryDate ? formatTime(editProduct.expiryDate) : '23:59'
  );
  const [storage, setStorage] = useState(editProduct?.storage?.replace(' 보관', '') || '냉장');
  const [storageDetail, setStorageDetail] = useState(editProduct?.storageDetail || '');
  const [pickupStart, setPickupStart] = useState(
    editProduct?.pickupStart ? formatTime(editProduct.pickupStart) : '18:00'
  );
  const [pickupEnd, setPickupEnd] = useState(
    editProduct?.pickupEnd ? formatTime(editProduct.pickupEnd) : '20:00'
  );
  const [description, setDescription] = useState(editProduct?.description || '');
  const [composition, setComposition] = useState(editProduct?.composition || '');
  const [allergens, setAllergens] = useState(editProduct?.allergens || []);
  const [otherAllergen, setOtherAllergen] = useState('');
  const [noAllergen, setNoAllergen] = useState(editProduct?.allergens?.length === 0);
  const [storeNotice, setStoreNotice] = useState(editProduct?.storeNotice || '');
  const [cancelPolicy, setCancelPolicy] = useState(editProduct?.cancelPolicy || '픽업 전까지 취소 가능. 픽업 후 단순 변심 환불 불가.');

  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState('date');
  const [pickerTarget, setPickerTarget] = useState('');
  const [pickerValue, setPickerValue] = useState(new Date());

  const [showIntervalDropdown, setShowIntervalDropdown] = useState(false);
  const [intervalDropdownPos, setIntervalDropdownPos] = useState({ top: 0 });

  // 가격 유효성 검사
  const startPriceError = !!(startPrice && originalPrice &&
    parseInt(startPrice) >= parseInt(originalPrice));
  const floorPriceError = !!(floorPrice && startPrice &&
    parseInt(floorPrice) >= parseInt(startPrice));
  const reductionError = !!(reductionAmount && startPrice && floorPrice &&
    !startPriceError && !floorPriceError &&
    parseInt(reductionAmount) > (parseInt(startPrice) - parseInt(floorPrice)));

  // 소비기한(날짜+시간)이 픽업 종료(오늘 날짜 기준 시각)보다 빠른 경우만 오류.
  // 소비기한 날짜가 오늘보다 미래라면 시간 비교와 무관하게 항상 통과해야 한다.
  const expiryTimeError = useMemo(() => {
    if (!expiryDate || !expiryTime || !pickupEnd) return false;
    const [ey, em, ed] = expiryDate.split('-').map(Number);
    const [eh, emi] = expiryTime.split(':').map(Number);
    const expiryDateTime = new Date(ey, em - 1, ed, eh, emi, 0);

    const [ph, pm] = pickupEnd.split(':').map(Number);
    const pickupEndDateTime = new Date();
    pickupEndDateTime.setHours(ph, pm, 0, 0);

    return expiryDateTime < pickupEndDateTime;
  }, [expiryDate, expiryTime, pickupEnd]);

  const discountRate = originalPrice && startPrice && !startPriceError
    ? Math.round((1 - parseInt(startPrice) / parseInt(originalPrice)) * 100)
    : 0;

  // 하한가 도달 소요 시간 계산
  // 시작가에서 회당 인하 금액씩 낮추면 몇 회 만에 하한가에 도달하는지 계산
  const timeToFloor = useMemo(() => {
    const start = parseInt(startPrice);
    const floor = parseInt(floorPrice);
    const reduction = parseInt(reductionAmount);
    if (!start || !floor || !reduction || reduction <= 0 || start <= floor) return null;
    const steps = Math.ceil((start - floor) / reduction);
    const totalMinutes = steps * intervalMinutes;
    return {
      steps,
      hours: Math.floor(totalMinutes / 60),
      mins: totalMinutes % 60,
    };
  }, [startPrice, floorPrice, reductionAmount, intervalMinutes]);

  function openIntervalDropdown(evt) {
    const { pageY } = evt.nativeEvent;
    const screenHeight = Dimensions.get('window').height;
    const dropdownHeight = INTERVAL_PRESETS.length * 51;
    const top = pageY + 10 + dropdownHeight > screenHeight
      ? pageY - dropdownHeight - 6
      : pageY + 10;
    setIntervalDropdownPos({ top });
    setShowIntervalDropdown(true);
  }

  function openPicker(target, mode) {
    let currentVal = new Date();
    if (target === 'expiryDate') currentVal = parseDateStr(expiryDate);
    if (target === 'expiryTime') currentVal = parseTimeToDate(expiryTime);
    if (target === 'pickupStart') currentVal = parseTimeToDate(pickupStart);
    if (target === 'pickupEnd') currentVal = parseTimeToDate(pickupEnd);
    setPickerValue(currentVal);
    setPickerTarget(target);
    setPickerMode(mode);
    setPickerVisible(true);
  }

  function handlePickerChange(event, date) {
    if (Platform.OS === 'android') setPickerVisible(false);
    if (!date) return;
    if (pickerTarget === 'expiryDate') setExpiryDate(formatDate(date));
    if (pickerTarget === 'expiryTime') setExpiryTime(formatTime(date));
    if (pickerTarget === 'pickupStart') setPickupStart(formatTime(date));
    if (pickerTarget === 'pickupEnd') setPickupEnd(formatTime(date));
  }

  async function pickImage() {
    if (images.length >= 10) {
      Alert.alert('알림', '이미지는 최대 10장까지 등록할 수 있습니다.');
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('권한 필요', '사진 접근 권한이 필요합니다.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      setImages(prev => [...prev, result.assets[0].uri].slice(0, 10));
    }
  }

  function removeImage(idx) {
    setImages(prev => prev.filter((_, i) => i !== idx));
  }

  function setRepresentative(idx) {
    if (idx === 0) return;
    setImages(prev => {
      const next = [...prev];
      const [picked] = next.splice(idx, 1);
      return [picked, ...next];
    });
  }

  function adjustStock(delta) {
    setStock(s => String(Math.max(0, (parseInt(s) || 0) + delta)));
  }

  function toggleAllergen(item) {
    setNoAllergen(false);
    setAllergens(prev => prev.includes(item) ? prev.filter(a => a !== item) : [...prev, item]);
  }

  function handleNoAllergen() {
    setNoAllergen(!noAllergen);
    if (!noAllergen) setAllergens([]);
  }

  // 등록/수정: addProduct/updateProduct → api(insertProduct/updateProductData) → Supabase.
  // 이미지는 api 계층의 uploadImages가 로컬 URI를 Storage에 업로드 후 public URL로 치환한다.
  function validateAndSubmit() {
    if (!name.trim()) { Alert.alert('오류', '상품명을 입력해주세요.'); return; }
    if (!category) { Alert.alert('오류', '카테고리를 선택해주세요.'); return; }
    if (!originalPrice || isNaN(parseInt(originalPrice))) { Alert.alert('오류', '정상가를 입력해주세요.'); return; }
    if (!startPrice || isNaN(parseInt(startPrice))) { Alert.alert('오류', '시작가를 입력해주세요.'); return; }
    if (!floorPrice || isNaN(parseInt(floorPrice))) { Alert.alert('오류', '하한가를 입력해주세요.'); return; }
    if (startPriceError) { Alert.alert('오류', '시작가는 정상가보다 낮아야 합니다.'); return; }
    if (floorPriceError) { Alert.alert('오류', '하한가는 시작가보다 낮아야 합니다.'); return; }
    if (reductionError) { Alert.alert('오류', '회당 인하 금액은 (시작가 - 하한가)를 초과할 수 없습니다.'); return; }
    if (expiryTimeError) { Alert.alert('오류', '소비기한은 픽업 종료 시간보다 빠를 수 없습니다.'); return; }
    if (!stock || isNaN(parseInt(stock))) { Alert.alert('오류', '판매 수량을 입력해주세요.'); return; }

    const [ey, em, ed] = expiryDate.split('-').map(Number);
    const [eth, etm] = expiryTime.split(':').map(Number);
    const expDate = new Date(ey, em - 1, ed, eth, etm, 0);

    const [psh, psm] = pickupStart.split(':').map(Number);
    const [peh, pem] = pickupEnd.split(':').map(Number);
    const psDate = new Date(); psDate.setHours(psh, psm, 0, 0);
    const peDate = new Date(); peDate.setHours(peh, pem, 0, 0);

    // 프리셋 목록 외 '기타 알레르기 직접 입력' 값도 병합(중복 제외).
    const extraAllergen = otherAllergen.trim();
    const mergedAllergens = noAllergen
      ? []
      : [...allergens, ...(extraAllergen && !allergens.includes(extraAllergen) ? [extraAllergen] : [])];
    const allergyInfo = noAllergen ? '해당 없음' : mergedAllergens.join(', ') + (mergedAllergens.length > 0 ? ' 함유' : '');

    const productData = {
      name: name.trim(),
      category,
      thumbnail: images[0] || null,
      images,
      emoji: getCategoryEmoji(category),
      originalPrice: parseInt(originalPrice),
      startPrice: parseInt(startPrice),
      floorPrice: parseInt(floorPrice),
      salePrice: parseInt(startPrice),
      discountRate,
      reductionAmount: reductionAmount ? parseInt(reductionAmount) : null,
      intervalMinutes,
      stock: parseInt(stock),
      expiryDate: expDate.toISOString(),
      storage,
      storageDetail: storageDetail.trim(),
      pickupStart: psDate.toISOString(),
      pickupEnd: peDate.toISOString(),
      description: description.trim(),
      composition: composition.trim(),
      allergens: mergedAllergens,
      allergyInfo,
      storeNotice: storeNotice.trim(),
      cancelPolicy: cancelPolicy.trim(),
    };

    if (isEdit) {
      updateProduct(productId, productData);
      Alert.alert('완료', '상품이 수정되었습니다.', [{ text: '확인', onPress: () => navigation.goBack() }]);
    } else {
      addProduct(productData);
      Alert.alert('등록 완료', '상품이 등록되어 즉시 판매가 시작됩니다.', [{ text: '확인', onPress: () => navigation.goBack() }]);
    }
  }

  // 공통 스타일
  const card = { backgroundColor: '#fff', borderRadius: 16, marginHorizontal: 16, marginBottom: 12, padding: 16, elevation: 1 };
  const cardTitle = { fontSize: 17, fontWeight: '700', color: '#1F2933', marginBottom: 14 };
  const fieldLabel = { fontSize: 13, color: '#9AA3AF', marginBottom: 6, fontWeight: '500' };
  const unitText = { fontSize: 14, color: '#9AA3AF' };
  const borderedInput = { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1F2933', borderWidth: 1, borderColor: '#E5E7EB' };

  function priceInputBox(hasError) {
    return {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: '#F5F6F7', borderRadius: 10, paddingHorizontal: 14,
      ...(hasError ? { borderWidth: 1.5, borderColor: '#E5484D' } : {}),
    };
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F6F7' }}>
      {/* 헤더 */}
      <View style={{ backgroundColor: '#fff', paddingTop: insets.top + 12, paddingBottom: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', alignItems: 'center' }}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 10, padding: 4 }}>
          <ChevronLeft color="#1F2933" size={24} />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: '700', color: '#1F2933' }}>
          {isEdit ? '상품 수정' : '상품 등록'}
        </Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 16, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>

          {/* 상품 이미지 */}
          <View style={card}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={cardTitle}>상품 이미지 <Text style={{ color: '#E5484D' }}>*</Text></Text>
              <Text style={{ fontSize: 13, color: '#9AA3AF' }}>{images.length}/10</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {images.map((uri, idx) => (
                  <TouchableOpacity
                    key={idx}
                    activeOpacity={0.85}
                    onPress={() => setRepresentative(idx)}
                    style={{
                      width: 100, height: 100, borderRadius: 12, overflow: 'hidden',
                      borderWidth: idx === 0 ? 2.5 : 0,
                      borderColor: '#22A06B',
                    }}
                  >
                    <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                    {/* 삭제 버튼 */}
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => removeImage(idx)}
                      style={{ position: 'absolute', top: 5, right: 5, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, padding: 3 }}
                    >
                      <X color="#fff" size={13} />
                    </TouchableOpacity>
                    {/* 대표 / 대표 설정 배지 */}
                    <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: idx === 0 ? 'rgba(34,160,107,0.85)' : 'rgba(0,0,0,0.45)', paddingVertical: 4 }}>
                      <Text style={{ color: '#fff', fontSize: 11, textAlign: 'center', fontWeight: '700' }}>
                        {idx === 0 ? '대표' : '탭하여 대표 설정'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
                {images.length < 10 && (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={pickImage}
                    style={{ width: 100, height: 100, borderRadius: 12, backgroundColor: '#F5F6F7', borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Camera color="#9AA3AF" size={24} />
                    <Text style={{ color: '#9AA3AF', fontSize: 12, marginTop: 6 }}>사진 추가</Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
            {images.length === 0 && (
              <Text style={{ fontSize: 12, color: '#E5484D', marginTop: 8 }}>최소 1장 이상 등록해주세요.</Text>
            )}
          </View>

          {/* 기본 정보 */}
          <View style={card}>
            <Text style={cardTitle}>기본 정보</Text>
            <Text style={fieldLabel}>상품명 <Text style={{ color: '#E5484D' }}>*</Text></Text>
            <TextInput
              style={[borderedInput, { marginBottom: 14 }]}
              placeholder="상품명을 입력하세요"
              placeholderTextColor="#C4C9D0"
              value={name}
              onChangeText={setName}
            />
            <Text style={fieldLabel}>카테고리 <Text style={{ color: '#E5484D' }}>*</Text></Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat.key}
                  activeOpacity={1}
                  onPress={() => setCategory(cat.key)}
                  style={{
                    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
                    backgroundColor: category === cat.key ? '#22A06B' : '#fff',
                    borderWidth: 1, borderColor: category === cat.key ? '#22A06B' : '#E5E7EB',
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: category === cat.key ? '#fff' : '#6B7280' }}>
                    {cat.key}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* 가격 설정 */}
          <View style={card}>
            <Text style={cardTitle}>가격 설정</Text>

            <Text style={fieldLabel}>정상가 <Text style={{ color: '#E5484D' }}>*</Text></Text>
            <View style={[priceInputBox(false), { marginBottom: 12 }]}>
              <TextInput
                style={{ flex: 1, fontSize: 15, color: '#1F2933', paddingVertical: 12 }}
                placeholder="정상가를 입력하세요"
                placeholderTextColor="#C4C9D0"
                keyboardType="numeric"
                value={toComma(originalPrice)}
                onChangeText={v => setOriginalPrice(fromComma(v))}
              />
              <Text style={unitText}>원</Text>
            </View>

            <Text style={fieldLabel}>시작가 <Text style={{ color: '#E5484D' }}>*</Text></Text>
            <View style={[priceInputBox(startPriceError), { marginBottom: startPriceError ? 4 : 12 }]}>
              <TextInput
                style={{ flex: 1, fontSize: 15, color: '#1F2933', paddingVertical: 12 }}
                placeholder="판매 시작 가격을 입력하세요"
                placeholderTextColor="#C4C9D0"
                keyboardType="numeric"
                value={toComma(startPrice)}
                onChangeText={v => setStartPrice(fromComma(v))}
              />
              <Text style={unitText}>원</Text>
            </View>
            {startPriceError && (
              <Text style={{ fontSize: 12, color: '#E5484D', marginBottom: 12 }}>정상가보다 높게 설정할 수 없습니다.</Text>
            )}

            <Text style={fieldLabel}>하한가 <Text style={{ color: '#E5484D' }}>*</Text></Text>
            <View style={[priceInputBox(floorPriceError), { marginBottom: floorPriceError ? 4 : (discountRate > 0 ? 12 : 0) }]}>
              <TextInput
                style={{ flex: 1, fontSize: 15, color: '#1F2933', paddingVertical: 12 }}
                placeholder="최저 판매 가격을 입력하세요"
                placeholderTextColor="#C4C9D0"
                keyboardType="numeric"
                value={toComma(floorPrice)}
                onChangeText={v => setFloorPrice(fromComma(v))}
              />
              <Text style={unitText}>원</Text>
            </View>
            {floorPriceError && (
              <Text style={{ fontSize: 12, color: '#E5484D', marginBottom: discountRate > 0 ? 12 : 0 }}>시작가보다 낮게 설정해야 합니다.</Text>
            )}

            {discountRate > 0 && (
              <View style={{ backgroundColor: '#E9F8F1', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: '#22A06B', fontWeight: '700', fontSize: 18 }}>{discountRate}%</Text>
                <Text style={{ color: '#22A06B', fontSize: 14 }}>할인 (정상가 대비 시작가)</Text>
              </View>
            )}
          </View>

          {/* 가격 인하 설정 */}
          <View style={card}>
            <Text style={cardTitle}>가격 인하 설정</Text>

            <Text style={fieldLabel}>인하 간격</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setIntervalMinutes(m => Math.max(10, m - 10))}
                style={{ width: 44, height: 44, backgroundColor: '#F5F6F7', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}
              >
                <Minus color="#374151" size={16} />
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={1}
                onPress={(evt) => openIntervalDropdown(evt)}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F5F6F7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 }}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: '#1F2933' }}>
                  {formatIntervalLabel(intervalMinutes)}
                </Text>
                <ChevronDown color="#9AA3AF" size={16} />
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setIntervalMinutes(m => Math.min(180, m + 10))}
                style={{ width: 44, height: 44, backgroundColor: '#F5F6F7', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}
              >
                <Plus color="#374151" size={16} />
              </TouchableOpacity>
            </View>

            <Text style={fieldLabel}>회당 인하 금액</Text>
            <View style={[priceInputBox(reductionError), { marginBottom: reductionError ? 4 : (timeToFloor ? 12 : 0) }]}>
              <TextInput
                style={{ flex: 1, fontSize: 15, color: '#1F2933', paddingVertical: 12 }}
                placeholder="인하 금액을 입력하세요"
                placeholderTextColor="#C4C9D0"
                keyboardType="numeric"
                value={toComma(reductionAmount)}
                onChangeText={v => setReductionAmount(fromComma(v))}
              />
              <Text style={unitText}>원</Text>
            </View>

            {reductionError && (
              <Text style={{ fontSize: 12, color: '#E5484D', marginBottom: timeToFloor ? 12 : 0 }}>
                회당 인하 금액은 (시작가 - 하한가)를 초과할 수 없습니다.
              </Text>
            )}
            {timeToFloor !== null && !reductionError && (
              <View style={{ backgroundColor: '#E9F8F1', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 }}>
                <Text style={{ fontSize: 14, color: '#22A06B', fontWeight: '600' }}>
                  {`하한가 도달까지 ${formatDuration(timeToFloor.hours, timeToFloor.mins)}이 소요됩니다. (총 ${timeToFloor.steps}회 인하)`}
                </Text>
              </View>
            )}
          </View>

          {/* 판매 수량 */}
          <View style={card}>
            <Text style={cardTitle}>판매 수량 <Text style={{ color: '#E5484D' }}>*</Text></Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => adjustStock(-1)}
                style={{ width: 44, height: 44, backgroundColor: '#F5F6F7', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}
              >
                <Minus color="#374151" size={16} />
              </TouchableOpacity>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F6F7', borderRadius: 10, paddingHorizontal: 14 }}>
                <TextInput
                  style={{ flex: 1, fontSize: 15, color: '#1F2933', paddingVertical: 12, textAlign: 'center' }}
                  placeholder="0"
                  placeholderTextColor="#C4C9D0"
                  keyboardType="numeric"
                  value={stock}
                  onChangeText={setStock}
                />
                <Text style={unitText}>개</Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => adjustStock(1)}
                style={{ width: 44, height: 44, backgroundColor: '#F5F6F7', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}
              >
                <Plus color="#374151" size={16} />
              </TouchableOpacity>
            </View>
          </View>

          {/* 소비기한 */}
          <View style={card}>
            <Text style={cardTitle}>소비기한 <Text style={{ color: '#E5484D' }}>*</Text></Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => openPicker('expiryDate', 'date')}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F5F6F7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 }}
              >
                <Text style={{ fontSize: 15, color: '#1F2933' }}>{expiryDate}</Text>
                <Calendar color="#9AA3AF" size={15} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => openPicker('expiryTime', 'time')}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: expiryTimeError ? '#FFF0F0' : '#F5F6F7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, borderWidth: expiryTimeError ? 1.5 : 0, borderColor: '#E5484D' }}
              >
                <Text style={{ fontSize: 15, color: expiryTimeError ? '#E5484D' : '#1F2933' }}>{expiryTime}</Text>
                <Clock color={expiryTimeError ? '#E5484D' : '#9AA3AF'} size={15} />
              </TouchableOpacity>
            </View>
            {expiryTimeError && (
              <Text style={{ fontSize: 12, color: '#E5484D', marginTop: 6 }}>소비기한은 픽업 종료 시간({pickupEnd})보다 빠를 수 없습니다.</Text>
            )}
          </View>

          {/* 보관 방법 */}
          <View style={card}>
            <Text style={cardTitle}>보관 방법 <Text style={{ color: '#E5484D' }}>*</Text></Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {STORAGE_METHODS.map(key => (
                <TouchableOpacity
                  key={key}
                  activeOpacity={1}
                  onPress={() => setStorage(key)}
                  style={{
                    flex: 1, alignItems: 'center', justifyContent: 'center',
                    paddingVertical: 12, borderRadius: 10, borderWidth: 1,
                    backgroundColor: storage === key ? '#22A06B' : '#fff',
                    borderColor: storage === key ? '#22A06B' : '#E5E7EB',
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: storage === key ? '#fff' : '#6B7280' }}>{key}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={fieldLabel}>상세 보관 방법 (선택)</Text>
            <TextInput
              style={borderedInput}
              placeholder="예: 냉장(0~5°C) 보관, 개봉 후 즉시 섭취 권장"
              placeholderTextColor="#C4C9D0"
              value={storageDetail}
              onChangeText={setStorageDetail}
            />
          </View>

          {/* 픽업 가능 시간 */}
          <View style={card}>
            <Text style={cardTitle}>픽업 가능 시간 <Text style={{ color: '#E5484D' }}>*</Text></Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={fieldLabel}>픽업 시작</Text>
                <TouchableOpacity
                  onPress={() => openPicker('pickupStart', 'time')}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F5F6F7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 }}
                >
                  <Text style={{ fontSize: 15, color: '#1F2933' }}>{pickupStart}</Text>
                  <Clock color="#9AA3AF" size={15} />
                </TouchableOpacity>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={fieldLabel}>픽업 종료</Text>
                <TouchableOpacity
                  onPress={() => openPicker('pickupEnd', 'time')}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F5F6F7', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 }}
                >
                  <Text style={{ fontSize: 15, color: '#1F2933' }}>{pickupEnd}</Text>
                  <Clock color="#9AA3AF" size={15} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* 상품 설명 */}
          <View style={card}>
            <Text style={cardTitle}>상품 설명</Text>
            <TextInput
              style={[borderedInput, { marginBottom: 14, minHeight: 80, textAlignVertical: 'top' }]}
              placeholder="상품에 대한 간단한 설명을 입력하세요"
              placeholderTextColor="#C4C9D0"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              value={description}
              onChangeText={setDescription}
            />
            <Text style={fieldLabel}>상품 구성</Text>
            <TextInput
              style={[borderedInput, { textAlignVertical: 'top' }]}
              placeholder="예: 닭가슴살 150g, 로메인 80g, 드레싱 15ml"
              placeholderTextColor="#C4C9D0"
              multiline
              numberOfLines={2}
              textAlignVertical="top"
              value={composition}
              onChangeText={setComposition}
            />
          </View>

          {/* 알레르기 정보 */}
          <View style={card}>
            <Text style={cardTitle}>알레르기 정보</Text>
            <View
              style={{ opacity: noAllergen ? 0.4 : 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}
              pointerEvents={noAllergen ? 'none' : 'auto'}
            >
              {ALLERGEN_LIST.map(a => {
                const selected = allergens.includes(a);
                return (
                  <TouchableOpacity
                    key={a}
                    activeOpacity={1}
                    onPress={() => toggleAllergen(a)}
                    style={{
                      paddingHorizontal: 13, paddingVertical: 8, borderRadius: 8, borderWidth: 1,
                      backgroundColor: selected ? '#FFF4ED' : '#F9FAFB',
                      borderColor: selected ? '#FF8A3D' : '#E5E7EB',
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: selected ? '#FF8A3D' : '#9AA3AF' }}>
                      {a}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ opacity: noAllergen ? 0.4 : 1, marginBottom: 12 }} pointerEvents={noAllergen ? 'none' : 'auto'}>
              <TextInput
                style={borderedInput}
                placeholder="기타 알레르기 직접 입력"
                placeholderTextColor="#C4C9D0"
                value={otherAllergen}
                onChangeText={setOtherAllergen}
              />
            </View>
            <TouchableOpacity activeOpacity={1} onPress={handleNoAllergen} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {noAllergen ? <CheckSquare color="#22A06B" size={20} /> : <Square color="#9AA3AF" size={20} />}
              <Text style={{ fontSize: 14, color: '#6B7280' }}>해당 알레르기 성분 없음</Text>
            </TouchableOpacity>
          </View>

          {/* 매장 공지 및 정책 */}
          <View style={card}>
            <Text style={cardTitle}>매장 공지 및 정책</Text>
            <Text style={{ fontSize: 13, color: '#9AA3AF', marginTop: -8, marginBottom: 14 }}>결제 완료 시 고객에게 전달되는 내용입니다.</Text>
            <Text style={fieldLabel}>매장 공지 (선택)</Text>
            <TextInput
              style={[borderedInput, { marginBottom: 14, textAlignVertical: 'top' }]}
              placeholder="예: 픽업 시 영수증을 보여주세요."
              placeholderTextColor="#C4C9D0"
              multiline
              numberOfLines={2}
              textAlignVertical="top"
              value={storeNotice}
              onChangeText={setStoreNotice}
            />
            <Text style={fieldLabel}>취소/환불 정책</Text>
            <TextInput
              style={[borderedInput, { textAlignVertical: 'top' }]}
              placeholder="취소 및 환불 정책"
              placeholderTextColor="#C4C9D0"
              multiline
              numberOfLines={2}
              textAlignVertical="top"
              value={cancelPolicy}
              onChangeText={setCancelPolicy}
            />
          </View>

        </ScrollView>

        {/* 등록 버튼 */}
        <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 12 }}>
          <TouchableOpacity
            activeOpacity={0.85}
            style={{ backgroundColor: '#22A06B', borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}
            onPress={validateAndSubmit}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
              {isEdit ? '수정 완료' : '상품 등록하기'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* 인하 간격 드롭다운 */}
      <Modal visible={showIntervalDropdown} transparent animationType="none" onRequestClose={() => setShowIntervalDropdown(false)}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowIntervalDropdown(false)}>
          <View style={{
            position: 'absolute',
            top: intervalDropdownPos.top,
            left: 16,
            right: 16,
            backgroundColor: '#fff',
            borderRadius: 12,
            borderWidth: 1,
            borderColor: '#E5E7EB',
            elevation: 10,
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
            overflow: 'hidden',
          }}>
            {INTERVAL_PRESETS.map(({ label, minutes }, idx) => (
              <TouchableOpacity
                key={minutes}
                activeOpacity={0.7}
                onPress={() => { setIntervalMinutes(minutes); setShowIntervalDropdown(false); }}
                style={{
                  paddingHorizontal: 18, paddingVertical: 14,
                  backgroundColor: intervalMinutes === minutes ? '#E9F8F1' : '#fff',
                  borderBottomWidth: idx < INTERVAL_PRESETS.length - 1 ? 1 : 0,
                  borderBottomColor: '#F3F4F6',
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: intervalMinutes === minutes ? '#22A06B' : '#374151' }}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 날짜/시간 피커 */}
      {pickerVisible && (
        Platform.OS === 'ios' ? (
          <Modal visible transparent animationType="slide">
            <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
              <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
                  <TouchableOpacity onPress={() => setPickerVisible(false)}>
                    <Text style={{ color: '#9AA3AF', fontSize: 15 }}>취소</Text>
                  </TouchableOpacity>
                  <Text style={{ fontWeight: '700', fontSize: 15, color: '#1F2933' }}>
                    {pickerMode === 'date' ? '날짜 선택' : '시간 선택'}
                  </Text>
                  <TouchableOpacity onPress={() => setPickerVisible(false)}>
                    <Text style={{ color: '#22A06B', fontWeight: '600', fontSize: 15 }}>확인</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={pickerValue}
                  mode={pickerMode}
                  display="spinner"
                  onChange={(e, d) => { if (d) { setPickerValue(d); handlePickerChange(e, d); } }}
                  locale="ko-KR"
                />
              </View>
            </View>
          </Modal>
        ) : (
          <DateTimePicker
            value={pickerValue}
            mode={pickerMode}
            display="default"
            onChange={(e, d) => { handlePickerChange(e, d); }}
          />
        )
      )}
    </View>
  );
}
