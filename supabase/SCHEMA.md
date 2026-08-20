# FoodPicker 판매자 앱 — Supabase 스키마 문서

> 이 문서는 스키마 설계 워크플로 산출물입니다. 마이그레이션: `supabase/migrations/20260706000000_init.sql`

## RLS 요약

- stores: 본인(seller_id=auth.uid()) 행 SELECT/UPDATE만. INSERT는 가입 트리거(security definer), DELETE 없음. 컬럼 잠금으로 approval_status·commission_rate·rating·review_count·contract_start_date·seller_id 판매자 쓰기 차단.
- products: 본인 행 전체 CRUD. 컬럼 제한 없음(판매자 소유 콘텐츠).
- product_price_history: 본인 행 SELECT 전용. 기록은 트리거/service_role.
- orders: 본인 행 SELECT + UPDATE. 컬럼 잠금으로 UPDATE 가능 열은 seller_status·cancel_reason 뿐(금액/결제상태/PII 차단). 생성·삭제 없음.
- reviews: 본인 행 SELECT + UPDATE. 컬럼 잠금으로 UPDATE 가능 열은 owner_reply·owner_replied_at 뿐(구매자 저작 컬럼 차단). 생성·삭제 없음.
- settlements: 본인 행 SELECT 전용. 쓰기 없음.
- notifications: 본인 행 SELECT + UPDATE(읽음) + DELETE. 생성은 플랫폼.
- notices: is_published=true 공지 SELECT만(전역). 쓰기 정책 없음 = 판매자 거부.
- 시퀀스: order_code_seq·settlement_code_seq authenticated 권한 회수(생성=service_role 전용).

## 앱 필드 → DB 컬럼 매핑

## STORES (매장) — `storeInfo`
| 앱 필드 | DB 컬럼 | 비고 |
|---|---|---|
| id | id (uuid) | 앱은 정수 mock id → 서버 uuid로 교체 |
| name | name | |
| bizNumber | biz_number | |
| ownerName | owner_name | |
| residentNumber | resident_number | 앱 마스킹, 실서비스 암호화 권장 |
| address | address | |
| bankName / accountNumber / accountHolder | bank_name / account_number / account_holder | |
| phone | phone | |
| category | category | |
| description | description | |
| notice | notice | |
| tags | tags (text[]) | |
| storeImage | store_image | |
| openHours | open_hours (jsonb) | 구조 동일 |
| closedDays | closed_days (text[]) | |
| lat / lng | lat / lng | |
| approvalStatus | approval_status (enum approved/pending/rejected) | **판매자 쓰기 차단**(플랫폼 통제) |
| commissionRate | commission_rate | **판매자 쓰기 차단** |
| contractStartDate | contract_start_date | **판매자 쓰기 차단** |
| isSellingPaused | is_selling_paused | 판매자 쓰기 허용 |
| rating / reviewCount | rating / review_count | **판매자 쓰기 차단**, 리뷰 트리거로만 갱신 |

## PRODUCTS (상품) — `initialProducts`
| 앱 필드 | DB 컬럼 | 비고 |
|---|---|---|
| id / storeId | id / store_id | |
| name / category / emoji | name / category / emoji | |
| thumbnail / images | thumbnail / images (text[]) | thumbnail = images[0] |
| originalPrice / salePrice / discountRate | original_price / sale_price / discount_rate | |
| startPrice / floorPrice | start_price / floor_price | |
| reductionAmount / intervalMinutes | reduction_amount / interval_minutes | |
| stock | stock | |
| pickupStart / pickupEnd / expiryDate | pickup_start / pickup_end / expiry_date | |
| storage | storage (enum '실온'/'냉장'/'냉동') | **앱이 '냉장 보관' 저장 → 쓰기 전 ' 보관' strip 필수**(아래 followups) |
| storageDetail | storage_detail | |
| storageMethod | (컬럼 없음) → storage_detail 로 통합 | **dead field, 제거 대상**(followups) |
| status / pauseReason / rejectReason | status / pause_reason / reject_reason | |
| description / composition / origin | description / composition / origin | |
| allergens | allergens (text[]) | |
| allergyInfo | (컬럼 없음) | allergens 에서 앱 파생(allergensToString) |
| badges | (컬럼 없음) | 앱 파생(computeBadges) |
| cancelPolicy / storeNotice | cancel_policy / store_notice | |
| pickupAddress / lat / lng | pickup_address / lat / lng | 매장 스냅샷 |
| liked | (컬럼 없음) | 구매자 앱 전용 상태 |

