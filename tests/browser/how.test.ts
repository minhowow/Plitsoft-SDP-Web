import type { Browser, BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FIGURES } from "@/lib/how/figures";
import { closeChrome, contrast, launchChrome, NO_STORAGE, openPage, overflow, serveSite, stored, textContrast, type Site } from "./site";

// 구조 쪽(/how/, 2026-11-13 오너 지시). 빌드된 사이트를 Chrome 으로 연다.
// - 1100px 부터: 그림 셋이 SVG 로 보이고(글은 그림 자료 그대로), 같은 내용의 목록은 화면 낭독기에만 읽힌다. SVG 의 글은 제 뒤의
//   네모 바탕과 4.5:1 이상이다(두 테마).
// - 좁은 화면: 그림 대신 목록이 보이고, 쪽이 가로로 넘치지 않는다. 글의 대비를 잰다(두 테마).
// - 머리글의 '구조'가 지금 쪽으로 표시된다. 밖으로 나가는 요청과 브라우저 저장소가 없다.

let site: Site;
let browser: Browser;
const contexts: BrowserContext[] = [];
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

afterAll(async () => {
  await closeChrome(browser);
  await site?.close();
});

const open = (width: number, colorScheme: "light" | "dark") =>
  openPage(browser, site, "/how/", { viewport: { width, height: 900 }, colorScheme, contexts, problems });

/** SVG 의 글마다 칠한 색과, 그 글의 가운데를 덮는 네모 가운데 맨 위의 것(없으면 그림 상자의 바탕)의 칠한 색의 대비. */
const svgContrast = (page: Page) =>
  page.evaluate(() => {
    const out: { text: string; color: string; background: string }[] = [];
    for (const svg of document.querySelectorAll<SVGSVGElement>("svg.hw-svg")) {
      const base = getComputedStyle(svg.closest(".hw-wide")!).backgroundColor;
      const rects = [...svg.querySelectorAll("rect")].map((rect) => ({ box: rect.getBBox(), fill: getComputedStyle(rect).fill }));
      for (const text of svg.querySelectorAll("text")) {
        const b = text.getBBox();
        const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2];
        const under = rects.filter((r) => cx >= r.box.x && cx <= r.box.x + r.box.width && cy >= r.box.y && cy <= r.box.y + r.box.height).at(-1);
        out.push({ text: text.textContent ?? "", color: getComputedStyle(text).fill, background: under?.fill ?? base });
      }
    }
    return out;
  });

describe("구조 쪽", () => {
  it.each(["light", "dark"] as const)("%s 1280px: 그림 셋이 SVG 로 보이고 목록은 화면 낭독기에만 읽힌다. 머리글이 지금 쪽을 표시한다", async (scheme) => {
    const { page, outside } = await open(1280, scheme);
    expect(await page.locator("main h2").allTextContents()).toEqual(FIGURES.map((figure, i) => `${i + 1}. ${figure.title}`));
    expect(await page.locator(".hw-wide svg").count()).toBe(3);
    for (const wide of await page.locator(".hw-wide").all()) expect(await wide.isVisible()).toBe(true);
    // 목록은 1px 로 자른 상자 안에 있다(화면에는 보이지 않고 낭독기에는 읽힌다). 그림은 낭독기에 감춘다.
    for (const list of await page.locator(".hw-list").all()) {
      const box = (await list.boundingBox())!;
      expect(box.width * box.height).toBeLessThanOrEqual(1);
    }
    expect(await page.locator(".hw-wide[aria-hidden=true]").count()).toBe(3);
    // 그림의 글은 그림 자료 그대로다.
    const drawn = await page.locator(".hw-wide svg").evaluateAll((svgs) => svgs.map((svg) => [...svg.querySelectorAll("text")].map((t) => t.textContent)));
    expect(drawn).toEqual(FIGURES.map((figure) => figure.shapes.flatMap((shape) => (shape.kind === "text" ? [shape.text] : []))));
    // 글은 제 뒤의 바탕과 4.5:1 이상이다.
    const low = (await svgContrast(page)).filter((t) => contrast(t.color, t.background) < 4.5);
    expect(low).toEqual([]);
    expect(await overflow(page, ".hw-list")).toMatchObject({ page: 0, over: [] });
    expect(await page.locator(".site-header .hdr-nav a[aria-current=page]").getAttribute("href")).toBe("/how/");
    expect(await page.locator(".site-header .hdr-nav a[href='/how/']").evaluate((a) => getComputedStyle(a).fontWeight)).toBe("600");
    expect(outside).toEqual([]);
    expect(await stored(page)).toEqual(NO_STORAGE);
  });

  it.each(["light", "dark"] as const)("%s 375px: 그림 대신 같은 내용의 목록이 보이고, 쪽이 넘치지 않으며 글의 대비가 4.5:1 이상이다", async (scheme) => {
    const { page, outside } = await open(375, scheme);
    for (const wide of await page.locator(".hw-wide").all()) expect(await wide.isVisible()).toBe(false);
    for (const list of await page.locator(".hw-list").all()) expect(await list.isVisible()).toBe(true);
    // 목록의 상자 수는 그림 자료의 목록 그대로다.
    expect(await page.locator(".hw-item").count()).toBe(FIGURES.flatMap((figure) => figure.list.flatMap((section) => section.items)).length);
    expect(await overflow(page)).toMatchObject({ page: 0, over: [] });
    const scan = await textContrast(page, { root: "main" });
    expect(scan.low).toEqual([]);
    expect(outside).toEqual([]);
  });
});
