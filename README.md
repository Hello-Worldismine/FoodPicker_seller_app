# FoodPicker 판매자 앱 (Seller App)

## 개요

FoodPicker 판매자용 모바일 앱입니다. 판매자가 마감 임박 식품 상품을 등록하고, 주문을 관리하며, 정산 내역 확인 및 매장 정보를 관리하는 기능을 제공합니다.

**현재 코드는 프론트엔드 프로토타입입니다.**
모든 데이터는 `src/store/appStore.jsx`의 Mock 데이터로 동작하며, 백엔드 연동 시 `// TODO:` 주석이 달린 위치를 실제 API 호출로 교체하면 됩니다.

---

## 기술 스택

| 항목 | 내용 |
|------|------|
| 프레임워크 | Expo SDK 53 / React Native 0.81 |
| UI 스타일링 | NativeWind v4 (Tailwind CSS for RN) |
| 네비게이션 | React Navigation 7 (Stack + Bottom Tab) |
| 상태 관리 | React Context API (`src/store/appStore.jsx`) |
| 아이콘 | lucide-react-native |
| 이미지 선택 | expo-image-picker |
| 주소 검색 | 다음 우편번호 API (WebView) |

---

## 화면 구성

### 하단 탭 네비게이션 (Main Tabs)

| 파일 | 탭 이름 | 주요 기능 |
|------|---------|-----------|
| `src/screens/Home.jsx` | 홈 | 오늘 판매 현황 대시보드, 최근 주문 목록, 판매 일시중지/재개, 공지 배너 롤링, 알림 모달 |
| `src/screens/Products.jsx` | 상품관리 | 상품 목록 (전체/판매중/품절/판매중지/반려 탭), 수량 조절, 실시간 가격 인하 프로그레스 바, 상태 변경, 삭제 |
| `src/screens/Orders.jsx` | 주문관리 | 주문 목록 (신규/픽업대기/픽업완료/취소 탭), 주문 확인·픽업 완료 처리 |
| `src/screens/Settlement.jsx` | 정산 | 정산 내역 조회 (이번 주/지난 주/직접 선택), 플랫폼 수수료·PG 수수료 분리 표시, 계좌 변경 불가 안내 |
| `src/screens/Store.jsx` | 매장관리 | 매장 정보 조회·수정 요청, 운영시간·휴무일 설정, 사업자 정보 변경 신청, 공지사항, 설정, 로그아웃 |

### 스택 화면 (Stack Screens)

| 파일 | 화면 이름 | 진입 경로 | 주요 기능 |
|------|----------|-----------|-----------|
| `src/screens/ProductForm.jsx` | 상품 등록/수정 | 홈 > 상품 빠른 등록, 상품관리 > 수정 버튼 | 상품 정보 입력, 실시간 가격 인하 설정 (시작가/하한가/인하 금액/인하 간격), 이미지·소비기한·픽업 시간 설정 |
| `src/screens/OrderDetail.jsx` | 주문 상세 | 주문관리 > 주문 카드 | 주문 상세 정보, 취소 사유 표시, 주문 확인·픽업 완료 처리 |
| `src/screens/Reviews.jsx` | 리뷰 관리 | 매장관리 > 리뷰 관리 | 리뷰 목록 조회, 사장님 답글 작성·수정 |
| `src/screens/NoticeList.jsx` | 공지사항 목록 | 매장관리 > 공지사항, 홈 배너 탭 | 공지사항 전체 목록 최신순 표시 |
| `src/screens/NoticeDetail.jsx` | 공지사항 상세 | 공지사항 목록 > 항목 탭, 홈 배너 탭 | 공지 내용 전체 보기 |

---

## 상태 관리 (`src/store/appStore.jsx`)

앱의 모든 데이터와 비즈니스 로직이 집중된 파일입니다. 백엔드 연동 시 이 파일을 우선적으로 수정합니다.

### Mock 데이터 → API 교체 대상

| 변수 | 설명 | 교체 API |
|------|------|---------|
| `initialProducts` | 상품 목록 | `GET /api/seller/products` |
| `initialOrders` | 주문 목록 | `GET /api/seller/orders` |
| `initialReviews` | 리뷰 목록 | `GET /api/seller/reviews` |
| `initialSettlements` | 정산 내역 | `GET /api/seller/settlements` |
| `initialNotifications` | 알림 목록 | `GET /api/seller/notifications` |
| `notices` | 공지사항 목록 | `GET /api/notices` |
| `storeInfo` 초기값 | 매장 정보 | `GET /api/seller/store` |

### Context 제공 함수 → API 호출로 교체