## PRODUCT_PRICE_HISTORY — (앱 미노출, 트리거 자동기록)
| 개념 | DB 컬럼 |
|---|---|
| 이전가/신규가 | old_price / new_price |
| 할인율 | discount_rate |
| 사유 | reason ('initial'/'auto'/'manual') |

## ORDERS (주문) — `initialOrders`
| 앱 필드 | DB 컬럼 | 비고 |
|---|---|---|
| id | order_code ('FP-####') | 표시 코드. PK는 별도 uuid |
| productId / productName | product_id / product_name | product_name 스냅샷 |
| quantity | quantity | |
| store / storeAddress | store_name / store_address | 스냅샷 |
| buyerName / safeNumber | buyer_name / safe_number | |
| pickupStart / pickupEnd | pickup_start / pickup_end | |
| pickupTime | (컬럼 없음) | pickup_start/end 에서 앱 파생(**OrderDetail 미구현, followups**) |
| paymentStatus | payment_status (enum) | mock '결제완료' → 'paid'. 표시 라벨맵 필요(followups) |
| sellerStatus | seller_status (enum) | 앱 라벨맵 존재(ORDER_SELLER_STATUS) |
| status / userStatus | (컬럼 없음) | seller_status 에서 앱 파생 |
| totalPrice / amount / fee | total_price / amount / fee | **판매자 쓰기 차단** |
| cancelReason | cancel_reason | 판매자 쓰기 허용 |
| orderedAt / confirmedAt / completedAt / cancelledAt | ordered_at / confirmed_at / completed_at / cancelled_at | 전이시각 트리거 자동 |

## REVIEWS (리뷰) — `initialReviews`
| 앱 필드 | DB 컬럼 | 비고 |
|---|---|---|
| id | id | |
| user | reviewer_name | **판매자 쓰기 차단** |
| rating | rating | **판매자 쓰기 차단** |
| text | content | **판매자 쓰기 차단** |
| helpful | helpful_count | **판매자 쓰기 차단** |
| date | created_at | 'YYYY.MM.DD'는 앱 파생 |
| ownerReply | owner_reply | 판매자 쓰기 허용(+ owner_replied_at) |

## SETTLEMENTS (정산) — `initialSettlements`
| 앱 필드 | DB 컬럼 | 비고 |
|---|---|---|
| id | settlement_code ('ST-###') | |
| orderId | order_code | 스냅샷(+ order_id FK 선택) |
| productName | product_name | |
| amount / fee / platformFee / pgFee / refund | amount / fee / platform_fee / pg_fee / refund | |
| settlement | settlement_amount | |
| status | status (enum scheduled/completed/on_hold) | mock '정산완료' 등 → enum. **라벨맵 필요**(followups) |
| date | settled_on | |
| (알림 '6/23~6/29') | period_start / period_end | |

## NOTIFICATIONS (알림) — `initialNotifications`
| 앱 필드 | DB 컬럼 | 비고 |
|---|---|---|
| id | id | |
| type | type (enum) | |
| title / message | title / message | |
| read | is_read | |
| time | (컬럼 없음) | created_at 에서 상대시간 앱 파생 |
| (딥링크) | reference_type / reference_id | |

