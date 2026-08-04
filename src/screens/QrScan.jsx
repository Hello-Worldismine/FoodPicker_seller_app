// 주문 QR 스캔 → 픽업 완료 처리.
// 사용자앱은 주문 QR 에 평문 주문번호(FP-1024)를 담는다(react-native-qrcode-svg).
// 스캔값에서 FP-#### 만 추출 → lookup_order_for_pickup 으로 확인 → complete_pickup 으로 확정.
import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { X, QrCode, CheckCircle, Camera as CameraIcon, Search } from 'lucide-react-native';
import { useApp, formatPickupDeadline, formatDeadlineDuration, pickupErrorMessage } from '../store/appStore';
import { parseOrderCode } from '../lib/api';
import { formatPrice } from '../lib/format';

const SCAN_COOLDOWN_MS = 2000; // 같은 QR 연속 발화 차단

export default function QrScanScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { completePickup, lookupOrderForPickup } = useApp();
  const [permission, requestPermission] = useCameraPermissions();

  const [busy, setBusy] = useState(false);          // 조회/완료 처리 중
  const [confirm, setConfirm] = useState(null);     // 확인 시트에 띄울 주문
  const [manualCode, setManualCode] = useState(''); // 직접 입력 폴백
  const [hint, setHint] = useState('QR 코드를 사각형 안에 맞춰주세요');

  // onBarcodeScanned 는 프레임마다 발화한다 → ref 플래그로 중복 처리 차단.
  const lockRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const unlockAfterCooldown = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { lockRef.current = false; }, SCAN_COOLDOWN_MS);
  }, []);

  // 주문번호 → 확인 시트. 실패 사유는 즉시 안내하고 쿨다운 후 재스캔 허용.
  const openConfirm = useCallback(async (raw) => {
    const code = parseOrderCode(raw);
    if (!code) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setHint('푸드피커 주문 QR 이 아닙니다. 다시 스캔해주세요.');
      unlockAfterCooldown();
      return;
    }
    setBusy(true);
    try {
      const order = await lookupOrderForPickup(code);
      if (!order) {
        // RLS(security invoker)로 본인 매장 주문만 조회된다 → null = 없거나 타 매장 주문.
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        Alert.alert('픽업 처리 불가', '우리 매장 주문이 아닙니다.');
        setHint('QR 코드를 사각형 안에 맞춰주세요');
        unlockAfterCooldown();
        return;
      }
      Haptics.selectionAsync().catch(() => {});
      setConfirm(order);
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      Alert.alert('조회 실패', pickupErrorMessage(e));
      unlockAfterCooldown();
    } finally {
      setBusy(false);
    }
  }, [lookupOrderForPickup, unlockAfterCooldown]);

  function handleBarcodeScanned({ data }) {
    if (lockRef.current || busy || confirm) return;
    lockRef.current = true;
    openConfirm(data);
  }

  function handleManualSubmit() {
    const raw = manualCode.trim();
    if (!raw) return;
    if (lockRef.current || busy || confirm) return;
    lockRef.current = true;
    openConfirm(raw);
  }

  // 확인 시트에서 '픽업 완료' 확정.
  async function handleComplete() {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      await completePickup(confirm.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setConfirm(null);
      setManualCode('');
      Alert.alert(
        '픽업 완료',
        `${confirm.id}\n${confirm.productName} ${confirm.quantity}개 픽업이 완료되었습니다.`,
        [{ text: '확인', onPress: () => navigation.goBack() }],
      );
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setConfirm(null);
      Alert.alert('픽업 처리 불가', pickupErrorMessage(e));
      unlockAfterCooldown();
    } finally {
      setBusy(false);
    }
  }

  function closeConfirm() {
    setConfirm(null);
    setHint('QR 코드를 사각형 안에 맞춰주세요');
    unlockAfterCooldown();
  }

  // 확인 시트에서 미리 막을 수 있는 사유(서버도 동일하게 재검증한다).
  const blockReason = !confirm
    ? null
    : confirm.sellerStatus === 'completed' ? '이미 픽업 완료된 주문입니다.'
    : confirm.sellerStatus === 'cancelled' ? '취소된 주문입니다.'
    : confirm.paymentStatus !== 'paid' ? '결제가 완료되지 않은 주문입니다.'
    : null;

  const granted = !!permission?.granted;

  return (
    <View style={{ flex: 1, backgroundColor: '#1F2933' }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 2 }}>
          <X color="#fff" size={24} />
        </TouchableOpacity>
        <QrCode color="#22A06B" size={20} />
        <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>QR 픽업 완료</Text>
      </View>

      {/* Camera / 권한 안내 */}
      <View style={{ flex: 1 }}>
        {granted ? (
          <View style={{ flex: 1 }}>
            {isFocused && (
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={busy || confirm ? undefined : handleBarcodeScanned}
              />
            )}
            {/* 스캔 가이드 프레임 */}
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 232, height: 232, borderWidth: 3, borderColor: '#22A06B', borderRadius: 20 }} />
              <Text style={{ color: '#fff', fontSize: 14, marginTop: 16, textAlign: 'center', paddingHorizontal: 24 }}>
                {hint}
              </Text>
            </View>
            {busy && (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color="#fff" size="large" />
              </View>
            )}
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <CameraIcon color="#fff" size={28} />
            </View>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 8, textAlign: 'center' }}>
              카메라 권한이 필요합니다
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 20 }}>
              주문 QR 코드를 스캔하려면 카메라 접근을 허용해주세요.{'\n'}
              허용하지 않아도 아래에서 주문번호를 직접 입력할 수 있습니다.
            </Text>
            <TouchableOpacity
              onPress={requestPermission}
              style={{ backgroundColor: '#22A06B', borderRadius: 12, paddingHorizontal: 22, paddingVertical: 13 }}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>카메라 권한 허용</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 주문번호 직접 입력 폴백 (카메라 불가 / QR 훼손 대비) */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ backgroundColor: '#111827', paddingHorizontal: 16, paddingTop: 14, paddingBottom: insets.bottom + 14 }}>
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginBottom: 8 }}>주문번호 직접 입력</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              value={manualCode}
              onChangeText={setManualCode}
              placeholder="FP-1024"
              placeholderTextColor="#6B7280"
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={handleManualSubmit}
              style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 15 }}
            />
            <TouchableOpacity
              onPress={handleManualSubmit}
              disabled={!manualCode.trim() || busy}
              style={{
                backgroundColor: !manualCode.trim() || busy ? '#374151' : '#22A06B',
                borderRadius: 10, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center',
                flexDirection: 'row', gap: 6,
              }}
            >
              <Search color="#fff" size={16} />
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>조회</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* 확인 시트 */}
      <Modal visible={!!confirm} transparent animationType="slide" onRequestClose={closeConfirm}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 20, paddingBottom: insets.bottom + 16 }}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ backgroundColor: '#E9F8F1', borderRadius: 50, padding: 12, marginBottom: 10 }}>
                <CheckCircle color="#22A06B" size={26} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2933' }}>픽업 완료 확인</Text>
              <Text style={{ fontSize: 13, color: '#9AA3AF', marginTop: 4 }}>{confirm?.id}</Text>
            </View>

            <View style={{ backgroundColor: '#F5F6F7', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 }}>
              <Row label="상품" value={`${confirm?.productName ?? ''}`} />
              <Row label="수량" value={`${confirm?.quantity ?? 0}개`} />
              <Row label="구매자" value={confirm?.buyerName || '-'} />
              <Row
                label="픽업 마감"
                value={confirm ? `${formatPickupDeadline(confirm)}${confirm.pickupDeadlineMinutes ? ` (주문 후 ${formatDeadlineDuration(confirm.pickupDeadlineMinutes)})` : ''}` : ''}
              />
              <Row label="결제 금액" value={`${formatPrice(confirm?.totalPrice ?? 0)}원`} last />
            </View>

            {blockReason && (
              <View style={{ backgroundColor: '#FFF0F0', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 14 }}>
                <Text style={{ fontSize: 13, color: '#E5484D', fontWeight: '600' }}>{blockReason}</Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={closeConfirm}
                style={{ flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ color: '#374151', fontSize: 15, fontWeight: '600' }}>{blockReason ? '닫기' : '취소'}</Text>
              </TouchableOpacity>
              {!blockReason && (
                <TouchableOpacity
                  onPress={handleComplete}
                  disabled={busy}
                  style={{ flex: 1, backgroundColor: busy ? '#8FCFB4' : '#22A06B', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
                >
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>픽업 완료</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ label, value, last }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: last ? 0 : 8 }}>
      <Text style={{ fontSize: 13, color: '#6B7280', marginRight: 12 }}>{label}</Text>
      <Text style={{ fontSize: 14, color: '#1F2933', fontWeight: '600', flex: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}
