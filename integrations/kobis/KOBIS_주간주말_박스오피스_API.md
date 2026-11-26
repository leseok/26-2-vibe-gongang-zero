# KOBIS 주간/주말 박스오피스 API 사용 가이드

## 1. 개요

특정 날짜가 속한 주차의 주간·주말·주중 박스오피스 정보를 조회합니다. 다양성/상업영화, 한국/외국영화, 상영지역으로 필터링할 수 있습니다.

- 제공: 영화진흥위원회 영화관입장권통합전산망(KOBIS)
- 방식: REST 또는 SOAP
- REST 응답 형식: JSON 또는 XML
- [공식 문서](https://www.kobis.or.kr/kobisopenapi/homepg/apiservice/searchServiceInfo.do?serviceId=searchWeeklyBoxOffice)

## 2. REST 요청

- HTTP 메서드: `GET`
- JSON URL: `http://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json`
- XML URL: `http://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.xml`

> 위 주소는 공식 문서에 기재된 HTTP 주소입니다. 실제 호출 테스트는 수행하지 않았습니다.

### 요청 변수

모든 요청 변수의 자료형은 문자열입니다.

| 변수 | 필수 | 설명 | 기본값 / 허용값 |
| --- | --- | --- | --- |
| `key` | 필수 | 발급받은 API 키 | 본인 키 사용 |
| `targetDt` | 필수 | 조회할 날짜 | `yyyyMMdd`, 예: `20120101` |
| `weekGb` | 선택 | 조회 기간 구분 | `0`: 주간(월~일), `1`: 주말(금~일, 기본값), `2`: 주중(월~목) |
| `itemPerPage` | 선택 | 결과 개수 | 기본값 `10`, 최대 `10` |
| `multiMovieYn` | 선택 | 영화 구분 | `Y`: 다양성영화, `N`: 상업영화, 미지정 시 전체 |
| `repNationCd` | 선택 | 한국/외국영화 구분 | `K`: 한국영화, `F`: 외국영화, 미지정 시 전체 |
| `wideAreaCd` | 선택 | 상영지역 코드 | 공통코드 조회 서비스에서 `0105000000`으로 조회한 지역 코드, 미지정 시 전체 |

### 호출 예시

`YOUR_API_KEY`를 발급받은 키로 바꿉니다.

```bash
# 해당 날짜가 속한 주차의 주간 박스오피스 조회
curl --get \
  "http://www.kobis.or.kr/kobisopenapi/webservice/rest/boxoffice/searchWeeklyBoxOfficeList.json" \
  --data-urlencode "key=YOUR_API_KEY" \
  --data-urlencode "targetDt=20120101" \
  --data-urlencode "weekGb=0" \
  --data-urlencode "itemPerPage=10"
```

- 주말 조회: `weekGb=1` 또는 해당 변수 생략
- 주중 조회: `weekGb=2`
- 한국영화만 조회: `repNationCd=K` 추가
- 다양성영화만 조회: `multiMovieYn=Y` 추가
- XML 응답: URL 끝의 `.json`을 `.xml`로 변경

## 3. 응답 필드

공식 문서에 기재된 모든 응답 필드의 자료형은 **문자열**입니다. 숫자 계산이 필요하면 수신 후 숫자형으로 변환합니다.

### 조회 정보

| 필드 | 설명 |
| --- | --- |
| `boxofficeType` | 박스오피스 종류 |
| `showRange` | 대상 상영기간 |
| `yearWeekTime` | 조회일자에 해당하는 연도와 주차(`YYYYIW`) |

### 영화별 정보

| 필드 | 공식 문서 기준 설명 |
| --- | --- |
| `rnum` | 순번 |
| `rank` | 해당일자의 박스오피스 순위 |
| `rankInten` | 전일 대비 순위 증감분 |
| `rankOldAndNew` | 순위 신규 진입 여부: `OLD` 기존, `NEW` 신규 |
| `movieCd` | 영화 대표코드 |
| `movieNm` | 영화명(국문) |
| `openDt` | 개봉일 |
| `salesAmt` | 해당일 매출액 |
| `salesShare` | 해당일자 상영작 전체 매출 대비 해당 영화 매출 비율 |
| `salesInten` | 전일 대비 매출액 증감분 |
| `salesChange` | 전일 대비 매출액 증감 비율 |
| `salesAcc` | 누적 매출액 |
| `audiCnt` | 해당일 관객 수 |
| `audiInten` | 전일 대비 관객 수 증감분 |
| `audiChange` | 전일 대비 관객 수 증감 비율 |
| `audiAcc` | 누적 관객 수 |
| `scrnCnt` | 해당일자에 상영한 스크린 수 |
| `showCnt` | 해당일자에 상영된 횟수 |

> 주의: 주간/주말 API 페이지지만 일부 필드 설명에는 “해당일”, “전일 대비”라는 표현이 사용되어 있습니다. 위 표는 문서 표현을 유지했으며, 증감 비교 기준을 임의로 전주 대비로 해석하지 않았습니다. 실제 집계 기간은 `showRange`를 확인하세요.

## 4. SOAP 요청

| 항목 | 값 |
| --- | --- |
| 요청 URL | `http://www.kobis.or.kr/kobisopenapi/webservice/soap/boxoffice` |
| WSDL | `http://www.kobis.or.kr/kobisopenapi/webservice/soap/boxoffice?wsdl` |
| Operation | `searchWeeklyBoxOfficeList` |

## 5. 사용 시 확인할 점

- `targetDt`는 특정 하루의 결과가 아니라 **그 날짜가 속한 주차**를 지정합니다.
- 주간 결과가 필요하면 `weekGb=0`을 명시합니다. 생략하면 주말 결과입니다.
- 결과는 최대 10개입니다. 현재 페이지에는 페이지 번호 변수가 안내되어 있지 않습니다.
- 문서에 노출된 예시 키 대신 본인에게 발급된 키를 사용합니다.
- 현재 페이지에는 호출 제한, 오류 코드, 실제 JSON 중첩 구조가 상세히 제시되어 있지 않아 이 문서에 임의로 추가하지 않았습니다.

---
정리 기준: 공식 주간/주말 박스오피스 API 페이지, 2026-11-26 확인.
