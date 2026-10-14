import type { Browser, BrowserContext, Page, Request } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { policyHref } from "@/lib/pack";
import type { PolicyMeta } from "@/lib/pack/types";
import { readPackFile } from "../helpers";
import { ASKED, CODE_LEAVES, expectedPolicyPage, partingOf, PRIMARY_NOTE, squash, UNDESCRIBED, wholeText } from "../policy-page";
import { legalBlockMarkup } from "./expected";
import {
  accessibleNames,
  accessibleNodes,
  closeChrome,
  contrast,
  cssDrawn,
  launchChrome,
  newPage,
  NO_STORAGE,
  openPage,
  overflow,
  scrollThrough,
  serveOut,
  settle,
  stored,
  undrawn as undrawnIn,
  type OpenOptions,
  type Site,
} from "./site";

// 조문 도감(`/policy`, `/policy/<이름>`)을 실제 브라우저로 열어 본다. 빌드된 out/ 을 127.0.0.1 에 띄우고 이 컴퓨터의
// Chrome(헤드리스)으로 연다. 빌드된 HTML 을 읽는 시험(out-files.test.ts)이 볼 수 없는 것을 본다: 브라우저가 읽은 조문
// 원문과 화면에 보이는 줄바꿈·빈칸, 목록에서 눌러 왔을 때(쪽을 다시 받지 않는다), 좁은 화면의 가로 넘침과 표의 쌓임,
// 글이 실제로 그려지는지, 쪽이 스스로 내는 요청, 법제처 링크를 눌렀을 때, 두 테마의 색, 키보드, 화면 낭독기에 읽히는 이름,
// HTML 에 없는 글(브라우저에서 도는 코드가 더한 글, CSS 가 그린 글)이 화면에 없는지.
//
// 볼 것은 팩 메타데이터에서 고른다(정책의 id 나 글을 여기에 적어 두지 않는다). 시험에 필요한 모양의 정책(조문이 둘 이상,
// 대안이 셋 이상 등)이 팩에 없으면 조용히 넘어가지 않고 그렇다고 알리며 실패한다.
//
// 팩 메타데이터는 data/pack-meta.json 을 직접 읽은 것이다(tests/helpers.ts 의 readPackFile). 소스가 읽어 들인 것
// (`@/lib/pack` 의 packMeta)과 견주면, 읽어 들이는 곳이 값을 고쳤을 때 쪽과 기대값이 함께 달라져 통과한다.

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

// 시험이 실패해도 띄운 것은 닫는다.
afterAll(async () => {
  await closeChrome(browser);
  await site?.close();
});

const { pack, policies } = readPackFile();
const INDEX = "/policy/";
const open = (pathname: string, options: Pick<OpenOptions, "viewport" | "colorScheme"> = {}) =>
  openPage(browser, site, pathname, { ...options, contexts, problems });

/** 그 모양의 정책을 팩에서 고른다. 없으면 시험이 볼 것이 없다는 뜻이므로 실패한다. */
function pick(what: string, test: (policy: PolicyMeta) => boolean): PolicyMeta {
  const found = policies.find(test);
  if (!found) throw new Error(`팩에 ${what} 정책이 없습니다. 이 시험이 볼 것이 없습니다.`);
  return found;
}

/** 원문이 실린 조문의 원문(쪽에 나오는 차례). */
const texts = (policy: PolicyMeta) => policy.legal.flatMap((legal) => legal.text || []);

/** 그 정책의 쪽이 그려질 때까지 기다린다. */
async function shown(page: Page, title: string): Promise<void> {
  await page.waitForFunction((want) => document.querySelector("article.policy-page h1")?.textContent === want, title);
}

/** 접어 둔 것을 모두 펼친다. */
const openAll = (page: Page) =>
  page.evaluate(() => {
    for (const details of document.querySelectorAll("details")) details.open = true;
  });

/** 쪽의 조문 원문 상자를 브라우저가 읽은 것. */
const statutes = (page: Page) =>
  page.locator("pre.statute").evaluateAll((all) =>
    all.map((pre) => ({
      /** 문서에 든 글. 접혀 있어도 읽힌다. */
      text: pre.textContent ?? "",
      /** 화면에 그려진 글. 줄바꿈과 빈칸을 CSS 가 그대로 보일 때만 `text` 와 같다. 접혀 있으면 그려지지 않는다. */
      drawn: (pre as HTMLElement).innerText,
      // 닫힌 details 안의 것도 상자는 가진다(Chrome 은 그 안을 그리지만 않는다). 그려지는지를 따로 묻는다.
      visible: pre.checkVisibility(),
      /** 대표 조문(쪽의 첫 조문)의 상자인지. */
      primary: pre.closest(".legal") === document.querySelector(".legal"),
      /** 긴 줄이 상자 안에서 줄을 바꾼다(상자가 가로로 밀리지 않는다). */
      fits: pre.scrollWidth <= pre.clientWidth,
    })),
  );

/** 일부러 화면에서만 가린 것: 화면 낭독기용 글과, 좁은 화면(640px 이하)의 앞 두 칸 머리("대안", "종류와 세기"). */
const VEILED = { narrow: ".visually-hidden, .alts thead th:not(:last-child)", wide: ".visually-hidden" };

/**
 * 정책 쪽의 글 가운데 화면에 그려지지 않는 것. 없어야 한다(tests/browser/site.ts 의 `undrawn`. 기록·결과 화면·데모의 시험과
 * 같은 기준이다). 접어 둔 곳 안의 글과 일부러 화면에서만 가린 것(`veiled`)은 빼고 본다. 그것이 몇 곳인지는 HTML 을 읽는
 * 시험과 표의 시험이 본다.
 */
const undrawn = (page: Page, veiled: string) => undrawnIn(page, { root: "article.policy-page", veiled });

/** 요소의 이름 가운데 눈에 보이는 글. 화면 낭독기에만 읽히는 앞말(.visually-hidden)은 뺀다. */
const shownNames = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((all) =>
    all.map((el) =>
      [...el.childNodes]
        .filter((node) => !(node instanceof Element && node.classList.contains("visually-hidden")))
        .map((node) => node.textContent ?? "")
        .join("")
        .trim(),
    ),
  );

