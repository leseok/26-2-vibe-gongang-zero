/** Vercel Node.js 함수: 서버 환경 변수의 키로 KOBIS를 조회하고 브라우저에 JSON만 반환합니다. */
import { createWeeklyQuery } from '../integrations/kobis/query.js';
const SOURCE = 'https://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json';

/** 요청과 응답 객체를 받아 조건을 검증하고 KOBIS의 원본 boxOfficeResult를 전달합니다. */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'GET만 지원합니다.' } });
  }
  let query;
  try {
    const params = new URL(req.url, 'http://localhost').searchParams;
    for (const key of new Set(params.keys())) {
      if (params.getAll(key).length > 1) throw new TypeError(`중복 파라미터: ${key}`);
    }
    query = createWeeklyQuery(Object.fromEntries(params));
  } catch (error) {
    return res.status(400).json({ error: { code: 'INVALID_QUERY', message: error.message } });
  }
  const key = process.env.KOBIS_API_KEY;
  if (!key) return res.status(503).json({ error: { code: 'MISSING_API_KEY', message: '서버에 KOBIS_API_KEY를 설정하세요.' } });
  // 요청자가 보낸 주소나 키를 사용하지 않아 임의 프록시 호출과 키 노출을 막습니다.
  query.set('key', key);
  const url = new URL(SOURCE);
  url.search = query;
  try {
    const upstream = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!upstream.ok) return res.status(502).json({ error: { code: 'UPSTREAM_HTTP_ERROR', message: 'KOBIS 서버 요청에 실패했습니다.' } });
    const data = await upstream.json();
    // KOBIS는 잘못된 발급 키 등도 HTTP 200 faultInfo로 반환하므로 별도로 확인합니다.
    if (data?.faultInfo) {
      return res.status(502).json({ error: { code: 'KOBIS_ERROR', upstreamCode: String(data.faultInfo.errorCode || ''), message: 'KOBIS에서 요청을 거부했습니다. 서버의 발급 키와 조회 조건을 확인하세요.' } });
    }
    if (!data?.boxOfficeResult || !Array.isArray(data.boxOfficeResult.weeklyBoxOfficeList)) {
      return res.status(502).json({ error: { code: 'INVALID_RESPONSE', message: 'KOBIS 응답 형식이 올바르지 않습니다.' } });
    }
    return res.status(200).json({ boxOfficeResult: data.boxOfficeResult });
  } catch {
    // 원본 URL이나 예외 메시지에는 키가 포함될 수 있으므로 로그·응답으로 노출하지 않습니다.
    return res.status(502).json({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'KOBIS에 연결하거나 응답을 해석하지 못했습니다.' } });
  }
}
