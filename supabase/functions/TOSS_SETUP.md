# 토스페이먼츠 결제 연동 설정 가이드

FoodPicker 에 토스페이먼츠 결제를 연결하기 위해 **한 번만** 해두면 되는 설정입니다.
개발 지식이 없어도 아래 순서대로 그대로 따라 하면 됩니다. (예상 소요: 15~20분)

전체 구조는 이렇습니다.

```
사용자앱(결제창) → 토스 결제 인증 → Supabase Edge Function "toss-confirm"
                                      → 토스 승인 API → 주문 생성
관리자웹(환불)  → Supabase Edge Function "toss-cancel" → 토스 취소 API

[선택 · 자동결제(빌링)]  ※ 토스페이먼츠 별도 사용 신청·승인 필요 — ⑦ 참고
사용자앱(카드등록)  → 토스 카드 인증(authKey) → Edge Function "toss-billing-issue"
                                                 → 빌링키 발급 → 카드 저장
사용자앱(원탭결제)  → Edge Function "toss-billing-charge"
                       → 저장된 빌링키로 승인 → 주문 생성
```

시크릿 키는 서버(Supabase)에만 저장되고 앱에는 절대 들어가지 않습니다.

---

## ① 토스 개발자센터에서 테스트 키 발급

1. https://developers.tosspayments.com 접속 → 회원가입/로그인 합니다.
   (사업자등록 없이도 테스트 키는 바로 발급됩니다.)
2. 로그인 후 **내 개발자센터 → API 키** 메뉴로 이동합니다.
3. 키 종류 중 **"API 개별 연동 키"** 를 선택합니다.
   - 중요: "결제위젯 연동 키"가 아니라 **API 개별 연동 키**여야 합니다.
     FoodPicker 는 결제창(payment) 방식을 쓰기 때문입니다.
   - 구분법: 개별 연동 키는 키 중간에 `ck` / `sk` 가 들어가고,
     위젯 키는 `gck` / `gsk` 가 들어갑니다. 섞어 쓰면 결제창에서 키 오류가 납니다.
4. 두 개의 키를 복사해 메모해 둡니다.
   - **클라이언트 키**: `test_ck_...` 로 시작 (앱에 넣는 키, 공개돼도 무방)
   - **시크릿 키**: `test_sk_...` 로 시작 (서버 전용, 절대 외부 공유 금지)

> 참고: 아직 키를 발급하지 않았다면 토스 공식 문서에 공개된 테스트 키로도
> 동작 확인이 가능합니다.
> - 클라이언트 키: `test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq`
> - 시크릿 키: `test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R`
> 다만 실제 운영 전에는 반드시 본인 계정의 키로 교체하세요.

---

## ② Supabase 대시보드에서 Edge Function 2개 만들기

1. https://supabase.com/dashboard 접속 → FoodPicker 프로젝트를 엽니다.
2. 왼쪽 메뉴에서 **Edge Functions** 를 클릭합니다.
3. **"Deploy a new function"** (또는 "Create function") 버튼 → **"Via Editor"**
   (대시보드에서 직접 작성) 를 선택합니다.
4. 함수 이름을 정확히 `toss-confirm` 으로 입력합니다.
5. 에디터에 기본으로 들어있는 코드를 전부 지우고, 이 저장소의
   `supabase/functions/toss-confirm/index.ts` 파일 내용을 **전체 복사해서 붙여넣기** 합니다.
6. **Deploy** 버튼을 눌러 배포합니다.
7. 같은 방법으로 두 번째 함수를 만듭니다.
   - 함수 이름: `toss-cancel`
   - 코드: `supabase/functions/toss-cancel/index.ts` 내용 전체 붙여넣기 → Deploy

배포가 끝나면 Edge Functions 목록에 `toss-confirm`, `toss-cancel` 두 개가
"Active" 상태로 보여야 합니다. (함수 설정은 기본값 그대로 두면 됩니다.)