describe("브라우저가 읽은 조문 원문", () => {
  it("주소로 열었을 때: 팩 메타데이터와 글자 그대로 같고, 줄바꿈과 빈칸이 화면에 그대로 보인다", async () => {
    const { page } = await open(INDEX, { viewport: { width: 375, height: 667 } });
    let boxes = 0;
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      // 접혀 있는 조문의 원문도 쪽에 들어 있다. 대표 조문의 원문만 처음부터 보인다.
      const closed = await statutes(page);
      expect(closed.map((box) => box.text), policy.id).toEqual(texts(policy));
      expect(closed.map((box) => box.visible), policy.id).toEqual(closed.map((box) => box.primary));
      // 펼치면 화면에 그려진 글도 같다. 줄바꿈과 이어진 빈칸이 접히거나 사라지지 않는다.
      await openAll(page);
      const opened = await statutes(page);
      expect(opened.map((box) => box.drawn), policy.id).toEqual(texts(policy));
      expect(opened.every((box) => box.visible && box.fits), policy.id).toBe(true);
      boxes += opened.length;
    }
    // 빈 것끼리 견준 것이 아니다. 줄바꿈이 든 원문이 있다(한 줄짜리 글끼리 견준 것도 아니다).
    expect(boxes).toBeGreaterThan(0);
    expect(policies.flatMap(texts).some((text) => text.includes("\n"))).toBe(true);
  });

  it("목록에서 눌러 왔을 때(쪽을 다시 받지 않는다)도 글자 그대로 같다", async () => {
    // 목록의 링크를 누르면 브라우저는 쪽의 HTML 을 다시 받지 않고, 미리 받아 둔 내용(.txt)으로 그린다. 그 길로 그려진
    // 원문도 같아야 한다.
    const start = site.requests.length;
    const { page } = await open(INDEX);
    await page.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
    for (const policy of policies) {
      await page.locator(`.policy-index a[href="${policyHref(policy.id)}"]`).click();
      await page.waitForURL(`**${policyHref(policy.id)}`);
      await shown(page, policy.title);
      await openAll(page);
      const boxes = await statutes(page);
      expect(boxes.map((box) => box.text), policy.id).toEqual(texts(policy));
      expect(boxes.map((box) => box.drawn), policy.id).toEqual(texts(policy));
      // 적용 조건의 설명 자리와 접어 둔 글의 이름도 그대로 그려졌다(이름은 눈에 보이는 글만 읽는다).
      expect(await page.locator(".conditions .none").allInnerTexts(), policy.id).toEqual(
        policy.rules.flatMap((rule) => rule.applies_when).map(() => UNDESCRIBED),
      );
      expect(await shownNames(page, ".rule-doc .fold > summary"), policy.id).toEqual(
        policy.rules.flatMap((rule) => [rule.applies_question, ...rule.alternatives.map((alt) => alt.question)]).flatMap((text) => (text ? ASKED : [])),
      );
      await page.goBack();
      await page.waitForURL(`**${INDEX}`);
      await page.waitForFunction(() => document.querySelector("h1")?.textContent === "조문 도감");
    }
    // 같은 문서 안에서 오갔다. 정책 쪽의 HTML 은 한 번도 청하지 않았다.
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
    const documents = site.requests.slice(start).filter((request) => request.method === "GET" && request.url.endsWith("/"));
    expect(documents.map((request) => request.url)).toEqual([INDEX]);
  });
});

