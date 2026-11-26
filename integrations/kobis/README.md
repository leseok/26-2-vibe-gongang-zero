# KOBIS 웹 클라이언트

`client.js`를 브라우저 ES 모듈로 가져오면 주간·주말·주중 박스오피스를 조회할 수 있습니다. 발급 키는 서버의 환경 변수에만 저장하며, 브라우저는 같은 출처의 `/api/kobis-weekly`를 호출합니다.

## 키 설정

KOBIS에서 발급받은 본인 키를 저장소 루트의 `.env.local`에 설정하세요.

```dotenv
# 실제 값은 커밋하지 않습니다. 변수 이름은 루트 .env.example에도 있습니다.
KOBIS_API_KEY=발급받은_키
```

Vercel 배포 시에는 프로젝트 환경 변수에도 `KOBIS_API_KEY`를 등록합니다. 코드와 키가 없는 상태에서도 모듈은 가져올 수 있지만 조회 요청에는 `503 MISSING_API_KEY`가 반환됩니다.

## 웹에서 사용

```html
<p id="boxoffice-status"></p>
<ul id="boxoffice-list"></ul>
<script type="module">
  // 프로젝트 루트의 HTML을 기준으로 한 경로입니다.
  import { getWeeklyBoxOffice } from './integrations/kobis/client.js';

  const status = document.querySelector('#boxoffice-status');
  status.textContent = '박스오피스를 불러오는 중입니다…';
  try {
    // 집계가 완료된 날짜를 선택하세요. weekGb는 0: 주간, 1: 주말, 2: 주중입니다.
    const result = await getWeeklyBoxOffice({ targetDt: '20261115', weekGb: '0', repNationCd: 'K' });
    status.textContent = result.weeklyBoxOfficeList.length ? result.showRange : '조회 결과가 없습니다.';
    for (const movie of result.weeklyBoxOfficeList) {
      const item = document.createElement('li');
      // 외부 영화명을 HTML로 해석하지 않고 문자열로 표시합니다.
      item.textContent = `${movie.rank}위 · ${movie.movieNm} · 관객 ${movie.audiCnt}명`;
      document.querySelector('#boxoffice-list').append(item);
    }
  } catch (error) {
    status.textContent = `조회 실패: ${error.message}`;
  }
</script>
```

`targetDt`는 필수이며 `YYYYMMDD`와 `YYYY-MM-DD`를 모두 받습니다. `weekGb` 생략 시 주말(`1`), `itemPerPage` 생략 시 `10`입니다. `multiMovieYn`, `repNationCd`, `wideAreaCd`도 지원합니다. 상세 필터 설명은 [기존 KOBIS 가이드](KOBIS_주간주말_박스오피스_API.md)를 참고하세요.

반환값은 `boxofficeType`, `showRange`, `yearWeekTime`, `weeklyBoxOfficeList`를 포함하는 `boxOfficeResult` 객체입니다. 영화별 숫자 필드는 원본 문자열을 유지합니다. 선택한 상영 기간은 `showRange`를 확인하세요. 이 데이터는 박스오피스 순위로, 용산 지점의 상영시간표나 영화 가격을 제공하지 않습니다.

자체 서버를 쓴다면 두 번째 인자로 `{ endpoint: 'https://본인서버/api/kobis-weekly' }`를 전달하세요. 다른 출처의 서버라면 서버에서 CORS를 허용해야 합니다. 취소는 `{ signal: abortController.signal }`로 전달합니다. 키를 `filters`에 넣는 것은 거부됩니다.

## 실행과 검증

```sh
# 저장소 루트에서 실행합니다. 별도 의존성 설치가 필요하지 않습니다.
npm --prefix integrations/kobis test

# Vercel 함수와 정적 HTML을 함께 실행합니다. .env.local의 키를 먼저 설정하세요.
npx vercel dev
```

`vercel dev`가 안내하는 주소(기본 `http://localhost:3000`)에서 위 HTML 예제를 실행합니다. 또는 다음처럼 서버 응답을 확인할 수 있습니다.

```sh
curl 'http://localhost:3000/api/kobis-weekly?targetDt=20261115&weekGb=0'
```

정상 응답은 `boxOfficeResult.weeklyBoxOfficeList` 배열을 포함합니다. `targetDt=20260230`은 `400 INVALID_QUERY`, 키 미설정은 `503 MISSING_API_KEY`, KOBIS의 키 거부 등 `faultInfo` 응답은 `502 KOBIS_ERROR`로 구분합니다. `python3 -m http.server`는 Vercel 함수를 실행하지 않으므로 이 API의 로컬 실행에는 사용할 수 없습니다.

테스트는 실제 발급 키 없이 성공 응답·빈 결과·잘못된 입력·키 누락·KOBIS 오류·HTML 오류·연결 실패·취소 신호 전달을 검증합니다. 발급 키가 제공되지 않아 실제 박스오피스 성공 조회는 수행하지 않았습니다. KOBIS HTTPS 주소의 잘못된 키 응답(`faultInfo`)은 직접 확인했습니다.

출처: [KOBIS 공식 주간·주말 API 안내](https://www.kobis.or.kr/kobisopenapi/homepg/apiservice/searchServiceInfo.do?serviceId=searchWeeklyBoxOffice).
