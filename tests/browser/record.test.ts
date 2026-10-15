import { readFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Locator, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEMO_APPS, DEMO_VARIANTS } from "@/lib/demo/apps";
import { primaryLawNote, RECORD_OMITS, RECORD_REFUSED } from "@/lib/report/record";
import type { Report } from "@/lib/report/types";
import { SAMPLES } from "@/lib/samples";
import { SITE } from "@/lib/site";
import { jsonFiles, readJson, readPackFile, root, sarifFiles } from "../helpers";
import { withCodeEverywhere } from "../record-data";
import {
  accessibleNodes,
  closeChrome,
  contrast,
  cssDrawn as cssDrawnIn,
  launchChrome,
  NO_STORAGE,
  openPage,
  overflow,
  serveOut,
  settle,
  stored,
  undrawn as undrawnIn,
  type OpenOptions,
  type Site,
} from "./site";

// 조문별 검사 기록(인쇄용)을 실제 브라우저로 열어 본다. 빌드된 out/ 을 127.0.0.1 에 띄우고 이 컴퓨터의 Chrome(헤드리스)으로 연다.
// 그려 낸 HTML 만 보는 시험(tests/record.test.tsx)이 볼 수 없는 것을 본다: 결과가 열려 있는 자리(`/view`, `/demo`)에서
// 단추로 기록을 고르는 것, 인쇄할 때 기록만 나오는지와 색, A4 로 몇 쪽인지, 좁은 화면의 가로 넘침, 지문을 골라 복사한
// 글, 기록을 보는 동안 요청·저장·주소가 그대로인지, 문서에 있는 글이 눈에도 그려지는지, CSS 가 글을 그려 넣지 않는지.
//
// 기대값의 팩 값(해시, 시행일)은 data/pack-meta.json 을 직접 읽어 얻는다(tests/helpers.ts 의 readPackFile).

let site: Site;
let browser: Browser;
const contexts: BrowserContext[] = [];
/** 쪽에서 난 오류(잡히지 않은 예외, 콘솔의 오류 줄). 시험마다 비어 있어야 한다. */
const problems: string[] = [];

beforeAll(async () => {
  site = await serveOut();
  try {
    browser = await launchChrome();
  } catch (error) {
    await site.close();
    throw error;
  }
});

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
  expect(problems.splice(0)).toEqual([]);
});

// 시험이 실패해도 띄운 것은 닫는다. 이 시험은 파일을 만들지 않는다(고친 결과는 메모리에서 바로 넣는다).
afterAll(async () => {
  await closeChrome(browser);
  await site?.close();
});

const packFile = readPackFile();
const file = (...parts: string[]) => path.join(root, ...parts);
const open = (pathname: string, options: Pick<OpenOptions, "viewport" | "colorScheme"> = {}) =>
  openPage(browser, site, pathname, { ...options, contexts, problems });

const CAPTURES = jsonFiles("contract", "cli-current").map((name) => ["contract", "cli-current", name]);
const SARIFS = sarifFiles("contract", "cli-current").map((name) => ["contract", "cli-current", name]);
const DRAFTS = jsonFiles("contract", "samples-v1-draft").map((name) => ["contract", "samples-v1-draft", name]);
const FIXTURES = jsonFiles("tests", "fixtures").map((name) => ["tests", "fixtures", name]);

/** 기본으로 열려 있는 합성 예시. 수집본 kids-signup.main 이다. */
const DEFAULT = SAMPLES[0];
const DEFAULT_TITLE = `${DEFAULT.label} (${DEFAULT.origin})`;
const SIGNUP = "contract/fixtures/kids-signup/main/src/auth/signup.ts";

