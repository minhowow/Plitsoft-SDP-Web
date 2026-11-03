import type { Browser, BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { store } from "@/lib/service";
import { analysisHref, repoHref } from "@/lib/service/href";
import type { Analysis } from "@/lib/service/types";
import { SITE } from "@/lib/site";
import { closeChrome, launchChrome, NO_STORAGE, openPage, overflow, serveOut, stored, type Site } from "./site";

// 분석 서비스(방향 B, B1)의 다섯 쪽을 빌드된 out/ 에서 연다: 첫 화면, 검색, 저장소, 분석(진행 중·실패·끝남).
// 검색이 거르는지, 저장소에서 분석으로 옮겨 가는지, 세 상태가 그려지는지, 375·1280px 의 두 테마에서 넘치지 않는지,
// 밖으로 나가는 요청과 브라우저 저장소가 없는지 본다. 명도 대비는 tests/browser/colors.test.ts 가 본다.

let site: Site;
let browser: Browser;
const contexts: BrowserContext[] = [];
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

afterAll(async () => {
  await closeChrome(browser);
  await site?.close();
});

const open = (pathname: string, width = 375, colorScheme: "light" | "dark" = "light") =>
  openPage(browser, site, pathname, { viewport: { width, height: 800 }, colorScheme, contexts, problems });

const hits = await store.listRepositories();
const analyses: Analysis[] = (await Promise.all(hits.map(({ repository: r }) => store.listAnalyses(r.owner, r.name)))).flat();
const byStatus = (status: Analysis["status"]) => analyses.find((a) => a.status === status)!;
const hrefOf = (a: Analysis) => analysisHref(a.owner, a.name, a.id);

/** 이 쪽들 모두: 첫 화면, 검색(빈 질의와 질의), 저장소마다, 분석마다. */
const PAGES = [
  "/",
  "/search/",
  "/search/?q=kids",
  ...hits.map(({ repository: r }) => repoHref(r.owner, r.name)),
  ...analyses.map(hrefOf),
];

const rowNames = (page: Page) => page.locator(".repo-row .repo-link").allTextContents();

describe("검색", () => {
  it("주소의 질의로 거르고, 치는 대로 다시 거르며 주소를 바꿔 둔다", async () => {
    const { page } = await open("/search/?q=kids");
    await expect.poll(() => rowNames(page)).toEqual(["example-org / kids-signup"]);
    const input = page.locator("#search-page-q");
    expect(await input.inputValue()).toBe("kids");

    await input.fill("example-labs");
    await expect.poll(() => rowNames(page)).toEqual(["example-labs / plain-utils", "example-labs / shop-front", "example-labs / todo-web"]);
    expect(new URL(page.url()).search).toBe("?q=example-labs");

    await input.fill("no-such-repository");
    expect(await page.locator(".repo-row").count()).toBe(0);
    await expect.poll(() => page.locator(".search-page .notice").textContent()).toContain("맞는 저장소가 없습니다");
    // 검색 쪽에서는 머리글의 검색창을 감춰 검색창이 하나만 보인다.
    expect(await page.locator("#site-q").isVisible()).toBe(false);

    // 빈 질의는 모든 합성 저장소를 늘어놓는다.
    await input.fill("");
    await expect.poll(async () => (await rowNames(page)).length).toBe(hits.length);
  });

  it("머리글의 검색창은 어느 쪽에서든 검색 쪽으로 간다", async () => {
    const { page } = await open(analysisHref("example-org", "kids-signup", "wtk33e9zuf"));
    await page.locator("#site-q").fill("genai");
    await page.locator("#site-q").press("Enter");
    await page.waitForURL(/\/search\/\?q=genai$/);
    await expect.poll(() => rowNames(page)).toEqual(["example-studio / genai-chat"]);
  });
});

describe("저장소 → 분석", () => {
  it("검색 결과에서 저장소로, 저장소의 분석 목록에서 진행 중인 분석과 끝난 분석으로 옮겨 간다", async () => {
    const { page, outside } = await open("/search/?q=night-push");
    await page.locator(".repo-link").first().click();
    await page.waitForURL(`${site.origin}${repoHref("example-org", "night-push")}`);
    expect(await page.locator("h1").textContent()).toBe("example-org / night-push");
    // 분석 요청 단추는 듣지 않는다고 알리고(aria-disabled), 키보드로 닿아 까닭을 듣는다.
    await expect.poll(() => page.locator(".request button").getAttribute("aria-disabled")).toBe("true");
    await page.locator(".request button").focus();
    expect(await page.evaluate(() => document.activeElement?.closest(".request") !== null)).toBe(true);
    expect(await page.locator("#request-off").textContent()).toBe(SITE.service.noServer);

    const running = byStatus("running");
    await page.locator(".an-list").getByRole("link", { name: running.id }).click();
    await page.waitForURL(`${site.origin}${hrefOf(running)}`);
    await page.waitForSelector(".steps [aria-current=step]");
    expect(await page.locator(".badge").first().textContent()).toBe("분석 중");

    await page.goBack();
    await page.locator(".an-list").getByRole("link", { name: "64y4jdtazh" }).click();
    await page.waitForURL(`${site.origin}${analysisHref("example-org", "night-push", "64y4jdtazh")}`);
    await page.waitForSelector(".dash");
    expect(outside).toEqual([]);
  });
});

describe("분석 쪽의 세 상태", () => {
  it("진행 중: 단계별 진행과 지금의 단계", async () => {
    const { page } = await open(hrefOf(byStatus("running")));
    expect(await page.locator(".step-item").count()).toBe(5);
    expect(await page.locator(".step-active .step-name").allTextContents()).toEqual(["AI 판정"]);
    expect(await page.locator(".dash").count()).toBe(0);
    expect(await page.locator("main").textContent()).toContain("합성 예시");
  });

  it("대기: 대기 단계가 진행 중이다", async () => {
    const { page } = await open(hrefOf(byStatus("queued")));
    expect(await page.locator(".step-active .step-name").allTextContents()).toEqual(["대기"]);
  });

  it("실패: 멈춘 단계와 까닭", async () => {
    const failed = byStatus("failed");
    const { page } = await open(hrefOf(failed));
    expect(await page.locator(".notice-warn").textContent()).toContain(failed.failure!.reason);
    expect(await page.locator(".step-failed .step-name").allTextContents()).toEqual(["저장소 받기"]);
    expect(await page.locator(".dash").count()).toBe(0);
  });

  it("끝남: 대시보드(요약 → 카드로 옮겨 가기), 그리고 조문별 검사 기록", async () => {
    const { page } = await open(analysisHref("example-org", "kids-signup", "wtk33e9zuf"), 1280);
    expect(await page.locator(".tile").count()).toBe(6);
    // 넓은 화면에서 정책별 요약은 오른쪽 칸이다.
    const side = await page.locator(".dash-side").boundingBox();
    const main = await page.locator(".dash-main").boundingBox();
    expect(side!.x).toBeGreaterThan(main!.x + main!.width - 1);
    await page.locator(".ov-title").first().click();
    expect(new URL(page.url()).hash).toBe("#policy-kr-pipa-22-2");
    await page.getByRole("group", { name: "결과와 검사 기록 고르기" }).getByRole("button", { name: SITE.record.title }).click();
    await page.waitForSelector(".record");
    expect(await page.locator(".record").textContent()).toContain("example-org/kids-signup · 분석 wtk33e9zuf");
    expect(await page.locator(".dash").isVisible()).toBe(false);
  });

  it("발견이 0인 분석: 0의 뜻을 함께 보인다", async () => {
    const { page } = await open(analysisHref("example-labs", "plain-utils", "w7bc479x2u"));
    expect(await page.locator(".dash").textContent()).toContain(SITE.zeroIsNotClearance);
  });
});

describe("너비·테마·요청", () => {
  it.each([375, 1280])("%ipx: 모든 쪽이 두 테마에서 가로로 넘치지 않고, 밖으로 나가는 요청과 브라우저 저장소가 없다", async (width) => {
    const fits: string[] = [];
    for (const scheme of ["light", "dark"] as const) {
      const { page, outside } = await open(PAGES[0], width, scheme);
      for (const pathname of PAGES) {
        if (pathname !== PAGES[0]) await page.goto(`${site.origin}${pathname}`, { waitUntil: "networkidle" });
        await page.evaluate(() => {
          for (const details of document.querySelectorAll("details")) details.open = true;
        });
        const measured = await overflow(page);
        if (measured.page !== 0 || measured.over.length > 0) fits.push(`${scheme} ${pathname}: ${JSON.stringify(measured)}`);
      }
      expect(outside, scheme).toEqual([]);
      expect(await stored(page), scheme).toEqual(NO_STORAGE);
    }
    expect(fits).toEqual([]);
  });
});
