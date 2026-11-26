import { simpleFee } from "./activity-api.mjs";
import { NEARBY_CODES, SEOUL_DISTRICTS } from "./tour-api.js";
import { plain, officialUrl, eventDates, scheduleFor, matchSchedule } from "./activity-schedule.js";

const CONTENT_TYPES = { 15: "문화행사", 14: "문화시설", 28: "레저시설" };
const DISTRICTS_BY_NAME = Object.fromEntries(
  Object.entries(SEOUL_DISTRICTS).map(([code, name]) => [name, code]),
);

// 상위 API에 동시에 요청하는 수를 제한하고 결과 배열 순서를 유지합니다.
async function parallelMap(items, concurrency, map) {
  const output = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await map(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

// 시군구 코드가 비어 있으면 주소의 서울 자치구 이름을 확인합니다.
function districtFor(row, requestedDistrict) {
  const regionCode = plain(row.lDongRegnCd ?? row.ldongregncd);
  if (regionCode && regionCode !== "11") return null;
  const address = plain(row.addr1);
  const districtName = /^(?:서울특별시|서울시|서울)\s+(\S+)/.exec(address)?.[1];
  const addressCode = DISTRICTS_BY_NAME[districtName];
  const code = plain(row.lDongSignguCd ?? row.ldongsingucd).replace(/^11(?=\d{3}$)/, "");
  const district = addressCode || (SEOUL_DISTRICTS[code] && code) || requestedDistrict;
  if (requestedDistrict && requestedDistrict !== district) return null;
  return SEOUL_DISTRICTS[district] || null;
}

// 상세 조회 전에 지역과 행사 날짜가 맞는 활동만 모읍니다.
function candidatesFrom(sources, date) {
  const candidates = new Map();
  for (const { items, districtCode, type } of sources) {
    for (const row of items) {
      const id = plain(row.contentid);
      const title = plain(row.title);
      const district = districtFor(row, districtCode);
      if (!/^\d+$/.test(id) || !title || !district || candidates.has(type + ":" + id)) continue;

      const dates = type === "15" ? eventDates(row) : null;
      if (type === "15" && (!dates || date < dates.start || date > dates.end)) continue;
      candidates.set(type + ":" + id, { row, id, title, district, type });
    }
  }
  return [...candidates.values()];
}

// 해당 날짜의 상세 일정으로 추천할 회차와 공식 안내를 구성합니다.
async function recommendationFor(client, candidate, query) {
  const { row, id, title, district, type } = candidate;
  const intro = await client.intro(id, type);
  const schedules = matchSchedule(scheduleFor(row, intro, type, query.date), query.start, query.end);
  if (schedules.length === 0) return [];

  let detailUrl = officialUrl(intro.eventhomepage, row.homepage);
  let address = [plain(row.addr1), plain(row.addr2)].filter(Boolean).join(" ");
  if (!detailUrl || !address) {
    const common = await client.common(id);
    detailUrl ||= officialUrl(common.homepage);
    address ||= [plain(common.addr1), plain(common.addr2)].filter(Boolean).join(" ");
  }
  if (!detailUrl) return [];
  const venue = type === "15" ? plain(intro.eventplace) || plain(row.eventplace) || address : title;
  if (!venue) return [];

  // 현재 카드의 무료·예산 필터가 제공처에서 확인한 요금을 계속 사용할 수 있게 합니다.
  const fee = plain(type === "15" ? intro.usetimefestival : type === "28" ? intro.usefeeleports : intro.usefee);
  const label = plain(row.festivaltype);
  const typeName = title + " " + label;
  const activityType = /전시|기획전|특별전|박람회|미술관|박물관/.test(typeName) ? "exhibit"
    : type === "15" && /공연|축제|페스티벌|음악회|콘서트|연극|뮤지컬|오페라|국악|클래식|무용/.test(typeName) ? "show" : "other";

  return schedules.map((schedule) => ({
    id,
    title,
    category: label || CONTENT_TYPES[type],
    activityType,
    fee,
    price: simpleFee(fee),
    image: officialUrl(row.firstimage, row.firstimage2),
    venue,
    district,
    address: address || null,
    date: query.date,
    detailUrl,
    schedule,
  }));
}

async function searchArea(client, query, scope) {
  const regions = scope === "nearby" ? NEARBY_CODES : [undefined];
  const jobs = regions.flatMap((districtCode) =>
    Object.keys(CONTENT_TYPES).map((type) => ({ districtCode, type }))
  );
  const sources = await parallelMap(jobs, 6, async ({ districtCode, type }) => ({
    ...await client.byRegion(query.date, districtCode, type), districtCode, type,
  }));
  const issues = new Set(sources.map(({ error }) => error).filter(Boolean));
  const candidates = candidatesFrom(sources, query.date);

  const matches = await parallelMap(candidates, 8, async (candidate) => {
    try {
      return await recommendationFor(client, candidate, query);
    } catch (error) {
      issues.add(error.code || "TOUR_API_FAILED");
      return [];
    }
  });

  const unique = new Map();
  for (const item of matches.flat()) {
    const { mode, startTime, endTime } = item.schedule;
    unique.set([item.id, mode, startTime, endTime].join(":"), item);
  }
  const items = [...unique.values()].sort((left, right) =>
    left.schedule.availableStartTime.localeCompare(right.schedule.availableStartTime) ||
    left.title.localeCompare(right.title, "ko-KR") ||
    left.schedule.availableEndTime.localeCompare(right.schedule.availableEndTime)
  );
  return { items, issues: [...issues] };
}

// 정상 0건일 때만 서울 전체로 넓히며, 일부 실패는 결과 없음으로 간주하지 않습니다.
async function recommend(client, query) {
  let scope = query.scope === "seoul" ? "seoul" : "nearby";
  let result = await searchArea(client, query, scope);
  let expanded = false;

  if (query.scope === "auto" && result.items.length === 0 && result.issues.length === 0) {
    scope = "seoul";
    expanded = true;
    result = await searchArea(client, query, scope);
  }

  const incomplete = result.issues.length > 0;
  const status = result.items.length > 0 ? (incomplete ? "partial" : "ok") : (incomplete ? "error" : "empty");
  const areaName = scope === "nearby" ? "주변" : "서울 전체";
  const messages = {
    ok: "",
    empty: areaName + "에서 이 시간에 맞는 활동을 찾지 못했어요.",
    partial: "일부 활동 정보를 불러오지 못했어요.",
    error: areaName + " 활동 정보를 모두 확인하지 못했어요.",
  };

  return {
    status, scope, expanded, date: query.date, startTime: query.startTime, endTime: query.endTime,
    districts: scope === "nearby" ? NEARBY_CODES.map((code) => SEOUL_DISTRICTS[code]) : [],
    items: result.items,
    message: messages[status],
    canExpand: scope === "nearby" && status === "empty",
    retryScope: incomplete ? (scope === "seoul" ? "seoul" : query.scope) : null,
    issues: result.issues,
  };
}

export { recommend };
