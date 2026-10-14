import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Coverage, CoverageWarning, NotSeen } from "@/components/result/Coverage";
import { FindingSummary } from "@/components/result/FindingSummary";
import { ReportSummary } from "@/components/result/ReportSummary";
import { StatusChip } from "@/components/result/StatusChip";
import { ResultBoundary } from "@/components/viewer/ResultBoundary";
import { packMeta } from "@/lib/pack";
import { coverageSummary, GAPS_NOTE, GAPS_TITLE, GAPS_UNLISTED } from "@/lib/report/coverage";
import { parseReport } from "@/lib/report/parse";
import { STATUS_HINT, STATUS_LABEL, type Status } from "@/lib/report/status";
import type { Report } from "@/lib/report/types";
import { buildReportView, type ReportView } from "@/lib/report/view-model";
import { SITE } from "@/lib/site";
import { elementAt, elementsOf, jsonFiles, readJson, textOf } from "./helpers";
import { BANNED_WORDING } from "./wording";

// 결과 화면의 부품 가운데 지금까지 결과 화면 전체(`ReportSummary`)를 그려서만 보던 것을 따로 그려 본다(ROADMAP 8번):
// 상태 칩, 발견 줄의 머리, 커버리지 보기(맨 위 경고, 표, 이 도구가 보지 못하는 것), 뷰어의 오류 경계.
// 결과 화면 안에서 무엇이 어디에 놓이는지는 tests/render.test.tsx 가 본다. 여기서는 부품 하나가 그리는 것 전부를 본다.
// 브라우저에서만 드러나는 것(누르기, 좁은 화면, 접근성 트리)은 tests/browser/view.test.ts 가 본다.

function viewOf(data: unknown): ReportView {
  const parsed = parseReport(data);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return buildReportView(parsed.report, parsed.contract, packMeta);
}

const every = [
  ...jsonFiles("contract", "cli-current").map((name) => ["contract", "cli-current", name]),
  ...jsonFiles("contract", "samples-v1-draft").map((name) => ["contract", "samples-v1-draft", name]),
  ...jsonFiles("tests", "fixtures").map((name) => ["tests", "fixtures", name]),
];
const named = every.map((parts) => [parts.join("/"), parts] as const);
const incomplete = () => readJson("tests", "fixtures", "incomplete-coverage.json") as Report;

describe("상태 칩 (StatusChip)", () => {
  const statuses = Object.keys(STATUS_LABEL) as Status[];

  it("상태마다 정해 둔 이름을 적고, 마우스를 올리면 그 상태의 뜻이 뜬다. 다른 글이나 요소는 없다", () => {
    expect(statuses.length).toBeGreaterThanOrEqual(7);
    for (const status of statuses) {
      const html = renderToStaticMarkup(<StatusChip status={status} />);
      // 칩 하나뿐이다. 상태마다 꾸밈의 이름(class)이 다르고, 뜻은 title 에 있다.
      expect(elementAt(html, 0), status).toBe(html);
      expect(/^<span class="([^"]*)" title="([^"]*)">([^<]*)<\/span>$/.exec(html)?.slice(1), status).toEqual([
        `chip chip-${status}`,
        expect.any(String),
        expect.any(String),
      ]);
      expect(textOf(/ title="([^"]*)"/.exec(html)![1]), status).toBe(STATUS_HINT[status]);
      expect(textOf(html), status).toBe(STATUS_LABEL[status]);
    }
  });

  it("뜻을 따로 주면(정책 카드 밖의 풀이) 그 말이 뜬다. 칩의 이름은 그대로다", () => {
    const hint = "두 결과의 표에 적는 뜻.";
    const html = renderToStaticMarkup(<StatusChip status="uncertain" hint={hint} />);
    expect(textOf(/ title="([^"]*)"/.exec(html)![1])).toBe(hint);
    expect(textOf(html)).toBe(STATUS_LABEL.uncertain);
  });

  it("칩의 이름과 뜻에 단정하는 말, 점수·등급이 없다", () => {
    for (const status of statuses) {
      const text = `${STATUS_LABEL[status]} ${STATUS_HINT[status]}`;
      for (const [pattern, why] of BANNED_WORDING) expect(pattern.test(text), `${status}: ${pattern} — ${why}`).toBe(false);
    }
  });
});

