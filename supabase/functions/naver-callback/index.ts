// ============================================================================
// FoodPicker Edge Function: naver-callback — 네이버 로그인 콜백 → 앱 딥링크 중계
//
// 왜 필요한가:
//   네이버 개발자센터의 "네이버 로그인 Callback URL" 은 **http(s) 주소만** 받는다.
//   커스텀 스킴(foodpicker://auth-callback)은 등록 자체가 거부된다.
//   (구글·카카오는 Supabase 의 https 콜백을 쓰므로 이 문제가 없었다.)
//
//   그래서 네이버에는 이 함수의 https 주소를 콜백으로 등록하고,
//   이 함수가 받은 code/state 를 그대로 앱 스킴으로 302 리다이렉트해 준다.
//
//     앱 → 네이버 인증 → (https) 이 함수 → 302 → foodpicker://auth-callback?code=…&state=…
//     → 인앱 브라우저 세션이 스킴을 가로채 앱으로 복귀 → naver-login 함수로 code 교환
//
// 네이버 개발자센터 등록값:
//   서비스 URL       https://<ref>.supabase.co
//   Callback URL     https://<ref>.supabase.co/functions/v1/naver-callback
//
// ⚠️ 네이버(브라우저)가 인증 없이 호출하므로 JWT 검증을 꺼야 한다.
//    supabase functions deploy naver-callback --no-verify-jwt
//
// 보안: 리다이렉트 대상은 아래 고정 상수뿐이다. 쿼리로 받은 주소로는 절대 보내지 않는다
//       (열린 리다이렉터가 되면 네이버 code 가 임의 주소로 새어나갈 수 있다).
// ============================================================================

// 소비자앱 딥링크. app.json 의 "scheme": "foodpicker" 와 일치해야 한다.
const APP_REDIRECT = "foodpicker://auth-callback";

// 네이버가 돌려주는 파라미터 중 앱으로 넘길 것만 통과시킨다.
const PASS_THROUGH = ["code", "state", "error", "error_description"];

Deno.serve((req: Request): Response => {
  const src = new URL(req.url).searchParams;
  const out = new URLSearchParams();
  for (const key of PASS_THROUGH) {
    const value = src.get(key);
    if (value) out.set(key, value);
  }

  const target = out.toString() ? `${APP_REDIRECT}?${out.toString()}` : APP_REDIRECT;

  // 302 가 정상 경로다. 다만 커스텀 스킴 302 를 무시하는 브라우저가 있어
  // 본문에 즉시 이동 스크립트와 수동 링크를 함께 담아 둔다(빈 화면 방지).
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>로그인 처리 중…</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#1F2933}
a{color:#22A06B;font-weight:600}</style></head>
<body><p>앱으로 돌아가는 중입니다… <a href="${target}">열리지 않으면 여기를 누르세요</a></p>
<script>location.replace(${JSON.stringify(target)});</script></body></html>`;

  return new Response(html, {
    status: 302,
    headers: {
      Location: target,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
});
