import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import events from "./api/events.js";
import movies from "./api/movies.js";
import { fileURLToPath } from "node:url";

// 로컬에서는 .env.local을 먼저 읽는다. 예전 설치의 .env에서 빠진 값만 보완한다.
for (const envFile of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(envFile, import.meta.url)));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
// 브라우저에는 아래 공개 파일만 보낸다. 환경 설정과 서버 소스는 제공하지 않는다.
const staticFiles = new Map([
  ["index.html", "text/html; charset=utf-8"], ["style.css", "text/css; charset=utf-8"],
  ["script.js", "text/javascript; charset=utf-8"], ["data.js", "text/javascript; charset=utf-8"],
  ["assets/hero.webp", "image/webp"]
]);
// Vercel과 같은 API 함수를 로컬에서도 불러와 같은 방식으로 조회한다.
const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET") { res.writeHead(405, {Allow:"GET"}); res.end(); return; }
    const {pathname} = new URL(req.url, "http://localhost");
    if (pathname === "/api/events") return events(req, res);
    if (pathname === "/api/movies") return movies(req, res);
    const file = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!staticFiles.has(file)) { res.writeHead(404); res.end(); return; }
    const body = await readFile(new URL("./public/" + file, import.meta.url));
    res.writeHead(200, {"Content-Type":staticFiles.get(file),"X-Content-Type-Options":"nosniff"});
    res.end(body);
  } catch {
    res.writeHead(500); res.end();
  }
});
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () => console.log("공강제로 실행 중  http://" + host + ":" + server.address().port));
