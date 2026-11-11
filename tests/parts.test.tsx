import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CoverageWarning, GapTable, NotSeen } from "@/components/result/Coverage";
import { Citation } from "@/components/result/Citation";
import { RuleId } from "@/components/result/RuleId";
import { ReportSummary } from "@/components/result/ReportSummary";
import { StatusChip } from "@/components/result/StatusChip";
import { ResultBoundary } from "@/components/viewer/ResultBoundary";
import { packMeta } from "@/lib/pack";
import { coverageSummary, GAPS_NOTE, GAPS_TITLE } from "@/lib/report/coverage";
import { parseReport } from "@/lib/report/parse";
import { STATUS_HINT, STATUS_LABEL, type Status } from "@/lib/report/status";
import type { Report } from "@/lib/report/types";
import { buildReportView, type ReportView } from "@/lib/report/view-model";
import { SITE } from "@/lib/site";
import { closedDetailsAt, elementAt, elementsOf, jsonFiles, readJson, readPackFile, root, textOf, walk } from "./helpers";
import { readFileSync } from "node:fs";
import path from "node:path";
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

  it("상태마다 정해 둔 이름만 적는다. 뜻을 title 에 숨기지 않는다. 다른 글이나 요소는 없다", () => {
    // (D5) 칩의 title(마우스를 올리면 뜨는 뜻)을 걷었다(docs/redesign.md 2.1: title 은 터치와 키보드에서 보이지 않는다). 상태의
    // 뜻은 조문 도감의 #status 에 있고 곁칸의 `상태의 뜻` 이 잇는다.
    expect(statuses.length).toBeGreaterThanOrEqual(7);
    for (const status of statuses) {
      const html = renderToStaticMarkup(<StatusChip status={status} />);
      // 칩 하나뿐이다. 상태마다 꾸밈의 이름(class)이 다르다.
      expect(elementAt(html, 0), status).toBe(html);
      expect(html, status).toBe(`<span class="chip chip-${status}">${STATUS_LABEL[status]}</span>`);
      expect(html, status).not.toContain("title=");
    }
  });

  it("칩의 이름과 뜻에 단정하는 말, 점수·등급이 없다", () => {
    for (const status of statuses) {
      const text = `${STATUS_LABEL[status]} ${STATUS_HINT[status]}`;
      for (const [pattern, why] of BANNED_WORDING) expect(pattern.test(text), `${status}: ${pattern} — ${why}`).toBe(false);
    }
  });
});

