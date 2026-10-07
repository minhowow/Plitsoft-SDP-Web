import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportSummary } from "@/components/result/ReportSummary";
import { packMeta } from "@/lib/pack";
import { coverageSummary, SARIF_COUNTS_NOTE } from "@/lib/report/coverage";
import { examinedFacts } from "@/lib/report/examined";
import { parseReport } from "@/lib/report/parse";
import type { JudgedScope } from "@/lib/report/scope";
import type { Finding, Report } from "@/lib/report/types";
import { buildReportView, type LocationView, type ReportView } from "@/lib/report/view-model";
import { elementAt, elementsOf, jsonFiles, linesOf, readJson, textOf } from "./helpers";
import { toSarif } from "./sarif-mirror";
import { BANNED_WORDING } from "./wording";

// SARIF 입력. 웹은 SARIF 를 결과 JSON 의 모양으로 옮겨 같은 화면으로 그린다(src/lib/report/sarif.ts).
// SARIF 에 실린 것은 JSON 과 같게 보이고, 실리지 않은 것은 "알 수 없음"으로 보인다. 짐작해 채우지 않는다.

function viewOf(data: unknown): ReportView {
  const parsed = parseReport(data);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return buildReportView(parsed.report, parsed.contract, packMeta);
}

const render = (data: unknown) => renderToStaticMarkup(<ReportSummary view={viewOf(data)} />);

/** 한 요소의 HTML. 없으면 빈 문자열. */
const part = (html: string, open: string) => (html.includes(open) ? elementAt(html, html.indexOf(open)) : "");

/**
 * 화면의 발견 부분: 발견 수를 알리는 줄, 정책 카드(규칙 묶음, 발견 줄, 대안, 판정 경로), AI 가 푼 경고와 빠진 판정.
 * 결과 머리(도구·엔진…)와 커버리지 보기, 빈 결과 화면은 발견 부분이 아니다.
 */
const findingsPart = (html: string) =>
  [part(html, '<p class="notice">'), part(html, '<div class="policies">'), part(html, '<div class="ai-decisions">')].join("");

/** 앞의 목록에만 있는 줄(같은 줄이 여러 번이면 그 수만큼 견준다). */
function onlyIn(lines: string[], others: string[]): string[] {
  const rest = [...others];
  return lines.filter((line) => {
    const at = rest.indexOf(line);
    if (at === -1) return true;
    rest.splice(at, 1);
    return false;
  });
}

/** SARIF 에 실리는 발견의 필드. 결과 JSON 의 발견에서 이것만 골라 견준다(top_level, case, category, anchor_lines 는 없다). */
const CARRIED = [
  "policy",
  "rule",
  "outcome",
  "file",
  "line",
  "title",
  "law",
  "ask_developer",
  "untested_reasons",
  "ai_pending",
  "fingerprint",
  "scope",
  "region",
  "unsatisfied_alternatives",
  "decision_path",
] as const;
const carried = (finding: Finding) => Object.fromEntries(CARRIED.map((key) => [key, finding[key]]));

const locationsOf = (view: ReportView): LocationView[] => view.policies.flatMap((policy) => policy.locations);

const SARIF = ["contract", "cli-current", "kids-signup.main.sarif"] as const;
const JSON_PAIR = ["contract", "cli-current", "kids-signup.main.json"] as const;
const sarifCapture = () => readJson(...SARIF) as { runs: Record<string, any>[] } & Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
const jsonCapture = () => readJson(...JSON_PAIR) as Report;