| 함수 | 설명 | 교체 API |
|------|------|---------|
| `pauseSale()` | 판매 일시중지 | `PATCH /api/seller/store/selling-status` |
| `resumeSale()` | 판매 재개 | `PATCH /api/seller/store/selling-status` |
| `addProduct(product)` | 상품 등록 | `POST /api/seller/products` |
| `updateProduct(id, data)` | 상품 수정 | `PUT /api/seller/products/:id` |
| `deleteProduct(id)` | 상품 삭제 | `DELETE /api/seller/products/:id` |
| `updateProductStock(id, delta)` | 수량 변경 | `PATCH /api/seller/products/:id/stock` |
| `updateProductStatus(id, status)` | 상품 상태 변경 | `PATCH /api/seller/products/:id/status` |
| `expireProduct(id)` | 소비기한 만료 자동 처리 | 서버 스케줄러 권장 |
| `reduceProductPrice(id)` | 가격 자동 인하 | 서버 스케줄러 권장 |
| `confirmOrder(orderId)` | 주문 확인 | `PATCH /api/seller/orders/:id/confirm` |
| `completePickup(orderId)` | 픽업 완료 처리 | `PATCH /api/seller/orders/:id/complete` |
| `cancelOrder(orderId)` | 주문 취소 처리 | `PATCH /api/seller/orders/:id/cancel` |
| `markNotificationRead(id)` | 알림 읽음 처리 | `PATCH /api/seller/notifications/:id/read` |
| `markAllNotificationsRead()` | 전체 알림 읽음 | `PATCH /api/seller/notifications/read-all` |
| `updateReviewReply(reviewId, reply)` | 리뷰 답글 작성/수정 | `PUT /api/seller/reviews/:id/reply` |

---

## 주요 비즈니스 로직

### 상품 상태 흐름

```
selling (판매중)
  ├─ 수량이 0이 되면 → soldout (품절) [자동]
  ├─ 소비기한 만료 → paused (판매중지), pauseReason: 'expiry' [자동]
  └─ 판매자 수동 중지 → paused (판매중지)

soldout / paused
  └─ 판매자가 재개 → selling (수량 > 0 조건 필요)

hidden (반려)
  └─ 관리자가 상품 반려 시 설정, rejectReason 포함
  └─ 판매자가 수정 후 재등록
```

### 실시간 가격 자동 인하

상품에 아래 필드가 설정된 경우 활성화됩니다.

| 필드 | 설명 |
|------|------|
| `startPrice` | 인하 시작 가격 |
| `floorPrice` | 최저 하한가 |
| `reductionAmount` | 회당 인하 금액 |
| `intervalMinutes` | 인하 간격 (분) |

- 인하 공식: `새 가격 = max(floorPrice, 현재가 - reductionAmount)`
- 현재는 클라이언트(Products.jsx)에서 1초 interval로 감지
- **백엔드 스케줄러 처리 권장** (앱이 백그라운드 상태일 때 클라이언트 감지 불가)

### 정산

- 지급 주기: 매주 수요일 (전주 월요일~일요일 기준)
- 수수료 구성: `플랫폼 수수료 + PG(결제) 수수료`
- 정산일 기준 3일 전부터 계좌 변경 불가

---

## 네비게이션 구조 (`App.js`)

```
RootNavigator (Stack)
├── MainTabs (BottomTab)
│   ├── Home          → src/screens/Home.jsx
│   ├── Products      → src/screens/Products.jsx
│   ├── Orders        → src/screens/Orders.jsx
│   ├── Settlement    → src/screens/Settlement.jsx
│   └── Store         → src/screens/Store.jsx
├── ProductForm       → src/screens/ProductForm.jsx   (params: { productId? })
├── OrderDetail       → src/screens/OrderDetail.jsx   (params: { orderId })
├── Reviews           → src/screens/Reviews.jsx
├── NoticeList        → src/screens/NoticeList.jsx
└── NoticeDetail      → src/screens/NoticeDetail.jsx  (params: { noticeId })
```

---

## 백엔드 연동 시 추가 고려사항

| 항목 | 내용 |
|------|------|
| 인증 | 모든 `/api/seller/*` 엔드포인트에 판매자 JWT 토큰 인증 필요 (현재 미구현) |
| 이미지 업로드 | 상품 이미지, 사업자등록증 → S3 등 별도 스토리지에 업로드 후 URL 전달 |
| 실시간 알림 | 신규 주문·취소 알림 → FCM(Firebase Cloud Messaging) 연동 필요 |
| 소비기한 만료 | 서버 스케줄러(Cron)로 처리 권장 |
| 가격 자동 인하 | 서버 스케줄러(Cron)로 처리 권장 |
| 주소 검색 | `src/components/DaumPostcodeModal.jsx` — 다음 우편번호 API 사용 (별도 설정 불필요) |
