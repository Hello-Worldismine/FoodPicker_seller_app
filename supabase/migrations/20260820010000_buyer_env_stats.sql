-- ============================================================================
-- 20260820010000_buyer_env_stats.sql
-- 소비자앱 마이페이지 '환경 기여 통계' 실데이터화.
--
-- 그동안 MyPageScreen 의 3개 타일(구한 음식 12개 / 예상 절감 38,000원 / 폐기 감소 4.2kg)은
-- 하드코딩된 목데이터였다(ENV_STATS 상수 + "TODO: GET /api/users/me/stats").
--
-- [절감액 정의] 원가 − 실제 결제액 (누적)
--   원가        = products.original_price × 수량   (정가. 주문에는 스냅샷이 없어 조인해 읽는다)
--   결제액      = orders.amount                    (쿠폰 할인까지 반영된 실결제액)
--   → 상품이 삭제돼 조인이 비면 orders.total_price(=판매가×수량)로 폴백하므로
--     그 주문은 쿠폰 할인분만 절감으로 잡힌다(과대계상 방지).
--   → 정가보다 비싸게 팔릴 수는 없지만, 데이터 이상으로 음수가 나오면 0 으로 자른다.
--
-- [집계 대상] 취소·환불되지 않은 본인 주문 전부.
--   픽업완료(completed)만 세면 결제 직후에는 계속 0 으로 보여 "값이 안 들어온다" 는
--   인상을 준다. 결제 시점부터 반영하고 취소하면 빠지는 쪽이 체감과 맞는다.
--
-- 'kg(폐기 감소)' 타일은 산출 기준이 없어 앱에서 제거했다(이 함수도 내보내지 않는다).
--
-- 멱등 — 재실행 안전.
-- ============================================================================

create or replace function public.my_env_stats()
returns table (saved_count integer, saved_amount integer)
language sql stable security definer set search_path = public, pg_temp
as $$
  select
    coalesce(sum(o.quantity), 0)::integer,
    coalesce(sum(
      greatest(coalesce(p.original_price * o.quantity, o.total_price) - o.amount, 0)
    ), 0)::integer
  from public.orders o
  left join public.products p on p.id = o.product_id
  where o.buyer_id = auth.uid()
    and o.seller_status <> 'cancelled'
    and o.payment_status not in ('cancelled', 'refunded')
$$;

-- security definer 인 이유: products 는 판매자/관리자 기준 RLS 라서 구매자 세션으로는
-- 조인이 비어버린다(정가를 못 읽어 절감액이 쿠폰 분만 남는다).
-- auth.uid() 로 본인 주문만 집계하므로 남의 데이터는 새지 않는다.
-- anon 은 명시적으로 회수한다 — public 회수만으로는 Supabase 의 기본 grant 가 남는다
-- (20260818010000 에서 확인된 패턴).
revoke all on function public.my_env_stats() from public, anon;
grant execute on function public.my_env_stats() to authenticated;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
