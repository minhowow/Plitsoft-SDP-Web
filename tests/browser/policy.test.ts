import type { Browser, BrowserContext, Page, Request } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { policyHref, ruleAnchor } from "@/lib/pack";
import type { PolicyMeta } from "@/lib/pack/types";
import { readPackFile } from "../helpers";
import { ASKED, CODE_LEAVES, expectedPolicyPage, partingOf, squash, UNDESCRIBED, wholeText } from "../policy-page";
import { legalBlockMarkup } from "./expected";
import {
  accessibleNames,
  closeChrome,
  contrast,
  cssDrawn,
  launchChrome,
  newPage,
  NO_STORAGE,
  openPage,
  overflow,
  scrollThrough,
  serveSite,
  settle,
  stored,
  undrawn as undrawnIn,
  type OpenOptions,
  type Site,
} from "./site";

// 조문 도감(`/policy`, `/policy/<이름>`)을 실제 브라우저로 열어 본다. 빌드된 사이트를 127.0.0.1 에 띄우고(next start) 이 컴퓨터의
// Chrome(헤드리스)으로 연다. 빌드된 HTML 을 읽는 시험(served-files.test.ts)이 볼 수 없는 것을 본다: 브라우저가 읽은 조문
// 원문과 화면에 보이는 줄바꿈·빈칸, 목록에서 눌러 왔을 때(쪽을 다시 받지 않는다), 좁은 화면의 가로 넘침, 글이 실제로 그려지는지,
// 쪽이 스스로 내는 요청, 법제처 링크를 눌렀을 때, 쪽 안의 자리로 옮겨 가기(바로가기, #status·#scope, 규칙의 자리), 쪽의 길이,
// 키보드, 화면 낭독기에 읽히는 이름, HTML 에 없는 글(브라우저에서 도는 코드가 더한 글, CSS 가 그린 글)이 화면에 없는지.
// 두 테마의 명도 대비는 colors.test.ts 가 모든 정책 쪽을 잰다.
//
// 볼 것은 팩 메타데이터에서 고른다(정책의 id 나 글을 여기에 적어 두지 않는다). 시험에 필요한 모양의 정책(조문이 둘 이상 등)이
// 팩에 없으면 조용히 넘어가지 않고 그렇다고 알리며 실패한다.
//
// 팩 메타데이터는 data/pack-meta.json 을 직접 읽은 것이다(tests/helpers.ts 의 readPackFile). 소스가 읽어 들인 것
// (`@/lib/pack` 의 packMeta)과 견주면, 읽어 들이는 곳이 값을 고쳤을 때 쪽과 기대값이 함께 달라져 통과한다.

let site: Site;
let browser: Browser;
const contexts: BrowserContext[] = [];
/** 쪽에서 난 오류(잡히지 않은 예외, 콘솔의 오류 줄). 시험마다 비어 있어야 한다. */
const problems: string[] = [];

beforeAll(async () => {
  site = await serveSite();
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
/** 발견이 있는 합성 분석(결과 화면). 상태의 뜻, 검사에 들지 않는 것, 규칙 id 의 링크가 있다. */
const ANALYSIS = "/r/example-org/kids-signup/a/wtk33e9zuf/";
/**
 * 규칙이 여럿인 정책의 발견이 있는 합성 분석. 결과 화면의 규칙 id 가 그 정책의 첫 규칙이 아닌 규칙(처음에는 접혀 있는 줄)으로
 * 잇는다. 첫 규칙은 처음부터 펼쳐져 있어서, 그리로 가는 링크로는 주소의 규칙 자리를 펼치는 일(`OpenTargetRule`)을 볼 수 없다.
 */
const ANALYSIS_MANY_RULES = "/r/example-org/night-push/a/64y4jdtazh/";
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

/**
 * 본문의 접어 둔 것을 모두 펼친다. 머리글의 펼치는 메뉴(좁은 화면 메뉴)는 펼치지 않는다. 펼치면 본문 위에 떠서 그 아래의 글을
 * 덮는다(그것은 메뉴의 일이다).
 */
const openAll = (page: Page) =>
  page.evaluate(() => {
    for (const details of document.querySelectorAll("main details")) (details as HTMLDetailsElement).open = true;
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
      primary: pre.closest(".lg-item") === document.querySelector(".lg-item"),
      /** 긴 줄이 상자 안에서 줄을 바꾼다(상자가 가로로 밀리지 않는다). */
      fits: pre.scrollWidth <= pre.clientWidth,
      /** 글꼴(이 컴퓨터의 명조). */
      font: getComputedStyle(pre).fontFamily,
    })),
  );