---

## ③ 시크릿 키를 Supabase Secrets 에 등록

1. Supabase 대시보드 → **Edge Functions → Secrets** 메뉴로 이동합니다.
   (또는 Project Settings → Edge Functions → Secrets)
2. **Add new secret** 을 누르고 아래와 같이 입력 후 저장합니다.
   - Key(이름): `TOSS_SECRET_KEY`
   - Value(값): ①에서 복사한 **시크릿 키** (`test_sk_...`)
3. 이름 철자가 정확히 `TOSS_SECRET_KEY` 인지 확인하세요. 철자가 다르면
   결제 시 "서버에 TOSS_SECRET_KEY 가 설정되지 않았습니다" 오류가 납니다.

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 는 Supabase 가 자동으로 넣어주므로
따로 등록할 필요가 없습니다.

---

## ④ 사용자앱에 클라이언트 키 등록

1. **사용자앱(FoodPicker_customer_app)** 폴더의 `.env` 파일을 엽니다.
   (없으면 새로 만듭니다. `.env.example` 이 있다면 복사해서 시작하세요.)
2. 아래 한 줄을 추가합니다. (①에서 복사한 **클라이언트 키**)

   ```
   EXPO_PUBLIC_TOSS_CLIENT_KEY=test_ck_여기에_본인_클라이언트_키
   ```

3. 앱을 다시 시작합니다. (`.env` 변경은 앱 재시작/재빌드 후에 반영됩니다.)
   - 이 값을 넣지 않아도 앱은 토스 공식 문서의 공개 테스트 키로 동작하지만,
     운영 시에는 반드시 본인 키를 등록해야 합니다.

---

## ⑤ 데이터베이스 마이그레이션 실행

1. Supabase 대시보드 → 왼쪽 메뉴 **SQL Editor** 를 클릭합니다.
2. **New query** 를 누릅니다.
3. 이 저장소의 `supabase/migrations/20260724000000_toss_payments.sql` 파일 내용을
   **전체 복사해서 붙여넣기** 합니다.
4. **Run** 을 눌러 실행합니다. "Success" 가 나오면 완료입니다.
   (이 SQL 은 여러 번 실행해도 안전하게 작성되어 있습니다.)

이 마이그레이션이 하는 일:
- 주문 테이블에 결제 정보 컬럼(payment_key 등)을 추가합니다.
- 주문 생성 함수가 결제 승인 없이는 유료 주문을 만들 수 없도록 잠급니다.
  (앱에서 결제를 건너뛰고 주문을 만드는 해킹 경로 차단)

> 주의: 이 SQL 실행 이후에는 반드시 **토스 결제가 적용된 새 버전의 사용자앱**을
> 사용해야 주문이 됩니다. 구버전 앱은 주문 생성이 막힙니다(의도된 동작).

---

## ⑥ 테스트 결제 해보기

1. 사용자앱을 실행하고 상품 하나를 골라 **구매하기 → 결제**를 진행합니다.
2. 토스 결제창이 뜨면 **아무 카드나 선택**해도 됩니다.
   - 테스트 키로 뜨는 결제창에는 "테스트 결제" 문구가 표시됩니다.
   - **실제 돈은 절대 빠져나가지 않습니다.** 실제 카드번호를 입력해도
     청구되지 않지만, 가급적 테스트용 정보를 사용하세요.
3. 결제 완료 후 앱에 주문 완료 화면이 뜨고, 판매자앱/관리자웹 주문 목록에
   새 주문이 보이면 성공입니다.
4. 환불 테스트: 관리자웹 → 해당 주문 → 환불(결제 취소)을 실행해 보세요.
   토스 개발자센터의 **테스트 결제 내역** 메뉴에서 승인/취소 내역을
   확인할 수 있습니다.

### 자주 발생하는 문제

