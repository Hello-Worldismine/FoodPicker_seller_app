// Supabase 클라이언트 (Expo React Native)
// URL/anon key는 프로젝트 루트 .env 의 EXPO_PUBLIC_* 값에서 주입됩니다.
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

// 값에 섞인 공백/개행/끝 슬래시는 iOS(NSURLSession)의 엄격한 URL 파서에서
// "Invalid path specified in request URL" 를 유발하므로 방어적으로 정리한다.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '');
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

if (!supabaseUrl || !supabaseAnonKey) {
  // .env 미설정 시 조기에 명확히 경고 (원인 파악 어려운 런타임 오류 방지)
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY 가 비어 있습니다. ' +
      '프로젝트 루트의 .env 를 채운 뒤 `npx expo start -c` 로 캐시를 지우고 다시 실행하세요.'
  );
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    // 세션을 기기에 영속 저장 (판매자 재실행 시 로그인 유지)
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // RN에는 URL 기반 세션 감지가 없으므로 비활성화
    detectSessionInUrl: false,
  },
});

// 앱이 포그라운드일 때만 토큰 자동 갱신 (Supabase 권장 패턴)
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