/** 일부러 화면에서만 가린 것: 화면 낭독기용 글. */
const VEILED = ".visually-hidden";

/**
 * 정책 쪽의 글 가운데 화면에 그려지지 않는 것. 없어야 한다(tests/browser/site.ts 의 `undrawn`). 접어 둔 곳 안의 글과 일부러
 * 화면에서만 가린 것은 빼고 본다.
 */
const undrawn = (page: Page) => undrawnIn(page, { root: "article.policy-page", veiled: VEILED });

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
  it("주소로 열었을 때: 팩 메타데이터와 글자 그대로 같고, 줄바꿈과 빈칸이 화면에 그대로 보인다. 글꼴은 이 컴퓨터의 명조다", async () => {
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
      // 바깥 글꼴을 받지 않는다. 이 컴퓨터의 명조 이름만 적고, 없으면 브라우저의 기본 명조(serif)다.
      for (const box of opened) expect(box.font, policy.id).toMatch(/^"?AppleMyungjo"?, "?Batang"?, .*serif$/);
      boxes += opened.length;
    }
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
      expect(await shownNames(page, ".rule-body .fold > summary"), policy.id).toEqual(
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
  // HTML 을 읽는 시험은 틀(article) 안의 글이 기대값과 같고 쪽의 본문에 그 틀뿐인지를 빌드된 파일로 본다(served-files.test.ts).
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
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "networkidle" });
      await shown(page, policy.title);
      await whole(policy, "주소로 열었을 때");
    }
  });

  it("CSS 가 그린 글이 없다: 쪽에 실린 꾸밈의 규칙에도, 화면에 그려진 것에도 (틀 밖까지)", async () => {
    // CSS 는 HTML 에 없는 글을 그린다(`::before`·`::after`·`::marker` 의 content, 글로 적은 목록 표시). 조문 도감이 그려도 되는
    // 것은 목록 표시(점, 없음, 접어 둔 것의 꺾쇠)뿐이다. 조문·규칙·조건을 풀이하는 글은 CSS 로 그리지 않는다.
    const { page } = await open(INDEX);
    // 목록 표시는 브라우저의 것(점, 목록 안 목록의 빈 동그라미, 없음, 접어 둔 것의 세모)만 그린다.
    const MARKERS = ["disc", "circle", "none", "disclosure-closed", "disclosure-open"];
    const clean = async (what: string) => {
      const read = await cssDrawn(page, { markers: MARKERS });
      expect(read.rules, what).toEqual([]);
      expect(read.drawn, what).toEqual([]);
      return read.read;
    };
    expect((await clean("목록")).rules).toBeGreaterThan(0);
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      const read = await clean(policy.id);
      expect(read.rules, policy.id).toBeGreaterThan(0);
      expect(read.elements, policy.id).toBeGreaterThan(await page.locator("article.policy-page *").count());
    }
    // 대조: 같은 방법으로, CSS 가 글을 그리면 잡힌다. 연 쪽에만 꾸밈을 넣어 본다(소스는 그대로다).
    await page.addStyleTag({
      content:
        '.brand::before { content: ""; } .no-such-class::after { content: "다른 쪽의 것"; } ' +
        'article.policy-page h1::after { content: " (풀이)"; } article.policy-page h1:hover::before { content: "올렸을 때만 "; } ' +
        '@media print { .legend li::marker { content: "※ "; } } details.legend-fold > ul.legend { list-style-type: "→ "; }',
    });
    const control = await cssDrawn(page);
    expect(control.rules).toEqual([
      'article.policy-page h1::after { content: " (풀이)" }',
      'article.policy-page h1:hover::before { content: "올렸을 때만 " }',
      '.legend li::marker { content: "※ " }',
      'details.legend-fold > ul.legend { list-style-type: "→ " }',
    ]);
    expect(control.drawn.slice(0, 2)).toEqual(['h1.::after content: " (풀이)"', 'ul.legend list-style-type: "→ "']);
  });
});

