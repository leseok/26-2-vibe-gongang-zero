/** 순수 HTML의 <script type="module">에서 사용하는 KOBIS 주간·주말 클라이언트입니다. */
import { createWeeklyQuery } from './query.js';
export const KOBIS_API_URL = '/api/kobis-weekly';

/** HTTP 상태와 오류 코드를 화면에 전달합니다. 발급 키는 브라우저에 전달하지 않습니다. */
export class KobisApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'KobisApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * 주간·주말·주중 박스오피스 조회 결과를 반환합니다.
 * @param {Object} filters 필수 targetDt, 선택 weekGb(0/1/2), itemPerPage(1~10), multiMovieYn, repNationCd, wideAreaCd.
 * @param {Object} options endpoint는 자체 서버 경로, signal은 요청 취소용 AbortSignal입니다.
 * @returns {Promise<Object>} boxofficeType, showRange, yearWeekTime, weeklyBoxOfficeList.
 * 영화별 숫자 필드는 KOBIS 원본 문자열을 유지하고 정상 빈 목록은 그대로 반환합니다.
 */
export async function getWeeklyBoxOffice(filters, { endpoint = KOBIS_API_URL, signal } = {}) {
  const query = createWeeklyQuery(filters);
  const base = globalThis.location?.href;
  // 브라우저에서는 같은 출처의 /api를 사용하며 Node에서 사용할 때는 절대 endpoint를 전달합니다.
  const url = new URL(endpoint, base);
  for (const [key, value] of query) url.searchParams.set(key, value);
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  let data;
  try { data = await response.json(); }
  catch { throw new KobisApiError('서버에서 JSON 응답을 받지 못했습니다.', response.status, 'INVALID_RESPONSE'); }
  if (!response.ok) {
    throw new KobisApiError(data?.error?.message || '박스오피스 조회에 실패했습니다.', response.status, data?.error?.code || 'HTTP_ERROR');
  }
  if (!data?.boxOfficeResult || !Array.isArray(data.boxOfficeResult.weeklyBoxOfficeList)) {
    throw new KobisApiError('박스오피스 응답 형식이 올바르지 않습니다.', response.status, 'INVALID_RESPONSE');
  }
  return data.boxOfficeResult;
}
