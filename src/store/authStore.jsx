import React, { createContext, useContext, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { supabase } from '../lib/supabase';

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

const AuthContext = createContext(null);

// Supabase Auth 세션을 앱 전역에 제공. 세션 유무로 로그인 게이트를 판단한다.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    // 앱 시작 시 저장된 세션 복원
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    // 로그인/로그아웃/토큰갱신 구독
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
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

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    signOut: () => supabase.auth.signOut(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