describe("발견 줄의 머리 (FindingSummary)", () => {
  it("줄 전체가 펼침 단추(summary) 하나다. 받은 것만 그 안에 그리고, 글·속성·감싸는 요소를 더하지 않는다", () => {
    // 펼침 단추가 아닌 것(div 등)으로 바꾸거나 role·tabindex 를 붙이면, 키보드와 화면 낭독기에서 details 의 단추로
    // 읽히지 않는다. 누르는 것이 어떻게 듣는지(끌어 고르기, Enter·Space)는 브라우저 시험이 본다.
    const html = renderToStaticMarkup(
      <details>
        <FindingSummary>
          <span className="finding-head">
            <code>src/a.ts:3</code> <span className="finding-scope">파일 전체 판정</span>
          </span>
        </FindingSummary>
      </details>,
    );
    expect(html).toBe(
      '<details><summary><span class="finding-head"><code>src/a.ts:3</code> <span class="finding-scope">파일 전체 판정</span></span></summary></details>',
    );
  });

  it("결과 화면의 발견 줄마다 그 머리가 details 의 첫 자식이다", () => {
    const html = renderToStaticMarkup(<ReportSummary view={viewOf(readJson("tests", "fixtures", "repeated-rule.json"))} />);
    const rows = elementsOf(html, '<li class="finding">');
    expect(rows).toHaveLength(25);
    for (const row of rows) expect(row).toMatch(/^<li class="finding"><details(?: open="")?><summary><span class="finding-head">/);
  });
});

