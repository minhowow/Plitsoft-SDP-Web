import type { Browser, BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeChrome, launchChrome, NO_STORAGE, openPage, serveSite, stored, type Site } from "./site";

// 머리글(재디자인 D2, docs/redesign.md 3장 "공통: 머리글과 바닥글"). 빌드된 사이트(합성 저장소)를 Chrome 으로 연다.
// - 390px: 펼치는 메뉴가 열리고, 메뉴의 링크로 옮겨 가면(클라이언트 이동) 닫힌다. 지금 쪽의 링크를 눌러도, Esc 로도 닫힌다.
//   초점이 메뉴 밖으로 나가거나 메뉴 밖을 눌러도 닫혀, 펼친 메뉴가 초점이 간 것을 덮지 않는다(WCAG 2.4.11).
//   그동안 사이트 밖으로 나가는 요청과 브라우저 저장소가 없다.
// - 1280px: 56px 한 줄이고 본문과 왼쪽 끝이 같다. 머리글의 검색창은 본문에 검색창이 없는 쪽에만 보인다. 지금 쪽을 굵게 적고
//   aria-current 로 알린다. 첫 화면에는 머리글이 없다(재디자인 D3). 이름은 검색 쪽(/search/)으로 간다.
// - 메뉴는 최근 분석(질의 없는 /search/), 조문 도감, 데모다(재디자인 D4). 최근 분석은 질의 없는 검색 쪽에서만 지금 쪽이다.
// - "/" 키는 검색창으로 가지 않는다(글자 하나짜리 단축키는 뺐다. docs/ROADMAP.md 의 "사람 결정이 필요한 것").
// 머리글의 HTML 이 모든 쪽에서 같은지는 tests/browser/served-files.test.ts 가 본다.

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

const open = (pathname: string, width: number) => openPage(browser, site, pathname, { viewport: { width, height: 800 }, contexts, problems });

const menuOpen = (page: Page) => page.locator(".site-header details.menu").evaluate((el) => (el as HTMLDetailsElement).open);

