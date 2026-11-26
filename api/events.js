import { activityHandler } from "../lib/activity-api.mjs";
import { createTourApi } from "../lib/tour-api.js";
import { calendarDate, todayInKorea, minutesOf } from "../lib/activity-schedule.js";
import { recommend } from "../lib/recommendations.js";

// date는 앱을 연 날의 한국 날짜여야 하며, 생략하면 서버에서 같은 기준으로 계산합니다.
function readQuery(requestUrl, now) {
  const params = new URL(requestUrl, "http://localhost").searchParams;
  for (const name of ["date", "startTime", "endTime", "scope"]) {
    if (params.getAll(name).length > 1) throw new Error(name + "은 하나만 입력해주세요.");
  }

  const today = todayInKorea(now);
  const date = params.get("date") ?? today;
  if (!calendarDate(date) || date !== today) {
    throw new Error("date는 오늘의 한국시간 날짜를 YYYY-MM-DD 형식으로 입력해주세요.");
  }

  const startTime = params.get("startTime");
  const endTime = params.get("endTime");
  const start = minutesOf(startTime);
  const end = minutesOf(endTime);
  const timeFormat = /^\d{2}:\d{2}$/;
  if (!timeFormat.test(startTime || "") || !timeFormat.test(endTime || "") ||
      start === null || end === null || start >= end) {
    throw new Error("시작·종료 시각을 HH:mm으로 입력하고 종료 시각은 시작보다 늦게 설정해주세요.");
  }

  const scope = params.get("scope") ?? "auto";
  if (!["auto", "nearby", "seoul"].includes(scope)) {
    throw new Error("scope는 auto, nearby, seoul 중 하나여야 해요.");
  }
  return { date, startTime, endTime, start, end, scope };
}

// Vercel과 로컬 Node 서버가 동일한 응답 경로를 사용합니다.
function writeJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function errorStatus(issues) {
  if (issues.includes("TOUR_API_KEY_MISSING") || issues.includes("TOUR_API_KEY_INVALID") ||
      issues.includes("TOUR_API_LIMIT")) return 503;
  if (issues.includes("TOUR_API_TIMEOUT")) return 504;
  return 502;
}

// 프론트에서 읽을 검색 상태와 카드를 반환하며, 인증키와 원본 오류 본문은 공개하지 않습니다.
export function makeHandler({ client, now = () => new Date(), frontendOrigin } = {}) {
  return async function eventsHandler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (frontendOrigin && req.headers.origin === frontendOrigin) {
      res.setHeader("Access-Control-Allow-Origin", frontendOrigin);
      res.setHeader("Vary", "Origin");
    }

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return writeJson(res, 405, { status: "error", message: "GET 요청만 사용할 수 있어요." });
    }

    let query;
    try {
      query = readQuery(req.url || "/api/events", now());
    } catch (error) {
      return writeJson(res, 400, { status: "error", code: "INVALID_QUERY", message: error.message });
    }

    try {
      const result = await recommend(client, query);
      const httpStatus = result.status === "error" ? errorStatus(result.issues) : 200;
      if (result.issues.includes("TOUR_API_KEY_MISSING")) {
        result.message = "서버 환경 변수 TOUR_API_KEY를 설정해주세요.";
      }
      return writeJson(res, httpStatus, result);
    } catch {
      return writeJson(res, 500, { status: "error", message: "검색을 처리하지 못했어요." });
    }
  };
}

const existingEvents = activityHandler(true);
let recommendations;

// 날짜만 보내는 기존 화면은 행사 목록을 사용하고, 공강 조건을 보내면 추천을 실행합니다.
export default function events(req, res) {
  const { searchParams } = new URL(req.url, "http://localhost");
  if (!["startTime", "endTime", "scope"].some((name) => searchParams.has(name))) {
    return existingEvents(req, res);
  }

  // 로컬 서버가 환경 파일을 불러온 뒤 첫 요청에서 클라이언트를 만듭니다.
  recommendations ??= makeHandler({
    client: createTourApi({ key: process.env.TOUR_API_KEY }),
    frontendOrigin: process.env.FRONTEND_ORIGIN,
  });
  return recommendations(req, res);
}