describe("쪽의 길이와 좁은 화면", () => {
  const FITS: { page: number; over: string[] } = { page: 0, over: [] };

  it("1280px: 정책 쪽마다 길이가 2,500px 이하다 (처음 펼쳐 둔 대로)", async () => {
    // docs/redesign.md 6장 D6 의 완료 조건. 대표 조문의 원문과 첫 규칙만 펼쳐 둔 채로 잰다.
    const { page } = await open(INDEX, { viewport: { width: 1280, height: 900 } });
    const heights: Record<string, number> = {};
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      heights[policy.id] = await page.evaluate(() => document.documentElement.scrollHeight);
    }
    for (const [id, height] of Object.entries(heights)) expect(height, id).toBeLessThanOrEqual(2_500);
    // 짧은 쪽만 잰 것이 아니다. 조문이 넷인 쪽처럼 긴 쪽도 있다(창의 높이보다 길다).
    expect(Math.max(...Object.values(heights))).toBeGreaterThan(900);
  });

  it.each([320, 390, 768, 1280])(
    "%dpx: 곁칸의 값은 한 세로줄에서 시작하고(넓은 화면은 오른쪽 끝), 해시를 펼쳐도 이름표가 한 줄이며, 같은 원문이라는 말은 한 덩어리로 줄을 바꾼다",
    async (width) => {
      const policy = pick("원문이 같은 조문이 있는", (entry) => entry.legal.some((legal, i) => legal.text && entry.legal.slice(0, i).some((earlier) => earlier.text === legal.text)));
      const { page } = await open(policyHref(policy.id), { viewport: { width, height: 900 } });
      await shown(page, policy.title);
      await openAll(page);
      const read = await page.evaluate(() => {
        const edges = (selector: string, side: "left" | "right") =>
          [...document.querySelectorAll(selector)].map((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            return Math.round(range.getBoundingClientRect()[side]);
          });
        return {
          left: edges(".side-facts dd", "left"),
          right: edges(".side-facts dd", "right"),
          labels: [...document.querySelectorAll(".lg-facts dt")].map((el) => el.getClientRects().length === 1 && el.getBoundingClientRect().height < 24),
          notes: [...document.querySelectorAll(".lg-item .fold-note")].map((el) => el.getClientRects().length),
        };
      });
      // 넓은 화면(곁칸이 오른쪽)에서는 값이 오른쪽 끝에 붙고, 좁은 화면(곁칸이 맨 아래)에서는 한 세로줄에서 시작한다(목업 policy).
      if (width >= 1012) expect(new Set(read.right).size, `${read.right}`).toBe(1);
      else expect(new Set(read.left).size, `${read.left}`).toBe(1);
      expect(read.labels.length).toBeGreaterThan(0);
      expect(read.labels.every(Boolean), `${read.labels}`).toBe(true);
      expect(read.notes.length).toBeGreaterThan(0);
      expect(read.notes.every((rects) => rects === 1), `${read.notes}`).toBe(true);
    },
  );

  it.each([
    [375, 667, 359],
    [320, 568, 304],
  ])("%dpx: 목록과 정책 쪽이 가로로 넘치지 않는다 (접힌 채와 모두 펼친 채). 접어 둔 곳 밖의 글은 모두 그려진다", async (width, height, limit) => {
    const { page } = await open(INDEX, { viewport: { width, height } });
    expect(await overflow(page), "목록").toEqual({ ...FITS, limit });
    expect((await undrawnIn(page, { root: "main", veiled: VEILED })).undrawn, "목록").toEqual([]);
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      expect(await overflow(page), `${policy.id} (접힌 채)`).toEqual({ ...FITS, limit });
      const closed = await undrawn(page);
      expect(closed.undrawn, `${policy.id} (접힌 채)`).toEqual([]);
      await openAll(page);
      expect(await page.locator("main details:not([open])").count(), policy.id).toBe(0);
      expect(await overflow(page), `${policy.id} (펼친 채)`).toEqual({ ...FITS, limit });
      const opened = await undrawn(page);
      expect(opened.undrawn, `${policy.id} (펼친 채)`).toEqual([]);
      expect(closed.texts, policy.id).toBeGreaterThan(20);
      expect(opened.texts, policy.id).toBeGreaterThan(closed.texts);
      expect((await statutes(page)).every((box) => box.fits), policy.id).toBe(true);
    }
  });

  it("넓은 화면에서도 접어 둔 곳 밖의 글은 모두 그려지고, 곁칸 `이 정책` 은 오른쪽에 있다", async () => {
    const { page } = await open(INDEX);
    expect((await undrawnIn(page, { root: "main", veiled: VEILED })).undrawn, "목록").toEqual([]);
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      await openAll(page);
      expect((await undrawn(page)).undrawn, policy.id).toEqual([]);
      const read = await page.evaluate(() => ({
        main: document.querySelector(".policy-main")!.getBoundingClientRect().right,
        side: document.querySelector(".policy-side")!.getBoundingClientRect().left,
      }));
      expect(read.side, policy.id).toBeGreaterThan(read.main);
    }
  });

  it.each([375, 1280])("%dpx: 법제처 원문 링크는 조문 이름과 겹치지 않고, 그 조문의 줄 안에 있다", async (width) => {
    const { page } = await open(INDEX, { viewport: { width, height: 800 } });
    let links = 0;
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      const read = await page.locator(".lg-item").evaluateAll((items) =>
        items.map((item) => {
          const link = item.querySelector(":scope > a.ext");
          const summary = item.querySelector(":scope > details > summary")!.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(item.querySelector(".lg-label")!);
          const label = [...range.getClientRects()];
          if (!link) return null;
          const box = link.getBoundingClientRect();
          return {
            inside: box.top >= summary.top - 0.5 && box.bottom <= summary.bottom + 0.5 && box.right <= summary.right + 0.5,
            clear: label.every((line) => line.right <= box.left || line.bottom <= box.top || line.top >= box.bottom),
          };
        }),
      );
      for (const entry of read.filter((entry) => entry !== null)) {
        expect(entry, policy.id).toEqual({ inside: true, clear: true });
        links += 1;
      }
    }
    expect(links).toBeGreaterThan(0);
  });

  it.each([
    [375, 359],
    [320, 304],
  ])("%dpx: 규칙 id·적용 조건 id·대안 id 가 길어도 넘치지 않고 글이 규칙 줄 안에 그려진다 (화면에서만 긴 id 로 바꿔 본다)", async (width, limit) => {
    // 팩에 실린 id 는 짧다. 긴 id 가 실렸을 때를 쪽의 DOM 만 고쳐서 본다. 빼기표가 있어 끊을 자리가 있는 것과 없는 것.
    const LONG = ["some-quite-long-rule-or-condition-id-for-narrow-screens", "x".repeat(56)];
    const { page } = await open(INDEX, { viewport: { width, height: 667 } });
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      await openAll(page);
      for (const id of LONG) {
        const read = await page.evaluate((text) => {
          const codes = [...document.querySelectorAll(".rule-row .loc code, .conditions code, .alt-h code")];
          for (const code of codes) code.textContent = text;
          return codes.map((code) => {
            const rule = code.closest(".rule-row")!.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(code);
            const ink = range.getBoundingClientRect();
            return { inside: ink.left >= rule.left - 0.5 && ink.right <= rule.right + 0.5, lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size };
          });
        }, id);
        expect(read.length, policy.id).toBeGreaterThan(policy.rules.length);
        for (const entry of read) expect(entry, `${policy.id} ${id}`).toEqual({ inside: true, lines: expect.any(Number) });
        for (const entry of read) expect(entry.lines, `${policy.id} ${id}`).toBeGreaterThanOrEqual(2);
        expect(await overflow(page), `${policy.id} ${id}`).toEqual({ ...FITS, limit });
      }
    }
  });
});