describe("같은 검사의 SARIF 와 JSON (contract/cli-current 의 수집본 한 쌍)", () => {
  // 수집 스크립트가 같은 표본(kids-signup.main)을 같은 CLI 로 두 형식으로 받은 것이다.
  const json = render(jsonCapture());
  const sarif = render(sarifCapture());

  it("발견 부분이 같다: 발견 수, 정책 카드, 발견 줄과 그 안쪽이 글자까지 같다", () => {
    expect(findingsPart(sarif)).toBe(findingsPart(json));
    // 빈 것끼리 견주고 통과하지 않게, 견준 부분에 무엇이 들어 있는지 본다.
    const found = findingsPart(json);
    expect(textOf(found)).toContain("사람이 확인할 발견이 1건 있습니다.");
    expect(elementsOf(found, '<article class="policy ')).toHaveLength(packMeta.policies.length);
    expect(elementsOf(found, '<li class="finding">')).toHaveLength(1);
    expect(elementsOf(found, '<li class="alt">')).toHaveLength(2);
    const row = textOf(elementsOf(found, '<li class="finding">')[0]);
    for (const text of [
      "src/auth/signup.ts:5",
      "파일 전체 판정",
      "검토 필요 · AI 확인 전",
      "파일 전체를 보고 내린 판정입니다. 줄 번호는 이 조문이 닿는다고 본 첫 줄입니다.",
      "만 14세 미만을 가르는 연령 분기가 보이지 않습니다.",
      "생년월일로 만 나이를 계산해 14세 미만 분기를 두세요.",
      "AI 에게 묻지 않은 조건: ai-guard.",
      "대안 ai-guard: AI 필요(판정자 없음) → 판정에 넣지 않음",
    ]) {
      expect(row, text).toContain(text);
    }
    expect(textOf(found)).toContain("개발자에게 할 질문: 만 14세 미만 사용자를 받는다면 법정대리인 동의를 확인하거나 가입을 막고 있나요?");
  });

  it("화면 전체에서 다른 줄은 SARIF 에 없는 두 수와 출력 형식뿐이다", () => {
    const [a, b] = [linesOf(json), linesOf(sarif)];
    expect(onlyIn(a, b)).toEqual(["CLI 0.3", "파일 1개 검사 · 판정 단위 1개"]);
    expect(onlyIn(b, a)).toEqual(["SARIF", "검사한 파일 수 알 수 없음 · 판정 단위 수 알 수 없음", SARIF_COUNTS_NOTE]);
    expect(SARIF_COUNTS_NOTE).toBe(
      "SARIF 에는 검사한 파일 수와 판정 단위 수가 실려 있지 않습니다. JSON 출력(--output-format json)에는 있습니다.",
    );
  });

  it("화면 구조에서도 같다: 정책의 차례와 상태, 규칙 묶음, 발견의 범위·지문·대안·판정 경로", () => {
    const [a, b] = [viewOf(jsonCapture()), viewOf(sarifCapture())];
    expect(b.contract).toBe("sarif");
    const shape = (view: ReportView) =>
      view.policies.map((policy) => ({
        ...policy,
        locations: policy.locations.map((l) => ({ ...l, finding: carried(l.finding) })),
        rules: policy.rules.map((group) => ({
          ...group,
          shown: group.shown.map((l) => ({ ...l, finding: carried(l.finding) })),
          folded: group.folded.map((l) => ({ ...l, finding: carried(l.finding) })),
        })),
      }));
    expect(shape(b)).toEqual(shape(a));
    expect(locationsOf(b)).toHaveLength(1);
    // 결과 머리에 보이는 것도 같다. 판정자가 꺼져 있으면 JSON 은 null, SARIF 는 "none" 을 싣는다.
    for (const key of ["tool", "engine", "judge", "packDigest", "packMatches", "policyCount", "findingCount"] as const) {
      expect(b[key], key).toEqual(a[key]);
    }
    expect(b.judge).toBeNull();
    expect(b.engine).toBe("semgrep 1.176.1");
    expect([b.aiCleared, b.aiDismissed, b.aiDismissedKnown]).toEqual([a.aiCleared, a.aiDismissed, a.aiDismissedKnown]);
  });

  it("SARIF 에 없는 수는 0 으로 채우지 않고 알 수 없음으로 둔다", () => {
    const [a, b] = [viewOf(jsonCapture()), viewOf(sarifCapture())];
    expect([a.coverage.files, a.coverage.units]).toEqual([1, 1]);
    expect(b.coverage).toEqual({ ...a.coverage, files: null, units: null });
    expect(coverageSummary(b).line).toBe("검사한 파일 수 알 수 없음 · 판정 단위 수 알 수 없음");
    expect(coverageSummary(b).lineNote).toBe(SARIF_COUNTS_NOTE);
    // JSON 결과에는 그 말이 없다.
    expect(coverageSummary(a).lineNote).toBeNull();
    // 검사한 파일이 없다는 경고는 수가 0일 때의 것이다. 수를 모르면 내지 않는다. 엔진이 실려 있으므로 엔진을 돌리지
    // 않았다는 경고도 없다(아래 "검사할 파일이 없던 결과").
    expect(coverageSummary(b).warning).toBeNull();
    expect(sarif).not.toContain("파일 0개");
    expect(sarif).not.toContain("판정 단위 0개");
  });

  it("SARIF 에 실린 팩 작성자 메모와 조문은 화면에 옮기지 않는다", () => {
    // CLI 는 SARIF 의 규칙 설명(fullDescription, help.markdown)에 팩 작성자 메모와 조문 원문을 싣는다. 메모는 화면에
    // 싣지 않기로 한 글이고(docs/commitments.md), 조문은 data/pack-meta.json 의 것만 쓴다. 웹은 그 두 필드를 읽지 않는다.
    const [rule] = sarifCapture().runs[0].tool.driver.rules;
    const memos = Object.values(packMeta.policies.find((p) => p.id === "kr.pipa.22-2")!.rationale).filter(Boolean);
    expect(memos).toHaveLength(2);
    expect(rule.fullDescription.text).toBe(memos[1]);
    expect(rule.help.markdown.startsWith(memos[0])).toBe(true);
    const shown = textOf(sarif);
    for (const memo of memos) expect(shown, memo!).not.toContain(memo);
    expect(shown).not.toContain("법정대리인이 동의하였는지를 확인하여야 한다");
    expect(shown).not.toContain("재검토 기한");
  });
});

