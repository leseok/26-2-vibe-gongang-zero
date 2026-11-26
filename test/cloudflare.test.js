// Node/Vercel API의 HTTP 동작이 Cloudflare에서 유지되는지 검증합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { runApi } from '../cloudflare/worker.js';

test('상태 코드·헤더·JSON과 요청 Origin을 보존', async () => {
  const response = await runApi((req, res) => {
    assert.equal(req.headers.origin, 'https://example.com');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: '입력 확인' });
  }, new Request('https://example.com/api/test', { headers: { Origin: 'https://example.com' } }));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: '입력 확인' });
});

test('Node writeHead/end 응답과 본문 없는 메서드 거부 보존', async () => {
  const response = await runApi((req, res) => {
    res.writeHead(405, { Allow: 'GET' });
    res.end();
  }, new Request('https://example.com/api/test', { method: 'POST' }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
  assert.equal(await response.text(), '');
});

test('공개 화면은 ASSETS로 전달하고 잘못된 API를 HTML로 숨기지 않음', async () => {
  const env = { ASSETS: { fetch: async () => new Response('정적 화면') } };
  assert.equal(await (await worker.fetch(new Request('https://example.com/'), env)).text(), '정적 화면');
  const missing = await worker.fetch(new Request('https://example.com/api/missing'), env);
  assert.equal(missing.status, 404);
  assert.ok(missing.headers.get('content-type').includes('json'));
});

test('실제 세 API의 입력 오류와 메서드 오류를 Worker 경로에서 전달', async () => {
  for (const path of ['/api/events', '/api/movies', '/api/kobis-weekly']) {
    const response = await worker.fetch(new Request('https://example.com' + path, { method: 'POST' }), {});
    assert.equal(response.status, 405);
  }
  const invalid = await worker.fetch(new Request('https://example.com/api/kobis-weekly?targetDt=20260230'), {});
  assert.equal(invalid.status, 400);
});

test('처리기 예외의 내부 메시지는 공개하지 않음', async () => {
  const response = await runApi(() => { throw Error('secret-test-value'); }, new Request('https://example.com/api/test'));
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes('secret-test-value'), false);
});