describe("쪽 안의 자리로 옮겨 가기", () => {
  it("바로가기(근거 조문, 규칙)를 누르면 그 구역이 창의 위쪽에 오고 초점이 그리로 간다. 주소와 방문 기록은 그대로다", async () => {
    const policy = pick("규칙이 둘 이상인", (entry) => entry.rules.length >= 2);
    const { page } = await open(policyHref(policy.id), { viewport: { width: 1280, height: 720 } });
    const url = page.url();
    const length = await page.evaluate(() => history.length);
    for (const [label, id] of [
      ["규칙", "rules"],
      ["근거 조문", "legal"],
    ] as const) {
      await page.locator(".jump a", { hasText: label }).click();
      const read = await page.evaluate((target) => ({
        top: Math.round(document.getElementById(target)!.getBoundingClientRect().top),
        focused: document.activeElement?.id ?? null,
      }), id);
      expect(read.focused, id).toBe(id);
      expect(read.top, id).toBeGreaterThanOrEqual(0);
      expect(read.top, id).toBeLessThanOrEqual(24);
      expect(page.url()).toBe(url);
      expect(await page.evaluate(() => history.length)).toBe(length);
    }
  });

  it("목록의 #status(상태의 뜻)와 #scope(검사에 들지 않는 파일과 정보): 주소로 열어도, 결과 화면의 링크를 눌러 와도 그 구역이 보인다", async () => {
    const { page } = await open(`${INDEX}#status`, { viewport: { width: 1280, height: 720 } });
    const inView = (id: string) =>
      page.evaluate((target) => {
        const box = document.getElementById(target)?.getBoundingClientRect();
        return box ? box.top >= 0 && box.top < window.innerHeight / 2 : null;
      }, id);
    expect(await inView("status")).toBe(true);
    await page.goto(`${site.origin}${INDEX}#scope`, { waitUntil: "load" });
    expect(await inView("scope")).toBe(true);
    // 결과 화면(분석 쪽)의 곁칸 `상태의 뜻` 과 검사 정보의 `검사에 들지 않는 파일과 정보`.
    for (const [selector, id] of [
      [".report a[href='/policy/#status']", "status"],
      [".report a[href='/policy/#scope']", "scope"],
    ] as const) {
      await page.goto(`${site.origin}${ANALYSIS}`, { waitUntil: "load" });
      const link = page.locator(selector).first();
      expect(await link.count(), selector).toBe(1);
      await link.click();
      await page.waitForURL(`**/policy/#${id}`);
      await page.waitForFunction(() => document.querySelector("h1")?.textContent === "조문 도감");
      await expect.poll(() => inView(id), { timeout: 5_000 }).toBe(true);
    }
  });

  it("결과 화면의 규칙 id 를 누르면 그 정책 쪽의 그 규칙 줄로 가고, 처음에는 접혀 있던 그 줄이 펼쳐져 보인다", async () => {
    const { page } = await open(ANALYSIS_MANY_RULES, { viewport: { width: 1280, height: 720 } });
    const ruleLinks = page.locator(".report a[href*='#rule-']");
    const links = await ruleLinks.evaluateAll((all) => all.map((a) => a.getAttribute("href")!));
    expect(links.length).toBeGreaterThan(0);
    // 그 정책의 첫 규칙이 아닌 규칙으로 가는 링크를 고른다(첫 규칙은 처음부터 펼쳐져 있다).
    const targets = links.flatMap((href, nth) => {
      const [pathname, id] = href.split("#");
      const policy = policies.find((entry) => policyHref(entry.id) === pathname);
      const index = policy?.rules.findIndex((rule) => ruleAnchor(rule.id!) === id) ?? -1;
      return policy && index > 0 ? [{ href, id, policy, nth }] : [];
    });
    if (targets.length === 0) throw new Error(`${ANALYSIS_MANY_RULES}: 첫 규칙이 아닌 규칙으로 가는 링크가 없습니다. 이 시험이 볼 것이 없습니다.`);
    const [{ href, id, policy, nth }] = targets;
    const rowState = (target: string) =>
      page.evaluate((anchor) => {
        const row = document.getElementById(anchor) as HTMLDetailsElement | null;
        if (!row) return null;
        const top = row.getBoundingClientRect().top;
        return { open: row.open, inView: top >= 0 && top < window.innerHeight / 2 };
      }, target);
    // 주소에 자리가 없으면 그 줄은 접혀 있다(빌드된 HTML 그대로).
    const plainPage = await open(policyHref(policy.id), { viewport: { width: 1280, height: 720 } });
    await shown(plainPage.page, policy.title);
    expect(await plainPage.page.evaluate((anchor) => (document.getElementById(anchor) as HTMLDetailsElement).open, id)).toBe(false);

    // 링크가 접힌 발견 안에 있으면 사람이 하듯 그 발견을 펼친 뒤 누른다.
    await ruleLinks.nth(nth).evaluate((a) => {
      for (let node = a.parentElement; node; node = node.parentElement) if (node instanceof HTMLDetailsElement) node.open = true;
    });
    await ruleLinks.nth(nth).click();
    await page.waitForURL(`**${href}`);
    await shown(page, policy.title);
    await expect.poll(() => rowState(id)).toEqual({ open: true, inView: true });

    // 주소로 바로 열어도 같다(쪽을 처음 받을 때). 규칙이 여럿인 정책의 마지막 규칙(처음에는 접혀 있다).
    const many = pick("규칙이 둘 이상인", (entry) => entry.rules.length >= 2);
    const last = ruleAnchor(many.rules.at(-1)!.id!);
    await page.goto(`${site.origin}${policyHref(many.id)}`, { waitUntil: "load" });
    await shown(page, many.title);
    expect(await page.evaluate((anchor) => (document.getElementById(anchor) as HTMLDetailsElement).open, last)).toBe(false);
    await page.goto(`${site.origin}${policyHref(many.id)}#${last}`, { waitUntil: "load" });
    await expect.poll(() => rowState(last)).toEqual({ open: true, inView: true });
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
    expect(loading.some((url) => url.startsWith("/demo/"))).toBe(true);
    expect(loading.some((url) => url.startsWith(policyHref(policies[0].id)))).toBe(true);

    let hovered = 0;
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "networkidle" });
      await shown(page, policy.title);
      await settle(site, page);
      const mark = { server: site.requests.length, browser: seen.length };

      // 접어 둔 것을 하나씩 눌러 펼친다(조문, 해시, 규칙 읽는 법, 규칙, 판정자에게 묻는 글). 늘 맨 앞의 닫힌 것을 누른다.
      const closed = page.locator("main details:not([open]) > summary");
      for (let left = await closed.count(); left > 0; left = await closed.count()) await closed.first().click();
      expect(await page.locator("main details:not([open])").count(), policy.id).toBe(0);
      await scrollThrough(page, 30);
      // 바로가기를 누른다(쪽 안에서 옮겨 간다). 법제처 링크에는 마우스를 올리기만 한다.
      for (const link of await page.locator(".jump a").all()) await link.click();
      const links = page.locator(".lg-item > a.ext");
      expect(await links.count(), policy.id).toBe(policy.legal.filter((legal) => legal.url).length);
      for (const link of await links.all()) {
        await link.hover();
        hovered += 1;
      }
      await settle(site, page);

      expect(site.requests.slice(mark.server), policy.id).toEqual([]);
      expect(seen.slice(mark.browser), policy.id).toEqual([]);
    }
    expect(hovered).toBeGreaterThan(0);
    expect(outside).toEqual([]);

    expect(await stored(page)).toEqual(NO_STORAGE);
  });

  it("법제처 링크는 눌러야 나간다: 누르면 새 창이 팩 메타데이터의 주소로 가려 하고, 어느 쪽에서 왔는지는 싣지 않는다", async () => {
    const policy = pick("첫 조문에 법제처 링크가 있는", (entry) => Boolean(entry.legal[0]?.url));
    const [legal] = policy.legal;
    const { context, page, outside } = await open(policyHref(policy.id));
    const requests: Request[] = [];
    context.on("request", (request) => requests.push(request));
    const link = page.locator(".lg-item > a.ext").first();
    expect(await link.getAttribute("href")).toBe(legal.url);
    expect(await link.getAttribute("target")).toBe("_blank");
    expect(await link.getAttribute("rel")).toBe("noopener noreferrer");
    // 화면 낭독기에는 어느 조문의 링크인지와 새 창이라는 것이 함께 읽힌다. 눈에는 "법제처 원문"만 보인다.
    expect(await page.getByRole("link", { name: `${legal.label} 법제처 원문 (새 창)`, exact: true }).first().getAttribute("href")).toBe(legal.url);
    expect((await shownNames(page, ".lg-item > a.ext"))[0]).toBe("법제처 원문");
    expect(outside).toEqual([]);

    const [popup] = await Promise.all([context.waitForEvent("page"), link.click()]);
    const wanted = new URL(legal.url!).href;
    await expect.poll(() => outside.length, { timeout: 5_000 }).toBeGreaterThan(0);
    // 가로채기가 막은 새 창의 오류 쪽을 Chrome 이 1초쯤 뒤에 스스로 다시 읽는다(오류 쪽 자동 다시 읽기. 부하가 없어도 4초 안에
    // 두 번 적힌다). 그래서 적힌 횟수가 아니라, 적힌 것이 모두 그 주소이고 모두 새 창이 옮겨 가려는 요청인지를 본다.
    expect(new Set(outside)).toEqual(new Set([wanted]));
    const sent = requests.filter((entry) => !entry.url().startsWith(`${site.origin}/`));
    expect(sent.length).toBeGreaterThan(0);
    for (const request of sent) {
      expect(request.url()).toBe(wanted);
      expect(request.isNavigationRequest()).toBe(true);
      expect(request.frame().page()).toBe(popup);
      expect(Object.keys(await request.allHeaders())).not.toContain("referer");
    }
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    expect(new Set(outside)).toEqual(new Set([wanted]));
    expect(page.url()).toBe(`${site.origin}${policyHref(policy.id)}`);
    expect(await page.locator("article.policy-page h1").innerText()).toBe(policy.title);
  });

  it("시험용 Chrome 은 127.0.0.1 밖의 이름을 풀지 못한다 (링크를 눌러도 그 서버로 연결이 생기지 않는다)", async () => {
    // 위 시험의 가로채기는 HTTP 요청만 막는다. 새 창이 옮겨 가기 시작할 때 그 출처로 여는 연결은 Chrome 을 띄울 때의 옵션이
    // 막는다(site.ts 의 NO_OUTSIDE_NAMES). 그 옵션이 듣는지를 이 컴퓨터를 가리키는 다른 이름(localhost)으로 본다.
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
    expect(await reach("127.0.0.1")).toBe("닿음");
    expect(await reach("localhost")).toBe("닿지 않음");
    await expect.poll(() => problems.length, { timeout: 3_000 }).toBeGreaterThan(0);
    expect(problems.splice(0)).toEqual(["콘솔: Failed to load resource: net::ERR_NAME_NOT_RESOLVED"]);
  });
});

