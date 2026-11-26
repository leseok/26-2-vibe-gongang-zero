/** 브라우저와 서버가 공유하는 KOBIS 조회 조건 검증입니다. API 키는 받지 않습니다. */
const ALLOWED = new Set(['targetDt', 'weekGb', 'itemPerPage', 'multiMovieYn', 'repNationCd', 'wideAreaCd']);

/**
 * 조회 조건을 검증해 KOBIS 형식 URLSearchParams를 반환합니다.
 * targetDt는 필수 YYYYMMDD이며 편의를 위해 YYYY-MM-DD도 허용합니다.
 * 선택 조건의 빈 문자열은 생략하고 주말(1), 최대 10개를 기본값으로 사용합니다.
 */
export function createWeeklyQuery(filters = {}) {
  for (const key of Object.keys(filters)) {
    if (!ALLOWED.has(key)) throw new TypeError(`지원하지 않는 조회 조건: ${key}`);
    if (filters[key] !== undefined && filters[key] !== null && !['string', 'number'].includes(typeof filters[key])) {
      throw new TypeError(`${key}는 문자열 또는 숫자여야 합니다.`);
    }
  }
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '' && value !== null && value !== undefined) query.set(key, String(value));
  }
  const input = query.get('targetDt') || '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : input.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new TypeError('targetDt에 유효한 YYYYMMDD 또는 YYYY-MM-DD 날짜를 입력하세요.');
  }
  query.set('targetDt', date.replaceAll('-', ''));
  if (!query.has('weekGb')) query.set('weekGb', '1');
  if (!query.has('itemPerPage')) query.set('itemPerPage', '10');
  for (const [key, choices] of Object.entries({ weekGb: ['0', '1', '2'], multiMovieYn: ['Y', 'N'], repNationCd: ['K', 'F'] })) {
    if (query.has(key) && !choices.includes(query.get(key))) throw new TypeError(`${key} 허용값: ${choices.join(', ')}`);
  }
  if (!/^(?:[1-9]|10)$/.test(query.get('itemPerPage'))) throw new TypeError('itemPerPage는 1~10이어야 합니다.');
  if (query.has('wideAreaCd') && !/^\d+$/.test(query.get('wideAreaCd'))) throw new TypeError('wideAreaCd는 숫자로 된 지역 코드여야 합니다.');
  return query;
}
