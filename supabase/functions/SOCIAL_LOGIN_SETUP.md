# 간편 로그인(카카오 / 네이버 / 구글) 설정 가이드

사용자앱(구매자앱)의 **간편 로그인**을 켜기 위해 **한 번만** 해두면 되는 설정입니다.
개발 지식이 없어도 아래 순서대로 그대로 따라 하면 됩니다. (예상 소요: 40~60분)

전체 구조는 이렇습니다.

```
[구글 / 카카오]
사용자앱 → 인앱 브라우저 → Supabase Auth → 구글·카카오 → 앱으로 복귀(foodpicker://auth-callback)

[네이버]  ← Supabase Auth 가 네이버를 지원하지 않아 한 단계 더 있습니다
사용자앱 → 인앱 브라우저 → 네이버 → 앱으로 복귀
        → Edge Function "naver-login" (네이버 토큰 교환 + 회원 조회/생성)
        → 매직링크 token_hash → 앱이 세션 생성
```

**시크릿(비밀 키)은 모두 Supabase 에만 저장되고 앱에는 들어가지 않습니다.**

> 📌 미리 알아둘 것 — **Expo Go 에서는 간편 로그인이 동작하지 않습니다.**
> `foodpicker://` 같은 앱 전용 주소(커스텀 스킴)는 Expo Go 앱이 처리할 수 없기 때문입니다.
> 반드시 **dev build** 또는 스토어 빌드에서 테스트하세요.
> - 안드로이드: `npx expo run:android`
> - 또는 EAS: `eas build --profile development --platform android`

---

## ⓞ 먼저 준비할 값: 프로젝트 참조(ref)

1. https://supabase.com/dashboard 접속 → FoodPicker 프로젝트를 엽니다.
2. 주소창의 `https://supabase.com/dashboard/project/**abcdefghijklmno**` 에서
   굵게 표시한 부분이 **프로젝트 ref** 입니다. 메모해 두세요.
3. 앞으로 나올 아래 주소에서 `<ref>` 자리에 이 값을 넣습니다.

```
https://<ref>.supabase.co/auth/v1/callback
```

이 주소를 이 문서에서는 **"Supabase 콜백 주소"** 라고 부릅니다.
(구글·카카오 콘솔에 등록할 주소입니다.)

---

## ① Supabase: 앱으로 돌아올 주소 등록 (필수, 3분)

1. Supabase 대시보드 → 왼쪽 메뉴 **Authentication** → **URL Configuration**.
2. **Redirect URLs** 항목에서 **Add URL** 을 눌러 아래 두 개를 각각 추가합니다.

```
foodpicker://auth-callback
foodpicker://**
```

3. **Save** 를 누릅니다.

> 이 등록이 없으면 로그인 창이 앱으로 돌아오지 못하고 흰 화면에서 멈춥니다.
> 회원가입 인증 메일의 링크도 이 주소를 사용합니다.

---

## ② Google 로그인 켜기 (15분)

### ②-1 Google Cloud Console 에서 OAuth 클라이언트 만들기

1. https://console.cloud.google.com 접속 → 로그인.
2. 상단에서 프로젝트를 선택하거나 **새 프로젝트** 를 만듭니다. (이름 예: `FoodPicker`)
3. 왼쪽 메뉴 **API 및 서비스 → OAuth 동의 화면**(OAuth consent screen) 으로 이동합니다.
   - User Type: **외부(External)** 선택 → 만들기.
   - 앱 이름: `푸드피커`, 사용자 지원 이메일: 본인 이메일.
   - 개발자 연락처 이메일 입력 → 저장하고 계속 → 끝까지 **저장**.
   - 테스트 단계에서는 **테스트 사용자(Test users)** 에 로그인해볼 구글 계정을 추가하세요.
     (추가하지 않으면 "이 앱은 확인되지 않았습니다" 에서 막힙니다.)
4. 왼쪽 메뉴 **API 및 서비스 → 사용자 인증 정보**(Credentials) 로 이동합니다.
5. 상단 **+ 사용자 인증 정보 만들기 → OAuth 클라이언트 ID** 를 클릭합니다.
6. **애플리케이션 유형: 웹 애플리케이션**(Web application) 을 선택합니다.
   - ⚠️ "Android" 나 "iOS" 가 아닙니다. FoodPicker 는 Supabase 를 거치는 웹 방식입니다.
7. **승인된 리디렉션 URI**(Authorized redirect URIs) 에 **Supabase 콜백 주소** 를 추가합니다.

```
https://<ref>.supabase.co/auth/v1/callback
```