describe("화면 낭독기에 읽히는 이름 (Chrome 의 접근성 트리)", () => {
  it("법제처 링크와 되풀이되는 접어 둔 것(해시, 판정자에게 묻는 글)의 이름이 서로 다르다. 어느 조문·규칙·대안의 것인지가 앞에 함께 읽힌다", async () => {
    const { context, page } = await open(INDEX, { viewport: { width: 375, height: 667 } });
    for (const policy of policies) {
      await page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "load" });
      await shown(page, policy.title);
      const want = expectedPolicyPage(policy, pack);
      // 닫힌 details 안의 것은 접근성 트리에 없다. 모두 펼친 채로 읽는다.
      await openAll(page);
      const links = await accessibleNames(context, page, "article.policy-page .lg-item > a.ext");
      expect(links, policy.id).toEqual(want.legal.flatMap((legal) => (legal.link ? `${legal.link.whose} ${legal.link.text} ${legal.link.newWindow}` : [])));
      expect(new Set(links).size, policy.id).toBe(links.length);
      const hashes = await accessibleNames(context, page, "article.policy-page details.hash > summary");
      expect(hashes, policy.id).toEqual(want.legal.flatMap((legal) => (legal.hash ? `${legal.hash.whose} ${legal.hash.short}` : [])));
      const asked = await accessibleNames(context, page, "article.policy-page .rule-body .fold > summary");
      const folds = want.rules.flatMap((rule) => [rule.applies ?? [], ...rule.alternatives.map((alt) => alt.asked ?? [])].flat());
      expect(asked, policy.id).toEqual(folds.map((fold) => `${fold.whose} ${fold.summary}`));
      expect(new Set([...hashes, ...asked]).size, policy.id).toBe(hashes.length + asked.length);
      // 조문의 이름 줄은 조문 이름과 표시를 띄어 읽는다(붙어 읽히지 않는다).
      const legal = await accessibleNames(context, page, "article.policy-page details.lg > summary");
      expect(legal, policy.id).toEqual(want.legal.map((entry) => [entry.label, entry.tag, entry.sameText].filter(Boolean).join(" ")));
      // 규칙 줄은 규칙마다 이름이 다르다(규칙 id 가 들어 있다).
      const rules = await accessibleNames(context, page, "article.policy-page details.rule-row > summary");
      expect(rules.length, policy.id).toBe(policy.rules.length);
      for (const [i, rule] of policy.rules.entries()) expect(rules[i], `${policy.id} ${rule.id}`).toContain(rule.id!);
      // 앞말과 "(새 창)"은 눈에 보이지 않는다(1px 로 잘려 있다).
      const hidden = await page.locator("article.policy-page .visually-hidden").evaluateAll((all) =>
        all.map((el) => Math.max(el.getBoundingClientRect().width, el.getBoundingClientRect().height)),
      );
      expect(hidden.every((size) => size <= 1), policy.id).toBe(true);
    }
  });
});