// JSON 수집본과 시험용 자료(모두 CLI 0.3 의 모양)를 SARIF 로 옮겨 열어 본다. 실제 SARIF 수집본은 하나뿐이라, 그 밖의 모양은
// CLI 가 SARIF 를 쓰는 방식을 흉내 내 만든다(tests/sarif-mirror.ts). v1 초안 예시는 뺀다. 그 모양의 SARIF 는 없다.
const samples: string[][] = [
  ...jsonFiles("contract", "cli-current").map((f) => ["contract", "cli-current", f]),
  ...jsonFiles("tests", "fixtures").map((f) => ["tests", "fixtures", f]),
];
const named = (list: string[][]) => list.map((parts) => [parts.join("/"), parts] as const);

/** SARIF 에 판정 구역이 실리는 발견인지. CLI 는 줄이 그 구역 안에 있고 두 줄 이상인 구역일 때만 싣는다. */
function regionCarried(f: Finding): boolean {
  const r = f.region;
  return r !== null && f.line !== null && f.line > 0 && r.start_line <= f.line && f.line <= r.end_line && r.start_line < r.end_line;
}

/** SARIF 로 옮겨도 잃는 것이 없는 발견인지: 파일 단위 판정이고 줄이 2행 이상이다. */
const lossless = (f: Finding) => f.scope === "file" && f.line !== null && f.line > 1;