8. **만들기** 를 누르면 나오는 **클라이언트 ID** 와 **클라이언트 보안 비밀번호**(Client secret) 를
   복사해 메모합니다.

### ②-2 Supabase 에 붙여넣기

1. Supabase 대시보드 → **Authentication** → **Sign In / Providers**
   (버전에 따라 **Providers**) 목록에서 **Google** 을 찾아 클릭합니다.
2. **Enable Sign in with Google** 토글을 **켭니다**.
3. **Client IDs** 에 ②-1 의 클라이언트 ID, **Client Secret** 에 보안 비밀번호를 붙여넣습니다.
4. **Save**.

---

## ③ Kakao 로그인 켜기 (20분)

### ③-1 Kakao Developers 앱 만들기

1. https://developers.kakao.com 접속 → 카카오 계정으로 로그인.
2. 상단 **내 애플리케이션 → 애플리케이션 추가하기**.
   - 앱 이름: `푸드피커`, 사업자명: 본인/회사명 → 저장.
3. 만들어진 앱을 클릭 → 왼쪽 메뉴 **앱 키** 로 이동합니다.
   - **REST API 키** 를 복사해 메모합니다. → 이것이 Supabase 의 **Client ID** 입니다.
     (JavaScript 키나 네이티브 앱 키가 아닙니다.)
4. 왼쪽 메뉴 **카카오 로그인** → **활성화 설정** 을 **ON** 으로 바꿉니다.
5. 같은 화면 아래 **Redirect URI** → **Redirect URI 등록** 을 누르고
   **Supabase 콜백 주소** 를 넣고 저장합니다.

```
https://<ref>.supabase.co/auth/v1/callback
```

6. 왼쪽 메뉴 **카카오 로그인 → 보안** 으로 이동합니다.
   - **Client Secret** 의 **코드 생성** 을 누르고, 생성된 코드를 복사해 메모합니다.
   - 바로 아래 **활성화 상태** 를 **사용함** 으로 바꿉니다. (중요 — 사용함이 아니면 Supabase 에서 실패)
7. 왼쪽 메뉴 **카카오 로그인 → 동의항목** 으로 이동합니다.
   - **닉네임**: 필수 동의 또는 선택 동의로 설정합니다.
   - **카카오계정(이메일)**: **설정** 을 누르고 **필수 동의**(또는 선택 동의) 로 바꿉니다.
   - ⚠️ 이메일 동의항목은 **비즈 앱 전환**(사업자등록번호 등록) 이 필요할 수 있습니다.
     비즈 앱 전환 전에는 "필수 동의" 를 고를 수 없고 이메일이 내려오지 않아
     FoodPicker 로그인이 실패할 수 있습니다. 이 경우 먼저 비즈 앱 전환을 신청하세요.
     (내 애플리케이션 → 비즈 앱 → 전환하기)

### ③-2 Supabase 에 붙여넣기

1. Supabase 대시보드 → **Authentication** → **Sign In / Providers** → **Kakao**.
2. **Enable Sign in with Kakao** 토글을 **켭니다**.
3. **Kakao Client ID** = ③-1 의 **REST API 키**
   **Kakao Client Secret** = ③-1 의 **Client Secret 코드**
4. **Save**.

---

## ④ 기존 회원 ↔ 소셜 계정 연동 기능 켜기 (1분)

사용자앱의 **마이 → 연결된 계정 관리** 화면에서 이미 가입한 회원이
카카오·구글 계정을 붙일 수 있게 하려면 Supabase 의 수동 연동 기능이 켜져 있어야 합니다.

1. Supabase 대시보드 → **Authentication** → **Sign In / Providers**
   화면 아래쪽(또는 **Authentication → Configuration**)에서
   **"Allow manual linking"** / **"Manual Linking"** 항목을 찾습니다.
2. 토글을 **켜고 Save** 합니다.

> 항목 위치는 Supabase 대시보드 버전에 따라 조금씩 다릅니다.
> 검색창에 `manual linking` 을 입력하면 빠르게 찾을 수 있습니다.
> 이 설정이 꺼져 있으면 앱에서 "계정 연동 기능이 비활성화되어 있습니다" 안내가 뜹니다.

---

## ⑤ Naver 로그인 켜기 (20분)

네이버는 Supabase 가 지원하지 않아 **Edge Function 1개**를 추가로 배포합니다.

### ⑤-1 Naver Developers 애플리케이션 등록