describe("원문 해시가 맞지 않을 때의 꾸밈 (팩에 없는 모양이라 열린 쪽에 넣어 본다)", () => {
  it.each(["light", "dark"] as const)("%s: 곁칸과 조문의 경고 값, 원문 위의 알림이 바탕 위에서 읽힌다 (명도 대비 4.5:1 이상)", async (scheme) => {
    // 팩의 조문은 해시가 모두 맞아서 빌드된 쪽에는 이 꾸밈이 쓰이지 않는다. 부품(PolicyDetail)이 그 모양으로 그리는 첫 조문과
    // 곁칸을 Node 에서 그려 열린 쪽에 넣고, 브라우저가 계산한 색을 잰다(소스와 빌드는 그대로다).
    const policy = pick("원문이 실린 조문이 둘 이상인", (entry) => entry.legal.length >= 2 && Boolean(entry.legal[0]?.text));
    const { page } = await open(policyHref(policy.id), { viewport: { width: 375, height: 667 }, colorScheme: scheme });
    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(scheme === "dark");
    const markup = legalBlockMarkup(policy, pack, { text_sha256_matches: false });
    expect(markup.legal).toContain('<dd class="warn">');
    expect(markup.legal).toContain('<p class="notice notice-warn">');
    expect(markup.side).toContain('<dd class="warn">');
    expect(await page.locator("article.policy-page dd.warn, article.policy-page .notice-warn").count()).toBe(0);
    await page.locator(".lg-item").first().evaluate((el, html) => {
      el.outerHTML = html;
    }, markup.legal);
    await page.locator(".policy-side").evaluate((el, html) => {
      el.outerHTML = html;
    }, markup.side);
    const colors = await page.evaluate(() => {
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
      return { legal: of(".lg-facts dd.warn"), side: of(".side-facts dd.warn"), notice: of(".lg-body > .notice-warn"), plain: of(".side-facts dd:not(.warn)") };
    });
    expect(colors.legal.text).toBe("팩에 적힌 것과 다름");
    // 조문마다 결과가 다르면 곁칸은 맞지 않는 것의 수를 말로 적는다(색만으로 알리지 않는다).
    expect(colors.side.text).toBe(`${policy.legal.length}개 가운데 1개 팩에 적힌 것과 다름`);
    expect(colors.notice.text).toBe("아래 원문은 팩에 적힌 해시와 맞지 않습니다.");
    for (const [what, entry] of [["조문의 해시 대조", colors.legal], ["곁칸의 원문 해시", colors.side], ["원문 위의 알림", colors.notice]] as const) {
      expect(contrast(entry.color, entry.background), `${what}: ${entry.color} / ${entry.background}`).toBeGreaterThanOrEqual(4.5);
    }
    expect([colors.side.color, colors.side.weight]).not.toEqual([colors.plain.color, colors.plain.weight]);
    expect((await undrawn(page)).undrawn).toEqual([]);
  });
});

