import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportSummary } from "@/components/result/ReportSummary";
import { blocksToggle } from "@/components/result/selection";
import { packMeta } from "@/lib/pack";
import { parseReport } from "@/lib/report/parse";
import { scopeLabel } from "@/lib/report/scope";
import { STATUS_HINT, STATUS_LABEL } from "@/lib/report/status";
import type { Finding, Report } from "@/lib/report/types";
import { buildReportView, type ReportView } from "@/lib/report/view-model";
import { SITE } from "@/lib/site";
import { closedDetailsAt, elementAt, elementsOf, jsonFiles, readJson, textOf } from "./helpers";
import { BANNED_WORDING } from "./wording";

// 결과 화면을 실제로 그려서 글자를 본다. 소스만 보는 시험이 놓치는 것(데이터에서 온 글, 조건에 따라 달라지는 글)을 잡는다.

function viewOf(data: unknown): ReportView {
  const parsed = parseReport(data);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return buildReportView(parsed.report, parsed.contract, packMeta);
}

function renderData(data: unknown): string {
  return renderToStaticMarkup(<ReportSummary view={viewOf(data)} />);
}

function render(...parts: string[]): string {
  return renderData(readJson(...parts));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

const GROUP = '<section class="rule-group">';
const ROW = '<li class="finding">';
const FOLD = '<details class="more">';

/** 규칙 묶음 하나의 HTML. */
function ruleGroup(html: string, rule: string): string {
  const head = html.indexOf(`<h4>규칙 ${rule}</h4>`);
  if (head === -1) throw new Error(`규칙 묶음이 없습니다: ${rule}`);
  return elementAt(html, html.lastIndexOf(GROUP, head));
}

/** 발견 줄 하나를 뜯어 본 것. `summary` 는 줄이 닫혀 있어도 보이는 부분이고, 나머지는 펼쳐야 보인다. */
function rowParts(row: string) {
  const summary = elementAt(row, row.indexOf("<summary>"));
  const part = (open: string) => {
    const at = summary.indexOf(open);
    return at === -1 ? null : textOf(elementAt(summary, at));
  };
  const bodies = elementsOf(row, '<div class="finding-body">');
  const paths = elementsOf(row, '<ol class="path">');
  return {
    /** 처음부터 펼쳐져 있는지. */
    open: row.startsWith(`${ROW}<details open="">`),
    summary,
    where: part("<code>"),
    scope: part('<span class="finding-scope">'),
    status: part('<span class="chip '),
    rule: part('<span class="visually-hidden">'),
    bodies,
    body: bodies[0] ?? "",
    /** 판정 경로 목록의 수. 발견 하나에 하나이거나, 경로가 비어 있으면 없다. */
    pathLists: paths.length,
    /** 판정 경로의 문장들. 경로 목록이 없으면 null. */
    path: paths.length > 0 ? elementsOf(paths[0], "<li>").map(textOf) : null,
    alternatives: elementsOf(row, '<li class="alt">'),
  };
}

/** 그려 낸 화면의 발견 줄(문서 순서)과, 화면 구조가 정한 순서의 발견을 짝지어 준다. */
function rowsWithFindings(data: unknown) {
  const view = viewOf(data);
  const html = renderToStaticMarkup(<ReportSummary view={view} />);
  const expected = view.policies.flatMap((policy) =>
    policy.rules.flatMap((group) => [
      ...group.shown.map((location, i) => ({ location, first: i === 0, folded: false })),
      ...group.folded.map((location) => ({ location, first: false, folded: true })),
    ]),
  );
  const starts: number[] = [];
  for (let at = html.indexOf(ROW); at !== -1; at = html.indexOf(ROW, at + 1)) starts.push(at);
  expect(starts).toHaveLength(expected.length);
  return {
    html,
    rows: starts.map((at, i) => ({ at, ...expected[i], ...rowParts(elementAt(html, at)) })),
  };
}

const where = (file: string, line: number | null) => (line === null ? file : `${file}:${line}`);

/** 글들이 이 순서로 나오는지. 앞의 글을 찾은 자리 뒤에서 다음 글을 찾는다. */
function inOrder(text: string, needles: string[]): boolean {
  let from = 0;
  for (const needle of needles) {
    const at = text.indexOf(needle, from);
    if (at === -1) return false;
    from = at + needle.length;
  }
  return true;
}

const every: string[][] = [
  ...jsonFiles("contract", "cli-current").map((f) => ["contract", "cli-current", f]),
  ...jsonFiles("contract", "samples-v1-draft").map((f) => ["contract", "samples-v1-draft", f]),
  ...jsonFiles("tests", "fixtures").map((f) => ["tests", "fixtures", f]),
];

describe("그려 낸 결과 화면의 문구", () => {
  it.each(every.map((parts) => [parts.join("/"), parts] as const))("%s", (_name, parts) => {
    const html = render(...parts);
    for (const [pattern, why] of BANNED_WORDING) {
      expect(pattern.test(html), `${pattern} — ${why}`).toBe(false);
    }
    expect(html).toContain("법률 자문이 아닙니다");
  });

  it("발견이 0이면 법적 문제가 없다는 뜻이 아니라고 적는다", () => {
    expect(render("contract", "cli-current", "plain.main.json")).toContain("법적 문제가 없다는 뜻은 아닙니다");
  });
});

describe("판정자에 관한 문구", () => {
  it("판정자가 꺼져 있었으면 켜 보라고 권하되, 코드가 외부로 나간다는 것을 함께 적는다", () => {
    const html = render("contract", "cli-current", "kids-signup.main.json");
    expect(html).toContain("판정자가 꺼져 있었습니다");
    expect(html).toContain("외부 API 로 나갑니다");
  });

  it("판정자를 켰는데 답을 쓰지 못한 경우에는 켜 보라고 하지 않는다", () => {
    const html = render("tests", "fixtures", "judge-on.citation-rejected.json");
    expect(html).not.toContain("판정자를 켜고");
    expect(html).toContain("답을 쓸 수 없었습니다");
    expect(html).toContain("인용한 코드가 확인되지 않았습니다");
  });

  it("AI 가 푼 경고를 숨기지 않고, 구분할 수 없다고도 하지 않는다", () => {
    const html = render("tests", "fixtures", "judge-on.cleared.json");
    expect(html).toContain("AI 가 푼 경고 1건");
    expect(html).toContain("const age = calcKoreanAge(form.birthDate);");
    expect(html).toContain("풀린 경고가 1건 있습니다");
  });

  it("적용 질문으로 빠진 판정을 숨기지 않는다", () => {
    const html = render("tests", "fixtures", "judge-on.dismissed.json");
    expect(html).toContain("빠진 판정 1건");
    expect(html).toContain("아니오");
  });
});

describe("다 보지 못한 결과", () => {
  it("세 목록을 뜻에 맞게 나눠 적는다", () => {
    const html = render("tests", "fixtures", "incomplete-coverage.json");
    expect(html).toContain("다 보지 못했습니다");
    expect(html).toContain("검사하지 않은 파일 1개");
    expect(html).toContain("이 파일들은 결과에 없습니다");
    expect(html).toContain("일부를 읽지 못한 파일 1개");
    expect(html).toContain("결과에는 들어 있습니다");
  });
});

describe("빈 결과 화면 (발견이 0인 결과)", () => {
  // 발견이 없다는 것만으로는 무엇을 봤는지 알 수 없다. 검사한 것과 이 도구가 보지 못하는 것을 함께 적는다.
  const CARD = '<article class="policy ';
  const EMPTY = '<div class="empty-report">';
  const PIPA = "만 14세 미만 아동의 개인정보 처리";

  /** 정책별 판정 단위 수를 적은 문장. 결과에 정책별 요약이 있을 때(v1 초안)만 카드에 나온다. */
  const UNITS = /이 정책의 판정 단위는 (\d+)개입니다\./;

  /** 검사한 파일의 수 옆에 적는 말. 결과에는 수만 있다. 목록도, 검사한 범위도 없다. */
  const FILES_NOTE =
    "결과에는 검사한 파일의 수만 실려 있고, 목록과 검사한 범위(저장소 전체인지, 바뀐 파일이나 일부 경로만인지)는 없습니다.";

  /** "이 도구가 보지 못하는 것"의 항목 가운데 검사한 범위 밖의 파일. 결과에 범위가 없어 조건으로 적는다. */
  const OUT_OF_SCOPE =
    "검사한 범위 밖의 파일: 바뀐 파일만 검사하거나 일부 경로만 검사할 때는 그 밖의 파일을 검사하지 않고, '검사하지 않은 파일'에도 싣지 않습니다. " +
    "어느 범위를 검사했는지는 결과에 실려 있지 않습니다.";

  /** 발견이 없는 정책 카드 하나를 뜯어 본 것. 설명 문단은 하나다(상태의 설명, 정책별 수를 알면 그 뒤에 그 수). */
  function cardParts(card: string) {
    const part = (open: string) => {
      const at = card.indexOf(open);
      return at === -1 ? null : textOf(elementAt(card, at));
    };
    const hints = elementsOf(card, '<p class="hint">').map(textOf);
    expect(hints, card).toHaveLength(1);
    const units = UNITS.exec(hints[0])?.[1];
    const evidence = card.indexOf('<ul class="evidence"');
    return {
      law: part('<p class="law">'),
      title: part("<h3>"),
      status: part('<span class="chip '),
      /** 상태의 설명. */
      description: hints[0].replace(UNITS, "").trim(),
      /** 정책별 판정 단위 수. 카드에 적혀 있지 않으면 null. */
      units: units === undefined ? null : Number(units),
      /** 충족 근거 위치. */
      evidence: evidence === -1 ? [] : elementsOf(elementAt(card, evidence), "<li>").map(textOf),
    };
  }
  const cards = (html: string) => elementsOf(html, CARD).map(cardParts);

  /** 빈 결과 구역을 뜯어 본 것. 구역이 없으면 null. */
  function emptyParts(html: string) {
    const at = html.indexOf(EMPTY);
    if (at === -1) return null;
    const panel = elementAt(html, at);
    const rows = elementsOf(elementAt(panel, panel.indexOf('<dl class="examined">')), "<div>");
    return {
      headings: elementsOf(panel, "<h3>").map(textOf),
      /** "검사한 것"의 줄. 이름표 → 값과 설명, 눈에 띄게 한 줄인지. */
      facts: Object.fromEntries(
        rows.map((row) => {
          const label = textOf(elementAt(row, row.indexOf("<dt>")));
          const dd = elementAt(row, row.indexOf("<dd"));
          return [label, { text: textOf(dd), warn: dd.startsWith('<dd class="warn">') }];
        }),
      ),
      notSeen: elementsOf(elementAt(panel, panel.indexOf('<ul class="not-seen">')), "<li>").map(textOf),
      text: textOf(panel),
    };
  }

  /** 그려 낸 화면의 글을 줄(문단, 목록 항목, 제목, 표의 칸)로 나눈다. 두 화면이 어디서 다른지 볼 때 쓴다. */
  function linesOf(html: string): string[] {
    const block = /<\/?(p|li|h[1-6]|dt|dd|div|section|article|summary|ul|ol|dl|details|header)\b[^>]*>/g;
    return textOf(html.replace(block, "\n"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const findingsIn = (parts: string[]) => (readJson(...parts) as Report).findings.length;
  const named = (list: string[][]) => list.map((parts) => [parts.join("/"), parts] as const);
  const empties = every.filter((parts) => findingsIn(parts) === 0);
  const others = every.filter((parts) => findingsIn(parts) > 0);

  it("발견이 0인 자료가 수집본, v1 초안 예시, 시험용 자료에 모두 있다", () => {
    // 아래의 자료별 시험이 빈 목록을 돌고 통과하는 일이 없게 한다.
    expect(empties.map((parts) => parts.join("/"))).toEqual(
      expect.arrayContaining([
        "contract/cli-current/kids-signup.fixed.json",
        "contract/cli-current/plain.main.json",
        "contract/samples-v1-draft/kids-signup.fixed.json",
        "contract/samples-v1-draft/plain.main.json",
        "tests/fixtures/judge-on.cleared.json",
        "tests/fixtures/judge-on.dismissed.json",
      ]),
    );
    expect(others.length).toBeGreaterThan(0);
  });

  it.each(named(empties))("%s: 검사한 것과 이 도구가 보지 못하는 것을 적는다", (_name, parts) => {
    const html = render(...parts);
    const empty = emptyParts(html);
    expect(empty).not.toBeNull();
    expect(empty!.headings).toEqual(["검사한 것", "이 도구가 보지 못하는 것"]);
    // 파일 수, 판정 단위 수, 검사하지 않은 파일, 정책. 정책 목록은 바로 아래의 정책 카드다.
    expect(Object.keys(empty!.facts)).toEqual(["검사한 파일", "판정 단위", "검사하지 않은 파일", "정책"]);
    // 값은 결과에 실린 수 그대로다. 이 자료들은 모두 이 사이트의 팩과 같은 판으로 만든 것이라 정책 수도 안다.
    const { run } = readJson(...parts) as Report;
    const policies = packMeta.policies.length;
    const skipped = run.skipped.length === 0 ? "없음" : `${run.skipped.length}개`;
    // 수 옆에는 어느 자료에서나 같은 말이 온다. 결과에 목록도 범위도 없어서 자료마다 달리 적을 것이 없다.
    expect(empty!.facts["검사한 파일"].text).toBe(
      run.files === 0 ? "0개. 검사한 파일이 없어서 발견도 없습니다." : `${run.files}개. ${FILES_NOTE}`,
    );
    expect(empty!.facts["판정 단위"].text.startsWith(`${run.units}개. 모든 정책을 합친 수입니다.`)).toBe(true);
    expect(empty!.facts["검사하지 않은 파일"].text.startsWith(`${skipped}. `)).toBe(true);
    expect(empty!.facts["정책"].text).toMatch(new RegExp(`^${policies}개\\. .*아래에`));
    expect(cards(html)).toHaveLength(policies);
    // 판정 단위가 무엇인지도 적는다(적용 조건이 거짓이면 단위가 생기지 않는다).
    expect(empty!.text).toContain("판정 단위는 규칙의 적용 조건이 참이거나 모름이어서 판정한 곳입니다.");
    // 보지 못하는 것 다섯: JS/TS 밖, 목록 없이 빠지는 JS/TS 파일, 검사한 범위 밖의 파일, 서버 설정, 데이터에만 있는 동의 상태.
    expect(empty!.notSeen).toHaveLength(5);
    expect(empty!.notSeen[0]).toMatch(/^JS\/TS 가 아닌 파일: .*검사하지 않고, '검사하지 않은 파일'에도 싣지 않습니다\.$/);
    // 검사하지 않은 파일 목록이 비어 있어도 다 본 것이 아니다. JS/TS 파일인데 목록에 실리지 않고 빠지는 것을 따로 적는다
    // (CLI 를 합성 폴더에 돌려 확인한 것: 이름으로 가리는 폴더, git 이 무시하는 파일, 하위 모듈처럼 저장소 안에 따로 든
    // 다른 git 저장소, 심볼릭 링크, 읽을 권한이 없는 폴더). "검사하지 않은 파일: 없음"의 풀이가 이 항목을 가리키므로
    // 하나라도 빠지면 안 된다.
    expect(empty!.notSeen[1]).toMatch(
      /^목록 없이 빠지는 JS\/TS 파일: 폴더를 검사할 때 .*JS\/TS 파일이어도 검사하지 않고, '검사하지 않은 파일'에도 싣지 않습니다\./,
    );
    for (const unlisted of [
      "node_modules·dist·build·vendor·coverage 같은 이름의 폴더 아래 파일(내용이 아니라 폴더 이름으로 가립니다)",
      // .gitignore 만이 아니다. git 이 무시하는 방법 셋 가운데 어느 것으로 무시했든 같게 빠진다.
      "git 저장소에서 git 이 무시하는 파일(.gitignore, .git/info/exclude, 전역 무시 목록)",
      "하위 모듈(submodule)을 비롯해 git 저장소 안에 따로 든 다른 git 저장소의 파일",
      "심볼릭 링크",
      // 폴더를 가리키는 링크도 따라가지 않는다.
      "검사하는 폴더 안의 링크는 파일을 가리키든 폴더를 가리키든 따라가지 않으므로, 가리키는 곳이 그 폴더 밖에 있으면 그곳의 파일도 보지 못합니다.",
      // 늘 빠지는 것은 아니다(git 이 추적하는 파일이면 검사하기도 한다). 그래서 "빠질 수 있습니다"다.
      "읽을 권한이 없는 폴더 아래 파일도 목록 없이 빠질 수 있습니다.",
    ]) {
      expect(empty!.notSeen[1], unlisted).toContain(unlisted);
    }
    // 범위를 좁혀 돌린 검사에서는 그 밖의 파일도 목록 없이 빠진다. 결과에 범위가 없으므로 어느 자료에서나 같은 말이다.
    expect(empty!.notSeen[2]).toBe(OUT_OF_SCOPE);
    expect(empty!.notSeen[3]).toMatch(/^서버·인프라 설정: .*보지 못합니다/);
    expect(empty!.notSeen[4]).toMatch(/^데이터에만 있는 동의 상태: .*코드를 읽어서는 알 수 없습니다/);
    expect(empty!.text).toContain(SITE.notSeen.lead);
    expect(SITE.notSeen.lead).toContain("발견이 없어도 아래까지 확인한 것은 아닙니다");
    // 팩 판이 같으면 대상 언어(JS/TS)를 안다. 다른 판의 팩일 때 덧붙이는 말은 나오지 않는다.
    expect(empty!.text).not.toContain("다른 언어도 검사하는지");
    // 처음부터 보인다(접어 두지 않는다). 0이 문제없다는 뜻이 아니라는 문구 → 빈 결과 구역 → 정책 카드 순서다.
    expect(closedDetailsAt(html, html.indexOf(EMPTY))).toEqual([]);
    const order = [html.indexOf(SITE.zeroIsNotClearance), html.indexOf(EMPTY), html.indexOf(CARD)];
    expect(order.every((at) => at !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it.each(named(others))("%s: 발견이 있으면 빈 결과 구역이 없다", (_name, parts) => {
    const html = render(...parts);
    expect(emptyParts(html)).toBeNull();
    expect(html).not.toContain("이 도구가 보지 못하는 것");
  });

  it("v1 초안: plain.main 과 kids-signup.fixed 가 서로 다른 설명을 보인다", () => {
    const plain = cards(render("contract", "samples-v1-draft", "plain.main.json"));
    const fixed = cards(render("contract", "samples-v1-draft", "kids-signup.fixed.json"));
    expect(plain).toHaveLength(5);
    expect(fixed).toHaveLength(5);

    // plain.main: 다섯 정책 모두 적용 신호 없음이고 판정 단위가 0개다.
    for (const card of plain) {
      expect(card, card.title ?? "").toMatchObject({
        status: "적용 신호 없음",
        description: "이 조문이 닿는 코드 신호를 찾지 못했습니다. 법적 문제가 없다는 뜻은 아닙니다.",
        units: 0,
        evidence: [],
      });
    }

    // kids-signup.fixed: 제22조의2 는 충족 근거 발견이고, 어디서 어느 대안이 확인됐는지 보인다.
    const pipa = fixed.find((card) => card.title === PIPA)!;
    expect(pipa).toEqual({
      law: "개인정보 보호법 제22조의2 제1항",
      title: PIPA,
      status: "충족 근거 발견",
      description: "적법한 대안 가운데 하나가 코드에서 확인됐습니다.",
      units: 1,
      evidence: ["src/auth/signup.ts:7 에서 대안 under14-branch 확인"],
    });
    // 가장 먼저 봐야 할 것이 위에 온다.
    expect(fixed[0]).toBe(pipa);

    // 같은 정책의 설명이 두 결과에서 다르다: 상태, 상태의 설명, 판정 단위 수, 충족 근거 위치.
    const before = plain.find((card) => card.title === PIPA)!;
    expect(pipa.status).not.toBe(before.status);
    expect(pipa.description).not.toBe(before.description);
    expect(pipa.units).not.toBe(before.units);
    expect(pipa.evidence).not.toEqual(before.evidence);
    // 화면의 설명은 상태 문구(src/lib/report/status.ts)에서 온 것이다.
    expect([before.description, pipa.description]).toEqual([STATUS_HINT["no-signal"], STATUS_HINT["evidence-found"]]);
    // 나머지 네 정책은 두 결과에서 같다(적용 신호 없음).
    const rest = (list: typeof plain) => list.filter((card) => card.title !== PIPA);
    expect(rest(fixed)).toEqual(rest(plain));
    expect(rest(fixed)).toHaveLength(4);
  });

  it("v1 초안: 전체 판정 단위 수 옆에 정책별 수가 정책마다 있다고 적는다", () => {
    for (const [file, units] of [
      ["plain.main.json", 0],
      ["kids-signup.fixed.json", 1],
    ] as const) {
      const facts = emptyParts(render("contract", "samples-v1-draft", file))!.facts;
      expect(facts["판정 단위"], file).toEqual({
        text: `${units}개. 모든 정책을 합친 수입니다. 정책별 수는 아래 정책마다 적었습니다.`,
        warn: false,
      });
      expect(facts["정책"].text, file).toBe("5개. 결과에 정책별 요약이 실려 있어, 아래에 정책마다 적었습니다.");
    }
  });

  it("v1 초안: 발견이 있는 정책에도 정책별 판정 단위 수를 적는다", () => {
    const html = render("contract", "samples-v1-draft", "kids-signup.main.json");
    const texts = elementsOf(html, CARD).map(textOf);
    expect(texts).toHaveLength(5);
    expect(texts[0]).toContain(PIPA);
    expect(texts[0]).toContain("이 정책의 판정 단위는 1개입니다.");
    for (const text of texts.slice(1)) expect(text).toContain("이 정책의 판정 단위는 0개입니다.");
  });

  it("CLI 0.3: 같은 두 결과는 정책 카드의 설명이 같고 전체 판정 단위 수만 다르다. 그 한계를 적는다", () => {
    const plain = render("contract", "cli-current", "plain.main.json");
    const fixed = render("contract", "cli-current", "kids-signup.fixed.json");

    // 정책 카드는 글자까지 같다. 정책별로 "적용 신호를 본 곳"을 알 수 없어서 모두 발견 없음이다.
    expect(cards(fixed)).toEqual(cards(plain));
    for (const card of cards(plain)) {
      // 정책별 수는 짐작해서 적지 않는다(units: null).
      expect(card, card.title ?? "").toMatchObject({
        status: "발견 없음",
        description: STATUS_HINT["not-reported"],
        units: null,
        evidence: [],
      });
    }
    expect(STATUS_HINT["not-reported"]).toContain("'충족 근거 발견'과 '적용 신호 없음'을 구분할 수 없습니다");
    expect(plain).not.toContain("이 정책의 판정 단위");
    expect(fixed).not.toContain("이 정책의 판정 단위");

    // 화면 전체에서 다른 줄은 둘뿐이다: 전체 판정 단위 수가 든 줄과, 그 수 옆에 적은 한계.
    // 0이면 정책별 수도 모두 0이라 "정책별 수가 없다"는 한계가 아니다. 어느 정책에서도 판정한 곳이 없다고 적고,
    // 그런데도 카드가 "발견 없음"(구분할 수 없다)인 까닭을 함께 적는다. 카드의 상태는 바꾸지 않는다.
    const [a, b] = [linesOf(plain), linesOf(fixed)];
    expect(b).toHaveLength(a.length);
    expect(a.flatMap((line, i) => (line === b[i] ? [] : [[line, b[i]]]))).toEqual([
      ["파일 1개 검사 · 판정 단위 0개 · 끝까지 봤습니다", "파일 1개 검사 · 판정 단위 1개 · 끝까지 봤습니다"],
      [
        "0개. 모든 정책을 합친 수입니다. 0이므로 어느 정책에서도 판정한 곳이 없습니다. 다만 이 출력 형식(CLI 0.3)에는 정책별 요약이 없어, 아래 정책 카드는 판정 단위가 있는 결과와 같은 설명('발견 없음')으로 보입니다.",
        "1개. 모든 정책을 합친 수입니다. 이 출력 형식(CLI 0.3)에는 정책별 수가 없어서, 어느 정책에서 적용 신호를 봤는지 알 수 없습니다.",
      ],
    ]);
    expect(emptyParts(fixed)!.facts["정책"].text).toBe(
      "5개. 결과에는 정책 목록이 없어, 팩 판이 같은 이 사이트의 팩에서 가져와 아래에 적었습니다.",
    );
  });

  it("CLI 0.3: 판정 단위가 0개여도 판정한 곳이 없다고 적을 수 없는 경우가 있다", () => {
    const data = readJson("contract", "cli-current", "plain.main.json") as Report;
    const units = (run: Partial<Report["run"]>) => emptyParts(renderData({ ...data, run }))!.facts["판정 단위"].text;
    const none = "0개. 모든 정책을 합친 수입니다. 0이므로 어느 정책에서도 판정한 곳이 없습니다.";
    const sameCards =
      " 다만 이 출력 형식(CLI 0.3)에는 정책별 요약이 없어, 아래 정책 카드는 판정 단위가 있는 결과와 같은 설명('발견 없음')으로 보입니다.";
    expect(units(data.run)).toBe(none + sameCards);

    // 다른 판의 팩으로 만든 결과: 카드가 "알 수 없음"이라 카드 이야기는 하지 않는다.
    const other = renderData({ ...data, run: { ...data.run, pack_digest: "0000000000000000" } });
    expect(emptyParts(other)!.facts["판정 단위"].text).toBe(none);
    expect(cards(other).map((card) => card.status)).toEqual(Array(5).fill("알 수 없음"));

    // 판정자를 켠 결과인데 빠진 판정의 목록(run.ai_dismissed)이 실려 있지 않다: 빠진 판정이 없었는지 모른다.
    const judged: Partial<Report["run"]> = { ...data.run, judge: "claude-cli:haiku" };
    delete judged.ai_dismissed;
    expect(units(judged)).toBe("0개. 모든 정책을 합친 수입니다.");
    // 목록이 실려 있고 비어 있으면 안다. 판정자가 꺼져 있었으면 목록이 없어도 안다(AI 에게 묻지 않는다).
    expect(units({ ...judged, ai_dismissed: [] })).toBe(none + sameCards);
    const off: Partial<Report["run"]> = { ...data.run };
    delete off.ai_dismissed;
    expect(off.judge).toBeNull();
    expect(units(off)).toBe(none + sameCards);
  });

  it("CLI 0.3: 판 번호 없는 결과에 run.policies 가 있어도 정책별 수로 쓰지 않는다", () => {
    const data = readJson("contract", "cli-current", "kids-signup.fixed.json") as Report;
    const draft = readJson("contract", "samples-v1-draft", "kids-signup.fixed.json") as Report;
    expect(draft.run.policies).toHaveLength(5);
    const html = renderData({ ...data, run: { ...data.run, policies: draft.run.policies } });
    expect(cards(html)).toEqual(cards(render("contract", "cli-current", "kids-signup.fixed.json")));
    expect(html).not.toContain("이 정책의 판정 단위");
    expect(emptyParts(html)!.facts["판정 단위"].text).toContain("이 출력 형식(CLI 0.3)에는 정책별 수가 없어서");
  });

  it("AI 가 푼 경고가 있으면, 어느 정책의 판정 단위인지는 거기 실린 것만 안다고 적는다", () => {
    const html = render("tests", "fixtures", "judge-on.cleared.json");
    expect(emptyParts(html)!.facts["판정 단위"]).toEqual({
      text: "1개. 모든 정책을 합친 수입니다. 이 출력 형식(CLI 0.3)에는 정책별 수가 없어서, 어느 정책의 것인지는 아래 'AI 가 푼 경고'에 실린 것만 알 수 있습니다.",
      warn: false,
    });
    // "아래"라고 했으니 그 목록은 빈 결과 구역 뒤에 있다.
    expect(html.indexOf("AI 가 푼 경고 1건")).toBeGreaterThan(html.indexOf(EMPTY));
  });

  // AI 가 적용되지 않는다고 답해 빠진 판정은 판정 단위 수에 들어 있지 않다. CLI 는 적용 조건이 '모름'일 때만 AI 에게
  // 묻고, '아니오'를 받은 단위를 뺀 뒤에 센다(CLI 소스 evaluate/engine.py 의 evaluate). 위의 풀이대로라면 "모름이어서
  // 판정한 곳"인데 수에는 없으므로, 그 사실과 목록의 자리를 수 옆에 적는다.
  const DISMISSED_LIST = "AI 가 적용되지 않는다고 답해 빠진 판정";
  const notCounted = (count: number) =>
    `${DISMISSED_LIST} ${count}건은 이 수에 들어 있지 않습니다. 아래 '${DISMISSED_LIST}'에서 확인하세요.`;

  it("AI 가 적용되지 않는다고 답해 빠진 판정이 있으면, 판정 단위 수에 들어 있지 않다고 적고 아래 목록을 가리킨다", () => {
    const html = render("tests", "fixtures", "judge-on.dismissed.json");
    const empty = emptyParts(html)!;
    expect(empty.facts["판정 단위"]).toEqual({
      text: `0개. 모든 정책을 합친 수입니다. ${notCounted(1)}`,
      warn: false,
    });
    // 수가 0이어도 판정한 곳이 없다고 하지 않는다. 빠진 곳이 있었다.
    expect(empty.text).not.toContain("판정한 곳이 없습니다");
    // "아래 '…'"라고 했으니 그 이름의 목록이 빈 결과 구역 뒤에 있고, 처음부터 펼쳐져 있다.
    const list = html.indexOf(`<summary>${DISMISSED_LIST} 1건</summary>`);
    expect(list).toBeGreaterThan(html.indexOf(EMPTY) + elementAt(html, html.indexOf(EMPTY)).length);
    expect(closedDetailsAt(html, list)).toEqual([]);
    expect(textOf(elementAt(html, html.lastIndexOf("<details", list)))).toContain("src/auth/signup.ts:5 kr.pipa.22-2");
  });

  it("빠진 판정은 판정 단위가 있는 결과와 v1 초안에서도 같은 말로 덧붙인다", () => {
    const [one] = (readJson("tests", "fixtures", "judge-on.dismissed.json") as Report).run.ai_dismissed!;
    const ai_dismissed = [one, { ...one, file: "src/auth/join.ts", line: null }];
    const units = (data: Report, patch: Partial<Report["run"]> = {}) => {
      const html = renderData({ ...data, run: { ...data.run, judge: "claude-cli:haiku", ai_dismissed, ...patch } });
      expect(html).toContain(`<summary>${DISMISSED_LIST} 2건</summary>`);
      return emptyParts(html)!.facts["판정 단위"].text;
    };
    const total = "모든 정책을 합친 수입니다.";
    const format = "이 출력 형식(CLI 0.3)에는 정책별 수가 없어서";
    // AI 가 푼 경고와 함께 있을 때.
    expect(units(readJson("tests", "fixtures", "judge-on.cleared.json") as Report)).toBe(
      `1개. ${total} ${format}, 어느 정책의 것인지는 아래 'AI 가 푼 경고'에 실린 것만 알 수 있습니다. ${notCounted(2)}`,
    );
    // 판정 단위가 있을 때.
    expect(units(readJson("contract", "cli-current", "kids-signup.fixed.json") as Report)).toBe(
      `1개. ${total} ${format}, 어느 정책에서 적용 신호를 봤는지 알 수 없습니다. ${notCounted(2)}`,
    );
    // v1 초안. run.units 는 같은 필드다(스키마가 같은 정의를 가리킨다).
    expect(units(readJson("contract", "samples-v1-draft", "plain.main.json") as Report)).toBe(
      `0개. ${total} 정책별 수는 아래 정책마다 적었습니다. ${notCounted(2)}`,
    );
  });

  it("검사한 파일이 없는 결과: 발견이 없는 까닭이 그것이라고 눈에 띄게 적는다", () => {
    // 검사할 파일이 없으면 CLI 는 files: 0, engine: null 인 결과를 낸다(CLI 소스 cli.py 의 cmd_scan).
    const data = readJson("contract", "cli-current", "plain.main.json") as Report;
    const html = renderData({ ...data, run: { ...data.run, files: 0, engine: null } });
    expect(emptyParts(html)!.facts["검사한 파일"]).toEqual({ text: "0개. 검사한 파일이 없어서 발견도 없습니다.", warn: true });
    // 파일이 있으면 눈에 띄게 하지 않는다. 결과에 없는 것은 검사한 파일의 목록과 검사한 범위라고 적는다.
    expect(emptyParts(renderData(data))!.facts["검사한 파일"]).toEqual({ text: `1개. ${FILES_NOTE}`, warn: false });
  });

  it("범위를 좁혀 돌린 결과: 검사한 범위가 결과에 없다고 적는다. 어느 범위였는지 짐작해 적지 않는다", () => {
    // CLI 0.3.0.dev0 을 합성 저장소에 돌려 확인한 것(docs/architecture.md 의 "빈 결과 화면"). 가입 코드(전체를 검사하면
    // 검토 필요 1건)는 그대로 두고 다른 파일 하나만 고쳐 스테이징한 저장소에서 `scan --staged`, `scan --diff <기준>`,
    // 그 파일만 이름을 대서 준 검사가 낸 결과는 실행 시간만 빼면 이 수집본(plain.main)과 글자까지 같다. 범위는 결과
    // 어디에도 없고(R14), 범위 밖의 가입 코드는 `run.skipped` 에도 없다. 그러니 이 화면이 곧 그 결과의 화면이다.
    const data = readJson("contract", "cli-current", "plain.main.json") as Report;
    expect(data.run).toMatchObject({ files: 1, units: 0, skipped: [], coverage_complete: true });
    expect(data.findings).toEqual([]);
    const empty = emptyParts(renderData(data))!;
    // 수가 전체를 본 수처럼 읽히지 않게, 수 옆에 목록과 범위가 결과에 없다고 적는다.
    expect(empty.facts["검사한 파일"]).toEqual({ text: `1개. ${FILES_NOTE}`, warn: false });
    // "검사하지 않은 파일: 없음"의 풀이가 가리키는 목록에 범위 밖의 파일이 있다. 조건으로 적는다("…할 때는").
    expect(empty.facts["검사하지 않은 파일"].text).toContain("이름이 실리지 않고 빠지는 파일은 아래 '이 도구가 보지 못하는 것'에 있습니다.");
    expect(empty.notSeen).toContain(OUT_OF_SCOPE);
    // 결과에 범위가 없으므로 자료에 따라 달라지는 말이 아니다. 파일 수가 달라도 수만 바뀐다.
    const many = emptyParts(renderData({ ...data, run: { ...data.run, files: 240 } }))!;
    expect(many.facts["검사한 파일"]).toEqual({ text: `240개. ${FILES_NOTE}`, warn: false });
    expect(many.notSeen).toEqual(empty.notSeen);
  });

  it("검사한 파일의 이름이 같은 화면에 보여도 부딪치지 않는 말로 적는다", () => {
    // 데모는 검사한 파일을 코드 상자로 보여 주고, v1 초안의 충족 근거 위치에는 파일 이름이 나온다. 그 화면에
    // "어느 파일인지는 결과에 없다"고 적으면 모순으로 읽힌다. 결과에 없는 것은 목록과 범위다.
    const html = render("contract", "samples-v1-draft", "kids-signup.fixed.json");
    expect(cards(html)[0].evidence).toEqual(["src/auth/signup.ts:7 에서 대안 under14-branch 확인"]);
    expect(emptyParts(html)!.facts["검사한 파일"].text).toBe(`1개. ${FILES_NOTE}`);
    for (const parts of empties) expect(render(...parts), parts.join("/")).not.toContain("어느 파일인지");
  });

  it("파일 수가 실려 있지 않은 결과: 0이라고 하지 않고 알 수 없다고 적는다", () => {
    const data = readJson("contract", "cli-current", "plain.main.json") as Report;
    const run: Partial<Report["run"]> = { ...data.run };
    delete run.files;
    expect(emptyParts(renderData({ ...data, run }))!.facts["검사한 파일"]).toEqual({
      text: "알 수 없음. 파일 수가 결과에 실려 있지 않습니다.",
      warn: false,
    });
  });

  it("검사하지 않은 파일이 있는 빈 결과: 그 파일들은 보지 못했다고 눈에 띄게 적는다", () => {
    const data = readJson("contract", "cli-current", "plain.main.json") as Report;
    const plain = renderData(data);
    // "없음"은 CLI 가 이름을 적어 알린 파일이 없다는 뜻이다. 이름 없이 빠지는 파일(다른 언어, 이름으로 가리는 폴더,
    // git 이 무시하는 파일, 저장소 안에 따로 든 다른 git 저장소, 심볼릭 링크, 읽을 권한이 없는 폴더, 범위를 좁혀 돌렸을
    // 때 그 범위 밖의 파일)까지 없다는 뜻이 아니므로, 그 파일을 적은 곳을 가리킨다.
    expect(emptyParts(plain)!.facts["검사하지 않은 파일"]).toEqual({
      text:
        "없음. 크기·인코딩 같은 까닭으로 건너뛰었다고 결과에 이름이 실린 파일이 없습니다. " +
        "이름이 실리지 않고 빠지는 파일은 아래 '이 도구가 보지 못하는 것'에 있습니다.",
      warn: false,
    });
    // "아래 '…'"라고 했으니 그 이름의 구역이 이 줄 뒤에 있고, 거기에 그 파일들이 적혀 있다.
    const section = plain.indexOf("<h3>이 도구가 보지 못하는 것</h3>");
    expect(section).toBeGreaterThan(plain.indexOf("이름이 실리지 않고 빠지는 파일은"));
    expect(
      emptyParts(plain)!
        .notSeen.filter((item) => item.includes("'검사하지 않은 파일'에도 싣지 않습니다"))
        .map((item) => item.slice(0, item.indexOf(":"))),
    ).toEqual(["JS/TS 가 아닌 파일", "목록 없이 빠지는 JS/TS 파일", "검사한 범위 밖의 파일"]);

    const skipped = ["src/legacy/euckr.js", "src/vendor-lib/chart.min.js"];
    const html = renderData({ ...data, run: { ...data.run, skipped, coverage_complete: false } });
    expect(emptyParts(html)!.facts["검사하지 않은 파일"]).toEqual({
      text: "2개. 위의 '검사하지 않은 파일 2개'를 펼치면 목록이 있습니다. 이 파일들의 코드는 보지 못했습니다.",
      warn: true,
    });
    // "위의 '…'를 펼치면"이라고 했으니 그 이름의 펼침 단추가 빈 결과 구역보다 앞에 있고, 파일 이름은 그 안에 접혀 있다.
    // 목록을 처음부터 펼쳐 두게 바꾸면 "펼치면"이라는 말도 함께 고친다.
    const panel = html.indexOf(EMPTY);
    const toggle = html.indexOf("<summary>검사하지 않은 파일 2개</summary>");
    expect(toggle).toBeGreaterThan(-1);
    expect(toggle).toBeLessThan(panel);
    // 펼침 단추의 글은 접혀 있어도 보인다.
    expect(closedDetailsAt(html, toggle + "<summary>".length)).toEqual([]);
    for (const listed of skipped) {
      const at = html.indexOf(listed);
      expect(at, listed).toBeGreaterThan(toggle);
      expect(at, listed).toBeLessThan(panel);
      expect(closedDetailsAt(html, at), listed).toEqual(['<details class="filelist">']);
    }
  });

  it("팩 판이 다른 빈 결과: 어떤 정책으로 검사했는지 알 수 없다고 적는다", () => {
    const data = readJson("contract", "cli-current", "plain.main.json") as Report;
    const html = renderData({ ...data, run: { ...data.run, pack_digest: "0000000000000000" } });
    expect(emptyParts(html)!.facts["정책"]).toEqual({
      text: "알 수 없음. 결과에는 정책 목록이 없고, 팩 판이 이 사이트에 실린 팩과 달라 어떤 정책으로 검사했는지 알 수 없습니다.",
      warn: false,
    });
    for (const card of cards(html)) expect(card.status, card.title ?? "").toBe("알 수 없음");
    // 그 카드들이 무엇인지는 결과 머리의 알림이 말한다.
    expect(textOf(html)).toContain(
      "이 결과를 만든 팩과 이 사이트에 실린 팩의 판이 다릅니다. 정책 설명이 결과와 맞지 않을 수 있습니다. 발견이 없는 정책은 그 팩에 있었는지 알 수 없습니다.",
    );
    // 대상 언어는 팩이 정한다. 다른 판의 팩이 JS/TS 만 봤는지는 알 수 없다고 덧붙인다.
    expect(emptyParts(html)!.notSeen).toHaveLength(5);
    expect(emptyParts(html)!.text).toContain(
      "이 결과를 만든 팩은 이 사이트에 실린 팩과 판이 다릅니다. 그 팩이 JS/TS 말고 다른 언어도 검사하는지는 결과에 실려 있지 않습니다.",
    );
  });

  describe("v1 초안: 정책 수와 아래 정책 카드가 맞는다", () => {
    // v1 초안의 요약(run.policies)은 그 결과를 만든 팩의 모든 정책이다(스키마). 그래서 결과에 나온 정책만 카드로
    // 그린다. 이 사이트의 팩에서 채워 넣으면 "정책 N개 … 아래에 정책마다 적었습니다" 아래에 요약에 없는 카드가 섞인다.
    // CLI 가 아직 v1 을 내지 않으므로 아래 자료는 예시에서 요약만 바꿔 만든 것이다.
    const draft = readJson("contract", "samples-v1-draft", "plain.main.json") as Report;
    const fixed = readJson("contract", "samples-v1-draft", "kids-signup.fixed.json") as Report;
    const OTHER = "0000000000000000";
    const unknownPolicy = { policy: "kr.other.99", units: 2, needs_review: 0, uncertain: 0, compliant: 2, evidence: [] };
    const withRun = (data: Report, patch: Partial<Report["run"]>) => renderData({ ...data, run: { ...data.run, ...patch } });

    /** "정책" 줄에 적힌 수, 카드의 수, 정책별 수가 적힌 카드의 수. */
    function counts(html: string) {
      const line = emptyParts(html)!.facts["정책"].text;
      const list = cards(html);
      return {
        line,
        stated: Number(/^(\d+)개\. /.exec(line)?.[1]),
        cards: list.length,
        withUnits: list.filter((card) => card.units !== null).length,
        statuses: [...new Set(list.map((card) => card.status))].sort(),
      };
    }
    const AS_SUMMARIZED = "결과에 정책별 요약이 실려 있어, 아래에 정책마다 적었습니다.";

    it("예시(요약이 이 사이트의 팩과 같다): 정책 수 = 카드 수 = 정책별 수가 적힌 카드 수", () => {
      for (const file of jsonFiles("contract", "samples-v1-draft")) {
        const data = readJson("contract", "samples-v1-draft", file) as Report;
        if (data.findings.length > 0) continue;
        expect(counts(renderData(data)), file).toMatchObject({ stated: 5, cards: 5, withUnits: 5 });
      }
    });

    it("다른 판의 팩으로 만든 결과: 요약에 실린 정책만 카드로 그린다", () => {
      const html = withRun(draft, { pack_digest: OTHER, policies: draft.run.policies!.slice(0, 3) });
      expect(counts(html)).toEqual({
        line: `3개. ${AS_SUMMARIZED}`,
        stated: 3,
        cards: 3,
        withUnits: 3,
        statuses: ["적용 신호 없음"],
      });
      // 요약이 그 팩의 정책 목록이므로 "그 팩에 있었는지 알 수 없는" 카드는 없다. 결과 머리의 알림도 그 말을 하지 않는다.
      expect(textOf(html)).toContain("팩의 판이 다릅니다. 정책 설명이 결과와 맞지 않을 수 있습니다.");
      expect(textOf(html)).not.toContain("그 팩에 있었는지");
      expect(emptyParts(html)!.facts["판정 단위"].text).toBe("0개. 모든 정책을 합친 수입니다. 정책별 수는 아래 정책마다 적었습니다.");

      // 충족 근거가 실린 예시로도 본다.
      const two = withRun(fixed, { pack_digest: OTHER, policies: fixed.run.policies!.slice(0, 2) });
      expect(counts(two)).toMatchObject({ stated: 2, cards: 2, withUnits: 2, statuses: ["적용 신호 없음", "충족 근거 발견"] });
    });

    it("같은 판의 팩인데 요약이 일부뿐인 결과: 요약에 없는 정책을 '발견 없음' 카드로 채우지 않는다", () => {
      const html = withRun(draft, { policies: draft.run.policies!.slice(0, 2) });
      expect(counts(html)).toEqual({ line: `2개. ${AS_SUMMARIZED}`, stated: 2, cards: 2, withUnits: 2, statuses: ["적용 신호 없음"] });
      expect(textOf(html)).not.toContain(STATUS_HINT["not-reported"]);
    });

    it("이 사이트의 팩에 없는 정책이 요약에 있으면 그 정책도 카드로 그린다 (조문 도감으로 잇지는 않는다)", () => {
      const html = withRun(draft, { pack_digest: OTHER, policies: [...draft.run.policies!.slice(0, 2), unknownPolicy] });
      expect(counts(html)).toMatchObject({ line: `3개. ${AS_SUMMARIZED}`, stated: 3, cards: 3, withUnits: 3 });
      const card = elementsOf(html, CARD).find((c) => c.includes("kr.other.99"))!;
      expect(cardParts(card)).toMatchObject({ title: "kr.other.99", status: "충족 근거 발견", units: 2 });
      expect(card).not.toContain("<a ");
    });

    it("요약이 빈 결과: 0개라고 눈에 띄게 적고, 요약이 실려 있다고도 정책마다 적었다고도 하지 않는다", () => {
      for (const pack_digest of [draft.run.pack_digest, OTHER]) {
        const html = withRun(draft, { pack_digest, policies: [] });
        const empty = emptyParts(html)!;
        expect(empty.facts["정책"], pack_digest).toEqual({
          text: "0개. 결과의 정책별 요약이 비어 있습니다. 아래에 적을 정책이 없습니다.",
          warn: true,
        });
        expect(empty.facts["판정 단위"].text, pack_digest).toBe(
          "0개. 모든 정책을 합친 수입니다. 결과의 정책별 요약이 비어 있어 정책별 수가 없습니다.",
        );
        // 카드가 없다. 빈 상자도 그리지 않는다.
        expect(cards(html), pack_digest).toEqual([]);
        expect(html, pack_digest).not.toContain('<div class="policies">');
        expect(textOf(html), pack_digest).not.toContain(AS_SUMMARIZED);
      }
    });

    it("요약에 없는 정책이 AI 가 푼 경고에만 나오면, 그 카드는 요약에서 온 것이 아니라고 적는다", () => {
      const cleared = (readJson("tests", "fixtures", "judge-on.cleared.json") as Report).run.ai_cleared!;
      expect(cleared.map((c) => c.policy)).toEqual(["kr.pipa.22-2"]);
      const policies = draft.run.policies!.filter((p) => p.policy !== "kr.pipa.22-2");
      const html = withRun(draft, { judge: "claude-cli:haiku", units: 1, ai_cleared: cleared, policies });
      expect(counts(html)).toMatchObject({
        line: `4개. ${AS_SUMMARIZED} 요약에 없는 정책 1개도 아래에 있습니다. 결과의 다른 곳에만 나온 정책이라 정책별 수가 없습니다.`,
        stated: 4,
        cards: 5,
        withUnits: 4,
      });
      expect(emptyParts(html)!.facts["판정 단위"].text).toBe(
        "1개. 모든 정책을 합친 수입니다. 정책별 수는 아래에서 요약이 실린 정책에만 적었습니다.",
      );
      const card = cards(html).find((c) => c.title === PIPA)!;
      expect(card.units).toBeNull();
      expect(card.description).toContain("AI 판정자의 답으로 풀린 경고가 1건 있습니다.");
    });
  });
});

describe("발견의 단위", () => {
  it("같은 줄의 서로 다른 규칙은 규칙 이름과 함께 따로 보인다", () => {
    const html = render("contract", "cli-current", "night-push.main.json");
    expect(html).toContain("규칙 nonemail-start-block");
    expect(html).toContain("규칙 nonemail-end-optout");
    expect(html).toContain("발견 2건");
  });

  it("규칙마다 묶음이 따로 있고, 묶음마다 제 발견이 펼쳐져 있다", () => {
    const html = render("contract", "cli-current", "night-push.main.json");
    for (const [rule, alternative] of [
      ["nonemail-start-block", "label-name-phone"],
      ["nonemail-end-optout", "optout-080-free"],
    ]) {
      const group = ruleGroup(html, rule);
      expect(count(group, '<li class="finding">')).toBe(1);
      expect(count(group, '<details open="">')).toBe(1);
      expect(group).toContain(alternative);
      expect(textOf(group)).toContain("src/marketing/campaign.ts:2");
    }
  });
});

describe("발견 줄마다 제 발견이 그려진다", () => {
  // 닫힌 채 그려지는 줄(대표 2·3번째, 접힌 곳)은 사용자가 직접 펼쳐야 보인다. 그 안쪽까지 줄마다 본다.
  function expectRowsMatch(data: unknown) {
    const { html, rows } = rowsWithFindings(data);
    expect(rows).toHaveLength((data as Report).findings.length);
    for (const row of rows) {
      const { location } = row;
      const finding = location.finding;
      const name = `${location.rule} ${where(location.file, location.line)}`;
      // 닫혀 있어도 보이는 부분: 경로·줄, 판정이 본 범위, 상태. 화면 낭독기에는 규칙 이름도.
      expect(row.where, name).toBe(where(location.file, location.line));
      expect(row.scope, name).toBe(scopeLabel(location.scope));
      expect(row.status, name).toBe(STATUS_LABEL[location.status]);
      expect(row.rule, name).toBe(`규칙 ${location.rule}`);
      // 묶음의 첫 발견만 펼쳐 둔다.
      expect(row.open, name).toBe(row.first);
      // 접힌 곳의 발견만 닫힌 details(같은 규칙의 나머지) 하나에 가려 있다. 그 밖의 줄을 가리는 것은 없다.
      const hiddenBy = row.folded ? [FOLD] : [];
      expect(closedDetailsAt(html, row.at), name).toEqual(hiddenBy);
      // 줄이 닫혀 있어도 경로와 판정 범위는 줄과 함께 보인다(줄 자신의 닫힌 details 에 가려지지 않는다).
      for (const piece of ["<code>", '<span class="finding-scope">', '<span class="chip ']) {
        expect(closedDetailsAt(html, html.indexOf(piece, row.at)), `${name} ${piece}`).toEqual(hiddenBy);
      }
      // 안쪽은 펼쳐 둔 줄에서만 처음부터 보인다.
      const bodyAt = html.indexOf('<div class="finding-body">', row.at);
      expect(closedDetailsAt(html, bodyAt), `${name} 안쪽`).toEqual(row.first ? hiddenBy : [...hiddenBy, "<details>"]);
      // 펼친 안쪽은 그 발견의 것이다.
      expect(row.bodies, name).toHaveLength(1);
      expect(
        row.alternatives.map((alt) => textOf(elementAt(alt, alt.indexOf('<p class="alt-id">')))),
        name,
      ).toEqual(finding.unsatisfied_alternatives.map((alt) => alt.id));
      expect(row.pathLists, name).toBe(finding.decision_path.length > 0 ? 1 : 0);
      expect(row.path, name).toEqual(finding.decision_path.length > 0 ? finding.decision_path : null);
    }
  }

  it.each(every.map((parts) => [parts.join("/"), parts] as const))("%s", (_name, parts) => {
    expectRowsMatch(readJson(...parts));
  });

  it("같은 규칙이 반복돼 글이 같은 줄들도 서로 바뀌지 않는다 (발견마다 다른 글을 넣어 본다)", () => {
    const data = readJson("tests", "fixtures", "repeated-rule.json") as Report;
    const findings = data.findings.map((f, i) => ({
      ...f,
      decision_path: [...f.decision_path, `시험용 표시 ${i}번`],
      unsatisfied_alternatives: f.unsatisfied_alternatives.map((alt) => ({
        ...alt,
        remediation: `시험용 고치는 법 ${i}번`,
      })),
    }));
    expectRowsMatch({ ...data, findings });

    const { html, rows } = rowsWithFindings({ ...data, findings });
    findings.forEach((f, i) => {
      // 발견의 글은 화면에 한 번씩만, 제 줄 안에만 나온다.
      expect(count(html, `시험용 표시 ${i}번<`), f.file).toBe(1);
      expect(count(html, `시험용 고치는 법 ${i}번<`), f.file).toBe(f.unsatisfied_alternatives.length);
      const row = rows.find((r) => r.location.fingerprint === f.fingerprint)!;
      expect(row.path?.at(-1), f.file).toBe(`시험용 표시 ${i}번`);
      expect(textOf(row.body), f.file).toContain(`시험용 고치는 법 ${i}번`);
    });
  });

  it("상태가 섞여 있으면 줄마다 제 상태를 적는다", () => {
    const data = readJson("tests", "fixtures", "repeated-rule.json") as Report;
    const changes: Record<string, Partial<Finding>> = {
      "src/campaigns/winter-sale.ts": { ai_pending: [], untested_reasons: [] },
      "src/campaigns/weekend-deal.ts": { outcome: "needs-review-uncertain" },
    };
    const RULE = "nonemail-start-block";
    const findings = data.findings.map((f) => (f.rule === RULE ? { ...f, ...changes[f.file] } : f));
    expectRowsMatch({ ...data, findings });
    const { rows } = rowsWithFindings({ ...data, findings });
    const statusOf = (file: string) =>
      rows.find((r) => r.location.rule === RULE && r.location.file === file)?.status;
    expect(statusOf("src/campaigns/winter-sale.ts")).toBe("미충족 신호(검토 필요)");
    expect(statusOf("src/campaigns/weekend-deal.ts")).toBe("판단 보류(모름)");
    expect(statusOf("src/campaigns/black-friday.ts")).toBe("검토 필요 · AI 확인 전");
  });
});

describe("규칙 묶음은 가려지지 않는다", () => {
  it.each(every.map((parts) => [parts.join("/"), parts] as const))("%s", (_name, parts) => {
    // 규칙이 다른 발견은 서로 다른 의무다. 묶음을 통째로 접어 두는 것(닫힌 details)이 있으면 안 된다.
    const html = render(...parts);
    for (let at = html.indexOf(GROUP); at !== -1; at = html.indexOf(GROUP, at + 1)) {
      expect(closedDetailsAt(html, at), textOf(elementAt(html, at)).slice(0, 40)).toEqual([]);
    }
  });

  it("규칙이 다섯인 결과에서 묶음 다섯이 모두 처음부터 보인다", () => {
    const html = render("tests", "fixtures", "repeated-rule.json");
    const heads = elementsOf(html, "<h4>").map(textOf);
    expect(heads).toEqual([
      "규칙 nonemail-start-block",
      "규칙 nonemail-end-optout",
      "규칙 email-subject-label",
      "규칙 email-body-sender",
      "규칙 email-body-optout",
    ]);
    for (const head of heads) {
      expect(closedDetailsAt(html, html.indexOf(`<h4>${head}</h4>`)), head).toEqual([]);
    }
  });
});

describe("같은 규칙이 여러 파일에 반복되는 결과 (손으로 만든 시험용 자료)", () => {
  const html = render("tests", "fixtures", "repeated-rule.json");

  it("20개 파일에 반복되는 규칙은 대표 3곳을 먼저 보이고 나머지 17곳을 접는다", () => {
    const group = ruleGroup(html, "nonemail-start-block");
    expect(textOf(group)).toContain("20곳");
    const foldAt = group.indexOf(FOLD);
    expect(foldAt).toBeGreaterThan(-1);
    const shown = group.slice(0, foldAt);
    const folded = elementAt(group, foldAt);

    expect(count(shown, '<li class="finding">')).toBe(3);
    expect(count(folded, '<li class="finding">')).toBe(17);
    expect(folded).toContain("같은 규칙의 나머지 17곳");
    // 접힌 곳은 닫힌 채로 그려진다(open 이 없다). 그 안의 발견도 닫혀 있다.
    expect(folded.startsWith(`${FOLD}<summary>`)).toBe(true);
    expect(folded).not.toContain("<details open");

    expect(textOf(shown)).toContain("src/campaigns/black-friday.ts:2");
    expect(textOf(shown)).toContain("src/campaigns/coupon-reminder.ts:3");
    expect(textOf(shown)).not.toContain("src/campaigns/flash-sale.ts:2");
    expect(textOf(folded)).toContain("src/campaigns/flash-sale.ts:2");
    expect(textOf(folded)).toContain("src/features/marketing/sms/restock/sendRestockPromotionMessage.ts:4");
  });

  it("대표 3곳 가운데 첫 곳만 펼쳐 두고 나머지는 한 줄로 둔다", () => {
    const group = ruleGroup(html, "nonemail-start-block");
    const shown = elementsOf(group.slice(0, group.indexOf(FOLD)), ROW).map(rowParts);
    expect(shown.map((row) => [row.where, row.open])).toEqual([
      ["src/campaigns/black-friday.ts:2", true],
      ["src/campaigns/chuseok-gift.ts:2", false],
      ["src/campaigns/coupon-reminder.ts:3", false],
    ]);
  });

  it("닫힌 발견 줄에서도 줄 번호 옆에 판정이 본 범위가 보인다", () => {
    // 파일 단위 판정의 줄 번호는 조문이 닿는다고 본 첫 줄일 뿐이다. 펼치지 않은 줄이 그 줄을 문제의 줄처럼 보이면 안 된다.
    const rows = elementsOf(html, ROW).map(rowParts);
    expect(rows).toHaveLength(25);
    expect(rows.filter((row) => !row.open)).toHaveLength(20);
    for (const row of rows) {
      expect(row.where, row.where ?? "").toMatch(/:\d+$/);
      expect(row.scope, row.where ?? "").toBe("파일 전체 판정");
      // 범위는 펼친 안쪽이 아니라 줄 자체(summary)에 있다.
      expect(row.summary, row.where ?? "").not.toContain("finding-body");
    }
  });

  it("규칙이 다른 발견은 접힌 곳 밖에 보인다", () => {
    // 접힌 곳은 20개 파일에 반복된 규칙 하나뿐이다.
    expect(count(html, FOLD)).toBe(1);
    expect(html).toContain("발견 25건");
    for (const [rule, places] of [
      ["nonemail-end-optout", 2],
      ["email-subject-label", 1],
      ["email-body-sender", 1],
      ["email-body-optout", 1],
    ] as const) {
      const group = ruleGroup(html, rule);
      expect(group).not.toContain(FOLD);
      expect(count(group, '<li class="finding">')).toBe(places);
    }
    // 한 파일·한 줄에 함께 나온 서로 다른 세 규칙이 저마다 펼쳐져 있다.
    for (const rule of ["email-subject-label", "email-body-sender", "email-body-optout"]) {
      const group = ruleGroup(html, rule);
      expect(textOf(group)).toContain("src/mail/newsletter.ts:3");
      expect(count(group, '<details open="">')).toBe(1);
    }
  });

  it("접힌 곳에만 있는 상태는 묶음 머리에 개수로 보인다", () => {
    const data = readJson("tests", "fixtures", "repeated-rule.json") as Report;
    const uniform = textOf(ruleGroup(html, "nonemail-start-block").split("<ul")[0]);
    expect(uniform).toBe("규칙 nonemail-start-block20곳");

    // 파일 순서대로라면 접힌 곳에 들어가는 한 곳을 판단 보류로 바꾼다.
    const findings = data.findings.map((f) =>
      f.rule === "nonemail-start-block" && f.file === "src/campaigns/winter-sale.ts"
        ? { ...f, outcome: "needs-review-uncertain" }
        : f,
    );
    const mixed = ruleGroup(renderData({ ...data, findings }), "nonemail-start-block");
    const head = textOf(mixed.split("<ul")[0]);
    expect(head).toContain("검토 필요 · AI 확인 전 19곳");
    expect(head).toContain("판단 보류(모름) 1곳");
    expect(textOf(elementAt(mixed, mixed.indexOf(FOLD)))).toContain("src/campaigns/winter-sale.ts:2");
  });
});

describe("발견을 펼친 안쪽", () => {
  const body = (html: string) => elementAt(html, html.indexOf('<div class="finding-body">'));

  it("확인되지 않은 대안 → 질문 → 고치는 법 → 판정 경로 순서로 읽힌다", () => {
    const text = textOf(body(render("contract", "cli-current", "kids-signup.main.json")));
    expect(
      inOrder(text, [
        "확인되지 않은 적법한 대안 2개",
        "under14-branch",
        "만 14세 미만을 가르는 연령 분기가 보이지 않습니다.",
        "질문",
        "이 가입 흐름에서 만 14세 미만 사용자를 어떻게 가려내나요?",
        "고치는 법",
        "생년월일로 만 나이를 계산해 14세 미만 분기를 두세요.",
        "guardian-call",
        "보호자 동의를 확인하는 것으로 보이는 함수 호출이 없습니다.",
        "질문",
        "법정대리인 동의를 확인하는 함수 이름이 무엇인가요?",
        "고치는 법",
        "판정을 끝까지 하지 못한 이유",
        "ai-guard",
        "판정 경로",
        "적용: 정적 true",
        "대안 under14-branch: 정적 false",
        "→ needs-review",
      ]),
      text,
    ).toBe(true);
  });

  it("고치는 법이 실려 있지 않은 대안은 지어내지 않고 그렇다고 적는다", () => {
    const html = body(render("contract", "cli-current", "kids-signup.main.json"));
    // 수집본에서 guardian-call 의 remediation 은 null 이다.
    const guardian = textOf(elementAt(html, html.lastIndexOf('<li class="alt">')));
    expect(
      inOrder(guardian, [
        "guardian-call",
        "질문",
        "법정대리인 동의를 확인하는 함수 이름이 무엇인가요?",
        "고치는 법",
        "이 대안에는 고치는 법이 실려 있지 않습니다.",
      ]),
      guardian,
    ).toBe(true);
  });

  it("판정 경로는 CLI 가 낸 문장을 순서대로, 글자 그대로 보인다", () => {
    for (const file of jsonFiles("contract", "cli-current")) {
      const data = readJson("contract", "cli-current", file) as Report;
      const html = renderData(data);
      const paths = html.split('<ol class="path">').slice(1).map((part) => part.split("</ol>")[0]);
      expect(paths).toHaveLength(data.findings.length);
      const shown = paths.map((path) => path.split("</li>").slice(0, -1).map(textOf));
      for (const finding of data.findings) {
        expect(shown, `${file}: ${finding.rule}`).toContainEqual(finding.decision_path);
      }
    }
  });

  it("확인되지 않은 대안이 실려 있지 않으면 그렇다고 적고 판정 경로를 가리킨다", () => {
    // 약한 근거가 참이라 판단 보류로 남은 발견이다. 그 대안은 목록에 없고 판정 경로의 문장에만 나온다.
    const group = ruleGroup(render("contract", "cli-current", "genai-chat.fixed.json"), "ai-output-without-label");
    const text = textOf(group);
    expect(group).not.toContain('<li class="alt">');
    expect(text).toContain("결과에 실린 것이 없습니다");
    expect(text).toContain("대안 label-text: 약한 근거 — AI 확인 전에는 풀지 않음 → unknown");
  });

  it("값이 모름인 대안은 없다고 단정하지 않는다", () => {
    const data = readJson("tests", "fixtures", "incomplete-coverage.json") as Report;
    // 파일 일부를 읽지 못했거나 엔진이 조건을 끝내지 못하면 CLI 는 대안의 값을 unknown 으로 싣는다.
    const withValue = (value: string) =>
      renderData({
        ...data,
        findings: data.findings.map((f) => ({
          ...f,
          unsatisfied_alternatives: f.unsatisfied_alternatives.map((alt) => ({ ...alt, value })),
        })),
      });
    expect(withValue("unknown")).toContain("확인하지 못했을 뿐이고, 없다고 판정된 것은 아닙니다");
    expect(withValue("false")).not.toContain("확인하지 못했을 뿐이고");
  });

  it("판정자가 꺼져 있었다는 말을 두 번 적지 않는다. 다른 이유는 그대로 적는다", () => {
    const off = body(render("contract", "cli-current", "kids-signup.main.json"));
    expect(count(off, "판정자가 꺼져")).toBe(1);
    const unread = body(render("tests", "fixtures", "incomplete-coverage.json"));
    expect(unread).toContain("파일 일부를 읽지 못했습니다");
    expect(count(unread, "판정자가 꺼져")).toBe(1);
  });

  it("값이 거짓도 모름도 아닌 대안은 그 값을 그대로 적는다", () => {
    const data = readJson("contract", "cli-current", "kids-signup.main.json") as Report;
    const withValue = (value: string) =>
      renderData({
        ...data,
        findings: data.findings.map((f) => ({
          ...f,
          unsatisfied_alternatives: f.unsatisfied_alternatives.map((alt) => ({ ...alt, value })),
        })),
      });
    // CLI 0.3 은 거짓과 모름만 싣는다. 다른 값이 든 파일을 열었을 때 그 값을 숨기거나 거짓처럼 보이지 않는다.
    expect(withValue("true")).toContain("이 대안의 값: true");
    expect(withValue("false")).not.toContain("이 대안의 값:");
    expect(withValue("unknown")).not.toContain("이 대안의 값:");
  });

  it("메시지가 실려 있지 않은 대안은 빈 채로 둔다", () => {
    const data = readJson("contract", "cli-current", "kids-signup.main.json") as Report;
    const html = renderData({
      ...data,
      findings: data.findings.map((f) => ({
        ...f,
        unsatisfied_alternatives: f.unsatisfied_alternatives.map((alt) => ({ ...alt, message: null })),
      })),
    });
    const alternatives = elementsOf(html, '<li class="alt">');
    expect(alternatives).toHaveLength(2);
    for (const alt of alternatives) {
      expect(alt).not.toContain("alt-message");
      expect(textOf(alt)).not.toContain("null");
    }
  });
});

describe("판정이 본 범위", () => {
  // 줄 번호는 판정이 본 범위 안의 한 줄일 뿐이다. 줄 번호 옆(닫혀 있어도 보이는 자리)과 펼친 안쪽에 범위를 적는다.
  const kids = readJson("contract", "cli-current", "kids-signup.main.json") as Report;
  const rowWith = (patch: (finding: Finding) => unknown) => {
    const { rows } = rowsWithFindings({ ...kids, findings: kids.findings.map(patch) });
    expect(rows).toHaveLength(1);
    const [row] = rows;
    return { where: row.where, label: row.scope, note: textOf(elementAt(row.body, row.body.indexOf('<p class="hint">'))) };
  };

  it("파일 단위 판정: 파일 전체를 봤고, 줄 번호는 첫 줄일 뿐이라고 밝힌다", () => {
    expect(rowWith((f) => f)).toEqual({
      where: "src/auth/signup.ts:5",
      label: "파일 전체 판정",
      note: "파일 전체를 보고 내린 판정입니다. 줄 번호는 이 조문이 닿는다고 본 첫 줄입니다.",
    });
  });

  it("줄이 없는 발견에는 줄 번호를 붙이지 않고 줄 번호 이야기도 하지 않는다", () => {
    expect(rowWith((f) => ({ ...f, line: null }))).toEqual({
      where: "src/auth/signup.ts",
      label: "파일 전체 판정",
      note: "파일 전체를 보고 내린 판정입니다.",
    });
  });

  it("함수 단위 판정: 감싸는 함수가 있으면 그 줄 범위를 적는다", () => {
    expect(
      rowWith((f) => ({ ...f, scope: "anchor", region: { start_line: 3, end_line: 21 }, top_level: false })),
    ).toEqual({
      where: "src/auth/signup.ts:5",
      label: "함수 3~21행 판정",
      note: "함수 단위로 내린 판정입니다. 판정 구역은 3~21행입니다.",
    });
  });

  it("함수 단위 판정: 함수 밖의 줄을 본 판정이면 그렇다고 적는다", () => {
    expect(rowWith((f) => ({ ...f, scope: "anchor", region: null, top_level: true }))).toEqual({
      where: "src/auth/signup.ts:5",
      label: "함수 밖 판정",
      note: "함수 밖(모듈 최상위)의 줄을 보고 내린 판정입니다.",
    });
  });

  it("함수 단위 판정: 감싸는 함수가 없어 파일 전체를 본 판정이면 파일 단위와 같게 적는다", () => {
    expect(rowWith((f) => ({ ...f, scope: "anchor", region: null, top_level: false }))).toEqual({
      where: "src/auth/signup.ts:5",
      label: "파일 전체 판정",
      note: "파일 전체를 보고 내린 판정입니다. 줄 번호는 이 조문이 닿는다고 본 첫 줄입니다.",
    });
  });

  it("함수 단위인데 구역이 결과에 없으면 짐작하지 않고 알 수 없다고 적는다", () => {
    expect(
      rowWith((f) => {
        const finding: Partial<Finding> = { ...f, scope: "anchor", region: null };
        delete finding.top_level;
        return finding;
      }),
    ).toEqual({
      where: "src/auth/signup.ts:5",
      label: "판정 구역 알 수 없음",
      note: "함수 단위 규칙의 판정입니다. 판정 구역은 결과에 실려 있지 않아 알 수 없습니다.",
    });
  });
});

describe("수집본에 없는 드문 모양 (손으로 만든 시험용 자료)", () => {
  const { rows } = rowsWithFindings(readJson("tests", "fixtures", "uncommon-shapes.json"));
  const row = (rule: string, file: string, line: number | null) => {
    const found = rows.find((r) => r.location.rule === rule && r.location.file === file && r.location.line === line);
    if (!found) throw new Error(`발견 줄이 없습니다: ${rule} ${where(file, line)}`);
    return found;
  };

  it("함수 단위 판정은 줄마다 제 구역을 적는다. 같은 파일 안에서는 줄 순서다", () => {
    const anchored = rows.filter((r) => r.location.rule === "nonemail-start-block");
    expect(anchored.map((r) => [r.where, r.scope, r.folded])).toEqual([
      ["src/jobs/weekly-digest.ts:7", "파일 전체 판정", false],
      ["src/notifications/promo.ts:3", "함수 밖 판정", false],
      ["src/notifications/promo.ts:18", "함수 12~34행 판정", false],
      ["src/notifications/promo.ts:44", "함수 40~58행 판정", true],
    ]);
    expect(row("email-subject-label", "src/mail/weekly.ts", 4).scope).toBe("판정 구역 알 수 없음");
  });

  it("줄이 없는 발견은 파일 이름만 적는다", () => {
    const blast = row("nonemail-end-optout", "src/legacy/blast.js", null);
    expect(blast.where).toBe("src/legacy/blast.js");
    expect(blast.summary).not.toContain("where-tail");
    expect(textOf(blast.summary)).not.toContain("null");
    expect(textOf(blast.body)).toContain("파일 전체를 보고 내린 판정입니다.");
    expect(textOf(blast.body)).not.toContain("줄 번호는");
  });

  it("질문이 실려 있지 않은 대안은 지어내지 않고 그렇다고 적는다", () => {
    const blast = row("nonemail-end-optout", "src/legacy/blast.js", null);
    expect(blast.alternatives).toHaveLength(1);
    const alt = textOf(blast.alternatives[0]);
    const message = "보내는 메시지 본문 끝에서 '무료' 표시가 붙은 080 수신거부 번호를 확인하지 못했습니다.";
    expect(
      inOrder(alt, [
        "optout-080-free",
        message,
        "질문",
        "이 대안에는 질문이 실려 있지 않습니다.",
        "고치는 법",
        "이 대안에는 고치는 법이 실려 있지 않습니다.",
      ]),
      alt,
    ).toBe(true);
    // 메시지나 정책의 질문으로 빈자리를 채우지 않는다.
    expect(count(alt, message)).toBe(1);
    expect(alt).not.toContain("수신거부 방법이 정해진 자리에 들어가나요");
  });

  it("판정 경로가 실려 있지 않으면 그렇다고 적는다", () => {
    const notify = row("nonemail-end-optout", "src/legacy/notify.js", 9);
    expect(notify.path).toBeNull();
    const text = textOf(notify.body);
    expect(inOrder(text, ["판정 경로", "결과에 판정 경로가 실려 있지 않습니다."]), text).toBe(true);
    expect(text).not.toContain("CLI 가 남긴 문장 그대로입니다.");
    // 판정 경로가 있는 발견에는 이 안내가 나오지 않는다.
    expect(textOf(row("nonemail-end-optout", "src/legacy/blast.js", null).body)).not.toContain("판정 경로가 실려 있지 않습니다");
  });
});

describe("경로와 줄을 적는 법", () => {
  const kids = readJson("contract", "cli-current", "kids-signup.main.json") as Report;
  /** 발견 줄에 그려진 경로(code 요소)의 HTML. */
  const code = (file: string, line: number | null) => {
    const { rows } = rowsWithFindings({ ...kids, findings: kids.findings.map((f) => ({ ...f, file, line })) });
    return elementAt(rows[0].summary, rows[0].summary.indexOf("<code>"));
  };
  const BREAK = '<wbr aria-hidden="true"/>';

  it('"/" 뒤에 줄바꿈 자리를 두고, 확장자와 줄 번호는 한 덩어리로 묶는다', () => {
    expect(code("src/auth/signup.ts", 5)).toBe(
      `<code>src/${BREAK}auth/${BREAK}signup<span class="where-tail">.ts:5</span></code>`,
    );
    expect(code("src/app/page.test.tsx", 120)).toBe(
      `<code>src/${BREAK}app/${BREAK}page.test<span class="where-tail">.tsx:120</span></code>`,
    );
  });

  it("글자를 더하거나 빼지 않는다", () => {
    for (const [file, line] of [
      ["src/auth/signup.ts", 5],
      ["src/features/marketing/sms/restock/sendRestockPromotionMessage.ts", 4],
      ["/abs/path/index.js", 1],
      ["Makefile", 3],
      [".env", 2],
      ["src/a.b/c", 7],
      ["src/auth/signup.ts", null],
    ] as const) {
      expect(textOf(code(file, line)), file).toBe(where(file, line));
    }
  });

  it("확장자가 없으면 줄 번호만, 줄이 없으면 아무것도 묶지 않는다", () => {
    expect(code("Makefile", 3)).toBe('<code>Makefile<span class="where-tail">:3</span></code>');
    expect(code(".env", 2)).toBe('<code>.env<span class="where-tail">:2</span></code>');
    expect(code("src/auth/signup.ts", null)).toBe(`<code>src/${BREAK}auth/${BREAK}signup.ts</code>`);
  });

  it("묶은 덩어리는 줄을 바꾸지 못하므로 길면 줄 번호만 묶는다 (좁은 화면에서 넘치지 않게)", () => {
    const long = "notes.a-very-long-extension-name";
    expect(code(long, 12)).toBe(`<code>${long}<span class="where-tail">:12</span></code>`);
    // 묶은 덩어리는 16자를 넘지 않는다.
    for (const [file, line] of [
      ["a.typescript", 1234],
      ["a.typescript", 12345],
      ["a.ts", 123456789],
    ] as const) {
      const tail = textOf(elementAt(code(file, line), code(file, line).indexOf('<span class="where-tail">')));
      expect(tail.length, `${file}:${line}`).toBeLessThanOrEqual(16);
      expect(tail.endsWith(`:${line}`), `${file}:${line}`).toBe(true);
    }
  });
});

describe("발견 줄을 누를 때 (펼침과 글 고르기)", () => {
  // 줄 전체가 펼침 단추다. 경로를 끌어 골라 복사하는 동안에는 줄이 여닫히지 않아야 한다.
  // 브라우저에서 실제로 그렇게 되는지는 이 시험이 보지 못한다(docs/ROADMAP.md 의 8번).
  const click = { detail: 1, selecting: false, extending: false, toggles: 0 };

  it("그냥 누르면 여닫힌다", () => {
    expect(blocksToggle(click)).toBe(false);
    // 끌었어도 골라진 글이 없으면 누른 것이다.
    expect(blocksToggle({ ...click, extending: true })).toBe(false);
  });

  it("끌거나 Shift 를 누른 채 눌러 글을 골랐으면 여닫히지 않는다", () => {
    expect(blocksToggle({ ...click, selecting: true, extending: true })).toBe(true);
  });

  it("이미 골라져 있던 글 위를 그냥 누르면 여닫힌다", () => {
    expect(blocksToggle({ ...click, selecting: true })).toBe(false);
  });

  it("키보드로 누르면 글이 골라져 있어도 여닫힌다", () => {
    expect(blocksToggle({ detail: 0, selecting: true, extending: false, toggles: 0 })).toBe(false);
    expect(blocksToggle({ detail: 0, selecting: true, extending: true, toggles: 0 })).toBe(false);
  });

  it("두 번·세 번 이어 눌러 글을 골라도 처음 상태로 돌아온다", () => {
    // 브라우저가 차례로 보내는 클릭을 그대로 흉내 낸다. 첫 클릭 때는 아직 골라진 글이 없다.
    const run = (clicks: number) => {
      let open = false;
      let toggles = 0;
      for (let detail = 1; detail <= clicks; detail++) {
        if (detail === 1) toggles = 0;
        if (!blocksToggle({ detail, selecting: detail > 1, extending: false, toggles })) {
          open = !open;
          toggles += 1;
        }
      }
      return open;
    };
    expect(run(1)).toBe(true);
    expect(run(2)).toBe(false);
    expect(run(3)).toBe(false);
    expect(run(4)).toBe(false);
  });
});
