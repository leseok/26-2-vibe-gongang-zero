/** 기존 Node/Vercel API를 Web Request/Response로 연결하는 Cloudflare 배포 진입점입니다. */
import events from '../api/events.js';
import movies from '../api/movies.js';
import weeklyBoxOffice from '../api/kobis-weekly.js';

const routes = new Map([
  ['/api/events', events],
  ['/api/movies', movies],
  ['/api/kobis-weekly', weeklyBoxOffice],
]);

/** Node 응답 객체의 필요한 메서드를 구현해 기존 API의 상태·헤더·본문을 보존합니다. */
export async function runApi(handler, request) {
  const headers = new Headers({ 'X-Content-Type-Options': 'nosniff' });
  let body = null;
  const response = {
    statusCode: 200,
    setHeader(name, value) { headers.set(name, String(value)); return this; },
    writeHead(status, values = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(values)) this.setHeader(name, value);
      return this;
    },
    status(status) { this.statusCode = status; return this; },
    json(data) {
      this.setHeader('Content-Type', 'application/json; charset=utf-8');
      this.end(JSON.stringify(data));
      return this;
    },
    end(value) { body = value ?? null; },
  };
  try {
    await handler({ method: request.method, url: request.url, headers: Object.fromEntries(request.headers) }, response);
    return new Response(body, { status: response.statusCode, headers });
  } catch {
    // 원본 오류에 인증키가 들어갈 수 있으므로 상세 내용을 외부로 전송하지 않습니다.
    return Response.json({ error: '요청을 처리하지 못했습니다.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

export default {
  /** API는 기존 처리기로, 공개 화면과 이미지·스크립트는 ASSETS 바인딩으로 전달합니다. */
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const handler = routes.get(pathname);
    if (handler) return runApi(handler, request);
    if (pathname.startsWith('/api/')) {
      return Response.json({ error: '존재하지 않는 API 경로입니다.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return env.ASSETS.fetch(request);
  },
};
