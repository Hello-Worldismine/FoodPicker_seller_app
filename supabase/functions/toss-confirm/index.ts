// ============================================================================
// FoodPicker Edge Function: toss-confirm — 토스페이먼츠 결제 승인 + 주문 생성
//
// 요청(POST, Authorization: Bearer <사용자 JWT>):
//   { paymentKey?: string, orderId?: string(토스 orderId), amount: number,
//     productId: string, quantity: number, couponIds: string[] }
//   - amount = 0(전액 쿠폰): paymentKey/orderId 없이 무결제 주문 경로.
//   - amount > 0: 토스 승인 API(/v1/payments/confirm) 호출 후 주문 생성.
// 응답: 200 { order: <orders row> } / 에러 { error: string, code?: string } (4xx/5xx)
//
// 보안·정합 설계:
//   - JWT 로 구매자 본인 확인 — 실패 시 401. 멱등 조회도 buyer_id 를 함께 검증해
//     타인의 paymentKey 로 남의 주문을 조회하는 경로를 차단한다.
//   - create_order RPC 는 service_role 전용(마이그레이션에서 revoke) → 결제 우회 주문 불가.
//   - RPC 가 서버 재계산 금액과 승인 금액을 대조(amount mismatch 시 예외).
//   - 멱등성(돈 경로 핵심):
//     · 승인 전: 동일 paymentKey 주문이 이미 있으면 그대로 반환.
//     · 승인 API 가 ALREADY_PROCESSED_PAYMENT 를 반환하면(재시도/응답 유실 후 재호출)
//       결제 단건 조회(GET /v1/payments/{key})로 DONE·orderId·금액을 검증하고 주문 생성을 이어간다.
//     · RPC 실패 시: 곧바로 취소하지 않고 주문을 재조회 — 이미 커밋된 주문이 있으면
//       (응답 유실/동시 요청의 unique 위반) 멱등 성공으로 반환한다. 정말 주문이 없을 때만
//       보상 취소를 수행하고, 취소 HTTP 실패는 사용자에게 사실대로 안내한다.
//
// 환경변수: TOSS_SECRET_KEY(대시보드 Secrets 등록 필요),
//           SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY(Edge Functions 기본 제공).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const TOSS_API_BASE = "https://api.tosspayments.com/v1/payments";

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

// 구매자 본인(buyer_id=uid)의 paymentKey 주문 조회 — 멱등 가드/보상 전 재확인 공용.
// error 를 삼키지 않는다: 조회 실패는 null 이 아니라 throw (가드 무력화 방지).
async function findOrderByPaymentKey(
  supabase: SupabaseClient,
  paymentKey: string,
  uid: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("payment_key", paymentKey)
    .eq("buyer_id", uid)
    .maybeSingle();
  if (error) throw new Error(`주문 조회 실패: ${error.message}`);
  return data;
}