describe("다 보지 못한 것 (CoverageWarning, GapTable, NotSeen)", () => {
  // (D5) 늘 있던 커버리지 보기(검사한 파일 수 줄 + 세 줄 표 + 접어 둔 "이 도구가 보지 못하는 것")를 걷었다. 표는 맨 위 경고 안에서만
  // 보이고(docs/redesign.md 3장), 없으면 검사 정보가 "결과에 실린 ‘다 보지 못한 파일’ 없음"을 적는다.
  const render = (data: unknown) => {
    const view = viewOf(data);
    const summary = coverageSummary(view);
    return { view, summary, html: renderToStaticMarkup(<CoverageWarning summary={summary} />), table: renderToStaticMarkup(<GapTable summary={summary} />) };
  };

  it.each(named)("%s: 결과 화면 안에 그린 것과 같다", (_name, parts) => {
    // 경고는 결과 화면이 그대로 싣는다. 결과 화면이 그 둘레에 무엇을 더하거나 빼지 않았는지 본다. 경고가 없으면 표도 없다.
    const { view, html, summary } = render(readJson(...parts));
    const page = renderToStaticMarkup(<ReportSummary view={view} />);
    if (summary.warning) {
      // (2026-11-11 오너 지시) 경고는 요약과 그 아래 옅은 줄 바로 다음이다.
      const sumline = page.indexOf('<p class="sumline">');
      expect(page.startsWith('<section class="report"><div class="headline">')).toBe(true);
      expect(page.indexOf(html)).toBe(sumline + elementAt(page, sumline).length);
    } else {
      expect(html).toBe("");
      expect(page).not.toContain("<table");
      expect(textOf(page)).toContain("결과에 실린 ‘다 보지 못한 파일’없음");
    }
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
    // 다 보지 못했다고만 실린 결과(목록이 비었다): 경고와 함께 빈 표가 보인다.
    const flagOnly = readJson("contract", "cli-current", "kids-signup.main.json") as Report;
    const complete = render({ ...flagOnly, run: { ...flagOnly.run, coverage_complete: false } });
    expect(complete.table).toContain('<table class="gaps gaps-none" role="table">');
    const rows = elementsOf(complete.table, '<tr class="gap" role="row">');
    expect(rows.map((row) => textOf(elementAt(row, row.indexOf("<th"))))).toEqual(["검사하지 않은 파일", "일부를 읽지 못한 파일", "엔진이 끝내지 못한 파일"]);
    for (const row of rows) {
      expect(textOf(elementAt(row, row.indexOf('<td class="gap-count"')))).toBe("없음");
      expect(elementAt(row, row.indexOf('<td class="gap-detail"'))).toBe('<td class="gap-detail" role="cell"></td>');
    }
    // 든 것이 있는 줄은 표시가 다르고(경고 색), 뜻이 붙는다.
    const partial = render(incomplete());
    expect(partial.table).toContain('<table class="gaps" role="table">');
    expect(elementsOf(partial.table, '<tr class="gap gap-on" role="row">')).toHaveLength(3);
  });

  it("다 보지 못했다는 경고(CoverageWarning): 경고할 것이 없으면 아무것도 그리지 않고, 있으면 접힌 머리에 굵은 첫 문장과 목록의 수를 잇고 펼치면 표다", () => {
    const quiet = viewOf(readJson("contract", "cli-current", "kids-signup.main.json"));
    expect(renderToStaticMarkup(<CoverageWarning summary={coverageSummary(quiet)} />)).toBe("");
    const summary = coverageSummary(viewOf(incomplete()));
    expect(summary.warning).not.toBeNull();
    const html = renderToStaticMarkup(<CoverageWarning summary={summary} />);
    // (2026-11-11 오너 지시) 표는 접어 둔다. 머리(첫 문장과 수)는 접혀 있어도 보인다.
    expect(html.startsWith('<details class="warn coverage-warning"><summary class="warn-hd"><strong>')).toBe(true);
    const head = elementAt(html, html.indexOf('<summary class="warn-hd"'));
    expect(textOf(elementAt(head, head.indexOf("<strong>")))).toBe(summary.warning!.lead);
    expect(textOf(head)).toBe(`${summary.warning!.lead} ${summary.warning!.counts}`);
    expect(summary.warning!.detail!.startsWith(`${summary.warning!.counts}.`)).toBe(true);
    expect(html).toContain(renderToStaticMarkup(<GapTable summary={summary} />));
    // 목록이 비었으면 수 대신 나머지 문장을 잇는다. 첫 문장만 있는 경고에는 뒤에 빈칸을 붙이지 않는다.
    const detailOnly = renderToStaticMarkup(<CoverageWarning summary={{ ...summary, warning: { lead: "다 보지 못한 검사입니다.", detail: "까닭.", counts: null } }} />);
    expect(textOf(elementAt(detailOnly, detailOnly.indexOf('<summary class="warn-hd"')))).toBe("다 보지 못한 검사입니다. 까닭.");
    const leadOnly = renderToStaticMarkup(<CoverageWarning summary={{ ...summary, warning: { lead: "다 보지 못한 검사입니다.", detail: null, counts: null } }} />);
    expect(textOf(elementAt(leadOnly, leadOnly.indexOf('<summary class="warn-hd"')))).toBe("다 보지 못한 검사입니다.");
  });

  it("검사에 들지 않는 파일과 정보(NotSeen): 목록은 늘 같고 첫 문단만 발견 수에 따라 다르다. 다른 판의 팩이면 대상 언어를 알 수 없다고 덧붙인다", () => {
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

  it("발견이 있는 결과에는 펼치지 않고 검사 정보의 링크(조문 도감 #scope)로 둔다. 발견이 0이면 본문에 펼친 채로 둔다", () => {
    // (D5) 발견이 있는 결과의 "이 도구가 보지 못하는 것" 접힌 곳은 조문 도감으로 옮겼다(docs/redesign.md 7장 2, 오너 승인).
    const found = renderToStaticMarkup(<ReportSummary view={viewOf(incomplete())} />);
    expect(found).not.toContain('<ul class="not-seen">');
    expect(found).toContain(`href="/policy#scope">${SITE.notSeen.title}</a>`);
    const zero = renderToStaticMarkup(<ReportSummary view={viewOf(readJson("contract", "cli-current", "plain.main.json"))} />);
    expect(zero).toContain('<ul class="not-seen">');
    expect(zero).not.toContain(`href="/policy#scope"`);
  });
});

describe("인용한 줄 (Citation)", () => {
  it("한 줄이든 여러 줄이든 줄마다 경로:줄과 글을 적는다. 글은 실린 그대로이고 줄 번호가 없으면 경로만 적는다", () => {
    const quotes = [
      { file: "src/auth/signup.ts", line: 7, text: "if (age < 14) {", alternative: null },
      { file: "src/auth/signup.ts", line: null, text: "const a = 1;\n  const b = <b>2</b>;", alternative: null },
      { file: "src/lib/x.ts", line: 120, text: "  return \"따옴표\" & 기호;", alternative: null },
    ];
    const html = renderToStaticMarkup(<Citation quotes={quotes} />);
    const items = elementsOf(html, '<li class="cite">').map((li) => ({
      at: textOf(elementAt(li, li.indexOf('<span class="cite-at">'))),
      text: textOf(elementAt(li, li.indexOf('<code class="cite-text"'))),
    }));
    expect(items).toEqual([
      { at: "src/auth/signup.ts:7", text: "if (age < 14) {" },
      { at: "src/auth/signup.ts", text: "const a = 1;\n  const b = <b>2</b>;" },
      { at: "src/lib/x.ts:120", text: '  return "따옴표" & 기호;' },
    ]);
    // 인용한 글은 코드다. 번역하지 않게 한다. 마크업으로 읽지 않는다(글자 그대로).
    expect(html).toContain('<code class="cite-text" translate="no">');
    expect(html).not.toContain("<b>");
    // 인용이 없으면 아무것도 그리지 않는다.
    expect(renderToStaticMarkup(<Citation quotes={[]} />)).toBe("");
  });

  it("인용마다 경로와 글만 적는다. 받치는 대안의 id 는 적지 않는다(2026-11-11 오너 지시: 팩 안의 이름은 `자세히` 안)", () => {
    const html = renderToStaticMarkup(
      <Citation
        quotes={[
          { file: "src/auth/signup.ts", line: null, text: "QUOTE_FOR_A", alternative: "alt-a" },
          { file: "src/auth/signup.ts", line: null, text: "QUOTE_FOR_B", alternative: "alt-b" },
        ]}
      />,
    );
    const items = elementsOf(html, '<li class="cite">').map((li) => ({
      at: textOf(elementAt(li, li.indexOf('<span class="cite-at">'))),
      text: textOf(elementAt(li, li.indexOf('<code class="cite-text"'))),
    }));
    expect(items).toEqual([
      { at: "src/auth/signup.ts", text: "QUOTE_FOR_A" },
      { at: "src/auth/signup.ts", text: "QUOTE_FOR_B" },
    ]);
    expect(html).not.toContain("alt-a");
  });

  it("AI 가 푼 경고의 상자: 대안이 둘이고 인용이 둘이면 어느 인용이 어느 대안의 것인지 보인다", () => {
    const data = readJson("tests", "fixtures", "judge-on.cleared.json") as Report;
    const [one] = data.run.ai_cleared!;
    const view = viewOf({
      ...data,
      run: {
        ...data.run,
        ai_cleared: [{ ...one, alternatives: [{ id: "under14-branch", cite: "QUOTE_FOR_A" }, { id: "guardian-call", cite: "QUOTE_FOR_B" }, { id: "age-gate-text", cite: null }] }],
      },
    });
    const html = renderToStaticMarkup(<ReportSummary view={view} />);
    const box = elementAt(html, html.indexOf('<details class="box ai-box" open="">'));
    const cites = elementsOf(box, '<li class="cite">').map(textOf);
    expect(cites).toEqual(["src/auth/signup.tsQUOTE_FOR_A", "src/auth/signup.tsQUOTE_FOR_B"]);
    // 어느 인용이 어느 대안의 것인지는 줄의 `자세히` 안에 인용과 같은 차례로 있다. 인용이 없는 대안은 "인용 없음"으로 따로 적는다.
    const more = elementAt(box, box.indexOf('<details class="f-more">'));
    expect(closedDetailsAt(box, box.indexOf("인용한 대안"))).toEqual(['<details class="f-more">']);
    expect(textOf(elementAt(more, more.indexOf('<p class="ids">')))).toBe(
      "규칙 signup-without-guard인용한 대안 under14-branch guardian-call인용 없음 age-gate-text",
    );
  });

  it("AI 가 푼 경고의 상자가 이 부품으로 인용한 줄을 그린다", () => {
    const view = viewOf(readJson("tests", "fixtures", "judge-on.cleared.json"));
    const html = renderToStaticMarkup(<ReportSummary view={view} />);
    const box = elementAt(html, html.indexOf('<details class="box ai-box" open="">'));
    expect(box).toContain(renderToStaticMarkup(<Citation quotes={view.cleared[0].quotes} />));
    expect(textOf(box)).toContain("const age = calcKoreanAge(form.birthDate);");
  });
});

describe("AI 검토가 돈 결과의 요약 줄과 곁칸 (D5 검토 반영)", () => {
  const judged = () => readJson("tests", "fixtures", "judge-on.cleared.json") as Report;
  const sumline = (html: string) => textOf(elementAt(html, html.indexOf('<p class="sumline">')));

  it("요약 줄에 AI 가 푼 경고와 적용 질문으로 빠진 판정의 수를 함께 적는다. 빠진 판정이 결과에 없으면 알 수 없음이다", () => {
    const dismissed = viewOf(readJson("tests", "fixtures", "judge-on.dismissed.json"));
    expect(sumline(renderToStaticMarkup(<ReportSummary view={dismissed} />))).toContain(
      `AI 가 적용되지 않는다고 답해 빠진 판정 ${dismissed.dismissed.length}건`,
    );
    expect(dismissed.dismissed.length).toBeGreaterThan(0);
    const { ai_dismissed: _drop, ...run } = judged().run;
    void _drop;
    const unknown = viewOf({ ...judged(), run });
    expect(unknown.aiDismissedKnown).toBe(false);
    expect(sumline(renderToStaticMarkup(<ReportSummary view={unknown} />))).toContain(
      `AI 가 적용되지 않는다고 답해 빠진 판정 ${STATUS_LABEL["pack-unknown"]}`,
    );
    // AI 검토가 돌지 않은 결과에는 AI 의 수를 적지 않는다.
    const off = viewOf(readJson("contract", "cli-current", "kids-signup.main.json"));
    expect(sumline(renderToStaticMarkup(<ReportSummary view={off} />))).not.toContain("AI");
  });

  it("AI 가 푼 경고만 있는 정책의 `발견 없음` 줄만 곁칸에 있어도 0의 뜻을 적는다", () => {
    // 발견이 다른 정책을 모두 상자로 만들고, AI 가 푼 경고만 한 정책에 남긴 결과.
    const data = judged();
    const view = viewOf(data);
    const others = view.policies.filter((policy) => policy.id !== data.run.ai_cleared![0].policy);
    const [finding] = (readJson("contract", "cli-current", "night-push.main.json") as Report).findings;
    const findings = others.map((policy) => ({ ...finding, policy: policy.id, title: policy.title, law: policy.law }));
    const html = renderToStaticMarkup(<ReportSummary view={viewOf({ ...data, findings })} />);
    const side = elementAt(html, html.indexOf('<details class="box side-pol"'));
    expect(side).not.toContain('<div class="side-group">');
    expect(textOf(side)).toContain("발견 없음, AI 가 푼 경고 1건");
    expect(side).toContain(`<p class="z">${SITE.zeroIsNotClearance}</p>`);
  });
});

describe("펼친 발견의 '모름' 문장 (D5 검토 반영)", () => {
  it("질문과 고치는 법, 나머지 대안 다음에 한 번 적는다. 모름인 대안의 메시지 앞에는 `모름` 이름표가 붙는다", () => {
    const data = readJson("tests", "fixtures", "incomplete-coverage.json") as Report;
    const findings = data.findings
      .filter((f) => f.unsatisfied_alternatives.length > 1)
      .map((f) => ({ ...f, unsatisfied_alternatives: f.unsatisfied_alternatives.map((alt) => ({ ...alt, value: "unknown" })) }));
    expect(findings.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(<ReportSummary view={viewOf({ ...data, findings })} />);
    const body = elementAt(html, html.indexOf('<div class="finding-body">'));
    const note = body.indexOf('<p class="unk-note">');
    expect(note).toBeGreaterThan(body.lastIndexOf('<dl class="qa">'));
    expect(body.indexOf('<p class="unk-note">', note + 1)).toBe(-1);
    expect(elementsOf(body, '<p class="alt-message">').every((p) => p.includes('<span class="unk">모름</span>'))).toBe(true);
  });
});

describe("규칙 id (RuleId)", () => {
  it("이 사이트의 팩에 있는 규칙은 조문 도감의 그 정책 쪽, 그 규칙의 자리로 잇고(D6), 없는 규칙은 글로만 적는다", () => {
    // 부품 시험에는 Next 의 설정(trailingSlash)이 걸리지 않아 Link 가 경로 끝의 빗금을 뗀다. 빌드된 쪽은 브라우저 시험이 본다.
    expect(renderToStaticMarkup(<RuleId policy="kr.pipa.22-2" rule="signup-without-guard" inPack />)).toBe(
      '<a href="/policy/kr-pipa-22-2#rule-signup-without-guard"><code translate="no">signup-without-guard</code></a>',
    );
    expect(renderToStaticMarkup(<RuleId policy="kr.other.99" rule="made-up-rule" inPack={false} />)).toBe(
      '<code translate="no">made-up-rule</code>',
    );
  });

  it("결과 화면에서도: 팩에 없는 규칙 id 는 링크가 아니다", () => {
    const data = readJson("contract", "cli-current", "kids-signup.main.json") as Report;
    const unknown = { ...data, findings: data.findings.map((f) => ({ ...f, rule: "rule-from-another-pack" })) };
    const html = renderToStaticMarkup(<ReportSummary view={viewOf(unknown)} />);
    const ids = elementAt(html, html.indexOf('<p class="ids">'));
    expect(ids).toContain('<code translate="no">rule-from-another-pack</code>');
    expect(ids).not.toContain("<a ");
    const known = renderToStaticMarkup(<ReportSummary view={viewOf(data)} />);
    expect(elementAt(known, known.indexOf('<p class="ids">'))).toContain('<a href="/policy/kr-pipa-22-2#rule-signup-without-guard"><code translate="no">signup-without-guard</code></a>');
  });
});

describe("정책 수와 title 속성 (D5)", () => {
  it("곁칸의 `정책 N` 은 데이터에서 센다: 팩 메타데이터 파일의 정책 수와 같다(CLI 0.3 결과)", () => {
    const policies = readPackFile().policies.length;
    expect(policies).toBeGreaterThan(0);
    for (const file of jsonFiles("contract", "cli-current")) {
      const html = renderToStaticMarkup(<ReportSummary view={viewOf(readJson("contract", "cli-current", file))} />);
      expect(html, file).toContain(`정책 <span class="count">${policies}</span>`);
    }
    // v1 초안의 요약이 일부뿐이면 그 수다(이 사이트의 팩에서 채우지 않는다).
    const draft = readJson("contract", "samples-v1-draft", "plain.main.json") as Report;
    const two = renderToStaticMarkup(<ReportSummary view={viewOf({ ...draft, run: { ...draft.run, policies: draft.run.policies!.slice(0, 2) } })} />);
    expect(two).toContain('정책 <span class="count">2</span>');
  });

  it("결과 화면·분석 쪽·뷰어·데모의 부품 소스에 정책 수를 글자로 적어 두지 않는다", () => {
    const files = walk("src").filter((file) => /^src\/(components|app)\/.*\.tsx$/.test(file));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(path.join(root, file), "utf8");
      expect(text, file).not.toMatch(/정책 \d|정책 <span[^>]*>\d|발견 없음 \d/);
    }
  });

  it("결과 부품은 title 속성을 쓰지 않는다(터치와 키보드에서 보이지 않는다. docs/redesign.md 2.1). 뜻은 보이는 글이나 화면 낭독기의 글이다", () => {
    const dirs = ["src/components/result", "src/components/service", "src/components/viewer", "src/components/demo"];
    for (const file of walk("src").filter((f) => dirs.some((dir) => f.startsWith(dir)) && f.endsWith(".tsx"))) {
      const text = readFileSync(path.join(root, file), "utf8");
      expect(/\stitle=\{|\stitle="/.test(text), file).toBe(false);
    }
    for (const parts of every) {
      const html = renderToStaticMarkup(<ReportSummary view={viewOf(readJson(...parts))} recommend />);
      expect(html, parts.join("/")).not.toMatch(/\stitle="/);
    }
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