describe("JSON 결과를 SARIF 로 옮겨 열어 본다 (시험용 흉내)", () => {
  it("흉내가 만든 것이 실제 SARIF 수집본에 그대로 들어 있다", () => {
    // 흉내는 웹이 읽는 필드만 만든다. 그 필드가 모두 실제 수집본과 같은 자리에 같은 값으로 있어야 한다.
    expect(sarifCapture()).toMatchObject(toSarif(jsonCapture()));
    // 옮겨 읽은 결과도 실제 수집본을 읽은 것과 같다.
    expect(parseReport(toSarif(jsonCapture()))).toEqual(parseReport(sarifCapture()));
  });

  it("볼 자료가 있다: 잃는 것이 없는 결과와 있는 결과, 다 보지 못한 결과, 판정자를 켠 결과", () => {
    const findings = (parts: string[]) => (readJson(...parts) as Report).findings;
    const names = (keep: (parts: string[]) => boolean) => samples.filter(keep).map((parts) => parts.join("/"));
    expect(names((parts) => findings(parts).length > 0 && findings(parts).every(lossless))).toEqual([
      "contract/cli-current/kids-signup.main.json",
      "contract/cli-current/night-push.fixed.json",
      "contract/cli-current/night-push.main.json",
      "tests/fixtures/incomplete-coverage.json",
      "tests/fixtures/judge-on.citation-rejected.json",
      "tests/fixtures/repeated-rule.json",
    ]);
    expect(names((parts) => findings(parts).some((f) => !lossless(f)))).toEqual([
      "contract/cli-current/genai-chat.fixed.json",
      "contract/cli-current/genai-chat.main.json",
      "tests/fixtures/uncommon-shapes.json",
    ]);
    expect(names((parts) => !(readJson(...parts) as Report).run.coverage_complete)).toEqual(["tests/fixtures/incomplete-coverage.json"]);
    expect(names((parts) => (readJson(...parts) as Report).run.judge !== null)).toHaveLength(3);
  });

  it.each(named(samples))("%s: 발견은 JSON 과 같고, 달라지는 것은 SARIF 가 싣지 않는 것뿐이다", (_name, parts) => {
    const data = readJson(...parts) as Report;
    const [a, b] = [viewOf(data), viewOf(toSarif(data))];

    // 결과 머리와 정책 카드: 같은 정책이 같은 차례, 같은 상태로 나온다.
    for (const key of ["tool", "engine", "judge", "packDigest", "packMatches", "policyCount", "findingCount"] as const) {
      expect(b[key], key).toEqual(a[key]);
    }
    const cards = (view: ReportView) => view.policies.map((p) => [p.id, p.title, p.law, p.status, p.units, p.aiCleared, p.inPack]);
    expect(cards(b)).toEqual(cards(a));
    // 다 보지 못한 것: 세 목록과 엔진 오류는 SARIF 의 알림으로 실려 있다. 파일 수와 판정 단위 수만 없다.
    expect(b.coverage).toEqual({ ...a.coverage, files: null, units: null });
    // AI 가 푼 경고와 빠진 판정도 그대로다.
    expect([b.aiCleared, b.aiDismissed, b.aiDismissedKnown]).toEqual([a.aiCleared, a.aiDismissed, a.aiDismissedKnown]);

    // 규칙 묶음: 같은 발견이 같은 묶음의 같은 자리에 있다(먼저 보이는 곳과 접힌 곳).
    const groups = (view: ReportView) =>
      view.policies.flatMap((p) =>
        p.rules.map((g) => [p.id, g.rule, g.status, g.counts, g.shown.map((l) => l.fingerprint), g.folded.map((l) => l.fingerprint)]),
      );
    expect(groups(b)).toEqual(groups(a));

    // 발견마다: 지문으로 짝지어 본다.
    const wanted = new Map(locationsOf(a).map((l) => [l.fingerprint, l]));
    expect(wanted.size).toBe(data.findings.length);
    expect(locationsOf(b)).toHaveLength(data.findings.length);
    for (const got of locationsOf(b)) {
      const want = wanted.get(got.fingerprint)!;
      const f = want.finding;
      const name = `${f.rule} ${f.file}:${f.line}`;
      expect([got.file, got.rule, got.status], name).toEqual([want.file, want.rule, want.status]);
      // 줄이 없는 발견은 SARIF 에 1행으로 실린다.
      expect(got.line, name).toBe(f.line ?? 1);
      // 판정이 본 범위: 파일 단위는 그대로 안다. 함수 단위는 구역이 실렸을 때만 알고, 아니면 알 수 없음이다.
      const scope: JudgedScope =
        f.scope === "file"
          ? { kind: "file" }
          : regionCarried(f)
            ? { kind: "function", startLine: f.region!.start_line, endLine: f.region!.end_line }
            : { kind: "unknown" };
      expect(got.scope, name).toEqual(scope);
      // 1행은 조문이 닿는다고 본 줄인지 알 수 없다. 구역이 함께 실린 발견은 줄이 있는 발견이다.
      expect(got.lineUnsure, name).toBe(got.line === 1 && !regionCarried(f));
      expect(want.lineUnsure, name).toBe(false);
      // 나머지(판정, 조문, 질문, 이유, 대안, 판정 경로, 지문)는 글자까지 같다.
      expect(carried(got.finding), name).toEqual({
        ...carried(f),
        line: f.line ?? 1,
        region: regionCarried(f) ? f.region : null,
      });
      expect("top_level" in got.finding, name).toBe(false);
    }
  });

  const whole = samples.filter((parts) => (readJson(...parts) as Report).findings.every(lossless));

  it.each(named(whole))("%s: 잃는 것이 없는 결과라 그려 낸 발견 부분이 글자까지 같다", (_name, parts) => {
    const data = readJson(...parts) as Report;
    expect(findingsPart(render(toSarif(data)))).toBe(findingsPart(render(data)));
  });

  it.each(named(samples))("%s: 그려 낸 화면에 쓰지 않는 말이 없고 면책이 있다", (_name, parts) => {
    const html = render(toSarif(readJson(...parts) as Report));
    for (const [pattern, why] of BANNED_WORDING) {
      expect(pattern.test(html), `${pattern} — ${why}`).toBe(false);
    }
    expect(html).toContain("법률 자문이 아닙니다");
  });
});

