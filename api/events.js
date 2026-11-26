import { activityHandler } from "../lib/activity-api.mjs";

// GET /api/events?date=YYYY-MM-DD 요청을 서울 문화행사 조회로 연결한다.
export default activityHandler(true);
