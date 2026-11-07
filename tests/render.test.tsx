import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportSummary } from "@/components/result/ReportSummary";
import { blocksToggle } from "@/components/result/selection";
import { packMeta } from "@/lib/pack";
import { SHOWN_PER_LIST } from "@/lib/report/coverage";
import { parseReport } from "@/lib/report/parse";
import { scopeLabel } from "@/lib/report/scope";
import { STATUS_HINT, STATUS_LABEL } from "@/lib/report/status";
import type { Finding, Report } from "@/lib/report/types";
import { buildReportView, type ReportView } from "@/lib/report/view-model";
import { SITE } from "@/lib/site";
import { closedDetailsAt, elementAt, elementsOf, jsonFiles, linesOf, readJson, textOf, withoutKeys } from "./helpers";
import { BANNED_WORDING } from "./wording";

// 결과 화면을 실제로 그려서 글자를 본다. 소스만 보는 시험이 놓치는 것(데이터에서 온 글, 조건에 따라 달라지는 글)을 잡는다.

function viewOf(data: unknown): ReportView {
  const parsed = parseReport(data);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return buildReportView(parsed.report, parsed.contract, packMeta);
}

/** 결과 파일 열기(`/view`)가 그리는 대로 그린다: 판정자가 꺼진 결과에는 켜 보라는 권고를 쪽에 한 번 둔다(`recommend`). */
function renderData(data: unknown): string {
  return renderToStaticMarkup(<ReportSummary view={viewOf(data)} recommend />);
}

