// ============================================================================
// FoodPicker Edge Function: naver-login — 네이버 아이디로 로그인 브리지
//
// 왜 필요한가:
//   Supabase Auth 는 네이버를 기본 제공자로 지원하지 않는다(Provider union 에 없음).
//   그래서 앱이 네이버 OAuth 를 직접 진행해 받은 authorization code 를 이 함수로 넘기면,
//   이 함수가 서버에서 네이버 토큰 교환 + 프로필 조회를 수행하고
//   Supabase 매직링크 token_hash 를 만들어 돌려준다.
//   앱은 supabase.auth.verifyOtp({ type: 'magiclink', token_hash }) 로 세션을 얻는다.
//
// 요청(POST, 인증 불필요 — 로그인 전 호출):
//   { code: string, state?: string, redirectUri?: string }
// 응답:
//   200 { token_hash: string, is_new_user: boolean, email: string }
//   에러 { error: string } (4xx/5xx)
//
// 기존 회원 연동:
//   네이버 프로필의 이메일로 회원을 찾고, 없을 때만 새로 만든다.
//   → 이메일/비밀번호로 이미 가입한 회원이 네이버로 로그인하면 그 회원으로 로그인된다
//     (별도 연동 절차 없이 '동일 이메일 기존 회원 연동' 이 자동 충족된다).
//
// 보안:
//   - NAVER_CLIENT_SECRET 은 서버(Supabase Secrets)에만 존재. 앱에는 Client ID 만 들어간다.
//   - code 는 네이버 서버에 직접 교환하므로 위조된 code 로는 토큰을 얻을 수 없다.
//   - token_hash 는 1회용이며 짧은 시간만 유효하다(응답 본문에만 담고 로그에 남기지 않는다).
//
// 환경변수: NAVER_CLIENT_ID / NAVER_CLIENT_SECRET (대시보드 Secrets 등록 필요),
//           SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (Edge Functions 기본 제공).
//
// ⚠️ 이 함수는 로그인 전에 호출되므로 JWT 검증을 꺼야 한다.
//    배포 시 "Verify JWT with legacy secret" 옵션을 OFF (supabase functions deploy --no-verify-jwt).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const NAVER_TOKEN_URL = "https://nid.naver.com/oauth2.0/token";
const NAVER_PROFILE_URL = "https://openapi.naver.com/v1/nid/me";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type NaverProfile = {
  id: string;
  email?: string;
  name?: string;
  nickname?: string;
};

// 네이버 authorization code → access token
async function exchangeNaverCode(
  code: string,
  state: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    state,
  });
  const res = await fetch(`${NAVER_TOKEN_URL}?${params.toString()}`, { method: "GET" });
  const body = await res.json().catch(() => null) as
    | { access_token?: string; error?: string; error_description?: string }
    | null;

  if (!res.ok || !body?.access_token) {
    // 네이버 에러 원문은 로그에만 남기고 사용자에게는 일반화된 메시지를 준다.
    console.error("[naver-login] 토큰 교환 실패:", res.status, body?.error, body?.error_description);
    throw new Error("네이버 인증에 실패했습니다. 다시 시도해주세요.");
  }
  return body.access_token;
}