## NOTICES (공지) — `notices`
| 앱 필드 | DB 컬럼 |
|---|---|
| id | notice_code ('NC-###') |
| emoji / title / content | emoji / title / content |
| date | published_at |

## 후속 작업 (Followups) — 앱 코드 수정 필요 항목 포함

- [스키마 결정] enum(storage/settlement/payment)은 영문 키를 유지했다. 근거: 기존 앱 라벨맵(PRODUCT_STATUS/ORDER_SELLER_STATUS)이 이미 영문 키 기반이라 정합성/일관성상 DB를 한글 enum으로 바꾸는 것보다 앱에 라벨맵을 추가하는 편이 낫다. 따라서 아래 앱 수정이 병행되어야 함(마이그레이션 외 작업).
- [HIGH·앱수정] products.storage: ProductForm.jsx:303 `storage: storage + ' 보관'` 및 initialProducts의 '냉장 보관'/'실온 보관'을 그대로 INSERT/UPDATE하면 storage_type enum 위반으로 상품 등록/수정이 하드 실패한다. 쓰기 매핑 계층에서 `storage.replace(/ ?보관$/,'').trim()`로 bare 값('실온'/'냉장'/'냉동')만 전송하고, 화면 '냉장 보관' 표기는 storageToDisplay()로 파생하도록 통일. 읽기측(ProductForm.jsx:128 .replace(' 보관',''))은 이미 호환.
- [HIGH·앱수정] settlements.status: Settlement.jsx:18-30,120,130,346이 한글 리터럴('정산완료'/'정산예정'/'보류')을 필터 key·비교·표시에 직접 사용. appStore에 SETTLEMENT_STATUS = { scheduled:{label:'정산예정',color:'#FF8A3D'}, completed:{label:'정산완료',color:'#22A06B'}, on_hold:{label:'보류',color:'#E5484D'} } 추가 후 필터/비교/표시를 영문 키 기반으로 리팩터. 미적용 시 목록·합계·보류카운트가 전부 0으로 깨짐.
- [MEDIUM·앱수정] orders.payment_status: OrderDetail.jsx:163이 order.paymentStatus 원문 렌더. appStore에 PAYMENT_STATUS = { pending:'결제대기', paid:'결제완료', cancelled:'결제취소', refunded:'환불' } 추가 후 PAYMENT_STATUS[order.paymentStatus]로 표시.
- [MEDIUM·앱수정] 파생 표시필드 미구현: (1) OrderDetail.jsx:159 order.pickupTime → pickup_start/pickup_end 기반 '오늘/어제 HH:MM~HH:MM' 파생으로 교체(Orders.jsx의 formatPickupRange 재사용 가능), (2) Reviews.jsx:139 review.date → created_at→'YYYY.MM.DD', (3) Home.jsx:380 notif.time → created_at→상대시간('방금 전'). API 직렬화 계층에서 만들어 내려주거나 화면 파생함수 추가. raw 컬럼만 내려주면 undefined/공란.
- [LOW·앱수정] products.storageMethod 제거: ProductForm.jsx:304의 storageMethod write는 어디서도 read되지 않는 dead field. 상세 보관은 storage_detail(앱 storageDetail) 단일 컬럼으로 일원화. 기존/시드 storageMethod 텍스트는 storage_detail로 이관(시드에는 이미 반영). 스키마 컬럼 추가 불필요.
- [운영·approval 워크플로] stores 컬럼 잠금으로 판매자는 approval_status를 직접 쓸 수 없다. 그러나 Store.jsx AdminEditScreen.handleSubmit이 approval_status:'pending'을 함께 보내면 'permission denied for column'로 UPDATE 전체가 실패한다. 앱은 approval_status를 전송하지 말고, 플랫폼이 민감 컬럼(name·biz_number·resident_number·address·bank_name·account_number·account_holder) 변경 시 서버 로직(Edge Function 또는 BEFORE UPDATE 트리거)으로 approval_status='pending'을 세팅하도록 설계. 앱은 프로토타입(전부 TODO mock)이라 현재 파손은 없음.
- [운영·판매자 프로비저닝] 가입 트리거 role 게이트를 raw_app_meta_data로 옮겨 클라이언트 self-assign을 차단했다. 결과적으로 일반 supabase.auth.signUp 만으로는 매장이 자동 생성되지 않는다. 검증 완료된 판매자에 대해 service_role/Admin API로 app_metadata.role='seller'를 설정(그 시점에 매장 자동 생성)하거나, 별도 관리자 승인 엔드포인트에서 매장을 프로비저닝하는 흐름을 확정할 것.
- [선택·강화] notifications: 판매자가 자기 알림의 title/message도 UPDATE 가능(자기 소유 한정 저위험이라 이번엔 컬럼 잠금 미적용). 필요 시 `revoke update on public.notifications from authenticated; grant update (is_read) on public.notifications to authenticated;`로 읽음 플래그만 허용하도록 강화 가능.
- [선택·심층 방어] 크리티컬/하이는 컬럼 권한(권장 1차 fix)으로 충분히 차단됨. 추가로 stores/orders/reviews에 '보호 컬럼이 OLD와 달라지면 RAISE'하는 BEFORE UPDATE 가드 트리거를 심층 방어로 둘 수 있음(현재는 과설계 판단해 미포함).
- [시드 참고] settlements ST-002/ST-003의 order_code(FP-1019/FP-1018)는 현재 주문 목데이터에 없어 order_id는 null로 두었다(order_code 스냅샷만 표시). settlement_code/order_code를 명시 세팅하므로 코드 시퀀스는 진행되지 않는다 — 실서비스에서는 default(nextval) 사용 권장.
- [확장 메모] 멀티매장 확장 시 stores_seller_uk(seller_id UNIQUE)와 handle_new_seller 자동생성 로직을 제거하고, 복합 FK(store_id, seller_id) 및 컬럼 권한 정책은 그대로 재사용 가능.