function render(...parts: string[]): string {
  return renderData(readJson(...parts));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

const GROUP = '<section class="rule-group">';
const ROW = '<li class="finding">';
const FOLD = '<details class="more">';

/**
 * 규칙 묶음 하나의 HTML. (D5) 묶음 머리(h3)는 같은 규칙이 여러 곳일 때만 있으므로, 발견 줄마다 화면 낭독기에 붙여 둔 규칙 이름
 * (`규칙 id`)으로 묶음을 찾는다.
 */
function ruleGroup(html: string, rule: string): string {
  const head = html.indexOf(`<span class="visually-hidden">규칙 ${rule}</span>`);
  if (head === -1) throw new Error(`규칙 묶음이 없습니다: ${rule}`);
  return elementAt(html, html.lastIndexOf(GROUP, head));
}

/**
 * 발견 줄 하나를 뜯어 본 것. `summary` 는 줄이 닫혀 있어도 보이는 부분이고, 나머지는 펼쳐야 보인다.
 * (D5) 줄의 상태는 정책과 다를 때만 칩으로 보이고, 같으면 화면 낭독기에만 읽힌다(docs/redesign.md 3장). 둘 가운데 있는 것을 읽는다.
 * 대안 id 는 대안마다가 아니라 펼친 안쪽의 id 줄(`<p class="ids">`)에 모여 있다.
 */
function rowParts(row: string) {
  const summary = elementAt(row, row.indexOf("<summary>"));
  const part = (open: string) => {
    const at = summary.indexOf(open);
    return at === -1 ? null : textOf(elementAt(summary, at));
  };
  const hidden = elementsOf(summary, '<span class="visually-hidden">').map(textOf);
  const bodies = elementsOf(row, '<div class="finding-body">');
  const paths = elementsOf(row, '<ol class="path"');
  const ids = elementsOf(row, '<p class="ids">');
  return {
    /** 처음부터 펼쳐져 있는지. */
    open: row.startsWith(`${ROW}<details open="">`),
    summary,
    /** 줄의 첫 줄(첫 미확인 대안의 메시지). 묶음 머리가 같은 메시지를 적었으면 없다. */
    message: part('<span class="msg">'),
    where: part("<code>"),
    scope: part('<span class="finding-scope">'),
    /** 칩이 있으면 칩의 글, 없으면 화면 낭독기에만 읽히는 상태. */
    status: part('<span class="chip ') ?? (hidden.length > 1 ? hidden[0] : null),
    /** 칩으로 보이는지(정책과 상태가 다르다). */
    chip: summary.includes('<span class="chip '),
    rule: hidden.at(-1) ?? null,
    bodies,
    body: bodies[0] ?? "",
    /** 판정 경로 목록의 수. 발견 하나에 하나이거나, 경로가 비어 있으면 없다. */
    pathLists: paths.length,
    /** 판정 경로의 문장들. 경로 목록이 없으면 null. */
    path: paths.length > 0 ? elementsOf(paths[0], "<li>").map(textOf) : null,
    alternatives: elementsOf(row, '<li class="alt">'),
    /** 펼친 안쪽의 id 줄에 적힌 대안 id(실린 차례). */
    alternativeIds: ids.length === 0 ? [] : elementsOf(ids[0], '<code class="alt-id"').map(textOf),
  };
}

/**
 * 그려 낸 화면의 발견 줄(문서 순서)과, 화면 구조가 정한 순서의 발견을 짝지어 준다. (D5) 정책 상자마다 첫 발견만 펼친다
 * (규칙마다 첫 발견이 아니다. docs/redesign.md 3장, 7장 2 승인).
 */
function rowsWithFindings(data: unknown) {
  const view = viewOf(data);
  const html = renderToStaticMarkup(<ReportSummary view={view} recommend />);
  const expected = view.policies.flatMap((policy) =>
    policy.rules.flatMap((group, g) => [
      ...group.shown.map((location, i) => ({ location, first: g === 0 && i === 0, folded: false, policy })),
      ...group.folded.map((location) => ({ location, first: false, folded: true, policy })),
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

/**
 * "이 도구가 보지 못하는 것"의 목록을 뜯어 본 것. 맨 위 항목만 센다(항목 안에 나눠 적은 목록은 `cases` 로 따로 읽는다).
 * `text` 는 항목의 글 전부, `head` 는 나눠 적은 목록 앞의 글이다.
 */
function notSeenItems(html: string) {
  const list = elementAt(html, html.indexOf('<ul class="not-seen">'));
  const inner = elementsOf(list, '<ul class="not-seen-cases">');
  const nested = new Set(inner.flatMap((ul) => elementsOf(ul, "<li>")));
  return elementsOf(list, "<li>")
    .filter((li) => !nested.has(li))
    .map((li) => {
      const at = li.indexOf('<ul class="not-seen-cases">');
      return {
        text: textOf(li),
        head: textOf(at === -1 ? li : li.slice(0, at)),
        cases: at === -1 ? [] : elementsOf(elementAt(li, at), "<li>").map(textOf),
      };
    });
}

const COVERAGE = '<div class="coverage">';
const WARNING = '<section class="warn coverage-warning"';
const GAPS = '<table class="gaps';
const FOLDED = '<details class="fold">';

/**
 * 다 보지 못한 것을 뜯어 본 것: 맨 위 경고, 그 안의 "다 보지 못한 것" 표, 요약 줄의 검사한 파일 수와 검사 정보의 판정 단위 수.
 * 표의 줄마다 이름, 수, 뜻, 처음부터 보이는 파일과 접어 둔 파일을 읽는다.
 *
 * (D5) 늘 있던 커버리지 보기(검사한 파일 수 줄 + 세 줄 표 + 접어 둔 "이 도구가 보지 못하는 것")를 걷었다. 표는 맨 위 경고 안에서만
 * 보이고(경고가 없으면 표도 없다. `rows` 가 null), 파일 수는 요약 줄에, 판정 단위 수는 검사 정보에 있다(docs/redesign.md 3장).
 */
function coverageParts(html: string) {
  const warnAt = html.indexOf(WARNING);
  const boxAt = html.indexOf(COVERAGE);
  const box = boxAt === -1 ? null : elementAt(html, boxAt);
  const tableAt = box === null ? -1 : boxAt + box.indexOf(GAPS);
  const table = tableAt === -1 ? null : elementAt(html, tableAt);
  const inside = (outer: string, open: string) => elementAt(outer, outer.indexOf(open));
  const files = (part: string) => elementsOf(part, '<ul class="gap-files">').flatMap((ul) => elementsOf(ul, "<li>").map(textOf));

  const rows =
    table === null
      ? null
      : elementsOf(inside(table, "<tbody"), "<tr ").map((tr) => {
          const detail = inside(tr, '<td class="gap-detail"');
          const meaningAt = detail.indexOf("<p>");
          const foldAt = detail.indexOf(FOLDED);
          const folds = elementsOf(detail, FOLDED);
          // 뜻 아래에 옅게 덧붙인 말. 접어 둔 곳 안의 안내(결과에 실린 문장 그대로입니다)는 세지 않는다.
          const notes = elementsOf(foldAt === -1 ? detail : detail.slice(0, foldAt), '<p class="hint">').map(textOf);
          return {
            label: textOf(inside(tr, "<th ")),
            count: textOf(inside(tr, '<td class="gap-count"')),
            /** 든 것이 있는 줄인지. 그런 줄만 이름과 수를 경고 색으로 적는다. */
            on: tr.startsWith('<tr class="gap gap-on"'),
            meaning: meaningAt === -1 ? null : textOf(elementAt(detail, meaningAt)),
            note: notes.length === 0 ? null : notes.join(" "),
            /** 처음부터 보이는 파일. */
            shown: files(foldAt === -1 ? detail : detail.slice(0, foldAt)),
            /** 접어 둔 파일(펼침 단추의 글과 함께). */
            folded: folds.filter((fold) => fold.includes('<ul class="gap-files">')).map((fold) => ({
              summary: textOf(inside(fold, "<summary>")),
              files: files(fold),
            })),
            /** 결과에 실린 오류 문장(접어 둔다). */
            texts: folds.filter((fold) => fold.includes('<ul class="gap-texts">')).map((fold) => ({
              summary: textOf(inside(fold, "<summary>")),
              items: elementsOf(inside(fold, '<ul class="gap-texts">'), "<li>").map(textOf),
            })),
          };
        });

  const sumline = inside(html, '<p class="sumline">');
  const info = inside(html, '<section class="box info"');
  const infoRow = (label: string) => {
    const at = info.indexOf(`<dt>${label}</dt>`);
    return at === -1 ? null : textOf(elementAt(info, info.indexOf("<dd", at)));
  };
  return {
    warnAt,
    boxAt,
    tableAt,
    /** 맨 위 경고의 글(머리 띠). 없으면 null. */
    warning: warnAt === -1 ? null : textOf(inside(elementAt(html, warnAt), '<p class="warn-hd"')),
    /** 요약 줄의 검사한 파일 수. */
    files: textOf(elementAt(sumline, sumline.indexOf("<b>", sumline.indexOf("검사한 파일")))),
    /** 검사 정보의 판정 단위 수. */
    units: infoRow("판정 단위"),
    /** 검사 정보의 "결과에 실린 ‘다 보지 못한 파일’" 줄(든 것이 없을 때만 "없음"으로 있다). */
    noGaps: infoRow("결과에 실린 ‘다 보지 못한 파일’"),
    caption: table === null ? null : textOf(inside(table, "<caption>")),
    columns: table === null ? [] : elementsOf(inside(table, "<thead"), "<th ").map(textOf),
    /** 든 것이 하나도 없는 표인지(촘촘히 적는다). */
    none: table?.startsWith('<table class="gaps gaps-none"') ?? null,
    rows,
  };
}

/**
 * JS/TS 파일인데 목록 없이 빠지는 것(CLI 를 합성 폴더에 돌려 확인한 다섯 가지). "이 도구가 보지 못하는 것"의 둘째 항목
 * 아래에 한 줄씩 나눠 적는다. "검사하지 않은 파일: 없음"의 풀이가 이 항목을 가리키므로 하나라도 빠지면 안 된다.
 */
const UNLISTED_CASES = [
  "node_modules·dist·build·vendor·coverage 같은 이름의 폴더 아래 파일(내용이 아니라 폴더 이름으로 가립니다)",
  // .gitignore 만이 아니다. git 이 무시하는 방법 셋 가운데 어느 것으로 무시했든 같게 빠진다.
  "git 저장소에서 git 이 무시하는 파일(.gitignore, .git/info/exclude, 전역 무시 목록)",
  "하위 모듈(submodule)을 비롯해 git 저장소 안에 따로 든 다른 git 저장소의 파일",
  // 폴더를 가리키는 링크도 따라가지 않는다.
  "심볼릭 링크. 검사하는 폴더 안의 링크는 파일을 가리키든 폴더를 가리키든 따라가지 않으므로, 가리키는 곳이 그 폴더 밖에 있으면 그곳의 파일도 보지 못합니다.",
  // 늘 빠지는 것은 아니다(git 이 추적하는 파일이면 검사하기도 한다). 그래서 "빠질 수 있습니다"다.
  "읽을 권한이 없는 폴더 아래 파일. 늘 빠지는 것은 아니고, 목록 없이 빠질 수 있습니다.",
];

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
    // (D5) 본문에 되풀이하던 면책은 지웠다(docs/redesign.md 4장). 면책은 모든 쪽의 바닥글이 싣는다(tests/commitments.test.ts 의
    // "면책 문구가 모든 화면의 바닥에 있다", 브라우저 시험이 쪽마다 본다).
    expect(html).not.toContain(SITE.disclaimer);
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
    // (D5) 권고는 쪽마다 한 번이다(발견마다 붙던 권고는 "판정자 없이 만든 결과입니다" 한 줄로 줄였다. docs/redesign.md 2.3).
    expect(count(textOf(html), "판정자를 켜면 판정 대상 코드가 외부 API 로 나갑니다.")).toBe(1);
    expect(textOf(html)).toContain("AI 에게 묻지 않은 조건: ai-guard. 판정자 없이 만든 결과입니다.");
    // 분석 서비스의 쪽(권고하지 않는다)에는 권고도 외부 API 이야기도 없다.
    const service = renderToStaticMarkup(<ReportSummary view={viewOf(readJson("contract", "cli-current", "kids-signup.main.json"))} />);
    expect(service).not.toContain("외부 API");
  });

  it("판정자를 켰는데 답을 쓰지 못한 경우에는 켜 보라고 하지 않는다", () => {
    const html = render("tests", "fixtures", "judge-on.citation-rejected.json");
    expect(html).not.toContain("판정자를 켜고");
    expect(html).toContain("답을 쓸 수 없었습니다");
    expect(html).toContain("인용한 코드가 확인되지 않았습니다");
  });

  it("AI 가 푼 경고를 숨기지 않고, 나누어 적지 않는다고도 하지 않는다", () => {
    const html = render("tests", "fixtures", "judge-on.cleared.json");
    expect(html).toContain("AI 가 푼 경고 1건");
    expect(html).toContain("const age = calcKoreanAge(form.birthDate);");
    // (D5) 발견 없는 정책 카드의 "풀린 경고가 1건 있습니다"는 곁칸의 줄로 옮겼다(docs/redesign.md 3장 "곁칸"). 그 정책은
    // `발견 없음` 묶음에 넣지 않고, 나누어 적지 않는다는 상태 풀이도 그 정책의 말로 적지 않는다.
    expect(textOf(html)).toContain("발견 없음, AI 가 푼 경고 1건");
    expect(textOf(html)).not.toContain(STATUS_HINT["not-reported"]);
  });

  it("적용 질문으로 빠진 판정을 숨기지 않는다", () => {
    const html = render("tests", "fixtures", "judge-on.dismissed.json");
    expect(html).toContain("빠진 판정 1건");
    expect(html).toContain("아니오");
  });
});

describe("커버리지 보기 (다 보지 못한 것)", () => {
  // 검사하지 않은 파일, 일부를 읽지 못한 파일, 엔진이 끝내지 못한 파일을 한 표로 보인다. 세 목록은 뜻이 다르다.
  // 결과가 다 보지 못했다고 하면(coverage_complete: false) 맨 위에 경고를 둔다(docs/architecture.md 의 "커버리지 보기").
  // (D5) 표는 맨 위 경고 안에서만 보인다. 경고가 없는 결과는 검사 정보가 "결과에 실린 ‘다 보지 못한 파일’ 없음"을 적는다.
  const LABELS = ["검사하지 않은 파일", "일부를 읽지 못한 파일", "엔진이 끝내지 못한 파일"];
  const LEFT_UNCERTAIN = `이 파일의 발견이 '${STATUS_LABEL.uncertain}'로 남았을 수 있습니다.`;
  const MEANING = {
    skipped: "코드를 보지 않았습니다. 이 파일들에서 나올 수 있었던 발견은 결과에 없습니다.",
    unparsed: `검사했지만 구문을 다 읽지 못했습니다. 구문을 봐야 하는 조건이 '모름'이 되어, ${LEFT_UNCERTAIN}`,
    incomplete:
      "검사했지만 엔진이 조건을 끝까지 돌리지 못했거나(시간 초과·메모리 부족 등) 함수 단위 규칙에 쓸 함수 경계를 얻지 못했습니다. " +
      `끝나지 않은 조건이나 함수 경계가 필요한 판정이 '모름'이 되어, ${LEFT_UNCERTAIN}`,
    engineErrors:
      "어느 파일에서 난 오류인지 엔진이 밝히지 않았습니다. CLI 는 이때 함께 검사한 파일을 모두 '엔진이 끝내지 못한 파일'에 넣습니다.",
  };
  /**
   * 검사하지 않은 까닭은 결과에 없다. CLI 가 건너뛰는 다섯 가지만 알리고, 파일마다 짐작해 붙이지 않는다.
   * 둘째는 CLI 가 부르는 이름 그대로 "축소·번들 파일"이다. 축소되지 않은 `app.bundle.js`·`.pnp.cjs` 도 이 까닭으로
   * 건너뛴다(합성 폴더로 확인). "축소 파일"이라고만 적으면 그런 파일은 다섯 가운데 어느 것에도 맞지 않는다.
   */
  const SKIPPED_NOTE =
    "건너뛴 까닭(1MB 초과, 축소·번들 파일, 읽을 권한 없음, .mts 같은 확장자, UTF-8 아님)은 결과에 실려 있지 않습니다.";
  const CAPTION = "다 보지 못한 것 결과에 실린 목록입니다";
  /** 맨 위 경고가 가리키는 곳. 그 이름의 표가 경고 아래에 있다. */
  const POINTER = "아래 '다 보지 못한 것' 표에서 확인하세요.";
  const TOP = `<section class="report">${WARNING}`;
  /** 경고가 없는 결과의 첫 줄: 요약 한 줄(docs/redesign.md 3장). */
  const SUMMARY_FIRST = '<section class="report"><p class="sumline">';
  const NONE = LABELS.map((label) => ({ label, count: "없음", on: false, meaning: null, note: null, shown: [], folded: [], texts: [] }));

  const named = (list: string[][]) => list.map((parts) => [parts.join("/"), parts] as const);
  /** 표의 파일 목록에서 경로를 그린 HTML(문서 순서). 글만 봐서는 줄바꿈 자리가 있는지 알 수 없다. */
  const pathCells = (table: string) =>
    elementsOf(table, '<ul class="gap-files">').flatMap((ul) => elementsOf(ul, "<li>").map((li) => elementAt(li, li.indexOf("<code>"))));
  const runOf = (parts: string[]) => (readJson(...parts) as Report).run;
  const incomplete = () => readJson("tests", "fixtures", "incomplete-coverage.json") as Report;
  const kids = () => readJson("contract", "cli-current", "kids-signup.main.json") as Report;
  const plain = () => readJson("contract", "cli-current", "plain.main.json") as Report;
  const withRun = (data: Report, patch: Partial<Report["run"]>) => renderData({ ...data, run: { ...data.run, ...patch } });

  it("incomplete-coverage: 맨 위에 경고가 있고, 세 목록이 한 표에 뜻에 맞는 설명과 함께 보인다", () => {
    const data = incomplete();
    // 세 목록이 모두 차 있고, 다 보지 못했다고 실린 결과다.
    expect(data.run).toMatchObject({
      coverage_complete: false,
      skipped: ["src/lib/chart.min.js"],
      unparsed: ["src/auth/signup.ts"],
      incomplete: ["src/marketing/campaign.ts"],
      engine_errors: [],
    });
    const html = renderData(data);
    const coverage = coverageParts(html);

    // 경고는 결과 화면의 첫 줄이다. 요약 줄과 발견, 정책 상자보다 앞에 있고, 접혀 있지 않고, 하나뿐이다.
    expect(coverage.warning).toBe(
      `다 보지 못한 검사입니다. 검사하지 않은 파일 1개 · 일부를 읽지 못한 파일 1개 · 엔진이 끝내지 못한 파일 1개. ${POINTER}`,
    );
    expect(html.startsWith(TOP)).toBe(true);
    expect(closedDetailsAt(html, coverage.warnAt)).toEqual([]);
    expect(count(html, WARNING)).toBe(1);

    // "아래 '…' 표"라고 했으니 그 이름의 표가 경고 뒤에 있다. 표는 하나이고, 세 목록이 그 표의 줄이다.
    expect(count(html, "<table")).toBe(1);
    expect(coverage.tableAt).toBeGreaterThan(coverage.warnAt);
    expect(coverage.caption).toBe(CAPTION);
    expect(coverage.columns).toEqual(["목록", "수", "뜻과 파일"]);
    // (D5) 표는 경고 상자 안에 있다.
    expect(coverage.tableAt).toBeLessThan(coverage.warnAt + elementAt(html, coverage.warnAt).length);
    const filled = { count: "1개", on: true, folded: [], texts: [] };
    expect(coverage.rows).toEqual([
      { ...filled, label: LABELS[0], meaning: MEANING.skipped, note: SKIPPED_NOTE, shown: ["src/lib/chart.min.js"] },
      { ...filled, label: LABELS[1], meaning: MEANING.unparsed, note: null, shown: ["src/auth/signup.ts 발견 1건"] },
      { ...filled, label: LABELS[2], meaning: MEANING.incomplete, note: null, shown: ["src/marketing/campaign.ts 발견 3건"] },
    ]);
    // 표와 그 안의 뜻·파일은 아무것도 펼치지 않아도 보인다.
    expect(closedDetailsAt(html, coverage.tableAt)).toEqual([]);
    expect(elementAt(html, coverage.tableAt)).not.toContain("<details");
    // 경로는 발견 줄과 같은 부품으로 그린다. "/" 뒤마다 줄바꿈 자리가 있어 좁은 화면에서 거기서 줄이 바뀐다.
    expect(pathCells(elementAt(html, coverage.tableAt))).toEqual([
      '<code>src/<wbr aria-hidden="true"/>lib/<wbr aria-hidden="true"/>chart.min.js</code>',
      '<code>src/<wbr aria-hidden="true"/>auth/<wbr aria-hidden="true"/>signup.ts</code>',
      '<code>src/<wbr aria-hidden="true"/>marketing/<wbr aria-hidden="true"/>campaign.ts</code>',
    ]);

    // 세 목록의 뜻은 다르다. 설명이 그 차이를 적는다.
    //  - 검사하지 않은 파일: 코드를 보지 않았다. 나올 수 있었던 발견이 결과에 없다.
    //  - 일부를 읽지 못한 파일, 엔진이 끝내지 못한 파일: 검사했다. 결과에 들어 있고 판단 보류로 남았을 수 있다. 까닭이 다르다.
    const [skipped, unparsed, unfinished] = coverage.rows!.map((row) => row.meaning!);
    expect(new Set([skipped, unparsed, unfinished]).size).toBe(3);
    expect(skipped).toBe("코드를 보지 않았습니다. 이 파일들에서 나올 수 있었던 발견은 결과에 없습니다.");
    for (const examined of [unparsed, unfinished]) {
      expect(examined.startsWith("검사했지만 ")).toBe(true);
      expect(examined.endsWith("이 파일의 발견이 '판단 보류(모름)'로 남았을 수 있습니다.")).toBe(true);
      expect(examined).not.toContain("결과에 없습니다");
    }
    expect(unparsed).toContain("구문을 다 읽지 못했습니다.");
    expect(unfinished).toContain("엔진이 조건을 끝까지 돌리지 못했거나");
    // CLI bb76618(7300205 의 조상)부터 함수 경계를 얻지 못한 파일도 run.incomplete 에 실린다. 그 경우를 빼고 적지 않는다.
    expect(unfinished).toContain("함수 경계를 얻지 못했습니다");

    // 설명은 이 결과의 발견과 맞는다. 파일 옆의 수는 그 파일에 나온 발견의 수다. 검사하지 않은 파일에는 발견이 없고
    // 수도 적지 않는다.
    const outcomes = (file: string) => data.findings.filter((f) => f.file === file).map((f) => f.outcome).sort();
    expect(outcomes("src/lib/chart.min.js")).toEqual([]);
    expect(outcomes("src/auth/signup.ts")).toEqual(["needs-review-uncertain"]);
    // 엔진이 끝내지 못한 파일의 발견이 모두 판단 보류인 것은 아니다. 그래서 "남았을 수 있습니다"라고 적는다.
    expect(outcomes("src/marketing/campaign.ts")).toEqual(["needs-review", "needs-review", "needs-review-uncertain"]);

    // 검사한 파일 수와 판정 단위 수는 수만 적는다. 다 봤는지는 경고와 표가 말한다.
    // (D5) 한 줄("파일 3개 검사 · 판정 단위 4개")이던 두 수는 요약 줄과 검사 정보로 옮겼다(docs/redesign.md 2.3 낱말 표).
    expect([coverage.files, coverage.units]).toEqual(["3개", "4개"]);
    // 든 것이 있으므로 검사 정보에 "없음"을 적지 않는다.
    expect(coverage.noGaps).toBeNull();
  });

  const complete = every.filter((parts) => runOf(parts).coverage_complete);

  it("다 본 자료와 다 보지 못한 자료가 모두 있다", () => {
    // 아래의 자료별 시험이 빈 목록을 돌고 통과하는 일이 없게 한다.
    expect(complete.length).toBeGreaterThan(10);
    expect(every.filter((parts) => !runOf(parts).coverage_complete).map((parts) => parts.join("/"))).toEqual([
      "tests/fixtures/incomplete-coverage.json",
    ]);
  });

  it.each(named(complete))("%s: 경고가 없고 검사 정보에 '결과에 실린 다 보지 못한 파일 없음'으로 보인다. 끝까지 봤다고는 적지 않는다", (_name, parts) => {
    const run = runOf(parts);
    const html = render(...parts);
    const coverage = coverageParts(html);
    expect(coverage.warning).toBeNull();
    // (D5) 늘 두던 세 줄 표("없음" 셋)를 걷었다(docs/redesign.md 4장 :381-395, 2.3 낱말 표). 결과의 첫 줄은 요약 줄이다.
    expect(html.startsWith(SUMMARY_FIRST)).toBe(true);
    expect([coverage.files, coverage.units]).toEqual([`${run.files}개`, `${run.units}개`]);
    expect(coverage.rows).toBeNull();
    expect(html).not.toContain("<table");
    // 목록이 비어 있다는 것은 결과에 이름이 실린 파일이 없다는 뜻일 뿐이다. 이름에 "결과에 실린"을 붙여 무엇이 없는지 적는다.
    // 목록 없이 빠지는 파일과 검사한 범위는 결과에 없으므로 "끝까지 봤다"고 적지 않는다.
    expect(coverage.noGaps).toBe("없음");
    expect(html).not.toContain("끝까지 봤습니다");
  });

  it("검사한 파일이 0개인 결과: 끝까지 봤다고 하지 않고, 검사한 파일이 없다고 맨 위에 알린다", () => {
    // 검사할 파일이 없어도 CLI 는 files: 0, engine: null, coverage_complete: true 인 결과를 낸다(빈 폴더를 검사해 확인).
    const html = withRun(plain(), { files: 0, engine: null });
    const coverage = coverageParts(html);
    expect(coverage.warning).toBe("검사한 파일이 없습니다.");
    expect(html.startsWith(TOP)).toBe(true);
    // (D5) 두 수는 요약 줄과 검사 정보에 있다.
    expect([coverage.files, coverage.units]).toEqual(["0개", "0개"]);
    // 경고가 있으면 그 안에 세 목록의 표를 둔다(든 것이 없어도).
    expect(coverage.rows).toEqual(NONE);
    expect(html).not.toContain("끝까지 봤습니다");

    // 축소 파일만 든 폴더를 검사하면 files: 0, skipped: […], coverage_complete: false 가 나온다(합성 폴더로 확인).
    const skippedOnly = coverageParts(
      withRun(plain(), { files: 0, engine: null, skipped: ["src/lib/chart.min.js"], coverage_complete: false }),
    );
    expect(skippedOnly.warning).toBe(`검사한 파일이 없습니다. 검사하지 않은 파일 1개. ${POINTER}`);
    expect(skippedOnly.rows![0]).toMatchObject({ count: "1개", on: true, shown: ["src/lib/chart.min.js"] });
  });

  it("엔진이 실려 있지 않은 결과: 파일 수가 0으로 실려 있지 않아도 맨 위에 알린다", () => {
    // CLI 는 검사할 파일이 없을 때만 엔진 없이 결과를 낸다(CLI 소스 cli.py 의 cmd_scan). 그때 JSON 에는 files: 0 이 함께
    // 실리므로 위의 "검사한 파일이 없습니다"가 나온다. 파일 수가 실려 있지 않은 결과(SARIF 가 그렇다. tests/sarif.test.tsx)
    // 에서는 0개였다고 적지 않고, 결과에 실린 사실(엔진을 돌리지 않았다)과 CLI 가 언제 그렇게 하는지를 적는다.
    const data = plain();
    const run: Partial<Report["run"]> = { ...data.run, engine: null };
    delete run.files;
    const html = renderData({ ...data, run });
    const coverage = coverageParts(html);
    expect(coverage.warning).toBe("엔진을 돌리지 않은 결과입니다. CLI 는 검사할 파일이 없을 때 엔진을 돌리지 않습니다.");
    expect(html.startsWith(TOP)).toBe(true);
    // (D5) "검사한 파일 수 알 수 없음 · 판정 단위 0개" 한 줄의 두 수는 요약 줄과 검사 정보로 옮겼다.
    expect([coverage.files, coverage.units]).toEqual(["알 수 없음", "0개"]);
    expect(textOf(html)).not.toContain("검사한 파일이 없습니다.");
    expect(textOf(html)).not.toContain("파일 0개");
    // 엔진이 실려 있으면 이 경고는 없다.
    delete (data.run as Partial<Report["run"]>).files;
    expect(coverageParts(renderData(data)).warning).toBeNull();
  });

  it("파일 수가 실려 있지 않은 결과: 0이라고 하지 않고 알 수 없다고 적는다", () => {
    const data = kids();
    const run: Partial<Report["run"]> = { ...data.run };
    delete run.files;
    const coverage = coverageParts(renderData({ ...data, run }));
    // (D5) 두 수는 요약 줄과 검사 정보에 있다. 0이라고 하지 않는다.
    expect([coverage.files, coverage.units]).toEqual(["알 수 없음", "1개"]);
    expect(coverage.warning).toBeNull();
  });

  it("목록의 파일이 3곳보다 많으면 앞의 3곳을 먼저 보이고 나머지를 접는다. 순서는 결과에 실린 그대로다", () => {
    expect(SHOWN_PER_LIST).toBe(3);
    // 글자 순서와 다른 순서로 넣어 본다. 웹이 다시 줄 세우지 않는다.
    const skipped = ["src/z.min.js", "src/a.min.js", "src/m.min.js", "src/b.min.js", "src/y.min.js"];
    const html = withRun(kids(), { skipped, coverage_complete: false });
    const [row] = coverageParts(html).rows!;
    expect(row).toMatchObject({
      count: "5개",
      shown: skipped.slice(0, 3),
      folded: [{ summary: "나머지 2개", files: skipped.slice(3) }],
    });
    // 접은 곳은 닫힌 채로 그려진다. 수는 접혀 있어도 줄 머리와 맨 위 경고에 보인다.
    const table = elementAt(html, coverageParts(html).tableAt);
    expect(count(table, FOLDED)).toBe(1);
    expect(table).not.toContain("<details open");
    expect(coverageParts(html).warning).toBe(`다 보지 못한 검사입니다. 검사하지 않은 파일 5개. ${POINTER}`);
    // 접어 둔 곳의 경로도 같은 부품으로 그린다.
    expect(pathCells(table)).toEqual(skipped.map((file) => `<code>src/<wbr aria-hidden="true"/>${file.slice(4)}</code>`));
    // 3곳이면 접지 않는다.
    const three = coverageParts(withRun(kids(), { skipped: skipped.slice(0, 3), coverage_complete: false })).rows![0];
    expect(three).toMatchObject({ count: "3개", shown: skipped.slice(0, 3), folded: [] });
  });

  it("발견이 나온 파일이 접힌 곳에 있으면 접힌 이름 옆에 그 수를 적는다. 순서는 바꾸지 않는다", () => {
    // CLI 는 목록을 제 순서로 낸다. 먼저 보이는 3곳이 모두 "발견 0건"이고 발견이 나온 파일은 접힌 곳에만 있으면,
    // 펼치기 전에는 "이 파일의 발견이 판단 보류로 남았을 수 있습니다"에 걸린 발견이 없는 것처럼 읽힌다.
    const NOTE = "이 가운데 발견이 나온 파일";
    const rowOf = (unparsed: string[]) => {
      const html = withRun(incomplete(), { unparsed });
      return { html, row: coverageParts(html).rows![1] };
    };
    const { html, row } = rowOf(["src/a.ts", "src/b.ts", "src/c.ts", "src/auth/signup.ts", "src/marketing/campaign.ts"]);
    expect(row.shown).toEqual(["src/a.ts 발견 0건", "src/b.ts 발견 0건", "src/c.ts 발견 0건"]);
    expect(row.folded).toEqual([
      { summary: `나머지 2개 ${NOTE} 2개`, files: ["src/auth/signup.ts 발견 1건", "src/marketing/campaign.ts 발견 3건"] },
    ]);
    // 그 수는 접힌 채로 보인다(펼침 단추 안에 있다). 파일마다의 수는 펼쳐야 보인다.
    expect(count(html, NOTE)).toBe(1);
    expect(closedDetailsAt(html, html.indexOf(NOTE))).toEqual([]);
    expect(closedDetailsAt(html, html.indexOf("발견 3건"))).toEqual([FOLDED]);

    // 파일의 수를 센다. 발견의 수(1건 + 3건)를 더하지 않는다. 발견이 없는 파일은 세지 않는다.
    expect(rowOf(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/marketing/campaign.ts"]).row.folded).toEqual([
      { summary: `나머지 2개 ${NOTE} 1개`, files: ["src/d.ts 발견 0건", "src/marketing/campaign.ts 발견 3건"] },
    ]);
    // 접힌 곳에 발견이 나온 파일이 없으면 덧붙이지 않는다. 먼저 보이는 곳의 발견은 이미 보인다.
    const quiet = rowOf(["src/auth/signup.ts", "src/marketing/campaign.ts", "src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(quiet.row.shown).toEqual(["src/auth/signup.ts 발견 1건", "src/marketing/campaign.ts 발견 3건", "src/a.ts 발견 0건"]);
    expect(quiet.row.folded).toEqual([{ summary: "나머지 2개", files: ["src/b.ts 발견 0건", "src/c.ts 발견 0건"] }]);
    expect(quiet.html).not.toContain(NOTE);
    // 3곳 이하라 접지 않으면 덧붙일 곳도 없다.
    expect(rowOf(["src/a.ts", "src/b.ts", "src/marketing/campaign.ts"]).html).not.toContain(NOTE);
  });

  it("한 파일이 두 목록에 함께 실리면 두 줄에 모두 적는다. 엔진 오류는 있을 때만 넷째 줄이다", () => {
    // 어느 파일인지 모르는 엔진 오류가 나면 CLI 는 함께 검사한 파일을 모두 '엔진이 끝내지 못한 파일'에 넣는다. 일부를
    // 읽지 못한 파일도 거기에 함께 실린다(엔진 출력에 오류를 끼워 넣어 확인. docs/architecture.md 의 "커버리지 보기").
    const html = withRun(incomplete(), {
      incomplete: ["src/auth/signup.ts", "src/marketing/campaign.ts", "src/math.ts"],
      engine_errors: ["[Fatal error] Fatal error: exception Stack_overflow"],
    });
    const coverage = coverageParts(html);
    // 세 수를 더한 "다 보지 못한 파일 N개"는 없다. 같은 파일을 두 번 세게 된다.
    expect(coverage.warning).toBe(
      `다 보지 못한 검사입니다. 검사하지 않은 파일 1개 · 일부를 읽지 못한 파일 1개 · 엔진이 끝내지 못한 파일 3개 · 엔진 오류 1건. ${POINTER}`,
    );
    expect(coverage.rows!.map((row) => [row.label, row.count])).toEqual([
      [LABELS[0], "1개"],
      [LABELS[1], "1개"],
      [LABELS[2], "3개"],
      ["엔진 오류", "1건"],
    ]);
    expect(coverage.rows![1].shown).toEqual(["src/auth/signup.ts 발견 1건"]);
    // 발견이 없는 파일도 검사한 파일이다. 0건이라고 적는다.
    expect(coverage.rows![2].shown).toEqual([
      "src/auth/signup.ts 발견 1건",
      "src/marketing/campaign.ts 발견 3건",
      "src/math.ts 발견 0건",
    ]);
    // 결과에 실린 오류 문장은 접어 두고, 펼치면 실린 그대로 보인다. 엔진의 문장 그대로라고는 적지 않는다. CLI 가 오류
    // 종류를 앞에 붙이고 엔진의 문장을 앞 200자까지만 싣기 때문이다(359자 문장을 끼워 넣어 확인: 실린 것은 214자).
    expect(coverage.rows![3]).toEqual({
      label: "엔진 오류",
      count: "1건",
      on: true,
      meaning: MEANING.engineErrors,
      note: null,
      shown: [],
      folded: [],
      texts: [{ summary: "결과에 실린 오류 문장 1개", items: ["[Fatal error] Fatal error: exception Stack_overflow"] }],
    });
    expect(textOf(html)).toContain("결과에 실린 문장 그대로입니다.");
    expect(textOf(html)).not.toContain("엔진이 남긴 문장");
  });

  it("엔진 오류가 문자열이 아니게 실린 결과: 수는 세고, 문장은 문자열인 것만 보인다", () => {
    const rows = (engine_errors: unknown[]) => coverageParts(withRun(kids(), { engine_errors, coverage_complete: false })).rows!;
    expect(rows(["[Timeout] a", { type: "Timeout" }, 3])[3]).toMatchObject({
      count: "3건",
      texts: [{ summary: "결과에 실린 오류 문장 1개", items: ["[Timeout] a"] }],
    });
    expect(rows([{ type: "Timeout" }])[3]).toMatchObject({ count: "1건", meaning: MEANING.engineErrors, texts: [] });
    // 엔진 오류가 없으면 그 줄도 없다.
    expect(rows([])).toHaveLength(3);
  });

  it("결과에 실린 오류 문장은 줄바꿈과 빈칸까지 글자 그대로 옮긴다", () => {
    // CLI 는 엔진의 문장을 양끝만 다듬어 싣는다. 안쪽의 줄바꿈·탭·이어진 빈칸은 남는다(엔진 출력에 끼워 넣어 확인).
    // 화면에서 줄이 바뀌어 보이게 하는 것은 CSS 다(white-space: pre-wrap. 브라우저에서 쟀다). 여기서는 그려 낸 글이
    // 실린 글과 같은지만 본다.
    const texts = [
      "[Fatal error] first line\n\tsecond line with a tab\n    third line with four spaces",
      "[Timeout] <b>not</b> markup & \"quoted\"",
    ];
    const row = coverageParts(withRun(kids(), { engine_errors: texts, coverage_complete: false })).rows![3];
    expect(row.texts).toEqual([{ summary: "결과에 실린 오류 문장 2개", items: texts }]);
  });

  it("결과의 표시(coverage_complete)와 목록이 어긋나도 다 보지 못한 것을 숨기지 않는다", () => {
    // 다 보지 못했다고만 실려 있고 목록은 빈 결과.
    const flagOnly = coverageParts(withRun(kids(), { coverage_complete: false }));
    expect(flagOnly.warning).toBe(
      "다 보지 못한 검사입니다. 결과에는 다 보지 못했다고만 실려 있고, 무엇을 보지 못했는지는 실려 있지 않습니다.",
    );
    expect(flagOnly.rows).toEqual(NONE);
    // 목록이 비어 있지 않은데 다 봤다고 실린 결과. CLI 는 이렇게 내지 않지만, 연 파일이 그렇다면 목록을 믿는다.
    const listOnly = coverageParts(withRun(kids(), { unparsed: ["src/auth/signup.ts"], coverage_complete: true }));
    expect(listOnly.warning).toBe(`다 보지 못한 검사입니다. 일부를 읽지 못한 파일 1개. ${POINTER}`);
    expect(listOnly.rows![1]).toMatchObject({ count: "1개", on: true, shown: ["src/auth/signup.ts 발견 1건"] });
    expect(listOnly.none).toBe(false);
  });

  describe("검사에 들지 않는 파일과 정보 (예전 이름 '이 도구가 보지 못하는 것')", () => {
    // 목록 없이 빠지는 파일(git 이 무시하는 파일, 이름으로 가리는 폴더 등)과 검사한 범위 밖의 파일은 결과에 없다. 발견이 0인
    // 결과에서는 그것이 0의 뜻과 이어지므로 본문에 펼쳐 둔다. (D5) 발견이 있는 결과에서는 표 아래에 접어 두던 것을 조문 도감
    // (#scope)으로 옮기고, 쪽 아래 검사 정보에 그곳으로 가는 링크를 둔다(docs/redesign.md 3장, 7장 2 오너 승인, 4장 :575-635).
    const findingsIn = (parts: string[]) => (readJson(...parts) as Report).findings.length;
    const withFindings = every.filter((parts) => findingsIn(parts) > 0);
    const empties = every.filter((parts) => findingsIn(parts) === 0);
    const LINK = `<a href="/policy#scope">${SITE.notSeen.title}</a>`;

    it("발견이 있는 자료와 없는 자료가 모두 있다", () => {
      expect(withFindings.length).toBeGreaterThan(5);
      expect(empties.length).toBeGreaterThan(5);
    });

    it.each(named(withFindings))("%s: 펼치지 않고 검사 정보의 링크로 둔다", (_name, parts) => {
      const html = render(...parts);
      expect(html).not.toContain('<ul class="not-seen">');
      // 링크는 쪽 아래 검사 정보 안에 있고, 이름이 목록의 이름과 같다.
      const info = elementAt(html, html.indexOf('<section class="box info"'));
      expect(info).toContain(LINK);
      expect(count(html, LINK)).toBe(1);
      expect(SITE.notSeen.title).toBe("검사에 들지 않는 파일과 정보");
    });

    it.each(named(empties))("%s: 발견이 0이면 본문에 펼친 채로 한 번 보인다", (_name, parts) => {
      const html = render(...parts);
      expect(html).not.toContain(LINK);
      expect(count(html, '<ul class="not-seen">')).toBe(1);
      expect(closedDetailsAt(html, html.indexOf('<ul class="not-seen">'))).toEqual([]);
      expect(textOf(html)).toContain(SITE.notSeen.lead);
      expect(textOf(html)).not.toContain(SITE.notSeen.leadWithFindings);
    });

    it("다른 판의 팩으로 만든 결과: 대상 언어를 알 수 없다는 말이 펼친 목록에 붙는다", () => {
      const other = withRun(plain(), { pack_digest: "0000000000000000" });
      expect(textOf(other)).toContain(SITE.notSeen.otherPack);
      expect(textOf(render("contract", "cli-current", "plain.main.json"))).not.toContain("다른 언어도 검사하는지");
    });
  });
});

describe("빈 결과 화면 (발견이 0인 결과)", () => {
  // 발견이 없다는 것만으로는 무엇을 봤는지 알 수 없다. 검사한 것과 이 도구가 보지 못하는 것을 함께 적는다.
  const CARD = '<article class="box policy ';
  const EMPTY = '<div class="empty-report">';
  const NOT_SEEN_BOX = '<section class="box not-seen-box"';
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

  /**
   * 정책 하나를 뜯어 본 것. (D5) 발견이나 충족 근거 위치가 있는 정책은 본문의 상자이고, 나머지는 곁칸 `정책 N` 의 줄이다
   * (docs/redesign.md 3장). 상태 풀이 문장은 정책마다 적지 않는다(상태의 뜻은 조문 도감 #status 한 곳. 8장 반박 (2)).
   * 상자: 조문, 제목, 칩, 정책별 판정 단위 수(아는 때만), 충족 근거 위치. 곁칸의 줄: 제목, 묶음의 상태, 정책별 판정 단위 수.
   * AI 가 푼 경고만 있는 정책은 곁칸에서 `발견 없음, AI 가 푼 경고 N건` 으로 따로 선다(`cleared`).
   */
  function cardParts(card: string) {
    const part = (open: string) => {
      const at = card.indexOf(open);
      return at === -1 ? null : textOf(elementAt(card, at));
    };
    const lawAt = card.search(/<(a|p)\b[^>]*class="law"/);
    const evidence = card.indexOf('<ul class="evidence"');
    const units = UNITS.exec(part('<p class="hint pbox-units">') ?? "")?.[1];
    return {
      boxed: true,
      law: lawAt === -1 ? null : textOf(elementAt(card, lawAt)),
      title: part('<h2 class="t"'),
      status: part('<span class="chip '),
      /** 정책별 판정 단위 수. 적혀 있지 않으면 null. */
      units: units === undefined ? null : Number(units),
      /** 충족 근거 위치. */
      evidence: evidence === -1 ? [] : elementsOf(elementAt(card, evidence), "<li>").map(textOf),
      cleared: null as string | null,
    };
  }

  function sideParts(html: string) {
    const side = elementAt(html, html.indexOf('<details class="box side-pol"'));
    const cleared = elementsOf(side, '<li class="p">')
      .filter((row) => row.includes('<span class="ai">'))
      .map((row) => {
        const ai = textOf(elementAt(row, row.indexOf('<span class="ai">')));
        return {
          boxed: false,
          law: null,
          title: textOf(row.slice(0, row.indexOf('<span class="ai">'))),
          status: ai.slice(0, ai.indexOf(",")),
          units: null,
          evidence: [],
          cleared: ai,
        };
      });
    const grouped = elementsOf(side, '<div class="side-group">').flatMap((group) => {
      const label = textOf(elementAt(group, group.indexOf('<p class="lbl">'))).replace(/ \d+$/, "");
      return elementsOf(group, "<li>").map((li) => {
        const at = li.indexOf('<span class="u">');
        const units = at === -1 ? null : Number(/(\d+)개/.exec(textOf(elementAt(li, at)))![1]);
        return { boxed: false, law: null, title: textOf(at === -1 ? li : li.slice(0, at)), status: label, units, evidence: [], cleared: null };
      });
    });
    return [...cleared, ...grouped];
  }
  /** 이 결과의 정책 전부: 본문의 상자(차례대로), 그다음 곁칸의 줄. */
  const cards = (html: string) => [...elementsOf(html, CARD).map(cardParts), ...sideParts(html)];

  /** 빈 결과 구역(검사한 것)과 그 아래의 검사에 들지 않는 파일과 정보를 뜯어 본 것. 구역이 없으면 null. */
  function emptyParts(html: string) {
    const at = html.indexOf(EMPTY);
    if (at === -1) return null;
    const panel = elementAt(html, at);
    const scopeAt = html.indexOf(NOT_SEEN_BOX);
    const scope = scopeAt === -1 ? "" : elementAt(html, scopeAt);
    const rows = elementsOf(elementAt(panel, panel.indexOf('<dl class="examined">')), "<div>");
    return {
      headings: [...elementsOf(panel, "<h2>"), ...elementsOf(scope, "<h2")].map(textOf),
      /** "검사한 것"의 줄. 이름표 → 값과 설명, 눈에 띄게 한 줄인지. */
      facts: Object.fromEntries(
        rows.map((row) => {
          const label = textOf(elementAt(row, row.indexOf("<dt>")));
          const dd = elementAt(row, row.indexOf("<dd"));
          return [label, { text: textOf(dd), warn: dd.startsWith('<dd class="warn">') }];
        }),
      ),
      /** 보지 못하는 것의 맨 위 항목(나눠 적은 목록 앞의 글)과, 항목 안에 나눠 적은 목록. */
      notSeen: scope === "" ? [] : notSeenItems(scope).map((item) => item.head),
      notSeenCases: scope === "" ? [] : notSeenItems(scope).map((item) => item.cases),
      text: `${textOf(panel)} ${textOf(scope)}`,
    };
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

  it.each(named(empties))("%s: 검사한 것과 검사에 들지 않는 파일과 정보를 적는다", (_name, parts) => {
    const html = render(...parts);
    const empty = emptyParts(html);
    expect(empty).not.toBeNull();
    // (D5) 둘째 구역의 이름은 "검사에 들지 않는 파일과 정보"다(docs/redesign.md 2.3 낱말 표, 4장 :637-770).
    expect(empty!.headings).toEqual(["검사한 것", "검사에 들지 않는 파일과 정보"]);
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
    // (D5 검토 반영) 곁칸 `정책 N` 은 넓은 화면에서 오른쪽이라 "아래"라고 하지 않고 그 이름(‘정책 N’)으로 부른다(examined.ts).
    expect(empty!.facts["정책"].text).toMatch(new RegExp(`^${policies}개\\. .*‘정책 ${policies}’에`));
    // (D5) 정책은 상자(충족 근거가 있는 정책)와 곁칸 `정책 N` 의 줄로 모두 보인다. N 은 데이터에서 센다.
    expect(cards(html)).toHaveLength(policies);
    expect(html).toContain(`정책 <span class="count">${policies}</span>`);
    // 판정 단위가 무엇인지도 적는다(적용 조건이 거짓이면 단위가 생기지 않는다).
    expect(empty!.text).toContain("판정 단위는 규칙의 적용 조건이 참이거나 모름이어서 판정한 곳입니다.");
    // 보지 못하는 것 다섯: JS/TS 밖, 목록 없이 빠지는 JS/TS 파일, 검사한 범위 밖의 파일, 서버 설정, 데이터에만 있는 동의 상태.
    expect(empty!.notSeen).toHaveLength(5);
    expect(empty!.notSeen[0]).toMatch(/^JS\/TS 가 아닌 파일: .*검사하지 않고, '검사하지 않은 파일'에도 싣지 않습니다\.$/);
    // 검사하지 않은 파일 목록이 비어 있어도 다 본 것이 아니다. JS/TS 파일인데 목록에 실리지 않고 빠지는 것을 따로 적는다
    // (CLI 를 합성 폴더에 돌려 확인한 것: 이름으로 가리는 폴더, git 이 무시하는 파일, 하위 모듈처럼 저장소 안에 따로 든
    // 다른 git 저장소, 심볼릭 링크, 읽을 권한이 없는 폴더). "검사하지 않은 파일: 없음"의 풀이가 이 항목을 가리키므로
    // 하나라도 빠지면 안 된다.
    expect(empty!.notSeen[1]).toBe(
      "목록 없이 빠지는 JS/TS 파일: 폴더를 검사할 때 아래 파일은 JS/TS 파일이어도 검사하지 않고, '검사하지 않은 파일'에도 싣지 않습니다.",
    );
    // 한 문단에 담으면 좁은 화면에서 14줄이 된다. 까닭마다 한 줄로 나눠 적는다. 나눠 적는 것은 이 항목뿐이다.
    expect(empty!.notSeenCases).toEqual([[], UNLISTED_CASES, [], [], []]);
    // 범위를 좁혀 돌린 검사에서는 그 밖의 파일도 목록 없이 빠진다. 결과에 범위가 없으므로 어느 자료에서나 같은 말이다.
    expect(empty!.notSeen[2]).toBe(OUT_OF_SCOPE);
    expect(empty!.notSeen[3]).toMatch(/^서버·인프라 설정: .*보지 못합니다/);
    expect(empty!.notSeen[4]).toMatch(/^데이터에만 있는 동의 상태: .*코드를 읽어서는 알 수 없습니다/);
    expect(empty!.text).toContain(SITE.notSeen.lead);
    expect(SITE.notSeen.lead).toContain("발견이 없어도 아래까지 확인한 것은 아닙니다");
    // 팩 판이 같으면 대상 언어(JS/TS)를 안다. 다른 판의 팩일 때 덧붙이는 말은 나오지 않는다.
    expect(empty!.text).not.toContain("다른 언어도 검사하는지");
    // 처음부터 보인다(접어 두지 않는다). (D5) 요약 줄 → 0의 뜻(굵게) → 검사한 것 → (AI 가 푼 경고) → 검사에 들지 않는 파일과
    // 정보 순서다(docs/redesign.md 3장 "발견 0"). 곁칸(정책 N)은 본문 다음이다.
    expect(closedDetailsAt(html, html.indexOf(EMPTY))).toEqual([]);
    expect(closedDetailsAt(html, html.indexOf(NOT_SEEN_BOX))).toEqual([]);
    expect(html).toContain(`<p class="zero-line">${SITE.zeroIsNotClearance}</p>`);
    const order = [
      html.indexOf('<p class="sumline">'),
      html.indexOf('<p class="zero-line">'),
      html.indexOf(EMPTY),
      html.indexOf(NOT_SEEN_BOX),
      html.indexOf('<details class="box side-pol"'),
    ];
    expect(order.every((at) => at !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    if (html.includes('<div class="ai-decisions">')) {
      expect(html.indexOf('<div class="ai-decisions">')).toBeGreaterThan(html.indexOf(EMPTY));
      expect(html.indexOf('<div class="ai-decisions">')).toBeLessThan(html.indexOf(NOT_SEEN_BOX));
    }
  });

  it.each(named(others))("%s: 발견이 있으면 빈 결과 구역이 없다", (_name, parts) => {
    const html = render(...parts);
    expect(emptyParts(html)).toBeNull();
    expect(html).not.toContain("<h2>검사한 것</h2>");
    // (D5) 발견이 있는 결과에서는 펼친 구역 대신 검사 정보의 링크(조문 도감 #scope)다(위 "커버리지 보기"가 본다).
    expect(html).not.toContain(NOT_SEEN_BOX);
  });

  it.each(named(every))("%s: 곁칸에 발견이 없는 정책이 보이면 그 아래에 0의 뜻이 있다", (_name, parts) => {
    // (D5 검토 반영) 정책마다 적던 상태 풀이(STATUS_HINT, '법적 문제가 없다는 뜻은 아닙니다' 포함)는 곁칸의 묶음으로 옮겼다.
    // 그 약속(0의 뜻)은 묶음 아래의 한 줄이 지킨다. AI 가 푼 경고만 있는 정책의 `발견 없음` 줄도 같다.
    const html = render(...parts);
    const side = elementAt(html, html.indexOf('<details class="box side-pol"'));
    const quiet = side.includes('<div class="side-group">') || side.includes('<span class="ai">');
    const zero = `<p class="z">${SITE.zeroIsNotClearance}</p>`;
    expect(side.includes(zero)).toBe(quiet);
    if (quiet) {
      const last = Math.max(side.lastIndexOf('<div class="side-group">'), side.lastIndexOf('<span class="ai">'));
      expect(side.indexOf(zero)).toBeGreaterThan(last);
    }
  });

  it("v1 초안: plain.main 과 kids-signup.fixed 가 서로 다른 설명을 보인다", () => {
    const plain = cards(render("contract", "samples-v1-draft", "plain.main.json"));
    const fixed = cards(render("contract", "samples-v1-draft", "kids-signup.fixed.json"));
    expect(plain).toHaveLength(5);
    expect(fixed).toHaveLength(5);

    // plain.main: 다섯 정책 모두 적용 신호 없음이고 판정 단위가 0개다. (D5) 다섯 모두 곁칸의 `적용 신호 없음 5` 묶음에 있다.
    // 상태 풀이 문장(STATUS_HINT)은 정책마다 적지 않는다(docs/redesign.md 8장 반박 (2)). 그 묶음 아래에 0의 뜻이 있다.
    for (const card of plain) {
      expect(card, card.title ?? "").toMatchObject({
        boxed: false,
        status: "적용 신호 없음",
        units: 0,
        evidence: [],
      });
    }

    // kids-signup.fixed: 제22조의2 는 충족 근거 발견이고, 어디서 어느 대안이 확인됐는지 보인다.
    const pipa = fixed.find((card) => card.title === PIPA)!;
    expect(pipa).toEqual({
      boxed: true,
      law: "개인정보 보호법 제22조의2 제1항",
      title: PIPA,
      status: "충족 근거 발견",
      units: 1,
      evidence: ["src/auth/signup.ts:7 에서 대안 under14-branch 확인"],
      cleared: null,
    });
    // 가장 먼저 봐야 할 것이 위에 온다.
    expect(fixed[0]).toBe(pipa);

    // 같은 정책이 두 결과에서 다르다: 상태, 판정 단위 수, 충족 근거 위치, 상자인지 곁칸의 줄인지.
    const before = plain.find((card) => card.title === PIPA)!;
    expect(pipa.status).not.toBe(before.status);
    expect(pipa.units).not.toBe(before.units);
    expect(pipa.evidence).not.toEqual(before.evidence);
    expect([before.boxed, pipa.boxed]).toEqual([false, true]);
    // 화면의 상태 이름은 상태 문구(src/lib/report/status.ts)에서 온 것이다.
    expect([before.status, pipa.status]).toEqual([STATUS_LABEL["no-signal"], STATUS_LABEL["evidence-found"]]);
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
        text: `${units}개. 모든 정책을 합친 수입니다. 정책별 수는 ‘정책 5’에 정책마다 적었습니다.`,
        warn: false,
      });
      expect(facts["정책"].text, file).toBe("5개. 결과에 정책별 요약이 실려 있어, ‘정책 5’에 정책마다 적었습니다.");
    }
  });

  it("v1 초안: 발견이 있는 정책에도 정책별 판정 단위 수를 적는다", () => {
    const html = render("contract", "samples-v1-draft", "kids-signup.main.json");
    // (D5) 발견이 있는 정책은 상자에, 나머지는 곁칸의 줄에 정책별 수를 적는다.
    const texts = elementsOf(html, CARD).map(textOf);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain(PIPA);
    expect(texts[0]).toContain("이 정책의 판정 단위는 1개입니다.");
    const all = cards(html);
    expect(all).toHaveLength(5);
    for (const card of all.slice(1)) expect(card.units, card.title ?? "").toBe(0);
  });

  it("CLI 0.3 판 번호 없는 출력: 같은 두 결과는 정책 카드의 설명이 같고 전체 판정 단위 수만 다르다. 그 한계를 적는다", () => {
    // 판 번호 없는 출력(CLI 8ae72d8 까지)에는 정적 대안으로 풀린 단위(run.static_cleared)가 없었다. 수집본에서 그것을 빼서 본다.
    const old = (file: string) =>
      renderData(withoutKeys(readJson("contract", "cli-current", file) as Report, ["schema_version"], ["static_cleared"]));
    const plain = old("plain.main.json");
    const fixed = old("kids-signup.fixed.json");

    // 정책 카드는 글자까지 같다. 정책별로 "적용 신호를 본 곳"을 알 수 없어서 모두 발견 없음이다.
    expect(cards(fixed)).toEqual(cards(plain));
    for (const card of cards(plain)) {
      // 정책별 수는 짐작해서 적지 않는다(units: null). (D5) 상태 풀이는 정책마다 적지 않는다(곁칸 `발견 없음 5` 묶음).
      expect(card, card.title ?? "").toMatchObject({
        status: "발견 없음",
        units: null,
        evidence: [],
      });
    }
    expect(STATUS_HINT["not-reported"]).toContain("'충족 근거 발견'과 '적용 신호 없음'으로 나누어 적지 않습니다");
    expect(plain).not.toContain("이 정책의 판정 단위");
    expect(fixed).not.toContain("이 정책의 판정 단위");

    // 화면 전체에서 다른 줄은 둘뿐이다: 전체 판정 단위 수가 든 줄과, 그 수 옆에 적은 한계.
    // 0이면 정책별 수도 모두 0이라 "정책별 수가 없다"는 한계가 아니다. 어느 정책에서도 판정한 곳이 없다고 적고,
    // 그런데도 카드가 "발견 없음"(나누어 적지 않는다)인 까닭을 함께 적는다. 카드의 상태는 바꾸지 않는다.
    const [a, b] = [linesOf(plain), linesOf(fixed)];
    expect(b).toHaveLength(a.length);
    // (D5) "파일 1개 검사 · 판정 단위 N개" 한 줄의 판정 단위 수는 쪽 아래 검사 정보의 값으로 옮겼다.
    expect(a.flatMap((line, i) => (line === b[i] ? [] : [[line, b[i]]]))).toEqual([
      [
        "0개. 모든 정책을 합친 수입니다. 0이므로 어느 정책에서도 판정한 곳이 없습니다. 다만 이 출력 형식(CLI 0.3)에는 정책별 요약이 없어, ‘정책 5’의 정책은 판정 단위가 있는 결과와 같은 '발견 없음'으로 묶입니다.",
        "1개. 모든 정책을 합친 수입니다. 이 출력 형식(CLI 0.3)에는 정책별 수가 없어서, 어느 정책에서 적용 신호를 봤는지 알 수 없습니다.",
      ],
      ["0개", "1개"],
    ]);
    expect(emptyParts(fixed)!.facts["정책"].text).toBe(
      "5개. 결과에는 정책 목록이 없어, 팩 판이 같은 이 사이트의 팩에서 가져와 ‘정책 5’에 적었습니다.",
    );
  });

  it("CLI 결과 판 1: 정적 대안으로 풀린 단위가 실린 정책만 충족 근거 발견이고 그 자리를 적는다. 다른 카드와 정책별 수는 그대로다", () => {
    const plain = render("contract", "cli-current", "plain.main.json");
    const fixed = render("contract", "cli-current", "kids-signup.fixed.json");
    const [pipa, ...rest] = cards(fixed);
    expect(pipa).toMatchObject({
      boxed: true,
      title: PIPA,
      status: "충족 근거 발견",
      // 결과의 run.static_cleared 에 실린 파일, 대안이 맞은 줄, 대안 id 그대로다.
      evidence: ["src/auth/signup.ts:7 에서 대안 under14-branch 확인"],
      // 정책별 수는 여전히 결과에 없다. 짐작해 적지 않는다.
      units: null,
    });
    expect(rest).toEqual(cards(plain).filter((card) => card.title !== PIPA));
    expect(fixed).not.toContain("이 정책의 판정 단위");
    expect(emptyParts(fixed)!.facts["판정 단위"].text).toBe(
      "1개. 모든 정책을 합친 수입니다. 이 출력 형식(CLI 0.3)에는 정책별 수가 없어서, 어느 정책의 것인지는 아래 정책 상자의 충족 근거 위치에 실린 것만 알 수 있습니다.",
    );
  });

  it("CLI 0.3: 판정 단위가 0개여도 판정한 곳이 없다고 적을 수 없는 경우가 있다", () => {
    const data = readJson("contract", "cli-current", "plain.main.json") as Report;
    const units = (run: Partial<Report["run"]>) => emptyParts(renderData({ ...data, run }))!.facts["판정 단위"].text;
    const none = "0개. 모든 정책을 합친 수입니다. 0이므로 어느 정책에서도 판정한 곳이 없습니다.";
    const sameCards =
      " 다만 이 출력 형식(CLI 0.3)에는 정책별 요약이 없어, ‘정책 5’의 정책은 판정 단위가 있는 결과와 같은 '발견 없음'으로 묶입니다.";
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
    // 판정 단위가 있을 때. 정적 대안으로 풀린 단위가 실려 있으면 그 자리를 가리킨다.
    const fixed = readJson("contract", "cli-current", "kids-signup.fixed.json") as Report;
    expect(units(fixed)).toBe(
      `1개. ${total} ${format}, 어느 정책의 것인지는 아래 정책 상자의 충족 근거 위치에 실린 것만 알 수 있습니다. ${notCounted(2)}`,
    );
    expect(units(fixed, { static_cleared: [] })).toBe(
      `1개. ${total} ${format}, 어느 정책에서 적용 신호를 봤는지 알 수 없습니다. ${notCounted(2)}`,
    );
    // AI 가 푼 경고와 정적 대안으로 풀린 단위가 함께 있을 때.
    const cleared = readJson("tests", "fixtures", "judge-on.cleared.json") as Report;
    expect(units(cleared, { static_cleared: fixed.run.static_cleared })).toBe(
      `1개. ${total} ${format}, 어느 정책의 것인지는 아래 'AI 가 푼 경고'와 정책 상자의 충족 근거 위치에 실린 것만 알 수 있습니다. ${notCounted(2)}`,
    );
    // v1 초안. run.units 는 같은 필드다(스키마가 같은 정의를 가리킨다).
    expect(units(readJson("contract", "samples-v1-draft", "plain.main.json") as Report)).toBe(
      `0개. ${total} 정책별 수는 ‘정책 5’에 정책마다 적었습니다. ${notCounted(2)}`,
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
    // (D5) 가리키는 구역의 이름은 "검사에 들지 않는 파일과 정보"다(SITE.notSeen.title).
    expect(empty.facts["검사하지 않은 파일"].text).toContain(`이름이 실리지 않고 빠지는 파일은 아래 '${SITE.notSeen.title}'에 있습니다.`);
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
        `이름이 실리지 않고 빠지는 파일은 아래 '${SITE.notSeen.title}'에 있습니다.`,
      warn: false,
    });
    // "아래 '…'"라고 했으니 그 이름의 구역이 이 줄 뒤에 있고, 거기에 그 파일들이 적혀 있다.
    // (D5) 이름은 "검사에 들지 않는 파일과 정보"로 바꿨다(docs/redesign.md 2.3 낱말 표).
    const section = plain.indexOf(`<h2 id="not-seen-title">${SITE.notSeen.title}</h2>`);
    expect(SITE.notSeen.title).toBe("검사에 들지 않는 파일과 정보");
    expect(section).toBeGreaterThan(plain.indexOf("이름이 실리지 않고 빠지는 파일은"));
    expect(
      emptyParts(plain)!
        .notSeen.filter((item) => item.includes("'검사하지 않은 파일'에도 싣지 않습니다"))
        .map((item) => item.slice(0, item.indexOf(":"))),
    ).toEqual(["JS/TS 가 아닌 파일", "목록 없이 빠지는 JS/TS 파일", "검사한 범위 밖의 파일"]);

    const skipped = ["src/legacy/euckr.js", "src/vendor-lib/chart.min.js"];
    const html = renderData({ ...data, run: { ...data.run, skipped, coverage_complete: false } });
    expect(emptyParts(html)!.facts["검사하지 않은 파일"]).toEqual({
      text: "2개. 위 '다 보지 못한 것' 표에 목록이 있습니다. 이 파일들의 코드는 보지 못했습니다.",
      warn: true,
    });
    // "위 '…' 표에 목록이 있다"고 했으니 그 이름의 표가 빈 결과 구역보다 앞에 있고, 그 표의 '검사하지 않은 파일' 줄에
    // 파일 이름이 처음부터 보인다(이 둘은 접히지 않는다. 3곳보다 많을 때만 나머지를 접는다).
    const coverage = coverageParts(html);
    expect(coverage.caption!.startsWith("다 보지 못한 것")).toBe(true);
    expect(coverage.tableAt).toBeLessThan(html.indexOf(EMPTY));
    expect(closedDetailsAt(html, coverage.tableAt)).toEqual([]);
    expect(coverage.rows![0]).toMatchObject({ label: "검사하지 않은 파일", count: "2개", on: true, shown: skipped, folded: [] });
    // 발견이 0인 결과에서는 검사에 들지 않는 파일과 정보를 본문이 한 번만 펼쳐 보인다.
    expect(count(html, '<ul class="not-seen">')).toBe(1);
    expect(count(plain, '<ul class="not-seen">')).toBe(1);
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
    // (D5 검토 반영) 곁칸 `정책 N` 은 넓은 화면에서 오른쪽이라 "아래"라고 하지 않고 그 이름(‘정책 N’)으로 부른다(examined.ts).
    const asSummarized = (shown: number) => `결과에 정책별 요약이 실려 있어, ‘정책 ${shown}’에 정책마다 적었습니다.`;

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
        line: `3개. ${asSummarized(3)}`,
        stated: 3,
        cards: 3,
        withUnits: 3,
        statuses: ["적용 신호 없음"],
      });
      // 요약이 그 팩의 정책 목록이므로 "그 팩에 있었는지 알 수 없는" 카드는 없다. 결과 머리의 알림도 그 말을 하지 않는다.
      expect(textOf(html)).toContain("팩의 판이 다릅니다. 정책 설명이 결과와 맞지 않을 수 있습니다.");
      expect(textOf(html)).not.toContain("그 팩에 있었는지");
      expect(emptyParts(html)!.facts["판정 단위"].text).toBe("0개. 모든 정책을 합친 수입니다. 정책별 수는 ‘정책 3’에 정책마다 적었습니다.");

      // 충족 근거가 실린 예시로도 본다.
      const two = withRun(fixed, { pack_digest: OTHER, policies: fixed.run.policies!.slice(0, 2) });
      expect(counts(two)).toMatchObject({ stated: 2, cards: 2, withUnits: 2, statuses: ["적용 신호 없음", "충족 근거 발견"] });
    });

    it("같은 판의 팩인데 요약이 일부뿐인 결과: 요약에 없는 정책을 '발견 없음' 카드로 채우지 않는다", () => {
      const html = withRun(draft, { policies: draft.run.policies!.slice(0, 2) });
      expect(counts(html)).toEqual({ line: `2개. ${asSummarized(2)}`, stated: 2, cards: 2, withUnits: 2, statuses: ["적용 신호 없음"] });
      expect(textOf(html)).not.toContain(STATUS_HINT["not-reported"]);
    });

    it("이 사이트의 팩에 없는 정책이 요약에 있으면 그 정책도 카드로 그린다 (조문 도감으로 잇지는 않는다)", () => {
      const html = withRun(draft, { pack_digest: OTHER, policies: [...draft.run.policies!.slice(0, 2), unknownPolicy] });
      expect(counts(html)).toMatchObject({ line: `3개. ${asSummarized(3)}`, stated: 3, cards: 3, withUnits: 3 });
      // (D5) 충족 근거 위치가 실리지 않은 정책이라 곁칸의 `충족 근거 발견` 묶음에 한 줄로 있다.
      expect(cards(html).find((c) => c.title === "kr.other.99")).toMatchObject({ boxed: false, status: "충족 근거 발견", units: 2 });
      const row = elementsOf(html, "<li>").find((li) => li.includes("kr.other.99") && !li.includes("<li>", 1))!;
      expect(row).not.toContain("<a ");
    });

    it("요약이 빈 결과: 0개라고 눈에 띄게 적고, 요약이 실려 있다고도 정책마다 적었다고도 하지 않는다", () => {
      for (const pack_digest of [draft.run.pack_digest, OTHER]) {
        const html = withRun(draft, { pack_digest, policies: [] });
        const empty = emptyParts(html)!;
        expect(empty.facts["정책"], pack_digest).toEqual({
          text: "0개. 결과의 정책별 요약이 비어 있습니다. ‘정책 0’에 적을 정책이 없습니다.",
          warn: true,
        });
        expect(empty.facts["판정 단위"].text, pack_digest).toBe(
          "0개. 모든 정책을 합친 수입니다. 결과의 정책별 요약이 비어 있어 정책별 수가 없습니다.",
        );
        // 카드가 없다. 빈 상자도 그리지 않는다.
        expect(cards(html), pack_digest).toEqual([]);
        expect(html, pack_digest).not.toContain('<div class="policies">');
        expect(textOf(html), pack_digest).not.toContain("정책별 요약이 실려 있어");
      }
    });

    it("요약에 없는 정책이 AI 가 푼 경고에만 나오면, 그 카드는 요약에서 온 것이 아니라고 적는다", () => {
      const cleared = (readJson("tests", "fixtures", "judge-on.cleared.json") as Report).run.ai_cleared!;
      expect(cleared.map((c) => c.policy)).toEqual(["kr.pipa.22-2"]);
      const policies = draft.run.policies!.filter((p) => p.policy !== "kr.pipa.22-2");
      const html = withRun(draft, { judge: "claude-cli:haiku", units: 1, ai_cleared: cleared, policies });
      expect(counts(html)).toMatchObject({
        line: `4개. ${asSummarized(5)} 요약에 없는 정책 1개도 ‘정책 5’에 있습니다. 결과의 다른 곳에만 나온 정책이라 정책별 수가 없습니다.`,
        stated: 4,
        cards: 5,
        withUnits: 4,
      });
      expect(emptyParts(html)!.facts["판정 단위"].text).toBe(
        "1개. 모든 정책을 합친 수입니다. 정책별 수는 ‘정책 5’에서 요약이 실린 정책에만 적었습니다.",
      );
      const card = cards(html).find((c) => c.title === PIPA)!;
      expect(card.units).toBeNull();
      // (D5) 카드의 "AI 판정자의 답으로 풀린 경고가 1건 있습니다."는 곁칸의 줄로 옮겼다(docs/redesign.md 3장 "곁칸").
      expect(card.cleared).toBe("발견 없음, AI 가 푼 경고 1건");
    });
  });
});