describe("쪽에 그려진 글은 틀 안에서 읽은 글이 전부다", () => {
  // HTML 을 읽는 시험은 틀(article) 안의 글이 기대값과 같고 쪽의 본문에 그 틀뿐인지를 빌드된 파일로 본다(out-files.test.ts).
  // 여기서는 그 시험에 보이지 않는 두 가지를 본다: 브라우저에서 도는 코드가 더한 글과, CSS 가 그린 글.

  it("브라우저가 그린 본문에는 정책 쪽 하나뿐이고, 그 글 전체가 팩 메타데이터에서 만든 기대값과 같다 (목록에서 눌러 왔을 때, 주소로 열어 스크립트가 붙은 뒤)", async () => {
    const { page } = await open(INDEX);
    const whole = async (policy: PolicyMeta, how: string) => {
      const main = await page.locator("main.wrap").evaluate((el) => ({
        children: [...el.children].map((child) => `${child.tagName.toLowerCase()}.${child.className}`),
        text: el.textContent ?? "",
      }));
      expect(main.children, `${policy.id} (${how})`).toEqual(["article.policy-page"]);
      // 접어 둔 글과 화면 낭독기용 앞말까지, 본문의 글 전체다. 빈칸은 빼고 견준다.
      expect(partingOf(squash(main.text), wholeText(expectedPolicyPage(policy, pack))), `${policy.id} (${how})`).toBeNull();
    };
    // 목록에서 눌러 왔을 때. 브라우저가 받아 둔 내용으로 쪽을 직접 그린다(쪽의 HTML 을 다시 받지 않는다).
    await page.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
    for (const policy of policies) {
      await page.locator(`.policy-index a[href="${policyHref(policy.id)}"]`).click();
      await page.waitForURL(`**${policyHref(policy.id)}`);
      await shown(page, policy.title);
      await whole(policy, "목록에서 눌러 왔을 때");
      await page.goBack();
      await page.waitForURL(`**${INDEX}`);
      await page.waitForFunction(() => document.querySelector("h1")?.textContent === "조문 도감");
    }
    expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept)).toBe(true);
    // 주소로 열었을 때. 스크립트가 붙고 쪽이 스스로 내는 요청이 끝난 뒤에 본다. 그 뒤에 더해진 글은 쪽의 HTML 에 없다.
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "networkidle" });
      await shown(page, policy.title);
      await whole(policy, "주소로 열었을 때");
    }
  });

  it("CSS 가 그린 글이 없다: 쪽에 실린 꾸밈의 규칙에도, 화면에 그려진 것에도 (틀 밖까지)", async () => {
    // CSS 는 HTML 에 없는 글을 그린다(`::before`·`::after`·`::marker` 의 content, 글로 적은 목록 표시). 적용 조건의 id 옆에 CSS
    // 로 풀이를 그려 넣어도 통과하던 것을 막는다(tests/browser/site.ts 의 `cssDrawn`). 조문 도감이 그려도 되는 것은 목록 표시
    // (점, 없음, 접어 둔 것의 세모)뿐이다. 꾸밈으로 글자를 그려야 하면 그 값을 여기서 `cssDrawn` 에 허용으로 준다. 조문·규칙·
    // 조건을 풀이하는 글은 CSS 로 그리지 않는다.
    const { page } = await open(INDEX);
    const clean = async (what: string) => {
      const read = await cssDrawn(page);
      expect(read.rules, what).toEqual([]);
      expect(read.drawn, what).toEqual([]);
      return read.read;
    };
    // 꾸밈의 규칙을 읽었다(꾸밈이 실리지 않은 쪽을 보고 통과한 것이 아니다).
    expect((await clean("목록")).rules).toBeGreaterThan(0);
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      const read = await clean(policy.id);
      expect(read.rules, policy.id).toBeGreaterThan(0);
      // 틀 안의 요소보다 많이 쟀다(틀 밖까지 쟀다).
      expect(read.elements, policy.id).toBeGreaterThan(await page.locator("article.policy-page *").count());
    }
    // 대조: 같은 방법으로, CSS 가 글을 그리면 잡힌다. 연 쪽에만 꾸밈을 넣어 본다(소스는 그대로다).
    await page.addStyleTag({
      content:
        '.brand::before { content: ""; } .no-such-class::after { content: "다른 쪽의 것"; } ' +
        'article.policy-page h1::after { content: " (풀이)"; } article.policy-page h1:hover::before { content: "올렸을 때만 "; } ' +
        '@media print { .legend li::marker { content: "※ "; } } .legend { list-style-type: "→ "; }',
    });
    const control = await cssDrawn(page);
    // 규칙으로는 넷이 잡힌다. 마우스를 올렸을 때만, 인쇄할 때만 그리는 것까지다. 빈 글과 이 쪽에 없는 class 의 것은 잡지 않는다.
    expect(control.rules).toEqual([
      'article.policy-page h1::after { content: " (풀이)" }',
      'article.policy-page h1:hover::before { content: "올렸을 때만 " }',
      '.legend li::marker { content: "※ " }',
      '.legend { list-style-type: "→ " }',
    ]);
    // 화면에 그려진 것으로는 지금 그려지는 둘만 잡힌다(제목 뒤의 글, 목록 표시).
    expect(control.drawn.slice(0, 2)).toEqual(['h1.::after content: " (풀이)"', 'ul.legend list-style-type: "→ "']);
  });
});

