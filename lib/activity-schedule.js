const KOREA_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
});
const WEEKDAYS = "일월화수목금토";
const CLOCK = "(?:[01]?\\d|2[0-4]):[0-5]\\d";
const RANGE = new RegExp("(?<![\\d:])(" + CLOCK + ")\\s*(?:~|∼|～|[-–—])\\s*(" + CLOCK + ")(?![\\d:])", "g");

// 사용자 입력과 TourAPI의 날짜를 실제 달력 기준으로 검증합니다.
function calendarDate(value) {
  const date = String(value ?? "").trim().replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(date + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return date;
}

function todayInKorea(now = new Date()) {
  const parts = Object.fromEntries(KOREA_DATE.formatToParts(now).map(({ type, value }) => [type, value]));
  return [parts.year, parts.month, parts.day].join("-");
}

// 공강 입력의 시각은 시·분 단위이고, 운영시간 끝에만 자정(24:00)을 허용합니다.
function minutesOf(value, allowMidnight = false) {
  if (allowMidnight && value === "24:00") return 1440;
  const parts = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value || "");
  return parts ? Number(parts[1]) * 60 + Number(parts[2]) : null;
}

function clockOf(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" +
    String(minutes % 60).padStart(2, "0");
}

// TourAPI는 일부 텍스트에 HTML을 포함하므로 화면에 전달할 값은 텍스트로 정리합니다.
function plain(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").trim();
}

function officialUrl(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(value)?.[1] ?? value;
    try {
      const url = new URL(href.trim().replace(/&amp;/gi, "&"));
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch {
      // 다음 공식 출처 필드를 확인합니다.
    }
  }
  return null;
}

// 운영 요일 제목을 해석합니다. 같은 시간표에서 요일을 알 수 없는 구간은 사용하지 않습니다.
function daySelector(label, date) {
  // 날짜가 붙은 회차는 해당 날짜에만 적용합니다.
  const explicit = /^(?:(\d{4})[.-])?(\d{1,2})[.-](\d{1,2})\.?\s*(?:\([일월화수목금토](?:요일)?\))?$/.exec(label);
  if (explicit) {
    const [, year, month, dayOfMonth] = explicit;
    const checkDate = [year || date.slice(0, 4), month.padStart(2, "0"), dayOfMonth.padStart(2, "0")].join("-");
    return checkDate === date ? "match" : "other";
  }

  let value = label.replace(/[()［］[\]【】:\s]/g, "");
  value = value.replace(/^(?:공연시간|관람시간|운영시간|개관시간|이용시간|공연|관람|운영|개관|이용)/, "");
  if (!value) return "unspecified";
  if (/^(?:매일|매일운영|연중무휴|상시)$/.test(value)) return "match";

  const day = new Date(date + "T00:00:00Z").getUTCDay();
  if (/^평일$/.test(value)) return day >= 1 && day <= 5 ? "match" : "other";
  if (/^주말$/.test(value)) return day === 0 || day === 6 ? "match" : "other";
  value = value.replace(/요일/g, "");
  const span = /^([일월화수목금토])(?:~|∼|～|[-–—])([일월화수목금토])$/.exec(value);
  if (span) {
    const first = WEEKDAYS.indexOf(span[1]);
    const length = (WEEKDAYS.indexOf(span[2]) - first + 7) % 7;
    return (day - first + 7) % 7 <= length ? "match" : "other";
  }
  if (/^[일월화수목금토](?:[·,ㆍ및][일월화수목금토])*$/.test(value)) {
    return value.includes(WEEKDAYS[day]) ? "match" : "other";
  }
  return "unknown";
}

// 휴관일은 정기 요일과 연중무휴만 해석합니다. 공휴일·임시 휴관은 실제 날짜 확인이 필요합니다.
function venueIsOpen(rest, hours, date) {
  const status = rest.replace(/\s/g, "").replace(/(?:휴관|휴무|휴장)(?:일)?$/g, "");
  if (/임시|공휴일|명절|설날|추석|별도|변동|취소/.test(rest + hours) || /휴관|휴무|휴장|미운영|제외/.test(hours)) return false;
  if (/^(?:연중무휴|(?:휴관|휴무|휴장)?(?:일)?없음|매일운영|상시개방)$/.test(status)) return true;
  if (!rest) return /매일|연중\s*무휴/.test(hours);
  return daySelector(status.replace(/^매주/, ""), date) === "other";
}

// 명시된 시각 범위만 사용합니다. 다일 행사는 검색일의 요일이나 매일 운영이 명시되어야 합니다.
function operatingRanges(text, date, { allowUnspecified, fixed }) {
  const ranges = [];
  for (const line of text.split(/[\n;/]+/)) {
    let position = 0;
    for (const range of line.matchAll(RANGE)) {
      const label = line.slice(position, range.index).replace(/^[\s,·]+/, "").trim();
      position = range.index + range[0].length;
      const start = minutesOf(range[1]);
      const end = minutesOf(range[2], true);
      if (start === null || end === null || start >= end) continue;
      const selector = daySelector(label, date);
      if (selector === "match" || (selector === "unspecified" && allowUnspecified)) {
        ranges.push({ start, end, fixed });
      }
    }
  }
  return ranges;
}