## 후속 마이그레이션 20260708_self_provision (2026-07-08)

- **provision_my_store()** RPC(security definer, execute=authenticated): 로그인 사용자가 본인 매장을 멱등 생성(seller_id=auth.uid()로만, approval_status='approved'). role='seller' 자가부여는 여전히 불가 — 매장 행만 생성. 앱 온보딩 화면(가입→로그인→매장없음)에서 호출해 무한 스플래시 dead-end 제거.
- **stores.biz_cert_image** text 컬럼 + `grant update(biz_cert_image)` → 사업자등록증 이미지 URL을 판매자가 저장(Store.jsx 재업로드/변경신청이 Storage `{uid}/documents/`에 실제 업로드).
- **notices.notice_code** default `'NC-'||lpad(nextval('notice_code_seq'),3)` 추가(발번 누락 방지), 시퀀스 권한 authenticated 회수.
- 앱측 동반 수정: 알림 삭제 API(deleteNotification), 주문 취소사유 입력(cancel_reason 전송), 상품목록 최신순, 가격 인하 카운트다운을 last_reduced_at 기준으로 교정, 정산 수수료 임의 80/20 fallback 제거, 클라 만료/인하 dead code(expireProduct/reduceProductPrice) 제거, ProductForm 기타 알레르기 반영, 매장 알림설정(OS 설정)/고객센터(전화·이메일) 버튼 연결, 미리보기 목업 거리('280m') 제거·액션 연결.

## 후속 마이그레이션 20260709_realtime_and_batch (2026-07-09)