describe("좁은 화면", () => {
  const FITS: { page: number; over: string[] } = { page: 0, over: [] };

  it.each([
    [375, 667, 355],
    [320, 568, 300],
  ])("%dpx: 목록과 정책 쪽이 가로로 넘치지 않는다 (접힌 채와 모두 펼친 채). 접어 둔 곳 밖의 글은 모두 그려진다", async (width, height, limit) => {
    const { page } = await open(INDEX, { viewport: { width, height } });
    expect(await overflow(page), "목록").toEqual({ ...FITS, limit });
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      expect(await overflow(page), `${policy.id} (접힌 채)`).toEqual({ ...FITS, limit });
      const closed = await undrawn(page, VEILED.narrow);
      expect(closed.undrawn, `${policy.id} (접힌 채)`).toEqual([]);
      await openAll(page);
      expect(await page.locator("details:not([open])").count(), policy.id).toBe(0);
      expect(await overflow(page), `${policy.id} (펼친 채)`).toEqual({ ...FITS, limit });
      const opened = await undrawn(page, VEILED.narrow);
      expect(opened.undrawn, `${policy.id} (펼친 채)`).toEqual([]);
      // 본 글이 있다. 펼치면 볼 글이 늘어난다(접어 둔 글을 빼고 본 것이 맞다).
      expect(closed.texts, policy.id).toBeGreaterThan(20);
      expect(opened.texts, policy.id).toBeGreaterThan(closed.texts);
      // 조문 원문의 긴 줄은 상자 안에서 줄을 바꾼다. 상자가 가로로 밀리지 않는다.
      expect((await statutes(page)).every((box) => box.fits), policy.id).toBe(true);
    }
  });

  it("375px: 대표 조문 표시의 뜻이 그 이름 바로 아래에 한 줄로 보인다 (마우스를 올려야 뜨는 말이 아니다)", async () => {
    // 터치 화면과 키보드로는 title 을 읽을 수 없다. 뜻은 보이는 글로 적는다.
    const { page } = await open(INDEX, { viewport: { width: 375, height: 667 } });
    for (const policy of policies.filter((entry) => entry.legal.length > 0)) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      const first = page.locator(".legal").first();
      expect(await first.locator("h3 .tag").innerText(), policy.id).toBe("대표 조문");
      const note = first.locator("> .hint");
      expect(await note.innerText(), policy.id).toBe(PRIMARY_NOTE);
      const read = await note.evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        line: parseFloat(getComputedStyle(el).lineHeight),
        top: el.getBoundingClientRect().top,
        heading: el.parentElement!.querySelector("h3")!.getBoundingClientRect().bottom,
        facts: el.parentElement!.querySelector("dl")!.getBoundingClientRect().top,
      }));
      expect(read.height, policy.id).toBeLessThan(read.line * 1.5);
      expect(read.top, policy.id).toBeGreaterThanOrEqual(read.heading);
      expect(read.top + read.height, policy.id).toBeLessThanOrEqual(read.facts);
      // 다른 조문에는 그 말이 없다. 쪽 어디에도 마우스를 올려야 뜨는 말은 없다.
      expect(await page.locator(".legal > .hint").count(), policy.id).toBe(1);
      expect(await page.locator("article.policy-page [title]").count(), policy.id).toBe(0);
    }
  });

  it("넓은 화면에서도 접어 둔 곳 밖의 글은 모두 그려진다 (칸 머리 셋까지)", async () => {
    const { page } = await open(INDEX);
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      await openAll(page);
      const seen = await undrawn(page, VEILED.wide);
      expect(seen.undrawn, policy.id).toEqual([]);
      // 좁은 화면에서 가리는 앞의 두 칸 머리도 여기서는 본다.
      expect(seen.texts - (await undrawn(page, VEILED.narrow)).texts, policy.id).toBe(policy.rules.length * 2);
    }
  });

  /** 쪽의 대안 표를 화면에서 읽은 것. 칸마다 칸의 상자와, 그 안의 글이 실제로 그려진 상자(`ink`)를 함께 읽는다. */
  const tables = (page: Page) =>
    page.locator("table.alts").evaluateAll((all) => {
      const round = (rect: DOMRect) => ({
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
      const box = (node: Element) => round(node.getBoundingClientRect());
      const ink = (node: Element) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return round(range.getBoundingClientRect());
      };
      return all.map((el) => ({
        own: box(el),
        caption: box(el.querySelector("caption")!),
        columns: [...el.querySelectorAll("thead th")].map((th) => ({ text: th.textContent, ...box(th) })),
        rows: [...el.querySelectorAll("tbody tr")].map((tr) => ({
          id: { ...box(tr.querySelector("th")!), ink: ink(tr.querySelector("th")!) },
          kind: { ...box(tr.querySelector(".alt-kind")!), ink: ink(tr.querySelector(".alt-kind")!) },
          says: box(tr.querySelector(".alt-says")!),
        })),
      }));
    });

  const COLUMNS = ["대안", "종류와 세기", "확인되지 않았을 때 하는 말"];

  it.each([375, 320])("%dpx: 대안 표는 줄을 세로로 쌓는다. 칸의 글은 제 칸 안에 그려진다", async (width) => {
    let beside = 0;
    const { page } = await open(INDEX, { viewport: { width, height: 667 } });
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      const read = await tables(page);
      expect(read.map((table) => table.rows.length), policy.id).toEqual(policy.rules.map((rule) => rule.alternatives.length));
      for (const table of read) {
        for (const row of table.rows) {
          // 대안의 id 가 줄의 맨 앞이고, 종류는 그 옆이나(자리가 있으면) 바로 아래다. 하는 말은 그 아래에 표의 너비를 다 쓴다.
          expect(row.id.left, policy.id).toBe(table.own.left);
          expect(row.kind.top, policy.id).toBeGreaterThanOrEqual(row.id.top - 6);
          expect(row.says.top, policy.id).toBeGreaterThanOrEqual(Math.max(row.id.bottom, row.kind.bottom) - 1);
          expect(row.says.left, policy.id).toBe(table.own.left);
          expect(row.says.width, policy.id).toBe(table.own.width);
          // 칸이 글을 담는다. 칸은 표 안에 있다. 칸의 너비가 1% 로 남으면 글이 칸 밖에 그려지고, id 가 길면 표 밖으로 나간다.
          for (const cell of [row.id, row.kind]) {
            expect(cell.ink.left, policy.id).toBeGreaterThanOrEqual(cell.left - 1);
            expect(cell.ink.right, policy.id).toBeLessThanOrEqual(cell.right + 1);
            expect(cell.right, policy.id).toBeLessThanOrEqual(table.own.right);
          }
          if (row.kind.left > row.id.right && Math.abs(row.kind.top - row.id.top) <= 6) beside += 1;
        }
      }
    }
    // 종류가 id 옆에 놓인 줄을 봤다(모두 아래로 내려간 것만 본 것이 아니다).
    expect(beside).toBeGreaterThan(0);
  });

  it.each([
    [375, 355],
    [320, 300],
  ])("%dpx: 대안의 id 가 길어도 글이 표 밖으로 나가지 않는다 (화면에서만 긴 id 로 바꿔 본다)", async (width, limit) => {
    // 팩에 실린 id 는 짧다(가장 긴 것이 스무 자 안팎이다). 긴 id 가 실렸을 때를 쪽의 DOM 만 고쳐서 본다.
    // 빼기표가 있어 끊을 자리가 있는 것과, 끊을 자리가 없는 것.
    const LONG = ["some-quite-long-alternative-id-for-narrow-screens", "x".repeat(48)];
    const { page } = await open(INDEX, { viewport: { width, height: 667 } });
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      for (const id of LONG) {
        await page.evaluate((text) => {
          for (const code of document.querySelectorAll("table.alts tbody th code")) code.textContent = text;
        }, id);
        expect(await overflow(page), `${policy.id} ${id}`).toEqual({ ...FITS, limit });
        for (const table of await tables(page)) {
          for (const row of table.rows) {
            for (const cell of [row.id, row.kind]) {
              expect(cell.ink.right, `${policy.id} ${id}`).toBeLessThanOrEqual(table.own.right + 1);
              expect(cell.ink.right, `${policy.id} ${id}`).toBeLessThanOrEqual(cell.right + 1);
            }
            // 자리가 모자라면 종류는 id 아래로 내려간다. 겹치지 않는다.
            expect(row.kind.top, `${policy.id} ${id}`).toBeGreaterThanOrEqual(row.id.bottom - 1);
          }
        }
      }
    }
  });

  it.each([
    [375, 355],
    [320, 300],
  ])("%dpx: 규칙 id 와 적용 조건 id 가 길어도 넘치지 않고 글이 규칙 상자 안에 그려진다 (화면에서만 긴 id 로 바꿔 본다)", async (width, limit) => {
    // 6번에서 넘어온 확인이다(대안의 id 는 위에서 본다). 팩에 실린 id 는 짧다. 긴 id 가 실렸을 때를 쪽의 DOM 만 고쳐서 본다.
    // 빼기표가 있어 끊을 자리가 있는 것과, 끊을 자리가 없는 것.
    const LONG = ["some-quite-long-rule-or-condition-id-for-narrow-screens", "x".repeat(56)];
    const { page } = await open(INDEX, { viewport: { width, height: 667 } });
    let conditions = 0;
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      for (const id of LONG) {
        const read = await page.evaluate((text) => {
          const codes = [...document.querySelectorAll(".rule-doc h3 code, .rule-doc .conditions code")];
          for (const code of codes) code.textContent = text;
          return codes.map((code) => {
            const rule = code.closest(".rule-doc")!.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(code);
            const ink = range.getBoundingClientRect();
            return { where: code.closest("h3") ? "규칙" : "적용 조건", inside: ink.left >= rule.left - 0.5 && ink.right <= rule.right + 0.5, lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size };
          });
        }, id);
        expect(read.filter((entry) => entry.where === "규칙"), `${policy.id} ${id}`).toHaveLength(policy.rules.length);
        conditions += read.filter((entry) => entry.where === "적용 조건").length;
        for (const entry of read) expect(entry.inside, `${policy.id} ${entry.where} ${id}`).toBe(true);
        // 긴 id 는 줄을 바꾼다(가로로 넘치게 두지 않았다).
        for (const entry of read) expect(entry.lines, `${policy.id} ${entry.where} ${id}`).toBeGreaterThanOrEqual(2);
        expect(await overflow(page), `${policy.id} ${id}`).toEqual({ ...FITS, limit });
      }
    }
    // 적용 조건의 id 도 봤다.
    expect(conditions).toBeGreaterThan(0);
  });

  it("375px: 칸 머리 가운데 '확인되지 않았을 때 하는 말'은 표 이름 아래에 보인다. 앞의 둘은 화면에서만 가리고 표로 남는다", async () => {
    // 가리면 알리는 말·질문·고치는 법이 언제 쓰는 말인지 좁은 화면에는 보이는 글이 없다.
    const policy = pick("규칙이 둘 이상인", (entry) => entry.rules.length >= 2);
    const { context, page } = await open(policyHref(policy.id), { viewport: { width: 375, height: 667 } });
    const read = await tables(page);
    expect(read).toHaveLength(policy.rules.length);
    for (const table of read) {
      expect(table.columns.map((column) => column.text)).toEqual(COLUMNS);
      const [id, kind, says] = table.columns;
      expect([id.width, id.height, kind.width, kind.height]).toEqual([1, 1, 1, 1]);
      // 표 이름과 첫 줄 사이에, 표의 왼쪽 끝에서 시작한다.
      expect(says.height).toBeGreaterThan(10);
      expect(says.left).toBe(table.own.left);
      expect(says.top).toBeGreaterThanOrEqual(table.caption.bottom - 1);
      expect(says.bottom).toBeLessThanOrEqual(table.rows[0].id.top + 1);
    }
    for (const th of await page.locator("table.alts thead th:last-child").all()) expect(await th.isVisible()).toBe(true);
    // display 가 바뀌어도 표로 읽힌다. 가린 칸 머리와 줄 머리(대안의 id)도 그대로 있다(Chrome 의 접근성 트리를 CDP 로 읽는다).
    const first = page.locator("table.alts").first();
    expect(await accessibleNodes(context, page, first.locator("thead th"))).toEqual(COLUMNS.map((name) => ({ role: "columnheader", name })));
    expect(await accessibleNodes(context, page, first.locator("tbody th"))).toEqual(policy.rules[0].alternatives.map((alt) => ({ role: "rowheader", name: alt.id })));
    expect((await accessibleNodes(context, page, "table, [role=table]")).map((node) => node.role)).toEqual(policy.rules.map(() => "table"));
  });

  it("넓은 화면에서는 칸이 제 머리 아래에 나란히 놓인다", async () => {
    const policy = pick("첫 규칙의 대안이 둘 이상인", (entry) => (entry.rules[0]?.alternatives.length ?? 0) >= 2);
    const { page } = await open(policyHref(policy.id));
    const [read] = await tables(page);
    expect(read.columns.map((column) => column.text)).toEqual(COLUMNS);
    for (const th of await page.locator("table.alts").first().locator("thead th").all()) expect(await th.isVisible()).toBe(true);
    expect(read.rows).toHaveLength(policy.rules[0].alternatives.length);
    for (const row of read.rows) {
      expect([row.id.left, row.kind.left, row.says.left]).toEqual(read.columns.map((column) => column.left));
      expect(row.kind.top).toBe(row.id.top);
      expect(row.says.top).toBe(row.id.top);
      // 칸의 글은 제 칸 안에 그려진다.
      for (const cell of [row.id, row.kind]) expect(cell.ink.right).toBeLessThanOrEqual(cell.right + 1);
    }
    // 하는 말의 칸이 가장 넓다.
    expect(read.columns[2].width).toBeGreaterThan(read.columns[0].width + read.columns[1].width);
  });
});