// 토스 결제 단건 조회 — ALREADY_PROCESSED / confirm 네트워크 유실 복구용.
async function getTossPayment(
  paymentKey: string,
  basicAuth: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${TOSS_API_BASE}/${encodeURIComponent(paymentKey)}`, {
      headers: { Authorization: basicAuth },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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
    const { paymentKey, orderId, amount, productId, quantity, couponIds } = body as {
      paymentKey?: string;
      orderId?: string;
      amount: number;
      productId: string;
      quantity: number;
      couponIds?: string[];
    };
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) {
      return json({ error: "결제 금액이 올바르지 않습니다." }, 400);
    }
    if (typeof productId !== "string" || !productId) {
      return json({ error: "상품 정보가 올바르지 않습니다." }, 400);
    }
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
      return json({ error: "수량이 올바르지 않습니다." }, 400);
    }
    const coupons = Array.isArray(couponIds) ? couponIds.filter((c) => typeof c === "string") : [];

    // 주문 생성 RPC 호출 공용 파라미터
    const createOrder = (pay: {
      paymentKey: string | null;
      tossOrderId: string | null;
      method: string | null;
      paidAmount: number;
    }) =>
      supabase.rpc("create_order", {
        p_product_id: productId,
        p_quantity: quantity,
        p_coupon_ids: coupons,
        p_buyer_id: uid,
        p_payment_key: pay.paymentKey,
        p_toss_order_id: pay.tossOrderId,
        p_payment_method: pay.method,
        p_paid_amount: pay.paidAmount,
      });

    // ── 3) amount = 0 (전액 쿠폰): 토스 호출 없이 무결제 주문 ───────────────
    // 서버 재계산 금액이 0 이 아니면 RPC 가 'amount mismatch' 로 거부한다.
    if (amount === 0) {
      const { data: order, error: rpcError } = await createOrder({
        paymentKey: null, tossOrderId: null, method: null, paidAmount: 0,
      });
      if (rpcError) {
        return json({ error: rpcError.message }, 400);
      }
      return json({ order }, 200);
    }

    // ── 4) amount > 0: 토스 승인 API ────────────────────────────────────────
    if (typeof paymentKey !== "string" || !paymentKey || typeof orderId !== "string" || !orderId) {
      return json({ error: "결제 정보(paymentKey/orderId)가 누락되었습니다." }, 400);
    }
    const secretKey = Deno.env.get("TOSS_SECRET_KEY");
    if (!secretKey) {
      return json({ error: "서버에 TOSS_SECRET_KEY 가 설정되지 않았습니다." }, 500);
    }
    // Basic 인증: base64("{시크릿키}:") — 시크릿 키 뒤 콜론 필수, 비밀번호 없음.
    const basicAuth = "Basic " + btoa(`${secretKey}:`);

    // 멱등 가드: 동일 paymentKey 로 이미 생성된 '본인' 주문이 있으면 그대로 반환.
    // 조회 실패 시에는 진행하지 않는다(가드 무력화 → 이중 승인 위험 차단).
    let existing: Record<string, unknown> | null;
    try {
      existing = await findOrderByPaymentKey(supabase, paymentKey, uid);
    } catch (e) {
      console.error("[toss-confirm] 멱등 가드 조회 실패:", e);
      return json({ error: "일시적인 오류입니다. 잠시 후 같은 결제로 다시 시도해주세요." }, 500);
    }
    if (existing) {
      return json({ order: existing }, 200);
    }

    // 승인 호출. 네트워크 예외 시에도 승인이 이미 됐을 수 있으므로 단건 조회로 복구 시도.
    let payment: Record<string, unknown> | null = null;
    let confirmOk = false;
    try {
      const confirmRes = await fetch(`${TOSS_API_BASE}/confirm`, {
        method: "POST",
        headers: { Authorization: basicAuth, "Content-Type": "application/json" },
        body: JSON.stringify({ paymentKey, orderId, amount }),
      });
      payment = await confirmRes.json().catch(() => null);
      confirmOk = confirmRes.ok;
      if (!confirmOk && payment?.code !== "ALREADY_PROCESSED_PAYMENT") {
        // 토스 에러 { code, message } 를 그대로 전달(코드 포함 — 클라 분기용).
        return json(
          { error: (payment?.message as string) ?? "결제 승인에 실패했습니다.", code: payment?.code },
          confirmRes.status >= 500 ? 502 : 400,
        );
      }
    } catch (fetchError) {
      console.error("[toss-confirm] 승인 요청 네트워크 오류:", fetchError);
      confirmOk = false;
      payment = null;
    }

    // 승인 응답을 못 받았거나 ALREADY_PROCESSED 인 경우: 결제 단건 조회로 실제 상태 확인.
    // 이미 DONE(승인 완료)이고 orderId·금액이 일치하면 주문 생성을 이어간다(자기치유).
    if (!confirmOk) {
      const inquiry = await getTossPayment(paymentKey, basicAuth);
      if (
        inquiry && inquiry.status === "DONE" &&
        inquiry.orderId === orderId && inquiry.totalAmount === amount
      ) {
        payment = inquiry;
      } else {
        return json({ error: "결제 승인 상태를 확인하지 못했습니다. 잠시 후 같은 결제로 다시 시도해주세요." }, 502);
      }
    }

    // ── 5) 승인 성공 → 주문 생성(RPC) ───────────────────────────────────────
    const { data: order, error: rpcError } = await createOrder({
      paymentKey,
      tossOrderId: orderId,
      method: (payment?.method as string) ?? null,
      paidAmount: amount,
    });

    if (rpcError) {
      // ⚠️ 곧바로 취소하지 않는다. rpcError 가 '주문 미생성'을 뜻하지 않는 두 경로:
      //   ① 응답 유실 — DB 는 커밋됐는데 네트워크 오류로 error 반환.
      //   ② 동시 요청 — 다른 요청이 먼저 커밋해 unique(payment_key) 위반(23505).
      // 두 경우 모두 주문이 존재하므로 재조회해 멱등 성공으로 반환해야 한다.
      let committed: Record<string, unknown> | null = null;
      try {
        committed = await findOrderByPaymentKey(supabase, paymentKey, uid);
      } catch {
        // 재조회 실패: 주문 존재 여부 불명 — 절대 취소하지 않는다(정상 결제 취소 방지).
        return json({ error: "주문 상태를 확인하지 못했습니다. 잠시 후 같은 결제로 다시 시도해주세요." }, 500);
      }
      if (committed) {
        return json({ order: committed }, 200);
      }

      // 주문이 정말 없음 → 검증 실패(재고/쿠폰/금액 등). 보상 취소 수행.
      let cancelOk = false;
      try {
        const cancelRes = await fetch(`${TOSS_API_BASE}/${encodeURIComponent(paymentKey)}/cancel`, {
          method: "POST",
          headers: {
            Authorization: basicAuth,
            "Content-Type": "application/json",
            // 결정적 멱등키 — 재시도가 동일 취소 응답을 재생하도록.
            "Idempotency-Key": `compensate-${paymentKey}`.slice(0, 300),
          },
          body: JSON.stringify({ cancelReason: "주문 생성 실패 자동 취소" }),
        });
        const cancelBody = await cancelRes.json().catch(() => null);
        cancelOk = cancelRes.ok || cancelBody?.code === "ALREADY_CANCELED_PAYMENT";
        if (!cancelOk) {
          console.error("[toss-confirm] 보상 취소 HTTP 실패:", cancelBody, "paymentKey:", paymentKey);
        }
      } catch (cancelError) {
        console.error("[toss-confirm] 보상 취소 실패:", cancelError, "paymentKey:", paymentKey);
      }

      // 취소 성공/실패를 사실대로 안내(실패 시 결제가 살아있을 수 있음 — 고객센터 안내).
      const reason = rpcError.message;
      return json(
        cancelOk
          ? { error: `주문 생성에 실패해 결제를 취소했습니다. (${reason})` }
          : { error: `주문 생성에 실패했습니다(${reason}). 결제 취소가 지연되고 있어요 — 잠시 후에도 결제가 남아있으면 고객센터로 문의해주세요.` },
        400,
      );
    }

    return json({ order }, 200);
  } catch (e) {
    console.error("[toss-confirm] unexpected error:", e);
    return json({ error: "결제 처리 중 오류가 발생했습니다. 잠시 후 같은 결제로 다시 시도해주세요." }, 500);
  }
});
