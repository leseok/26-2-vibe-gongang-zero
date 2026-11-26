// 브라우저 클라이언트가 필터·오류·요청 취소를 정확히 전달하는지 검증합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getYongsanShowtimes, CgvApiError } from '../client.js';

/** 네트워크 대신 지정 응답을 사용하고 테스트가 끝나면 원래 fetch를 복구합니다. */
async function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = original; }
}

test('한글 필터 인코딩·빈 입력 생략·요청 취소 신호 전달', async () => {
  const controller = new AbortController();
  await withFetch(async (url, options) => {
    assert.equal(url.searchParams.get('movie'), '영화 자막');
    assert.equal(url.searchParams.get('from'), '24:00');
    assert.equal(url.searchParams.has('date'), false);
    assert.equal(options.signal, controller.signal);
    return Response.json({ total: 0, showtimes: [] });
  }, async () => {
    const data = await getYongsanShowtimes({ movie: '영화 자막', from: '24:00', date: '' }, { signal: controller.signal });
    assert.deepEqual(data.showtimes, []);
  });
});

test('API 오류 코드와 HTTP 상태 보존', async () => {
  await withFetch(async () => Response.json({ error: { code: 'UPSTREAM_BLOCKED', message: 'CGV 차단' } }, { status: 503 }), async () => {
    await assert.rejects(getYongsanShowtimes(), { name: 'CgvApiError', status: 503, code: 'UPSTREAM_BLOCKED', message: 'CGV 차단' });
  });
});

test('HTML 차단 페이지와 잘못된 성공 응답을 정상 빈 결과로 숨기지 않음', async () => {
  for (const response of [new Response('<html>차단</html>', { status: 403 }), Response.json({ ok: true })]) {
    await withFetch(async () => response, async () => {
      await assert.rejects(getYongsanShowtimes(), error => error instanceof CgvApiError && error.code === 'INVALID_RESPONSE');
    });
  }
});

test('잘못된 필터는 요청 전에 거부하고 네트워크 오류는 호출자에게 전달', async () => {
  await assert.rejects(getYongsanShowtimes({ typo: 'x' }), TypeError);
  await withFetch(async () => { throw new TypeError('연결 실패'); }, async () => {
    await assert.rejects(getYongsanShowtimes(), { message: '연결 실패' });
  });
});