describe("쪽이 스스로 내는 요청이 없다", () => {
  it("맨 아래까지 내리고, 접어 둔 것을 모두 펼치고, 법제처 링크에 마우스를 올려도 요청이 없다. 브라우저 저장소에도 두지 않는다", async () => {
    const start = site.requests.length;
    const { context, page, outside } = await open(INDEX);
    const seen: string[] = [];
    context.on("request", (request) => seen.push(`${request.method()} ${request.url()}`));

    // 쪽을 열 때의 요청은 서버에 적힌다(머리 링크와 목록 링크의 프리페치까지). 이 시험이 요청을 본다는 뜻이다.
    await settle(site, page);
    const loading = site.requests.slice(start).map((request) => request.url);
    expect(loading[0]).toBe(INDEX);
    expect(loading.some((url) => url.startsWith("/view/"))).toBe(true);
    expect(loading.some((url) => url.startsWith(policyHref(policies[0].id)))).toBe(true);

    let hovered = 0;
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "networkidle" });
      await shown(page, policy.title);
      await settle(site, page);
      const mark = { server: site.requests.length, browser: seen.length };

      // 접어 둔 것을 하나씩 눌러 펼친다(조문 원문, 규칙 읽는 법, 판정자에게 묻는 글).
      // 누를 때마다 닫힌 것이 하나씩 줄어든다. 늘 맨 앞의 것을 누른다.
      const closed = page.locator("details:not([open]) > summary");
      const folds = await closed.count();
      expect(folds, policy.id).toBeGreaterThan(0);
      for (let left = folds; left > 0; left--) await closed.first().click();
      expect(await page.locator("details:not([open])").count(), policy.id).toBe(0);
      // 맨 아래까지 한 화면씩 내린다.
      await scrollThrough(page, 30);
      // 법제처 링크에 마우스를 올린다. 누르지는 않는다.
      const links = page.locator(".legal-facts a");
      expect(await links.count(), policy.id).toBe(policy.legal.filter((legal) => legal.url).length);
      for (const link of await links.all()) {
        await link.hover();
        hovered += 1;
      }
      await settle(site, page);

      expect(site.requests.slice(mark.server), policy.id).toEqual([]);
      expect(seen.slice(mark.browser), policy.id).toEqual([]);
    }
    // 밖으로 가는 링크가 있는 쪽에서 본 것이다. 처음부터 끝까지, 이 사이트 밖으로 나가려던 요청은 없다.
    expect(hovered).toBeGreaterThan(0);
    expect(outside).toEqual([]);

    expect(await stored(page)).toEqual(NO_STORAGE);
  });

  it("법제처 링크는 눌러야 나간다: 누르면 새 창이 팩 메타데이터의 주소로 가려 하고, 어느 쪽에서 왔는지는 싣지 않는다", async () => {
    // 위 시험의 대조이기도 하다. 밖으로 나가려는 요청이 있으면 이 시험의 가로채기에 적힌다.
    const policy = pick("첫 조문에 법제처 링크가 있는", (entry) => Boolean(entry.legal[0]?.url));
    const [legal] = policy.legal;
    const { context, page, outside } = await open(policyHref(policy.id));
    const requests: Request[] = [];
    context.on("request", (request) => requests.push(request));
    const link = page.locator(".legal-facts a").first();
    expect(await link.getAttribute("href")).toBe(legal.url);
    expect(await link.getAttribute("target")).toBe("_blank");
    // 화면 낭독기에는 어느 조문의 링크인지 함께 읽힌다. 눈에는 "새 창에서 열기"만 보인다.
    expect(await page.getByRole("link", { name: `${legal.label} 새 창에서 열기`, exact: true }).first().getAttribute("href")).toBe(legal.url);
    expect(outside).toEqual([]);

    const [popup] = await Promise.all([context.waitForEvent("page"), link.click()]);
    const wanted = new URL(legal.url!).href;
    await expect.poll(() => outside, { timeout: 5_000 }).toEqual([wanted]);
    const request = requests.find((entry) => entry.url() === wanted)!;
    expect(request.isNavigationRequest()).toBe(true);
    // 새 창의 요청이다. 보던 쪽은 그대로다. 새 창은 보던 쪽을 건드리지 못하고(noopener), 어느 쪽에서 왔는지 받지 못한다(noreferrer).
    expect(request.frame().page()).toBe(popup);
    expect(Object.keys(await request.allHeaders())).not.toContain("referer");
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    expect(page.url()).toBe(`${site.origin}${policyHref(policy.id)}`);
    expect(await page.locator("article.policy-page h1").innerText()).toBe(policy.title);
  });

  it("시험용 Chrome 은 127.0.0.1 밖의 이름을 풀지 못한다 (링크를 눌러도 그 서버로 연결이 생기지 않는다)", async () => {
    // 위 시험의 가로채기는 HTTP 요청만 막는다. Chrome 은 새 창이 옮겨 가기 시작할 때 그 출처로 연결을 먼저 여는데, 그 연결은
    // Chrome 을 띄울 때의 옵션이 막는다(site.ts 의 NO_OUTSIDE_NAMES). 그 옵션이 듣는지를 이 컴퓨터를 가리키는 다른
    // 이름(localhost)으로 본다. 옵션이 빠지면 localhost 로는 이 서버에 닿는다. 밖으로 나가는 것은 어느 쪽이든 없다.
    //
    // 쪽 안에서 받아 보는 것으로 본다(가로채기 없는 창에서). 창을 그 주소로 옮겨 보지는 않는다. 창이 이름을 풀지 못해 오류
    // 쪽을 띄우면 Chrome 이 DNS 가 살아 있는지 알아보려고 google.com 을 묻는 질의를 실제로 내보낸다(재서 알았다).
    // 창은 다른 시험과 같게 열고(생성자 감싸기, 오류 적기) 가로채기만 걸지 않는다.
    const { page } = await newPage(browser, site, { contexts, problems, intercept: false });
    expect((await page.goto(`${site.origin}${INDEX}`))?.status()).toBe(200);
    const { port } = new URL(site.origin);
    const reach = (host: string) =>
      page.evaluate(
        (url) =>
          fetch(url, { mode: "no-cors" }).then(
            () => "닿음",
            () => "닿지 않음",
          ),
        `http://${host}:${port}${INDEX}`,
      );
    // 대조: 같은 방법으로 127.0.0.1 에는 닿는다.
    expect(await reach("127.0.0.1")).toBe("닿음");
    expect(await reach("localhost")).toBe("닿지 않음");
    // 닿지 못한 것은 콘솔에 오류로 남는다. 이 시험에서는 그 한 줄이 있어야 하고, 그것뿐이어야 한다.
    await expect.poll(() => problems.length, { timeout: 3_000 }).toBeGreaterThan(0);
    expect(problems.splice(0)).toEqual(["콘솔: Failed to load resource: net::ERR_NAME_NOT_RESOLVED"]);
  });
});

