# CGV 용산아이파크몰 상영시간표 API

운영 주소: https://cgv-yongsan-showtimes.jw4570g.workers.dev

Cloudflare Workers + Cloudflare Browser Rendering(Puppeteer)으로 CGV가 현재 제공하는 상영시간표를 조회합니다. 별도 서버, CGV 로그인, 외부 프록시가 필요하지 않습니다.

## 사용

```sh
# 오늘 시간표: 한국 시간 기준, 시작 시간순 + 시간별 묶음
curl 'https://cgv-yongsan-showtimes.jw4570g.workers.dev/api/showtimes'

# 지정 날짜 저녁
curl 'https://cgv-yongsan-showtimes.jw4570g.workers.dev/api/showtimes?date=2026-11-26&from=18:00&to=24:00'

# IMAX, 영화별 묶음
curl 'https://cgv-yongsan-showtimes.jw4570g.workers.dev/api/showtimes?screen=IMAX&groupBy=movie'

# 23시부터 다음 날 새벽 2시 전까지
curl 'https://cgv-yongsan-showtimes.jw4570g.workers.dev/api/showtimes?from=23:00&to=02:00'
```

| 파라미터 | 설명 | 기본값 |
| --- | --- | --- |
| `date` | 상영 영업일, `YYYY-MM-DD` | 한국 오늘 |
| `from` | 시작 시간 포함, `HH:mm` | `00:00` |
| `to` | 끝 시간 제외, `HH:mm` | 영업일의 모든 회차 |
| `movie` | 표시 영화명 부분 검색, 자막·더빙 포함 | 전체 |
| `screen` | 상영관명 부분 검색, IMAX/4DX 등 | 전체 |
| `groupBy` | `hour`, `movie`, `none` | `hour` |

`from`, `to`는 `00:00`~`47:59`를 허용합니다. `to < from`이면 다음 날로 해석합니다. `24:10`은 지정 영업일 다음 날 00:10입니다. 다음 영업일 시간표를 별도로 합치지는 않습니다. 예: `date=2026-11-26&from=00:00&to=02:00`는 26일 새벽을 의미하고, `from=24:00&to=26:00`는 27일 새벽을 의미합니다.

## 응답

- `theater`, `date`, `timezone`: 조회 지점·영업일·시간대
- `fetchedAt`: CGV 데이터 수신 시각(UTC)
- `transport`: 운영 환경에서는 `cloudflare-browser`
- `cache`: `HIT` 또는 `MISS`, `X-Cache` 헤더로도 제공
- `stale`: 수신 후 120초 초과 여부
- `total`, `movieCount`: 필터 후 회차·영화 수
- `showtimes`: 시작 시간순 전체 결과
- `groups`: 시간 또는 영화별 묶음(`groupBy=none`일 때 생략)

각 회차에는 `id`, `movieId`, `title`, `displayTitle`, `screen`, `format`, `rating`, `startTime`, `endTime`, `startsAt`, `endsAt`, `remainingSeats`, `totalSeats`, `bookingUrl`이 있습니다. `startsAt`, `endsAt`은 `+09:00` 오프셋을 포함합니다. 확인할 수 없는 좌석 값은 `null`, 매진은 `0`입니다. `bookingUrl`은 CGV 일반 예매 페이지입니다.

지점 코드는 `0013`입니다. 원본에 섞여 오는 별도 지점 `P013`(CINE de CHEF 용산)은 제외합니다. CGV 원본이 제공하지 않는 과거 회차·미편성 날짜를 복원하지 않습니다. 현재 남아 있는 회차만 반환될 수 있습니다.

## 캐시·오류

날짜별 원본 결과를 Cloudflare Cache API에 120초간 저장합니다. 영화·상영관·시간 필터는 같은 날짜 캐시를 공유합니다. 캐시는 데이터센터별이며 초기 조회에는 브라우저 시작 시간이 필요합니다. Browser Rendering 사용량은 Cloudflare 계정의 할당량 및 과금 정책을 따릅니다.

CORS는 모든 출처의 GET 요청을 허용합니다. 오류 응답은 캐시하지 않습니다.

일부 기본 클라이언트 User-Agent(예: Python urllib)는 Workers 앞단에서 HTTP 403/1010으로 차단될 수 있습니다. Python 클라이언트는 `User-Agent: cgv-client/1.0`처럼 식별 가능한 값을 지정하세요. curl과 지정 User-Agent를 사용한 Python 호출은 운영 URL에서 확인했습니다.

| HTTP | 코드 예시 | 의미 |
| --- | --- | --- |
| 400 | `INVALID_DATE`, `INVALID_TIME`, `INVALID_QUERY` | 잘못된 조회 조건 |
| 404 | `NOT_FOUND` | 없는 경로 |
| 405 | `METHOD_NOT_ALLOWED` | GET·OPTIONS 외 메서드 |
| 502 | `UPSTREAM_SCHEMA_CHANGED` | CGV 응답 형식 변경 |
| 503 | `UPSTREAM_BLOCKED`, `BROWSER_UNAVAILABLE` | CGV 차단·브라우저 실패 |

정상 빈 시간표는 `200`과 `total: 0`입니다. 차단·파싱 오류를 빈 배열로 숨기지 않습니다. `/health`는 Worker 응답 여부만 확인하며 CGV 연결 검사는 하지 않습니다.

## 개발·배포

Node.js 22 이상 및 Cloudflare 계정이 필요합니다.

```sh
npm ci
npm test
npm run check
npx wrangler login
npm run deploy
npm run dev
```

`wrangler.jsonc`의 Worker 이름과 `browser.binding`을 확인하세요. Browser Rendering 바인딩은 운영 배포에서 동작합니다. 로컬에서 실제 브라우저 연결을 확인하려면 Cloudflare 문서에 맞는 원격 바인딩 또는 `wrangler dev --remote`를 사용하세요.

## 참고

- CGV 공식 지점: https://cgv.co.kr/cnm/bzplcCgv/0013001
- CGV 웹사이트가 사용하는 데이터 경로: `/api/v1/booking/searchMovScnInfo`
- Cloudflare Browser Rendering: https://developers.cloudflare.com/browser-rendering/puppeteer/
- Cloudflare Workers 설정: https://developers.cloudflare.com/workers/wrangler/configuration/

CGV가 공식적으로 지원·보증하는 공개 개발자 API는 아닙니다. 원본의 변경·차단·서비스 정책에 따라 데이터 제공이 달라질 수 있습니다.