// 시설이 공지한 휴게시간을 운영 구간에서 뺍니다.
function subtractBreaks(ranges, breaks) {
  for (const pause of breaks) {
    ranges = ranges.flatMap((range) => {
      if (pause.end <= range.start || pause.start >= range.end) return [range];
      return [
        { ...range, end: Math.min(pause.start, range.end) },
        { ...range, start: Math.max(pause.end, range.start) },
      ].filter(({ start, end }) => start < end);
    });
  }
  return ranges;
}

function eventDates(row) {
  const start = calendarDate(row.eventstartdate);
  const end = calendarDate(row.eventenddate || row.eventstartdate);
  return start && end && start <= end ? { start, end } : null;
}

// 행사 회차와 시설 운영시간을 같은 날짜의 분 단위 구간으로 정규화합니다.
function scheduleFor(row, intro, type, date) {
  const combined = plain(type === "15" ? intro.playtime :
    type === "28" ? intro.usetimeleports : intro.usetimeculture);
  if (!combined || /취소|변동|미정|자세한|별도\s*문의|시간\s*상이|동절기|하절기/.test(combined)) return [];

  const restrictions = combined
    .replace(/[([]?\s*(?:마지막\s*입장|입장\s*마감)\s*[:：]?\s*([0-9]{1,2}:[0-9]{2})\s*[)\]]?/g,
      (whole, value) => "\n입장마감 " + value)
    .split("\n");
  const admission = restrictions.find((line) => /^\s*입장마감/.test(line));
  const lastAdmission = admission ? minutesOf(admission.replace(/^\s*입장마감\s*/, "").trim()) : null;
  if ((/마지막\s*입장|입장\s*마감/.test(combined) && lastAdmission === null) ||
      /입장\s*마감[^0-9\n]*\d+\s*분\s*전/.test(combined)) return [];

  const pauseTime = [];
  const workingHours = [];
  for (const line of restrictions.filter((value) => value !== admission)) {
    const match = /(?:휴게\s*시간|점심\s*시간|브레이크\s*타임)\s*[:：]?\s*([^)\]\n]+)/i.exec(line);
    if (match) {
      const ranges = operatingRanges(match[1], date, { allowUnspecified: true, fixed: false });
      if (ranges.length === 0) return [];
      pauseTime.push(...ranges);
      workingHours.push(line.slice(0, match.index).replace(/[\s/(]+$/, ""));
    } else {
      workingHours.push(line);
    }
  }

  const hours = workingHours.join("\n").trim();
  let fixed = false;
  let allowUnspecified = true;
  if (type === "15") {
    const dates = eventDates({
      eventstartdate: intro.eventstartdate || row.eventstartdate,
      eventenddate: intro.eventenddate || row.eventenddate,
    });
    if (!dates || date < dates.start || date > dates.end ||
        /임시|공휴일|명절|휴관|휴무|휴장/.test(combined)) return [];
    fixed = !/관람\s*시간|운영\s*시간|자유\s*관람/.test(hours);
    allowUnspecified = dates.start === dates.end;
  } else {
    const rest = plain(type === "28" ? intro.restdateleports : intro.restdateculture);
    if (!venueIsOpen(rest, hours, date)) return [];
    const season = plain(type === "28" ? intro.openperiod : "");
    if (season && !/^(?:연중|연중무휴|상시|연중 운영)$/.test(season)) return [];
  }

  const minStay = Math.max(1, Number(/최소\s*(\d+)\s*분/.exec(combined)?.[1] ?? 1));
  const ranges = operatingRanges(hours, date, { allowUnspecified, fixed });
  const available = fixed && pauseTime.length ? [] : subtractBreaks(ranges, pauseTime);
  return available.map((range) => ({ ...range, lastAdmission, minStay }));
}

// 회차 전체가 공강에 들어오거나, 자유 방문 시간이 한 분 이상 겹치는 경우만 반환합니다.
function matchSchedule(ranges, startTime, endTime) {
  const result = [];
  for (const range of ranges) {
    if (range.fixed && (range.start < startTime || range.end > endTime)) continue;
    const start = Math.max(range.start, startTime);
    const end = Math.min(range.end, endTime);
    if (end - start < range.minStay || (range.lastAdmission !== null && start > range.lastAdmission)) continue;
    result.push({
      mode: range.fixed ? "fixed" : "open",
      startTime: clockOf(range.start),
      endTime: clockOf(range.end),
      availableStartTime: clockOf(start),
      availableEndTime: clockOf(end),
    });
  }
  return result;
}

export {
  calendarDate, todayInKorea, minutesOf, plain, officialUrl, eventDates, scheduleFor, matchSchedule,
};
