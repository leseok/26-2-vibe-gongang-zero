const assert = require("node:assert/strict");
const { test } = require("node:test");
const { makeHandler } = require("../api/events");
const { createTourApi } = require("../lib/tour-api");
const { recommend } = require("../lib/recommendations");
const { matchSchedule, scheduleFor } = require("../lib/activity-schedule");

const DATE = "2026-11-26";
const QUERY = { date: DATE, start: 720, end: 840, startTime: "12:00", endTime: "14:00", scope: "auto" };
const NEARBY = ["590", "620", "650", "560", "170", "680"];

// 실제 TourAPI 봉투 형식을 흉내 내며, 요청에 들어간 지역 코드와 페이지를 저장합니다.
function mockTourApi(route) {
  const calls = [];
  const client = createTourApi({
    key: "example%2Bkey",
    fetchImpl: async (url) => {
      const operation = url.pathname.split("/").at(-1);
      const params = Object.fromEntries(url.searchParams);
      calls.push({ operation, ...params });
      assert.equal(params.serviceKey, "example+key");
      assert.equal(params.sigunguCode, undefined);
      const result = route(operation, params) ?? [];
      if (result instanceof Response) return result;
      const items = Array.isArray(result) ? result : result.items;
      const totalCount = Array.isArray(result) ? items.length : result.totalCount;
      return Response.json({
        response: {
          header: { resultCode: "0000" },
          body: { items: { item: items }, totalCount, pageNo: Number(params.pageNo || 1) },
        },
      });
    },
  });
  return { client, calls };
}

function festival(id, district = "590", endDate = "20261127") {
  return {
    contentid: id,
    lDongRegnCd: "11",
    lDongSignguCd: district,
    eventstartdate: "20261125",
    eventenddate: endDate,
    title: "공연 " + id,
    addr1: "서울시 " + (district === "110" ? "종로구" : "동작구") + " 문화로",
  };
}

test("자치구 여섯 곳을 조회하고 공강 안에 들어오는 다일 행사 회차만 남긴다", async () => {
  const { client, calls } = mockTourApi((operation, params) => {
    if (operation === "searchFestival2" && params.lDongSignguCd === "590") {
      if (params.pageNo === "1") return { items: [festival("1"), festival("2")], totalCount: 4 };
      return { items: [festival("1"), festival("3", "110")], totalCount: 4 };
    }
    if (operation === "detailIntro2") {
      return [{
        eventplace: "공식 행사 장소",
        eventhomepage: '<a href="https://events.example/activity?id=1&amp;from=tour">행사 안내</a>',
        playtime: params.contentId === "1" ? "11.26.(목) 12:00~14:00" : "매일 13:00~14:30",
      }];
    }
  });

  const result = await recommend(client, QUERY);
  assert.equal(result.status, "ok");
  assert.equal(result.expanded, false);
  assert.deepEqual(result.items.map(({ id }) => id), ["1"]);
  assert.deepEqual(result.items[0].schedule, {
    mode: "fixed",
    startTime: "12:00", endTime: "14:00", availableStartTime: "12:00", availableEndTime: "14:00",
  });
  assert.equal(result.items[0].detailUrl, "https://events.example/activity?id=1&from=tour");

  const festivalCalls = calls.filter(({ operation }) => operation === "searchFestival2");
  assert.deepEqual(new Set(festivalCalls.map(({ lDongSignguCd }) => lDongSignguCd)), new Set(NEARBY));
  assert.ok(festivalCalls.every(({ lDongRegnCd, eventStartDate }) =>
    lDongRegnCd === "11" && eventStartDate < "20261125"));
  assert.equal(calls.filter(({ operation }) => operation === "areaBasedList2").length, 12);
  assert.ok(festivalCalls.some(({ pageNo }) => pageNo === "2"));
});

test("정상 0건이면 서울 전역을 검색하며 단계별 검색도 지원한다", async () => {
  const { client, calls } = mockTourApi((operation, params) => {
    if (operation === "searchFestival2" && !params.lDongSignguCd) return [festival("7", "110")];
    if (operation === "detailIntro2") {
      return [{ eventplace: "서울 공연장", playtime: "매일 13:00~14:00" }];
    }
    if (operation === "detailCommon2") return [{ homepage: "https://events.example/activity/7" }];
  });

  const nearby = await recommend(client, { ...QUERY, scope: "nearby" });
  assert.equal(nearby.status, "empty");
  assert.equal(nearby.canExpand, true);
  assert.ok(calls.every(({ lDongSignguCd }) => lDongSignguCd));

  const auto = await recommend(client, QUERY);
  assert.equal(auto.scope, "seoul");
  assert.equal(auto.expanded, true);
  assert.equal(auto.items[0].district, "종로구");
  assert.equal(auto.items[0].date, DATE);
  assert.equal(auto.items[0].detailUrl, "https://events.example/activity/7");
  assert.ok(calls.filter(({ operation }) => operation === "searchFestival2")
    .some(({ lDongRegnCd, lDongSignguCd }) => lDongRegnCd === "11" && !lDongSignguCd));

  const empty = mockTourApi(() => []);
  const emptyResult = await recommend(empty.client, QUERY);
  assert.equal(emptyResult.scope, "seoul");
  assert.equal(emptyResult.status, "empty");
});