// access token → 네이버 프로필(이메일/이름)
async function fetchNaverProfile(accessToken: string): Promise<NaverProfile> {
  const res = await fetch(NAVER_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json().catch(() => null) as
    | { resultcode?: string; message?: string; response?: NaverProfile }
    | null;

  if (!res.ok || body?.resultcode !== "00" || !body?.response?.id) {
    console.error("[naver-login] 프로필 조회 실패:", res.status, body?.resultcode, body?.message);
    throw new Error("네이버 프로필을 가져오지 못했습니다. 다시 시도해주세요.");
  }
  return body.response;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "허용되지 않은 메서드입니다." }, 405);
  }

  try {
    // ── 1) 시크릿 확인 ──────────────────────────────────────────────────────
    const clientId = Deno.env.get("NAVER_CLIENT_ID");
    const clientSecret = Deno.env.get("NAVER_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      console.error("[naver-login] NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 미설정");
      return json({ error: "네이버 로그인이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요." }, 500);
    }

    // ── 2) 요청 바디 검증 ───────────────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "잘못된 요청입니다." }, 400);
    }
    const { code, state } = body as { code?: string; state?: string };
    if (typeof code !== "string" || !code) {
      return json({ error: "네이버 인증 코드가 누락되었습니다." }, 400);
    }

    // ── 3) 네이버 토큰 교환 + 프로필 조회 ───────────────────────────────────
    const accessToken = await exchangeNaverCode(code, typeof state === "string" ? state : "", clientId, clientSecret);
    const profile = await fetchNaverProfile(accessToken);

    const email = profile.email?.trim().toLowerCase();
    if (!email) {
      // 네이버 애플리케이션의 '제공 정보' 에서 이메일이 필수가 아니거나 사용자가 동의하지 않은 경우.
      return json({
        error: "네이버 계정의 이메일 제공에 동의해야 로그인할 수 있습니다. " +
          "네이버 로그인 화면에서 이메일 제공을 허용한 뒤 다시 시도해주세요.",
      }, 400);
    }
    const displayName = (profile.name ?? profile.nickname ?? email.split("@")[0]).trim();

    // ── 4) service_role 클라이언트 ──────────────────────────────────────────
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // ── 5) 회원 조회/생성 ───────────────────────────────────────────────────
    // 이메일이 이미 있으면 createUser 가 중복 에러를 낸다 → 그 경우 기존 회원으로 이어간다
    // (= 동일 이메일 기존 회원 자동 연동). listUsers 전체 순회를 피하는 의도적 설계.
    let isNewUser = false;
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true, // 네이버가 이미 검증한 이메일 → 확인 메일 불필요
      user_metadata: { name: displayName, naver_id: profile.id, provider_hint: "naver" },
    });
    if (!createError) {
      isNewUser = true;
    } else if (!/already|registered|exists|duplicate/i.test(createError.message)) {
      console.error("[naver-login] 회원 생성 실패:", createError.message);
      return json({ error: "회원 정보를 만들지 못했습니다. 잠시 후 다시 시도해주세요." }, 500);
    }

    // ── 6) 매직링크 token_hash 발급 (메일은 발송되지 않는다) ────────────────
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      console.error("[naver-login] 매직링크 발급 실패:", linkError?.message);
      return json({ error: "로그인 처리에 실패했습니다. 잠시 후 다시 시도해주세요." }, 500);
    }

    // ── 7) 기존 회원의 표시명/naver_id 보정 ─────────────────────────────────
    // 서버 RPC 들이 표시명을 raw_user_meta_data->>'name' 으로 읽으므로 비어 있으면 채워준다.
    const linkedUser = linkData?.user;
    if (!isNewUser && linkedUser) {
      const meta = (linkedUser.user_metadata ?? {}) as Record<string, unknown>;
      const hasName = typeof meta.name === "string" && meta.name.trim().length > 0;
      if (!hasName || meta.naver_id !== profile.id) {
        const { error: updateError } = await admin.auth.admin.updateUserById(linkedUser.id, {
          user_metadata: {
            ...meta,
            name: hasName ? meta.name : displayName,
            naver_id: profile.id,
          },
        });
        // 표시명 보정 실패는 로그인 자체를 막지 않는다.
        if (updateError) console.error("[naver-login] 메타데이터 보정 실패:", updateError.message);
      }
    }

    return json({ token_hash: tokenHash, is_new_user: isNewUser, email }, 200);
  } catch (e) {
    // exchangeNaverCode / fetchNaverProfile 이 던진 사용자용 메시지는 그대로 전달한다.
    const message = e instanceof Error ? e.message : "네이버 로그인 중 오류가 발생했습니다.";
    console.error("[naver-login] unexpected error:", e);
    return json({ error: message }, 400);
  }
});
