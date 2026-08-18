// 인증 도메인 로직 (비밀번호 재설정 / 변경 / 에러 메시지 매핑)
//
// [설계 요지 — 6자리 이메일 OTP 방식]
//   비밀번호 재설정은 딥링크가 아니라 메일로 받은 6자리 코드를 입력하는 방식이다.
//   ① Expo Go 에서도 동작한다(커스텀 스킴 딥링크 불필요)
//   ② 메일을 PC 에서 열어도 된다(PKCE code_verifier 기기 종속 문제 없음)
//   ③ authStore 의 딥링크 핸들러가 recovery 토큰을 '그냥 로그인'으로 잘못 소비하는 사고가 없다
//   ④ Redirect URLs 허용목록 설정 실수로 메일 링크가 웹으로 튀는 사고가 없다
//   그래서 resetPasswordForEmail 에 redirectTo 를 넘기지 않는다(넘기면 메일에 링크가 생긴다).
//
// ★ 선행 조건(Supabase 콘솔): Authentication → Emails → Templates → "Reset Password" 본문에
//   {{ .Token }} 을 넣어야 6자리 코드가 메일에 실린다. 기본 템플릿에는 링크만 있고 코드가 없다.
//
// ★ verifyRecoveryOtp 가 성공하는 순간 세션이 생기고 PASSWORD_RECOVERY 이벤트가 발생한다.
//   authStore 의 recovering 플래그 + App.js Gate 최상단 가드가 없으면 그 즉시 AuthNavigator 가
//   언마운트되어 '새 비밀번호 입력' 화면이 사라진다(App.js Gate 주석 참고).
import { supabase } from './supabase';

/**
 * Supabase Auth 에러 메시지를 한국어로 매핑.
 * 판매자앱은 이메일/비밀번호 전용(소셜 로그인 없음)이라 소셜 관련 케이스는 두지 않는다.
 * @param {unknown} message error.message 또는 에러 객체의 문자열
 * @returns {string} 사용자에게 보여줄 한국어 문구
 */
export function mapAuthError(message) {
  const raw = String(message ?? '');
  const low = raw.toLowerCase();

  // ── 로그인 ──
  if (low.includes('invalid login credentials')) {
    return '이메일 또는 비밀번호가 올바르지 않습니다.';
  }
  if (low.includes('email not confirmed')) {
    return '이메일 인증이 완료되지 않았습니다. 메일함을 확인해주세요.';
  }
  // ── 가입 ──
  if (low.includes('user already registered') || low.includes('already registered')) {
    return '이미 가입된 이메일입니다.';
  }
  if (low.includes('invalid email') || low.includes('unable to validate email')) {
    return '이메일 주소 형식을 확인해주세요.';
  }
  // ── 재설정(OTP) ──
  // 발송 레이트리밋: 같은 주소로 60초 안에 다시 요청하면 여기에 걸린다.
  if (low.includes('for security purposes') || low.includes('rate limit') || low.includes('429')) {
    return '잠시 후 다시 요청해주세요. (약 1분 간격)';
  }
  if (low.includes('over_email_send_rate_limit')) {
    return '메일 발송 한도를 초과했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (low.includes('token has expired') || low.includes('otp_expired')) {
    return '인증코드가 만료되었습니다. 코드를 다시 요청해주세요.';
  }
  if (low.includes('token') && low.includes('invalid')) {
    return '인증코드가 올바르지 않습니다. 메일의 6자리 코드를 다시 확인해주세요.';
  }
  if (low.includes('invalid') && low.includes('code')) {
    return '인증코드가 올바르지 않습니다. 메일의 6자리 코드를 다시 확인해주세요.';
  }
  // ── 비밀번호 변경 ──
  if (low.includes('same as the old password') || low.includes('should be different')) {
    return '이전과 다른 비밀번호를 입력해주세요.';
  }
  if (low.includes('password should be at least') || low.includes('password_too_short')) {
    return '비밀번호는 6자 이상이어야 합니다.';
  }
  if (low.includes('pwned') || low.includes('leaked')) {
    return '유출 이력이 있는 비밀번호입니다. 다른 비밀번호를 사용해주세요.';
  }
  if (low.includes('reauthentication') || (low.includes('session') && low.includes('missing'))) {
    return '인증이 만료되었습니다. 처음부터 다시 시도해주세요.';
  }
  // ── 공통 ──
  if (low.includes('network') || low.includes('failed to fetch')) {
    return '네트워크 연결을 확인한 뒤 다시 시도해주세요.';
  }
  return raw || '요청 처리 중 오류가 발생했습니다.';
}

/**
 * 비밀번호 재설정 코드 요청. 메일로 6자리 코드가 발송된다.
 * ★ redirectTo 를 넘기지 않는다 — 링크를 만들지 않기 위함(위 설계 요지 참고).
 * ★ 계정 열거 방지: Supabase 는 미가입 주소에도 성공을 반환한다. 화면은 결과와 무관하게
 *   동일한 문구를 보여줘야 한다.
 * @param {string} email
 */
export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(String(email ?? '').trim());
  if (error) throw new Error(mapAuthError(error.message));
}

/**
 * 메일로 받은 6자리 코드 검증. 성공하면 복구 세션이 생기고
 * onAuthStateChange 가 PASSWORD_RECOVERY 를 발행한다(→ authStore 의 recovering=true).
 * @param {string} email
 * @param {string} token 6자리 숫자
 */
export async function verifyRecoveryOtp(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: String(email ?? '').trim(),
    token: String(token ?? '').trim(),
    type: 'recovery',
  });
  if (error) throw new Error(mapAuthError(error.message));
  return data?.session ?? null;
}

/**
 * 현재(복구 또는 로그인) 세션의 비밀번호를 변경한다.
 * @param {string} newPassword
 */
export async function changePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(mapAuthError(error.message));
}

/**
 * 로그인 상태에서의 '현재 비밀번호 확인'.
 * Supabase 의 Secure password change 옵션이 켜져 있으면 서버도 재인증을 요구하므로
 * 클라이언트에서 먼저 확인해 명확한 에러를 보여준다.
 * ★ signInWithPassword 는 같은 계정으로 세션을 재발급할 뿐이라 로그아웃되지 않는다.
 * @param {string} email
 * @param {string} password
 */
export async function verifyCurrentPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({
    email: String(email ?? '').trim(),
    password,
  });
  if (error) throw new Error('현재 비밀번호가 올바르지 않습니다.');
}
