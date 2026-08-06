// 표시 포맷 헬퍼.
//
// [주의] api.js:5 가 이 모듈의 formatPhone 을 import 하는데 파일이 레포에 커밋되지 않아
//        Metro 번들 해상이 실패(판매자앱 기동 불가)하던 상태였다 — 커밋 0ca7aec 에서
//        import 만 추가되고 파일은 누락됨. 이 파일이 그 누락을 메운다.

// 전화번호 하이픈 포맷. 이미 하이픈이 있어도 같은 결과를 내도록(멱등) 숫자만 뽑아 재조립한다.
// 지원: 서울(02), 지역번호(0XX), 휴대폰(01X), 대표번호(15XX/16XX/18XX), 안심번호(050X).
export function formatPhone(value) {
  if (value == null) return value;
  const d = String(value).replace(/\D/g, '');
  if (!d) return '';

  // 대표번호 8자리 (1588-1588, 1800-8018 …)
  if (/^1[5-9]\d{2}/.test(d) && d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;

  // 서울 02 — 국번 3자리 또는 4자리
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }

  // 그 외 0으로 시작하는 번호(휴대폰·지역번호·안심번호) — 앞 3자리 + 3~4 + 4
  if (d.startsWith('0')) {
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
  }

  return d;
}

// 사업자등록번호 000-00-00000
export function formatBizNumber(value) {
  if (value == null) return value;
  const d = String(value).replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

// 금액 1,234원
export function formatPrice(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('ko-KR') : '0';
}

// 픽업 마감 시각(절대) → '오늘 21:00까지' / '내일 09:00까지' / '7.31 09:00까지'.
// 정본 표기 헬퍼 — products.pickup_deadline_at / orders.pickup_deadline_at 용
// (마이그레이션 20260730000000: '주문 후 N분' 상대값 → '마감 시각' 절대값).
// withSuffix=false 면 '까지' 를 생략한다('픽업 마감 오늘 21:00' 처럼 앞말이 붙는 자리용).
export function formatDeadlineClock(value, withSuffix = true) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d);  day.setHours(0, 0, 0, 0);
  const diffDay = Math.round((day - today) / 86400000);
  const dayLabel =
    diffDay === 0 ? '오늘'
      : diffDay === 1 ? '내일'
        : diffDay === -1 ? '어제'
          : `${d.getMonth() + 1}.${d.getDate()}`;

  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${dayLabel} ${hhmm}${withSuffix ? '까지' : ''}`;
}

// 주문 후 픽업 마감(분) → '30분' / '1시간' / '1시간 30분'
// [구 데이터용] 상품 마감은 formatDeadlineClock(절대 시각)을 쓴다. 주문의
// pickup_deadline_minutes(주문 시점 기준 남은 분)만 이 포맷을 계속 사용한다.
export function formatDeadlineMinutes(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return '';
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}시간 ${rest}분` : `${h}시간`;
}
