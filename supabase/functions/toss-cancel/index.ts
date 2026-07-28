// ============================================================================
// FoodPicker Edge Function: toss-cancel — 토스 결제 취소(관리자 환불 / 구매자 주문 취소)
//
// 요청(POST, Authorization: Bearer <JWT>):
//   { paymentKey: string, cancelReason: string }
// 응답: 200 { ok: true } / 에러 { error: string } (4xx/5xx)
//
// 권한(둘 중 하나):
//   ① 활성 관리자(admin_profiles.is_active) — 임의 결제 취소 가능(환불 처리).
//   ② 구매자 본인 — paymentKey 가 본인(buyer_id=uid) 주문이고, 주문이 아직
//      취소 가능 상태(seller_status in new/confirmed — cancel_my_order 와 동일 규칙)일 때만.
//      (구매자 주문 취소 시 DB 취소(cancel_my_order)에 앞서 PG 결제를 실제 환불하는 용도.)
//
// 멱등성: 이미 취소된 결제(ALREADY_CANCELED_PAYMENT)는 성공으로 간주한다 —
//   'PG 취소 성공 → DB 환불 실패 → 재시도' 흐름이 여기서 막히면 PG/DB 가 영구
//   불일치로 고착되기 때문. Idempotency-Key 도 paymentKey 기반 결정적 값을 사용.
//
// 환경변수: TOSS_SECRET_KEY(대시보드 Secrets 등록 필요),
//           SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY(Edge Functions 기본 제공).
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "허용되지 않은 메서드입니다." }, 405);
  }

  try {
    // ── 1) 호출자 인증 ──────────────────────────────────────────────────────
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
    const { paymentKey, cancelReason } = (body ?? {}) as {
      paymentKey?: string;
      cancelReason?: string;
    };
    if (typeof paymentKey !== "string" || !paymentKey) {
      return json({ error: "paymentKey 가 누락되었습니다." }, 400);
    }
    if (typeof cancelReason !== "string" || !cancelReason.trim()) {
      return json({ error: "취소 사유를 입력해주세요." }, 400);
    }

    // ── 3) 권한 검증: 관리자 또는 구매자 본인 ───────────────────────────────
    const { data: admin, error: adminError } = await supabase
      .from("admin_profiles")
      .select("user_id")
      .eq("user_id", uid)
      .eq("is_active", true)
      .maybeSingle();
    if (adminError) {
      return json({ error: "권한 확인에 실패했습니다. 잠시 후 다시 시도해주세요." }, 500);
    }
    if (!admin) {
      // 구매자 본인 취소 경로: 본인 주문 + 취소 가능 상태(cancel_my_order 와 동일 규칙)
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id, buyer_id, seller_status, payment_status")
        .eq("payment_key", paymentKey)
        .maybeSingle();
      if (orderError) {
        return json({ error: "주문 확인에 실패했습니다. 잠시 후 다시 시도해주세요." }, 500);
      }
      if (!order || order.buyer_id !== uid) {
        return json({ error: "취소 권한이 없습니다." }, 403);
      }
      if (!["new", "confirmed"].includes(order.seller_status as string)) {
        return json({ error: "취소할 수 없는 주문 상태입니다." }, 400);
      }
    }

    // ── 4) 토스 결제 취소 API (전액 취소, 멱등) ─────────────────────────────
    const secretKey = Deno.env.get("TOSS_SECRET_KEY");
    if (!secretKey) {
      return json({ error: "서버에 TOSS_SECRET_KEY 가 설정되지 않았습니다." }, 500);
    }
    const cancelRes = await fetch(`${TOSS_API_BASE}/${encodeURIComponent(paymentKey)}/cancel`, {
      method: "POST",
      headers: {
        // Basic 인증: base64("{시크릿키}:") — 시크릿 키 뒤 콜론 필수.
        Authorization: "Basic " + btoa(`${secretKey}:`),
        "Content-Type": "application/json",
        // 결정적 멱등키: 네트워크 재시도가 새 요청이 아니라 원래 취소 응답을 재생하게 한다.
        "Idempotency-Key": `cancel-${paymentKey}`.slice(0, 300),
      },
      body: JSON.stringify({ cancelReason: cancelReason.trim().slice(0, 200) }),
    });
    if (!cancelRes.ok) {
      const err = await cancelRes.json().catch(() => null);
      // 이미 취소된 결제는 '원하는 최종 상태에 이미 도달'이므로 성공으로 간주 —
      // PG 취소 후 DB 환불이 실패했던 건의 재시도가 여기서 영구히 막히는 것을 방지.
      if (err?.code === "ALREADY_CANCELED_PAYMENT") {
        return json({ ok: true, alreadyCanceled: true }, 200);
      }
      const message = err?.message ?? "결제 취소에 실패했습니다.";
      return json({ error: message }, cancelRes.status >= 500 ? 502 : 400);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    console.error("[toss-cancel] unexpected error:", e);
    return json({ error: "결제 취소 처리 중 오류가 발생했습니다." }, 500);
  }
});