describe("390px: 펼치는 메뉴", () => {
  it("메뉴가 열리고, 메뉴의 링크로 옮겨 가면 닫힌다. 밖으로 나가는 요청과 브라우저 저장소가 없다", async () => {
    const { page, outside } = await open("/search/?q=kids", 390);
    // 넓은 화면의 검색창과 메뉴는 감추고, 펼치는 메뉴의 이름이 보인다.
    expect(await page.locator(".site-header .hdr-search").isVisible()).toBe(false);
    expect(await page.locator(".site-header .hdr-nav").isVisible()).toBe(false);
    expect(await page.locator(".site-header .menu > summary").isVisible()).toBe(true);
    expect(await page.locator(".site-header .menu-pop").isVisible()).toBe(false);

    await page.locator(".site-header .menu > summary").click();
    expect(await menuOpen(page)).toBe(true);
    expect(await page.locator(".site-header .menu-pop").isVisible()).toBe(true);
    // 펼친 메뉴는 창 안에 있다(오른쪽 끝에 맞춰 열린다).
    const box = (await page.locator(".site-header .menu-pop").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);

    // 문서에 표시를 남겨 두고 옮겨 간다. 옮긴 뒤에도 남아 있으면 문서를 다시 받지 않은 클라이언트 이동이다.
    await page.evaluate(() => Object.assign(window, { __sameDocument: true }));
    await page.locator(".site-header .menu-pop a", { hasText: "조문 도감" }).click();
    await page.waitForURL(`${site.origin}/policy/`);
    await page.waitForSelector("main h1[data-page=policy]");
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
    // 루트 레이아웃(머리글)은 그대로 남았지만 메뉴는 닫힌다.
    await expect.poll(() => menuOpen(page)).toBe(false);
    expect(await page.locator(".site-header .menu-pop").isVisible()).toBe(false);
    // 지금 쪽(조문 도감)은 굵게 적고 화면 낭독기에도 알린다.
    expect(await page.locator(".site-header .menu-pop a[href='/policy/']").evaluate((el) => getComputedStyle(el).fontWeight)).toBe("600");
    expect(await page.locator(".site-header .menu-pop a[href='/demo/']").evaluate((el) => getComputedStyle(el).fontWeight)).toBe("400");
    expect(await page.locator(".site-header .menu-pop a[href='/policy/']").getAttribute("aria-current")).toBe("page");
    expect(await page.locator(".site-header .menu-pop a[href='/demo/']").getAttribute("aria-current")).toBe(null);

    // 지금 쪽의 링크를 눌러도(주소가 그대로여도) 닫힌다.
    await page.locator(".site-header .menu > summary").click();
    expect(await menuOpen(page)).toBe(true);
    await page.locator(".site-header .menu-pop a", { hasText: "조문 도감" }).click();
    await expect.poll(() => menuOpen(page)).toBe(false);

    // Esc 로 닫으면 초점이 메뉴의 이름으로 돌아간다.
    await page.locator(".site-header .menu > summary").click();
    expect(await menuOpen(page)).toBe(true);
    await page.keyboard.press("Escape");
    expect(await menuOpen(page)).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.closest(".menu") !== null)).toBe(true);

    // 데모로도 옮겨 간다.
    await page.locator(".site-header .menu > summary").click();
    await page.locator(".site-header .menu-pop a", { hasText: "데모" }).click();
    await page.waitForURL(`${site.origin}/demo/`);
    await expect.poll(() => menuOpen(page)).toBe(false);
    expect(await page.locator(".site-header .menu-pop a[href='/demo/']").getAttribute("aria-current")).toBe("page");
    expect(await page.locator(".site-header .menu-pop a[href='/policy/']").getAttribute("aria-current")).toBe(null);

    expect(outside).toEqual([]);
    expect(await stored(page)).toEqual(NO_STORAGE);
  });

  it("초점이 메뉴 밖으로 나가거나 메뉴 밖을 누르면 닫혀, 펼친 메뉴가 본문의 검색창과 단추를 덮지 않는다", async () => {
    // 본문에 검색창이 있는 쪽. 첫 화면은 재디자인 D3 부터 머리글이 없어(메뉴도 없다) 검색 쪽에서 본다.
    const { page, outside } = await open("/search/", 390);
    // 덮였는지: 그 요소 안의 여러 점에서 맨 위에 그려진 것이 그 요소(또는 그 안)인가.
    const covered = (selector: string) =>
      page.locator(selector).evaluate((el) => {
        const box = el.getBoundingClientRect();
        let hidden = 0;
        for (const fx of [0.1, 0.5, 0.9])
          for (const fy of [0.2, 0.5, 0.8]) {
            const top = document.elementFromPoint(box.left + box.width * fx, box.top + box.height * fy);
            if (!top || !el.contains(top)) hidden += 1;
          }
        return hidden;
      });

    // 키보드로 메뉴를 열고 메뉴의 링크 셋(최근 분석, 조문 도감, 데모. 재디자인 D4 에서 하나 늘었다)을 지나 본문으로 간다.
    await page.locator(".site-header .menu > summary").focus();
    await page.keyboard.press("Enter");
    expect(await menuOpen(page)).toBe(true);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    expect(await menuOpen(page)).toBe(true);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest(".site-header") === null)).toBe(true);
    expect(await menuOpen(page)).toBe(false);
    expect(await covered("main [role=search] input")).toBe(0);
    expect(await covered("main [role=search] button")).toBe(0);

    // 메뉴 밖을 누르면 닫힌다.
    await page.locator(".site-header .menu > summary").click();
    expect(await menuOpen(page)).toBe(true);
    // 링크가 아닌 자리(최근 분석 상자의 머리 띠)를 누른다. 검색 쪽은 본문의 줄이 링크라 아무 데나 누르면 쪽을 옮긴다.
    const blank = (await page.locator(".search-home-recent .box-hd").boundingBox())!;
    await page.mouse.click(blank.x + 8, blank.y + blank.height / 2);
    expect(await menuOpen(page)).toBe(false);

    // 본문에 초점이 있을 때의 Esc 는 초점을 옮기지 않는다.
    await page.locator("main [role=search] input").focus();
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.activeElement?.closest("main [role=search]") !== null)).toBe(true);
    expect(outside).toEqual([]);
  });

  it("검색 단추는 검색 쪽으로 가는 링크이고, 본문에 검색창이 있는 쪽에서는 감춘다", async () => {
    const { page } = await open("/policy/", 390);
    const button = page.locator(".site-header .hdr-m-search");
    expect(await button.isVisible()).toBe(true);
    expect(await button.getAttribute("href")).toBe("/search/");
    expect(await button.getAttribute("aria-label")).toBe("저장소 검색");
    await page.goto(`${site.origin}/search/`, { waitUntil: "networkidle" });
    expect(await page.locator(".site-header .hdr-m-search").isVisible()).toBe(false);
  });
});