describe("키보드만으로", () => {
  it("바로가기, 조문의 이름 줄과 법제처 링크, 규칙 읽는 법에 Tab 으로 차례로 닿고, Enter·Space 로 여닫는다", async () => {
    const policy = pick("원문과 법제처 링크가 있는 조문이 둘 이상인", (entry) => entry.legal.length >= 2 && entry.legal.every((legal) => legal.text && legal.url && legal.text_sha256));
    const { page } = await open(policyHref(policy.id), { viewport: { width: 375, height: 667 } });
    const focused = () =>
      page.evaluate(() => {
        const el = document.activeElement!;
        if (el.tagName === "SUMMARY") return `접는 줄: ${el.parentElement!.className}`;
        if (el.closest(".lg-item") && el.tagName === "A") return "법제처 링크";
        if (el.closest(".jump")) return "바로가기";
        return el.tagName.toLowerCase();
      });
    // 머리(이름, 검색 단추, 펼치는 메뉴)를 지나, 바로가기 둘, 조문마다 이름 줄 → (펼친 대표 조문은 해시) → 법제처 링크, 그다음
    // 규칙 읽는 법 차례다.
    const order: string[] = [];
    const steps = 3 + 2 + policy.legal.length * 2 + 1 + 1;
    for (let i = 0; i < steps; i++) {
      await page.keyboard.press("Tab");
      order.push(await focused());
    }
    expect(order).toEqual([
      "a",
      "a",
      "접는 줄: menu",
      "바로가기",
      "바로가기",
      ...policy.legal.flatMap((_, i) => (i === 0 ? ["접는 줄: lg", "접는 줄: hash", "법제처 링크"] : ["접는 줄: lg", "법제처 링크"])),
      "접는 줄: legend-fold",
    ]);
    expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe("solid");

    // 규칙 읽는 법: Enter 로 펼치고 Space 로 접는다. 펼치면 약한 대안의 뜻이 보인다.
    const legend = page.locator("details.legend-fold");
    const weak = legend.locator("li", { hasText: "정적 · 약한" });
    expect(await weak.isVisible()).toBe(false);
    await page.keyboard.press("Enter");
    expect(await legend.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
    expect(await weak.isVisible()).toBe(true);
    await page.keyboard.press("Space");
    expect(await legend.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);

    // 접혀 있던 둘째 조문의 원문도 키보드로 펼친다.
    const second = page.locator(".lg-item").nth(1);
    expect(await second.locator("pre.statute").isVisible()).toBe(false);
    await second.locator("details.lg > summary").focus();
    await page.keyboard.press("Enter");
    expect(await second.locator("pre.statute").isVisible()).toBe(true);
    expect(await second.locator("pre.statute").innerText()).toBe(policy.legal[1].text);
    // 판정자를 켜면 코드가 밖으로 나간다는 말은 접혀 있지 않다. 펼치지 않아도 보인다.
    if (policy.rules.some((rule) => rule.alternatives.some((alt) => alt.kind === "ai") || rule.applies_question)) {
      expect(await page.locator(".policy-section > .judge-note").innerText()).toContain(CODE_LEAVES);
    }
  });
});
