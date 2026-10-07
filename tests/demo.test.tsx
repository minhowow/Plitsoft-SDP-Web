import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DemoPage from "@/app/demo/page";
import { DemoPanel } from "@/components/demo/DemoPanel";
import { DemoSwitcher } from "@/components/demo/DemoSwitcher";
import { DEMO_APPS, DEMO_VARIANTS, type DemoApp, type DemoVariant } from "@/lib/demo/apps";
import { compareByPolicy } from "@/lib/demo/compare";
import { unmatchedLines } from "@/lib/demo/diff";
import { loadDemoApps } from "@/lib/demo/load";
import { lineMarks } from "@/lib/demo/marks";
import { packIndex, packMeta, policyCardId } from "@/lib/pack";
import { parseReport } from "@/lib/report/parse";
import { scopeNote, type JudgedScope } from "@/lib/report/scope";
import { STATUS_HINT, STATUS_LABEL, STATUS_LEGEND, STATUS_ORDER, type Status } from "@/lib/report/status";
import type { Finding, Report } from "@/lib/report/types";
import { buildReportView, type ReportView } from "@/lib/report/view-model";
import { SAMPLES } from "@/lib/samples";
import { SITE } from "@/lib/site";
import { elementAt, elementsOf, readJson, root, textOf, walk } from "./helpers";
import { BANNED_WORDING } from "./wording";

// `/demo`: 합성 코드 세 가지의 고치기 전·후와, 그 코드를 CLI 로 검사한 실제 출력(contract/cli-current).
// 화면은 결과에 실린 것만 보인다. 고친 뒤에도 남은 발견을 숨기지 않고, 풀렸다고도 여전히 문제라고도 적지 않는다.
// 브라우저에서만 드러나는 것(단추로 고르기, 좁은 화면, 요청)은 tests/browser/demo.test.ts 가 본다.

const apps = loadDemoApps(packIndex);
const every = apps.flatMap((app) => app.variants.map((variant) => ({ app, variant, name: `${app.key}.${variant.key}` })));
const named = every.map((entry) => [entry.name, entry] as const);
const find = (name: string) => every.find((entry) => entry.name === name)!;

const captured = (name: string) => readJson("contract", "cli-current", `${name}.json`) as Report;
const fixture = (name: string, file: string) => readFileSync(path.join(root, "contract", "fixtures", ...name.split("."), file), "utf8");

function viewOf(data: unknown): ReportView {
  const parsed = parseReport(data);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return buildReportView(parsed.report, parsed.contract, packMeta);
}

const panel = ({ app, variant }: { app: DemoApp; variant: DemoVariant }) => renderToStaticMarkup(<DemoPanel app={app} variant={variant} />);

/** 팩 메타데이터 없이 만든 화면 구조. 발견이 있는 정책의 카드만 있다(다른 판의 팩으로 만든 결과가 이렇게 된다). */
function bareView(name: string): ReportView {
  const parsed = parseReport(captured(name));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return buildReportView(parsed.report, parsed.contract);
}

/**
 * 수집본 대신 다른 결과를 넣은 데모 앱(고치기 전, 고친 뒤 순서). 시험에서만 쓴다. 데모가 읽는 수집본에는 없는 모양(판정자를
 * 켠 결과, 같은 규칙이 여러 파일에 나오는 결과, 카드가 없는 정책)을 그려 보기 위한 것이다.
 */
function appWith(key: string, views: ReportView[]): DemoApp {
  const app = apps.find((entry) => entry.key === key)!;
  return { ...app, variants: app.variants.map((variant, i) => ({ ...variant, view: views[i] })) };
}

/** 그려 낸 코드 상자 하나를 뜯어 본 것. 줄과, 줄 아래에 적은 말이 문서 순서대로 나온다. */
function codeBox(figure: string) {
  const pre = elementAt(figure, figure.indexOf("<pre>"));
  const items = [...pre.matchAll(/<span class="(codeline(?: codeline-marked)?|codenote)"([^>]*)>([^<]*)<\/span>/g)].map((match) => {
    const kind = match[1] === "codenote" ? ("note" as const) : ("line" as const);
    const text = textOf(match[3]);
    // 줄은 제 글과 줄바꿈 하나를 담는다(끌어 골라 복사한 글이 파일의 글과 같게). 설명에는 줄바꿈이 없다.
    expect(text.endsWith("\n"), text).toBe(kind === "line");
    return {
      kind,
      marked: match[1] === "codeline codeline-marked",
      line: Number(/data-line="(\d+)"/.exec(match[2])?.[1]),
      sign: /data-sign="([^"]*)"/.exec(match[2])?.[1] ?? null,
      text: kind === "line" ? text.slice(0, -1) : text,
    };
  });
  // 뜯어 본 것이 상자의 전부다. 다른 요소가 섞여 있지 않다.
  expect(pre.replace(/<span class="(codeline(?: codeline-marked)?|codenote)"[^>]*>[^<]*<\/span>/g, "")).toBe("<pre></pre>");
  const legendAt = figure.indexOf('<p class="code-legend">');
  return {
    caption: textOf(elementAt(figure, figure.indexOf("<figcaption>"))),
    lines: items.filter((item) => item.kind === "line"),
    items,
    legend: legendAt === -1 ? null : textOf(elementAt(figure, legendAt)),
  };
}

const codeBoxes = (html: string) => elementsOf(html, '<figure class="codeblock">').map(codeBox);

/** 그려 낸 "고치기 전과 고친 뒤의 결과" 구역을 뜯어 본 것. 없으면 null. */
function compareBlock(html: string) {
  const at = html.indexOf('<div class="demo-compare">');
  if (at === -1) return null;
  const block = elementAt(html, at);
  const table = elementAt(block, block.indexOf("<table"));
  const cell = (td: string) => ({
    label: /data-label="([^"]*)"/.exec(td)?.[1],
    status: textOf(elementAt(td, td.indexOf('<span class="chip '))),
    /** 칩 옆에 적은 수(발견, AI 가 푼 경고). 없으면 빈 목록. */
    counts: elementsOf(td, '<span class="count">').map(textOf),
    current: /^<td [^>]*class="compare-current"/.test(td),
  });
  return {
    at,
    caption: textOf(elementAt(table, table.indexOf("<caption>"))),
    columns: elementsOf(elementAt(table, table.indexOf("<thead")), "<th ").map(textOf),
    rows: elementsOf(elementAt(table, table.indexOf("<tbody")), "<tr ").map((tr) => {
      const head = elementAt(tr, tr.indexOf("<th "));
      return {
        title: textOf(head),
        /** 정책 이름이 링크면 그 주소. 아래 결과의 그 정책 카드로 간다. */
        href: /<a href="([^"]*)"/.exec(head)?.[1] ?? null,
        cells: elementsOf(tr, "<td ").map(cell),
      };
    }),
    notes: elementsOf(elementAt(block, block.indexOf('<ul class="status-notes">')), "<li>").map(textOf),
    /** 표와 상태의 뜻 아래에 옅게 덧붙인 말(문서 순서). */
    hints: elementsOf(block, '<p class="hint">').map(textOf),
  };
}

