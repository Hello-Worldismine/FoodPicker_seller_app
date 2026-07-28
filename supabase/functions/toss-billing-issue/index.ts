// ============================================================================
// FoodPicker Edge Function: toss-billing-issue — 토스 자동결제(빌링) 카드 등록
//
// 요청(POST, Authorization: Bearer <사용자 JWT>):
//   { authKey: string, customerKey?: string, alias?: string }
//   - authKey: 앱이 결제창 SDK 의 requestBillingAuth 로 받은 1회용 인증키.
//   - customerKey: 앱이 requestBillingAuth 에 넘긴 값(검증용). 서버는 이 값을 신뢰하지 않고
//     항상 JWT 의 uid 를 customerKey 로 사용한다 — 불일치 시 400 으로 막는다.
//     (사용자앱은 OrderScreen 처럼 customerKey = user.id 를 사용해야 한다.)
// 응답: 200 { paymentMethod: { id, cardCompany, cardNumberMasked, cardType, isDefault } }
//       / 에러 { error: string, code?: string } (4xx/5xx)
//
// 보안·정합 설계:
//   - billing_key 는 응답에 절대 포함하지 않는다. payment_methods 테이블은
//     authenticated 접근이 전면 차단되어 있어 service_role 로만 기록/조회한다.
//   - buyer_id / customerKey 는 서버가 JWT 에서 결정한다(앱이 보낸 값 신뢰 금지).
//   - 같은 카드(발급사+마스킹번호) 를 다시 등록하면 목록이 중복되지 않게 기존 행의
//     billing_key 를 갱신한다(빌링키는 재인증마다 새로 발급되므로 최신 값이 유효).
//   - 첫 카드는 is_default = true (부분 unique 인덱스와 충돌하지 않게 '없을 때만' 지정).
//
// 계약 주의: 자동결제(빌링)는 토스페이먼츠에 **별도 사용 신청·승인**이 필요하다.
//   승인 전에는 테스트 키로만 동작한다(TOSS_SETUP.md ⑦ 참고).
//
// 환경변수: TOSS_SECRET_KEY(대시보드 Secrets 등록 필요),
//           SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY(Edge Functions 기본 제공).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TOSS_BILLING_BASE = "https://api.tosspayments.com/v1/billing";

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

