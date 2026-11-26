// 날짜·심야 회차·필터·외부 장애·CORS가 실제 응답 의미를 보존하는지 검증합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {normalize,queryOptions,present,seoulToday,loadUpstream} from '../src/index.js';
const row = {siteNo:'0013',scnYmd:'20261126',scnsNo:'001',scnSseq:'1',movNo:'1',movNm:'영화',prodNm:'영화(자막)',scnsNm:'IMAX',scnsrtTm:'2410',scnendTm:'0130',frSeatCnt:'0',stcnt:'500'};
const payload = data => ({statusCode:0,data});
test('KST date rolls over at UTC 15:00',()=>assert.equal(seoulToday(Date.parse('2026-11-25T15:00:00Z')),'2026-11-26'));
test('late-night start and end use next calendar day, zero seats preserved',()=>{
 const shows=normalize(payload([row,row]),'2026-11-26'); assert.equal(shows.length,1);
 assert.equal(shows[0].startsAt,'2026-11-27T00:10:00+09:00');
 assert.equal(shows[0].endsAt,'2026-11-27T01:30:00+09:00'); assert.equal(shows[0].remainingSeats,0);
});
test('bad dates, times, repeated and unknown query rejected',()=>{
 for(const query of ['date=2026-02-30','date=2026-13-01','from=25:60','from=48:00','groupBy=x','from=18:00&to=18:00','date=2026-11-26&date=2026-11-27','foo=x'])
 assert.throws(()=>queryOptions(new URLSearchParams(query)));
});
test('overnight range includes 24-hour clock shows, upper bound exclusive',()=>{
 const shows=normalize(payload([row,{...row,scnSseq:'2',scnsrtTm:'2600',scnendTm:'2800'}]),'2026-11-26');
 const options=queryOptions(new URLSearchParams('date=2026-11-26&from=23:00&to=02:00&screen=imax&movie=자막'));
 const result=present({fetchedAt:new Date().toISOString(),showtimes:shows},options,'MISS');
 assert.equal(result.total,1); assert.equal(result.groups[0].key,'24:00');
});
test('upstream schema errors never silently become empty results',()=>{
 for(const p of [{data:[]},{statusCode:1,data:[]},payload({}),payload([{...row,siteNo:'0001'}]),payload([{...row,scnsrtTm:'bad'}])])
 assert.throws(()=>normalize(p,'2026-11-26'));
 assert.deepEqual(normalize(payload([]),'2026-11-26'),[]);
});
test('HTML blocking and network timeout surface as unavailable',async()=>{
 await assert.rejects(loadUpstream('2026-11-26',async()=>new Response('<html>blocked</html>')),{status:503,code:'UPSTREAM_BLOCKED'});
 await assert.rejects(loadUpstream('2026-11-26',async()=>{throw Error('timeout')}),{status:503});
});
test('HTTP errors, preflight, metadata and health',async()=>{
 const call=(path,method='GET')=>worker.fetch(new Request('https://example.com'+path,{method}),{},{});
 assert.equal((await call('/api/showtimes?date=2026-02-30')).status,400);
 assert.equal((await call('/nope')).status,404);
 assert.equal((await call('/api/showtimes','POST')).status,405);
 assert.equal((await call('/api/showtimes','OPTIONS')).status,204);
 assert.equal((await call('/')).status,200);
 assert.equal((await (await call('/health')).json()).upstreamChecked,false);
});
test('request integration filters live-shaped upstream JSON and exposes CORS',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify(payload([row])),{headers:{'content-type':'application/json'}});
 try {
  const response=await worker.fetch(new Request('https://example.com/api/showtimes?date=2026-11-26&from=24:00&to=25:00'),{},{});
  assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'*');
  assert.equal((await response.json()).showtimes[0].startTime,'24:10');
 } finally {globalThis.fetch=original;}
});
test('separate CINE de CHEF site is excluded',()=>{
 const rows=normalize(payload([row,{...row,siteNo:'P013'}]),'2026-11-26');
 assert.equal(rows.length,1);
});
