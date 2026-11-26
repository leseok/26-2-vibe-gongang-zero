"use strict";
// 행사·영화의 응답 상태를 독립적으로 관리한다. 한 출처가 실패해도 다른 결과를 표시한다.
const {districts, moods, types, seoulDate, minutes, fits} = window.GonggangZeroData;
const $ = id => document.getElementById(id);
const sourceGroups = {
  events: {name: "문화행사", mode: "loading", items: [], request: 0},
  movies: {name: "영화", mode: "loading", items: [], request: 0}
};
// 기존 사용자의 저장 목록을 계속 읽을 수 있도록 최초 저장 키를 유지한다.
const saveKey = "teum.saved.v1";
function readSaved() {
  try {
    const rows = JSON.parse(localStorage.getItem(saveKey) || "[]");
    if (!Array.isArray(rows)) return new Map();
    const kept = rows.filter(r => r?.source !== "예시" && !String(r?.id).startsWith("demo-"));
    if (kept.length !== rows.length) {
      try { localStorage.setItem(saveKey, JSON.stringify(kept)); } catch { /* 읽기 전용이어도 실제 활동은 표시한다. */ }
    }
    return new Map(kept.filter(r => r && typeof r.id === "string" && typeof r.title === "string" && types[r.type]).map(r => [r.id, r]));
  } catch { return new Map(); }
}
const saved = readSaved();
let nav = "all", type = "all", mood = "혼자 조용히", limit = 6;
let filters, shownItems = new Map();
// API 값을 textContent로 넣어 카드에 외부 HTML이 실행되지 않게 한다.
function el(tag, cls, value) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (value != null) node.textContent = value;
  return node;
}
function control(label, active, action) {
  const b = el("button", "", label);
  b.type = "button";
  b.setAttribute("aria-pressed", String(active));
  b.addEventListener("click", action);
  return b;
}
function safeLink(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "";
  } catch { return ""; }
}
// 폼 입력을 숫자와 문자열로 정리한다. 빈 예산은 제한 없음(null)으로 처리한다.
function readFilters() {
  return {date: $("date").value, start: $("start").value, end: $("end").value,
    district: $("district").value, budget: $("budget").value === "" ? null : Number($("budget").value)};
}
function updateDuration() {
  const n = minutes($("end").value) - minutes($("start").value);
  const valid = n > 0;
  $("end").setCustomValidity(valid ? "" : "끝나는 시간은 시작 시간보다 늦어야 해요.");
  $("duration").textContent = valid ? [Math.floor(n/60) ? Math.floor(n/60) + "시간" : "", n%60 ? n%60 + "분" : ""].filter(Boolean).join(" ") : "";
}
function scrollResults() {
  $("results").focus({preventScroll: true});
  $("results").scrollIntoView({block:"start"});
}
// 현재 메뉴, 유형, 기분에 맞춰 버튼의 선택 상태를 갱신한다.
function drawControls() {
  document.querySelectorAll("[data-nav]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.nav === nav)));
  $("saved-count").textContent = saved.size;
  $("mood-pills").replaceChildren(...moods.map(name => control(name, name === mood, () => {
    mood = name; limit = 6; drawControls(); render();
    [...$("mood-pills").children].find(b => b.textContent === name)?.focus({preventScroll:true});
  })));
  const choices = nav === "movie" ? ["movie"] : nav === "culture" ? ["all","exhibit","show","other"] : ["all","exhibit","show","movie","other"];
  $("type-tabs").replaceChildren(...choices.map(key => control(types[key], type === key, () => {
    type = key; limit = 6; drawControls(); render();
    [...$("type-tabs").children].find(b => b.textContent === types[key])?.focus({preventScroll:true});
  })));
}
function changeNav(next, scroll = true) {
  nav = next; type = next === "movie" ? "movie" : "all"; limit = 6;
  $("free").checked = false;
  drawControls(); render();
  if (scroll) scrollResults();
}
// groupName은 events 또는 movies다. 마지막 요청만 반영해 빠른 날짜 변경에도 화면을 일치시킨다.
async function load(groupName) {
  const group = sourceGroups[groupName];
  const request = ++group.request;
  group.items = []; group.mode = "loading"; render();
  let mode = "no-server", items = [];
  try {
    if (location.protocol !== "file:") {
      const path = groupName === "events" ? "api/events?date=" + filters.date : "api/movies";
      const response = await fetch(path, {headers:{Accept:"application/json"}, signal:AbortSignal.timeout(60000)});
      const isJSON = (response.headers.get("content-type") || "").includes("application/json");
      const staticPage = response.ok && (response.headers.get("content-type") || "").includes("text/html");
      if (response.status !== 404 && !staticPage) {
        if (!response.ok || !isJSON) throw new Error();
        const data = await response.json();
        if (data.mode === "live" && Array.isArray(data.items)) { mode = "live"; items = data.items; }
        else if (data.mode === "unconfigured") mode = "unconfigured";
        else throw new Error();
      }
    }
  } catch { mode = "error"; items = []; }
  if (request !== group.request) return;
  group.mode = mode; group.items = items; render();
}
function relevantGroups() {
  if (nav === "saved") return [];
  if (nav === "movie" || type === "movie") return ["movies"];
  if (nav === "culture" || type !== "all") return ["events"];
  return ["events","movies"];
}
// 지역·날짜·시간·예산 필터를 적용한 후 취향이 일치하는 활동을 먼저 표시한다.
function selectItems() {
  let items = nav === "saved" ? [...saved.values()].reverse()
    : relevantGroups().flatMap(key => sourceGroups[key].items).filter(item => fits(item, filters));
  items = items.filter(item => (type === "all" || type === item.type) && (!$("free").checked || item.price === 0));
  if (nav === "saved") return items;
  const score = item => Number(mood !== "전체" && item.moods?.includes(mood));
  items.sort((a,b) => score(b) - score(a));
  // 발견 화면에서는 첫 줄에서 문화행사와 영화 모두를 비교할 수 있게 한다.
  if (nav === "all" && type === "all") {
    const movie = items.findIndex(item => item.type === "movie");
    if (movie > 2 && score(items[movie]) === score(items[2])) items.splice(2, 0, ...items.splice(movie,1));
  }
  return items;
}
function priceText(item) {
  if (item.price === 0) return "무료";
  if (item.price != null) return item.price.toLocaleString("ko-KR") + "원";
  return item.fee || "가격 미확인";
}
function shortDate(date) { return date?.slice(5).replace("-", ".") || ""; }
function schedule(item) {
  if (item.type === "movie") {
    const rankDate = shortDate(item.rankDate);
    return [rankDate && rankDate + " 집계", item.minutes && item.minutes + "분"].filter(Boolean).join(" · ");
  }
  return [shortDate(item.startDate),shortDate(item.endDate)].filter((v,i,a) => v && (!i || v !== a[0])).join(" – ") || "기간 확인";
}
// API가 보낸 행사 링크를 사용한다. 이전에 저장한 영화도 KOBIS 코드로 원문을 찾을 수 있다.
function activityLink(item) {
  const movieCode = /^kobis-(\d+)$/.exec(item.id)?.[1];
  if (item.type === "movie" && movieCode) {
    return "https://www.kobis.or.kr/kobis/mobile/mast/mvie/searchMovieDtl.do?movieCd=" + movieCode;
  }
  return safeLink(item.link);
}
// 원문 안내는 새 탭에서 열어 현재 검색 조건을 유지한다.
function externalLink(label, href, className = "") {
  const link = el("a",className,label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}
// 정규화된 활동 하나를 카드로 만든다. 제공되지 않은 가격·시간은 확인이 필요하다고 표시한다.
function card(item) {
  const movie = item.type === "movie";
  const article = el("article","card");
  const cover = el("div","card-cover no-poster" + (movie ? " movie" : ""));
  const mark = el("span","cover-mark", movie ? "No. " + item.rank : (item.category || types[item.type]));
  mark.setAttribute("aria-hidden","true"); cover.append(mark);
  const imgSrc = safeLink(item.image);
  if (imgSrc) {
    const img = el("img", item.source === "한국관광공사" ? "tour-image" : ""); img.alt = ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
    mark.hidden = true; img.addEventListener("error", () => { img.remove(); mark.hidden = false; }, {once:true});
    img.src = imgSrc; cover.append(img);
  }
  const category = movie ? "최근 박스오피스" : (item.category || types[item.type]);
  cover.append(el("span","cover-type",category));
  const save = el("button","save"); save.type = "button"; save.dataset.save = item.id;
  const icon = el("span","bookmark-icon"); icon.setAttribute("aria-hidden","true"); save.append(icon);
  save.setAttribute("aria-label", item.title + (saved.has(item.id) ? " 저장 해제" : " 저장"));
  save.setAttribute("aria-pressed", String(saved.has(item.id)));
  const body = el("div","card-body"), h = el("h3"), open = el("button","details-btn",item.title);
  open.type = "button"; open.dataset.detail = item.id; h.append(open);
  const meta = movie ? [item.genre || "영화", "박스오피스 " + item.rank + "위"] : [item.place || "장소 확인",item.district];
  body.append(h,el("p","meta",meta.filter(Boolean).join(" · ")),el("p","schedule",schedule(item)));
  const bottom = el("div","card-bottom");
  bottom.append(el("span","price",priceText(item)),el("span","",movie ? "상영시간 확인" : item.hours || "시간 확인"));
  const href = activityLink(item);
  if (href) bottom.append(externalLink(movie ? "KOBIS 영화 정보" : "행사 공식 안내",href,"source-link"));
  body.append(bottom); article.append(cover,save,body); return article;
}
// 로딩, 연결 오류, 빈 결과를 구분하고 화면에 현재 검색 결과를 그린다.
function render() {
  const labels = {all:"내 공강에 어울리는 활동", culture:"서울 문화행사", movie:"최근 박스오피스 영화", saved:"저장한 활동"};
  $("results-title").textContent = labels[nav];
  $("results-desc").textContent = nav === "saved" ? "이 브라우저에 저장한 활동을 다시 볼 수 있어요."
    : nav === "movie" || type === "movie" ? "일별 관객 수 기준 순위예요. 상영 회차와 요금은 극장에서 확인하세요."
    : "날짜와 취향에 맞는 문화행사와 영화를 찾아보세요.";
  const groups = relevantGroups();
  const states = {loading:"조회 중",error:"연결 오류",unconfigured:"키 미설정","no-server":"서버 연결 필요",live:"실제 데이터"};
  $("mode").textContent = groups.map(k => sourceGroups[k].name + " · " + states[sourceGroups[k].mode]).join("　");
  $("messages").replaceChildren();
  if (groups.some(k => sourceGroups[k].mode === "no-server")) {
    $("messages").append(el("p","","활동을 보려면 프로젝트 폴더에서 node server.mjs를 실행하고 터미널에 표시된 주소를 열어 주세요."));
  }
  const missingKeys = groups.filter(k => sourceGroups[k].mode === "unconfigured")
    .map(k => k === "events" ? "한국관광공사 키(TOUR_API_KEY)" : "영화진흥위원회 키(KOBIS_API_KEY)");
  if (missingKeys.length) {
    $("messages").append(el("p","","필요한 환경변수: " + missingKeys.join(", ") + ". 로컬에서는 .env.local에 입력하고 서버를 재시작해 주세요."));
  }
  for (const key of groups.filter(k => sourceGroups[k].mode === "error")) {
    const line = el("div","", sourceGroups[key].name + " 조회에 실패했어요. 키와 네트워크 연결을 확인해 주세요. ");
    const retry = el("button","", "다시 조회"); retry.type = "button";
    retry.addEventListener("click", () => load(key)); line.append(retry); $("messages").append(line);
  }
  const items = selectItems();
  shownItems = new Map(items.map(item => [item.id,item]));
  const grid = $("cards"); grid.replaceChildren(...items.slice(0,limit).map(card));
  const loading = groups.some(k => sourceGroups[k].mode === "loading");
  if (!items.length && (nav === "saved" || loading || groups.some(k => sourceGroups[k].mode === "live"))) {
    const empty = el("div","empty"), noSaves = nav === "saved" && !saved.size;
    empty.append(el("strong","",loading ? "활동을 불러오는 중이에요." : noSaves ? "아직 저장한 활동이 없어요." : "조건에 맞는 활동이 없어요."));
    if (!loading) empty.append(el("p","",noSaves ? "활동 카드의 북마크를 누르면 여기에 모여요." : "날짜나 지역, 예산을 바꿔보세요."));
    grid.append(empty);
  }
  $("more").hidden = items.length <= limit;
  const notes = [];
  if (items.length) notes.push("총 " + items.length + "개 중 " + Math.min(limit,items.length) + "개 표시");
  if (nav !== "saved" && (filters.budget !== null || filters.district || $("free").checked)) notes.push("지역·요금이 확인되는 활동만 해당 조건에 포함해요.");
  $("summary").textContent = notes.join("　");
}
// 카드의 활동을 상세 창에 표시한다. 러닝타임과 극장 상영 회차를 구분한다.
function detail(item) {
  const movie = item.type === "movie";
  $("detail-type").textContent = (item.category || types[item.type]) + " · " + item.source;
  $("detail-title").textContent = item.title;
  const facts = movie ? [["집계일",item.rankDate],["전국 순위",item.rank + "위"],["장르",item.genre],["러닝타임",item.minutes && item.minutes + "분"],["개봉일",item.openDate],["요금",priceText(item)]]
    : [["장소",item.place || item.district || "장소 확인"],["주소",item.address !== item.place && item.address],["기간",[item.startDate,item.endDate].filter(Boolean).join(" ~ ")],["운영시간",item.hours || "시간 확인"],["이용요금",priceText(item)],["예상 관람",item.minutes && item.minutes + "분"]];
  $("detail-facts").replaceChildren(...facts.filter(([,v]) => v).flatMap(([k,v]) => [el("dt","",k),el("dd","",v)]));
  const note = [item.note, movie ? "선택한 공강 시간의 실제 상영 회차는 극장 시간표에서 확인하세요." : "회차와 휴관일, 예약 가능 여부는 공식 안내를 확인하세요."];
  $("detail-note").textContent = note.filter(Boolean).join(" ");
  const links = [];
  const href = activityLink(item);
  if (href) links.push([movie ? "KOBIS 영화 정보" : "행사 공식 안내",href]);
  if (movie) links.push(["CGV 시간표","https://cgv.co.kr/cnm/movieBook/movie"],["메가박스 시간표","https://www.megabox.co.kr/booking/timetable"]);
  $("detail-actions").replaceChildren(...links.map(([label,url]) => externalLink(label,url)));
  $("detail").showModal();
}
// 저장 버튼은 같은 활동을 추가하거나 제거하고 목록과 브라우저 저장소를 갱신한다.
function toggleSave(item) {
  if (saved.has(item.id)) saved.delete(item.id); else saved.set(item.id,item);
  let message = saved.has(item.id) ? "저장했어요." : "저장을 해제했어요.";
  try { localStorage.setItem(saveKey, JSON.stringify([...saved.values()])); }
  catch { message += " 브라우저 저장 공간을 사용할 수 없어 이번 화면에서만 유지돼요."; }
  $("announce").textContent = item.title + " " + message;
  $("saved-count").textContent = saved.size; render();
  const next = [...$("cards").querySelectorAll("[data-save]")].find(b => b.dataset.save === item.id)
    || $("cards").querySelector("[data-save]") || document.querySelector('[data-nav="saved"]');
  next.focus({preventScroll:true});
}
// 서울 기준 기본 날짜를 넣고 검색 폼, 저장 버튼, 상세 창에 이벤트를 연결한다.
$("date").value = seoulDate();
for (const d of districts) $("district").add(new Option(d,d));
filters = readFilters(); updateDuration();
for (const id of ["start","end"]) $(id).addEventListener("input",updateDuration);
$("finder").addEventListener("submit",e => {
  e.preventDefault(); const previous = filters.date; filters = readFilters();
  if (nav === "saved") changeNav("all",false);
  limit = 6; render(); if (previous !== filters.date) load("events"); scrollResults();
});
$("campus").addEventListener("click",() => {
  $("district").value = "동작구"; changeNav("culture",false); $("finder").requestSubmit();
});
document.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click",() => changeNav(b.dataset.nav)));
document.querySelector(".logo").addEventListener("click",() => changeNav("all",false));
$("free").addEventListener("change",() => { limit = 6; render(); });
$("more").addEventListener("click",() => { limit += 6; render(); });
$("cards").addEventListener("click",e => {
  const b = e.target.closest("button");
  if (!b) return;
  const item = shownItems.get(b.dataset.save || b.dataset.detail);
  if (!item) return;
  if (b.dataset.save) toggleSave(item); else detail(item);
});
$("detail").querySelector(".close").addEventListener("click",() => $("detail").close());
$("detail").addEventListener("click",e => {
  const r = $("detail").getBoundingClientRect();
  if (e.target === $("detail") && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) $("detail").close();
});
drawControls(); load("events"); load("movies");