describe("1280px: 한 줄 머리글", () => {
  it("56px 한 줄이고 본문과 왼쪽 끝이 같다. 검색창은 본문에 검색창이 없는 쪽에만 보이고, 지금 쪽을 표시한다", async () => {
    const { page, outside } = await open("/policy/", 1280);
    const read = () =>
      page.evaluate(() => {
        const header = document.querySelector(".site-header .hdr-in")!.getBoundingClientRect();
        const brand = document.querySelector(".site-header .brand")!.getBoundingClientRect();
        const main = document.querySelector("main.wrap")!;
        const mainLeft = main.getBoundingClientRect().left + parseFloat(getComputedStyle(main).paddingLeft);
        const weight = (href: string) => getComputedStyle(document.querySelector(`.site-header .hdr-nav a[href='${href}']`)!).fontWeight;
        return {
          height: Math.round(header.height),
          brandLeft: Math.round(brand.left),
          mainLeft: Math.round(mainLeft),
          search: document.querySelector(".site-header .hdr-search")!.getClientRects().length > 0,
          menu: document.querySelector(".site-header .hdr-m")!.getClientRects().length > 0,
          recent: weight("/search/"),
          policy: weight("/policy/"),
          demo: weight("/demo/"),
          current: [...document.querySelectorAll(".site-header .hdr-nav a[aria-current=page]")].map((a) => a.getAttribute("href")),
        };
      });
    const policy = await read();
    expect(policy).toEqual({
      height: 56,
      brandLeft: policy.mainLeft,
      mainLeft: policy.mainLeft,
      search: true,
      menu: false,
      recent: "400",
      policy: "600",
      demo: "400",
      current: ["/policy/"],
    });
    // 머리글과 본문은 같은 폭(1280px)이라 1280px 화면에서는 좌우 여백(24px)에서 시작한다.
    expect(policy.mainLeft).toBe(24);

    await page.goto(`${site.origin}/demo/`, { waitUntil: "networkidle" });
    expect(await read()).toMatchObject({ height: 56, search: true, policy: "400", demo: "600", current: ["/demo/"] });

    // 본문에 검색창이 있는 쪽(검색)에서는 머리글의 검색창을 감춘다. 최근 분석은 질의 없는 검색 쪽에서만 지금 쪽이다.
    await page.goto(`${site.origin}/search/`, { waitUntil: "networkidle" });
    expect(await read(), "/search/").toMatchObject({ height: 56, search: false, recent: "600", policy: "400", demo: "400", current: ["/search/"] });
    await page.goto(`${site.origin}/search/?q=kids`, { waitUntil: "networkidle" });
    expect(await read(), "/search/?q=kids").toMatchObject({ height: 56, search: false, recent: "400", policy: "400", demo: "400", current: [] });
    // 경로가 같은 이동(질의 있는 검색 → 최근 분석)에서도 지금 쪽 표시가 따라온다(클라이언트 이동).
    await page.locator(".site-header .hdr-nav a", { hasText: "최근 분석" }).click();
    await page.waitForURL(`${site.origin}/search/`);
    await expect.poll(() => read()).toMatchObject({ recent: "600", current: ["/search/"] });
    // 첫 화면에는 머리글이 없다(재디자인 D3: 표지와 큰 검색창이 그 자리다). HTML 은 그대로이고 CSS 가 감춘다.
    await page.goto(`${site.origin}/`, { waitUntil: "networkidle" });
    expect(await page.locator(".site-header").isVisible()).toBe(false);
    expect(await page.locator(".site-header .brand").getAttribute("href")).toBe("/search/");
    expect(outside).toEqual([]);
  });

  it('"/" 키는 검색창으로 가지 않고, 머리글에 "/" 표시가 없다', async () => {
    const { page } = await open("/policy/", 1280);
    await page.keyboard.press("/");
    expect(await page.evaluate(() => document.activeElement?.id ?? "")).not.toBe("site-q");
    expect(await page.locator(".site-header kbd").count()).toBe(0);
  });
});
