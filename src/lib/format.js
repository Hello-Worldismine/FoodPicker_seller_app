// 전화번호 표시/입력 포맷 공용 유틸.
// 02(서울) 2자리, 1로 시작하는 8자리 대표번호(1588-XXXX 등) 4-4, 그 외 지역번호/휴대폰은 자릿수로 구분.
export function formatPhone(raw) {
  if (!raw) return '';
  const d = String(raw).replace(/\D/g, '').slice(0, 11);

  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }

  // 1588, 1800, 1544 등 8자리 대표번호 (4-4)
  if (d.startsWith('1')) {
    if (d.length <= 4) return d;
    return `${d.slice(0, 4)}-${d.slice(4, 8)}`;
  }

  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6, 10)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}`;
}
