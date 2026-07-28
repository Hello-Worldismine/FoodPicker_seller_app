// ============================================================================
// FoodPicker Edge Function: toss-billing-charge — 저장된 카드로 원탭 결제 + 주문 생성
//
// 요청(POST, Authorization: Bearer <사용자 JWT>):
//   { paymentMethodId: string, productId: string, quantity: number,
//     couponIds?: string[], orderId?: string }
//   - orderId: 토스 orderId(영문/숫자/-/_ 6~64자). 앱이 '결제 시도 1건'마다 하나를 만들어
//     보내면 재시도가 이중 결제되지 않는다(멱등키로도 사용). 생략 시 서버가 생성.
// 응답: 200 { order: <orders row> } / 에러 { error: string, code?: string } (4xx/5xx)
//
// 결제창을 열지 않는다 — 이미 등록된 빌링키로 승인하므로 원탭 결제가 된다.
//
// 보안·정합 설계(toss-confirm 과 동일한 원칙):
//   - buyer_id 는 JWT 에서 서버가 결정. 카드는 payment_methods 에서 '본인 소유'만 조회하고
//     billing_key 는 응답/로그에 절대 싣지 않는다(테이블은 service_role 전용).
//   - 결제 금액을 서버가 재계산한다. 최종 검증은 create_order RPC 가 하므로(amount mismatch)
//     불일치 시에는 **반드시 토스 결제를 자동 취소**한다(보상 트랜잭션).
//   - 멱등성(돈 경로 핵심):
//     · 승인 전: 동일 toss_order_id 의 '본인' 주문이 이미 있으면 그대로 반환.
//     · 승인 API 실패/네트워크 유실 시 orderId 로 결제 단건 조회(GET /v1/payments/orders/{orderId})
//       하여 DONE·금액 일치를 확인하면 주문 생성을 이어간다(자기치유).
//     · RPC 실패 시: 곧바로 취소하지 않고 주문을 재조회 — 이미 커밋된 주문이 있으면
//       멱등 성공으로 반환한다. 정말 주문이 없을 때만 보상 취소를 수행한다.
//
// 계약 주의: 자동결제(빌링)는 토스페이먼츠에 **별도 사용 신청·승인**이 필요하다.
//   승인 전에는 테스트 키로만 동작한다(TOSS_SETUP.md ⑦ 참고).
//
// 환경변수: TOSS_SECRET_KEY(대시보드 Secrets 등록 필요),
//           SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY(Edge Functions 기본 제공).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const TOSS_PAYMENTS_BASE = "https://api.tosspayments.com/v1/payments";
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