describe("커버리지 보기 (Coverage, CoverageWarning, NotSeen)", () => {
  const render = (data: unknown) => {
    const view = viewOf(data);
    return { view, summary: coverageSummary(view), html: renderToStaticMarkup(<Coverage view={view} summary={coverageSummary(view)} />) };
  };

  it.each(named)("%s: 결과 화면 안에 그린 것과 같다", (_name, parts) => {
    // 커버리지 보기는 결과 화면이 그대로 싣는다. 결과 화면이 그 둘레에 무엇을 더하거나 빼지 않았는지 본다.
    const { view, html } = render(readJson(...parts));
    expect(renderToStaticMarkup(<ReportSummary view={view} />)).toContain(html);
  });

  it("표의 모든 부분에 표의 role 이 붙어 있다 (좁은 화면에서 CSS 가 display 를 바꿔도 표로 읽히게)", () => {
    // 좁은 화면에서는 표·줄·칸의 display 를 block·grid 로 바꾼다. 그러면 표의 뜻을 버리는 브라우저가 있어 role 을 직접 적어
    // 둔다. Chrome 155 는 role 을 모두 걷어 내도 쌓은 표를 표로 드러내서(8번에서 사본으로 걷어 봤다), 브라우저 시험(Chrome 의
    // 접근성 트리를 읽는 tests/browser/view.test.ts 의 "다 보지 못한 것")은 role 이 빠져도 통과한다. 붙어 있는지는 여기서 본다.
    const { html } = render({ ...incomplete(), run: { ...incomplete().run, engine_errors: ["[Timeout] a"] } });
    const table = elementAt(html, html.indexOf("<table"));
    const tags = [...table.matchAll(/<(table|thead|tbody|tr|th|td)\b([^>]*)>/g)].map(([, tag, attributes]) => ({ tag, attributes }));
    const ROLE = { table: "table", thead: "rowgroup", tbody: "rowgroup", tr: "row", td: "cell" } as const;
    for (const { tag, attributes } of tags) {
      const role = / role="([^"]*)"/.exec(attributes)?.[1];
      if (tag === "th") expect(role, attributes).toBe(/ scope="col"/.test(attributes) ? "columnheader" : "rowheader");
      else expect(role, `${tag}${attributes}`).toBe(ROLE[tag as keyof typeof ROLE]);
    }
    // 머리 한 줄과 목록 넷(엔진 오류가 있어 넷째 줄이 있다).
    expect(tags.filter(({ tag }) => tag === "tr")).toHaveLength(5);
    // 칸 머리는 화면에서만 가린다(화면 낭독기에는 읽힌다). 표의 이름은 제목과 그 옆의 말이다.
    expect(table).toContain('<thead class="visually-hidden" role="rowgroup">');
    expect(textOf(elementAt(table, table.indexOf("<caption")))).toBe(`${GAPS_TITLE} ${GAPS_NOTE}`);
  });

  it("든 것이 없는 줄은 이름과 '없음'만 적고 뜻과 파일의 칸을 비운다. 셋 다 없으면 표를 촘촘히 적는다", () => {
    const complete = render(readJson("contract", "cli-current", "kids-signup.main.json"));
    expect(complete.html).toContain('<table class="gaps gaps-none" role="table">');
    const rows = elementsOf(complete.html, '<tr class="gap" role="row">');
    expect(rows.map((row) => textOf(elementAt(row, row.indexOf("<th"))))).toEqual(["검사하지 않은 파일", "일부를 읽지 못한 파일", "엔진이 끝내지 못한 파일"]);
    for (const row of rows) {
      expect(textOf(elementAt(row, row.indexOf('<td class="gap-count"')))).toBe("없음");
      expect(elementAt(row, row.indexOf('<td class="gap-detail"'))).toBe('<td class="gap-detail" role="cell"></td>');
    }
    // 든 것이 있는 줄은 표시가 다르고(경고 색), 뜻이 붙는다.
    const partial = render(incomplete());
    expect(partial.html).toContain('<table class="gaps" role="table">');
    expect(elementsOf(partial.html, '<tr class="gap gap-on" role="row">')).toHaveLength(3);
  });

  it("맨 위 경고(CoverageWarning): 경고할 것이 없으면 아무것도 그리지 않고, 있으면 굵은 첫 문장 뒤에 나머지를 잇는다", () => {
    const quiet = viewOf(readJson("contract", "cli-current", "kids-signup.main.json"));
    expect(renderToStaticMarkup(<CoverageWarning summary={coverageSummary(quiet)} />)).toBe("");
    const summary = coverageSummary(viewOf(incomplete()));
    expect(summary.warning).not.toBeNull();
    const html = renderToStaticMarkup(<CoverageWarning summary={summary} />);
    expect(html.startsWith('<p class="notice notice-warn coverage-warning"><strong>')).toBe(true);
    expect(textOf(elementAt(html, html.indexOf("<strong>")))).toBe(summary.warning!.lead);
    expect(textOf(html)).toBe(`${summary.warning!.lead} ${summary.warning!.detail}`);
    // 첫 문장만 있는 경고에는 뒤에 빈칸을 붙이지 않는다.
    const leadOnly = renderToStaticMarkup(<CoverageWarning summary={{ ...summary, warning: { lead: "다 보지 못한 검사입니다.", detail: null } }} />);
    expect(textOf(leadOnly)).toBe("다 보지 못한 검사입니다.");
  });

  it("이 도구가 보지 못하는 것(NotSeen): 목록은 늘 같고 첫 문단만 발견 수에 따라 다르다. 다른 판의 팩이면 대상 언어를 알 수 없다고 덧붙인다", () => {
    const withFindings = viewOf(incomplete());
    const empty = viewOf(readJson("contract", "cli-current", "plain.main.json"));
    const lists = [withFindings, empty].map((view) => {
      const html = renderToStaticMarkup(<NotSeen view={view} />);
      return { lead: textOf(elementAt(html, 0)), list: elementAt(html, html.indexOf('<ul class="not-seen">')), html };
    });
    expect(lists.map((entry) => entry.lead)).toEqual([SITE.notSeen.leadWithFindings, SITE.notSeen.lead]);
    expect(lists[0].list).toBe(lists[1].list);
    // 항목마다 무엇과 왜. 까닭이 여럿인 항목은 한 줄씩 나눠 적는다.
    const items = elementsOf(lists[0].list.slice(1), "<li>").filter((item) => item.startsWith("<li><strong>"));
    expect(items).toHaveLength(SITE.notSeen.items.length);
    for (const [i, item] of SITE.notSeen.items.entries()) {
      expect(textOf(elementAt(items[i], items[i].indexOf("<strong>")))).toBe(`${item.what}:`);
      expect(elementsOf(items[i], '<ul class="not-seen-cases">')).toHaveLength(item.cases ? 1 : 0);
    }
    // 같은 판의 팩이면 덧붙이지 않는다.
    expect(lists.every((entry) => !entry.html.includes(SITE.notSeen.otherPack))).toBe(true);
    const other = viewOf({ ...incomplete(), run: { ...incomplete().run, pack_digest: "0123456789abcdef" } });
    expect(other.packMatches).toBe(false);
    const html = renderToStaticMarkup(<NotSeen view={other} />);
    expect(textOf(html.slice(html.lastIndexOf("<p")))).toBe(SITE.notSeen.otherPack);
  });

  it("발견이 있는 결과에만 표 아래에 접어 둔다. 접혀 있어도 이름 옆에 무엇이 들었는지 보인다", () => {
    const { html } = render(incomplete());
    const fold = elementAt(html, html.indexOf('<details class="fold"><summary>이 도구가'));
    expect(fold.startsWith('<details class="fold"><summary>')).toBe(true);
    expect(textOf(elementAt(fold, fold.indexOf("<summary>")))).toBe(`${SITE.notSeen.title} ${GAPS_UNLISTED}`);
    expect(render(readJson("contract", "cli-current", "plain.main.json")).html).not.toContain(SITE.notSeen.title);
  });
});