/** 합성 코드의 줄(빈 줄은 뺀다. 앞뒤의 빈칸은 뗀다). */
const codeLines = (relative: string) =>
  readFileSync(file(...relative.split("/")), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** `/view` 에서 그 이름의 것이 열려 다 그려질 때까지 기다린다. */
async function opened(page: Page, name: string): Promise<void> {
  await page.waitForFunction(
    (want) =>
      document.querySelector(".viewer-title")?.textContent === want &&
      document.querySelector(".opened")?.getAttribute("aria-busy") === "false",
    name,
  );
}

async function pick(page: Page, parts: string[]): Promise<void> {
  await page.locator("#report-file").setInputFiles(file(...parts));
  await opened(page, parts.at(-1)!);
}

async function pickContent(page: Page, name: string, data: unknown): Promise<void> {
  await page.locator("#report-file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data), "utf8") });
  await opened(page, name);
}

/**
 * 정책 하나에 규칙이 `count` 개이고 규칙마다 발견이 하나인 결과. v1 초안 예시의 발견 하나를 본으로 삼아 만든다(손으로 만든
 * 것이다. 규칙 id 는 팩에 없는 이름이다). 정책별 요약에 그 정책 하나만 있어서, 기록의 정책 표는 한 줄이고 발견 표는 묶음이
 * `count` 개다.
 */
function singleFindingGroups(count: number): unknown {
  const draft = readJson("contract", "samples-v1-draft", "kids-signup.main.json") as Report;
  const [template] = draft.findings;
  const summary = draft.run.policies!.find((entry) => entry.policy === template.policy)!;
  const number = (i: number) => String(i + 1).padStart(2, "0");
  return {
    ...draft,
    run: { ...draft.run, units: count, files: count, ai_pending: count, policies: [{ ...summary, units: count, needs_review: count }] },
    findings: Array.from({ length: count }, (_, i) => ({
      ...template,
      rule: `rule-${number(i)}`,
      file: `src/auth/step-${number(i)}.ts`,
      fingerprint: (i + 1).toString(16).padStart(32, "0"),
    })),
  };
}

const SWITCH = "결과와 검사 기록 고르기";
const switchButton = (page: Page, name: string) => page.getByRole("group", { name: SWITCH }).getByRole("button", { name, exact: true });
/** 눌려 있는 단추의 이름. */
const pressed = (page: Page) => page.locator('.report-switch > .segmented button[aria-pressed="true"]').allInnerTexts();

/** 단추로 기록을 고른다. 기록이 그려지거나, 만들지 않은 까닭이 보일 때까지 기다린다. */
async function showRecord(page: Page): Promise<void> {
  await switchButton(page, SITE.record.title).click();
  await page.waitForSelector(".record, .record-refused");
}

async function showResult(page: Page): Promise<void> {
  await switchButton(page, "결과").click();
  await page.waitForSelector(".record, .record-refused", { state: "detached" });
}

/** 화면에 그려진 기록의 글(가린 것은 빠진다). */
const recordText = (page: Page) => page.locator(".record").innerText();

/**
 * A4 로 인쇄해 쪽수를 센다. 헤드리스 Chrome 이 인쇄 창 없이 PDF 를 만든다. 여백은 Chrome 의 기본값(사방 1cm)과 같게 준다.
 * 시험 도구는 따로 주지 않으면 여백을 0으로 잡는데, 그러면 사람이 인쇄할 때보다 한 쪽에 더 많이 들어간다.
 */
async function printedPages(page: Page): Promise<number> {
  const pdf = (await page.pdf({ format: "A4", margin: { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" } })).toString("latin1");
  // 종이는 A4(595×842pt)다.
  const boxes = [...new Set(pdf.match(/\/MediaBox\s*\[[^\]]*\]/g))];
  expect(boxes).toHaveLength(1);
  expect(boxes[0]).toMatch(/\[\s*0\s+0\s+59[56](\.\d+)?\s+84[123](\.\d+)?\s*\]/);
  const pages = (pdf.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  // 쪽 묶음에 적힌 수와 같다(쪽을 잘못 센 것이 아니다).
  expect(pdf).toContain(`/Count ${pages}`);
  return pages;
}

/** 인쇄할 때의 화면을 흉내 낸다(@media print 가 듣는다). */
const asPrint = (page: Page) => page.emulateMedia({ media: "print" });
/** 흉내를 거둔다. "screen" 으로 맞추지 않는다. 그렇게 하면 그 뒤에 만드는 PDF 도 화면의 꾸밈으로 인쇄된다. */
const asScreen = (page: Page) => page.emulateMedia({ media: null });

interface PrintLayout {
  /** 쪽의 너비(`clientWidth`). 종이의 본문 너비다. */
  client: number;
  record: { left: number; right: number };
  boxes: { left: number; right: number }[];
}

/**
 * 인쇄 배치에서의 자리. PDF 를 만드는 동안(브라우저가 쪽을 종이 너비로 다시 짰을 때) 쪽 안에서 잰다. 인쇄를 흉내 낸
 * 화면(`asPrint`)은 창 너비 그대로라서 종이의 오른쪽 끝이 어디인지 알 수 없다. 흉내를 거둔 채로 부른다.
 */
async function printLayout(page: Page, selectors: string[]): Promise<PrintLayout> {
  await page.evaluate((list) => {
    const seen = window as unknown as { __layout?: PrintLayout };
    seen.__layout = undefined;
    const media = matchMedia("print");
    const measure = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      media.removeEventListener("change", measure);
      const box = (el: Element) => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      };
      seen.__layout = {
        client: document.documentElement.clientWidth,
        record: box(document.querySelector(".record")!),
        boxes: list.flatMap((selector) => [...document.querySelectorAll(selector)].map(box)),
      };
    };
    media.addEventListener("change", measure);
  }, selectors);
  await printedPages(page);
  const layout = await page.evaluate(() => (window as unknown as { __layout?: PrintLayout }).__layout);
  if (!layout) throw new Error("인쇄 배치를 재지 못했습니다(PDF 를 만드는 동안 인쇄 매체로 바뀌지 않았습니다).");
  return layout;
}

/** 지금 그려지는 글 전부(인쇄를 흉내 낸 뒤에 부르면 인쇄될 글이다). */
const drawnText = (page: Page) => page.evaluate(() => document.body.innerText);

/** 그 요소들이 그려지는지(자리를 차지하는지). */
const drawn = (page: Page, selectors: string[]) =>
  page.evaluate(
    (list) =>
      list.map((selector) => {
        const all = [...document.querySelectorAll(selector)];
        return all.length > 0 && all.some((el) => el.getClientRects().length > 0);
      }),
    selectors,
  );

/**
 * 기록의 글 가운데 그려지지 않는 것. 없어야 한다(tests/browser/site.ts 의 `undrawn`. 조문 도감·결과 화면·데모의 시험과 같은
 * 기준이다). 기록의 HTML 에 글이 있어도 CSS 가 가리면 읽히지 않는다. 맨 위의 말(법률 자문·인증이 아니다)을 흐리게 하거나
 * 1px 로 잘라도 글은 문서에 그대로 있어서, 글을 읽는 시험은 통과한다. 인쇄할 때의 글자는 화면보다 작다(9pt). 일부러 화면에서만
 * 가린 것(`veiled`. 화면 낭독기용 칸 머리)은 뺀다.
 */
const undrawn = (page: Page, veiled: string, minFont: number) => undrawnIn(page, { root: ".record", veiled, minFont });

/** 일부러 화면에서만 가린 것: "다 보지 못한 것" 표의 칸 머리, 그리고 줄을 쌓았을 때(좁은 화면)의 다른 표의 칸 머리. */
const VEILED = { stacked: ".visually-hidden, .record-table thead", wide: ".visually-hidden" };

/**
 * 기록과 그 위의 단추 줄에서 CSS 가 그린 글(tests/browser/site.ts 의 `cssDrawn`). HTML 에 없는 글도 CSS 는 그린다
 * (`::before`·`::after`·`::marker` 의 content, 글로 적은 목록 표시). 그런 글은 기록의 글을 읽는 시험에도, 글 조각을 걷는
 * `undrawn` 에도 보이지 않는다. 두 가지로 본다.
 * - `drawn`: 단추 줄과 기록(결과 화면은 뺀다)의 요소마다 실제로 계산된 값. 요소 이름(태그)과 자리, 그린 글로 적는다.
 * - `rules`: 꾸밈의 규칙 가운데 기록의 class(`record`)를 가리키면서 글을 그리는 것. 규칙 자체를 읽으므로 화면 너비, 테마,
 *   인쇄, 마우스를 올렸는지와 상관없다.
 * 기록이 CSS 로 그리는 글은 하나뿐이어야 한다: 줄을 쌓았을 때 칸 앞에 적는 칸의 이름(`attr(data-label)`). 그 이름에는 빈
 * 대체 글이 붙어 있어야 한다(`/ ""`). 눈에만 보이는 이름이다. 화면 낭독기에는 가려 둔 칸 머리가 그대로 있어서, 대체 글이
 * 없으면 칸마다 이름이 두 번 읽힌다(아래 `drawnLabel`).
 */
const cssDrawn = async (page: Page) => {
  const read = await cssDrawnIn(page, { within: ".report-switch", except: ".report", selectorHas: "record", markers: ["disc", "none"] });
  // "td.record-x::before content: …" 를 "td::before …" 로 줄여 적는다(칸의 class 는 칸마다 다르다).
  const short = read.drawn.map((entry) => entry.replace(/^([a-z0-9]+)\.\S*?(::[a-z-]+) content: /, "$1$2 "));
  return { rules: read.rules, drawn: [...new Set(short)].sort() };
};

/**
 * 쌓은 표의 칸 앞에 CSS 가 그린 이름을 브라우저가 계산한 값. 글 뒤에 빈 대체 글이 붙어 있다. 대체 글이 없으면 Chrome 의
 * 접근성 트리에서 칸의 이름이 "시행일 2026-…"처럼 칸 머리의 이름으로 시작한다(칸 머리와 함께 두 번 읽힌다).
 */
const drawnLabel = (label: string) => `"${label}" / ""`;

/** 정책 표의 칸 머리. */
const POLICY_COLUMNS = ["정책", "대표 조문", "시행일", "원문 해시", "발견"];

/** 결과 화면에서 기록 밖에 있는 것들. 인쇄할 때 나오면 안 된다. */
const VIEW_CHROME = [".site-header", ".site-footer", "main > h1", ".lede", ".dropzone", ".samples", ".viewer-title", ".viewer-note", ".report-switch > .segmented", ".record-tools"];
const DEMO_CHROME = [".site-header", ".site-footer", "main > h1", ".lede", ".demo-pick", ".demo-title", ".demo-note", ".codeblock", ".demo-compare", ".report-switch > .segmented", ".record-tools"];

describe("결과가 열려 있는 자리에서 바로 기록을 본다", () => {
  // ROADMAP 7번의 완료 조건이다.
  it("kids-signup.main 으로 만든 기록에 코드 조각이 없다. 인쇄 미리보기에서 A4 두 쪽 이하다", async () => {
    const { page } = await open("/view/");
    // 처음에 열려 있는 합성 예시가 그 표본이다.
    expect(DEFAULT.id).toBe("kids-signup.main");
    expect(await page.locator(".viewer-title").innerText()).toBe(DEFAULT_TITLE);
    expect(await pressed(page)).toEqual(["결과"]);
    expect(await page.locator(".record").count()).toBe(0);

    await showRecord(page);
    expect(await pressed(page)).toEqual([SITE.record.title]);
    // 기록이 보이고 결과 화면은 가려진다.
    expect(await page.locator(".record").isVisible()).toBe(true);
    expect(await page.locator(".report").isVisible()).toBe(false);
    // 고르는 단추, 인쇄 단추, 기록이 위에서부터 차례로 놓이고 서로 붙어 있지 않다.
    const gaps = await page.locator(".report-switch").evaluate((box) => {
      const shown = [...box.children].filter((el) => el.getClientRects().length > 0);
      const rects = shown.map((el) => el.getBoundingClientRect());
      return { order: shown.map((el) => el.className), between: rects.slice(1).map((rect, i) => Math.round(rect.top - rects[i].bottom)) };
    });
    expect(gaps.order).toEqual(["segmented", "record-tools", "record"]);
    for (const gap of gaps.between) expect(gap).toBeGreaterThanOrEqual(8);
    const text = await recordText(page);
    expect(text).toContain("조문별 검사 기록");
    expect(text).toContain(`합성 예시입니다. ${DEFAULT_TITLE}`);

    // 그 표본의 합성 코드의 줄이 기록에 없다. 결과 화면에도 코드는 없지만, 같은 쪽의 다른 표본(데모)에는 있다.
    const lines = codeLines(SIGNUP);
    expect(lines).toHaveLength(8);
    for (const line of lines) expect(text, line).not.toContain(line);
    for (const name of ["calcKoreanAge", "signUp", "birthDate"]) expect(text, name).not.toContain(name);
    // 자리와 지문은 있다.
    const data = readJson("contract", "cli-current", "kids-signup.main.json") as Report;
    expect(text).toContain("src/auth/signup.ts:5");
    expect(text).toContain(data.findings[0].fingerprint);

    // 인쇄: A4 두 쪽 이하. 이 컴퓨터의 글꼴로는 한 쪽이다(docs/architecture.md).
    expect(await printedPages(page)).toBeLessThanOrEqual(2);

    // 파일로 열어도, SARIF 로 열어도 같다.
    for (const name of ["kids-signup.main.json", "kids-signup.main.sarif"]) {
      await pick(page, ["contract", "cli-current", name]);
      // 다른 것을 열면 결과 화면으로 돌아간다.
      expect(await pressed(page), name).toEqual(["결과"]);
      await showRecord(page);
      const again = await recordText(page);
      expect(again, name).toContain(`연 파일(${name})에 적힌 것을 옮긴 기록입니다.`);
      for (const line of lines) expect(again, `${name}: ${line}`).not.toContain(line);
      expect(again, name).toContain(data.findings[0].fingerprint);
      expect(await printedPages(page), name).toBeLessThanOrEqual(2);
    }

    // 그 결과에는 코드가 한 줄도 없다(판정자 없이 검사했다). 그것만 보면 기록이 판정 경로나 인용한 줄을 옮겨 그려도 위의
    // 확인은 통과한다. 같은 결과에서 코드가 실릴 수 있는 자리마다 그 표본의 코드 줄을 넣은 것(손으로 만든 것이다.
    // tests/record-data.ts)을 열어 다시 본다. 결과 화면에는 그 줄들이 보이고, 기록에는 화면에도 인쇄될 글에도 없다.
    await pickContent(page, "kids-signup.main.with-code.json", withCodeEverywhere(data, lines));
    const result = await page.locator(".report").innerText();
    for (const line of lines.filter((entry) => entry.length > 3)) expect(result, line).toContain(line);
    await showRecord(page);
    const stuffed = await recordText(page);
    await asPrint(page);
    const printed = await drawnText(page);
    await asScreen(page);
    for (const text of [stuffed, printed]) {
      for (const line of lines) expect(text, line).not.toContain(line);
      for (const name of ["calcKoreanAge", "signUp", "birthDate", "Fatal error", "인용 불인정"]) expect(text, name).not.toContain(name);
      expect(text).toContain("src/auth/signup.ts:5");
      expect(text).toContain(data.findings[0].fingerprint);
    }
    // 숨기지는 않는다. AI 가 푼 경고와 빠진 판정, 엔진 오류는 수와 자리로 실린다.
    expect(await page.locator(".record h4").allTextContents()).toEqual(expect.arrayContaining(["AI 가 푼 경고 1건", `AI 가 적용되지 않는다고 답해 빠진 판정 ${lines.length}건`]));
  });

  it("기록에 대표 조문의 시행일과 원문 해시가 data/pack-meta.json 의 값 그대로 보인다", async () => {
    const { page } = await open("/view/");
    await showRecord(page);
    const rows = await page.locator(".record-table").first().locator("tbody tr").evaluateAll((all) =>
      all.map((tr) => ({
        id: tr.querySelector("th .record-id")!.textContent,
        cells: [...tr.querySelectorAll("td")].map((td) => td.textContent),
      })),
    );
    expect(rows).toHaveLength(packFile.policies.length);
    for (const row of rows) {
      const primary = packFile.policies.find((policy) => policy.id === row.id)!.legal[0];
      expect(row.cells.slice(0, 3), row.id!).toEqual([primary.label, primary.effective_from, primary.text_sha256]);
    }
    // 표 아래에 그 값이 어느 팩의 것인지 적혀 있다. CLI 0.3 의 결과에는 정책 목록이 없다. 표의 줄부터 팩에서 온 것이라고 적는다.
    expect(squash(await recordText(page))).toContain(
      `정책 목록과 대표 조문, 시행일, 원문 해시(SHA-256)는 이 결과와 판이 같은 팩(팩 판 ${packFile.pack.digest})에 적힌 값입니다. 결과에는 정책 목록이 없습니다.`,
    );
    // 대표 조문이 정책의 첫 근거 조문이라는 것과, 근거 조문이 더 있는 정책의 수가 그 아래에 적혀 있다(9번). 수는 그 파일의
    // 조문 수로 센다. 어느 조문인지는 조문 도감이 말한다.
    const more = packFile.policies.filter((policy) => policy.legal.length > 1).length;
    expect(more).toBeGreaterThan(0);
    expect(await page.locator(".record-notes li").allTextContents()).toContain(primaryLawNote(more));
    // 발견이 0인 결과(파일에 정책 id 가 하나도 없다)를 열어도 표에는 팩의 정책이 모두 있고, 같은 말이 적혀 있다.
    await pick(page, ["contract", "cli-current", "kids-signup.fixed.json"]);
    await showRecord(page);
    expect(await page.locator(".record-table").first().locator("tbody tr th .record-id").allTextContents()).toEqual(packFile.policies.map((policy) => policy.id));
    expect(squash(await recordText(page))).toContain("에 적힌 값입니다. 결과에는 정책 목록이 없습니다.");
    // v1 초안은 정책이 결과의 요약에 실려 있다. 그 말을 적지 않는다.
    await pick(page, ["contract", "samples-v1-draft", "kids-signup.fixed.json"]);
    await showRecord(page);
    const draft = squash(await recordText(page));
    expect(draft).toContain(`정책의 제목과 대표 조문, 시행일, 원문 해시(SHA-256)는 이 결과와 판이 같은 팩(팩 판 ${packFile.pack.digest})에 적힌 값입니다.`);
    expect(draft).not.toContain("정책 목록");
  });

  it("결과로 돌아오면 펼치고 접어 둔 발견 줄이 그대로다. 다른 예시를 고르면 결과 화면으로 돌아간다", async () => {
    const { page } = await open("/view/");
    await pick(page, ["tests", "fixtures", "repeated-rule.json"]);
    const openRows = () => page.locator("li.finding > details").evaluateAll((all) => all.map((el) => (el as HTMLDetailsElement).open));
    // 접힌 곳을 펼치고, 첫 발견 줄을 접어 둔다.
    await page.locator("details.more > summary").first().click();
    await page.locator("li.finding > details > summary").first().click();
    const before = await openRows();
    expect(before.length).toBe(25);
    expect(before[0]).toBe(false);
    expect(await page.locator("details.more").first().evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);

    await showRecord(page);
    // 기록에는 접어 둔 것 없이 25건이 모두 있다.
    expect(await page.locator(".record details").count()).toBe(0);
    expect(await page.locator(".record-findings tbody tr:not(.record-group)").count()).toBe(25);
    await showResult(page);
    expect(await page.locator(".report").isVisible()).toBe(true);
    expect(await openRows()).toEqual(before);
    expect(await page.locator("details.more").first().evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);

    await showRecord(page);
    await page.locator("#sample-select").selectOption("plain.main");
    await opened(page, "정책 신호가 없는 코드 (CLI 실제 출력)");
    expect(await pressed(page)).toEqual(["결과"]);
    expect(await page.locator(".record").count()).toBe(0);

    // 다른 쪽에 다녀와도 결과 화면이다. 연 것은 그대로 남고(메모리에 둔다), 기록을 고른 것은 남지 않는다.
    await showRecord(page);
    await page.locator(".site-header").getByRole("link", { name: "조문 도감", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/policy/");
    await page.goBack();
    await page.waitForURL((url) => url.pathname === "/view/");
    await opened(page, "정책 신호가 없는 코드 (CLI 실제 출력)");
    expect(await pressed(page)).toEqual(["결과"]);
    expect(await page.locator(".record").count()).toBe(0);
    expect(await page.locator(".report").isVisible()).toBe(true);
  });

  it("키보드만으로 기록을 고르고 돌아온다. 초점은 누른 단추에 남는다", async () => {
    const { page } = await open("/view/");
    const focused = () => page.evaluate(() => (document.activeElement?.closest(".report-switch > .segmented") ? document.activeElement!.textContent : null));
    // 예시 고르기 다음이 결과와 기록을 고르는 단추다.
    await page.locator("#sample-select").focus();
    await page.keyboard.press("Tab");
    expect(await focused()).toBe("결과");
    await page.keyboard.press("Tab");
    expect(await focused()).toBe(SITE.record.title);
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe("solid");
    await page.keyboard.press("Enter");
    await page.waitForSelector(".record");
    expect(await focused()).toBe(SITE.record.title);
    // 다음은 인쇄 단추다. 기록 안에는 초점을 받는 것이 없다(링크도 단추도 없다).
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest(".record-tools") !== null && document.activeElement!.textContent)).toBe("인쇄");
    expect(await page.locator(".record a, .record button, .record summary, .record [tabindex]").count()).toBe(0);
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    expect(await focused()).toBe("결과");
    await page.keyboard.press("Space");
    await page.waitForSelector(".record", { state: "detached" });
    expect(await focused()).toBe("결과");
    expect(await pressed(page)).toEqual(["결과"]);
  });
});

describe("인쇄하면 기록만 나온다", () => {
  it("기록을 고른 채 인쇄하면 기록의 글만 그려진다. 머리·바닥글, 고르는 단추, 인쇄 단추는 나오지 않는다", async () => {
    const { page } = await open("/view/");
    await showRecord(page);
    const onScreen = await recordText(page);
    // 화면에서는 모두 보인다.
    expect(await drawn(page, VIEW_CHROME)).toEqual(VIEW_CHROME.map(() => true));

    await asPrint(page);
    expect(await page.evaluate(() => matchMedia("print").matches)).toBe(true);
    expect(await drawn(page, VIEW_CHROME)).toEqual(VIEW_CHROME.map(() => false));
    expect(await drawn(page, [".record"])).toEqual([true]);
    // 인쇄될 글 전체가 기록의 글이다. 화면에서 본 기록과 글자가 같다.
    expect(squash(await drawnText(page))).toBe(squash(await recordText(page)));
    expect(squash(await recordText(page))).toBe(squash(onScreen));
    // 기록은 종이의 왼쪽 위에서 시작하고 종이 너비를 다 쓴다(쪽의 여백과 테두리를 걷어 냈다).
    const box = await page.locator(".record").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return { left: rect.left, top: rect.top + window.scrollY, width: rect.width, page: document.documentElement.clientWidth, border: style.borderTopWidth, padding: style.paddingLeft };
    });
    expect(box).toMatchObject({ left: 0, top: 0, border: "0px", padding: "0px" });
    expect(box.width).toBe(box.page);

    // 화면으로 돌아오면 그대로다.
    await asScreen(page);
    expect(await drawn(page, VIEW_CHROME)).toEqual(VIEW_CHROME.map(() => true));
  });

  it("대조: 기록을 고르지 않은 채 인쇄하면 기록만 찍는 규칙이 듣지 않는다 (화면에서 고르는 데만 쓰는 것만 빠진다)", async () => {
    const { page } = await open("/view/");
    // 기록이 없으면 기록만 찍는 규칙이 듣지 않는다. 화면에서 고르는 데만 쓰는 것(파일 고르기, 예시 고르기, 결과와 기록을
    // 오가는 단추)만 찍지 않는다(9번. 인쇄할 때 밝은 색으로 찍는 것과 함께 tests/browser/colors.test.ts 가 본다). 인쇄 단추는
    // 기록을 고르기 전에는 없다.
    const controls = [".dropzone", ".samples", ".report-switch > .segmented"];
    const kept = VIEW_CHROME.filter((selector) => selector !== ".record-tools" && !controls.includes(selector));
    expect(kept.length).toBeGreaterThan(4);
    expect(await drawn(page, controls)).toEqual(controls.map(() => true));
    await asPrint(page);
    expect(await drawn(page, kept)).toEqual(kept.map(() => true));
    expect(await drawn(page, controls)).toEqual(controls.map(() => false));
    expect(await drawn(page, [".report"])).toEqual([true]);
    expect(await drawnText(page)).toContain(SITE.disclaimer);
    await asScreen(page);
    // 결과 화면을 통째로 인쇄하면 기록보다 길다. 기록만 인쇄된다는 것은 쪽수로도 드러난다.
    const whole = await printedPages(page);
    await showRecord(page);
    expect(await printedPages(page)).toBeLessThan(whole);

    // 조문 도감도 그대로다.
    const policy = await open("/policy/");
    await asPrint(policy.page);
    expect(await drawn(policy.page, [".site-header", ".site-footer", "main > h1", ".policy-index"])).toEqual([true, true, true, true]);
  });

  it.each(["light", "dark"] as const)("%s 테마에서 인쇄해도 흰 바탕에 검은 글이다", async (colorScheme) => {
    const { page } = await open("/view/", { colorScheme });
    await pick(page, ["tests", "fixtures", "incomplete-coverage.json"]);
    await showRecord(page);
    const colors = () =>
      page.evaluate(() => {
        const record = document.querySelector(".record")!;
        const texts = new Set<string>();
        const backgrounds = new Set<string>();
        const borders = new Set<string>();
        const walker = document.createTreeWalker(record, NodeFilter.SHOW_TEXT);
        // 글이 든 요소의 글자색.
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if ((node.textContent ?? "").trim() !== "" && node.parentElement!.getClientRects().length > 0) texts.add(getComputedStyle(node.parentElement!).color);
        }
        for (const el of [document.documentElement, document.body, record, ...record.querySelectorAll("*")]) {
          const style = getComputedStyle(el);
          backgrounds.add(style.backgroundColor);
          if (parseFloat(style.borderTopWidth) > 0) borders.add(style.borderTopColor);
        }
        return { texts: [...texts], backgrounds: [...backgrounds], borders: [...borders] };
      });
    // 화면에서는 테마를 따른다. 어두운 테마면 글이 밝다.
    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(colorScheme === "dark");
    const screen = await colors();
    const inkOnScreen = await page.locator(".record h3").evaluate((el) => getComputedStyle(el).color);
    expect(contrast(inkOnScreen, "rgb(255, 255, 255)") > 7).toBe(colorScheme === "light");
    // 경고(다 보지 못한 검사)는 화면에서 경고 색이다.
    expect(screen.texts.length).toBeGreaterThan(2);

    await asPrint(page);
    // 테마 설정은 그대로다. 인쇄라서 색이 달라진 것이지, 밝은 테마로 바뀌어서가 아니다.
    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(colorScheme === "dark");
    const print = await colors();
    const WHITE = "rgb(255, 255, 255)";
    // 글은 검정이거나 짙은 회색이다(흰 바탕과의 명도 대비 12:1 이상). 경고의 글도 색에 기대지 않는다.
    expect(print.texts.length).toBeGreaterThan(0);
    for (const color of print.texts) expect(contrast(color, WHITE), color).toBeGreaterThanOrEqual(12);
    expect(print.texts).toContain("rgb(0, 0, 0)");
    // 바탕은 희거나 비친다. 칠한 곳이 없다.
    for (const color of print.backgrounds) expect([WHITE, "rgba(0, 0, 0, 0)"], color).toContain(color);
    expect(await page.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor])).toEqual([WHITE, WHITE]);
    // 선도 흰 바탕에서 보인다.
    for (const color of print.borders) expect(contrast(color, WHITE), color).toBeGreaterThanOrEqual(3);

    // 맨 위의 두 상자(법률 자문·인증이 아니라는 말, 다 보지 못한 검사라는 경고)는 테두리로만 본문과 구분된다. 그 테두리가
    // 네 변 모두 종이 안에 있어야 한다. Chrome 은 인쇄할 때 쪽을 종이의 본문보다 1px 넓게 짜고, 그 1px 은 찍히지 않는다.
    // 너비를 다 쓰는 상자는 오른쪽 테두리가 거기에 놓여 상자의 오른쪽이 열린 채 찍혔다(PDF 를 그림으로 바꿔 봤다). 실제 인쇄
    // 배치에서 잰다.
    await asScreen(page);
    const laidOut = await printLayout(page, [".record-notice", ".record-warning"]);
    // 종이(A4, 여백 1cm)의 본문 너비로 짠 배치다. 창의 너비(1280px)가 아니다.
    expect(laidOut.client).toBeGreaterThan(600);
    expect(laidOut.client).toBeLessThan(800);
    expect(laidOut.boxes).toHaveLength(2);
    for (const box of laidOut.boxes) {
      expect(box.left).toBe(0);
      expect(box.right).toBeLessThanOrEqual(laidOut.client);
      // 비운 것은 1px 뿐이다. 상자가 눈에 띄게 좁아지지 않는다.
      expect(laidOut.record.right - box.right).toBeLessThanOrEqual(1);
    }
  });

  it("표의 줄과 상자는 두 쪽에 걸쳐 잘리지 않는다. 발견이 많은 결과도 쪽을 넘겨 가며 모두 인쇄된다", async () => {
    const { page } = await open("/view/");
    await pick(page, ["tests", "fixtures", "repeated-rule.json"]);
    await showRecord(page);
    await asPrint(page);
    const breaks = await page.evaluate(() => {
      const of = (selector: string, property: "breakInside" | "breakAfter" | "breakBefore") => [
        ...new Set([...document.querySelectorAll(selector)].map((el) => getComputedStyle(el)[property])),
      ];
      return {
        // 줄 하나, 상자 하나가 쪽 사이에서 잘리지 않는다.
        rows: of(".record tr", "breakInside"),
        notice: of(".record-notice", "breakInside"),
        notes: of(".record-notes", "breakInside"),
        // 구역의 이름, 칸 머리, 묶음의 첫 줄(정책과 규칙)이 쪽의 맨 아래에 홀로 남지 않는다. 표가 든 구역의 이름도 제목(h4)이다.
        headings: of(".record h4", "breakAfter"),
        headingCount: document.querySelectorAll(".record h4").length,
        captionCount: document.querySelectorAll(".record caption").length,
        heads: of(".record thead:not(.visually-hidden)", "breakAfter"),
        groups: of(".record tr.record-group", "breakAfter"),
        // 표 위에 적는 말은 잘리지 않고, 구역의 이름과 표 사이에서 어느 쪽과도 떨어지지 않는다.
        about: [of(".record-about", "breakInside"), of(".record-about", "breakBefore"), of(".record-about", "breakAfter")],
        aboutBetween: [...document.querySelectorAll(".record-about")].map((el) => [el.previousElementSibling?.tagName, el.nextElementSibling?.tagName]),
        // 표의 첫 줄은 칸 머리와 떨어지지 않는다. 칸 머리 바로 다음 묶음의 첫 줄만이다.
        first: of(".record thead + tbody > tr:first-child", "breakBefore"),
        // 발견 표의 둘째 묶음부터는 묶음 앞에서 쪽이 넘어갈 수 있다. 여기까지 앞의 것에 붙이면 묶음 머리가 제 발견과도 붙어
        // 있어서, 표 전체가 끊을 자리 없는 한 덩어리가 된다(아래 "한 쪽을 넘는 발견 표는 …"이 쪽수로 본다).
        laterGroups: of(".record tbody ~ tbody > tr:first-child", "breakBefore"),
        laterGroupCount: document.querySelectorAll(".record tbody ~ tbody > tr:first-child").length,
        // 기록은 마지막 구역으로 끝난다. 표 뒤에 따로 선 글이 없다(표가 한 쪽을 넘으면 그 글만 마지막 쪽에 남을 수 있다).
        last: document.querySelector(".record > :last-child")!.className,
        loose: [...document.querySelectorAll(".record > :not(.record-head, .record-section)")].map((el) => el.className),
        // 기록을 품은 것들은 격자가 아니다(격자 안의 것은 브라우저에 따라 쪽을 넘기지 못한다).
        around: [...document.querySelectorAll("main, .viewer, .opened, .report-switch")].map((el) => getComputedStyle(el).display),
      };
    });
    expect(breaks).toEqual({
      rows: ["avoid"],
      notice: ["avoid"],
      notes: ["avoid"],
      headings: ["avoid"],
      headingCount: 5,
      captionCount: 0,
      heads: ["avoid"],
      groups: ["avoid"],
      about: [["avoid"], ["avoid"], ["avoid"]],
      aboutBetween: [["H4", "TABLE"]],
      first: ["avoid"],
      laterGroups: ["auto"],
      laterGroupCount: 4,
      last: "record-section",
      loose: [],
      around: ["block", "block", "block", "block"],
    });
    await asScreen(page);
    // 발견 25건: 이 컴퓨터의 글꼴로 두 쪽이다. 쪽이 늘어도 세 쪽을 넘지 않는다(줄마다 한두 줄이다).
    const pages = await printedPages(page);
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(pages).toBeLessThanOrEqual(3);
  });

  it("한 쪽을 넘는 발견 표는 앞 쪽의 남은 자리부터 채운다 (묶음 사이에서 쪽이 넘어간다)", async () => {
    const { page } = await open("/view/");
    // 묶음 스물다섯, 묶음마다 발견 하나. 발견 표(묶음 머리 스물다섯과 발견 스물다섯)는 한 쪽에 다 들어가지 않는다. 묶음
    // 사이에서 쪽을 넘기지 못하면 표가 통째로 둘째 쪽으로 밀려 셋째 쪽까지 간다. 이 컴퓨터의 글꼴로 재어 보니, 묶음마다 첫
    // 줄을 앞의 것에 붙이는 CSS 로는 묶음 21개부터 세 쪽이고 지금의 CSS 로는 29개까지 두 쪽이다. 스물다섯은 그 가운데다.
    // 인쇄할 때의 간격을 좁힐 때마다 다시 쟀다(9번 전 17개와 23개, 9번에서 19개와 26개. 그때는 묶음 스물로 봤다. 9번의 첫
    // 검토 뒤 표의 줄 안쪽 여백을 좁히자 스물은 붙이는 CSS 로도 두 쪽이 되어 이 시험이 그 꾸밈을 가려내지 못했다).
    await pickContent(page, "single-finding-groups.json", singleFindingGroups(25));
    await showRecord(page);
    expect(await page.locator(".record-table").first().locator("tbody tr").count()).toBe(1);
    expect(await page.locator(".record-findings tbody").count()).toBe(25);
    expect(await page.locator(".record-findings tbody tr").count()).toBe(50);
    expect(await printedPages(page)).toBe(2);
  });

  it("발견이 두 건인 기록(광고 푸시·생성형 AI 채팅의 고치기 전)은 A4 한 쪽이고, 맨 끝에 두 줄이 더 들어갈 자리가 남는다", async () => {
    // 7번의 첫 검토 뒤에 발견 표 위에 한 줄이 더해져, 이 둘은 아래에 4.5px 만 남는 빠듯한 한 쪽이었다. 한 줄만 더 적혀도 두
    // 쪽이 된다. 9번에서 인쇄할 때의 줄 간격과 구역 사이, 표의 줄 안쪽 여백을 좁혀, 정책 표 아래에 대표 조문의 뜻 한 줄을
    // 더한 뒤에도 50px 쯤(9pt 로 세 줄쯤) 남게 했다. 9번의 첫 검토 뒤 표의 줄 안쪽 여백을 더 좁혀 70px 쯤 남는다. 이 컴퓨터의
    // 글꼴로 잰 것이다(docs/architecture.md 의 "조문별 검사 기록"의 "인쇄"). 9번 전의 인쇄 꾸밈으로는 그 한 줄만 더해도 두
    // 쪽이다(사본에서 꾸밈만 되돌려 봤다).
    const { page } = await open("/view/");
    for (const id of ["night-push.main", "genai-chat.main"]) {
      const sample = SAMPLES.find((entry) => entry.id === id)!;
      await page.locator("#sample-select").selectOption(id);
      await opened(page, `${sample.label} (${sample.origin})`);
      await showRecord(page);
      expect(await page.locator(".record-findings tbody tr:not(.record-group)").count(), id).toBe(2);
      expect(await printedPages(page), id).toBe(1);
      // 기록의 맨 끝에 기록의 줄 간격으로 두 줄 높이(2lh)인 빈 상자를 넣는다. 구역 사이의 여백은 주지 않는다.
      await page.locator(".record").evaluate((record) => {
        const room = document.createElement("div");
        room.className = "room-probe";
        room.style.cssText = "height: 2lh; margin: 0; padding: 0; border: 0;";
        record.append(room);
      });
      expect(await page.locator(".room-probe").evaluate((el) => el.getBoundingClientRect().height), id).toBeGreaterThan(20);
      expect(await printedPages(page), `${id}: 두 줄을 더해도`).toBe(1);
      await page.locator(".room-probe").evaluate((el) => el.remove());
      await showResult(page);
    }
  });

  it("못 본 파일이 많은 목록은 앞 쪽의 남은 자리부터 채운다 (파일 사이에서 쪽이 넘어간다). 짧은 목록은 갈리지 않는다", async () => {
    const { page } = await open("/view/");
    // 발견이 0인 수집본에 못 본 파일의 목록만 넣는다(손으로 만든 것이다). 목록 하나가 "다 보지 못한 것" 표의 한 줄이다.
    const base = readJson("contract", "cli-current", "plain.main.json") as Report;
    const files = (list: string, count: number) => Array.from({ length: count }, (_, i) => `src/${list}/file-${String(i + 1).padStart(2, "0")}.ts`);
    const withLists = (skipped: number, unparsed: number) => ({
      ...base,
      run: { ...base.run, files: base.run.files! + unparsed, skipped: files("generated", skipped), unparsed: files("draft", unparsed), coverage_complete: false },
    });
    /** 표의 줄마다: 든 파일의 수와, 인쇄할 때 그 줄 안에서 쪽이 넘어가도 되는지. */
    const rows = () =>
      page.locator(".record-gaps tbody tr").evaluateAll((all) =>
        all.map((tr) => ({ files: tr.querySelectorAll(".record-files > li").length, inside: getComputedStyle(tr).breakInside })),
      );

    // 파일이 아홉 개부터인 줄만 그 안에서 쪽이 넘어간다. 여덟 개까지는 통째로 다닌다.
    await pickContent(page, "short-lists.json", withLists(9, 8));
    await showRecord(page);
    await asPrint(page);
    expect(await rows()).toEqual([
      { files: 9, inside: "auto" },
      { files: 8, inside: "avoid" },
      { files: 0, inside: "avoid" },
      { files: 0, inside: "avoid" },
    ]);
    // 넘어가는 자리는 파일과 파일 사이뿐이다. 파일 한 줄은 잘리지 않고, 줄의 뜻은 첫 파일과 떨어지지 않는다. 첫 파일은 둘째
    // 파일과, 마지막 파일은 그 앞의 파일과 붙어 다닌다(쪽의 끝이나 처음에 파일 한 줄만 남지 않는다).
    const inside = await page.evaluate(() => {
      const of = (selector: string, property: "breakInside" | "breakAfter" | "breakBefore") => [
        ...new Set([...document.querySelectorAll(selector)].map((el) => getComputedStyle(el)[property])),
      ];
      return {
        files: of(".record-files > li", "breakInside"),
        meaning: of(".record-gap-detail > p", "breakInside"),
        afterMeaning: of(".record-gap-detail > p", "breakAfter"),
        afterFirst: of(".record-files > li:first-child", "breakAfter"),
        beforeLast: of(".record-files > li:last-child", "breakBefore"),
        between: of(".record-files > li:not(:first-child, :last-child)", "breakAfter"),
      };
    });
    expect(inside).toEqual({ files: ["avoid"], meaning: ["avoid"], afterMeaning: ["avoid"], afterFirst: ["avoid"], beforeLast: ["avoid"], between: ["auto"] });
    await asScreen(page);

    // 검사하지 않은 파일 쉰다섯 개. 그 줄(이름과 뜻, 파일 쉰다섯 줄)은 첫 쪽의 남은 자리에 들어가지 않는다. 줄을 통째로 묶어
    // 두면 줄이 둘째 쪽으로 밀려 첫 쪽에는 머리와 검사 정보만 남고, 기록은 세 쪽이 된다. 파일 사이에서 쪽이 넘어가면 두
    // 쪽이다. 이 컴퓨터의 글꼴로 재어 보니 묶어 두는 CSS 로는 파일 44개부터 세 쪽이었고, 지금의 CSS 로는 74개까지 두
    // 쪽이다. 쉰다섯은 그 가운데다(인쇄할 때의 간격을 좁힐 때마다 다시 쟀다. 9번 전에는 42개와 68개, 9번에서는 44개와
    // 72개였다).
    await pickContent(page, "long-list.json", withLists(55, 0));
    await showRecord(page);
    await asPrint(page);
    expect(await rows()).toEqual([
      { files: 55, inside: "auto" },
      { files: 0, inside: "avoid" },
      { files: 0, inside: "avoid" },
      { files: 0, inside: "avoid" },
    ]);
    await asScreen(page);
    expect(await printedPages(page)).toBe(2);
  });

  it("인쇄 단추는 브라우저의 인쇄를 한 번 부른다. 기록을 만들지 않은 결과에는 단추가 없다", async () => {
    const { page } = await open("/view/");
    // 헤드리스 브라우저에는 인쇄 창이 없다. 부르는지만 본다.
    await page.evaluate(() => {
      const counter = window as unknown as { __printed: number };
      counter.__printed = 0;
      window.print = () => {
        counter.__printed += 1;
      };
    });
    const printed = () => page.evaluate(() => (window as unknown as { __printed: number }).__printed);
    await showRecord(page);
    const tools = page.locator(".record-tools");
    expect(await tools.innerText()).toContain("인쇄하면 이 기록만 나옵니다. 인쇄 창에서 PDF 로 저장할 수 있습니다.");
    expect(await tools.locator("button").allInnerTexts()).toEqual(["인쇄"]);
    await tools.locator("button").click();
    expect(await printed()).toBe(1);
    await tools.locator("button").focus();
    await page.keyboard.press("Enter");
    expect(await printed()).toBe(2);
  });
});

