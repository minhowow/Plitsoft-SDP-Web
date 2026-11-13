import type { Browser, BrowserContext } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { caseChecklistHref, caseChecklistMarkdownHref, casesFile, casesHref } from "@/lib/cases";
import { evalFile } from "@/lib/cases/eval";
import { TRACE } from "@/lib/how/figures";
import { analysisHref, checklistHref, checklistMarkdownHref } from "@/lib/service/href";
import { SITE } from "@/lib/site";
import { closeChrome, launchChrome, NO_STORAGE, openPage, overflow, serveSite, stored, textContrast, type Site } from "./site";

// 2026-11-13 오너 지시의 세 가지를 빌드된 사이트에서 Chrome 으로 연다.
// - 첫 화면: 검색창 아래 공개 사례 한 건이 지나는 길과 체크리스트 일부(미리 돌린 결과라는 것과 함께).
// - 사례 쪽: 공개 저장소 41곳 평가 구역(성격별 숫자만).
// - 의무 체크리스트 내보내기: 결과 쪽의 링크 둘, 마크다운 파일(같은 사이트의 /api/), 인쇄용 보기(인쇄하면 종이만).

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

const open = (pathname: string, width: number, colorScheme: "light" | "dark" = "light") =>
  openPage(browser, site, pathname, { viewport: { width, height: 900 }, colorScheme, contexts, problems });

/** 합성 미리보기에서 review 결과가 있는 끝난 분석(생성형 AI 채팅 합성 저장소). */
const REVIEWED = { owner: "example-studio", name: "genai-chat", id: "4qqa6fdx2h" };

describe("첫 화면의 사례 한 건", () => {
  it.each([
    [1280, "light"],
    [375, "dark"],
  ] as const)("%dpx %s: 저장소 → 기능 파악 → 의무 고르기 → 코드에서 본 것, 체크리스트 일부, 미리 돌린 결과", async (width, scheme) => {
    const { page, outside } = await open("/", width, scheme);
    const section = page.locator(".home-case");
    expect(await section.isVisible()).toBe(true);
    expect(await section.locator(".hc-k").allTextContents()).toEqual(["저장소", "기능 파악", "의무 고르기", "코드에서 본 것"]);
    expect(await section.locator(".cite-text").count()).toBe(1);
    expect(await section.locator(".hc-items > li").count()).toBe(3);
    expect(await section.locator(".home-all").getAttribute("href")).toBe(casesHref(TRACE.slug));
    const src = (await section.locator(".hc-src").textContent()) ?? "";
    expect(src).toContain(SITE.cases.prerun);
    expect(src).toContain(SITE.cases.regate);
    // 검색창 바로 아래, 최근 분석 위.
    expect(await page.locator(".home > *").evaluateAll((els) => els.map((el) => el.className))).toEqual(
      expect.arrayContaining(["home-case", "home-feed"]),
    );
    const order = await page.locator(".home").evaluate((home) => [...home.children].map((el) => el.className.split(" ")[0]));
    expect(order.indexOf("home-case")).toBeLessThan(order.indexOf("home-feed"));
    expect(await overflow(page)).toMatchObject({ page: 0, over: [] });
    expect((await textContrast(page, { root: ".home-case" })).low).toEqual([]);
    expect(outside).toEqual([]);
    expect(await stored(page)).toEqual(NO_STORAGE);
  });
});