1. https://developers.naver.com/apps/#/register 접속 → 네이버 계정으로 로그인.
2. **애플리케이션 이름**: `푸드피커`
3. **사용 API**: **네이버 아이디로 로그인** 을 선택합니다.
4. **제공 정보 선택** 에서 아래 두 개를 **필수** 로 체크합니다.
   - **회원이름**
   - **이메일 주소**
   - ⚠️ 이메일은 반드시 포함해야 합니다. FoodPicker 는 이메일로 회원을 식별합니다.
5. **로그인 오픈 API 서비스 환경** 에서 **환경 추가 → 모바일 웹** 을 선택하고,
   - **서비스 URL**: `https://<ref>.supabase.co`
   - **네이버 로그인 Callback URL**: 아래 주소를 그대로 넣습니다.

```
https://<ref>.supabase.co/functions/v1/naver-callback
```

   > 📌 **왜 앱 주소(`foodpicker://auth-callback`)가 아닌가?**
   > 네이버는 Callback URL 로 **http(s) 주소만** 받는다 — 커스텀 스킴은 등록 자체가 거부된다.
   > 그래서 네이버에는 https 중계 함수(`naver-callback`)를 등록하고, 그 함수가 받은
   > code/state 를 `foodpicker://auth-callback` 으로 302 리다이렉트해 앱으로 돌려보낸다.
   > 구글·카카오는 Supabase 의 https 콜백을 쓰므로 이 우회가 필요 없다.

6. **등록하기** 를 누릅니다.
7. 만들어진 앱의 **개요** 화면에서 **Client ID** 와 **Client Secret** 을 복사해 메모합니다.

> (앱은 `EXPO_PUBLIC_NAVER_CLIENT_ID` 가 비어 있으면 "네이버 로그인이 아직 준비되지 않았습니다"
> 라고 안내하므로, 값을 비워두면 네이버 버튼만 안전하게 비활성 상태가 됩니다.)

### ⑤-2 Edge Function 배포 (**2개** — `naver-login`, `naver-callback`)

1. Supabase 대시보드 → 왼쪽 메뉴 **Edge Functions**.
2. **Deploy a new function** → **Via Editor**.
3. 함수 이름을 정확히 `naver-login` 으로 입력합니다.
   (같은 절차로 `naver-callback` 도 배포합니다 — ⑤-1 에서 네이버에 등록한 https 콜백을 받아
    앱 딥링크로 302 중계하는 함수입니다. 이 함수는 시크릿이 필요 없습니다.)
4. 에디터의 기본 코드를 전부 지우고, 이 저장소의
   `supabase/functions/naver-login/index.ts` 내용을 **전체 복사해서 붙여넣기** 합니다.
5. **중요** — 함수 설정에서 **"Verify JWT with legacy secret"** 옵션을 **끕니다(OFF)**.
   이 함수는 *로그인 전에* 호출되므로 사용자 토큰이 없습니다.
   - CLI 로 배포한다면:
     `supabase functions deploy naver-login --no-verify-jwt`
     `supabase functions deploy naver-callback --no-verify-jwt`
     (`naver-callback` 은 네이버 서버/브라우저가 인증 없이 호출하므로 JWT 검증을 반드시 꺼야 한다)
6. **Deploy** 를 누릅니다.

### ⑤-3 네이버 시크릿을 Supabase 에 등록

1. Supabase 대시보드 → **Edge Functions** → **Secrets**
   (또는 **Project Settings → Edge Functions → Secrets**).
2. **Add new secret** 로 아래 두 개를 등록합니다.

| 이름 | 값 |
| --- | --- |
| `NAVER_CLIENT_ID` | ⑤-1 의 Client ID |
| `NAVER_CLIENT_SECRET` | ⑤-1 의 Client Secret |

3. **Save**. (등록 후 함수를 다시 배포할 필요는 없습니다.)

### ⑤-4 앱 환경변수에 네이버 Client ID 넣기

사용자앱 폴더(`FoodPicker_customer_app`) 의 `.env` 파일을 열어 아래 줄을 채웁니다.

```
EXPO_PUBLIC_NAVER_CLIENT_ID=여기에_네이버_Client_ID
```