describe("기록을 만들지 않는 결과", () => {
  it("팩 판이 다른 결과: 기록 대신 까닭을 보인다. 해시와 시행일은 보이지 않고, 인쇄할 때도 쪽은 그대로다", async () => {
    const { page } = await open("/view/", { viewport: { width: 375, height: 667 } });
    const base = readJson("contract", "cli-current", "night-push.fixed.json") as Report;
    const OTHER = "0123456789abcdef";
    await pickContent(page, "other-pack.json", { ...base, run: { ...base.run, pack_digest: OTHER } });
    // 결과 화면은 다른 판의 팩이라고 알리며 그대로 보인다.
    expect(await page.locator(".report .notice-warn").first().innerText()).toContain("팩의 판이 다릅니다");

    await showRecord(page);
    expect(await page.locator(".record").count()).toBe(0);
    expect(await page.locator(".record-tools").count()).toBe(0);
    const refusal = page.locator(".record-refused");
    expect(await refusal.isVisible()).toBe(true);
    expect((await refusal.innerText()).split("\n").map((line) => line.trim()).filter(Boolean)).toEqual([
      RECORD_REFUSED,
      `이 결과를 만든 팩(팩 판 ${OTHER})과 이 사이트에 실린 팩(팩 판 ${packFile.pack.digest})의 판이 다릅니다. ` +
        "기록에 적는 시행일과 원문 해시는 이 사이트의 팩에 적힌 값이라, 이 결과를 만든 팩의 것이 아닙니다.",
    ]);
    // 기록의 값이 어디에도 보이지 않는다.
    const shown = await page.locator("main").innerText();
    for (const policy of packFile.policies) expect(shown, policy.id).not.toContain(policy.legal[0].text_sha256!);
    for (const finding of base.findings) expect(shown).not.toContain(finding.fingerprint);
    // 좁은 화면에서 넘치지 않는다.
    expect(await overflow(page)).toMatchObject({ page: 0, over: [] });

    // 기록이 없으므로 기록만 남기는 인쇄 규칙이 듣지 않는다. 까닭이 쪽과 함께 인쇄된다.
    await asPrint(page);
    expect(await drawn(page, [".site-header", ".viewer-title", ".record-refused"])).toEqual([true, true, true]);
    await asScreen(page);

    // 판이 같은 결과를 열면 기록이 만들어진다.
    await pick(page, ["contract", "cli-current", "night-push.fixed.json"]);
    await showRecord(page);
    expect(await page.locator(".record-refused").count()).toBe(0);
    expect(await page.locator(".record").isVisible()).toBe(true);
  });

  it("팩에 없는 정책이 든 결과도 만들지 않는다", async () => {
    const { page } = await open("/view/");
    const base = readJson("contract", "cli-current", "night-push.fixed.json") as Report;
    const data = { ...base, findings: base.findings.map((finding, i) => (i === 0 ? { ...finding, policy: "kr.example.99" } : finding)) };
    await pickContent(page, "unknown-policy.json", data);
    await showRecord(page);
    expect(await page.locator(".record").count()).toBe(0);
    expect(await page.locator(".record-refused").innerText()).toContain("결과에 이 사이트의 팩에 없는 정책이 있습니다: kr.example.99.");
  });
});