describe("발견의 단위", () => {
  it("같은 줄의 서로 다른 규칙은 규칙 이름과 함께 따로 보인다", () => {
    const html = render("contract", "cli-current", "night-push.main.json");
    expect(html).toContain("규칙 nonemail-start-block");
    expect(html).toContain("규칙 nonemail-end-optout");
    // (D5) 정책의 발견 수는 곁칸의 그 정책 줄에 적는다(`2건`). 요약 줄의 `사람이 볼 곳 2건` 과는 다른 사실이다(8장 반박 (1)).
    const side = elementAt(html, html.indexOf('<details class="box side-pol"'));
    expect(side).toContain('<span class="n">2건</span>');
    // 두 발견의 첫 줄은 저마다의 대안 메시지(CLI 원문)라 서로 다르다.
    const messages = elementsOf(html, '<span class="msg">').map(textOf);
    expect(messages).toHaveLength(2);
    expect(new Set(messages).size).toBe(2);
  });

  it("규칙마다 묶음이 따로 있고, 정책 상자의 첫 발견만 펼쳐 둔다. 다른 규칙의 발견도 줄은 늘 보인다", () => {
    // (D5) 규칙마다 첫 발견을 펼치던 것을 정책마다 첫 발견으로 바꿨다(docs/redesign.md 3장, 7장 2 오너 승인, 4장 :1216-1237).
    const html = render("contract", "cli-current", "night-push.main.json");
    for (const [rule, alternative, open] of [
      ["nonemail-start-block", "label-name-phone", 1],
      ["nonemail-end-optout", "optout-080-free", 0],
    ] as const) {
      const group = ruleGroup(html, rule);
      expect(count(group, '<li class="finding">')).toBe(1);
      expect(count(group, '<details open="">')).toBe(open);
      expect(group).toContain(alternative);
      expect(textOf(group)).toContain("src/marketing/campaign.ts:2");
      // 닫힌 줄도 메시지와 위치는 보인다(접힌 곳 안이 아니다).
      expect(closedDetailsAt(html, html.indexOf('<span class="msg">', html.indexOf(group)))).toEqual([]);
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
      // 닫혀 있어도 보이는 부분: 메시지(첫 미확인 대안의 것), 경로·줄, 판정이 본 범위, 상태. 화면 낭독기에는 규칙 이름도.
      expect(row.where, name).toBe(where(location.file, location.line));
      expect(row.scope, name).toBe(scopeLabel(location.scope));
      expect(row.status, name).toBe(STATUS_LABEL[location.status]);
      expect(row.rule, name).toBe(`규칙 ${location.rule}`);
      // (D5) 칩은 정책과 상태가 다를 때만 단다(같으면 화면 낭독기에만 읽힌다. docs/redesign.md 3장).
      expect(row.chip, name).toBe(location.status !== row.policy.status);
      // 첫 줄은 첫 미확인 대안의 메시지(CLI 원문)다. 값이 '모름'이면 앞에 이름표가 붙는다. 메시지가 없으면 규칙 id 다.
      // 같은 규칙의 묶음 머리가 같은 메시지를 이미 적었으면 줄에서는 되풀이하지 않는다.
      const first = finding.unsatisfied_alternatives[0];
      if (row.message !== null) {
        expect(row.message, name).toBe(`${first?.value === "unknown" ? "모름" : ""}${first?.message ?? location.rule}`);
      } else {
        expect(textOf(html.slice(html.lastIndexOf(GROUP, row.at), row.at)), name).toContain(first?.message ?? "");
      }
      // (D5) 정책 상자의 첫 발견만 펼쳐 둔다(규칙마다 첫 발견이 아니다).
      expect(row.open, name).toBe(row.first);
      // 접힌 곳의 발견만 닫힌 details(같은 규칙의 나머지) 하나에 가려 있다. 그 밖의 줄을 가리는 것은 없다.
      const hiddenBy = row.folded ? [FOLD] : [];
      expect(closedDetailsAt(html, row.at), name).toEqual(hiddenBy);
      // 줄이 닫혀 있어도 경로와 판정 범위와 상태는 줄과 함께 보인다(줄 자신의 닫힌 details 에 가려지지 않는다).
      const statusPiece = row.chip ? '<span class="chip ' : '<span class="visually-hidden">';
      for (const piece of ["<code>", '<span class="finding-scope">', statusPiece]) {
        expect(closedDetailsAt(html, html.indexOf(piece, row.at)), `${name} ${piece}`).toEqual(hiddenBy);
      }
      // 안쪽은 펼쳐 둔 줄에서만 처음부터 보인다.
      const bodyAt = html.indexOf('<div class="finding-body">', row.at);
      expect(closedDetailsAt(html, bodyAt), `${name} 안쪽`).toEqual(row.first ? hiddenBy : [...hiddenBy, "<details>"]);
      // 펼친 안쪽은 그 발견의 것이다.
      expect(row.bodies, name).toHaveLength(1);
      // (D5) 대안 id 는 펼친 안쪽의 id 줄(12px)에 실린 차례로 모여 있다. 대안마다의 칸은 대안 수만큼 있다.
      expect(row.alternativeIds, name).toEqual(finding.unsatisfied_alternatives.map((alt) => alt.id));
      expect(row.alternatives, name).toHaveLength(finding.unsatisfied_alternatives.length);
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
    // (D5) 묶음 머리(h3)는 같은 규칙이 여러 곳일 때만 둔다. 묶음마다 첫 줄의 규칙 이름(화면 낭독기용)으로 센다.
    const html = render("tests", "fixtures", "repeated-rule.json");
    const groups = elementsOf(html, GROUP);
    const rules = groups.map((group) => textOf(elementAt(group, group.indexOf('<span class="visually-hidden">규칙 '))));
    expect(rules).toEqual([
      "규칙 nonemail-start-block",
      "규칙 nonemail-end-optout",
      "규칙 email-subject-label",
      "규칙 email-body-sender",
      "규칙 email-body-optout",
    ]);
    for (const group of groups) {
      expect(closedDetailsAt(html, html.indexOf(group)), group.slice(0, 40)).toEqual([]);
      // 첫 줄의 메시지와 위치는 펼치지 않아도 보인다.
      const msg = html.indexOf('<span class="msg">', html.indexOf(group));
      expect(closedDetailsAt(html, msg)).toEqual([]);
    }
    // 여러 곳인 묶음의 머리는 규칙 id 와 곳의 수다.
    expect(elementsOf(html, '<div class="rule-head">').map((head) => textOf(elementAt(head, head.indexOf("<h3>"))))).toEqual([
      "규칙 nonemail-start-block · 20곳",
      "규칙 nonemail-end-optout · 2곳",
    ]);
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
    // (D5) 다섯 규칙이 모두 한 정책의 것이라 펼쳐 둔 것은 정책 상자의 첫 발견 하나다.
    expect(rows.filter((row) => !row.open)).toHaveLength(24);
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
    // (D5) 정책의 발견 수는 곁칸의 그 정책 줄에 있다.
    expect(elementAt(html, html.indexOf('<details class="box side-pol"'))).toContain('<span class="n">25건</span>');
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
    // 한 파일·한 줄에 함께 나온 서로 다른 세 규칙이 저마다 줄로 보인다(메시지가 서로 다르다). (D5) 펼친 것은 정책 상자의 첫
    // 발견뿐이라 이 셋은 닫힌 줄이다(docs/redesign.md 4장 :1394-1414). 줄은 접힌 곳 밖이다.
    const messages = new Set<string>();
    for (const rule of ["email-subject-label", "email-body-sender", "email-body-optout"]) {
      const group = ruleGroup(html, rule);
      expect(textOf(group)).toContain("src/mail/newsletter.ts:3");
      expect(count(group, '<details open="">')).toBe(0);
      expect(closedDetailsAt(html, html.indexOf(group))).toEqual([]);
      messages.add(rowParts(elementAt(group, group.indexOf(ROW))).message ?? "");
    }
    expect(messages.size).toBe(3);
  });

  it("접힌 곳에만 있는 상태는 묶음 머리에 개수로 보인다", () => {
    const data = readJson("tests", "fixtures", "repeated-rule.json") as Report;
    const uniform = textOf(ruleGroup(html, "nonemail-start-block").split("<ul")[0]);
    // (D5) 묶음 머리에는 메시지(첫 미확인 대안의 것)와 `규칙 id · N곳` 이 있다(docs/redesign.md 3장).
    const message = (readJson("tests", "fixtures", "repeated-rule.json") as Report).findings.find((f) => f.rule === "nonemail-start-block")!
      .unsatisfied_alternatives[0].message;
    expect(uniform).toBe(`${message}규칙 nonemail-start-block · 20곳`);

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

  it("메시지(줄의 첫 줄) → 질문 → 고치는 법 → 나머지 대안 → AI 에게 묻지 않은 조건 → 규칙·대안 id → 판정 경로 순서로 읽힌다", () => {
    // (D5) "확인되지 않은 적법한 대안 N개" 제목과 대안마다의 id 를 걷었다. 첫 대안의 메시지는 발견 줄의 첫 줄이고, 규칙·대안 id 는
    // 펼친 안쪽의 12px 줄이다(docs/redesign.md 2.3 낱말 표). 판정 경로는 "판정 경로(CLI 원문)"로 접어 둔다.
    const html = render("contract", "cli-current", "kids-signup.main.json");
    const row = elementAt(html, html.indexOf(ROW));
    expect(rowParts(row).message).toBe("만 14세 미만을 가르는 연령 분기가 보이지 않습니다.");
    const text = textOf(body(html));
    expect(
      inOrder(text, [
        "질문",
        "이 가입 흐름에서 만 14세 미만 사용자를 어떻게 가려내나요?",
        "고치는 법",
        "생년월일로 만 나이를 계산해 14세 미만 분기를 두세요.",
        "보호자 동의를 확인하는 것으로 보이는 함수 호출이 없습니다.",
        "질문",
        "법정대리인 동의를 확인하는 함수 이름이 무엇인가요?",
        "가입자가 만 14세 이상인지 확인하는 항목(예 '만 14세 이상입니다' 필수 체크)이 보이지 않습니다.",
        "질문",
        "가입자가 만 14세 이상인지 어디서 확인하나요? 그 확인을 거치지 않으면 가입이 막히나요?",
        "AI 에게 묻지 않은 조건",
        "ai-guard",
        "규칙",
        "signup-without-guard",
        "대안",
        "under14-branch",
        "guardian-call",
        "age-gate-text",
        "판정 경로(CLI 원문)",
        "적용: 정적 true",
        "대안 under14-branch: 정적 false",
        "→ needs-review",
      ]),
      text,
    ).toBe(true);
    // 첫 대안의 메시지는 줄에만 있다(안쪽에서 되풀이하지 않는다).
    expect(text).not.toContain("만 14세 미만을 가르는 연령 분기가 보이지 않습니다.");
  });

  it("고치는 법이 실려 있지 않은 대안은 지어내지 않고 그 줄을 그리지 않는다", () => {
    // (D5) "이 대안에는 고치는 법이 실려 있지 않습니다." 줄 대신 줄을 그리지 않는다(docs/redesign.md 3장 "펼친 안쪽").
    const html = body(render("contract", "cli-current", "kids-signup.main.json"));
    // 수집본에서 guardian-call 과 age-gate-text 의 remediation 은 null 이다.
    const alternatives = elementsOf(html, '<li class="alt">').map(textOf);
    expect(alternatives).toHaveLength(3);
    for (const [alt, message, question] of [
      [alternatives[1], "보호자 동의를 확인하는 것으로 보이는 함수 호출이 없습니다.", "법정대리인 동의를 확인하는 함수 이름이 무엇인가요?"],
      [alternatives[2], "가입자가 만 14세 이상인지 확인하는 항목(예 '만 14세 이상입니다' 필수 체크)이 보이지 않습니다.", "가입자가 만 14세 이상인지 어디서 확인하나요? 그 확인을 거치지 않으면 가입이 막히나요?"],
    ]) {
      expect(inOrder(alt, [message, "질문", question]), alt).toBe(true);
      expect(alt).not.toContain("고치는 법");
    }
    expect(alternatives[0]).toContain("고치는 법생년월일로 만 나이를 계산해 14세 미만 분기를 두세요.");
  });

  it("판정 경로는 CLI 가 낸 문장을 순서대로, 글자 그대로 보인다", () => {
    for (const file of jsonFiles("contract", "cli-current")) {
      const data = readJson("contract", "cli-current", file) as Report;
      const html = renderData(data);
      const paths = html.split('<ol class="path" translate="no">').slice(1).map((part) => part.split("</ol>")[0]);
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
    // (D5) 문구를 줄였다("결과에 실린 대안이 없습니다. … 판정 경로에 있습니다").
    expect(text).toContain("결과에 실린 대안이 없습니다");
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
    // (D5) 발견마다의 말은 "AI 에게 묻지 않은 조건: … 판정자 없이 만든 결과입니다." 한 줄이다(docs/redesign.md 2.3). 권고는 쪽에
    // 한 번이다. 판정자가 꺼져 있었다는 이유(no-judge)를 이유 목록에 또 적지 않는다.
    const JUDGE_OFF = "판정자 없이 만든 결과입니다";
    const off = body(render("contract", "cli-current", "kids-signup.main.json"));
    expect(count(off, JUDGE_OFF)).toBe(1);
    expect(off).not.toContain("판정자가 꺼져");
    // 엔진이 조건 하나를 끝내지 못해 적용 여부가 '모름'으로 남은 발견이다. CLI 는 이유 둘을 싣는다.
    const data = readJson("tests", "fixtures", "incomplete-coverage.json") as Report;
    const unfinished = data.findings.filter((f) => f.untested_reasons.includes("engine-incomplete"));
    expect(unfinished.map((f) => f.untested_reasons)).toEqual([["engine-incomplete", "no-judge"]]);
    const stopped = body(renderData({ ...data, findings: unfinished }));
    expect(stopped).toContain("엔진이 이 파일을 끝까지 돌리지 못했거나 함수 경계를 얻지 못했습니다");
    expect(count(stopped, JUDGE_OFF)).toBe(1);
    expect(stopped).not.toContain("판정자가 꺼져");
    // 파일 일부를 읽지 못해 적용 여부가 '모름'으로 남으면 CLI 는 parse-error 를 싣는다(합성 코드를 검사해 확인. 이
    // 자료의 가입 코드는 적용 여부가 참이라 그 이유가 없다. 여기서는 그 모양으로 바꿔 본다).
    const unread = body(
      renderData({
        ...data,
        findings: data.findings
          .filter((f) => f.file === "src/auth/signup.ts")
          .map((f) => ({ ...f, untested_reasons: ["parse-error", "no-judge"], ai_pending: ["applies-ai", "ai-guard"] })),
      }),
    );
    expect(unread).toContain("파일 일부를 읽지 못했습니다");
    expect(count(unread, JUDGE_OFF)).toBe(1);
    expect(unread).not.toContain("판정자가 꺼져");
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
    expect(alternatives).toHaveLength(3);
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
      // "알 수 없다"고 잘라 적지 않는다. CLI 는 함수 단위 규칙의 판정 경로 첫 문장에 구역을 글로 적고(CLI 소스
      // evaluate/engine.py), 그 문장은 바로 아래에 그대로 보인다. 웹은 그 문장을 해석하지 않고 가리키기만 한다.
      note: "함수 단위 규칙의 판정입니다. 판정 구역은 결과에 따로 실려 있지 않습니다. 아래 판정 경로의 문장을 보세요.",
    });
  });

  it("함수 단위인데 구역도 판정 경로도 결과에 없으면, 없는 판정 경로를 가리키지 않는다", () => {
    expect(
      rowWith((f) => {
        const finding: Partial<Finding> = { ...f, scope: "anchor", region: null, decision_path: [] };
        delete finding.top_level;
        return finding;
      }),
    ).toEqual({
      where: "src/auth/signup.ts:5",
      label: "판정 구역 알 수 없음",
      note: "함수 단위 규칙의 판정입니다. 판정 구역은 결과에 실려 있지 않습니다.",
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
    // (D5) 첫 대안의 메시지는 줄의 첫 줄이고, 대안 id 는 안쪽의 id 줄이다. 고치는 법이 없으면 그 줄을 그리지 않는다.
    // 같은 규칙이 여러 곳이라 메시지는 묶음 머리에 있고, 같은 메시지인 줄은 되풀이하지 않는다.
    const html = renderData(readJson("tests", "fixtures", "uncommon-shapes.json"));
    const group = ruleGroup(html, "nonemail-end-optout");
    expect(blast.message ?? textOf(elementAt(group, group.indexOf('<span class="msg">')))).toBe(message);
    expect(blast.alternativeIds).toEqual(["optout-080-free"]);
    expect(inOrder(alt, ["질문", "이 대안에는 질문이 실려 있지 않습니다."]), alt).toBe(true);
    expect(alt).not.toContain("고치는 법");
    // 메시지나 정책의 질문으로 빈자리를 채우지 않는다. 메시지는 펼친 안쪽에 되풀이되지 않는다.
    expect(textOf(blast.body)).not.toContain(message);
    expect(alt).not.toContain("수신거부 방법이 정해진 자리에 들어가나요");
  });

  it("판정 경로가 실려 있지 않으면 그렇다고 적는다", () => {
    const notify = row("nonemail-end-optout", "src/legacy/notify.js", 9);
    expect(notify.path).toBeNull();
    const text = textOf(notify.body);
    // (D5) 판정 경로가 없으면 접힌 "판정 경로(CLI 원문)" 대신 그 자리에 이 한 줄이다.
    expect(text).toContain("결과에 판정 경로가 실려 있지 않습니다.");
    expect(text).not.toContain("판정 경로(CLI 원문)");
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
  // 여기서는 판단 규칙(selection.ts)만 본다. 브라우저에서 실제로 그렇게 되는지는 tests/browser/view.test.ts 의 "발견 줄의 경로를
  // 끌어 고르거나 두 번·세 번 눌러 골라도 …"가 본다(8번에서 넣었다).
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