test("일부 페이지 실패는 빈 검색과 구분하고 확보한 결과를 유지한다", async () => {
  const failure = () => new Response("<response>UPSTREAM_ERROR</response>", { status: 502 });
  const { client, calls } = mockTourApi((operation, params) => {
    if (operation === "searchFestival2" && params.lDongSignguCd === "590") {
      return params.pageNo === "1" ? { items: [festival("1")], totalCount: 2 } : failure();
    }
    if (operation === "detailIntro2") {
      return [{ eventplace: "문화관", eventhomepage: "https://events.example/", playtime: "매일 13:00~14:00" }];
    }
  });
  const partial = await recommend(client, QUERY);
  assert.equal(partial.status, "partial");
  assert.equal(partial.items.length, 1);
  assert.equal(partial.retryScope, "auto");
  assert.ok(calls.filter(({ operation }) => operation === "searchFestival2")
    .every(({ lDongSignguCd }) => lDongSignguCd));

  const errorsOnly = mockTourApi(failure);
  const error = await recommend(errorsOnly.client, QUERY);
  assert.equal(error.status, "error");
  assert.equal(error.scope, "nearby");
  assert.equal(error.expanded, false);
});

test("휴게시간과 마지막 입장 시각을 적용하고 휴관·시간 미확인은 제외한다", () => {
  const facility = {
    usetimeculture: "09:00~17:00<br>휴게시간 12:30~13:15<br>마지막 입장 13:20",
    restdateculture: "매주 월요일 휴관",
  };
  const slots = scheduleFor({}, facility, "14", DATE);
  assert.deepEqual(matchSchedule(slots, 720, 840).map(({ availableStartTime, availableEndTime }) =>
    [availableStartTime, availableEndTime]), [["12:00", "12:30"], ["13:15", "14:00"]]);
  assert.deepEqual(matchSchedule(slots, 801, 840), []);
  assert.deepEqual(scheduleFor({}, facility, "14", "2026-11-23"), []);
  assert.deepEqual(scheduleFor({}, { ...facility, restdateculture: "" }, "14", DATE), []);
  assert.deepEqual(scheduleFor({}, { ...facility, usetimeculture: "09:00~17:00 (수요일 제외)" }, "14", DATE), []);
  assert.deepEqual(scheduleFor(festival("3"), { playtime: "12:00~13:00" }, "15", DATE), []);
});

test("공식 안내 링크를 확인하기 어려운 시설은 추천에 포함하지 않는다", async () => {
  const { client } = mockTourApi((operation, params) => {
    if (operation === "areaBasedList2" && params.contentTypeId === "14" && params.lDongSignguCd === "620") {
      return [
        { contentid: "41", title: "문화시설", addr1: "서울시 관악구" },
        { contentid: "42", title: "링크 없는 시설", addr1: "서울시 관악구" },
      ];
    }
    if (operation === "detailIntro2") return [{ usetimeculture: "13:00~15:00", restdateculture: "연중무휴" }];
    if (operation === "detailCommon2" && params.contentId === "41") return [{ homepage: "https://venue.example/41" }];
  });
  const result = await recommend(client, QUERY);
  assert.deepEqual(result.items.map(({ id }) => id), ["41"]);
  assert.equal(result.items[0].schedule.availableEndTime, "14:00");
});

// 소켓 없이 Vercel 핸들러의 HTTP 상태와 본문을 확인합니다.
async function invoke(handler, url, method = "GET") {
  const res = {
    statusCode: 200,
    setHeader() {},
    end(body) { this.body = JSON.parse(body); },
  };
  await handler({ url, method, headers: {} }, res);
  return res;
}

test("한국 날짜 자정, 공강 입력 오류, 누락된 인증키를 HTTP 응답으로 구분한다", async () => {
  const now = () => new Date("2026-11-25T15:10:00Z");
  const { client } = mockTourApi(() => []);
  const handler = makeHandler({ client, now });
  const response = await invoke(handler, "/api/events?startTime=12:00&endTime=14:00");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.date, DATE);
  assert.equal(response.body.status, "empty");
  for (const url of [
    "/api/events?date=2026-11-25&startTime=12:00&endTime=14:00",
    "/api/events?startTime=12:00&endTime=12:00",
    "/api/events?startTime=2:00&endTime=14:00",
    "/api/events?startTime=12:00&endTime=24:00",
  ]) {
    assert.equal((await invoke(handler, url)).statusCode, 400);
  }
  assert.equal((await invoke(handler, "/api/events", "POST")).statusCode, 405);

  const noKeyHandler = makeHandler({ client: createTourApi(), now });
  const noKey = await invoke(noKeyHandler, "/api/events?startTime=12:00&endTime=14:00");
  assert.equal(noKey.statusCode, 503);
  assert.deepEqual(noKey.body.issues, ["TOUR_API_KEY_MISSING"]);
});