describe("기록을 보는 동안 밖으로 나가는 것이 없다", () => {
  it("기록을 고르고, 인쇄 단추를 누르고, 결과로 돌아와도 요청이 없다. 주소와 방문 기록, 브라우저 저장소도 그대로다", async () => {
    const start = site.requests.length;
    const { context, page, outside } = await open("/view/");
    const seen: string[] = [];
    context.on("request", (request) => seen.push(`${request.method()} ${request.url()}`));
    await settle(site, page);
    // 쪽을 열 때의 요청은 서버에 적힌다(머리 링크의 프리페치까지). 이 시험이 요청을 본다는 뜻이다.
    const loading = site.requests.slice(start).map((request) => request.url);
    expect(loading[0]).toBe("/view/");
    expect(loading.some((url) => url.startsWith("/policy/"))).toBe(true);
    await page.evaluate(() => {
      window.print = () => {};
    });
    const mark = { server: site.requests.length, browser: seen.length };
    const place = () => page.evaluate(() => ({ href: location.href, history: history.length }));
    const before = await place();
    expect(before.href).toBe(`${site.origin}/view/`);

    for (const parts of [
      ["contract", "cli-current", "night-push.fixed.json"],
      ["tests", "fixtures", "judge-on.cleared.json"],
      ["tests", "fixtures", "repeated-rule.json"],
    ]) {
      await pick(page, parts);
      await showRecord(page);
      // 기록을 맨 아래까지 내려 본다.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.locator(".record-tools button").click();
      await showResult(page);
    }
    await showRecord(page);
    await settle(site, page);

    expect(site.requests.slice(mark.server)).toEqual([]);
    expect(seen.slice(mark.browser)).toEqual([]);
    expect(outside).toEqual([]);
    // 기록은 주소에 싣지 않는다. 주소(쿼리, 해시)와 방문 기록의 길이가 그대로다.
    expect(await place()).toEqual(before);
    expect(await stored(page)).toEqual(NO_STORAGE);
    // 기록에는 눌러서 나갈 곳도 없다.
    expect(await page.locator(".record a, .record [href], .record img").count()).toBe(0);
  });
});