- **Realtime**: `supabase_realtime` 발행에 orders·notifications·products·reviews·settlements·stores 추가(멱등). 앱 `appStore.jsx`의 `seller-realtime` 채널이 구독→변경 슬라이스 재로딩(RLS로 본인 행만). 신규주문/정산/알림 실시간 반영.
- **flag_store_reapproval**(BEFORE UPDATE on stores): 민감정보(name/biz_number/resident_number/address/bank_name/account_number/account_holder/biz_cert_image) 변경 시 approval_status='pending' 자동 전환. 가드로 플랫폼 명시 승인/반려는 존중. → Store.jsx 변경신청의 로컬 'pending' 표시가 이제 서버와 일치.
- **generate_weekly_settlements()**(security definer) + pg_cron `foodpicker-weekly-settlements`('0 0 * * 3'): 전주(월~일 KST) 완료주문을 미생성분만 settlements 생성(수수료 8:2). 
- 앱측 동반: appStore 실시간 구독, Home 알림 삭제 버튼, authStore PKCE(?code=) 딥링크 처리.
- ⚠️ **사용자 조치**: 이 마이그레이션도 SQL Editor에서 실행해야 함(20260708과 함께).

## 후속 마이그레이션 20260818_settlement_completion (2026-08-18)

관리자 웹 '정산 관리'에서 화면만 있고 서버 경로가 없던 기능을 채운 정산 전용 보완. **적용 완료(운영 DB 반영됨).**

- **admin_set_settlement_status(ids[], status, memo, settled_on)**: 4번째 인자 `p_settled_on`(정산예정일=실지급일) 추가. 기존 3인자 시그니처는 drop 후 재생성(오버로드 모호성 방지 — 호출자는 관리자 웹뿐). 처리 시 **판매자에게 `notifications.type='settlement'` 알림을 판매자 단위로 1건씩 발송**한다. init 에서 enum 에 'settlement' 을 만들어 두고도 정산 알림을 생성하는 코드가 플랫폼 어디에도 없어(시드 1행만 존재) 판매자가 확정/보류를 앱에서 알 방법이 없던 문제.
- **admin_set_settlement_memo(ids[], memo)**: 상태 변경·알림 없이 `admin_memo` 만 갱신. 메모 수정이 잘못된 상태 알림을 유발하지 않게 경로 분리.
- **generate_settlements_range(start, end, pay)**: 기간 지정 정산 생성 공통 로직(멱등 — 정산행이 이미 있는 주문은 skip). 회계식은 20260715(쿠폰 부담) 승계.
- **generate_weekly_settlements()**: 함수명/ cron 잡(`foodpicker-weekly-settlements`, '0 0 * * 3') 유지한 채 내부만 교체 — **`platform_settings.settlement_cycle`(weekly/biweekly/monthly)을 읽어 마감 기간을 결정**하고 range 에 위임한다. 마감할 주기가 아니면 0 반환. 설정 화면의 '정산 주기' 셀렉트가 배치에 전혀 반영되지 않던 문제.
- **admin_generate_settlements(start, end, pay?)**: 관리자 수동 마감(cron 누락 복구·임시 마감). 기간 최대 94일, 감사 로그 기록.
- **default_commission_rate()** + `stores.commission_rate` DEFAULT 연결: `platform_settings.default_commission_rate` 가 어디에서도 읽히지 않아 신규 매장이 항상 하드코딩 10% 로 생성되던 문제. platform_settings 는 관리자 전용 RLS 라 security definer 로 감싸고 authenticated/anon 에 execute 부여.
- **admin_set_store_commission(store_id, rate)**: 매장별 수수료율 변경(감사 로그 + 판매자 알림). init 의 컬럼 잠금으로 판매자는 수정 불가인데 관리자용 경로도 없었다. **소급 없음** — 주문 생성 시점의 `stores.commission_rate` 로 `orders.fee` 가 확정되므로 기존 주문·정산은 불변.
- `flag_store_reapproval` 트리거는 commission_rate 를 감시 대상에 넣지 않으므로 수수료율 변경이 매장 재승인을 유발하지 않는다(확인함).

## 후속 마이그레이션 20260818010000_settlement_hardening (2026-08-18)

