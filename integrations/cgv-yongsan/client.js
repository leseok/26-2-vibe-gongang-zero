/**
 * 빌드 도구 없이 브라우저의 <script type="module">에서 가져오는 용산 CGV 클라이언트입니다.
 * CGV 원본 대신 CORS가 설정된 Cloudflare API를 호출하므로 비밀 키가 필요하지 않습니다.
 */
export const CGV_API_URL = 'https://cgv-yongsan-showtimes.jw4570g.workers.dev/api/showtimes';

/** HTTP 상태와 API 오류 코드를 화면의 실패 안내에 사용할 수 있도록 보관합니다. */
export class CgvApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'CgvApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * 날짜·시간·영화·상영관 조건으로 시간표를 가져와 API의 JSON 응답 전체를 반환합니다.
 * @param {Object} filters date(YYYY-MM-DD), from/to(HH:mm), movie, screen, groupBy(hour/movie/none).
 *   생략한 날짜는 서버의 한국 오늘을 사용하고, to는 해당 시각을 포함하지 않습니다.
 * @param {Object} options endpoint는 자체 배포 주소, signal은 요청 취소용 AbortSignal입니다.
 * @returns {Promise<Object>} showtimes, groups, total, fetchedAt 등을 포함한 응답.
 *   실패는 빈 목록으로 바꾸지 않고 CgvApiError 또는 네트워크 오류로 전달합니다.
 */
export async function getYongsanShowtimes(filters = {}, { endpoint = CGV_API_URL, signal } = {}) {
  const url = new URL(endpoint, globalThis.location?.href);
  const allowed = new Set(['date', 'from', 'to', 'movie', 'screen', 'groupBy']);
  for (const [key, value] of Object.entries(filters)) {
    if (!allowed.has(key)) throw new TypeError(`지원하지 않는 조회 조건: ${key}`);
    // 빈 검색 입력은 보내지 않아 서버 기본값을 사용합니다. 한글은 URLSearchParams가 인코딩합니다.
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { method: 'GET', signal, headers: { Accept: 'application/json' } });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new CgvApiError('시간표 서버에서 JSON 응답을 받지 못했습니다.', response.status, 'INVALID_RESPONSE');
  }
  if (!response.ok) {
    throw new CgvApiError(data?.error?.message || '시간표 조회에 실패했습니다.', response.status, data?.error?.code || 'HTTP_ERROR');
  }
  if (!Array.isArray(data?.showtimes)) {
    throw new CgvApiError('시간표 응답 형식이 올바르지 않습니다.', response.status, 'INVALID_RESPONSE');
  }
  return data;
}
