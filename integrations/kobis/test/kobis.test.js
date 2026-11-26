// 실제 키 없이 조회 조건·서버 키 보호·KOBIS 오류와 웹 클라이언트의 연결을 검증합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeeklyQuery } from '../query.js';
import { getWeeklyBoxOffice } from '../client.js';
import handler from '../../../api/kobis-weekly.js';
const result = { boxofficeType: '주간 박스오피스', showRange: '20261109~20261115', yearWeekTime: '202646', weeklyBoxOfficeList: [{ rank: '1', movieCd: 'test', movieNm: '테스트 영화', audiCnt: '100' }] };

/** Vercel의 응답 API를 모사해 HTTP 상태와 JSON 본문을 확인할 수 있게 합니다. */
function responseRecorder() {
  return { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
}

/** 테스트마다 fetch와 서버 환경 변수를 복원해 다른 검증에 영향을 주지 않습니다. */
async function isolated(run) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KOBIS_API_KEY;
  try { await run(); }
  finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KOBIS_API_KEY;
    else process.env.KOBIS_API_KEY = originalKey;
  }
}

test('날짜 변환, 기본 주말, 지역·영화 필터와 최대 개수 전달', () => {
  const query = createWeeklyQuery({ targetDt: '2026-11-15', multiMovieYn: 'Y', repNationCd: 'K', wideAreaCd: '0105001' });
  assert.equal(query.get('targetDt'), '20261115');
  assert.equal(query.get('weekGb'), '1');
  assert.equal(query.get('itemPerPage'), '10');
  assert.equal(query.get('wideAreaCd'), '0105001');
  assert.equal(createWeeklyQuery({ targetDt: '20261115', weekGb: 0 }).get('weekGb'), '0');
});

test('잘못된 날짜·분류·키·중첩 입력을 원본 호출 전에 거부', () => {
  for (const options of [{}, { targetDt: '20260230' }, { targetDt: '20261115', key: '금지' }, { targetDt: '20261115', weekGb: 3 }, { targetDt: '20261115', itemPerPage: 11 }, { targetDt: '20261115', multiMovieYn: 'X' }, { targetDt: '20261115', repNationCd: 'X' }, { targetDt: '20261115', wideAreaCd: 'abc' }, { targetDt: ['20261115'] }]) {
    assert.throws(() => createWeeklyQuery(options), TypeError);
  }
});

test('서버 키가 없을 때와 중복 조건·다른 메서드 처리', async () => isolated(async () => {
  delete process.env.KOBIS_API_KEY;
  for (const [method, url, expected] of [['GET', '/api/kobis-weekly?targetDt=20261115', 503], ['GET', '/api/kobis-weekly?targetDt=20261115&targetDt=20261116', 400], ['POST', '/api/kobis-weekly', 405]]) {
    const res = responseRecorder();
    await handler({ method, url }, res);
    assert.equal(res.statusCode, expected);
  }
}));

test('서버가 HTTPS KOBIS 고정 주소에만 키를 전달하고 정상 JSON을 보존', async () => isolated(async () => {
  process.env.KOBIS_API_KEY = 'server-test-key';
  globalThis.fetch = async url => {
    assert.equal(url.origin, 'https://www.kobis.or.kr');
    assert.equal(url.searchParams.get('key'), 'server-test-key');
    assert.equal(url.searchParams.get('weekGb'), '0');
    return Response.json({ boxOfficeResult: result });
  };
  const res = responseRecorder();
  await handler({ method: 'GET', url: '/api/kobis-weekly?targetDt=20261115&weekGb=0' }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.boxOfficeResult, result);
  assert.equal(JSON.stringify(res.body).includes('server-test-key'), false);
}));

test('KOBIS faultInfo·HTML·잘못된 스키마·HTTP 오류·연결 실패는 정상 빈 목록이 아님', async () => isolated(async () => {
  process.env.KOBIS_API_KEY = 'server-test-key';
  for (const mock of [
    async () => Response.json({ faultInfo: { errorCode: '320010', message: 'server-test-key' } }),
    async () => new Response('<html>오류</html>'),
    async () => Response.json({ other: [] }),
    async () => new Response('', { status: 500 }),
    async () => { throw new Error('server-test-key'); }
  ]) {
    globalThis.fetch = mock;
    const res = responseRecorder();
    await handler({ method: 'GET', url: '/api/kobis-weekly?targetDt=20261115' }, res);
    assert.equal(res.statusCode, 502);
    assert.equal(JSON.stringify(res.body).includes('server-test-key'), false);
  }
}));

test('클라이언트는 키 없이 프록시 호출, 취소 신호 전달, 결과 객체 반환', async () => isolated(async () => {
  const controller = new AbortController();
  globalThis.fetch = async (url, options) => {
    assert.equal(url.pathname, '/api/kobis-weekly');
    assert.equal(url.searchParams.has('key'), false);
    assert.equal(options.signal, controller.signal);
    return Response.json({ boxOfficeResult: result });
  };
  assert.deepEqual(await getWeeklyBoxOffice({ targetDt: '20261115' }, { endpoint: 'https://example.com/api/kobis-weekly', signal: controller.signal }), result);
}));

test('클라이언트가 서버 오류, HTML 응답, 잘못된 성공 응답을 전달', async () => isolated(async () => {
  for (const [response, code] of [
    [Response.json({ error: { code: 'MISSING_API_KEY', message: '키 설정 필요' } }, { status: 503 }), 'MISSING_API_KEY'],
    [new Response('<html>오류</html>'), 'INVALID_RESPONSE'],
    [Response.json({ other: [] }), 'INVALID_RESPONSE']
  ]) {
    globalThis.fetch = async () => response;
    await assert.rejects(getWeeklyBoxOffice({ targetDt: '20261115' }, { endpoint: 'https://example.com/api/kobis-weekly' }), { code });
  }
}));

test('클라이언트와 서버를 연결했을 때 정상 빈 목록을 오류와 구분', async () => isolated(async () => {
  process.env.KOBIS_API_KEY = 'server-test-key';
  globalThis.fetch = async (url, options) => {
    if (url.hostname === 'www.kobis.or.kr') return Response.json({ boxOfficeResult: { ...result, weeklyBoxOfficeList: [] } });
    const res = responseRecorder();
    await handler({ method: 'GET', url: url.pathname + url.search }, res);
    return Response.json(res.body, { status: res.statusCode });
  };
  const data = await getWeeklyBoxOffice({ targetDt: '20261115' }, { endpoint: 'https://example.com/api/kobis-weekly' });
  assert.deepEqual(data.weeklyBoxOfficeList, []);
}));