정산 전 영역 다각도 감사에서 확인된 결함 수정. **적용 완료(운영 DB 반영·검증됨).**

- **[SECURITY·CRITICAL] 배치 함수 권한 회수**: `generate_settlements_range` / `generate_weekly_settlements` 가 `anon`·`authenticated` 에게 EXECUTE 노출돼 있었다. 둘 다 security definer 인데 `is_admin()` 검사가 없어 **공개 anon 키만으로 정산 행 생성이 가능**했다. 원인은 `revoke all ... from public` 만 한 것 — Supabase 는 public 스키마 함수에 `alter default privileges` 로 anon/authenticated 에 EXECUTE 를 따로 부여하므로 PUBLIC 회수로는 지워지지 않는다. **새 함수를 만들 때는 반드시 `from public, anon, authenticated` 로 역할을 명시해 revoke 할 것**(`log_admin_action` 이 이 패턴을 이미 쓰고 있었다). 추가로 `current_setting('request.jwt.claims', true) is not null and not is_admin()` 가드를 함수 안에 넣어, 권한이 어떤 이유로 되돌아가도 PostgREST 경유 호출은 막히게 했다(pg_cron 내부 호출에는 claims 가 없어 영향 없음).
- **admin_refund_order 정산 차감 교정**: `status='scheduled'` 행만 차감해서 (a) 보류(on_hold) 정산은 환불이 반영되지 않아 과지급이 나고 (b) 순매출(amount−fee)만 빼서 쿠폰 본사 보전분이 정산액에 남았다. → `_apply_order_full_refund`(20260731)와 동일하게 `status <> 'completed'` 행을 `fee/platform_fee/pg_fee/settlement_amount = 0` 으로 정리. 이미 `completed`(지급 완료)인 행은 금액을 건드리지 않고 `admin_memo` 에 회수 필요를 남기고 감사 로그에 건수를 기록한다.
- **admin_set_settlement_status 에 `p_from_status` 가드**(5인자로 재생성): 관리자 웹은 판매자×기간 그룹 단위로 처리하는데 한 그룹에 상태가 섞이면 그룹의 모든 행 id 가 무필터로 넘어와 지급 완료 행의 `settled_on` 이 덮이고 중복 금액 알림이 나갔다. 지정 시 해당 상태 행만 갱신하고, 알림·감사 로그도 CTE `returning` 으로 **실제 바뀐 행** 기준으로 집계한다.
- **격주 판정 교체**: ISO 주차 패리티(`extract(week) % 2`)는 53주차 연도(2026 포함)의 연말·연초에서 홀수 주가 연달아 나와 한 주를 통째로 건너뛴다. → 고정 에폭(2026-01-05 월) 기준 14일 주기.
- **settlement_code 발번 절단 수정**: `lpad(x, 3, '0')` 은 3자리 초과 문자열을 **절단**한다(`lpad('1000',3,'0') = '100'`). 1000번째 정산에서 기존 `ST-100` 과 충돌해 unique 위반 → 정산 생성 배치가 영구 실패한다. → `fmt_seq_code()`(20260716)로 교체. ⚠️ **`notices.notice_code`(20260716000000_admin.sql:497) 에 동일한 lpad(...,3) 이 남아 있다 — 공지 1000건째에 같은 방식으로 터진다(정산 범위 밖이라 이번엔 손대지 않음).**
- **admin_delete_settlements(ids[], reason)**: 잘못 생성된 정산 행 삭제(정정용). 멱등 가드가 `order_id` 기준이라 재생성으로도 교정할 수 없던 문제. `status <> 'completed'` 만 삭제(회계 기록 보존), 사유 필수, 감사 로그 기록. 삭제하면 해당 주문은 `admin_generate_settlements` 로 재생성 가능.

### 판매자 앱 동반 수정(같은 커밋, 앱 릴리스는 별도)

