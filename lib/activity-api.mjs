// 같은 날짜의 목록이나 같은 활동의 상세 정보를 잠시 보관해 중복 호출을 줄인다.
const cache = new Map();
async function cached(id, ttl, loader) {
  const previous = cache.get(id);
  if (previous && previous.until > Date.now()) return previous.promise;
  if (cache.size >= 256) cache.delete(cache.keys().next().value);
  const promise = loader();
  cache.set(id, {promise, until: Date.now() + ttl});
  try { return await promise; }
  catch (error) {
    if (cache.get(id)?.promise === promise) cache.delete(id);
    throw error;
  }
}
const hour = 3600000;
const clean = value => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
function webUrl(value) {
  try {
    const url = new URL(String(value));
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}
// 외부 API 요청 한 건에 제한 시간을 적용하고, 여러 요청의 공통 마감 시간도 지킨다.
async function getJSON(url, deadline) {
  const timeout = AbortSignal.timeout(8500);
  const signal = deadline ? AbortSignal.any([timeout, deadline]) : timeout;
  const response = await fetch(url, {signal, redirect: "error"});
  if (!response.ok) throw new Error("upstream");
  return response.json();
}
// 무료 표시와 숫자로 확인되는 단일 요금만 필터에 쓸 수 있는 값으로 변환한다.
function simpleFee(fee) {
  if (/^(무료(?:\s*(?:입장|관람))?|0\s*원)$/.test(fee)) return 0;
  const found = /^(?:전석\s*|입장료\s*)?(\d[\d,]*)\s*원?$/.exec(fee);
  return found ? Number(found[1].replaceAll(",", "")) : null;
}
function isoDate(value) {
  return String(value ?? "").replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
}
// TourAPI 목록(row)과 소개 정보(intro)를 결합해 화면에서 사용하는 활동으로 변환한다.
function asEvent(row, intro) {
  const title = clean(row.title);
  const label = clean(row.festivaltype) || (/팝업/.test(title) ? "팝업" : "");
  const fixed = /콘서트|연극|뮤지컬|오페라|국악|클래식|무용|독주|독창|공연/.test(title + " " + label);
  const type = /전시|기획전|특별전|박람회/.test(title + " " + label) ? "exhibit"
    : fixed || /축제|페스티벌|음악회/.test(title + " " + label) ? "show" : "other";
  const address = [clean(row.addr1), clean(row.addr2)].filter(Boolean).join(" ");
  const place = clean(intro.eventplace) || address;
  const moods = type === "exhibit" ? ["혼자 조용히"] : type === "show" ? ["친구와 함께"] : ["새로운 경험"];
  if (/산책|공원|정원|걷기/.test(title + place)) moods.push("가볍게 산책");
  const duration = /^(?:(\d+)\s*시간)?\s*(?:(\d+)\s*분)?$/.exec(clean(intro.spendtimefestival));
  const minutes = duration ? (Number(duration[1] || 0) * 60 + Number(duration[2] || 0)) || null : null;
  const fee = clean(intro.usetimefestival);
  const homepage = String(intro.eventhomepage ?? "");
  const link = /\bhref\s*=\s*["']([^"']+)["']/i.exec(homepage)?.[1] || homepage;
  return {
    id: "tour-" + row.contentid,
    source: "한국관광공사", title, type, category: label, moods,
    hours: clean(intro.playtime), minutes,
    startDate: isoDate(row.eventstartdate), endDate: isoDate(row.eventenddate),
    fixed: type === "show" && fixed,
    place, address, district: /^서울(?:특별시|시)?\s+([가-힣]+구)(?:\s|$)/.exec(address)?.[1] || "",
    fee, price: simpleFee(fee),
    image: webUrl(row.firstimage) || webUrl(row.firstimage2), link: webUrl(link.replaceAll("&amp;", "&")),
    note: clean(intro.program)
  };
}
// TourAPI의 공통 응답을 목록과 전체 건수로 변환한다. 인증키는 이 서버에서만 쿼리에 넣는다.
async function tourPage(operation, params, key, deadline) {
  const url = new URL("https://apis.data.go.kr/B551011/KorService2/" + operation);
  url.search = new URLSearchParams({
    serviceKey: key, MobileOS: "WEB", MobileApp: "GonggangZero", _type: "json", ...params
  });
  const {response} = await getJSON(url, deadline);
  if (String(response?.header?.resultCode) !== "0000" || !response.body) throw new Error("tour-api");
  const body = response.body;
  const total = Number(body.totalCount);
  const items = body.items?.item;
  if (!Number.isInteger(total) || total < 0 || (total > 0 && !items)) throw new Error("tour-api");
  return {items: Array.isArray(items) ? items : items ? [items] : [], total};
}
function decodeTourKey(key) {
  // 공공데이터포털의 Decoding 키와 Encoding 키 모두 쿼리에서 한 번만 인코딩한다.
  try { return decodeURIComponent(key); }
  catch { return key; }
}
async function tourEvents(date, rawKey) {
  const key = decodeTourKey(rawKey);
  const day = date.replaceAll("-", "");
  // 조회일보다 먼저 시작해 당일에도 열리는 장기 행사를 함께 가져온다.
  const since = new Date(Date.parse(date + "T00:00:00Z") - 365 * 24 * hour).toISOString().slice(0,10).replaceAll("-", "");
  const matched = new Map();
  const listDeadline = AbortSignal.timeout(30000);
  let received = 0;
  for (let pageNo = 1; ; pageNo++) {
    const {items, total} = await tourPage("searchFestival2", {
      lDongRegnCd: "11", eventStartDate: since, numOfRows: "100", pageNo: String(pageNo)
    }, key, listDeadline);
    for (const row of items) {
      if (!row.contentid || !clean(row.title)) continue;
      const start = String(row.eventstartdate ?? ""), end = String(row.eventenddate ?? "");
      if (/^\d{8}$/.test(start) && /^\d{8}$/.test(end) && start <= day && day <= end) {
        matched.set(row.contentid, row);
      }
    }
    received += items.length;
    if (!items.length || received >= total) break;
  }
  const rows = [...matched.values()];
  const detailsDeadline = AbortSignal.timeout(18000);
  const events = [];
  for (let i = 0; i < rows.length; i += 6) {
    const batch = await Promise.all(rows.slice(i, i + 6).map(async row => {
      let intro = {};
      if (!detailsDeadline.aborted) {
        try {
          intro = await cached("tour-intro-" + row.contentid, 6 * hour, async () => {
            const {items} = await tourPage("detailIntro2", {contentId: row.contentid, contentTypeId: "15"}, key, detailsDeadline);
            return items[0] || {};
          });
        } catch { /* 상세 조회 실패 시 기본 정보로 표시한다. */ }
      }
      return asEvent(row, intro);
    }));
    events.push(...batch);
  }
  return events;
}
async function kobis(service, params, key) {
  const url = new URL("https://www.kobis.or.kr/kobisopenapi/webservice/rest/" + service + ".json");
  url.search = new URLSearchParams({...params, key});
  const data = await getJSON(url);
  if (data.faultInfo) throw new Error("kobis");
  return data;
}
function yesterday(days) {
  return new Date(Date.now() + 9 * hour - days * 24 * hour).toISOString().slice(0,10);
}
// 한국 시간 기준 가장 최근 박스오피스에 장르와 러닝타임을 덧붙인다.
async function boxOffice(key) {
  for (const days of [1, 2]) {
    const rankDate = yesterday(days);
    const data = await kobis("boxoffice/searchDailyBoxOfficeList", {targetDt: rankDate.replaceAll("-","")}, key);
    const rows = data.boxOfficeResult?.dailyBoxOfficeList;
    if (!Array.isArray(rows)) throw new Error("upstream");
    if (!rows.length) continue;
    const items = [];
    for (let i = 0; i < rows.length; i += 4) {
      const group = await Promise.all(rows.slice(i, i+4).map(async row => {
        let info = {};
        try {
          info = await cached("film-" + row.movieCd, 24 * hour, async () => {
            const result = await kobis("movie/searchMovieInfo", {movieCd: row.movieCd}, key);
            return result.movieInfoResult?.movieInfo || {};
          });
        } catch { /* 상세 조회가 늦어져도 순위와 영화명은 제공한다. */ }
        return {id: "kobis-" + row.movieCd, type: "movie", source: "KOBIS", title: clean(row.movieNm),
          rank: Number(row.rank), rankDate, price: null, minutes: Number(info.showTm) || null,
          genre: (info.genres || []).map(g => clean(g.genreNm)).join("·"), openDate: clean(row.openDt),
          moods: ["친구와 함께", "혼자 조용히"]};
      }));
      items.push(...group);
    }
    return items;
  }
  return [];
}
function sendJSON(res, code, data) {
  res.writeHead(code, {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  res.end(JSON.stringify(data));
}
// events가 true면 문화행사, false면 영화를 조회하는 Node.js 요청 처리기를 반환한다.
export function activityHandler(events) {
  return async (req, res) => {
    if (req.method !== "GET") { res.writeHead(405, {Allow:"GET"}); res.end(); return; }
    try {
      const {searchParams} = new URL(req.url, "http://localhost");
      const date = searchParams.get("date") || "";
      if (events && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date + "T00:00:00Z").toJSON()?.slice(0,10) !== date)) {
        sendJSON(res, 400, {error:"날짜를 다시 선택해 주세요."}); return;
      }
      const key = (events ? process.env.TOUR_API_KEY : process.env.KOBIS_API_KEY)?.trim();
      if (!key) { sendJSON(res, 200, {mode:"unconfigured", items:[]}); return; }
      const items = events ? await cached("events-" + date, hour, () => tourEvents(date, key))
        : await cached("movies-" + yesterday(1), hour, () => boxOffice(key));
      sendJSON(res, 200, {mode:"live", items});
    } catch {
      sendJSON(res, 502, {error:"데이터를 불러오지 못했어요. API 키와 네트워크 연결을 확인해 주세요."});
    }
  };
}