describe("화면 낭독기에 읽히는 이름 (Chrome 의 접근성 트리)", () => {
  it("한 쪽 안에서 접어 둔 것과 법제처 링크의 이름이 서로 다르다. 어느 조문·규칙·대안의 것인지가 앞에 함께 읽힌다", async () => {
    // 눈에는 "조문 원문", "판정자에게 묻는 글", "새 창에서 열기"만 보인다. 한 쪽에 같은 이름이 여럿이라, 이름만 훑어 다니는
    // 사람에게는 어느 것인지 알 길이 없다. 앞말과 보이는 글 사이의 빈칸도 여기서 본다(빠지면 두 말이 붙어 읽힌다).
    const { context, page } = await open(INDEX, { viewport: { width: 375, height: 667 } });
    let repeated = 0;
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      const want = expectedPolicyPage(policy, pack);
      const folds = [
        ...want.legal.flatMap((legal) => legal.statute ?? []),
        { whose: null, summary: want.legend.summary },
        ...want.rules.flatMap((rule) => [rule.applies ?? [], ...rule.alternatives.map((alt) => alt.asked ?? [])].flat()),
      ];
      const names = await accessibleNames(context, page, "article.policy-page summary");
      expect(names, policy.id).toEqual(folds.map((fold) => (fold.whose === null ? fold.summary : `${fold.whose} ${fold.summary}`)));
      expect(new Set(names).size, policy.id).toBe(names.length);
      const links = await accessibleNames(context, page, "article.policy-page a");
      expect(links, policy.id).toEqual(want.legal.flatMap((legal) => (legal.link ? `${legal.link.whose} ${legal.link.text}` : [])));
      expect(new Set(links).size, policy.id).toBe(links.length);
      // 앞말은 이름마다 하나씩 있고(규칙 읽는 법은 하나뿐이라 없다), 눈에는 보이지 않는다(1px 로 잘려 있다).
      const hidden = await page.locator("article.policy-page .visually-hidden").evaluateAll((all) =>
        all.map((el) => Math.max(el.getBoundingClientRect().width, el.getBoundingClientRect().height)),
      );
      expect(hidden, policy.id).toEqual(new Array(names.length - 1 + links.length).fill(1));
      // 눈에 보이는 이름은 되풀이된다. 앞말이 없으면 이름이 겹친다는 뜻이다.
      const shown_ = await shownNames(page, "article.policy-page summary");
      repeated += shown_.length - new Set(shown_).size;
    }
    expect(repeated).toBeGreaterThan(0);
  });
});