// 토스 orderId 규칙: 영문 대소문자/숫자/-/_ 6~64자 (사용자앱 makeTossOrderId 와 동일 규칙).
const ORDER_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
function makeTossOrderId(): string {
  return `FPB_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

// 구매자 본인 주문 조회 — 멱등 가드/보상 전 재확인 공용.
// error 를 삼키지 않는다: 조회 실패는 null 이 아니라 throw (가드 무력화 방지).
async function findMyOrder(
  supabase: SupabaseClient,
  column: "payment_key" | "toss_order_id",
  value: string,
  uid: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq(column, value)
    .eq("buyer_id", uid)
    .maybeSingle();
  if (error) throw new Error(`주문 조회 실패: ${error.message}`);
  return data;
}

// 토스 결제 단건 조회(orderId 기준) — 승인 응답 유실/중복 승인 복구용.
async function getTossPaymentByOrderId(
  orderId: string,
  basicAuth: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${TOSS_PAYMENTS_BASE}/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: basicAuth },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// 결제 금액 서버 재계산 — create_order v3 의 산정 로직을 그대로 옮긴 것.
// (원본: 20260728000000_pickup_deadline_geo_qr_paymethod.sql create_order)
// 여기 값이 RPC 재계산과 다르면 RPC 가 'amount mismatch' 로 던지고 우리는 결제를 취소한다.
type PriceResult = { amount: number; productName: string };
async function calcAmount(
  supabase: SupabaseClient,
  uid: string,
  productId: string,
  quantity: number,
  couponIds: string[],
): Promise<PriceResult> {
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, name, sale_price, status, stock, seller_id")
    .eq("id", productId)
    .maybeSingle();
  if (productError) throw new Error("상품 정보를 확인하지 못했습니다.");
  if (!product) throw new Error("product not found");
  if (product.status !== "selling") throw new Error("product not on sale");
  if ((product.stock as number) < quantity) throw new Error("insufficient stock");

  const gross = (product.sale_price as number) * quantity;
  let discount = 0;

  if (couponIds.length > 0) {
    // 유효 쿠폰 필터(RPC 와 동일): 활성 + (요청상태 null 또는 approved) + 기간 + 보유·미사용.
    // 날짜 비교는 DB current_date(UTC 기준) 와 맞추기 위해 UTC 날짜를 쓴다.
    const today = new Date().toISOString().slice(0, 10);
    const { data: coupons, error: couponError } = await supabase
      .from("coupons")
      .select(
        "id, seller_id, discount_type, discount_value, max_discount_amount, min_order_amount, allow_stacking, is_active, request_status, starts_on, ends_on",
      )
      .in("id", couponIds);
    if (couponError) throw new Error("쿠폰 정보를 확인하지 못했습니다.");
    const { data: owned, error: ownedError } = await supabase
      .from("user_coupons")
      .select("coupon_id, is_used")
      .eq("buyer_id", uid)
      .in("coupon_id", couponIds);
    if (ownedError) throw new Error("쿠폰 정보를 확인하지 못했습니다.");
    const usableIds = new Set((owned ?? []).filter((u) => !u.is_used).map((u) => u.coupon_id));

    const valid = (coupons ?? []).filter((c) =>
      c.is_active === true &&
      (c.request_status === null || c.request_status === "approved") &&
      (!c.starts_on || (c.starts_on as string) <= today) &&
      (!c.ends_on || (c.ends_on as string) >= today) &&
      usableIds.has(c.id)
    );

    let nonStackable = 0;
    for (const c of valid) {
      if (c.seller_id && c.seller_id !== product.seller_id) {
        throw new Error("coupon not valid for this store");
      }
      if (gross < (c.min_order_amount as number)) {
        throw new Error("order below coupon minimum");
      }
      if (c.allow_stacking !== true) nonStackable += 1;

      let d = c.discount_type === "amount"
        ? (c.discount_value as number)
        : Math.floor(gross * (c.discount_value as number) / 100);
      if (c.discount_type === "rate" && c.max_discount_amount != null) {
        d = Math.min(d, c.max_discount_amount as number);
      }
      discount += d;
    }
    if (valid.length > 1 && nonStackable > 0) throw new Error("coupon not stackable");
    discount = Math.min(discount, gross);
  }

  const name = (product.name as string) ?? "주문";
  return {
    amount: gross - discount,
    // 사용자앱 OrderScreen 과 동일한 orderName 규칙(최대 100자).
    productName: (quantity > 1 ? `${name} ${quantity}개` : name).slice(0, 100),
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
    const { paymentMethodId, productId, quantity, couponIds, orderId: bodyOrderId } = body as {
      paymentMethodId?: string;
      productId?: string;
      quantity?: number;
      couponIds?: string[];
      orderId?: string;
    };
    if (typeof paymentMethodId !== "string" || !paymentMethodId) {
      return json({ error: "결제수단을 선택해주세요." }, 400);
    }
    if (typeof productId !== "string" || !productId) {
      return json({ error: "상품 정보가 올바르지 않습니다." }, 400);
    }
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
      return json({ error: "수량이 올바르지 않습니다." }, 400);
    }
    const coupons = Array.isArray(couponIds) ? couponIds.filter((c) => typeof c === "string") : [];
    if (typeof bodyOrderId === "string" && bodyOrderId && !ORDER_ID_RE.test(bodyOrderId)) {
      return json({ error: "주문번호 형식이 올바르지 않습니다." }, 400);
    }
    const orderId = (typeof bodyOrderId === "string" && bodyOrderId) ? bodyOrderId : makeTossOrderId();

    // 주문 생성 RPC 호출 공용 파라미터(toss-confirm 과 동일 시그니처).
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

    // ── 3) 멱등 가드: 같은 orderId 로 이미 만들어진 '본인' 주문이 있으면 그대로 반환 ──
    // 조회 실패 시에는 진행하지 않는다(가드 무력화 → 이중 승인 위험 차단).
    try {
      const existing = await findMyOrder(supabase, "toss_order_id", orderId, uid);
      if (existing) return json({ order: existing }, 200);
    } catch (e) {
      console.error("[toss-billing-charge] 멱등 가드 조회 실패:", e);
      return json({ error: "일시적인 오류입니다. 잠시 후 같은 주문번호로 다시 시도해주세요." }, 500);
    }

    // ── 4) 카드 확인 — 본인 소유만(billing_key 는 여기서만 사용) ────────────
    const { data: method, error: methodError } = await supabase
      .from("payment_methods")
      .select("id, billing_key, customer_key, buyer_id")
      .eq("id", paymentMethodId)
      .eq("buyer_id", uid)
      .maybeSingle();
    if (methodError) {
      console.error("[toss-billing-charge] 카드 조회 실패:", methodError);
      return json({ error: "결제수단을 확인하지 못했습니다. 잠시 후 다시 시도해주세요." }, 500);
    }
    if (!method) {
      return json({ error: "등록된 결제수단을 찾을 수 없습니다." }, 404);
    }

    // ── 5) 결제 금액 서버 재계산 ────────────────────────────────────────────
    let price: PriceResult;
    try {
      price = await calcAmount(supabase, uid, productId, quantity, coupons);
    } catch (e) {
      // 상품/쿠폰 검증 실패는 결제 전이므로 그대로 400 (앱이 기존 ORDER_ERROR_MAP 으로 해석).
      return json({ error: (e as Error).message }, 400);
    }
    const amount = price.amount;

    // 전액 쿠폰(0원): 토스 승인 없이 무결제 주문 — RPC 가 amount=0 을 재검증한다.
    if (amount === 0) {
      const { data: order, error: rpcError } = await createOrder({
        paymentKey: null, tossOrderId: null, method: null, paidAmount: 0,
      });
      if (rpcError) return json({ error: rpcError.message }, 400);
      return json({ order }, 200);
    }

    const secretKey = Deno.env.get("TOSS_SECRET_KEY");
    if (!secretKey) {
      return json({ error: "서버에 TOSS_SECRET_KEY 가 설정되지 않았습니다." }, 500);
    }
    // Basic 인증: base64("{시크릿키}:") — 시크릿 키 뒤 콜론 필수, 비밀번호 없음.
    const basicAuth = "Basic " + btoa(`${secretKey}:`);

    // ── 6) 빌링키 자동결제 승인 ─────────────────────────────────────────────
    let payment: Record<string, unknown> | null = null;
    let chargeOk = false;
    try {
      const chargeRes = await fetch(
        `${TOSS_BILLING_BASE}/${encodeURIComponent(method.billing_key as string)}`,
        {
          method: "POST",
          headers: {
            Authorization: basicAuth,
            "Content-Type": "application/json",
            // 결정적 멱등키 — 재시도가 새 승인이 아니라 원래 응답을 재생하게 한다.
            "Idempotency-Key": `billing-${orderId}`.slice(0, 300),
          },
          body: JSON.stringify({
            customerKey: method.customer_key,
            amount,
            orderId,
            orderName: price.productName,
          }),
        },
      );
      payment = await chargeRes.json().catch(() => null);
      chargeOk = chargeRes.ok;
      if (!chargeOk && payment?.code !== "ALREADY_PROCESSED_PAYMENT") {
        // 토스 에러 { code, message } 를 그대로 전달(코드 포함 — 클라 분기용).
        return json(
          { error: (payment?.message as string) ?? "결제 승인에 실패했습니다.", code: payment?.code },
          chargeRes.status >= 500 ? 502 : 400,
        );
      }
    } catch (fetchError) {
      // 네트워크 예외라도 승인은 됐을 수 있다 → 단건 조회로 실제 상태 확인.
      console.error("[toss-billing-charge] 승인 요청 네트워크 오류:", fetchError);
      chargeOk = false;
      payment = null;
    }

    // 승인 응답을 못 받았거나 ALREADY_PROCESSED 인 경우: orderId 로 실제 상태 확인.
    if (!chargeOk) {
      const inquiry = await getTossPaymentByOrderId(orderId, basicAuth);
      if (inquiry && inquiry.status === "DONE" && inquiry.totalAmount === amount) {
        payment = inquiry;
      } else {
        return json({ error: "결제 승인 상태를 확인하지 못했습니다. 잠시 후 같은 주문번호로 다시 시도해주세요." }, 502);
      }
    }

    const paymentKey = typeof payment?.paymentKey === "string" ? payment.paymentKey : "";
    if (!paymentKey) {
      console.error("[toss-billing-charge] 승인 응답에 paymentKey 가 없음. orderId:", orderId);
      return json({ error: "결제 승인 결과를 확인하지 못했습니다. 잠시 후 주문 내역을 확인해주세요." }, 502);
    }

    // ── 7) 승인 성공 → 주문 생성(RPC) ───────────────────────────────────────
    const { data: order, error: rpcError } = await createOrder({
      paymentKey,
      tossOrderId: orderId,
      method: (payment?.method as string) ?? "카드",
      paidAmount: amount,
    });

    if (rpcError) {
      // ⚠️ 곧바로 취소하지 않는다(toss-confirm 과 동일 이유):
      //   ① 응답 유실 — DB 는 커밋됐는데 네트워크 오류로 error 반환.
      //   ② 동시 요청 — 다른 요청이 먼저 커밋해 unique(payment_key) 위반(23505).
      let committed: Record<string, unknown> | null = null;
      try {
        committed = await findMyOrder(supabase, "payment_key", paymentKey, uid);
      } catch {
        // 재조회 실패: 주문 존재 여부 불명 — 절대 취소하지 않는다(정상 결제 취소 방지).
        return json({ error: "주문 상태를 확인하지 못했습니다. 잠시 후 같은 주문번호로 다시 시도해주세요." }, 500);
      }
      if (committed) {
        return json({ order: committed }, 200);
      }

      // 주문이 정말 없음 → 검증 실패(재고/쿠폰/금액 불일치 등). 보상 취소 수행.
      let cancelOk = false;
      try {
        const cancelRes = await fetch(`${TOSS_PAYMENTS_BASE}/${encodeURIComponent(paymentKey)}/cancel`, {
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
          console.error("[toss-billing-charge] 보상 취소 HTTP 실패:", cancelBody, "paymentKey:", paymentKey);
        }
      } catch (cancelError) {
        console.error("[toss-billing-charge] 보상 취소 실패:", cancelError, "paymentKey:", paymentKey);
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
    console.error("[toss-billing-charge] unexpected error:", e);
    return json({ error: "결제 처리 중 오류가 발생했습니다. 잠시 후 같은 주문번호로 다시 시도해주세요." }, 500);
  }
});