describe("사례 쪽의 41곳 평가", () => {
  it.each([1280, 375])("%dpx: 큰 숫자, 성격별 표(합계 줄), 알려진 한계(접힘). 저장소 링크 없음. 좁은 화면에서는 표만 상자 안에서 민다", async (width) => {
    const { page, outside } = await open(casesHref(), width);
    const section = page.locator(".cases-eval");
    expect(await section.locator("h2").textContent()).toBe(`공개 저장소 ${evalFile.total.repos}곳에서 돌려 본 결과`);
    expect(await section.locator("tbody tr").count()).toBe(evalFile.categories.length);
    expect(await section.locator("tfoot th").textContent()).toBe("합계");
    expect(await section.locator("a").count()).toBe(0);
    expect(await section.locator("details.eval-limits").evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    expect(await overflow(page, ".box-scroll")).toMatchObject({ page: 0, over: [] });
    expect(outside).toEqual([]);
  });
});

describe("의무 체크리스트 내보내기", () => {
  it("사례 쪽: 체크리스트 머리 아래의 링크 둘, 마크다운 파일은 받기로 내려온다", async () => {
    const slug = casesFile.cases[0].slug;
    const { page, outside } = await open(casesHref(slug), 1280);
    const links = page.locator(".rv-export a");
    expect(await links.evaluateAll((as) => as.map((a) => [a.getAttribute("href"), a.hasAttribute("download")]))).toEqual([
      [caseChecklistMarkdownHref(slug), true],
      [caseChecklistHref(slug), false],
    ]);
    const response = await fetch(`${site.origin}${caseChecklistMarkdownHref(slug)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="checklist-[A-Za-z0-9._-]+\.md"$/);
    const text = await response.text();
    expect(text).toContain(SITE.record.lead);
    expect(text).toContain(SITE.cases.prerun);
    // 받기를 누르면 파일이 내려온다(같은 사이트의 /api/).
    const [download] = await Promise.all([page.waitForEvent("download"), links.first().click()]);
    expect(download.suggestedFilename()).toMatch(/^checklist-.+\.md$/);
    expect(outside).toEqual([]);
  });

  it.each(["light", "dark"] as const)("사례의 인쇄용 보기(%s): 종이에 모든 갈래가 펼쳐져 있고, 인쇄하면 머리글·도구 줄 없이 종이만 흰 바탕에 나온다", async (scheme) => {
    const c = casesFile.cases.find((x) => x.slug === TRACE.slug)!;
    const { page, outside } = await open(caseChecklistHref(c.slug), 375, scheme);
    expect(await page.locator(".ck-sheet h1").textContent()).toBe(`의무 체크리스트 · ${c.owner}/${c.name}`);
    expect(await page.locator(".ck-sheet details").count()).toBe(0);
    expect(await page.locator(".ck-group h2").count()).toBeGreaterThan(2);
    expect(await page.locator(".ck-tools a").first().getAttribute("href")).toBe(casesHref(c.slug));
    expect(await overflow(page)).toMatchObject({ page: 0, over: [] });
    expect((await textContrast(page, { root: "main" })).low).toEqual([]);
    await page.emulateMedia({ media: "print" });
    expect(await page.locator(".site-header").isVisible()).toBe(false);
    expect(await page.locator(".ck-tools").isVisible()).toBe(false);
    expect(await page.locator(".ck-sheet").isVisible()).toBe(true);
    expect(await page.locator(".ck-sheet").evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color])).toEqual([
      "rgb(255, 255, 255)",
      "rgb(0, 0, 0)",
    ]);
    expect(outside).toEqual([]);
    expect(await stored(page)).toEqual(NO_STORAGE);
  });

  it("분석 쪽(합성 예시의 review 결과): 링크 둘, 인쇄용 보기, 마크다운 파일. review 가 없는 분석의 인쇄용 보기는 없다", async () => {
    const { page, outside } = await open(analysisHref(REVIEWED.owner, REVIEWED.name, REVIEWED.id), 1280);
    expect(await page.locator(".rv-export a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).toEqual([
      checklistMarkdownHref(REVIEWED.id),
      checklistHref(REVIEWED.owner, REVIEWED.name, REVIEWED.id),
    ]);
    await page.locator(".rv-export a", { hasText: "인쇄용 보기" }).click();
    await page.waitForURL(`${site.origin}${checklistHref(REVIEWED.owner, REVIEWED.name, REVIEWED.id)}`);
    await page.locator(".ck-sheet").waitFor();
    expect(await page.locator(".ck-facts").textContent()).toContain("합성 예시");
    const md = await fetch(`${site.origin}${checklistMarkdownHref(REVIEWED.id)}`);
    expect(md.status).toBe(200);
    expect(await md.text()).toContain("# 의무 체크리스트 · example-studio/genai-chat");
    expect((await fetch(`${site.origin}${checklistHref("example-org", "kids-signup", "wtk33e9zuf")}`)).status).toBe(404);
    expect((await fetch(`${site.origin}${checklistMarkdownHref("wtk33e9zuf")}`)).status).toBe(404);
    expect(outside).toEqual([]);
  });
});