describe("좁은 화면과 두 테마", () => {
  const NONE: { page: number; over: string[] } = { page: 0, over: [] };
  const everyFile = [...CAPTURES, ...SARIFS, ...DRAFTS, ...FIXTURES];

  it("볼 파일이 있다", () => {
    expect([CAPTURES.length, SARIFS.length, DRAFTS.length]).toEqual([7, 1, 3]);
    expect(FIXTURES.length).toBeGreaterThanOrEqual(6);
  });

  it.each([
    [375, 667, 355],
    [320, 568, 300],
  ])("%dpx: 수집본, SARIF, v1 초안 예시, 시험용 자료의 기록이 가로로 넘치지 않는다", async (width, height, limit) => {
    const { context, page } = await open("/view/", { viewport: { width, height } });
    for (const parts of everyFile) {
      const name = parts.join("/");
      await pick(page, parts);
      await showRecord(page);
      expect(await page.locator(".record").isVisible(), name).toBe(true);
      expect(await overflow(page), name).toEqual({ ...NONE, limit });
      // 표는 줄을 세로로 쌓는다. 칸 머리는 화면에서만 가리고, 칸마다 앞에 그 이름을 적는다(CSS 가 그린 글을 읽는다).
      const stacked = await page.locator(".record-table").first().evaluate((table) => {
        const head = table.querySelector("thead")!.getBoundingClientRect();
        const row = table.querySelector("tbody tr")!;
        return {
          head: [Math.round(head.width), Math.round(head.height)],
          labels: [...row.querySelectorAll("td")].map((td) => getComputedStyle(td, "::before").content),
          lefts: new Set([...row.querySelectorAll("td")].map((td) => Math.round(td.getBoundingClientRect().left))).size,
        };
      });
      expect(stacked, name).toEqual({ head: [1, 1], labels: ["대표 조문", "시행일", "원문 해시", "발견"].map(drawnLabel), lefts: 1 });
    }
    // 화면 낭독기에는 표로 남는다(Chrome 의 접근성 트리를 CDP 로 읽는다).
    const policyTable = page.locator(".record-table").first();
    expect(await accessibleNodes(context, page, policyTable.locator("thead th"))).toEqual(POLICY_COLUMNS.map((column) => ({ role: "columnheader", name: column })));
    expect((await accessibleNodes(context, page, policyTable.locator("tbody th"))).map((node) => node.role)).toEqual(packFile.policies.map(() => "rowheader"));
    // 고르는 단추와 인쇄 단추는 글이 접히지 않는다.
    const heights = await page.locator(".report-switch > .segmented button, .record-tools button").evaluateAll((all) => all.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(heights).toHaveLength(3);
    expect(new Set(heights).size).toBe(1);
  });

  // 901px 은 표를 나란히 놓는 가장 좁은 화면이다(900px 까지는 쌓는다).
  it.each([1280, 901])("%dpx: 넓은 화면에서는 표의 칸이 제 머리 아래에 나란히 놓인다. 지문은 한 줄, 원문 해시는 두 줄이다", async (width) => {
    const { page } = await open("/view/", { viewport: { width, height: 720 } });
    await pick(page, ["tests", "fixtures", "repeated-rule.json"]);
    await showRecord(page);
    expect(await overflow(page)).toMatchObject(NONE);
    const table = await page.locator(".record-table").first().evaluate((el) => {
      const lefts = (cells: Element[]) => cells.map((cell) => Math.round(cell.getBoundingClientRect().left));
      const row = el.querySelector("tbody tr")!;
      return {
        head: lefts([...el.querySelectorAll("thead th")]),
        row: lefts([...row.children]),
        labels: [...row.querySelectorAll("td")].map((td) => getComputedStyle(td, "::before").content),
      };
    });
    expect(table.row).toEqual(table.head);
    expect(new Set(table.head).size).toBe(5);
    expect(new Set(table.labels)).toEqual(new Set(["none"]));
    // 줄의 수: 글 조각의 위쪽 끝을 센다.
    const lines = (selector: string) =>
      page.locator(selector).evaluateAll((all) => all.map((el) => new Set([...el.getClientRects()].map((rect) => Math.round(rect.top))).size));
    expect(new Set(await lines(".record-findings .record-hex"))).toEqual(new Set([1]));
    expect(new Set(await lines(".record-table:not(.record-findings) .record-hex"))).toEqual(new Set([2]));
    // 정책 id 는 제 줄에 한 줄로 적힌다. 칸이 좁으면 붙임표에서 갈린다(820px 까지만 쌓던 때 821px 에서 그랬다).
    // id 는 블록이라 상자는 늘 하나다. 그 안의 글이 몇 줄인지를 센다.
    const ids = await page.locator(".record-table:not(.record-findings) .record-id").evaluateAll((all) =>
      all.map((code) => {
        const range = document.createRange();
        range.selectNodeContents(code);
        return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
      }),
    );
    expect(ids).toHaveLength(packFile.policies.length);
    expect(new Set(ids)).toEqual(new Set([1]));
  });

  it("900px 까지는 표를 쌓는다", async () => {
    const { page } = await open("/view/", { viewport: { width: 900, height: 720 } });
    await showRecord(page);
    const row = await page.locator(".record-table").first().locator("tbody tr").first().evaluate((tr) => ({
      lefts: new Set([...tr.children].map((cell) => Math.round(cell.getBoundingClientRect().left))).size,
      labels: [...tr.querySelectorAll("td")].map((td) => getComputedStyle(td, "::before").content),
    }));
    expect(row).toEqual({ lefts: 1, labels: ["대표 조문", "시행일", "원문 해시", "발견"].map(drawnLabel) });
    expect(await overflow(page)).toMatchObject(NONE);
  });

  it.each([375, 1280])("%dpx: 접근성 트리에서 구역마다 제목이 있고, 표의 이름은 그 제목이며, 칸의 이름은 값뿐이다", async (width) => {
    // 화면 낭독기로 듣는 것은 접근성 트리다. 세 가지를 본다(Chrome 의 트리를 CDP 로 읽는다. site.ts 의 accessibleNodes. 실제
    // 화면 낭독기의 음성은 아니다. 시험 도구의 getByRole·ariaSnapshot 은 태그와 role 속성으로 셈해서 쓰지 않는다).
    // - 표가 든 구역에도 제목(h4)이 있다. 제목으로 건너다닐 때 그 구역을 지나치지 않는다.
    // - 표의 이름은 그 제목이다(aria-labelledby). 표를 쌓아도(display 가 바뀌어도) 표·줄·칸으로 남는다.
    // - 쌓았을 때 칸 앞에 CSS 가 그린 칸 이름은 칸의 이름에 들지 않는다. 들면 칸 머리와 함께 두 번 읽힌다.
    const { context, page } = await open("/view/", { viewport: { width, height: 667 } });
    await pick(page, ["tests", "fixtures", "judge-on.cleared.json"]);
    await showRecord(page);
    const record = page.locator(".record");
    const nodes = (target: string | Locator) => accessibleNodes(context, page, target);
    // 제목이 될 수 있는 요소를 모두 읽고 넷째 단계를 고른다.
    const headings = (await nodes(".record :is(h1, h2, h3, h4, h5, h6, [role=heading])"))
      .filter((node) => node.role === "heading" && node.level === 4)
      .map((node) => node.name);
    expect(headings).toEqual(["검사 정보", "다 보지 못한 것 결과에 실린 목록입니다", "발견 0건", "정책별 대표 조문과 발견", "AI 가 푼 경고 1건"]);
    // 표는 셋이고, 문서의 차례대로 이름이 제 구역의 제목이다.
    const tables = record.locator("table, [role=table]");
    expect(await nodes(tables)).toEqual([headings[1], headings[3], headings[4]].map((name) => ({ role: "table", name })));
    expect(await record.locator("caption").count()).toBe(0);
    // 표 위에 적은 말은 제목과 표 사이에 있다(AI 의 표). 구역은 표로 끝난다.
    expect(await record.locator(".record-about").evaluateAll((all) => all.map((el) => [el.previousElementSibling?.tagName, el.nextElementSibling?.tagName, el.parentElement?.lastElementChild?.tagName]))).toEqual([
      ["H4", "TABLE", "TABLE"],
    ]);

    // 칸과 줄의 이름은 하나도 빠짐없이 그 role 로 드러난다(화면 낭독기에서만 가려진 칸이 없다). 그려지지 않는 칸은 뺀다:
    // 좁은 화면에서 "다 보지 못한 것"의 빈 칸(든 것이 없는 줄의 뜻과 파일)은 그리지 않는다.
    const drawn = await record.locator("td").evaluateAll((all) => all.map((td) => td.getClientRects().length > 0));
    // 정책마다 칸 넷, "다 보지 못한 것"의 네 줄에 칸 둘씩(좁은 화면에서는 하나씩), AI 의 표 한 줄에 칸 둘.
    expect(drawn.filter(Boolean).length).toBe(packFile.policies.length * 4 + (width <= 480 ? 4 : 8) + 2);
    // 그려진 칸은 모두 칸이고, 그려지지 않는 칸은 트리에서 빠진다.
    expect((await nodes(".record td")).map((node) => node.role)).toEqual(drawn.map((shown) => (shown ? "cell" : "ignored")));
    const rowHeads = await nodes(".record tbody th");
    expect(rowHeads.length).toBeGreaterThan(0);
    expect(rowHeads.map((node) => node.role)).toEqual(rowHeads.map(() => "rowheader"));
    const columnHeads = await nodes(".record thead th");
    expect(columnHeads.length).toBeGreaterThan(0);
    expect(columnHeads.map((node) => node.role)).toEqual(columnHeads.map(() => "columnheader"));

    // 정책 표(둘째 표. 이름은 위에서 봤다): 칸의 이름이 값 그대로다. 줄은 팩의 정책 차례다(발견이 없는 결과다).
    const cleared = (readJson("tests", "fixtures", "judge-on.cleared.json") as Report).run.ai_cleared![0];
    const policies = tables.nth(1);
    expect(await nodes(policies.locator("thead th"))).toEqual(POLICY_COLUMNS.map((column) => ({ role: "columnheader", name: column })));
    expect((await nodes(policies.locator("td"))).map((node) => node.name)).toEqual(
      packFile.policies.flatMap((policy) => {
        const primary = policy.legal[0];
        return [primary.label, primary.effective_from, primary.text_sha256, policy.id === cleared.policy ? "발견 없음 AI 가 푼 경고 1건" : "발견 없음"];
      }),
    );
    expect(await nodes(policies.locator("tbody th"))).toEqual(packFile.policies.map((policy) => ({ role: "rowheader", name: `${policy.title} ${policy.id}` })));
    // AI 의 표(셋째 표)도 같다.
    expect((await nodes(tables.nth(2).locator("td"))).map((node) => node.name)).toEqual([`${cleared.policy} ${cleared.rule}`, cleared.alternatives[0].id]);
    // 좁은 화면에서는 칸 앞의 이름이 눈에 그려져 있다. 넓은 화면에는 없다.
    const label = await record.locator(".record-table td").first().evaluate((td) => getComputedStyle(td, "::before").content);
    expect(label).toBe(width <= 900 ? drawnLabel("대표 조문") : "none");
  });

  it.each([375, 320])("%dpx: 지문과 해시는 줄이 바뀌어도 칸을 넘지 않고, 골라 복사한 글은 원래 값 그대로다", async (width) => {
    const { page } = await open("/view/", { viewport: { width, height: 667 } });
    await pick(page, ["tests", "fixtures", "repeated-rule.json"]);
    await showRecord(page);
    const data = readJson("tests", "fixtures", "repeated-rule.json") as Report;
    const read = await page.locator(".record .record-hex").evaluateAll((all) =>
      all.map((code) => {
        const selection = window.getSelection()!;
        selection.selectAllChildren(code);
        const copied = selection.toString();
        selection.removeAllRanges();
        const rects = [...code.getClientRects()];
        const cell = code.closest("td")!.getBoundingClientRect();
        const range = document.createRange();
        return {
          copied,
          text: code.textContent,
          lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
          // 글이 칸 안에 그려진다.
          inside: rects.every((rect) => rect.left >= cell.left - 0.5 && rect.right <= cell.right + 0.5),
          // 마디(줄바꿈 자리 사이의 글)마다: 몇 자인지, 몇 줄에 걸쳐 그려졌는지.
          chunks: [...code.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => {
              range.selectNodeContents(node);
              return { length: node.textContent!.length, lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size };
            }),
        };
      }),
    );
    // 정책마다의 원문 해시와 발견 25건의 지문이다. 정책은 팩에 실린 수만큼이다.
    const hashes = await page.locator(".record-table").first().locator("tbody tr th .record-id").allTextContents();
    expect(hashes).toHaveLength(packFile.policies.length);
    const expected = [
      ...hashes.map((id) => packFile.policies.find((policy) => policy.id === id)!.legal[0].text_sha256),
      ...(await page.locator(".record-findings .record-hex").allTextContents()),
    ];
    expect(read.map((entry) => entry.copied)).toEqual(expected);
    expect(read.map((entry) => entry.text)).toEqual(expected);
    expect([...read.slice(hashes.length).map((entry) => entry.copied)].sort()).toEqual(data.findings.map((finding) => finding.fingerprint).sort());
    for (const entry of read) expect(entry.inside, entry.copied).toBe(true);
    // 긴 값은 줄이 바뀐다. 가로로 넘치게 두지 않았다는 뜻이다. SHA-256 은 두 줄 이상이다.
    for (const entry of read.slice(0, hashes.length)) expect(entry.lines, entry.copied).toBeGreaterThanOrEqual(2);
    // 줄은 16자 마디에서 바뀐다. 마디 하나가 두 줄에 걸쳐 끊기지 않는다(줄마다 16자의 배수가 된다).
    for (const entry of read) {
      expect(entry.chunks.map((chunk) => chunk.length), entry.copied).toEqual(entry.copied.length === 64 ? [16, 16, 16, 16] : [16, 16]);
      expect(entry.chunks.map((chunk) => chunk.lines), entry.copied).toEqual(entry.chunks.map(() => 1));
    }
    expect(await overflow(page)).toMatchObject(NONE);
  });

  it("375px: 쌓은 발견 표에서 굵게 적는 것은 묶음 머리뿐이다. 줄의 이름은 묶음의 마지막 줄까지 보통 굵기다", async () => {
    const { page } = await open("/view/", { viewport: { width: 375, height: 667 } });
    // 발견이 스무 건인 묶음과 한 건뿐인 묶음이 함께 있다. 한 건뿐인 묶음은 그 한 줄이 묶음의 마지막 줄이다.
    await pick(page, ["tests", "fixtures", "repeated-rule.json"]);
    await showRecord(page);
    const weights = await page.locator(".record-findings tbody").evaluateAll((groups) =>
      groups.map((tbody) => [...tbody.querySelectorAll("tr")].map((tr) => getComputedStyle(tr.querySelector("th")!).fontWeight)),
    );
    expect(weights.map((group) => group.length - 1)).toEqual([20, 2, 1, 1, 1]);
    for (const [head, ...rows] of weights) {
      expect(Number(head)).toBeGreaterThanOrEqual(600);
      expect(new Set(rows)).toEqual(new Set(["400"]));
    }
    // 묶음 머리의 정책 id 와 규칙 id 는 가운데서 줄이 바뀌지 않는다. 줄에 다 들어가지 않으면 통째로 다음 줄로 내려간다.
    const idLines = await page.locator(".record-findings .record-group code").evaluateAll((all) =>
      all.map((code) => {
        const range = document.createRange();
        range.selectNodeContents(code);
        return { id: code.textContent, lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size };
      }),
    );
    expect(idLines).toHaveLength(weights.length * 2);
    for (const entry of idLines) expect(entry.lines, entry.id!).toBe(1);
    // 머리는 한 줄에 다 들어가지 않는다(두 줄이 넘는 머리가 있다). 그래도 id 는 갈리지 않았다는 뜻이다.
    const headLines = await page.locator(".record-findings .record-group th").evaluateAll((all) =>
      all.map((th) => {
        const style = getComputedStyle(th);
        const inner = th.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        return Math.round(inner / parseFloat(style.lineHeight));
      }),
    );
    expect(Math.max(...headLines)).toBeGreaterThanOrEqual(2);
    // 정책 표는 줄의 이름(정책의 제목)이 굵다. 쌓았을 때 줄이 어디서 시작하는지 보인다.
    const titles = await page.locator(".record-table").first().locator("tbody th").evaluateAll((all) => all.map((th) => getComputedStyle(th).fontWeight));
    expect(titles).toHaveLength(packFile.policies.length);
    for (const weight of titles) expect(Number(weight)).toBeGreaterThanOrEqual(600);
  });

  it("기록의 글은 모두 그려진다. 좁은 화면, 넓은 화면, 인쇄할 때 가려진 글이 없다", async () => {
    // 맨 위의 말과 0의 뜻, 경고, AI 의 표 아래의 말까지: 문서에 있는 글이 눈에도 보여야 한다. 경고가 든 결과, AI 의 표가 든
    // 결과 둘, 발견이 0인 결과로 본다.
    const narrow = await open("/view/", { viewport: { width: 375, height: 667 } });
    const wide = await open("/view/", { viewport: { width: 1280, height: 720 } });
    for (const parts of [
      ["tests", "fixtures", "incomplete-coverage.json"],
      ["tests", "fixtures", "judge-on.cleared.json"],
      ["tests", "fixtures", "judge-on.dismissed.json"],
      ["contract", "cli-current", "kids-signup.fixed.json"],
    ]) {
      const name = parts.join("/");
      await pick(narrow.page, parts);
      await showRecord(narrow.page);
      const stacked = await undrawn(narrow.page, VEILED.stacked, 10);
      expect(stacked.undrawn, `${name} 375px`).toEqual([]);
      expect(stacked.texts, `${name} 375px`).toBeGreaterThan(60);

      await asScreen(wide.page);
      await pick(wide.page, parts);
      await showRecord(wide.page);
      const side = await undrawn(wide.page, VEILED.wide, 10);
      expect(side.undrawn, `${name} 1280px`).toEqual([]);
      // 넓은 화면에서는 칸 머리도 보이는 글이다. 좁은 화면보다 글 조각이 그만큼 많다.
      const heads = await wide.page.locator(".record-table thead th").count();
      expect(heads, name).toBeGreaterThan(0);
      expect(side.texts - stacked.texts, name).toBe(heads);

      // 인쇄할 때. 글자가 작다(9pt 의 0.82배가 가장 작다).
      await asPrint(wide.page);
      const printed = await undrawn(wide.page, VEILED.wide, 9);
      expect(printed.undrawn, `${name} 인쇄`).toEqual([]);
      expect(printed.texts, `${name} 인쇄`).toBe(side.texts);
    }
  });

  it("기록에서 CSS 가 그린 글은 쌓은 표의 칸 앞에 적는 칸 이름뿐이다", async () => {
    const LABELS = ["대표 조문", "시행일", "원문 해시", "발견", "상태", "지문", "정책과 규칙", "대안"];
    const narrow = await open("/view/", { viewport: { width: 375, height: 667 } });
    // AI 의 표 둘과 발견 표가 모두 있는 결과는 없다. 표마다 그 표가 있는 결과로 본다.
    const seen = new Set<string>();
    for (const parts of [
      ["tests", "fixtures", "incomplete-coverage.json"],
      ["tests", "fixtures", "judge-on.cleared.json"],
      ["tests", "fixtures", "judge-on.dismissed.json"],
    ]) {
      await pick(narrow.page, parts);
      await showRecord(narrow.page);
      const read = await cssDrawn(narrow.page);
      // 규칙으로는 하나뿐이다: 칸의 이름을 속성에서 가져와 그리는 것. 화면 너비나 인쇄와 상관없이 그렇다.
      expect(read.rules, parts.join("/")).toEqual(['.record-table tbody td::before { content: attr(data-label) / "" }']);
      for (const entry of read.drawn) seen.add(entry);
    }
    expect([...seen].sort()).toEqual(LABELS.map((label) => `td::before ${drawnLabel(label)}`).sort());

    // 넓은 화면과 인쇄할 때는 CSS 가 그리는 글이 없다.
    const wide = await open("/view/", { viewport: { width: 1280, height: 720 } });
    await pick(wide.page, ["tests", "fixtures", "judge-on.cleared.json"]);
    await showRecord(wide.page);
    expect((await cssDrawn(wide.page)).drawn).toEqual([]);
    await asPrint(wide.page);
    expect((await cssDrawn(wide.page)).drawn).toEqual([]);
  });

  it.each(["light", "dark"] as const)("%s: 기록의 글자가 바탕 위에서 읽힌다 (명도 대비 4.5:1 이상). 다 보지 못한 검사라는 경고도", async (colorScheme) => {
    const { page } = await open("/view/", { viewport: { width: 375, height: 667 }, colorScheme });
    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(colorScheme === "dark");
    await pick(page, ["tests", "fixtures", "incomplete-coverage.json"]);
    await showRecord(page);
    const pairs = await page.locator(".record").evaluate((record) => {
      /** 그 요소 뒤의 바탕색. 비치는 색이면 조상의 것을 본다. */
      const behind = (el: Element): string => {
        for (let up: Element | null = el; up; up = up.parentElement) {
          const color = getComputedStyle(up).backgroundColor;
          if (color !== "rgba(0, 0, 0, 0)") return color;
        }
        return "rgb(255, 255, 255)";
      };
      const seen = new Map<string, { what: string; color: string; background: string }>();
      const walker = document.createTreeWalker(record, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement!;
        if ((node.textContent ?? "").trim() === "" || el.closest(".visually-hidden")) continue;
        const pair = { what: `${el.tagName.toLowerCase()}.${el.className}`, color: getComputedStyle(el).color, background: behind(el) };
        seen.set(`${pair.color} on ${pair.background}`, pair);
      }
      // 칸 앞에 CSS 가 그린 이름도 글이다.
      for (const td of record.querySelectorAll(".record-table td")) {
        const pair = { what: "td::before", color: getComputedStyle(td, "::before").color, background: behind(td) };
        seen.set(`${pair.color} on ${pair.background}`, pair);
      }
      return [...seen.values()];
    });
    // 본문, 옅게 적은 말, 경고의 세 가지는 있다.
    expect(pairs.length).toBeGreaterThanOrEqual(3);
    for (const pair of pairs) expect(contrast(pair.color, pair.background), `${pair.what}: ${pair.color} / ${pair.background}`).toBeGreaterThanOrEqual(4.5);
    // 경고가 있는 결과다.
    expect(await page.locator(".record-warning").innerText()).toContain("다 보지 못한 검사입니다.");
    // 고르는 단추와 인쇄 단추의 글자도 읽힌다.
    const buttons = await page.locator(".report-switch > .segmented button, .record-tools button").evaluateAll((all) =>
      all.map((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor })),
    );
    for (const button of buttons) expect(contrast(button.color, button.background), JSON.stringify(button)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("데모의 판마다 기록을 본다", () => {
  const APPS = "데모 코드 고르기";
  const VARIANTS = "고치기 전과 고친 뒤 고르기";
  const demoButton = (page: Page, group: string, name: string) => page.getByRole("group", { name: group }).getByRole("button", { name, exact: true });

  it("세 앱 × 두 판: 기록에 합성 예시라고 적히고, 그 판의 발견과 지문이 실린다. 판을 바꾸면 결과 화면으로 돌아간다", async () => {
    const start = site.requests.length;
    const { page, outside } = await open("/demo/");
    await settle(site, page);
    expect(site.requests.slice(start)[0].url).toBe("/demo/");
    const mark = site.requests.length;
    let first = true;
    for (const app of DEMO_APPS) {
      for (const variant of DEMO_VARIANTS) {
        const name = `${app.key}.${variant.key}`;
        const title = `${app.label} · ${variant.label}`;
        await demoButton(page, APPS, app.label).click();
        await demoButton(page, VARIANTS, variant.label).click();
        await page.waitForFunction((want) => document.querySelector(".demo-title")?.textContent === want, title);
        // 판을 바꾸면 결과 화면이다.
        if (!first) expect(await pressed(page), name).toEqual(["결과"]);
        first = false;
        await showRecord(page);
        const text = await recordText(page);
        expect(squash(text), name).toContain(`조문별 검사 기록 합성 예시입니다. ${title} ${RECORD_OMITS} 법률 자문이 아닙니다. 인증이나 확인서도 아닙니다.`);
        const data = readJson("contract", "cli-current", `${name}.json`) as Report;
        expect(squash(text), name).toContain(`발견 ${data.findings.length}건`);
        expect((await page.locator(".record-findings .record-hex").allTextContents()).sort(), name).toEqual(data.findings.map((finding) => finding.fingerprint).sort());
        // 위의 코드 상자에 보이는 그 판의 코드는 기록에 없다.
        const code = (await page.locator(".codeblock .codeline").allTextContents()).map((line) => line.trim()).filter(Boolean);
        expect(code.length, name).toBeGreaterThan(2);
        for (const line of code) expect(text, `${name}: ${line}`).not.toContain(line);
        // 인쇄하면 기록만 나온다. 코드 상자와 두 결과의 표도 나오지 않는다.
        await asPrint(page);
        expect(await drawn(page, DEMO_CHROME), name).toEqual(DEMO_CHROME.map(() => false));
        expect(squash(await drawnText(page)), name).toBe(squash(await recordText(page)));
        await asScreen(page);
        expect(await drawn(page, DEMO_CHROME), name).toEqual(DEMO_CHROME.map(() => true));
      }
    }
    await settle(site, page);
    expect(site.requests.slice(mark)).toEqual([]);
    expect(outside).toEqual([]);
    expect(await page.evaluate(() => location.pathname + location.search + location.hash)).toBe("/demo/");
  });

  it("기록을 보는 동안 표의 정책 이름을 누르면 결과 화면으로 돌아가 그 정책 카드로 간다", async () => {
    const { page } = await open("/demo/", { viewport: { width: 375, height: 667 } });
    await demoButton(page, APPS, "광고 푸시").click();
    await demoButton(page, VARIANTS, "고친 뒤").click();
    await page.waitForFunction(() => document.querySelector(".demo-title")?.textContent === "광고 푸시 · 고친 뒤");
    const place = () => page.evaluate(() => ({ url: location.pathname + location.search + location.hash, history: history.length }));
    const start = await place();
    /** 초점이 놓인 요소: 무엇이고, 창의 위쪽 끝에서 얼마나 떨어져 있고, 화면에 그려져 있는지. */
    const focused = () =>
      page.evaluate(() => {
        const el = document.activeElement!;
        return { id: el.id, top: Math.round(el.getBoundingClientRect().top), drawn: el.getClientRects().length > 0 };
      });
    const [first, second] = await page.locator(".compare tbody th a").all();

    // 기록을 보는 동안에는 정책 카드가 가려져 있다. 표의 말("누르면 아래 결과의 그 정책으로 갑니다")은 그대로 보인다.
    await showRecord(page);
    expect(await page.locator("#policy-kr-network-act-50-3").isVisible()).toBe(false);
    expect(await page.locator(".demo-compare").innerText()).toContain("표의 정책 이름을 누르면 아래 결과(고친 뒤)의 그 정책으로 갑니다.");

    // 마우스로 누른다. 결과 화면으로 돌아가고, 그 정책 카드가 창 위쪽에 오고, 초점이 카드로 옮겨 간다.
    await second.click();
    expect(await page.locator(".record").count()).toBe(0);
    expect(await pressed(page)).toEqual(["결과"]);
    expect(await page.locator(".report").isVisible()).toBe(true);
    expect(await focused()).toEqual({ id: "policy-kr-network-act-50-3", top: 12, drawn: true });
    // 주소와 방문 기록은 그대로다.
    expect(await place()).toEqual(start);
    // 초점이 떠나면 카드는 다시 초점을 받지 않는 요소다(가려진 카드에 tabindex 가 남지 않는다).
    await page.keyboard.press("Tab");
    expect(await page.locator("article.policy[tabindex]").count()).toBe(0);

    // 키보드로도 같다. 기록을 다시 고르고, 링크에 초점을 두고 Enter.
    await showRecord(page);
    await first.focus();
    await page.keyboard.press("Enter");
    expect(await page.locator(".record").count()).toBe(0);
    expect(await pressed(page)).toEqual(["결과"]);
    expect(await focused()).toEqual({ id: "policy-kr-network-act-50-4", top: 12, drawn: true });
    expect(await place()).toEqual(start);

    // 기록 단추를 누른 바로 뒤에(기록이 아직 그려지기 전일 수 있다) 눌러도 결과 화면에서 그 카드로 간다.
    await page.evaluate(() => {
      const record = [...document.querySelectorAll<HTMLButtonElement>(".report-switch > .segmented button")].find((button) => button.getAttribute("aria-pressed") === "false")!;
      record.click();
      document.querySelectorAll<HTMLAnchorElement>(".compare tbody th a")[1].click();
    });
    expect(await pressed(page)).toEqual(["결과"]);
    expect(await focused()).toEqual({ id: "policy-kr-network-act-50-3", top: 12, drawn: true });
    await page.waitForTimeout(200);
    expect(await page.locator(".record").count()).toBe(0);
  });

  it("375px: 데모의 기록도 넘치지 않는다. 발견이 0인 판의 기록에는 0의 뜻이 맨 위와 0건 아래에 적혀 있다", async () => {
    const { page } = await open("/demo/", { viewport: { width: 375, height: 667 } });
    await demoButton(page, VARIANTS, "고친 뒤").click();
    await page.waitForFunction(() => document.querySelector(".demo-title")?.textContent === "아동 가입 · 고친 뒤");
    await showRecord(page);
    const text = squash(await recordText(page));
    expect(text).toContain(`발견 0건 ${SITE.zeroIsNotClearance}`);
    expect(text.split(SITE.zeroIsNotClearance)).toHaveLength(3);
    // 싣지 않은 것은 머리에 적혀 있다. 기록의 끝은 마지막 구역(정책 표와 그 아래의 말)이다.
    expect(text.split(RECORD_OMITS)).toHaveLength(2);
    expect(text.indexOf(RECORD_OMITS)).toBeLessThan(text.indexOf("검사 정보"));
    expect(await page.locator(".record > :last-child").evaluate((el) => el.className)).toBe("record-section");
    // 코드 상자는 제 안에서 밀린다. 그 안의 줄은 재지 않는다(tests/browser/demo.test.ts 와 같다).
    expect(await overflow(page, ".codeblock pre")).toMatchObject({ page: 0, over: [] });
  });
});

describe("판정자를 켠 결과의 기록", () => {
  it("AI 가 푼 경고와 빠진 판정이 기록에 보인다. 인용한 줄과 답은 보이지 않는다", async () => {
    const { page } = await open("/view/");
    const lines = codeLines(SIGNUP);
    const cleared = readJson("tests", "fixtures", "judge-on.cleared.json") as Report;
    const cite = cleared.run.ai_cleared![0].alternatives[0].cite!;
    expect(lines).toContain(cite);

    await pick(page, ["tests", "fixtures", "judge-on.cleared.json"]);
    // 결과 화면에는 인용한 줄이 보인다.
    expect(await page.locator(".ai-decisions").innerText()).toContain(cite);
    await showRecord(page);
    let text = await recordText(page);
    expect(squash(text)).toContain("AI 가 푼 경고 1건. 발견에는 들어 있지 않습니다.");
    expect(squash(text)).toContain("src/auth/signup.ts:5");
    expect(squash(text)).toContain("ai-guard");
    for (const line of lines) expect(text, line).not.toContain(line);
    // 인쇄될 글에도 없다.
    await asPrint(page);
    expect(await drawnText(page)).not.toContain(cite);
    await asScreen(page);

    await pick(page, ["tests", "fixtures", "judge-on.dismissed.json"]);
    const dismissed = readJson("tests", "fixtures", "judge-on.dismissed.json") as Report;
    expect(await page.locator(".ai-decisions").innerText()).toContain(dismissed.run.ai_dismissed![0].question!);
    await showRecord(page);
    text = await recordText(page);
    expect(squash(text)).toContain("AI 가 적용되지 않는다고 답해 빠진 판정 1건. 발견에도 판정 단위 수에도 들어 있지 않습니다.");
    expect(text).not.toContain(dismissed.run.ai_dismissed![0].question!);
    for (const line of lines) expect(text, line).not.toContain(line);

    await pick(page, ["tests", "fixtures", "judge-on.citation-rejected.json"]);
    await showRecord(page);
    text = await recordText(page);
    expect(squash(text)).toContain("판정자 claude-cli:haiku");
    for (const line of lines) expect(text, line).not.toContain(line);
    // 판정 경로의 문장은 결과 화면에만 있다.
    expect(text).not.toContain("인용 불인정");
  });

  it("손으로 고친 결과에 든 글도 글로만 그려진다 (경로와 id 에 꺾쇠가 든 파일)", async () => {
    const { page } = await open("/view/", { viewport: { width: 375, height: 667 } });
    const base = readJson("contract", "cli-current", "kids-signup.main.json") as Report;
    const odd = '<img src=x onerror="window.__ran=1">';
    const data = { ...base, findings: base.findings.map((finding) => ({ ...finding, file: `src/${odd}/a.ts`, rule: `rule-${odd}`, fingerprint: `${odd}0123456789abcdef` })) };
    const name = `${"long-name-".repeat(12)}.json`;
    await pickContent(page, name, data);
    await showRecord(page);
    const text = await recordText(page);
    expect(text).toContain(`src/${odd}/a.ts:5`);
    expect(text).toContain(`연 파일(${name})`);
    expect(await page.locator(".record img").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __ran?: number }).__ran)).toBeUndefined();
    // 긴 파일 이름과 낯선 값이 들어도 넘치지 않는다.
    expect(await overflow(page)).toMatchObject({ page: 0, over: [] });
  });
});
