// ============================================================================
// FoodPicker Edge Function: toss-cancel — 토스 결제 취소
//   (관리자 환불 / 판매자 취소승인 / 판매자 자발 주문취소)
//
// 요청(POST, Authorization: Bearer <JWT>):
//   { paymentKey: string, cancelReason: string }
// 응답: 200 { ok: true } / 에러 { error: string } (4xx/5xx)
//
// 권한(둘 중 하나) — 2026-07-31 개편:
//   ① 활성 관리자(admin_profiles.is_active) — 임의 결제 취소 가능(환불 처리).
//   ② 판매자 본인(본인 주문 & 취소 가능 상태) — paymentKey 가 본인 매장(seller_id=uid)
//      주문이고, 주문이 아직 취소 가능 상태(seller_status in new/confirmed)이며,
//      아직 취소 승인(approved)으로 환불이 끝나지 않았을 때.
//      판매자의 취소 경로는 두 가지이고 **둘 다 통과시켜야 한다**:
//        · [취소 승인]  cancel_request_status='requested' → respond_order_cancel(p_approve:true)
//        · [주문 취소]  cancel_request_status is null 또는 'rejected'(자발 취소)
//                       → seller_cancel_order()
//      어느 쪽이든 **먼저** 이 함수로 PG 전액취소를 하고, 성공한 뒤에 RPC 로 DB 를
//      반영한다(PG 먼저, DB 나중).
//      ⚠️ 여기서 'requested' 를 강제하면 판매자 자발 취소가 전량 400 으로 막힌다(회귀).
//      ⚠️ 'rejected' 도 막으면 안 된다 — 거절은 주문이 원래 상태로 되돌아간 것이지
//         마감된 것이 아니다. 막으면 한 번 거절한 주문을 판매자가 영영 취소할 수 없다.
//
//   ⚠️ '구매자 본인' 분기는 제거했다. 구버전 사용자앱은 이 함수를 먼저 호출하고
//      cancel_my_order 로 즉시 취소했는데, cancel_my_order 가 '취소 요청' shim 으로
//      바뀐 뒤에도 그대로 두면 '돈은 환불됐는데 주문은 살아있는' 상태가 만들어진다
//      (20260731000000_cancel_request_flow.sql §5). 그래서 구매자 호출은 403 으로 막고
//      앱 업데이트를 안내한다.
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

// ── service_role 키 해석 ─────────────────────────────────────────────────────
// 이 프로젝트는 새 API 키 체계(JWT Signing Keys)로 전환되어 대시보드에서
// SUPABASE_SERVICE_ROLE_KEY 가 DEPRECATED 로 표시된다. 레거시 키가 무효해지면
// 조용히 anon 으로 강등되어 RLS/함수 권한에 막히는(42501) 것이 가장 나쁜 실패 모드다.
// → 레거시 키 → SUPABASE_SECRET_KEYS(JSON) 순으로 찾고, 둘 다 없으면 즉시 실패한다.
function isServiceRoleKey(v: string): boolean {
  if (!v) return false;
  if (v.startsWith("sb_secret_")) return true;         // 새 체계 secret key
  const parts = v.split(".");
  if (parts.length !== 3) return false;                // 레거시 JWT 형태 아님
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

function resolveServiceKey(): { key: string; source: string } | null {
  const legacy = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (isServiceRoleKey(legacy)) return { key: legacy, source: "SUPABASE_SERVICE_ROLE_KEY" };

  const raw = (Deno.env.get("SUPABASE_SECRET_KEYS") ?? "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const values: string[] = Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === "string")
        : parsed && typeof parsed === "object"
        ? Object.values(parsed as Record<string, unknown>).filter((v): v is string => typeof v === "string")
        : [];
      const found = values.find(isServiceRoleKey);
      if (found) return { key: found, source: "SUPABASE_SECRET_KEYS" };
    } catch {
      // 형식이 바뀌면 아래 폴백으로.
    }
  }
  if (legacy) return { key: legacy, source: "SUPABASE_SERVICE_ROLE_KEY(unverified)" };
  return null;
}

// Authorization/apikey 를 명시해 어떤 경로로도 호출자 JWT 로 강등되지 않게 고정한다.
function serviceClient(key: string) {
  return createClient(Deno.env.get("SUPABASE_URL")!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${key}`, apikey: key } },
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
    // ── 0) service_role 키 확보 (없으면 조용히 강등되지 않도록 즉시 실패) ────
    const svc = resolveServiceKey();
    if (!svc) {
      console.error(
        "[toss-cancel] service_role 키를 찾을 수 없습니다. " +
          "SUPABASE_SERVICE_ROLE_KEY 또는 SUPABASE_SECRET_KEYS 를 확인하세요.",
      );
      return json({ error: "서버 설정 오류입니다.(service_role 키 없음) 관리자에게 문의해주세요." }, 500);
    }

    // ── 1) 호출자 인증 ──────────────────────────────────────────────────────
    const supabase = serviceClient(svc.key);
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

    // ── 3) 권한 검증: 관리자 또는 판매자 본인(취소 가능 상태) ───────────────
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
      // 판매자 경로: 본인 매장 주문 + 취소 가능 상태(취소승인/자발취소 공용).
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id, buyer_id, seller_id, seller_status, payment_status, cancel_request_status")
        .eq("payment_key", paymentKey)
        .maybeSingle();
      if (orderError) {
        return json({ error: "주문 확인에 실패했습니다. 잠시 후 다시 시도해주세요." }, 500);
      }
      if (!order) {
        return json({ error: "취소 권한이 없습니다." }, 403);
      }

      // 구버전 사용자앱(구매자 uid)에 그대로 노출되는 안내 문구다.
      // 구매자는 더 이상 직접 PG 취소를 할 수 없다 — [취소 요청] → 판매자 승인 경로만 유효.
      if (order.buyer_id === uid && order.seller_id !== uid) {
        return json({
          error: "앱 업데이트가 필요합니다. 주문 취소는 [취소 요청] 후 판매자 승인으로 진행됩니다.",
        }, 403);
      }

      if (order.seller_id !== uid) {
        return json({ error: "취소 권한이 없습니다." }, 403);
      }
      // 이미 승인되어 환불까지 끝난 건만 막는다(이중 환불 방지).
      // null(자발 취소) 과 'requested'(취소 승인) 는 둘 다 정상 경로다.
      //
      // ⚠️ 'rejected' 를 막으면 안 된다. 거절은 요청이 '마감된' 것이 아니라 주문이 원래 상태로
      //    되돌아간 것이다. 막아버리면 판매자가 취소요청을 한 번 거절한 주문을 이후 재고 소진 등의
      //    이유로 스스로 취소할 방법이 사라진다(seller_cancel_order 는 통과하는데 여기서만 막혀
      //    '이미 처리된 취소 요청입니다' 라는 무관한 문구가 뜬다). seller_status 검사로 충분하다.
      if (order.cancel_request_status === "approved") {
        return json({ error: "이미 취소 승인이 완료된 주문입니다." }, 400);
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