- `mapSettlement` 에 `admin_memo`/`period_start`/`period_end` 매핑 추가 — 관리자 보류 사유가 매핑조차 안 돼 판매자에게 전혀 안 보였다.
- 정산 카드가 `coupon_burden` 을 결제금액에서 또 빼 금액식이 안 맞았다(결제금액에 이미 반영된 값 → 이중 차감). 참고 표시로 바꾸고 **정산 조정액**을 추가해 `판매금액 − 수수료 − 환불 + 조정 = 정산금액` 이 항상 맞아떨어지게 했다.
- 주간 필터가 `settled_on` 기준이라, 관리자가 정산예정일을 미래로 지정하면 어느 주에도 안 잡혀 **조회 자체가 불가**했다 → 정산 구간(`period_start`/`period_end`) 우선 필터.
- '매주 수요일 지급' 하드코딩 제거 — 판매자 앱은 `platform_settings` 를 읽을 권한이 없어 주기를 알 수 없으므로, 실제 정산 데이터의 가장 이른 미지급 `settled_on` 을 '다음 정산일'로 쓴다.
- `type='settlement'` 알림 딥링크(인앱 알림·푸시 → 정산 탭) 추가.

## 후속 마이그레이션 20260820000000_code_sequence_repair (2026-08-20)

결제 직후 주문 생성이 `duplicate key value violates unique constraint "orders_order_code_key"` 로 실패하던 문제. **⚠️ 아직 미적용 — Supabase SQL Editor 에서 실행 필요.**

- **[원인] 시드의 명시 삽입이 시퀀스를 진행시키지 않는다.** `orders.order_code` 기본값은 `'FP-' || nextval('order_code_seq')`(init:182)이고 시퀀스는 1000 부터인데, `seed_dev.sql:85~` 가 `FP-1018`~`FP-1024` 7건을 **order_code 명시값으로** 넣는다. 명시 삽입은 시퀀스를 건드리지 않으므로 실주문이 18건째에 도달하는 순간 **7건 연속 unique 위반** → `create_order` 롤백 → 앱이 결제를 취소한다. `nextval` 은 롤백돼도 되돌아가지 않아 재시도마다 번호가 하나씩 올라가고 `FP-1025` 에 닿으면 다시 성공하므로, 사용자에게는 "같은 상품을 한 번 더 주문할 때만 실패" 처럼 **간헐적 증상**으로 보인다.
- **같은 구조가 두 곳 더 있었다**: 시드 `ST-001`~`003`(정산 생성 배치가 첫 3건에서 통째로 실패), `NC-001`~`003`(공지 작성 실패).
- **수정 1 — 시퀀스 보정**: `order_code_seq`/`settlement_code_seq`/`notice_code_seq` 를 기존 데이터의 최대 번호 위로 `setval`. 코드에서 숫자만 뽑아 비교하되 **`max()` 전에 `::bigint` 캐스팅**한다(text 로 비교하면 `'999' > '1024'` 가 되어 보정이 빗나간다).
- **수정 2 — 발번 스킵 함수**: `next_order_code()` / `next_settlement_code()` 를 기본값으로 걸어, 이미 존재하는 코드는 건너뛰고 다음 번호를 받게 했다. 시드를 다시 넣거나 코드를 수동 삽입해 시퀀스가 또 어긋나도 결제·정산 배치가 실패하지 않는다. security definer 인 이유는 시퀀스 usage 가 `authenticated` 에서 회수돼 있고(init:506) 기본값 표현식은 INSERT 하는 롤 권한으로 평가되기 때문이다. 무한 루프 방지로 1000회 초과 시 예외.
- **수정 3 — `notices.notice_code` 의 `lpad(...,3)` 절단 제거**: 20260818010000 이 `settlement_code` 에서 고친 것과 같은 결함(1000번째에서 `NC-100` 충돌). `fmt_seq_code()` 로 교체 — 그 마이그레이션에 남겨둔 ⚠️ 항목을 여기서 닫는다.