| 증상 | 원인/해결 |
|---|---|
| 결제창에서 "유효하지 않은 키" 오류 | 위젯 키(`gck`)를 사용함 → **API 개별 연동 키(`ck`)** 로 교체 |
| "서버에 TOSS_SECRET_KEY 가 설정되지 않았습니다" | ③의 Secrets 이름 철자 확인 후 재등록 |
| 승인 오류 "UNAUTHORIZED_KEY" | 클라이언트 키와 시크릿 키가 서로 다른 계정/종류 → 같은 "API 개별 연동 키" 쌍으로 통일 |
| 결제 후 10분 넘게 두었다가 오류 | 토스 결제 인증은 10분 내 승인 필수 → 다시 결제 시도 |
| 주문이 안 만들어지고 결제만 취소됨 | 정상 보호 동작(금액 불일치/품절 등). 앱의 오류 메시지 확인 |

### 운영(실결제) 전환 시

1. 토스페이먼츠에 사업자 정보로 **라이브 키**를 발급받습니다(계약 필요).
2. ③의 `TOSS_SECRET_KEY` 값을 `live_sk_...` 로 교체합니다.
3. ④의 `EXPO_PUBLIC_TOSS_CLIENT_KEY` 값을 `live_ck_...` 로 교체하고 앱을 재빌드합니다.
4. 소액으로 실결제 → 환불 테스트를 한 번 해보는 것을 권장합니다.

---

## ⑦ (선택) 자동결제 = 빌링 — 저장한 카드로 원탭 결제

"결제수단 관리"에서 카드를 등록해두고 다음 주문부터 결제창 없이 바로 결제하는 기능입니다.
**①~⑥ 이 끝난 뒤에만** 진행하세요.

### ⑦-0 먼저 알아야 할 것 — 계약상 별도 신청·승인이 필요합니다

- 자동결제(빌링)는 일반 결제와 **별개의 계약 항목**입니다.
  토스페이먼츠에 **자동결제 사용 신청을 하고 심사·승인을 받아야** 라이브 키로 쓸 수 있습니다.
  (신청: 토스페이먼츠 상점관리자 → 결제 설정/서비스 신청, 또는 담당 매니저 문의)
- **승인 전에는 테스트 키(`test_sk_...`)로 개발 검증만 가능합니다.**
  승인 없이 라이브 키로 빌링 API 를 호출하면 토스가
  `NOT_AVAILABLE_PAYMENTS` / `NOT_SUPPORTED_METHOD` 계열 오류를 돌려줍니다.
  이 경우는 코드 문제가 아니라 **계약·권한 문제**이므로 토스페이먼츠에 문의해야 합니다.
- 카드 정보(카드번호/CVC)는 FoodPicker 서버에 저장되지 않습니다. 토스가 발급한
  **빌링키만** Supabase 에 저장되고, 이 빌링키는 앱으로 절대 내려가지 않습니다.
  (`payment_methods` 테이블은 앱 접근이 전면 차단되어 있고, 앱은 `my_payment_methods`
  뷰로 카드사·마스킹번호만 봅니다.)

### ⑦-1 데이터베이스 마이그레이션

Supabase 대시보드 → **SQL Editor → New query** 에
`supabase/migrations/20260728000000_pickup_deadline_geo_qr_paymethod.sql` 내용을
전체 붙여넣고 **Run** 합니다. (여러 번 실행해도 안전합니다.)
이 SQL 이 결제수단 테이블(`payment_methods`) · 노출용 뷰(`my_payment_methods`) ·
기본 결제수단 지정/삭제 함수를 만들어 줍니다.

### ⑦-2 Edge Function 2개 배포

②와 같은 방식(대시보드 → Edge Functions → Deploy a new function → Via Editor)으로
아래 두 개를 추가합니다.

| 함수 이름 | 붙여넣을 파일 |
|---|---|
| `toss-billing-issue` | `supabase/functions/toss-billing-issue/index.ts` |
| `toss-billing-charge` | `supabase/functions/toss-billing-charge/index.ts` |

