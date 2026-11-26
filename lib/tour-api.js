const TOUR_API_URL = "https://apis.data.go.kr/B551011/KorService2/";
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

// TourAPI는 시도 코드 11과 법정동 시군구 코드의 가운데 세 자리를 받습니다.
const SEOUL_DISTRICTS = {
  110: "종로구", 140: "중구", 170: "용산구", 200: "성동구", 215: "광진구",
  230: "동대문구", 260: "중랑구", 290: "성북구", 305: "강북구", 320: "도봉구",
  350: "노원구", 380: "은평구", 410: "서대문구", 440: "마포구", 470: "양천구",
  500: "강서구", 530: "구로구", 545: "금천구", 560: "영등포구", 590: "동작구",
  620: "관악구", 650: "서초구", 680: "강남구", 710: "송파구", 740: "강동구",
};

const NEARBY_CODES = ["590", "620", "650", "560", "170", "680"];

class TourApiError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// 공공데이터포털의 Decoding 키와 Encoding 키를 모두 URLSearchParams에 한 번만 인코딩합니다.
function decodeKey(value) {
  const key = value?.trim();
  if (!key) throw new TourApiError("TOUR_API_KEY_MISSING");
  try {
    return decodeURIComponent(key);
  } catch {
    throw new TourApiError("TOUR_API_KEY_INVALID");
  }
}

// 날짜 표기에 필요한 하이픈은 외부 API 호출 시에만 제거합니다.
function festivalStartDate(date) {
  const start = new Date(date + "T00:00:00Z");
  start.setUTCDate(start.getUTCDate() - 365);
  return start.toISOString().slice(0, 10).replaceAll("-", "");
}

// 조회 중인 동일한 요청을 합치고 성공한 페이지를 잠시 재사용합니다.
function createTourApi({ key, fetchImpl = globalThis.fetch } = {}) {
  const cache = new Map();

  async function request(operation, params) {
    const query = new URLSearchParams({
      MobileOS: "WEB",
      MobileApp: "GongangZero",
      _type: "json",
      ...params,
    });
    const cacheKey = operation + "?" + query;

    async function fetchPage() {
      const url = new URL(operation, TOUR_API_URL);
      url.search = query;
      url.searchParams.set("serviceKey", decodeKey(key));
      try {
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(8_000),
          redirect: "error",
        });
        if (response.status === 429) throw new TourApiError("TOUR_API_LIMIT");
        if (response.status === 401 || response.status === 403) {
          throw new TourApiError("TOUR_API_AUTH");
        }
        if (!response.ok) throw new TourApiError("TOUR_API_FAILED");
        const data = await response.text();
        // API 게이트웨이는 JSON을 요청해도 인증·한도 오류를 XML로 응답할 수 있습니다.
        if (/^\s*</.test(data)) {
          if (/SERVICE_KEY|AUTHENTICATION|ACCESS_DENIED/i.test(data)) {
            throw new TourApiError("TOUR_API_AUTH");
          }
          if (/LIMITED_NUMBER|REQUEST_LIMIT/i.test(data)) throw new TourApiError("TOUR_API_LIMIT");
          throw new TourApiError("TOUR_API_FAILED");
        }
        const envelope = JSON.parse(data)?.response;
        const code = String(envelope?.header?.resultCode ?? "");
        if (code === "03" || code === "0003") return { items: [], total: 0 };
        if (!["00", "0000"].includes(code)) throw new TourApiError("TOUR_API_FAILED");

        const body = envelope.body;
        const total = Number(body?.totalCount ?? NaN);
        if (!Number.isSafeInteger(total) || total < 0) throw new TourApiError("TOUR_API_FAILED");
        if (total === 0) return { items: [], total };
        const value = body.items?.item;
        const items = Array.isArray(value) ? value : value ? [value] : [];
        if (items.length === 0 || items.some((item) => !item || typeof item !== "object")) {
          throw new TourApiError("TOUR_API_FAILED");
        }
        if (params.pageNo && String(body.pageNo) !== String(params.pageNo)) {
          throw new TourApiError("TOUR_API_FAILED");
        }
        return { items, total };
      } catch (error) {
        if (error instanceof TourApiError) throw error;
        if (error.name === "TimeoutError" || error.name === "AbortError") {
          throw new TourApiError("TOUR_API_TIMEOUT");
        }
        throw new TourApiError("TOUR_API_FAILED");
      }
    }

    const existing = cache.get(cacheKey);
    if (existing && existing.expires > Date.now()) return existing.promise;
    if (cache.size >= 4_000) cache.delete(cache.keys().next().value);
    const entry = { expires: Infinity, promise: fetchPage() };
    cache.set(cacheKey, entry);
    try {
      const page = await entry.promise;
      const detail = operation.startsWith("detail");
      entry.expires = Date.now() + (detail ? 30 * 60_000 : 5 * 60_000);
      return page;
    } catch (error) {
      if (cache.get(cacheKey) === entry) cache.delete(cacheKey);
      throw error;
    }
  }

  // 앞 페이지가 성공했으면 뒷 페이지에서 오류가 나도 확보한 레코드를 반환합니다.
  async function list(operation, params) {
    const items = [];
    let total;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      try {
        const result = await request(operation, { ...params, numOfRows: PAGE_SIZE, pageNo: page });
        total ??= result.total;
        if (result.total !== total || (total > 0 && result.items.length === 0)) {
          return { items, error: "TOUR_API_INCOMPLETE" };
        }
        items.push(...result.items);
        if (items.length >= total) return { items };
      } catch (error) {
        return { items, error: error.code || "TOUR_API_FAILED" };
      }
    }
    return { items, error: "TOUR_API_INCOMPLETE" };
  }

  // 자치구 코드 생략 시 서울 전체를 조회하며, 기존 sigunguCode 필드는 쓰지 않습니다.
  function byRegion(date, districtCode, contentTypeId) {
    const region = { lDongRegnCd: "11" };
    if (districtCode) region.lDongSignguCd = districtCode;
    if (contentTypeId === "15") {
      // 최소 시작일 이후의 일정을 받고 실제 검색일 포함 여부는 반환된 기간으로 판단합니다.
      return list("searchFestival2", { ...region, eventStartDate: festivalStartDate(date) });
    }
    return list("areaBasedList2", { ...region, contentTypeId });
  }

  // 소개 정보는 시각과 휴관, 공통 정보는 공식 홈페이지와 주소를 보완합니다.
  async function intro(contentId, contentTypeId) {
    const { items } = await request("detailIntro2", { contentId, contentTypeId });
    return items[0] || {};
  }

  async function common(contentId) {
    const { items } = await request("detailCommon2", { contentId });
    return items[0] || {};
  }

  return { byRegion, intro, common };
}

module.exports = { createTourApi, NEARBY_CODES, SEOUL_DISTRICTS };