describe("SARIF 로는 알 수 없는 것", () => {
  /** 발견 줄 하나의 글: 닫혀 있어도 보이는 줄과, 펼친 안쪽의 첫 문단. */
  function rows(html: string) {
    return elementsOf(html, '<li class="finding">').map((row) => {
      const summary = elementAt(row, row.indexOf("<summary>"));
      const body = elementAt(row, row.indexOf('<div class="finding-body">'));
      return {
        where: textOf(elementAt(summary, summary.indexOf("<code>"))),
        scope: textOf(elementAt(summary, summary.indexOf('<span class="finding-scope">'))),
        note: textOf(elementAt(body, body.indexOf('<p class="hint">'))),
      };
    });
  }
  const UNSURE = "SARIF 는 줄이 없는 발견도 1행으로 싣습니다. 이 1행이 조문이 닿는다고 본 줄인지는 알 수 없습니다.";
  const FIRST_LINE = "줄 번호는 이 조문이 닿는다고 본 첫 줄입니다.";

  it("1행에 실린 발견: 조문이 닿는다고 본 줄이라고 적지 않는다", () => {
    // genai-chat 의 발견은 실제로 1행(import 줄)이다. 그런데 SARIF 는 줄이 없는 발견도 1행으로 싣는다(CLI 소스
    // report/sarif.py). SARIF 만 보고는 둘을 가릴 수 없다.
    const data = readJson("contract", "cli-current", "genai-chat.main.json") as Report;
    expect(data.findings.map((f) => f.line)).toEqual([1, 1]);
    const [json, sarif] = [render(data), render(toSarif(data))];
    for (const row of rows(json)) {
      expect(row).toEqual({ where: "src/chat/ChatPanel.tsx:1", scope: "파일 전체 판정", note: `파일 전체를 보고 내린 판정입니다. ${FIRST_LINE}` });
    }
    for (const row of rows(sarif)) {
      expect(row).toEqual({ where: "src/chat/ChatPanel.tsx:1", scope: "파일 전체 판정", note: `파일 전체를 보고 내린 판정입니다. ${UNSURE}` });
    }
    expect(rows(sarif)).toHaveLength(2);
    // 그 문장 말고는 발견 부분이 같다.
    expect(findingsPart(sarif).replaceAll(UNSURE, FIRST_LINE)).toBe(findingsPart(json));

    // 줄이 없는 발견은 JSON 에서는 파일 이름만 적는다. SARIF 에서는 1행으로 보이고 같은 말이 붙는다.
    const noLine = { ...data, findings: data.findings.map((f) => ({ ...f, line: null })) };
    expect(rows(render(noLine))[0]).toMatchObject({ where: "src/chat/ChatPanel.tsx", note: "파일 전체를 보고 내린 판정입니다." });
    expect(rows(render(toSarif(noLine)))).toEqual(rows(sarif));
  });

  it("2행부터는 실린 줄 그대로다", () => {
    const text = textOf(render(sarifCapture()));
    expect(text).toContain(FIRST_LINE);
    expect(text).not.toContain(UNSURE);
  });

  it("함수 단위 판정: 구역이 실린 발견만 구역을 적고, 나머지는 알 수 없다고 적는다", () => {
    // SARIF 에는 top_level 이 없고, 판정 구역은 줄이 그 안에 있는 두 줄 이상의 구역일 때만 실린다.
    const data = readJson("tests", "fixtures", "uncommon-shapes.json") as Report;
    const label = (html: string) => Object.fromEntries(rows(html).map((row) => [row.where, row.scope]));
    expect(label(render(data))).toEqual({
      "src/jobs/weekly-digest.ts:7": "파일 전체 판정",
      "src/notifications/promo.ts:3": "함수 밖 판정",
      "src/notifications/promo.ts:18": "함수 12~34행 판정",
      "src/notifications/promo.ts:44": "함수 40~58행 판정",
      "src/legacy/blast.js": "파일 전체 판정",
      "src/legacy/notify.js:9": "파일 전체 판정",
      "src/mail/weekly.ts:4": "판정 구역 알 수 없음",
    });
    expect(label(render(toSarif(data)))).toEqual({
      // 감싸는 함수가 없어 파일 전체를 본 판정과, 함수 밖의 줄을 본 판정은 SARIF 에서 구분되지 않는다.
      "src/jobs/weekly-digest.ts:7": "판정 구역 알 수 없음",
      "src/notifications/promo.ts:3": "판정 구역 알 수 없음",
      "src/notifications/promo.ts:18": "함수 12~34행 판정",
      "src/notifications/promo.ts:44": "함수 40~58행 판정",
      // 파일 단위 판정은 scope 만으로 안다. 줄이 없는 발견은 1행으로 실린다.
      "src/legacy/blast.js:1": "파일 전체 판정",
      "src/legacy/notify.js:9": "파일 전체 판정",
      "src/mail/weekly.ts:4": "판정 구역 알 수 없음",
    });

    // 한 줄짜리 함수는 구역이 실리지 않는다. 구역이 실린 1행은 줄이 있는 발견이다.
    const [first] = data.findings.filter((f) => f.region !== null);
    const one = (line: number, start: number, end: number) =>
      locationsOf(viewOf(toSarif({ ...data, findings: [{ ...first, line, region: { start_line: start, end_line: end } }] })))[0];
    expect(one(18, 18, 18)).toMatchObject({ scope: { kind: "unknown" }, lineUnsure: false });
    expect(one(1, 1, 9)).toMatchObject({ scope: { kind: "function", startLine: 1, endLine: 9 }, lineUnsure: false });
    expect(one(1, 1, 1)).toMatchObject({ scope: { kind: "unknown" }, lineUnsure: true });
  });

  it("발견이 0인 SARIF: 검사한 파일 수와 판정 단위 수를 알 수 없다고 적는다. 정책 카드는 JSON 과 같다", () => {
    const data = readJson("contract", "cli-current", "kids-signup.fixed.json") as Report;
    expect(data.run).toMatchObject({ files: 1, units: 1 });
    const [a, b] = [viewOf(data), viewOf(toSarif(data))];
    const facts = Object.fromEntries(examinedFacts(b).map((fact) => [fact.label, `${fact.value}. ${fact.note}`]));
    expect(facts).toEqual({
      "검사한 파일": "알 수 없음. 파일 수가 결과에 실려 있지 않습니다.",
      "판정 단위": "알 수 없음. 판정 단위 수가 결과에 실려 있지 않습니다.",
      // 아래 두 줄은 JSON 과 같다. 목록과 팩 판은 SARIF 에도 실려 있다.
      "검사하지 않은 파일": examinedFacts(a)[2].value + ". " + examinedFacts(a)[2].note,
      정책: "5개. 결과에는 정책 목록이 없어, 팩 판이 같은 이 사이트의 팩에서 가져와 아래에 적었습니다.",
    });
    expect(examinedFacts(b).every((fact) => !fact.warn)).toBe(true);
    const [json, sarif] = [render(data), render(toSarif(data))];
    expect(part(sarif, '<div class="policies">')).toBe(part(json, '<div class="policies">'));
    expect(textOf(sarif)).toContain("검토 필요 신호가 0이어도 법적 문제가 없다는 뜻은 아닙니다.");
    // 수가 없으니 그 수가 0이라는 풀이("어느 정책에서도 판정한 곳이 없습니다")도 없다.
    const plain = render(toSarif(readJson("contract", "cli-current", "plain.main.json") as Report));
    expect(textOf(plain)).not.toContain("판정한 곳이 없습니다");
    expect(textOf(plain)).not.toContain("0개");
  });

  it("검사할 파일이 없던 결과: 엔진을 돌리지 않았다고 맨 위에 알린다. 파일이 0개였다고는 적지 않는다", () => {
    // 검사할 파일이 없으면 CLI 는 SARIF 에 엔진(tool.extensions)을 싣지 않는다(빈 폴더를 검사해 확인. JSON 은 engine: null,
    // files: 0). 파일 수는 SARIF 에 없으므로 0 이라고 짐작해 적지 않는다. 그렇다고 아무 경고 없이 정책 카드만 "발견
    // 없음"으로 보이면 깨끗한 결과처럼 읽힌다. `--diff` 로 돌려 바뀐 파일이 없을 때 CI 에 올라가는 빈 SARIF 가 이 모양이다.
    const data = readJson("contract", "cli-current", "plain.main.json") as Report;
    const empty = { ...data, run: { ...data.run, files: 0, engine: null } };
    expect(linesOf(render(empty))[0]).toBe("검사한 파일이 없습니다.");
    const sarif = toSarif(empty);
    expect("extensions" in (sarif.runs as { tool: object }[])[0].tool).toBe(false);
    const view = viewOf(sarif);
    expect(view.engine).toBeNull();
    expect(coverageSummary(view).warning).toEqual({
      lead: "엔진을 돌리지 않은 결과입니다.",
      detail: "CLI 는 검사할 파일이 없을 때 엔진을 돌리지 않습니다.",
    });
    const html = render(sarif);
    // 결과 화면의 첫 줄이다.
    expect(linesOf(html)[0]).toBe("엔진을 돌리지 않은 결과입니다. CLI 는 검사할 파일이 없을 때 엔진을 돌리지 않습니다.");
    const text = textOf(html);
    expect(text).toContain("실행 안 함");
    expect(text).toContain("검사한 파일 수 알 수 없음 · 판정 단위 수 알 수 없음");
    expect(text).not.toContain("검사한 파일이 없습니다.");
    expect(text).not.toContain("검사한 파일이 없어서");
    expect(text).not.toContain("0개");

    // 축소 파일만 든 폴더: JSON 은 files: 0, skipped: […], coverage_complete: false 다(합성 폴더로 확인). SARIF 에서는
    // 든 것이 있는 목록을 함께 적는다. CLI 가 언제 엔진을 돌리지 않는지는 덧붙이지 않는다(목록이 까닭을 말한다).
    const skippedOnly = { ...empty, run: { ...empty.run, skipped: ["src/lib/chart.min.js"], coverage_complete: false } };
    expect(linesOf(render(skippedOnly))[0]).toBe("검사한 파일이 없습니다. 검사하지 않은 파일 1개. 아래 '다 보지 못한 것' 표에서 확인하세요.");
    expect(linesOf(render(toSarif(skippedOnly)))[0]).toBe(
      "엔진을 돌리지 않은 결과입니다. 검사하지 않은 파일 1개. 아래 '다 보지 못한 것' 표에서 확인하세요.",
    );
  });

  it("함수 단위 판정의 구역: 알 수 없다고 잘라 적지 않고, CLI 가 구역을 적은 판정 경로의 문장을 가리킨다", () => {
    // CLI 는 함수 단위 규칙의 판정 경로 첫 문장 끝에 구역을 글로 적는다(CLI 소스 evaluate/engine.py). SARIF 에도 그 문장은
    // 그대로 실린다. 웹은 문장을 해석하지 않으므로 줄에는 "판정 구역 알 수 없음"이 남지만, 펼친 안쪽이 그 아래의 문장과
    // 어긋나 보이면 안 된다.
    const data = readJson("tests", "fixtures", "uncommon-shapes.json") as Report;
    const whole = data.findings.find((f) => f.file === "src/jobs/weekly-digest.ts")!;
    expect(whole).toMatchObject({ scope: "anchor", region: null, top_level: false });
    expect(whole.decision_path[0]).toBe("적용: 정적 true [구역 파일 전체]");
    const row = elementsOf(render(toSarif(data)), '<li class="finding">').find((html) => textOf(html).includes("src/jobs/weekly-digest.ts"))!;
    const body = elementAt(row, row.indexOf('<div class="finding-body">'));
    expect(textOf(elementAt(body, body.indexOf('<p class="hint">')))).toBe(
      "함수 단위 규칙의 판정입니다. 판정 구역은 결과에 따로 실려 있지 않습니다. 아래 판정 경로의 문장을 보세요.",
    );
    expect(textOf(body)).not.toContain("알 수 없습니다");
    // 그 문장은 실린 그대로 보인다.
    expect(elementsOf(elementAt(body, body.indexOf('<ol class="path">')), "<li>").map(textOf)[0]).toBe("적용: 정적 true [구역 파일 전체]");
  });
});