Supabase CLI 를 쓸 수 있다면(설치되어 있고 `supabase login` 이 된 상태) 저장소 루트에서
아래 명령으로도 배포됩니다. `--project-ref` 값은 Supabase 프로젝트 URL 의
`https://<project-ref>.supabase.co` 부분입니다.

```bash
cd FoodPicker_seller_app
supabase functions deploy toss-billing-issue  --project-ref <project-ref>
supabase functions deploy toss-billing-charge --project-ref <project-ref>
```

두 함수 모두 사용자 로그인(JWT)이 필요하므로 함수 설정은 **기본값 그대로**(JWT 검증 켜짐) 둡니다.

### ⑦-3 시크릿

추가로 등록할 시크릿은 **없습니다.** ③에서 등록한 `TOSS_SECRET_KEY` 를 두 함수가 그대로
사용합니다(같은 프로젝트의 모든 Edge Function 이 시크릿을 공유합니다).
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 도 Supabase 가 자동으로 넣어줍니다.

| 이름 | 값 | 누가 넣나 |
|---|---|---|
| `TOSS_SECRET_KEY` | `test_sk_...` (승인 후 `live_sk_...`) | ③에서 등록한 값 재사용 |
| `SUPABASE_URL` | 자동 | Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | 자동 | Supabase |

### ⑦-4 앱이 호출하는 방식(개발자 참고)

- 카드 등록: 앱이 결제창 SDK 의 `requestBillingAuth` 로 받은 `authKey` 를
  `toss-billing-issue` 에 POST 합니다. 이때 `customerKey` 는 **반드시 로그인 사용자의
  Supabase user id** 여야 합니다(서버가 JWT 의 uid 와 대조해 다르면 거부).
  응답은 `{ paymentMethod: { id, cardCompany, cardNumberMasked, cardType, isDefault } }`
  이며 빌링키는 포함되지 않습니다.
- 원탭 결제: `toss-billing-charge` 에
  `{ paymentMethodId, productId, quantity, couponIds, orderId }` 를 POST 합니다.
  결제 금액은 **서버가 재계산**하므로 앱이 금액을 보내지 않습니다.
  `orderId` 는 결제 시도 1건마다 하나만 만들어 재시도 때도 **같은 값**을 보내야 합니다
  (이중 결제 방지용 멱등키. 생략하면 서버가 만들지만 재시도 보호가 약해집니다).
- 주문 생성이 실패하면 서버가 토스 결제를 자동 취소합니다(일반 결제와 동일한 보상 로직).

### ⑦-5 테스트

1. 사용자앱 → 마이 → **결제수단 관리 → 카드 추가** 로 테스트 카드를 등록합니다.
2. 목록에 카드사·마스킹된 카드번호가 보이면 등록 성공입니다.
3. 주문 화면에서 등록한 카드로 결제하면 결제창 없이 바로 주문이 만들어집니다.
4. 토스 개발자센터 → **테스트 결제 내역** 에서 승인 내역을 확인합니다.

| 증상 | 원인/해결 |
|---|---|
| 카드 등록 시 `NOT_AVAILABLE_PAYMENTS` / 자동결제 미지원 오류 | 자동결제 사용 승인 전(⑦-0). 테스트 키로만 검증 가능 |
| "카드 등록 정보가 일치하지 않습니다" | 앱이 `customerKey` 로 Supabase user id 를 쓰지 않음 |
| 등록은 됐는데 목록이 비어 보임 | ⑦-1 마이그레이션 미실행(`my_payment_methods` 뷰 없음) |
| 결제 시 "등록된 결제수단을 찾을 수 없습니다" | 다른 계정으로 등록한 카드 id 를 보냄(본인 카드만 사용 가능) |
| 같은 카드를 두 번 등록해도 목록이 1개 | 정상 — 같은 카드는 최신 빌링키로 갱신됩니다 |