- `.env` 가 없으면 `.env.example` 을 복사해 만듭니다.
- ⚠️ **Client Secret 은 절대 `.env` 에 넣지 마세요.** (앱을 뜯으면 보입니다)
- ⚠️ 기존 `EXPO_PUBLIC_NAVER_MAP_CLIENT_ID` (지도용) 와 **다른 값** 입니다. 섞이지 않게 주의하세요.
- 값을 바꾼 뒤에는 캐시를 지우고 다시 실행해야 반영됩니다: `npx expo start -c`
- ⚠️ **EAS 빌드(설치본)는 `.env` 를 읽지 않습니다.** `eas.json` 의 `build.<프로필>.env` 에 같은 줄을
  development / preview / production **세 프로필 모두** 추가해야 설치본에 값이 들어갑니다.
  (`.env` 만 채우면 로컬 `expo start` 에서만 되고, 설치한 앱에서는 계속
  "네이버 로그인이 아직 준비되지 않았습니다" 가 뜹니다 — `EXPO_PUBLIC_NAVER_MAP_CLIENT_ID` 가
  이미 그렇게 등록돼 있으니 같은 자리에 나란히 넣으면 됩니다.)

---

## ⑥ 동작 확인 체크리스트

dev build 를 설치한 실제 기기/에뮬레이터에서 확인합니다.

1. 앱 실행 → 로그인 화면 하단 **"카카오로 계속하기"** 탭
   → 인앱 브라우저에서 카카오 로그인 → 동의 → **앱으로 돌아와 자동 로그인** 되어야 합니다.
2. **마이 → 프로필 이름** 이 `구매자` 가 아니라 실제 이름/닉네임으로 보이는지 확인합니다.
3. **"Google로 계속하기"** 도 같은 방식으로 확인합니다.
4. **"네이버로 계속하기"** 확인. 실패하면 Supabase 대시보드
   **Edge Functions → naver-login → Logs** 에서 `[naver-login]` 로그를 확인합니다.
5. 이메일/비밀번호로 가입한 계정으로 로그인한 뒤
   **마이 → 연결된 계정 관리 → 카카오 [연결]** 을 눌러 연동이 되는지 확인합니다.
   - 연동 후 로그아웃 → 카카오 로그인 시 **같은 계정(같은 주문내역)** 으로 들어와야 합니다.

---

## ⑦ 자주 나는 오류와 원인

| 화면에 뜨는 메시지 | 원인 / 해결 |
| --- | --- |
| 해당 간편 로그인이 아직 준비되지 않았습니다 | Supabase 에서 해당 Provider 토글이 꺼져 있음 → ②-2 / ③-2 |
| 로그인 창이 열렸는데 앱으로 안 돌아온다 | Redirect URLs 에 `foodpicker://auth-callback` 미등록 → ① / 또는 Expo Go 로 실행 중 |
| 소셜 계정에서 이메일 제공에 동의해야 로그인할 수 있습니다 | 카카오 동의항목에 이메일 미설정(비즈 앱 전환 필요) → ③-1 7번 / 네이버 제공정보 미설정 → ⑤-1 4번 |
| 해당 소셜 계정은 다른 회원에 연결되어 있습니다 | 그 카카오/구글 계정이 이미 다른 FoodPicker 회원에 연결됨. 그 회원으로 로그인하거나 먼저 해제해야 합니다 |
| 계정 연동 기능이 비활성화되어 있습니다 | Manual Linking 이 꺼져 있음 → ④ |
| 네이버 로그인이 아직 준비되지 않았습니다 | `EXPO_PUBLIC_NAVER_CLIENT_ID` 미설정 → ⑤-4, 또는 Secrets 미등록 → ⑤-3 |
| 네이버 콘솔이 Callback URL 을 거부한다 | 커스텀 스킴은 등록 불가 — https 중계 함수 주소를 넣어야 한다 → ⑤-1 5번 |
| 네이버 인증 후 앱으로 안 돌아온다 | `naver-callback` 미배포 또는 JWT 검증이 켜져 있음 → ⑤-2 |
| 이미 가입된 이메일입니다 | 같은 이메일의 회원이 이미 있음. 이메일로 로그인한 뒤 **연결된 계정 관리** 에서 연동하세요 |

---

## 참고: 앱에서 이 설정을 쓰는 코드 위치

| 파일 | 역할 |
| --- | --- |
| `FoodPicker_customer_app/app.json` | `"scheme": "foodpicker"` — 앱으로 돌아올 주소의 정체 |
| `FoodPicker_customer_app/src/lib/oauth.js` | 간편 로그인 / 계정 연동 로직 전부 |
| `FoodPicker_customer_app/src/screens/LoginScreen.js` | 소셜 로그인 버튼 3개 |
| `FoodPicker_customer_app/src/screens/LinkedAccountsScreen.js` | 마이 → 연결된 계정 관리 |
| `FoodPicker_customer_app/src/context/AuthContext.js` | 딥링크로 앱이 깨어났을 때의 세션 복원(안전망) |
| `supabase/functions/naver-login/index.ts` | 네이버 전용 서버 브리지 |