describe("두 테마의 색", () => {
  /** 팩에 그 모양의 대안이나 글이 있을 때만 쪽에 나오는 것. 없으면 재지 않는다. */
  const OPTIONAL = [".alt-says .hint", ".says dd .none", ".rule-doc .fold > p", ".legal h3 .tag", ".legal > .hint", "pre.statute", ".legal-facts a"];
  const ALWAYS = [
    ".policy-page-head h1",
    ".policy-facts dt",
    ".policy-facts dd",
    ".policy-facts .hint",
    ".policy-section > h2",
    ".policy-section > .fold > summary",
    ".legend li",
    ".rule-doc h3 code",
    ".rule-doc .facts dt",
    ".rule-doc .facts dd",
    ".alts caption",
    // 좁은 화면에서도 보이는 칸 머리("확인되지 않았을 때 하는 말").
    ".alts thead th:last-child",
    ".alts tbody th code",
    ".alts .alt-kind",
    ".says dt",
    ".says dd",
  ];
  /** 머리의 대표 조문과 질문, 조문의 이름과 날짜, 판정자 알림, 적용 조건. 팩에 실린 정책에는 모두 있지만 없는 정책도 그려진다. */
  const USUAL = [".policy-page-head .law", ".policy-page-head .question", ".legal h3", ".legal-facts dt", ".legal-facts dd", ".policy-section > .notice", ".conditions code", ".conditions .none"];

  it.each(["light", "dark"] as const)("%s: 조문 원문과 옅게 적은 말, 표시가 바탕 위에서 읽힌다 (명도 대비 4.5:1 이상)", async (scheme) => {
    // 약한 대안이 있는 정책이면 그 줄에 적는 말까지 잰다. 없으면 첫 정책을 본다.
    const policy = policies.find((entry) => entry.rules.some((rule) => rule.alternatives.some((alt) => alt.strength === "weak"))) ?? policies[0];
    const { page } = await open(policyHref(policy.id), { viewport: { width: 375, height: 667 }, colorScheme: scheme });
    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(scheme === "dark");
    await openAll(page);
    const colors = await page.evaluate((selectors) => {
      /** 그 요소 뒤에 실제로 깔린 색: 비치지 않는 바탕을 가진 가장 가까운 조상의 색. */
      const behind = (el: Element): string => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const color = getComputedStyle(node).backgroundColor;
          if (color !== "rgba(0, 0, 0, 0)") return color;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      return selectors.map((selector) => {
        const el = document.querySelector(`article.policy-page ${selector}`);
        return el ? { selector, color: getComputedStyle(el).color, background: behind(el) } : { selector, color: null, background: null };
      });
    }, [...ALWAYS, ...USUAL, ...OPTIONAL]);
    const measured = colors.filter((entry): entry is { selector: string; color: string; background: string } => entry.color !== null);
    // 틀에 늘 있는 것은 빠짐없이 쟀다.
    expect(measured.map((entry) => entry.selector)).toEqual(expect.arrayContaining(ALWAYS));
    for (const { selector, color, background } of measured) {
      expect(contrast(color, background), `${selector}: ${color} / ${background}`).toBeGreaterThanOrEqual(4.5);
    }
    // 테마가 실제로 바뀌었다(같은 색을 두 번 잰 것이 아니다): 쪽의 바탕이 어두운 테마에서는 어둡고 밝은 테마에서는 밝다.
    const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const againstWhite = contrast(body, "rgb(255, 255, 255)");
    if (scheme === "dark") expect(againstWhite).toBeGreaterThan(10);
    else expect(againstWhite).toBeLessThan(1.5);
  });
  it.each(["light", "dark"] as const)("%s: 원문 해시가 맞지 않을 때의 경고(해시 칸의 값, 원문 위의 알림)가 바탕 위에서 읽힌다 (팩에 없는 모양이라 열린 쪽에 넣어 본다)", async (scheme) => {
    // 6번에서 넘어온 확인이다. 팩의 조문은 해시가 모두 맞아서 빌드된 쪽에는 이 꾸밈이 쓰이지 않는다. 부품(PolicyDetail)이
    // 그 모양으로 그리는 조문 하나를 Node 에서 그려 열린 쪽의 첫 조문 자리에 넣고, 브라우저가 계산한 색을 잰다(소스와
    // 빌드는 그대로다). 부품이 그리는 글과 구조는 부품 시험(tests/policy.test.tsx)이 본다.
    const policy = pick("원문이 실린 첫 조문이 있는", (entry) => Boolean(entry.legal[0]?.text));
    const { page } = await open(policyHref(policy.id), { viewport: { width: 375, height: 667 }, colorScheme: scheme });
    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(scheme === "dark");
    const markup = legalBlockMarkup(policy, pack, { text_sha256_matches: false });
    // 넣는 것이 그 꾸밈의 요소다. 지금 쪽에는 없다(대조).
    expect(markup).toContain('<dd class="warn">');
    expect(markup).toContain('<p class="notice notice-warn">');
    expect(await page.locator("article.policy-page dd.warn, article.policy-page .notice-warn").count()).toBe(0);
    await page.locator(".legal").first().evaluate((el, html) => {
      el.outerHTML = html;
    }, markup);
    const colors = await page.evaluate(() => {
      /** 그 요소 뒤에 실제로 깔린 색: 비치지 않는 바탕을 가진 가장 가까운 조상의 색. */
      const behind = (el: Element): string => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const color = getComputedStyle(node).backgroundColor;
          if (color !== "rgba(0, 0, 0, 0)") return color;
        }
        return getComputedStyle(document.body).backgroundColor;
      };
      const of = (selector: string) => {
        const el = document.querySelector(`article.policy-page ${selector}`)!;
        return { text: el.textContent, color: getComputedStyle(el).color, background: behind(el), weight: getComputedStyle(el).fontWeight };
      };
      return { hash: of(".legal-facts dd.warn"), notice: of(".legal > .notice-warn"), plain: of(".legal-facts dd:not(.warn)") };
    });
    expect(colors.hash.text).toBe("팩에 적힌 것과 다름");
    expect(colors.notice.text).toBe("아래 원문은 팩에 적힌 해시와 맞지 않습니다.");
    for (const [what, entry] of [["해시 칸", colors.hash], ["원문 위의 알림", colors.notice]] as const) {
      expect(contrast(entry.color, entry.background), `${what}: ${entry.color} / ${entry.background}`).toBeGreaterThanOrEqual(4.5);
    }
    // 경고의 꾸밈이 실제로 쓰였다(옆 칸의 값과 색·굵기가 다르다).
    expect([colors.hash.color, colors.hash.weight]).not.toEqual([colors.plain.color, colors.plain.weight]);
    // 넣은 경고의 글도 그려진다.
    expect((await undrawn(page, VEILED.narrow)).undrawn).toEqual([]);
  });
});

