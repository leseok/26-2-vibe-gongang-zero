import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createContext, runInContext} from "node:vm";

// 실제 프론트 스크립트를 실행하며 요청과 상태 영역을 테스트합니다.
function mount(eventReplies) {
  class Element {
    constructor(value = "") {
      this.value = value;
      this.children = [];
      this.dataset = {};
      this.handlers = {};
    }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    setAttribute() {}
    setCustomValidity() {}
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    add() {}
    focus() {}
    scrollIntoView() {}
    querySelector() { return new Element(); }
    get text() { return [this.textContent, ...this.children.map(child => child.text)].filter(Boolean).join(" "); }
  }
  const elements = new Map([["start", new Element("12:00")], ["end", new Element("14:00")]]);
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const requests = [];
  const context = createContext({
    AbortSignal, URL, URLSearchParams, Option: Element, window: {},
    location: {protocol: "https:"}, localStorage: {getItem: () => null},
    document: {getElementById: element, createElement: () => new Element(), querySelector: element, querySelectorAll: () => []},
    async fetch(path) {
      if (path === "api/movies") return Response.json({mode: "unconfigured", items: []});
      const query = Object.fromEntries(new URL(path, "https://example.com").searchParams);
      requests.push({query, notice: element("messages").text});
      return eventReplies.shift();
    }
  });
  for (const file of ["data.js", "script.js"]) {
    runInContext(readFileSync(new URL("../public/" + file, import.meta.url), "utf8"), context);
  }
  return {requests, element};
}

test("공강 시간을 보내고 주변 정상 0건에만 서울로 확대해 카드를 표시한다", async () => {
  const {requests, element} = mount([
    Response.json({status: "empty", canExpand: true, items: []}),
    Response.json({status: "ok", items: [{
      id: "52", title: "테스트 전시", activityType: "exhibit", venue: "전시장", district: "종로구",
      detailUrl: "https://example.com/event",
      schedule: {mode: "open", startTime: "10:00", endTime: "16:00",
        availableStartTime: "12:00", availableEndTime: "14:00"}
    }]}),
    Response.json({status: "ok", items: []})
  ]);
  await new Promise(setImmediate);
  assert.deepEqual(requests.map(({query}) => query.scope), ["nearby", "seoul"]);
  assert.equal(requests[0].query.startTime, "12:00");
  assert.equal(requests[1].query.endTime, "14:00");
  assert.match(requests[1].notice, /서울 전체에서 찾고 있어요/);
  assert.match(element("cards").text, /테스트 전시.*방문 가능 12:00–14:00/);
  element("end").value = "13:15";
  element("finder").handlers.submit({preventDefault() {}});
  await new Promise(setImmediate);
  assert.equal(requests[2].query.endTime, "13:15");
  assert.equal(requests[2].query.scope, "nearby");
});

test("호출 제한을 빈 결과로 처리하지 않고 재시도를 안내한다", async () => {
  const {requests, element} = mount([
    Response.json({status: "error", issues: ["TOUR_API_LIMIT"]}, {status: 503})
  ]);
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  assert.match(element("messages").text, /조회 한도.*다시 조회/);
});