describe("뷰어의 오류 경계 (ResultBoundary)", () => {
  const ALERT = "이 결과를 그리지 못했습니다. 파일 모양이 이 뷰어가 아는 것과 다릅니다. 다른 파일을 열어 보세요.";

  it("그릴 수 있는 결과는 아무것도 덧붙이지 않고 그대로 그린다", () => {
    const child = <ReportSummary view={viewOf(incomplete())} />;
    expect(renderToStaticMarkup(<ResultBoundary>{child}</ResultBoundary>)).toBe(renderToStaticMarkup(child));
  });

  it("그리다 실패하면 결과 대신 안내(role=alert)를 그리고, 실패했다고 뷰어에 알린다", () => {
    // 오류 경계는 브라우저에서만 듣는다. 서버에서 그리는 길(부품 시험이 쓰는 renderToStaticMarkup)은 오류 경계를 거치지
    // 않고 오류를 그대로 던진다(아래 대조). 그래서 경계가 하는 일을 둘로 나눠 본다: 오류를 받으면 실패한 상태가 되고,
    // 실패한 상태에서는 결과 대신 안내를 그리며 뷰어에 알린다. 그리다 던지는 결과를 실제로 넣어 보는 것은 브라우저 시험이다
    // (tests/browser/view.test.ts 의 "결과로 읽었지만 그리지 못한 파일에는 열었다고 알리지 않는다").
    function Throws(): never {
      throw new Error("글이어야 할 자리에 객체가 있습니다.");
    }
    expect(() => renderToStaticMarkup(<ResultBoundary><Throws /></ResultBoundary>)).toThrow("글이어야 할 자리에 객체가 있습니다.");
    expect(ResultBoundary.getDerivedStateFromError()).toEqual({ failed: true });

    /** 오류를 받은 뒤의 경계. 상태만 실패로 시작한다. 그리는 것은 경계의 render 그대로다. */
    class Failed extends ResultBoundary {
      state = ResultBoundary.getDerivedStateFromError();
    }
    const html = renderToStaticMarkup(
      <Failed>
        <Throws />
      </Failed>,
    );
    expect(html).toBe(`<div class="notice notice-warn" role="alert"><p>${ALERT}</p></div>`);

    const onFailed = vi.fn();
    new ResultBoundary({ children: null, onFailed }).componentDidCatch();
    expect(onFailed).toHaveBeenCalledTimes(1);
    // 알릴 곳이 없어도 실패하지 않는다.
    expect(() => new ResultBoundary({ children: null }).componentDidCatch()).not.toThrow();
  });
});