describe("키보드만으로", () => {
  it("법제처 링크와 접어 둔 것에 Tab 으로 차례로 닿고, Enter·Space 로 여닫는다", async () => {
    const policy = pick("원문과 법제처 링크가 있는 조문이 둘 이상인", (entry) => entry.legal.length >= 2 && entry.legal.every((legal) => legal.text && legal.url));
    const { page } = await open(policyHref(policy.id), { viewport: { width: 375, height: 667 } });
    const focused = () =>
      page.evaluate(() => {
        const el = document.activeElement!;
        // 이름의 눈에 보이는 첫 글. 화면 낭독기에만 읽히는 앞말(요소)은 건너뛴다.
        const name = [...el.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)?.textContent?.trim();
        if (el.tagName === "SUMMARY") return `접어 둔 것: ${name}`;
        return el.closest(".legal-facts") ? "법제처 링크" : el.tagName.toLowerCase();
      });
    // 머리의 링크 넷을 지나, 조문마다 법제처 링크 → 조문 원문, 그다음 규칙 읽는 법 차례다.
    const order: string[] = [];
    for (let i = 0; i < 4 + policy.legal.length * 2 + 1; i++) {
      await page.keyboard.press("Tab");
      order.push(await focused());
    }
    expect(order).toEqual([
      "a",
      "a",
      "a",
      "a",
      ...policy.legal.flatMap(() => ["법제처 링크", "접어 둔 것: 조문 원문"]),
      "접어 둔 것: 규칙 읽는 법",
    ]);
    // 초점이 어디 있는지 보인다.
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe("solid");

    // 규칙 읽는 법: Enter 로 펼치고 Space 로 접는다. 펼치면 약한 대안의 뜻이 보인다.
    const legend = page.locator(".policy-section > details.fold");
    const weak = legend.locator("li", { hasText: "정적 · 약한" });
    expect(await weak.isVisible()).toBe(false);
    await page.keyboard.press("Enter");
    expect(await legend.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
    expect(await weak.isVisible()).toBe(true);
    await page.keyboard.press("Space");
    expect(await legend.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);

    // 접혀 있던 둘째 조문의 원문도 키보드로 펼친다.
    const second = page.locator(".legal").nth(1);
    expect(await second.locator("pre.statute").isVisible()).toBe(false);
    await second.locator("summary").focus();
    await page.keyboard.press("Enter");
    expect(await second.locator("pre.statute").isVisible()).toBe(true);
    expect(await second.locator("pre.statute").innerText()).toBe(policy.legal[1].text);
    // 판정자를 켜면 코드가 밖으로 나간다는 말은 접혀 있지 않다. 펼치지 않아도 보인다.
    if (policy.rules.some((rule) => rule.alternatives.some((alt) => alt.kind === "ai") || rule.applies_question)) {
      expect(await page.locator(".policy-section > .notice").innerText()).toContain(CODE_LEAVES);
    }
  });
});
