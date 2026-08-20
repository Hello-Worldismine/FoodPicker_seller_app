# 정산 테스트 가이드

> 요약: **픽업완료 처리만으로는 정산 화면에 금액이 뜨지 않는다.** 정산은 주문에서 실시간 파생되는
> 값이 아니라, 기간을 마감해 `settlements` 테이블에 **행을 만들어야** 생기는 회계 기록이기 때문이다.
> 테스트 중에는 관리자 웹의 **정산 관리 → 정산 생성** 으로 그 마감을 수동으로 돌려야 한다.

## 1. 정산이 만들어지는 흐름

```
상품등록 → 소비자 결제(orders.payment_status='paid', fee = 결제액 × 매장 수수료율)
        → 판매자 픽업완료(complete_pickup RPC → seller_status='completed', completed_at 기록)
        → [여기서 끊긴다]
        → 정산 마감 배치 or 관리자 수동 생성 → settlements 행 생성(status='scheduled')
        → 판매자앱 정산 / 관리자 정산 관리에 표시(둘 다 settlements 만 읽는다)
        → 관리자가 '확정' → status='completed' + 판매자에게 정산 알림
```

- 자동 배치: pg_cron `foodpicker-weekly-settlements`, **매주 수요일 09:00 KST**,
  대상은 **지난주 월~일**(`generate_weekly_settlements()` → `generate_settlements_range()`).
  즉 오늘 픽업완료한 주문은 **다음 주 수요일**에야 자동으로 정산 행이 생긴다.
- 생성 조건(모두 만족해야 함):
  `seller_status='completed'` · `completed_at is not null` ·
  `completed_at`(KST 날짜)이 마감 기간 안 · 그 주문에 정산 행이 아직 없음(멱등).

## 2. 테스트 절차 (권장 경로 — 관리자 웹)

1. 소비자앱에서 결제 → 판매자앱에서 **픽업완료** 처리.
2. 관리자 웹 로그인 → **정산 관리** → 우측 상단 **정산 생성** 버튼.
3. 모달 기본값은 *지난주 월~일* 이다. **테스트 주문을 픽업완료한 날짜로 시작일·종료일을 바꾼다**
   (오늘 테스트했다면 시작일=종료일=오늘). 정산예정일은 비워도 된다(다음 수요일 자동).
4. **정산 생성** → "N건 생성" 토스트. 목록에 `판매자 × 기간` 그룹 행이 나타난다.
5. 판매자앱 → **정산** 탭. Realtime 구독이 걸려 있어 대개 즉시 반영된다(안 되면 앱 재진입).
   - ⚠️ 정산 화면 기본 필터가 **'이번 주'** 다. 3번에서 지정한 기간이 지난주면 화면에 안 보인다.
     상단 기간 선택을 '지난 주'/직접 선택으로 바꿔서 확인할 것.
6. (선택) 관리자 웹에서 해당 그룹 **확정** → 판매자앱 알림 + 상태가 '정산완료'로 바뀌는지 확인.

### 금액 검증
- `판매금액(amount)` = 쿠폰 적용 후 실결제액
- `수수료(fee)` = amount × 매장 `commission_rate`% (플랫폼 80% / PG 20% 로 분해)
- `정산액` = (amount − fee) **+ 본사 쿠폰 보전분**
  → 본사 부담 쿠폰이 붙은 주문은 단순 뺄셈과 맞지 않는 게 정상이다.

## 3. 안 될 때 진단 (Supabase SQL Editor)

```sql
-- (1) 픽업완료 주문이 정산 대상 조건을 만족하는가
select order_code, seller_status, payment_status, completed_at,
       (completed_at at time zone 'Asia/Seoul')::date as kst_date,
       amount, fee, coupon_id
  from orders
 where seller_status = 'completed'
 order by completed_at desc nulls last limit 20;

-- (2) 정산 행이 실제로 있는가
select settlement_code, order_code, status, period_start, period_end, settled_on,
       amount, fee, settlement_amount
  from settlements order by created_at desc limit 20;

-- (3) 정산 RPC 가 배포돼 있는가(20260818 마이그레이션 적용 여부)
select proname, pg_get_function_identity_arguments(oid) as args
  from pg_proc
 where proname in ('admin_generate_settlements','generate_settlements_range',
                   'admin_set_settlement_status','admin_delete_settlements')
 order by proname;

-- (4) 주간 배치 cron 이 등록·실행되고 있는가
select jobid, jobname, schedule, active from cron.job;
select jobid, status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 10;

-- (5) SQL 에서 직접 마감 (관리자 웹 대신)
--     admin_generate_settlements 는 is_admin() 검사가 있어 SQL Editor(auth.uid()=null)에서는 실패한다.
--     내부 함수는 request.jwt.claims 가 없는 DB 내부 호출로 취급돼 통과한다.
select public.generate_settlements_range(current_date, current_date, current_date);
```

### 증상별 원인
| 증상 | 원인 / 조치 |
|---|---|
| 정산 생성 눌러도 "0건" | 그 기간에 `completed_at` 이 든 완료 주문이 없음. (1) 쿼리로 KST 날짜 확인 후 기간 재지정 |
| 이미 생성했는데 또 0건 | 멱등 가드 — 해당 주문은 이미 정산 행이 있다. (2) 쿼리로 확인 |
| "Could not find the function" 오류 | 20260818 마이그레이션 미적용. `supabase db push` 로 적용 |
| 관리자 목록엔 보이는데 판매자앱엔 없음 | 판매자앱 정산 화면 기간 필터(기본 '이번 주') 확인 |
| 수수료가 항상 10% | 매장 `commission_rate` 기본값. 관리자 웹에서 매장별 수수료율 변경 가능 |

## 4. 테스트 데이터 정리
잘못 만든 정산 행은 관리자 웹 정산 상세의 **삭제**(사유 필수, 지급 완료 건 제외)로 지운다.
삭제하면 멱등 가드가 풀려 같은 주문을 **정산 생성**으로 다시 만들 수 있다.