describe("SARIF 에서 옮겨 오는 것 (수집본을 고쳐 본다)", () => {
  const withRun = (patch: (run: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const data = sarifCapture();
    patch(data.runs[0]);
    return data;
  };
  const gap = (kind: string, file: string) => ({
    level: "warning",
    descriptor: { id: `policypack/${kind}` },
    message: { text: "(CLI 가 적는 안내 문장)" },
    locations: [{ physicalLocation: { artifactLocation: { uri: file } } }],
  });

  it("다 보지 못한 파일의 알림은 세 목록으로, 위치 없는 엔진 오류는 그 문장으로 옮긴다", () => {
    // CLI 를 합성 폴더에 돌려 낸 SARIF 에서 알림의 모양을 확인했다(일부를 읽지 못한 파일과 검사하지 않은 파일).
    const data = withRun((run) => {
      run.invocations[0].properties.coverageComplete = false;
      run.invocations[0].toolExecutionNotifications = [
        gap("unparsed", "src/auth/signup.ts"),
        gap("skipped", "src/lib/z.min.js"),
        gap("skipped", "src/lib/a.min.js"),
        gap("engine-incomplete", "src/marketing/campaign.ts"),
        run.invocations[0].toolExecutionNotifications[0],
        { level: "warning", descriptor: { id: "policypack/engine-error" }, message: { text: "[Fatal error] first\n\tsecond" } },
        // 모르는 알림은 읽지 않는다. 결과 JSON 의 모르는 필드와 같다.
        { level: "note", descriptor: { id: "policypack/something-new" }, message: { text: "…" } },
      ];
    });
    const view = viewOf(data);
    expect(view.coverage).toEqual({
      files: null,
      units: null,
      // 목록 안의 차례는 실린 그대로다.
      skipped: ["src/lib/z.min.js", "src/lib/a.min.js"],
      unparsed: ["src/auth/signup.ts"],
      incomplete: ["src/marketing/campaign.ts"],
      engineErrors: 1,
      engineErrorTexts: ["[Fatal error] first\n\tsecond"],
      complete: false,
    });
    const summary = coverageSummary(view);
    expect(summary.warning).toEqual({
      lead: "다 보지 못한 검사입니다.",
      detail:
        "검사하지 않은 파일 2개 · 일부를 읽지 못한 파일 1개 · 엔진이 끝내지 못한 파일 1개 · 엔진 오류 1건. 아래 '다 보지 못한 것' 표에서 확인하세요.",
    });
    // 일부를 읽지 못한 파일 옆에는 그 파일의 발견 수가 붙는다. 경로는 발견의 경로와 글자 그대로 견준다.
    expect(summary.rows[1].files).toEqual([{ file: "src/auth/signup.ts", findings: 1 }]);
    expect(textOf(render(data))).toContain("다 보지 못한 검사입니다.");
  });

  it("판정자: 꺼져 있으면 \"none\" 이 실린다. 켜져 있으면 그 이름이 실린다", () => {
    expect(viewOf(sarifCapture()).judge).toBeNull();
    expect(textOf(part(render(sarifCapture()), '<dl class="report-meta">'))).toContain("판정자꺼짐");
    const on = withRun((run) => void (run.invocations[0].properties.judge = "claude-cli:haiku"));
    expect(viewOf(on).judge).toBe("claude-cli:haiku");
    expect(textOf(part(render(on), '<dl class="report-meta">'))).toContain("판정자claude-cli:haiku");
  });

  it("엔진: 판이 실려 있지 않으면 이름만 적는다", () => {
    const noVersion = withRun((run) => void delete run.tool.extensions[0].version);
    expect(viewOf(noVersion).engine).toBe("semgrep");
  });

  it("AI 가 푼 경고와 빠진 판정이 실려 있지 않은 SARIF 도 읽는다. 켠 결과에서는 빠진 판정이 없었다고 하지 않는다", () => {
    const bare = withRun((run) => {
      delete run.invocations[0].properties.aiCleared;
      delete run.invocations[0].properties.aiDismissed;
      run.invocations[0].properties.judge = "claude-cli:haiku";
    });
    expect(viewOf(bare)).toMatchObject({ aiCleared: [], aiDismissed: [], aiDismissedKnown: false });
    expect(viewOf(sarifCapture()).aiDismissedKnown).toBe(true);
  });

  it("질문이 없는 정책: 질문 자리에 실린 제목을 질문으로 보이지 않는다", () => {
    // CLI 는 정책에 질문이 없으면 규칙의 help.text 에 제목을 대신 싣는다(CLI 소스 report/sarif.py). JSON 은 빈 문자열이다.
    const titled = withRun((run) => void (run.tool.driver.rules[0].help.text = run.tool.driver.rules[0].shortDescription.text));
    expect(locationsOf(viewOf(titled))[0].finding.ask_developer).toBe("");
    expect(textOf(render(titled))).not.toContain("개발자에게 할 질문:");
    const blank = { ...jsonCapture(), findings: jsonCapture().findings.map((f) => ({ ...f, ask_developer: "" })) };
    expect(findingsPart(render(titled))).toBe(findingsPart(render(blank)));
  });

  it("발견이 여럿이면 규칙마다 제 제목과 질문을 가져온다 (차례가 아니라 ruleId 로 찾는다)", () => {
    const data = readJson("contract", "cli-current", "night-push.fixed.json") as Report;
    const sarif = toSarif(data) as { runs: Record<string, any>[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(sarif.runs[0].tool.driver.rules.map((rule: { id: string }) => rule.id)).toEqual([
      "kr.network-act.50-3/ad-send-without-night-guard",
      "kr.network-act.50-4/nonemail-start-block",
      "kr.network-act.50-4/nonemail-end-optout",
    ]);
    // 규칙 목록의 차례를 뒤집고 ruleIndex 를 지워도 같은 결과다.
    sarif.runs[0].tool.driver.rules.reverse();
    for (const result of sarif.runs[0].results) delete result.ruleIndex;
    expect(findingsPart(render(sarif))).toBe(findingsPart(render(data)));
  });
});
