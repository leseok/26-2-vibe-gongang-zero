const THEATER = { id: '0013', name: 'CGV 용산아이파크몰' };
const SOURCE = 'https://cgv.co.kr/api/v1/booking/searchMovScnInfo';
const TTL = 120;
/** HTTP 상태·오류 코드·사용자 안내를 함께 전달하는 서버 오류입니다. */
export class ApiError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, {status, code}); }
}
/** UTC 밀리초를 받아 한국 시간의 YYYY-MM-DD를 반환합니다. */
export function seoulToday(now = Date.now()) { return new Date(now + 9 * 3600000).toISOString().slice(0,10); }
/** 날짜 입력을 검증해 반환하고 생략 시 한국 오늘을 사용합니다. */
export function parseDate(value) {
  const date = value ?? seoulToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)
    throw new ApiError(400, 'INVALID_DATE', 'date는 유효한 YYYY-MM-DD여야 합니다.');
  return date;
}
/** 24시 이후를 포함한 영업일 시각 HH:mm을 분 단위 숫자로 변환합니다. */
export function minutes(value, max = 47) {
  if (!/^\d{2}:\d{2}$/.test(value) || +value.slice(0,2) > max || +value.slice(3) > 59)
    throw new ApiError(400, 'INVALID_TIME', '시간은 HH:mm 형식이며 00:00~47:59 범위입니다.');
  return +value.slice(0,2)*60 + +value.slice(3);
}
/** CGV의 HHmm 문자열을 검증된 HH:mm으로 변환합니다. */
function upstreamTime(value) {
  const raw = String(value ?? '').replaceAll(':','');
  if (!/^\d{4}$/.test(raw)) throw new ApiError(502,'UPSTREAM_SCHEMA_CHANGED','CGV 시간 데이터 형식이 변경되었습니다.');
  const time = raw.slice(0,2)+':'+raw.slice(2);
  try { minutes(time); } catch { throw new ApiError(502,'UPSTREAM_SCHEMA_CHANGED','CGV 시간 데이터가 올바르지 않습니다.'); }
  return time;
}
/** 영업일과 경과 분으로 다음 날까지 반영한 한국 시간 ISO 문자열을 만듭니다. */
function stamp(date, mins) { return new Date(Date.parse(date+'T00:00:00+09:00') + mins*60000 + 9*3600000).toISOString().slice(0,19)+'+09:00'; }
/** 좌석 값의 0은 보존하고 확인할 수 없는 값은 null로 반환합니다. */
function count(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(+value) && +value >= 0 ? +value : null; }
/** 원본 JSON과 영업일로 회차를 정규화하고 중복 제거 후 시간순으로 반환합니다. */
export function normalize(payload, date) {
  if (!payload || ![0,'0'].includes(payload.statusCode) || !Array.isArray(payload.data))
    throw new ApiError(502,'UPSTREAM_SCHEMA_CHANGED','CGV가 정상 시간표 데이터를 반환하지 않았습니다.');
  const unique = new Map();
  for (const row of payload.data) {
    if (String(row.siteNo) === 'P013') continue; // 함께 반환되는 별도 지점 CINE de CHEF 용산은 제외합니다.
    if (String(row.siteNo) !== THEATER.id || row.scnYmd !== date.replaceAll('-','') || !row.scnsNo || !row.scnSseq || !(row.prodNm || row.movNm) || !row.movNo)
      throw new ApiError(502,'UPSTREAM_SCHEMA_CHANGED','CGV 회차 데이터 형식이 변경되었습니다.');
    const startTime = upstreamTime(row.scnsrtTm), endTime = upstreamTime(row.scnendTm);
    const start = minutes(startTime); let end = minutes(endTime);
    if (end < start) end += 1440;
    const id = `${THEATER.id}-${row.scnYmd}-${row.scnsNo}-${row.scnSseq}`;
    unique.set(id, { id, movieId: String(row.movNo), title: row.movNm || row.prodNm,
      displayTitle: row.expoProdNm || row.prodNm || row.movNm,
      screen: row.expoScnsNm || row.scnsNm || String(row.scnsNo),
      format: row.movkndDsplNm || null, rating: row.cratgClsNm || null,
      startTime, endTime, startsAt: stamp(date,start), endsAt: stamp(date,end),
      remainingSeats: count(row.frSeatCnt), totalSeats: count(row.stcnt),
      bookingUrl: 'https://cgv.co.kr/cnm/movieBook' });
  }
  return [...unique.values()].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)||a.id.localeCompare(b.id));
}
/** URLSearchParams를 검증하고 자정을 넘기는 시간 범위를 해석합니다. */
export function queryOptions(params) {
  for (const key of params.keys()) if (!['date','from','to','movie','screen','groupBy'].includes(key)) throw new ApiError(400,'INVALID_QUERY',`지원하지 않는 파라미터: ${key}`);
  for (const key of new Set(params.keys())) if (params.getAll(key).length > 1) throw new ApiError(400,'INVALID_QUERY',`중복 파라미터: ${key}`);
  const date = parseDate(params.get('date') ?? undefined);
  const from = params.has('from') ? minutes(params.get('from')) : 0;
  let to = params.has('to') ? minutes(params.get('to')) : 2880;
  if (to < from) to += 1440;
  if (to === from || to > 2880) throw new ApiError(400,'INVALID_RANGE','시간 범위가 올바르지 않습니다.');
  const groupBy = params.get('groupBy') || 'hour';
  if (!['hour','movie','none'].includes(groupBy)) throw new ApiError(400,'INVALID_GROUP','groupBy는 hour, movie, none 중 하나입니다.');
  return {date, from, to, groupBy, movie:params.get('movie') || '', screen:params.get('screen') || ''};
}
/** 날짜 캐시를 검색 조건으로 필터링하고 시간별 또는 영화별 묶음을 반환합니다. */
export function present(snapshot, options, cacheStatus) {
  const shows = snapshot.showtimes.filter(s => minutes(s.startTime) >= options.from && minutes(s.startTime) < options.to &&
    s.displayTitle.toLowerCase().includes(options.movie.toLowerCase()) && s.screen.toLowerCase().includes(options.screen.toLowerCase()));
  const result = { theater: THEATER, date: options.date, timezone:'Asia/Seoul', fetchedAt:snapshot.fetchedAt,
    cache:cacheStatus, transport:snapshot.transport || 'direct', stale:Date.now()-Date.parse(snapshot.fetchedAt)>TTL*1000, total:shows.length,
    movieCount:new Set(shows.map(s=>s.movieId)).size, source:SOURCE, showtimes:shows };
  if (options.groupBy !== 'none') {
    const groups = new Map();
    for (const show of shows) {
      const key = options.groupBy === 'hour' ? show.startTime.slice(0,2)+':00' : show.movieId;
      if (!groups.has(key)) groups.set(key,{key,...(options.groupBy==='movie'?{title:show.title}:{}),showtimes:[]});
      groups.get(key).showtimes.push(show);
    }
    result.groups = [...groups.values()];
  }
  return result;
}
/** 영업일로 용산 지점만 조회하는 고정 CGV 요청 주소를 만듭니다. */
function sourceUrl(date) {
  const url = new URL(SOURCE);
  url.search = new URLSearchParams({coCd:'A420',siteNo:THEATER.id,scnYmd:date.replaceAll('-',''),rtctlScopCd:'08'});
  return url;
}
/** 브라우저 바인딩으로 원본을 조회하며 성공·실패와 무관하게 브라우저를 종료합니다. */
export async function loadBrowser(date, binding) {
  const {default:puppeteer} = await import('@cloudflare/puppeteer');
  let browser;
  try {
    browser=await puppeteer.launch(binding);
    const page=await browser.newPage();
    const response=await page.goto(sourceUrl(date).toString(),{waitUntil:'domcontentloaded',timeout:25000});
    if (!response?.ok() || !(response.headers()['content-type'] || '').includes('json'))
      throw new ApiError(503,'UPSTREAM_BLOCKED','CGV가 브라우저 요청을 차단했습니다.');
    const payload=await response.json();
    return {fetchedAt:new Date().toISOString(),showtimes:normalize(payload,date),transport:'cloudflare-browser'};
  } catch(error) {
    if(error instanceof ApiError) throw error;
    throw new ApiError(503,'BROWSER_UNAVAILABLE','브라우저 조회에 실패했습니다. 잠시 후 다시 조회하세요.');
  } finally { if(browser) await browser.close().catch(()=>{}); }
}
/** 날짜와 선택적 fetch 구현으로 직접 조회합니다. 차단을 빈 시간표로 처리하지 않습니다. */
export async function loadUpstream(date, fetcher=fetch) {
  const url = sourceUrl(date);
  let response;
  try { response = await fetcher(url,{headers:{Accept:'application/json','Accept-Language':'ko-KR',Referer:'https://cgv.co.kr/cnm/movieBook',
    'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'},signal:AbortSignal.timeout(10000)}); }
  catch { throw new ApiError(503,'UPSTREAM_UNAVAILABLE','CGV에 연결할 수 없습니다. 잠시 후 다시 조회하세요.'); }
  if (!response.ok || !(response.headers.get('content-type') || '').includes('json'))
    throw new ApiError(503,'UPSTREAM_BLOCKED','CGV가 서버 요청을 차단했습니다. 잠시 후 다시 조회하세요.');
  let payload; try { payload = await response.json(); } catch { throw new ApiError(502,'UPSTREAM_SCHEMA_CHANGED','CGV JSON 응답이 올바르지 않습니다.'); }
  return {fetchedAt:new Date().toISOString(), showtimes:normalize(payload,date)};
}
const headers = {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Expose-Headers':'X-Cache','X-Content-Type-Options':'nosniff'};
/** 응답 본문·상태·추가 헤더로 CORS가 적용된 JSON 응답을 만듭니다. */
function json(body,status=200,extra={}) { return new Response(JSON.stringify(body,null,2),{status,headers:{...headers,'Cache-Control':'no-store',...extra}}); }
export default {
  /** Worker 요청을 분기하고 날짜별 캐시를 공유한 뒤 JSON 또는 명시적 오류를 반환합니다. */
  async fetch(request, env, ctx) {
    try {
      const url=new URL(request.url);
      if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
      if (request.method!=='GET') return json({error:{code:'METHOD_NOT_ALLOWED',message:'GET만 지원합니다.'}},405,{Allow:'GET, OPTIONS'});
      if(url.pathname==='/health') return json({ok:true,service:'cgv-yongsan-showtimes',upstreamChecked:false});
      if(url.pathname==='/') return json({name:'CGV 용산아이파크몰 상영시간표 API',endpoint:'/api/showtimes',example:'/api/showtimes?date='+seoulToday()+'&from=18:00&to=24:00&groupBy=hour',parameters:{date:'YYYY-MM-DD (기본: 한국 오늘)',from:'HH:mm (포함)',to:'HH:mm (미포함, 24시 이후 지원)',movie:'영화명 부분 검색',screen:'상영관명 부분 검색 (IMAX, 4DX 등)',groupBy:'hour | movie | none'},timezone:'Asia/Seoul',cacheSeconds:TTL});
      if(url.pathname!=='/api/showtimes') throw new ApiError(404,'NOT_FOUND','경로를 찾을 수 없습니다.');
      const options=queryOptions(url.searchParams);
      const key=new Request(url.origin+'/__cache/showtimes-v1/'+options.date);
      const cache=globalThis.caches?.default;
      const hit=await cache?.match(key);
      let snapshot, status;
      if(hit) { snapshot=await hit.json(); status='HIT'; }
      else { snapshot=env.BROWSER ? await loadBrowser(options.date,env.BROWSER) : await loadUpstream(options.date); status='MISS';
        if(cache) ctx.waitUntil(cache.put(key,json(snapshot,200,{'Cache-Control':`public, max-age=${TTL}`})));
      }
      return json(present(snapshot,options,status),200,{'X-Cache':status});
    } catch(error) {
      if (!(error instanceof ApiError)) console.error('request_failed',error.name);
      return json({error:{code:error instanceof ApiError?error.code:'INTERNAL_ERROR',message:error instanceof ApiError?error.message:'서버 오류가 발생했습니다.'}},error instanceof ApiError?error.status:500);
    }
  }
};