// 앱 응답용 필드만 추림 — billing_key/customer_key 는 절대 나가지 않는다.
function toPublicMethod(row: Record<string, unknown>) {
  return {
    id: row.id,
    cardCompany: row.card_company ?? null,
    cardNumberMasked: row.card_number_masked ?? null,
    cardType: row.card_type ?? null,
    isDefault: row.is_default === true,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "허용되지 않은 메서드입니다." }, 405);
  }

  try {
    // ── 1) 사용자 인증 (JWT → uid) ──────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData?.user) {
      return json({ error: "로그인이 필요합니다." }, 401);
    }
    const uid = userData.user.id;

    // ── 2) 요청 바디 검증 ───────────────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ error: "잘못된 요청입니다." }, 400);
    }
    const { authKey, customerKey: clientCustomerKey, alias } = body as {
      authKey?: string;
      customerKey?: string;
      alias?: string;
    };
    if (typeof authKey !== "string" || !authKey) {
      return json({ error: "카드 인증 정보(authKey)가 누락되었습니다." }, 400);
    }
    // customerKey 는 서버가 결정한다(= 구매자 uuid). 앱 값은 일치 검증에만 사용.
    const customerKey = uid;
    if (typeof clientCustomerKey === "string" && clientCustomerKey && clientCustomerKey !== customerKey) {
      return json({ error: "카드 등록 정보가 일치하지 않습니다. 앱을 다시 시작한 뒤 시도해주세요." }, 400);
    }

    const secretKey = Deno.env.get("TOSS_SECRET_KEY");
    if (!secretKey) {
      return json({ error: "서버에 TOSS_SECRET_KEY 가 설정되지 않았습니다." }, 500);
    }
    // Basic 인증: base64("{시크릿키}:") — 시크릿 키 뒤 콜론 필수, 비밀번호 없음.
    const basicAuth = "Basic " + btoa(`${secretKey}:`);

    // ── 3) 빌링키 발급 (authKey 는 1회용 — 재시도 불가) ─────────────────────
    let issued: Record<string, unknown> | null = null;
    let issueStatus = 0;
    try {
      const res = await fetch(`${TOSS_BILLING_BASE}/authorizations/issue`, {
        method: "POST",
        headers: { Authorization: basicAuth, "Content-Type": "application/json" },
        body: JSON.stringify({ authKey, customerKey }),
      });
      issueStatus = res.status;
      issued = await res.json().catch(() => null);
      if (!res.ok) {
        // 토스 에러 { code, message } 를 그대로 전달(코드 포함 — 클라 분기용).
        return json(
          { error: (issued?.message as string) ?? "카드 등록에 실패했습니다.", code: issued?.code },
          issueStatus >= 500 ? 502 : 400,
        );
      }
    } catch (fetchError) {
      // authKey 는 1회용이므로 같은 값으로 재시도해도 실패한다 → 앱은 카드 인증부터 다시.
      console.error("[toss-billing-issue] 발급 요청 네트워크 오류:", fetchError);
      return json({ error: "카드 등록 요청에 실패했습니다. 잠시 후 다시 등록해주세요." }, 502);
    }

    const billingKey = typeof issued?.billingKey === "string" ? issued.billingKey : "";
    if (!billingKey) {
      console.error("[toss-billing-issue] 응답에 billingKey 가 없음:", issued);
      return json({ error: "카드 등록 응답이 올바르지 않습니다. 잠시 후 다시 시도해주세요." }, 502);
    }
    // 카드 표시 정보 — 응답 최상위(cardCompany/cardNumber) 와 card 객체 양쪽을 폴백.
    const card = (issued?.card ?? {}) as Record<string, unknown>;
    const cardCompany = (issued?.cardCompany as string) ?? (card.issuerCode as string) ?? null;
    const cardNumberMasked = (card.number as string) ?? (issued?.cardNumber as string) ?? null;
    const cardType = (card.cardType as string) ?? null;
    const aliasText = typeof alias === "string" && alias.trim() ? alias.trim().slice(0, 30) : null;

    // ── 4) 저장 (service_role 전용) ─────────────────────────────────────────
    // 첫 카드 판정 + 동일 카드 재등록 판정을 한 번의 조회로 처리.
    const { data: existingRows, error: listError } = await supabase
      .from("payment_methods")
      .select("id, card_company, card_number_masked, is_default")
      .eq("buyer_id", uid);
    if (listError) {
      console.error("[toss-billing-issue] 기존 카드 조회 실패:", listError, "billingKey 미저장");
      return json({ error: "카드 정보를 저장하지 못했습니다. 잠시 후 다시 등록해주세요." }, 500);
    }
    const rows = existingRows ?? [];
    const isFirst = rows.length === 0;
    const duplicate = cardNumberMasked
      ? rows.find((r) =>
        r.card_number_masked === cardNumberMasked && (r.card_company ?? null) === cardCompany
      )
      : undefined;

    if (duplicate) {
      // 같은 카드 재인증 — 목록을 늘리지 않고 최신 빌링키로 교체한다.
      const { data: updated, error: updateError } = await supabase
        .from("payment_methods")
        .update({
          billing_key: billingKey,
          customer_key: customerKey,
          card_type: cardType,
          ...(aliasText ? { alias: aliasText } : {}),
        })
        .eq("id", duplicate.id)
        .eq("buyer_id", uid)
        .select("id, card_company, card_number_masked, card_type, is_default")
        .single();
      if (updateError || !updated) {
        console.error("[toss-billing-issue] 카드 갱신 실패:", updateError);
        return json({ error: "카드 정보를 저장하지 못했습니다. 잠시 후 다시 등록해주세요." }, 500);
      }
      return json({ paymentMethod: toPublicMethod(updated) }, 200);
    }

    const { data: inserted, error: insertError } = await supabase
      .from("payment_methods")
      .insert({
        buyer_id: uid,
        provider: "toss",
        method_type: "card",
        billing_key: billingKey,
        customer_key: customerKey,
        card_company: cardCompany,
        card_number_masked: cardNumberMasked,
        card_type: cardType,
        alias: aliasText,
        is_default: isFirst, // 첫 카드만 기본 — 이후 변경은 set_default_payment_method RPC
      })
      .select("id, card_company, card_number_masked, card_type, is_default")
      .single();
    if (insertError || !inserted) {
      // 결제는 발생하지 않았으므로 보상 취소는 필요 없다. 빌링키만 미사용 상태로 남는다.
      console.error("[toss-billing-issue] 카드 저장 실패:", insertError);
      return json({ error: "카드 정보를 저장하지 못했습니다. 잠시 후 다시 등록해주세요." }, 500);
    }

    return json({ paymentMethod: toPublicMethod(inserted) }, 200);
  } catch (e) {
    console.error("[toss-billing-issue] unexpected error:", e);
    return json({ error: "카드 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." }, 500);
  }
});
