# 공강제로 · TourAPI 백엔드

숭실대학교의 공강 시간에 맞춰 동작구·관악구·서초구·영등포구·용산구·강남구의 문화행사, 문화시설, 레저시설을 추천한다. 여섯 구에서 정상적으로 조회를 마쳐 결과가 0건이면 서울 전역으로 넓힌다. [단계별 PRD](PRD.md)

## 로컬 실행

Node.js 22 이상을 사용한다. .env.local에 한국관광공사 국문 관광정보 서비스의 활용 승인을 받은 인증키를 넣는다. 공공데이터포털의 Encoding 또는 Decoding 키를 쓸 수 있다. .env.example에 변수 이름이 있다. [TourAPI 공식 명세](https://www.data.go.kr/data/15101578/openapi.do)

~~~sh
npm test
npm run dev
~~~

브라우저에서 [공강 12:00~14:00 조회](http://127.0.0.1:3000/api/events?startTime=12%3A00&endTime=14%3A00)를 열거나 다음 명령을 실행한다.

~~~sh
curl -sS 'http://127.0.0.1:3000/api/events?startTime=12:00&endTime=14:00'
~~~

키를 설정하지 않은 상태에서 유효한 요청을 보내면 HTTP 503과 TOUR_API_KEY_MISSING이 반환된다. 예를 들어 종료 시각을 12:00으로 바꾸면 입력 오류 HTTP 400이 반환된다.

## 프론트 연동

- GET /api/events는 startTime과 endTime을 HH:mm으로 받는다. date를 보내면 오늘의 한국 날짜를 YYYY-MM-DD로 보낸다. 생략 시 서버가 한국시간 날짜를 사용한다.
- scope 기본값인 auto는 주변 조회와 서울 확대를 서버에서 이어서 처리한다. 서울을 검색하는 동안 화면에서 범위 확대 안내를 보여주려면 scope=nearby로 먼저 조회하고, canExpand가 true일 때 안내를 표시한 뒤 같은 시간으로 scope=seoul을 호출한다.
- 응답의 status는 ok, empty, partial, error 중 하나이다. scope는 nearby 또는 seoul이며, 서버가 자동으로 범위를 넓혔으면 expanded가 true이다. retryScope가 있으면 기존 날짜와 시각을 유지하고 그 범위로 재요청한다.
- items에는 id, title, venue, district, address, category, date, detailUrl, schedule이 들어간다. schedule의 startTime과 endTime은 회차 혹은 운영 구간이며, availableStartTime과 availableEndTime은 공강과 겹치는 방문 가능 구간이다. 한 활동에 여러 회차가 있으면 id와 회차 시각을 조합해 카드 키로 사용할 수 있다.
- Vercel에서는 api/events.js를 서버리스 함수로 실행하고 서버 환경 변수에 TOUR_API_KEY를 설정한다. 별도 주소에 배포된 프론트가 호출한다면 서버의 FRONTEND_ORIGIN에 프론트 주소의 오리진을 설정한다.

## 시각 데이터 적용 기준

- 행사 목록은 검색일 이전 365일 안에 시작한 행사까지 조회하고, 다일 행사도 검색일과 회차가 맞으면 포함한다. 시설은 TourAPI의 문화시설 코드 14와 레포츠 코드 28을 사용한다.
- TourAPI 목록에 회차나 운영시간이 충분하지 않으면 소개정보를 조회한다. 날짜에 적용할 수 있는 시각이나 공식 안내 링크를 확인한 활동을 카드로 반환한다. 임시 휴관이나 공휴일 예외처럼 해당 날짜의 운영 여부를 확정하기 어려운 일정은 검증된 자료가 확보될 때 후보가 된다.
