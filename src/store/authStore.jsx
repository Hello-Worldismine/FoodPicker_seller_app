import React, { createContext, useContext, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { supabase } from '../lib/supabase';
import { registerForPushNotifications, unregisterPushToken } from '../lib/push';

// 이메일 확인/매직링크 딥링크(foodpicker-seller://...#access_token=...)에서 세션 복원
function parseTokensFromUrl(url) {
  if (!url) return null;
  const frag = url.includes('#') ? url.split('#')[1] : url.includes('?') ? url.split('?')[1] : '';
  if (!frag) return null;
  const params = new URLSearchParams(frag);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  return access_token && refresh_token ? { access_token, refresh_token } : null;
}

// 비밀번호 재설정(recovery) 딥링크인가?
// 이 앱의 재설정은 6자리 OTP 방식이라 링크를 쓰지 않지만, 메일 템플릿에 링크가 남아 있거나
// 예전 메일을 뒤늦게 열면 recovery 토큰이 딥링크로 들어올 수 있다. 그때 아래 handleUrl 이
// 그대로 setSession/exchangeCodeForSession 을 해버리면 '비밀번호를 못 바꾼 채 그냥 로그인'
// 되어버린다(게다가 1회용 토큰이 소모된다). → 이 URL 은 처리하지 않고 조용히 무시한다.
function isRecoveryUrl(url) {
  if (!url) return false;
  const low = String(url).toLowerCase();
  return low.includes('type=recovery') || low.includes('reset-password') || low.includes('password-reset');
}

const AuthContext = createContext(null);

// Supabase Auth 세션을 앱 전역에 제공. 세션 유무로 로그인 게이트를 판단한다.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  // ★ 비밀번호 재설정 진행 중 플래그.
  //   verifyOtp 가 성공하는 순간 세션이 생기므로, 이 플래그가 없으면 App.js 의 Gate 가 즉시
  //   AuthNavigator 를 언마운트하고 매장 로딩 → 심사중/앱 본체로 넘어가버려서
  //   '새 비밀번호 입력' 화면이 사라진다. Gate 최상단에서 이 값을 먼저 본다.
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    let mounted = true;
    // 앱 시작 시 저장된 세션 복원
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    // 로그인/로그아웃/토큰갱신 구독
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // 복구 세션이 만들어졌다 → 새 비밀번호를 받을 때까지 인증 화면을 붙잡아 둔다.
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      // 재설정 완료 후 signOut, 또는 중도 이탈 시 게이트를 원상 복구한다.
      else if (event === 'SIGNED_OUT') setRecovering(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 딥링크로 앱이 열리면(이메일 인증 링크 등) 토큰으로 세션 설정
  useEffect(() => {
    async function handleUrl(url) {
      if (!url) return;
      // 0) 비밀번호 재설정 링크는 이 핸들러가 소비하지 않는다(위 isRecoveryUrl 주석 참고).
      if (isRecoveryUrl(url)) return;
      // 0-1) 이미 로그인돼 있으면 굳이 세션을 갈아끼우지 않는다(사용자앱 AuthContext 와 동일 가드).
      //      로그인 상태에서 예전 인증 메일 링크를 열었을 때 세션이 흔들리는 것을 막는다.
      const { data: current } = await supabase.auth.getSession();
      if (current?.session) return;
      // 1) implicit 플로우: #access_token&refresh_token
      const tokens = parseTokensFromUrl(url);
      if (tokens) {
        const { error } = await supabase.auth.setSession(tokens);
        if (error) console.warn('[deep link setSession]', error.message);
        return;
      }
      // 2) PKCE 플로우: ?code=... (exchangeCodeForSession)
      const codeMatch = url.match(/[?&]code=([^&]+)/);
      if (codeMatch) {
        const { error } = await supabase.auth.exchangeCodeForSession(decodeURIComponent(codeMatch[1]));
        if (error) console.warn('[deep link exchangeCode]', error.message);
      }
    }
    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  // 로그인 상태가 되면 이 기기의 Expo 푸시 토큰을 seller_push_tokens 에 등록한다.
  // (notifications INSERT 트리거가 이 토큰으로 쿠폰 지정발급·주문·정산 알림을 푸시한다)
  useEffect(() => {
    if (!session?.user?.id) return;
    registerForPushNotifications();
  }, [session?.user?.id]);

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    // 비밀번호 재설정 게이트. FindPassword 화면이 언마운트될 때 반드시 false 로 되돌려야
    // 중도 이탈 시 앱이 인증 화면에 갇히지 않는다.
    recovering,
    setRecovering,
    // 로그아웃 시 이 기기 토큰을 먼저 제거해 다음 로그인 계정에 알림이 새지 않게 한다.
    signOut: async () => {
      await unregisterPushToken();
      return supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
