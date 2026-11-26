// 서울 지역과 유형, 취향 목록을 검색 폼과 카드에서 공통으로 사용한다.
window.GonggangZeroData = (() => {
  const districts = "강남구 강동구 강북구 강서구 관악구 광진구 구로구 금천구 노원구 도봉구 동대문구 동작구 마포구 서대문구 서초구 성동구 성북구 송파구 양천구 영등포구 용산구 은평구 종로구 중구 중랑구".split(" ");
  const moods = ["전체", "혼자 조용히", "친구와 함께", "새로운 경험", "가볍게 산책"];
  const types = {all: "전체", exhibit: "전시", show: "공연·축제", movie: "영화", other: "기타 문화"};
  // 접속 기기의 시간대와 관계없이 서울 기준 오늘을 YYYY-MM-DD로 반환한다.
  function seoulDate() {
    return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  }
  // 시:분 형식의 시간을 자정부터의 분 단위로 바꾼다.
  function minutes(value) {
    const parts = value.split(":").map(Number);
    return parts[0] * 60 + parts[1];
  }
  // 활동의 지역, 날짜, 요금, 운영시간을 검색 조건과 비교해 포함 여부를 반환한다.
  function fits(item, filters) {
    if (filters.district && item.district !== filters.district) return false;
    if (filters.budget !== null && (item.price == null || item.price > filters.budget)) return false;
    if (item.startDate > filters.date || item.endDate < filters.date) return false;
    const start = minutes(filters.start), end = minutes(filters.end);
    if (item.minutes && item.minutes > end - start) return false;
    // 복잡한 회차·요일별 운영시간은 추정하지 않고 원문을 보여준다.
    const range = /^(\d{1,2}:\d{2})\s*[~–—-]\s*(\d{1,2}:\d{2})$/.exec(item.hours || "");
    if (!range) return true;
    const from = minutes(range[1]), until = minutes(range[2]);
    if (until <= from) return true;
    if (item.fixed) return start <= from && until <= end;
    return Math.min(end, until) - Math.max(start, from) >= (item.minutes || 1);
  }
  return {districts, moods, types, seoulDate, minutes, fits};
})();
