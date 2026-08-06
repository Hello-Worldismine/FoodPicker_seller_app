// 판매자앱 푸시 알림(Expo Push + FCM) 등록.
//
// [배경] 관리자 쿠폰 '매장 지정 발급' 요구사항에 "판매자 어플 푸시알림" 이 있는데,
//        기존 푸시 경로는 구매자 전용이었다(push_tokens.buyer_id + buyer_notifications 트리거).
//        마이그레이션 20260728020000_seller_push.sql 이 seller_push_tokens 테이블과
//        notifications AFTER INSERT 트리거를 추가했고, 이 모듈이 그 토큰을 등록한다.
//        notifications 는 쿠폰뿐 아니라 주문/정산/리뷰/공지 알림에도 쓰이므로
//        판매자앱 알림 전반이 함께 푸시된다.
//
// 주의: 원격 푸시는 Expo Go 가 아닌 EAS/dev 빌드 + 실기기에서만 동작한다.
//       (사용자앱 src/lib/push.js 와 동일한 제약 · 동일한 구조)
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// 앱 포그라운드에서도 알림 배너 표시.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function getProjectId() {
  return (
    Constants?.expoConfig?.extra?.eas?.projectId ||
    Constants?.easConfig?.projectId ||
    null
  );
}

// 실기기 여부 — 판매자앱에는 expo-device 의존성이 없으므로 Constants 로 판정한다.
function isRealDevice() {
  // Constants.isDevice 는 SDK 에 따라 없을 수 있어 undefined 면 통과시키고
  // getExpoPushTokenAsync 실패를 catch 로 흡수한다(에뮬레이터에서는 토큰 발급이 실패한다).
  return Constants?.isDevice !== false;
}

// 권한 요청 → Expo push token 획득 → seller_push_tokens 에 upsert. 실패 시 null.
export async function registerForPushNotifications() {
  try {
    if (!isRealDevice()) return null;

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: '기본',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId = getProjectId();
    if (!projectId) {
      console.warn('[push] EAS projectId 없음 — eas init 후 재시도 필요');
      return null;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return null;

    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id;
    if (!uid) return null;

    await supabase.from('seller_push_tokens').upsert(
      { seller_id: uid, token, platform: Platform.OS, updated_at: new Date().toISOString() },
      { onConflict: 'token' }
    );
    return token;
  } catch (e) {
    console.warn('[push] 등록 실패:', e.message);
    return null;
  }
}

// 로그아웃 시 이 기기 토큰 제거(다른 계정으로 오배송 방지).
export async function unregisterPushToken() {
  try {
    if (!isRealDevice()) return;
    const projectId = getProjectId();
    if (!projectId) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (token) await supabase.from('seller_push_tokens').delete().eq('token', token);
  } catch (e) {
    // 로그아웃 흐름을 막지 않는다.
  }
}