describe("데모가 읽는 것: 합성 코드와 그 실제 결과", () => {
  it("세 앱 × 두 판이 있다: 아동 가입, 광고 푸시, 생성형 AI 채팅의 고치기 전과 고친 뒤", () => {
    expect(apps.map((app) => [app.key, app.label])).toEqual([
      ["kids-signup", "아동 가입"],
      ["night-push", "광고 푸시"],
      ["genai-chat", "생성형 AI 채팅"],
    ]);
    for (const app of apps) {
      expect(app.variants.map((variant) => [variant.key, variant.label, variant.sign]), app.key).toEqual([
        ["main", "고치기 전", "−"],
        ["fixed", "고친 뒤", "+"],
      ]);
      expect(app.variants.map((variant) => variant.key)).toEqual(DEMO_VARIANTS.map((variant) => variant.key));
    }
    expect(every).toHaveLength(6);
  });

  it("고치기 전·후가 모두 있는 합성 코드는 빠짐없이 데모에 있다", () => {
    const dir = path.join(root, "contract", "fixtures");
    const both = readdirSync(dir)
      .filter((app) => DEMO_VARIANTS.every((variant) => existsSync(path.join(dir, app, variant.key))))
      .sort();
    expect(both).toEqual(DEMO_APPS.map((app) => app.key).sort());
  });

  it.each(named)("%s: 결과는 contract/cli-current 의 수집본을 그대로 읽은 것이다", (name, { variant }) => {
    // 수집 스크립트가 낸 목록(MANIFEST)에 있는 실제 출력이다. v1 초안 예시도, 손으로 만든 시험용 자료도 아니다.
    const manifest = readJson("contract", "cli-current", "MANIFEST.json") as { files: { name: string; findings: number }[] };
    const entry = manifest.files.find((file) => file.name === name)!;
    expect(entry, name).toBeDefined();
    expect(variant.view).toEqual(viewOf(captured(name)));
    expect(variant.view.contract).toBe("cli-0.3");
    expect(variant.view.findingCount).toBe(entry.findings);
  });

  it("결과 보기의 합성 예시와 같은 결과를 같은 이름으로 부른다", () => {
    // `/view` 의 예시 목록에도 같은 수집본이 있다(src/lib/samples.ts). 두 쪽이 같은 것을 다른 이름으로 부르지 않는다.
    for (const { app, variant, name } of every) {
      const sample = SAMPLES.find((entry) => entry.id === name)!;
      expect(sample, name).toMatchObject({ label: `${app.label} · ${variant.label}`, origin: "CLI 실제 출력" });
      expect(sample.data, name).toEqual(captured(name));
    }
  });

  it("데모의 소스는 v1 초안 예시와 시험용 자료를 불러오지 않는다", () => {
    // G1 전에 v1 초안은 `/view` 의 예시 목록과 시험에서만 쓴다(docs/ROADMAP.md).
    const sources = [...walk(path.join("src", "lib", "demo")), ...walk(path.join("src", "components", "demo")), path.join("src", "app", "demo", "page.tsx")];
    expect(sources.length).toBeGreaterThanOrEqual(7);
    for (const file of sources) {
      const text = readFileSync(path.join(root, file), "utf8");
      expect(text, file).not.toMatch(/samples-v1-draft|tests\/fixtures|@\/lib\/samples/);
    }
    // 읽는 곳은 두 폴더다.
    const loader = readFileSync(path.join(root, "src", "lib", "demo", "load.ts"), "utf8");
    expect(loader).toContain('"contract", "fixtures"');
    expect(loader).toContain('"contract", "cli-current"');
  });

  it.each(named)("%s: 코드는 contract/fixtures 의 파일 그대로다 (줄을 더하거나 빼지 않는다)", (name, { variant }) => {
    const dir = path.join("contract", "fixtures", ...name.split("."));
    // 검사한 폴더(src/) 아래의 파일 전부다. 경로는 결과에 실린 것과 같은 기준이다.
    expect(variant.files.map((file) => file.path)).toEqual(walk(dir).map((file) => path.relative(dir, file).split(path.sep).join("/")));
    expect(variant.files.length).toBeGreaterThan(0);
    for (const file of variant.files) {
      expect(file.lines.map((line) => line.text).join("\n") + "\n", file.path).toBe(fixture(name, file.path));
    }
  });

  it.each(named)("%s: 결과의 발견은 보이는 코드의 파일과 줄을 가리킨다", (name, { variant }) => {
    // 코드를 고치고 다시 수집하지 않으면 결과가 다른 코드의 것이 된다. 그때는 줄 번호가 어긋난다.
    const { run, findings } = captured(name);
    expect(run.files).toBe(variant.files.length);
    for (const finding of findings) {
      const file = variant.files.find((f) => f.path === finding.file)!;
      expect(file, `${finding.rule}: ${finding.file}`).toBeDefined();
      expect(finding.line, finding.rule).toBeGreaterThanOrEqual(1);
      expect(finding.line, finding.rule).toBeLessThanOrEqual(file.lines.length);
    }
  });

  it("여섯 결과 모두 이 사이트의 팩과 판이 같고, 판정자 없이 검사한 것이다", () => {
    for (const { name, variant } of every) {
      expect(variant.view.packMatches, name).toBe(true);
      expect(variant.view.judge, name).toBeNull();
      // 다 보지 못한 것이 실려 있지 않다. 판단 보류가 "파일을 끝까지 읽지 못해서"인 결과는 없다.
      expect(variant.view.coverage, name).toMatchObject({ skipped: [], unparsed: [], incomplete: [], engineErrors: 0, complete: true });
    }
  });

  it("결과를 읽지 못하면 멈춘다. 빈 화면이나 다른 자료로 바꿔 보이지 않는다", () => {
    // 저장소 밖의 임시 폴더에 합성 코드와 수집본을 옮겨 놓고, 수집본 하나를 결과가 아닌 JSON 으로 바꿔 본다.
    const copy = mkdtempSync(path.join(tmpdir(), "policypack-demo-test-"));
    try {
      for (const dir of ["fixtures", "cli-current"]) {
        cpSync(path.join(root, "contract", dir), path.join(copy, "contract", dir), { recursive: true });
      }
      expect(loadDemoApps(packIndex, copy)).toEqual(apps);
      writeFileSync(path.join(copy, "contract", "cli-current", "night-push.fixed.json"), JSON.stringify({ name: "my-app" }));
      expect(() => loadDemoApps(packIndex, copy)).toThrow(
        "데모 결과를 읽지 못했습니다: night-push.fixed. npm run capture 로 다시 수집하세요.\nCLI 결과 파일의 모양이 아닙니다.",
      );
      rmSync(path.join(copy, "contract", "cli-current", "night-push.fixed.json"));
      expect(() => loadDemoApps(packIndex, copy)).toThrow(/night-push\.fixed\.json/);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});

// 이 묶음은 그물이다. 설명의 틀(문장마다 코드에서 옮긴 조각이 있는지)과 흔한 낱말만 본다. 통과했다고 설명이 약속을
// 지킨 것은 아니다. 설명을 바꿀 때는 docs/commitments.md 와 `src/lib/demo/apps.ts` 의 머리말로 판단한다: 코드에 적힌
// 것만 옮기고, 법이 무엇을 요구하는지와 결과가 어떻게 나오는지는 적지 않는다.
describe("데모 앱 설명: 코드가 무엇을 하는지만 적는다", () => {
  /** 설명에 든 코드 조각. 고친 뒤 설명의 것은 고친 뒤 코드에만 있다. */
  const QUOTED: Record<string, { about: string[]; fixed: string[] }> = {
    "kids-signup": { about: [], fixed: ["14", "/signup/guardian-consent"] },
    "night-push": { about: [], fixed: ["(광고)", "nightAdConsent", "21", "8"] },
    "genai-chat": { about: ["useChat"], fixed: ["이 서비스는 생성형 인공지능을 이용해 답변합니다.", "assistant", "AI가 생성한 답변"] },
  };
  const code = (name: string) => find(name).variant.files.map((file) => file.lines.map((line) => line.text).join("\n")).join("\n");

  it.each(DEMO_APPS.map((app) => [app.key, app] as const))("%s: 설명에 든 코드 조각이 그 판의 코드에 있다", (key, app) => {
    const quoted = QUOTED[key];
    expect(quoted, key).toBeDefined();
    for (const piece of quoted.about) {
      expect(app.about, piece).toContain(piece);
      for (const variant of DEMO_VARIANTS) expect(code(`${key}.${variant.key}`), piece).toContain(piece);
    }
    expect(quoted.fixed.length).toBeGreaterThan(0);
    for (const piece of quoted.fixed) {
      expect(app.fixed, piece).toContain(piece);
      expect(code(`${key}.fixed`), piece).toContain(piece);
    }
    // 고친 뒤에 달라졌다고 적은 것 가운데 글자 그대로 옮긴 것은 고치기 전 코드에 없다.
    for (const piece of quoted.fixed.filter((piece) => piece.length > 2)) expect(code(`${key}.main`), piece).not.toContain(piece);
  });

  it("고치기 전에는 두 판에 모두 맞는 말만, 고친 뒤에는 달라진 것까지 적는다", () => {
    for (const info of DEMO_APPS) {
      expect(find(`${info.key}.main`).variant.note).toBe(info.about);
      expect(find(`${info.key}.fixed`).variant.note).toBe(`${info.about} ${info.fixed}`);
    }
  });

  /** 설명을 문장으로 나눈다. 마침표 뒤에 빈칸이 올 때만 나눈다(코드에서 옮긴 문구 끝의 마침표는 따옴표로 닫힌다). */
  const sentences = (text: string) => text.split(/(?<=\.)\s+/);

  /**
   * 코드가 하는 일을 적은 글에는 나오지 않을 말. 법의 이름과 요구(…해야 한다, 동의를 받아야), 까닭(…때문, 그래서),
   * 결과(발견·경고가 없어진다, 풀린다)를 적으면 걸린다. 코드가 하는 일을 적을 때도 쓰는 말("나옵니다", "위해")은
   * 넣지 않았다.
   */
  const NOT_ABOUT_CODE = new RegExp(
    [
      // 법과 그 요구.
      "법률|법령|법적|법상|법정대리인|보호법|정보통신망|기본법|조문|조항|제\\s*\\d+\\s*조|의무|요건|규정|동의",
      "해야|[아어여]야\\s|[아어여]야만|지켜|금지|허용",
      // 까닭.
      "때문|그래서|따라서|그러므로|덕분",
      // 결과.
      "검토|판단|보류|발견|판정|충족|경고|신호|통과|해결|풀리|풀립|풀렸|사라|없어|줄어|안전|괜찮",
    ].join("|"),
  );

  it("법이 무엇을 요구하는지, 결과가 어떻게 나오는지는 적지 않는다", () => {
    // 조문은 조문 도감에 원문으로 있고, 결과는 화면 아래에 CLI 출력 그대로 보인다.
    for (const info of DEMO_APPS) {
      for (const text of [info.label, info.about, info.fixed]) {
        expect(NOT_ABOUT_CODE.exec(text)?.[0], text).toBeUndefined();
        for (const [pattern, why] of BANNED_WORDING) expect(pattern.test(text), `${text} — ${why}`).toBe(false);
      }
    }
    // 낱말 목록이 실제로 거르는지: 법의 요구, 까닭, 결과를 적은 문장.
    for (const text of [
      "만 14세 미만은 법정대리인의 동의를 받아야 가입할 수 있기 때문입니다.",
      "그래서 경고가 없어집니다.",
      "개인정보 보호법이 정한 대로 보냅니다.",
      "밤에는 보내면 안 되기 때문에 막습니다.",
      "고친 뒤에는 표시가 있어 검토 필요가 사라집니다.",
    ]) {
      expect(NOT_ABOUT_CODE.test(text), text).toBe(true);
    }
  });

  it("설명의 틀: 고치기 전은 한 문장, 고친 뒤는 '고친 뒤에는'으로 시작하고 문장마다 코드에서 옮긴 조각이 있다", () => {
    for (const info of DEMO_APPS) {
      // 고치기 전의 설명은 이 코드가 무엇인지를 한 문장으로 적는다("…입니다.").
      expect(sentences(info.about), info.about).toHaveLength(1);
      expect(info.about, info.about).toMatch(/입니다\.$/);
      // 고친 뒤의 설명은 달라진 것을 적는다. 문장마다 고친 뒤 코드에만 있는 조각을 글자 그대로 옮긴 것이 하나는 있다.
      // 수(14, 21, 8)만으로는 치지 않는다. 수는 법의 요구를 적은 문장에도 나온다("만 14세 미만은 …").
      expect(info.fixed, info.fixed).toMatch(/^고친 뒤에는 /);
      const pieces = QUOTED[info.key].fixed.filter((piece) => piece.length > 2);
      for (const sentence of sentences(info.fixed)) {
        expect(pieces.filter((piece) => sentence.includes(piece)), sentence).not.toEqual([]);
        expect(sentence, sentence).toMatch(/니다\.$/);
      }
    }
    // 나누는 법이 맞는지: 광고 푸시의 고친 뒤 설명은 두 문장이고, 채팅의 것은 따옴표 안에 마침표가 있어도 한 문장이다.
    expect(DEMO_APPS.map((info) => sentences(info.fixed).length)).toEqual([1, 2, 1]);
  });
});

describe("두 파일의 줄 차이", () => {
  const alone = (before: string[], after: string[]) => {
    const found = unmatchedLines(before, after);
    const numbers = (flags: boolean[]) => flags.flatMap((flag, i) => (flag ? [i + 1] : []));
    return { before: numbers(found.before), after: numbers(found.after) };
  };

  it("같은 글이면 짝이 없는 줄이 없다. 빈 글도 같다", () => {
    expect(alone(["a", "b"], ["a", "b"])).toEqual({ before: [], after: [] });
    expect(alone([], [])).toEqual({ before: [], after: [] });
    expect(alone([], ["a"])).toEqual({ before: [], after: [1] });
    expect(alone(["a"], [])).toEqual({ before: [1], after: [] });
  });

  it("더해진 줄, 빠진 줄, 바뀐 줄을 가린다", () => {
    expect(alone(["a", "c"], ["a", "b", "c"])).toEqual({ before: [], after: [2] });
    expect(alone(["a", "b", "c"], ["a", "c"])).toEqual({ before: [2], after: [] });
    // 바뀐 줄은 양쪽에서 모두 짝이 없다.
    expect(alone(["a", "b", "c"], ["a", "B", "c"])).toEqual({ before: [2], after: [2] });
    // 빈칸 하나만 달라도 다른 줄이다. 글자를 다듬어 견주지 않는다.
    expect(alone(["  a"], [" a"])).toEqual({ before: [1], after: [1] });
  });

  it("글이 같은 줄이 여럿이면 앞에서부터 짝짓는다", () => {
    // 닫는 괄호와 빈 줄처럼 같은 글이 되풀이될 때 어느 것을 짝지을지가 돌릴 때마다 달라지면 안 된다.
    expect(alone(["", "}"], ["", "f() {", "}", "", "g() {", "}"])).toEqual({ before: [], after: [2, 4, 5, 6] });
    expect(alone(["x", "x"], ["x"])).toEqual({ before: [2], after: [] });
  });

  it("자리가 바뀐 줄처럼 짝짓는 길이 여럿이면 앞 파일의 줄을 먼저 버린다", () => {
    // 두 줄의 자리가 바뀌면 어느 줄을 짝지어도 짝의 수가 같다. 그때 고르는 차례가 정해져 있어야 결과가 늘 같다.
    expect(alone(["a", "b"], ["b", "a"])).toEqual({ before: [1], after: [2] });
    expect(alone(["a", "x", "b"], ["b", "x", "a"])).toEqual({ before: [1, 2], after: [2, 3] });
    // 짝의 수가 다르면 더 많이 짝짓는 쪽을 고른다.
    expect(alone(["a", "b", "c"], ["c", "a", "b"])).toEqual({ before: [3], after: [1] });
    expect(alone(["a", "b", "c"], ["b", "c", "a"])).toEqual({ before: [1], after: [3] });
  });

  it("짝이 없는 줄을 빼면 두 글이 같다", () => {
    const samples: [string[], string[]][] = [
      [["a", "b", "c", "d"], ["b", "x", "d", "e"]],
      [["1", "", "2", "", "3"], ["", "1", "2", "3", ""]],
      ...apps.map((app): [string[], string[]] => [
        app.variants[0].files[0].lines.map((line) => line.text),
        app.variants[1].files[0].lines.map((line) => line.text),
      ]),
    ];
    for (const [before, after] of samples) {
      const found = unmatchedLines(before, after);
      expect(before.filter((_, i) => !found.before[i])).toEqual(after.filter((_, i) => !found.after[i]));
    }
  });

  it("데모 코드에서 다른 판과 다른 줄", () => {
    const differs = (name: string) =>
      find(name).variant.files.map((file) => file.lines.flatMap((line, i) => (line.differs ? [i + 1] : [])));
    // 아동 가입과 채팅은 줄이 더해지기만 했다. 광고 푸시는 바뀐 줄이 있다.
    expect(differs("kids-signup.main")).toEqual([[]]);
    expect(differs("kids-signup.fixed")).toEqual([[7]]);
    expect(differs("night-push.main")).toEqual([[4, 7, 9, 10]]);
    expect(differs("night-push.fixed")).toEqual([[4, 5, 6, 7, 8, 9, 11, 13, 15, 16]]);
    expect(differs("genai-chat.main")).toEqual([[]]);
    expect(differs("genai-chat.fixed")).toEqual([[7, 10]]);
  });
});

describe("코드 상자에서 칠하는 줄", () => {
  // 코드 상자에는 곁에 조문 이름이 없다. 발견을 펼친 안쪽의 글("이 조문이 닿는다고 본 첫 줄")에서 "이"를 뺀 말이다.
  const FILE_SCOPE = "파일 전체를 보고 내린 판정입니다. 줄 번호는 조문이 닿는다고 본 첫 줄입니다.";
  const marks = (name: string) => find(name).variant.files.map((file) => lineMarks(find(name).variant.view, file.path));

  it("줄 아래에 적는 말은 곁의 것을 가리키지 않는다 (코드 상자에는 조문 이름도 판정 경로도 곁에 없다)", () => {
    // 발견을 펼친 안쪽에서는 바로 위에 조문 이름이, 바로 아래에 판정 경로가 있다. 코드 상자에서는 그렇지 않다.
    expect(scopeNote({ kind: "file" }, "known", true)).toBe("파일 전체를 보고 내린 판정입니다. 줄 번호는 이 조문이 닿는다고 본 첫 줄입니다.");
    expect(scopeNote({ kind: "file" }, "known", true, "code")).toBe(FILE_SCOPE);
    expect(scopeNote({ kind: "unknown" }, "known", true)).toContain("아래 판정 경로의 문장을 보세요.");
    expect(scopeNote({ kind: "unknown" }, "known", true, "code")).toBe(
      "함수 단위 규칙의 판정입니다. 판정 구역은 결과에 따로 실려 있지 않습니다. 아래 결과에서 그 발견의 판정 경로를 보세요.",
    );
    // 판정이 본 범위를 적는 말은 자리가 달라도 같다.
    const scopes: JudgedScope[] = [{ kind: "file" }, { kind: "function", startLine: 9, endLine: 19 }, { kind: "top-level" }, { kind: "unknown" }];
    for (const scope of scopes) {
      for (const line of ["known", "unsure"] as const) {
        for (const hasPath of [true, false]) {
          const [inFinding, inCode] = [scopeNote(scope, line, hasPath), scopeNote(scope, line, hasPath, "code")];
          expect(inCode.split(". ")[0], inCode).toBe(inFinding.split(". ")[0]);
          // "이 조문"은 낱말로 본다("1행이 조문이"의 "이"는 조사다).
          expect(inCode, inCode).not.toMatch(/(?<![가-힣])이 조문|아래 판정 경로/);
        }
      }
    }
    // 채팅의 1행에는 조문이 다른 발견이 둘 실린다. "이 조문"이라고 적으면 가리킬 조문이 하나가 아니다.
    const laws = captured("genai-chat.fixed").findings.filter((finding) => finding.line === 1).map((finding) => finding.law);
    expect(laws.map((law) => /제31조 제\d항$/.exec(law)?.[0])).toEqual(["제31조 제2항", "제31조 제1항"]);
  });

  it.each(named)("%s: 결과의 발견에 실린 줄 번호만 칠한다", (name, { variant }) => {
    const lines = [...new Set(captured(name).findings.map((finding) => finding.line))].sort((a, b) => a! - b!);
    expect(variant.files).toHaveLength(1);
    expect(marks(name)[0].map((mark) => mark.line)).toEqual(lines);
    // 칠한 줄에 실린 발견을 모두 더하면 그 결과의 발견 수다.
    expect(marks(name)[0].reduce((sum, mark) => sum + mark.findings, 0)).toBe(captured(name).findings.length);
  });

  it("수집본의 발견은 모두 파일 단위 판정이다. 줄마다 발견 수와 판정이 본 범위를 적는다", () => {
    expect(marks("kids-signup.main")).toEqual([[{ line: 5, findings: 1, notes: [FILE_SCOPE] }]]);
    expect(marks("kids-signup.fixed")).toEqual([[]]);
    // 같은 줄에 규칙이 다른 발견이 둘 있다.
    expect(marks("night-push.main")).toEqual([[{ line: 2, findings: 2, notes: [FILE_SCOPE] }]]);
    // 고친 뒤에는 발견이 두 줄에 실린다. 12행은 import 줄이 아니다. 그래도 파일 전체를 보고 내린 판정이다.
    expect(marks("night-push.fixed")).toEqual([
      [
        { line: 2, findings: 2, notes: [FILE_SCOPE] },
        { line: 12, findings: 1, notes: [FILE_SCOPE] },
      ],
    ]);
    // 같은 줄에 정책이 다른 발견이 둘 있다.
    expect(marks("genai-chat.main")).toEqual([[{ line: 1, findings: 2, notes: [FILE_SCOPE] }]]);
    expect(marks("genai-chat.fixed")).toEqual([[{ line: 1, findings: 2, notes: [FILE_SCOPE] }]]);
  });

  it("다른 파일의 발견과 줄이 없는 발견은 칠하지 않는다. 판정 범위가 다르면 범위를 모두 적는다", () => {
    const data = captured("night-push.fixed");
    const patch: Partial<Finding>[] = [
      // 줄이 없는 발견.
      { line: null },
      // 다른 파일의 발견.
      { file: "src/other.ts" },
      // 함수 단위 판정으로 바꾼 발견. 같은 12행이다.
      { line: 12, scope: "anchor", region: { start_line: 9, end_line: 19 } },
    ];
    const findings = [...data.findings.map((finding, i) => ({ ...finding, ...patch[i] })), data.findings[0]];
    const view = viewOf({ ...data, findings });
    // 범위는 화면의 정책 카드 순서로 적는다(먼저 봐야 할 정책부터).
    expect(lineMarks(view, "src/marketing/campaign.ts")).toEqual([
      {
        line: 12,
        findings: 2,
        notes: ["함수 단위로 내린 판정입니다. 판정 구역은 9~19행입니다.", FILE_SCOPE],
      },
    ]);
    expect(lineMarks(view, "src/other.ts").map((mark) => mark.line)).toEqual([2]);
    expect(lineMarks(view, "src/none.ts")).toEqual([]);
  });
});

describe("고치기 전과 고친 뒤의 결과를 정책별로 견준다", () => {
  const rows = (key: string) => compareByPolicy(apps.find((app) => app.key === key)!.variants.map((variant) => variant.view));
  const PENDING = "needs-review-ai-pending";

  it("아동 가입: 고친 뒤에는 그 정책의 발견이 결과에 없다", () => {
    expect(rows("kids-signup")).toEqual([
      {
        id: "kr.pipa.22-2",
        title: "만 14세 미만 아동의 개인정보 처리",
        cells: [
          { status: PENDING, findings: 1, aiCleared: 0 },
          { status: "not-reported", findings: 0, aiCleared: 0 },
        ],
      },
    ]);
  });

  it("광고 푸시: 고친 뒤에도 두 발견이 남고, 고치기 전에 없던 정책의 발견이 하나 나온다", () => {
    expect(rows("night-push")).toEqual([
      {
        id: "kr.network-act.50-4",
        title: "광고성 정보에 밝혀야 할 사항 — (광고) 표기, 전송자 명칭·연락처, 무료 수신거부 방법",
        cells: [
          { status: PENDING, findings: 2, aiCleared: 0 },
          { status: PENDING, findings: 2, aiCleared: 0 },
        ],
      },
      {
        id: "kr.network-act.50-3",
        title: "야간(21시~08시) 광고성 정보 전송의 별도 동의",
        cells: [
          { status: "not-reported", findings: 0, aiCleared: 0 },
          { status: "uncertain", findings: 1, aiCleared: 0 },
        ],
      },
    ]);
  });

  it("생성형 AI 채팅: 고친 뒤에도 두 발견이 남는다. 하나는 판단 보류가 된다", () => {
    expect(rows("genai-chat")).toEqual([
      {
        id: "kr.ai-basic-act.31",
        title: "생성형 AI 결과물 표시",
        cells: [
          { status: PENDING, findings: 1, aiCleared: 0 },
          { status: "uncertain", findings: 1, aiCleared: 0 },
        ],
      },
      {
        id: "kr.ai-basic-act.31-1",
        title: "생성형 AI 기반 서비스 사전 고지",
        cells: [
          { status: PENDING, findings: 1, aiCleared: 0 },
          { status: PENDING, findings: 1, aiCleared: 0 },
        ],
      },
    ]);
  });

  it("어느 판에도 발견이 없는 정책은 줄이 아니다. 두 판 모두 발견이 없으면 줄이 없다", () => {
    for (const app of apps) {
      const found = new Set(app.variants.flatMap((variant) => captured(`${app.key}.${variant.key}`).findings.map((finding) => finding.policy)));
      expect(rows(app.key).map((row) => row.id).sort(), app.key).toEqual([...found].sort());
    }
    const empty = viewOf(readJson("contract", "cli-current", "plain.main.json"));
    expect(compareByPolicy([empty, empty])).toEqual([]);
  });

  it("그 결과에 카드가 없는 정책은 발견 없음이 아니라 알 수 없음으로 둔다", () => {
    // 팩 메타데이터 없이 만든 화면 구조에는 발견이 있는 정책만 있다(다른 판의 팩으로 만든 결과가 이렇게 된다).
    expect(compareByPolicy([bareView("night-push.main"), bareView("night-push.fixed")])[1]).toEqual({
      id: "kr.network-act.50-3",
      title: "야간(21시~08시) 광고성 정보 전송의 별도 동의",
      cells: [
        { status: "pack-unknown", findings: 0, aiCleared: 0 },
        { status: "uncertain", findings: 1, aiCleared: 0 },
      ],
    });
  });

  it("발견을 지문으로 짝짓지 않는다: 고치기 전·후의 지문은 판정과 따로 움직인다", () => {
    // 지문은 줄 둘레의 코드로 만든다(CLI 소스 report/fingerprint.py). 그래서 두 결과의 발견을 지문으로 짝지으면
    // 같은 규칙·같은 파일의 발견이 새 발견처럼 보이거나, 판정이 달라진 발견이 그대로인 것처럼 보인다.
    const prints = (name: string) => Object.fromEntries(captured(name).findings.map((f) => [f.rule, [f.fingerprint, f.outcome]]));
    const [pushBefore, pushAfter] = [prints("night-push.main"), prints("night-push.fixed")];
    for (const rule of ["nonemail-start-block", "nonemail-end-optout"]) {
      // 판정은 같은데 지문이 다르다.
      expect(pushAfter[rule][1], rule).toBe(pushBefore[rule][1]);
      expect(pushAfter[rule][0], rule).not.toBe(pushBefore[rule][0]);
    }
    const [chatBefore, chatAfter] = [prints("genai-chat.main"), prints("genai-chat.fixed")];
    // 판정이 달라졌는데 지문이 같다.
    expect(chatAfter["ai-output-without-label"][0]).toBe(chatBefore["ai-output-without-label"][0]);
    expect(chatAfter["ai-output-without-label"][1]).not.toBe(chatBefore["ai-output-without-label"][1]);
  });
});

describe("그려 낸 데모 화면", () => {
  it.each(named)("%s: 합성 예시라고 밝히고, 쓰지 않는 말이 없다", (_name, entry) => {
    const html = panel(entry);
    for (const [pattern, why] of BANNED_WORDING) expect(pattern.test(html), `${pattern} — ${why}`).toBe(false);
    expect(textOf(elementAt(html, html.indexOf("<h2")))).toBe(`${entry.app.label} · ${entry.variant.label}`);
    // 판마다 두 곳에 밝힌다: 설명의 첫 문장과 코드 상자의 이름표.
    expect(textOf(elementAt(html, html.indexOf('<p class="demo-note">')))).toBe(`합성 예시입니다. ${entry.variant.note}`);
    for (const box of codeBoxes(html)) expect(box.caption).toMatch(/^src\/\S+ · 합성 예시$/);
    expect(html).toContain(SITE.disclaimer);
    // 팩 작성자 메모는 화면 구조에도 없다.
    expect(JSON.stringify(entry.variant)).not.toMatch(/rationale|motivation/);
  });

  it.each(named)("%s: 코드 상자는 그 파일의 줄을 그대로 보인다", (name, entry) => {
    const boxes = codeBoxes(panel(entry));
    expect(boxes).toHaveLength(entry.variant.files.length);
    entry.variant.files.forEach((file, i) => {
      expect(boxes[i].caption).toBe(`${file.path} · 합성 예시`);
      expect(boxes[i].lines.map((line) => line.line)).toEqual(file.lines.map((_, n) => n + 1));
      expect(boxes[i].lines.map((line) => `${line.text}\n`).join("")).toBe(fixture(name, file.path));
    });
  });

  it.each(named)("%s: 칠한 줄은 발견에 실린 줄 번호뿐이고, 바로 아래에 파일 전체를 보고 내린 판정이라고 적는다", (name, entry) => {
    const { findings } = captured(name);
    const [box] = codeBoxes(panel(entry));
    const lines = [...new Set(findings.map((finding) => finding.line))].sort((a, b) => a! - b!);
    expect(box.lines.filter((line) => line.marked).map((line) => line.line)).toEqual(lines);
    // 칠한 줄마다 바로 다음에 설명이 하나 있고, 설명은 칠한 줄 아래에만 있다.
    box.items.forEach((item, i) => {
      const next = box.items[i + 1];
      if (item.kind === "line") expect(next?.kind === "note", `${item.line}행`).toBe(item.marked);
      else expect(box.items[i - 1], item.text).toMatchObject({ kind: "line", marked: true });
    });
    for (const line of lines) {
      const count = findings.filter((finding) => finding.line === line).length;
      const note = box.items[box.items.findIndex((item) => item.kind === "line" && item.line === line) + 1];
      expect(note.text, `${line}행`).toBe(
        `발견 ${count}건에 실린 줄 번호입니다. 파일 전체를 보고 내린 판정입니다. 줄 번호는 조문이 닿는다고 본 첫 줄입니다.`,
      );
    }
  });

  it.each(named)("%s: 다른 판과 다른 줄에는 표시만 붙이고, 무엇과 견준 것인지 적는다", (_name, entry) => {
    const [box] = codeBoxes(panel(entry));
    const [file] = entry.variant.files;
    const signed = box.lines.filter((line) => line.sign !== null);
    expect(signed.map((line) => line.line)).toEqual(file.lines.flatMap((line, i) => (line.differs ? [i + 1] : [])));
    for (const line of signed) expect(line.sign).toBe(entry.variant.sign);
    const legend = {
      main: "− 고친 뒤의 파일과 견주어 빠졌거나 바뀐 줄입니다.",
      fixed: "+ 고치기 전의 파일과 견주어 더해졌거나 바뀐 줄입니다.",
    }[entry.variant.key];
    // 표시가 붙은 줄이 없으면 풀이도 없다.
    expect(box.legend).toBe(signed.length > 0 ? legend : null);
    // 그 차이가 판정을 바꿨다고 적지 않는다. 두 파일을 견준 것이라고만 적는다.
    expect(box.legend ?? "").not.toMatch(/판정|발견|때문|덕분|풀/);
  });

  it("다른 판과 다른 줄을 칠하지 않는다 (칠하는 것과 표시하는 것은 따로다)", () => {
    const [box] = codeBoxes(panel(find("night-push.fixed")));
    expect(box.lines.filter((line) => line.marked).map((line) => line.line)).toEqual([2, 12]);
    expect(box.lines.filter((line) => line.sign).map((line) => line.line)).toEqual([4, 5, 6, 7, 8, 9, 11, 13, 15, 16]);
  });

  describe("고치기 전과 고친 뒤의 결과", () => {
    const PENDING = STATUS_LABEL["needs-review-ai-pending"];
    const UNCERTAIN = STATUS_LABEL.uncertain;
    const NONE = STATUS_LABEL["not-reported"];
    /** 표의 정책 이름이 어디로 가는지. 아래 결과가 어느 판의 것인지를 함께 적는다(표는 두 판을 함께 보인다). */
    const WHERE = (label: string) => `표의 정책 이름을 누르면 아래 결과(${label})의 그 정책으로 갑니다.`;
    /** 발견마다의 까닭이 어디에 나오는지. 아래 결과에 판정 경로가 실려 있을 때만 위의 말 뒤에 붙는다. */
    const WHY = "발견마다의 까닭은 그 안의 ‘판정 경로’에 CLI 가 남긴 문장으로 나옵니다.";
    /** 표에는 나오지만 아래 결과에는 없는 것(다른 판의 발견)을 어디서 보는지. */
    const ELSEWHERE = (label: string) => `${label}의 결과는 위의 ‘${label}’ 단추를 누르면 나옵니다.`;
    const cells = (name: string) => compareBlock(panel(find(name)))!.rows.map((row) => [row.title, ...row.cells.map((c) => [c.status, c.counts])]);
    const report = (html: string) => html.slice(html.indexOf('<section class="report">'));
    /** 그려 낸 정책 카드의 id 와 이름. */
    const cards = (html: string) =>
      elementsOf(html, '<article class="policy ').map((card) => ({
        id: /^<article [^>]*\bid="([^"]*)"/.exec(card)?.[1],
        title: textOf(elementAt(card, card.indexOf("<h3"))),
      }));

    it.each(named)("%s: 표는 두 결과의 정책 카드와 같은 상태·발견 수를 적는다", (_name, entry) => {
      const html = panel(entry);
      const block = compareBlock(html)!;
      expect(block.caption).toBe("고치기 전과 고친 뒤의 결과");
      expect(block.columns).toEqual(["정책", "고치기 전", "고친 뒤"]);
      const expected = compareByPolicy(entry.app.variants.map((variant) => variant.view));
      expect(block.rows).toEqual(
        expected.map((row) => ({
          title: row.title,
          href: `#${policyCardId(row.id)}`,
          cells: row.cells.map((cell, i) => ({
            label: entry.app.variants[i].label,
            status: STATUS_LABEL[cell.status],
            counts: cell.findings > 0 ? [`발견 ${cell.findings}건`] : [],
            // 지금 보고 있는 판의 칸만 표시한다.
            current: entry.app.variants[i].key === entry.variant.key,
          })),
        })),
      );
      // 코드 아래, 이 판의 결과 위에 있다.
      const order = [html.lastIndexOf("</figure>"), block.at, html.indexOf('<section class="report">')];
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it("고친 뒤에도 남은 발견을 그대로 보인다", () => {
      expect(cells("kids-signup.fixed")).toEqual([["만 14세 미만 아동의 개인정보 처리", [PENDING, ["발견 1건"]], [NONE, []]]]);
      expect(cells("night-push.fixed")).toEqual([
        ["광고성 정보에 밝혀야 할 사항 — (광고) 표기, 전송자 명칭·연락처, 무료 수신거부 방법", [PENDING, ["발견 2건"]], [PENDING, ["발견 2건"]]],
        ["야간(21시~08시) 광고성 정보 전송의 별도 동의", [NONE, []], [UNCERTAIN, ["발견 1건"]]],
      ]);
      expect(cells("genai-chat.fixed")).toEqual([
        ["생성형 AI 결과물 표시", [PENDING, ["발견 1건"]], [UNCERTAIN, ["발견 1건"]]],
        ["생성형 AI 기반 서비스 사전 고지", [PENDING, ["발견 1건"]], [PENDING, ["발견 1건"]]],
      ]);
      // 어느 판을 보고 있든 표는 같다(지금 보는 판의 표시만 다르다).
      for (const key of ["kids-signup", "night-push", "genai-chat"]) expect(cells(`${key}.main`)).toEqual(cells(`${key}.fixed`));
    });

    it("칸의 발견 수는 정책 카드의 발견 수다. 규칙 묶음의 수가 아니다", () => {
      // 수집본은 규칙마다 발견이 한 건이라 두 수가 같다. 같은 규칙이 여러 파일에 나오는 결과로 본다(시험에서만 쓰는 자료).
      const repeated = viewOf(readJson("tests", "fixtures", "repeated-rule.json"));
      const policy = repeated.policies.find((p) => p.id === "kr.network-act.50-4")!;
      expect([policy.locations.length, policy.rules.length]).toEqual([25, 5]);
      const app = appWith("night-push", [repeated, find("night-push.fixed").variant.view]);
      expect(compareByPolicy(app.variants.map((variant) => variant.view))[0]).toMatchObject({
        id: "kr.network-act.50-4",
        cells: [{ findings: 25 }, { findings: 2 }],
      });
      const html = renderToStaticMarkup(<DemoPanel app={app} variant={app.variants[0]} />);
      expect(compareBlock(html)!.rows[0].cells.map((cell) => cell.counts)).toEqual([["발견 25건"], ["발견 2건"]]);
      // 바로 아래 결과의 그 정책 카드가 적는 수와 같다.
      const card = elementsOf(html, '<article class="policy ').find((el) => el.includes(`id="${policyCardId(policy.id)}"`))!;
      expect(textOf(elementAt(card, card.indexOf('<span class="count">')))).toBe("발견 25건");
    });

    it("왜 그 상태인지는 상태의 뜻으로 적는다: AI 확인 전, 약한 근거", () => {
      const notes = (name: string) => compareBlock(panel(find(name)))!.notes;
      const pending = `${PENDING} ${STATUS_LEGEND["needs-review-ai-pending"]}`;
      const uncertain = `${UNCERTAIN} ${STATUS_LEGEND.uncertain}`;
      const none = `${NONE} ${STATUS_LEGEND["not-reported"]}`;
      // 표에 나온 상태만, 먼저 봐야 할 것부터 적는다.
      expect(notes("kids-signup.fixed")).toEqual([pending, none]);
      expect(notes("night-push.fixed")).toEqual([pending, uncertain, none]);
      expect(notes("genai-chat.fixed")).toEqual([pending, uncertain]);
      expect(STATUS_LEGEND["needs-review-ai-pending"]).toContain("AI 에게 물어야 할 조건은 판정에 넣을 답이 없습니다");
      expect(STATUS_LEGEND.uncertain).toContain("약한 근거만 있거나");
      // 발견이 없다는 것을 충족이라고 적지 않는다.
      expect(STATUS_LEGEND["not-reported"]).toContain("구분할 수 없습니다");
    });

    it("상태의 뜻은 정책 카드 밖에서 적는 말이다: 곁에 없는 정책·조문을 '이'로 가리키지 않는다", () => {
      // 정책 카드 안의 말(STATUS_HINT)은 그 카드의 정책을 두고 "이 정책", "이 조문"이라고 적는다. 표 아래의 풀이에는
      // 그 말이 가리킬 정책이 없다.
      const POINTS = /이 (정책|조문|결과)/;
      for (const status of STATUS_ORDER) {
        expect(STATUS_LEGEND[status], status).not.toMatch(POINTS);
        // 가리키는 말이 없는 상태는 정책 카드의 말 그대로다.
        if (!POINTS.test(STATUS_HINT[status])) expect(STATUS_LEGEND[status], status).toBe(STATUS_HINT[status]);
      }
      expect(STATUS_ORDER.filter((status) => STATUS_LEGEND[status] !== STATUS_HINT[status])).toEqual([
        "needs-review",
        "no-signal",
        "not-reported",
        "pack-unknown",
      ]);
      // 가리키는 말만 걷어 냈다. 뜻을 이루는 말은 정책 카드의 것과 같다.
      for (const [status, kept] of [
        ["needs-review", "조문이 닿는 코드인데, 적법한 대안이 하나도 확인되지 않았습니다. 사람이 봐야 합니다."],
        ["no-signal", "조문이 닿는 코드 신호를 찾지 못했습니다. 법적 문제가 없다는 뜻은 아닙니다."],
        ["not-reported", "지금 CLI 출력으로는 '충족 근거 발견'과 '적용 신호 없음'을 구분할 수 없습니다."],
        ["pack-unknown", "알 수 없습니다."],
      ] as const) {
        expect(STATUS_HINT[status], status).toContain(kept);
        expect(STATUS_LEGEND[status], status).toContain(kept);
      }
      // 그 구역의 칩에 마우스를 올렸을 때 뜨는 말도 그 자리의 말이다(칩 옆의 글과 다른 말이 뜨지 않는다).
      for (const entry of every) {
        const html = panel(entry);
        const block = elementAt(html, html.indexOf('<div class="demo-compare">'));
        const chips = [...block.matchAll(/<span class="chip chip-([a-z-]+)" title="([^"]*)">/g)];
        expect(chips.length, entry.name).toBeGreaterThan(0);
        for (const [, status, hint] of chips) expect(textOf(hint), `${entry.name}: ${status}`).toBe(STATUS_LEGEND[status as Status]);
        expect(textOf(block), entry.name).not.toMatch(POINTS);
      }
    });

    it.each(named)("%s: 표의 정책 이름은 아래 결과의 그 정책 카드로 가는 링크다", (_name, entry) => {
      const html = panel(entry);
      const below = cards(report(html));
      // 카드마다 id 가 있고 서로 다르다. 주소의 이름과 같게 점이 없다.
      expect(below).toHaveLength(packMeta.policies.length);
      expect(new Set(below.map((card) => card.id)).size).toBe(below.length);
      for (const card of below) expect(card.id, card.title).toMatch(/^policy-[a-z0-9-]+$/);
      const rows = compareBlock(html)!.rows;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        // 같은 쪽 안의 자리다. 다른 쪽으로 가지 않는다.
        expect(row.href, row.title).toMatch(/^#policy-/);
        // 가는 곳은 같은 정책의 카드다. 그 판에 발견이 없는 정책이어도 카드는 있다.
        expect(below.filter((card) => `#${card.id}` === row.href).map((card) => card.title), row.title).toEqual([row.title]);
      }
    });

    it("아래 결과에 카드가 없는 정책의 이름은 링크가 아니다 (팩 메타데이터 없이 만든 결과)", () => {
      const app = appWith("night-push", [bareView("night-push.main"), bareView("night-push.fixed")]);
      const [before, after] = app.variants.map((variant) => compareBlock(renderToStaticMarkup(<DemoPanel app={app} variant={variant} />))!);
      // 고치기 전의 결과에는 제50조 제3항의 카드가 없다(발견이 없고, 팩 메타데이터도 없다).
      expect(before.rows.map((row) => row.href)).toEqual(["#policy-kr-network-act-50-4", null]);
      expect(after.rows.map((row) => row.href)).toEqual(["#policy-kr-network-act-50-4", "#policy-kr-network-act-50-3"]);
      // 그 칸은 "발견 없음"이 아니라 "알 수 없음"이고, 뜻도 그렇게 적는다.
      expect(before.rows[1].cells.map((cell) => cell.status)).toEqual([STATUS_LABEL["pack-unknown"], UNCERTAIN]);
      expect(before.notes.at(-1)).toBe(`${STATUS_LABEL["pack-unknown"]} ${STATUS_LEGEND["pack-unknown"]}`);
    });

    it("가리키는 말은 지금 보는 판의 결과를 가리킨다. 다른 판의 결과는 그 판을 골라야 나온다고 적는다", () => {
      for (const { name, app, variant } of every) {
        const html = panel(find(name));
        const block = compareBlock(html)!;
        const other = app.variants.find((v) => v.key !== variant.key)!;
        expect(block.hints, name).toEqual([
          // 발견이 0인 다른 판이 표에 있으면 0의 뜻을 먼저 적는다(아래의 시험).
          ...(variant.view.findingCount > 0 && other.view.findingCount === 0 ? [SITE.zeroIsNotClearance] : []),
          // 발견이 없는 판(아동 가입 고친 뒤)에는 가리킬 판정 경로가 없다. 정책 이름이 어디로 가는지만 적는다.
          variant.view.findingCount > 0 ? `${WHERE(variant.label)} ${WHY}` : WHERE(variant.label),
          // 다른 판에 발견이 있으면, 그 결과를 어디서 보는지 적는다.
          ...(other.view.findingCount > 0 ? [ELSEWHERE(other.label)] : []),
        ]);
        // 판정 경로의 문장은 아래 결과에 글자 그대로 있다. 발견마다 하나다.
        const shown = elementsOf(report(html), '<ol class="path">').map((ol) => elementsOf(ol, "<li>").map(textOf));
        expect(shown, name).toHaveLength(captured(name).findings.length);
        for (const finding of captured(name).findings) expect(shown, `${name}: ${finding.rule}`).toContainEqual(finding.decision_path);
      }
      // 약한 근거라는 까닭은 CLI 가 남긴 문장에만 있다. 웹이 그 문장을 풀어 다시 적지 않는다.
      const push = panel(find("night-push.fixed"));
      expect(textOf(push)).toContain("대안 night-consent-field: 약한 근거 — AI 확인 전에는 풀지 않음 → unknown");
      expect(textOf(panel(find("genai-chat.fixed")))).toContain("대안 label-text: 약한 근거 — AI 확인 전에는 풀지 않음 → unknown");
      expect(captured("night-push.fixed").findings.map((f) => f.untested_reasons)).toEqual([["no-judge"], ["no-judge"], ["no-judge"]]);
    });

    it("고치기 전을 볼 때: 표의 '고친 뒤' 칸에 있는 판단 보류의 까닭은 아래 결과에 없다. 그래서 아래 결과가 고치기 전의 것이라고 적는다", () => {
      // 표와 상태의 뜻은 어느 판을 보든 같다. 아래 결과는 지금 보는 판의 것뿐이다. "아래 결과의 판정 경로"라고만 적으면
      // 고치기 전을 볼 때 표의 판단 보류(고친 뒤의 것)까지 아래에서 찾게 된다.
      const WEAK = "약한 근거 — AI 확인 전에는 풀지 않음 → unknown";
      for (const key of ["night-push", "genai-chat"]) {
        const [before, after] = [panel(find(`${key}.main`)), panel(find(`${key}.fixed`))];
        const block = compareBlock(before)!;
        // 표에는 고친 뒤의 판단 보류가 보이고, 그 뜻도 적혀 있다.
        expect(block.rows.flatMap((row) => row.cells.filter((cell) => cell.label === "고친 뒤").map((cell) => cell.status)), key).toContain(UNCERTAIN);
        expect(block.notes.filter((note) => note.startsWith(UNCERTAIN)), key).toHaveLength(1);
        // 아래 결과(고치기 전)에는 판단 보류인 발견도, 약한 근거라는 문장도 없다. 고친 뒤를 골라야 나온다.
        expect(textOf(report(before)), key).not.toContain(UNCERTAIN);
        expect(textOf(report(before)), key).not.toContain(WEAK);
        expect(textOf(report(after)), key).toContain(UNCERTAIN);
        expect(textOf(report(after)), key).toContain(WEAK);
        expect(block.hints, key).toEqual([`${WHERE("고치기 전")} ${WHY}`, ELSEWHERE("고친 뒤")]);
        expect(compareBlock(after)!.hints, key).toEqual([`${WHERE("고친 뒤")} ${WHY}`, ELSEWHERE("고치기 전")]);
      }
    });

    it("고친 뒤에 발견이 0인 앱은, 어느 판을 보고 있든 0이 법적 문제가 없다는 뜻이 아니라는 말이 한 번 보인다", () => {
      // 표는 고치기 전을 보고 있을 때도 고친 뒤의 "발견 없음"을 보인다. 0의 뜻이 그 판을 열어야만 보이면 안 된다.
      // 발견이 0인 판을 보고 있을 때는 바로 아래의 결과가 같은 말을 적는다. 두 번 적지 않는다.
      const count = (html: string) => html.split(SITE.zeroIsNotClearance).length - 1;
      for (const { name, app, variant } of every) {
        const zero = app.variants.some((v) => v.view.findingCount === 0);
        expect(zero, name).toBe(app.key === "kids-signup");
        const html = panel(find(name));
        const block = compareBlock(html)!;
        expect(count(html), name).toBe(zero ? 1 : 0);
        expect(block.hints.includes(SITE.zeroIsNotClearance), name).toBe(zero && variant.view.findingCount > 0);
      }
      // 고치기 전을 볼 때: 상태의 뜻 다음, 정책 이름과 판정 경로를 가리키는 말 앞에 적는다.
      expect(compareBlock(panel(find("kids-signup.main")))!.hints).toEqual([SITE.zeroIsNotClearance, `${WHERE("고치기 전")} ${WHY}`]);
      // 고친 뒤를 볼 때: 아래 결과에 발견이 없으므로 판정 경로를 가리키지 않는다. 고치기 전의 발견은 그 판을 골라야 나온다.
      expect(compareBlock(panel(find("kids-signup.fixed")))!.hints).toEqual([WHERE("고친 뒤"), ELSEWHERE("고치기 전")]);
      expect(SITE.zeroIsNotClearance).toContain("법적 문제가 없다는 뜻은 아닙니다");
    });

    it("풀렸다고도 여전히 문제라고도 적지 않는다", () => {
      for (const entry of every) {
        const html = panel(entry);
        // 결과 화면 위쪽(설명, 코드 상자, 두 결과의 표)에 웹이 더한 글.
        const added = textOf(html.slice(0, html.indexOf('<section class="report">')));
        expect(added, entry.name).not.toMatch(/해결|통과|안전|괜찮|여전히|아직도|고쳐졌|풀렸|풀립니다|충족했|준수/);
      }
    });

    describe("판정자를 켠 결과가 실리면 (수집본에는 없다. 손으로 만든 시험용 자료로 본다)", () => {
      // 데모가 읽는 수집본은 모두 판정자 없이 만든 것이다. 판정자를 켠 수집본을 만들지는 사람이 정한다
      // (docs/ROADMAP.md). 그런 결과가 실렸을 때 표가 AI 가 푼 경고를 숨기지 않는지를 미리 본다.
      const rejected = viewOf(readJson("tests", "fixtures", "judge-on.citation-rejected.json"));
      const cleared = viewOf(readJson("tests", "fixtures", "judge-on.cleared.json"));
      const judged = appWith("kids-signup", [rejected, cleared]);
      const AI_NOTE =
        "AI 가 푼 경고는 AI 판정자의 답으로 풀린 경고이고, 발견에는 들어 있지 않습니다. 인용한 줄은 그 결과의 ‘AI 가 푼 경고’에서 확인하세요.";

      it("칸마다 AI 가 푼 경고의 수를 싣는다. 발견이 없고 AI 가 푼 경고만 있는 정책도 줄이 된다", () => {
        expect([rejected.judge, cleared.judge]).toEqual(["claude-cli:haiku", "claude-cli:haiku"]);
        expect([cleared.findingCount, cleared.aiCleared.length]).toEqual([0, 1]);
        const row = { id: "kr.pipa.22-2", title: "만 14세 미만 아동의 개인정보 처리" };
        expect(compareByPolicy([rejected, cleared])).toEqual([
          {
            ...row,
            cells: [
              { status: "needs-review-ai-pending", findings: 1, aiCleared: 0 },
              { status: "not-reported", findings: 0, aiCleared: 1 },
            ],
          },
        ]);
        // 두 판 모두 발견이 없어도 AI 가 푼 경고가 있으면 줄이 된다. 표에서 빠지면 AI 가 푼 것을 숨기는 것이 된다.
        const quiet = { status: "not-reported", findings: 0, aiCleared: 1 };
        expect(compareByPolicy([cleared, cleared])).toEqual([{ ...row, cells: [quiet, quiet] }]);
      });

      it.each(judged.variants.map((variant) => [variant.label, variant] as const))(
        "%s 판을 볼 때: 표에 'AI 가 푼 경고 1건'이 보이고, 풀이가 그 정책 카드의 말과 어긋나지 않는다",
        (_label, variant) => {
          const html = renderToStaticMarkup(<DemoPanel app={judged} variant={variant} />);
          const block = compareBlock(html)!;
          expect(block.rows.map((row) => row.cells.map((cell) => [cell.label, cell.status, cell.counts]))).toEqual([
            [
              ["고치기 전", PENDING, ["발견 1건"]],
              ["고친 뒤", NONE, ["AI 가 푼 경고 1건"]],
            ],
          ]);
          // 발견이 없고 AI 가 푼 경고가 있는 칸에는 "발견 없음"의 풀이(충족인지 미적용인지 구분할 수 없다)를 적지 않는다.
          // 그 정책 카드도 그 말 대신 AI 가 푼 경고가 있다고 적는다.
          expect(block.notes).toEqual([`${PENDING} ${STATUS_LEGEND["needs-review-ai-pending"]}`, AI_NOTE]);
          for (const [pattern, why] of BANNED_WORDING) expect(pattern.test(html), `${pattern} — ${why}`).toBe(false);
          // 판정자가 켜져 있던 결과다. 켜 보라고 권하지 않는다.
          expect(html).not.toContain("판정자를 켜고");
        },
      );

      it("고친 뒤(AI 가 푼 판)를 볼 때: 아래 결과의 정책 카드와 목록이 같은 것을 말한다", () => {
        const html = renderToStaticMarkup(<DemoPanel app={judged} variant={judged.variants[1]} />);
        const card = elementsOf(html, '<article class="policy ').find((el) => el.includes(`id="${policyCardId("kr.pipa.22-2")}"`))!;
        expect(textOf(card)).toContain("AI 판정자의 답으로 풀린 경고가 1건 있습니다.");
        expect(textOf(card)).not.toContain("구분할 수 없습니다");
        expect(html).toContain("<summary>AI 가 푼 경고 1건</summary>");
        // 발견이 0인 판이다. 0의 뜻은 아래 결과가 적는다.
        expect(html.split(SITE.zeroIsNotClearance).length - 1).toBe(1);
        expect(compareBlock(html)!.hints).toEqual([WHERE("고친 뒤"), ELSEWHERE("고치기 전")]);
      });

      it("고치기 전을 볼 때: 고친 뒤의 AI 가 푼 경고는 그 판을 골라야 나온다고 적는다", () => {
        const html = renderToStaticMarkup(<DemoPanel app={judged} variant={judged.variants[0]} />);
        // 아래 결과(고치기 전)에는 AI 가 푼 경고의 목록이 없다.
        expect(report(html)).not.toContain("AI 가 푼 경고");
        expect(compareBlock(html)!.hints).toEqual([SITE.zeroIsNotClearance, `${WHERE("고치기 전")} ${WHY}`, ELSEWHERE("고친 뒤")]);
      });

      it("판정자 없이 검사한 결과에는 AI 가 푼 경고의 말이 없다 (수집본 여섯 판)", () => {
        for (const entry of every) {
          const block = compareBlock(panel(entry))!;
          expect(block.notes.join(" "), entry.name).not.toContain("AI 가 푼 경고");
          expect(block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.counts)).join(" "), entry.name).not.toContain("AI");
        }
      });
    });
  });

  it.each(named)("%s: 판정자를 켜 보라고 권하는 자리마다 코드가 외부로 나간다는 것을 함께 적는다", (name, entry) => {
    const html = panel(entry);
    const advice = elementsOf(html, '<p class="pending">').map(textOf);
    // 판정자가 꺼져 있었고 AI 에게 묻지 못한 발견마다 한 번씩 권한다. 발견이 없는 판에서는 권하지 않는다.
    expect(advice).toHaveLength(captured(name).findings.filter((finding) => finding.ai_pending.length > 0).length);
    for (const text of advice) {
      expect(text).toContain("판정자를 켜고 다시 검사하면 풀릴 수 있습니다.");
      expect(text).toContain("판정자를 켜면 판정 대상 코드가 외부 API 로 나갑니다.");
    }
    // 그 밖의 자리에서는 권하지 않는다.
    expect(html.split("판정자를 켜고").length - 1).toBe(advice.length);
  });

  it("발견이 없는 판(아동 가입 고친 뒤): 0이어도 법적 문제가 없다는 뜻이 아니라고 적는다", () => {
    const html = panel(find("kids-signup.fixed"));
    expect(html).toContain(SITE.zeroIsNotClearance);
    expect(html).toContain('<div class="empty-report">');
    expect(codeBoxes(html)[0].lines.some((line) => line.marked)).toBe(false);
  });
});

describe("고르는 단추와 쪽의 머리말", () => {
  it("처음에는 첫 앱의 고치기 전이 열려 있다. 단추는 앱 셋과 판 둘이다", () => {
    const html = renderToStaticMarkup(<DemoSwitcher apps={apps} />);
    const groups = elementsOf(html, '<div class="segmented"').map((group) => ({
      label: /aria-label="([^"]*)"/.exec(group)?.[1],
      buttons: elementsOf(group, "<button").map((button) => [textOf(button), /aria-pressed="(true|false)"/.exec(button)?.[1]]),
    }));
    expect(groups).toEqual([
      {
        label: "데모 코드 고르기",
        buttons: [
          ["아동 가입", "true"],
          ["광고 푸시", "false"],
          ["생성형 AI 채팅", "false"],
        ],
      },
      {
        label: "고치기 전과 고친 뒤 고르기",
        buttons: [
          ["고치기 전", "true"],
          ["고친 뒤", "false"],
        ],
      },
    ]);
    expect(textOf(elementAt(html, html.indexOf("<h2")))).toBe("아동 가입 · 고치기 전");
    expect(html).toContain(panel(find("kids-signup.main")));
  });

  it("쪽의 머리말: 합성 예시이고 실제 서비스의 코드가 아니라고 밝힌다. 판정자 없이 검사했다고 적는다", () => {
    const html = renderToStaticMarkup(<DemoPage />);
    expect(textOf(elementAt(html, html.indexOf("<h1")))).toBe("데모: 고치기 전과 고친 뒤");
    expect(textOf(elementAt(html, html.indexOf('<p class="lede">')))).toBe(
      "합성 예시입니다. 실제 서비스의 코드가 아닙니다. 코드 3가지를 고치기 전과 고친 뒤로 나눠, 판정자 없이 같은 팩으로 검사한 CLI 실제 출력을 보입니다.",
    );
    // 같은 팩이라고 적었다. 여섯 결과의 팩 판이 하나다. 판정자 없이 검사했다는 것은 위에서 결과마다 봤다.
    expect(new Set(every.map(({ variant }) => variant.view.packDigest)).size).toBe(1);
    // 쪽이 그리는 것은 고르는 단추와 첫 판이다.
    expect(html).toContain(renderToStaticMarkup(<DemoSwitcher apps={apps} />));
    for (const [pattern, why] of BANNED_WORDING) expect(pattern.test(html), `${pattern} — ${why}`).toBe(false);
  });

  it("판정자를 켠 결과가 하나라도 실리면 머리말에 '판정자 없이'를 적지 않는다", () => {
    // 쪽은 빌드할 때 현재 폴더의 contract/ 를 읽는다. 저장소 밖의 임시 폴더에 합성 코드와 수집본을 옮겨 놓고, 수집본
    // 하나를 판정자를 켠 결과(손으로 만든 시험용 자료)로 바꾼 뒤 그 폴더에서 쪽을 그려 본다.
    const copy = mkdtempSync(path.join(tmpdir(), "policypack-demo-test-"));
    const cwd = vi.spyOn(process, "cwd");
    try {
      for (const dir of ["fixtures", "cli-current"]) {
        cpSync(path.join(root, "contract", dir), path.join(copy, "contract", dir), { recursive: true });
      }
      const lede = () => {
        const html = renderToStaticMarkup(<DemoPage />);
        return textOf(elementAt(html, html.indexOf('<p class="lede">')));
      };
      const WITHOUT = "합성 예시입니다. 실제 서비스의 코드가 아닙니다. 코드 3가지를 고치기 전과 고친 뒤로 나눠, 판정자 없이 같은 팩으로 검사한 CLI 실제 출력을 보입니다.";
      cwd.mockReturnValue(copy);
      // 옮겨 놓은 그대로면 저장소에서 그린 것과 같다(쪽이 임시 폴더를 읽는다는 뜻이다).
      expect(lede()).toBe(WITHOUT);
      cpSync(path.join(root, "tests", "fixtures", "judge-on.cleared.json"), path.join(copy, "contract", "cli-current", "kids-signup.fixed.json"));
      expect(lede()).toBe(WITHOUT.replace("판정자 없이 ", ""));
      expect(lede()).toBe("합성 예시입니다. 실제 서비스의 코드가 아닙니다. 코드 3가지를 고치기 전과 고친 뒤로 나눠, 같은 팩으로 검사한 CLI 실제 출력을 보입니다.");
    } finally {
      cwd.mockRestore();
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
