# 용산 CGV API 연동

순수 HTML/JavaScript 웹에서 기존 Cloudflare API를 바로 사용할 수 있는 클라이언트입니다.

- `client.js`: 브라우저 ES 모듈, 비밀 키·npm 설치·번들링 없이 사용
- `example.html`: 날짜·시간·상영관 조회 및 로딩/빈 결과/오류 표시 예제
- `worker/`: 실제 배포된 Cloudflare Workers API의 소스·설정·의존성 잠금 파일·테스트
- `../kobis/KOBIS_주간주말_박스오피스_API.md`: 별도로 보관한 KOBIS 사용 가이드

## 기존 웹에서 사용

프로젝트 루트의 HTML에서 다음처럼 불러옵니다. 응답의 전체 필드와 심야 시간 규칙은 [Worker 설명서](worker/README.md)를 참고하세요.

```html
<p id="movie-status"></p>
<script type="module">
  // 현재 웹 파일 위치에 맞춰 client.js의 상대 경로를 지정합니다.
  import { getYongsanShowtimes } from './integrations/cgv-yongsan/client.js';

  // 영화명·시간·상영관 필터를 선택적으로 전달합니다. 날짜 생략 시 한국 오늘입니다.
  try {
    const data = await getYongsanShowtimes({ from: '18:00', to: '24:00', screen: 'IMAX' });
    document.querySelector('#movie-status').textContent = `${data.total}회 상영`;
    console.log(data.showtimes);
  } catch (error) {
    document.querySelector('#movie-status').textContent = `조회 실패: ${error.message}`;
  }
</script>
```

자체 배포 주소를 사용할 때는 두 번째 인자로 `{ endpoint: 'https://본인주소/api/showtimes' }`를 전달합니다. 요청 취소가 필요하면 `{ signal: abortController.signal }`을 전달합니다.

## 브라우저에서 확인

저장소 루트에서 실행합니다.

```sh
python3 -m http.server 8000
```

http://localhost:8000/integrations/cgv-yongsan/example.html 에서 날짜와 시간을 고른 뒤 `조회`를 누릅니다. 결과가 있으면 영화명·시간·상영관·잔여석이 표시되고, 미편성 날짜는 빈 결과가 표시됩니다. 오프라인에서는 조회 실패 안내가 표시됩니다. 심야 회차를 직접 요청할 때는 `from: '24:00', to: '27:00'`처럼 지정할 수 있습니다.

## 테스트와 Worker 관리

```sh
# 브라우저 클라이언트 테스트: 의존성 설치 불필요
npm --prefix integrations/cgv-yongsan test

# Worker 테스트: 브라우저 바인딩을 띄우지 않고 입력/정규화/오류 검증
npm --prefix integrations/cgv-yongsan/worker ci
npm --prefix integrations/cgv-yongsan/worker test
npm --prefix integrations/cgv-yongsan/worker run check
```

Worker 재배포는 `worker/`에서 `npm run deploy`로 실행합니다. 현재 운영 주소는 `https://cgv-yongsan-showtimes.jw4570g.workers.dev`입니다. 재배포할 계정과 Worker 이름을 먼저 확인하세요. Cloudflare 브라우저 실행 사용량은 해당 계정에 반영됩니다.

프로젝트의 기본 Vercel 백엔드와 별개로 배포된 영화 데이터 서비스입니다. 이번 변경은 클라이언트와 서비스 소스를 보관하며 루트 앱 화면은 추가하지 않습니다. 상영 요금은 API에 없으므로 `가격 미확인`으로 처리하며 무료 영화로 분류하지 마세요.
