import type { Browser, BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { syntheticRepositories, syntheticStore as store } from "@/lib/service/synthetic";
import { analysisHref, repoHref } from "@/lib/service/href";
import type { Analysis } from "@/lib/service/types";
import { packMeta } from "@/lib/pack";
import { SITE } from "@/lib/site";
import { closeChrome, launchChrome, NO_STORAGE, openPage, overflow, serveSite, stored, type Site } from "./site";

// 분석 서비스(방향 B)의 다섯 쪽을 빌드된 사이트(합성 저장소, SERVICE_STORE=synthetic)에서 연다: 첫 화면, 검색(빈 상태·결과·0건), 저장소,
// 분석(진행 중·실패·끝남).
// 검색이 거르는지, 저장소에서 분석으로 옮겨 가는지, 세 상태가 그려지는지, 375·1280px 의 두 테마에서 넘치지 않는지,
// 밖으로 나가는 요청과 브라우저 저장소가 없는지 본다. 명도 대비는 tests/browser/colors.test.ts 가 본다.

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

const open = (pathname: string, width = 375, colorScheme: "light" | "dark" = "light") =>
  openPage(browser, site, pathname, { viewport: { width, height: 800 }, colorScheme, contexts, problems });

const hits = syntheticRepositories();
const analyses: Analysis[] = (await Promise.all(hits.map(({ repository: r }) => store.listAnalyses(r.owner, r.name)))).flat();
const byStatus = (status: Analysis["status"]) => analyses.find((a) => a.status === status)!;
const hrefOf = (a: Analysis) => analysisHref(a.owner, a.name, a.id);

/** 이 쪽들 모두: 첫 화면, 검색(빈 질의와 질의), 저장소마다, 분석마다. */
const PAGES = [
  "/",
  "/search/",
  "/search/?q=kids",
  "/search/?q=example",
  // 검색 0건(재디자인 D3): 한글 자판으로 친 질의와 맞는 것이 없는 질의. 아래에 이 사이트에서 분석된 저장소가 붙는다.
  "/search/?q=ㅁㅁ",
  "/search/?q=zzzz",
  // 빈칸 없는 긴 검색어도 되뇌는 줄이 넘치지 않는다(검토 1). 검색어 길이 상한(256)까지.
  `/search/?q=${"a".repeat(60)}`,
  `/search/?q=${"가".repeat(80)}`,
  `/search/?q=${"a".repeat(256)}`,
  ...hits.map(({ repository: r }) => repoHref(r.owner, r.name)),
  ...analyses.map(hrefOf),
];

const rowNames = (page: Page) => page.locator(".repo-row .repo-link").allTextContents();

describe("첫 화면", () => {
  it("머리글 없이 표지(서비스 이름), 큰 검색창, 최근 분석(저장소마다 한 줄, 합성 예시 이름표, 모두 보기). 설명 구획은 없다", async () => {
    const { page, outside } = await open("/");
    const main = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    for (const gone of ["어떻게 쓰나요", "이 도구가 아닌 것", "다른 길", SITE.service.synthetic, SITE.tagline, "검사하는 정책"]) expect(main).not.toContain(gone);
    // 재디자인 D3: 첫 화면에만 머리글이 없다(HTML 은 그대로이고 CSS 가 감춘다). 바닥글은 있다.
    expect(await page.locator(".site-header").isVisible()).toBe(false);
    expect(await page.locator(".site-footer").isVisible()).toBe(true);
    expect((await page.locator("main h1").textContent())?.replace(/\s+/g, " ")).toBe(SITE.name);
    expect(await page.locator("main form[role=search]").getAttribute("action")).toBe("/search/");
    expect(await page.locator(".home-feed .tag").textContent()).toBe("합성 예시");
    expect(await page.locator(".home-feed .home-all").getAttribute("href")).toBe("/search/");
    // 저장소마다 한 줄, 4줄. 분석 중인 저장소(night-push)는 끝난 분석이 아니라 분석 중인 분석을 보인다.
    const rows = page.locator(".act-row");
    expect(await rows.count()).toBe(4);
    const names = (await page.locator(".act-row .act-name").allTextContents()).map((name) => name.replace(/\s+/g, " "));
    expect(new Set(names).size).toBe(4);
    expect(await page.locator(".act-row[data-status=running]").getAttribute("href")).toBe(analysisHref("example-org", "night-push", byStatus("running").id));
    expect(await page.locator(".act-row[data-status=running] .act-step").innerText()).toContain("AI 검토");
    // 발견 0건 줄이 보이므로 0의 뜻이 목록 아래에 보인다.
    expect(main).toContain("발견 0건");
    expect(await page.getByText(SITE.zeroIsNotClearance, { exact: true }).isVisible()).toBe(true);
    // 요청 시각의 시간대는 목록 머리에 한 번 적는다.
    expect(await page.locator(".home-feed-hd .home-kst").textContent()).toBe("시각 KST");
    // 줄의 저장소 이름은 한 굵기다(owner 를 옅게 두는 것은 저장소 쪽 h1 뿐. 목업 home-feed 의 500).
    const weights = await page.locator(".act-name").first().evaluate((name) =>
      [...name.querySelectorAll(".repo-owner, .repo-slash, .repo-name")].map((part) => getComputedStyle(part).fontWeight),
    );
    expect(weights).toEqual(["500", "500", "500"]);
    // 첫 Tab 은 검색창에 닿는다(돋보기 보내기 단추는 Tab 차례에 없다. 빈 질의를 보내는 단추에 먼저 닿지 않는다).
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("home-q");
    // 첫 화면의 바닥글은 가운데 맞춤이다(목업 home-feed). 두 줄은 그대로다.
    expect(await page.locator(".site-footer").evaluate((footer) => getComputedStyle(footer).textAlign)).toBe("center");
    // 재디자인 D2: 넓은 화면의 메뉴(.hdr-nav)와 좁은 화면의 펼치는 메뉴(.menu-pop)가 같은 링크를 갖는다. 머리글은 감춰져 있어도 HTML 은 같다.
    // 재디자인 D4: 메뉴 맨 앞에 최근 분석(질의 없는 /search/)을 더했다(목업 search-home).
    // 2026-11-11: 최근 분석 뒤에 사례(미리 돌린 공개 저장소 결과)를 더했다. 2026-11-13: 맨 뒤에 구조(구조 그림)를 더했다.
    expect(await page.locator(".site-header .hdr-nav a").allTextContents()).toEqual(["최근 분석", "사례", "조문 도감", "데모", "구조"]);
    expect(await page.locator(".site-header .menu-pop a").allTextContents()).toEqual(["최근 분석", "사례", "조문 도감", "데모", "구조"]);
    expect(await page.locator("a[href='/view/']").count()).toBe(0);
    const view = await fetch(`${site.origin}/view/`);
    await view.arrayBuffer();
    expect(view.status).toBe(200);
    expect(outside).toEqual([]);
  });

  it("검색창에 치고 엔터를 누르면 검색 쪽으로 간다(스크립트 없는 GET 양식)", async () => {
    const { page } = await open("/", 1280);
    await page.locator("#home-q").fill("kids");
    await page.locator("#home-q").press("Enter");
    await page.waitForURL(/\/search\/\?q=kids$/);
    expect(await rowNames(page)).toEqual(["example-org / kids-signup"]);
  });

  it("도구 화면의 이름(머리글)은 첫 화면이 아니라 검색 쪽의 빈 상태로 간다", async () => {
    const { page } = await open("/policy/", 1280);
    expect(await page.locator(".site-header .brand").getAttribute("href")).toBe("/search/");
    await page.locator(".site-header .brand").click();
    await page.waitForURL(`${site.origin}/search/`);
    await page.locator("#recent-title").waitFor();
  });
});

describe("검색 빈 상태 (/search/)", () => {
  it("검색창, 최근 분석 상자(저장소마다 한 줄, 0의 뜻), 곁칸의 검사하는 정책(팩의 정책 모두)", async () => {
    const { page, outside } = await open("/search/", 1280);
    expect(await page.locator("main h1").getAttribute("class")).toBe("visually-hidden");
    expect(await page.locator("#search-page-q").inputValue()).toBe("");
    expect(await page.locator("#recent-title + .tag").textContent()).toBe("합성 예시");
    const repos = hits.filter((hit) => hit.analyses > 0).length;
    expect(await page.locator(".search-home-recent .act-row").count()).toBe(Math.min(8, repos));
    expect(await page.getByText(SITE.zeroIsNotClearance, { exact: true }).isVisible()).toBe(true);
    expect((await page.locator("#policies-title").textContent())?.replace(/\s+/g, " ")).toBe(`검사하는 정책 ${packMeta.policies.length}`);
    expect(await page.locator(".search-home-side .pol-row").count()).toBe(packMeta.policies.length);
    // 넓은 화면에서 정책은 오른쪽 곁칸이다.
    const side = (await page.locator(".search-home-side").boundingBox())!;
    const recent = (await page.locator(".search-home-recent").boundingBox())!;
    expect(side.x).toBeGreaterThan(recent.x + recent.width);
    expect(outside).toEqual([]);
  });
});

describe("검색", () => {
  it("서버가 주소의 질의로 찾아 그리고, 검색창에서 엔터를 누르면 그 질의의 주소로 간다", async () => {
    const { page } = await open("/search/?q=kids");
    expect(await rowNames(page)).toEqual(["example-org / kids-signup"]);
    // 합성 미리보기라 결과 머리에 합성 예시 이름표를 단다. 줄의 이름은 한 굵기(600)다.
    expect(await page.locator(".sec-h .tag").textContent()).toBe("합성 예시");
    expect(
      await page.locator(".sr-name").first().evaluate((name) => [...name.querySelectorAll(".repo-owner, .repo-slash, .repo-name")].map((part) => getComputedStyle(part).fontWeight)),
    ).toEqual(["600", "600", "600"]);
    // 쪽 제목과 검색창 사이는 16px 이다(목업 search).
    const h1 = (await page.locator("main h1").boundingBox())!;
    const form = (await page.locator("main form[role=search]").boundingBox())!;
    expect(Math.round(form.y - (h1.y + h1.height))).toBe(16);
    const input = page.locator("#search-page-q");
    expect(await input.inputValue()).toBe("kids");

    await input.fill("example-labs");
    await input.press("Enter");
    await page.waitForURL(/\/search\/\?q=example-labs$/);
    await expect.poll(() => rowNames(page)).toEqual(["example-labs / plain-utils", "example-labs / shop-front", "example-labs / todo-web"]);

    await page.locator("#search-page-q").fill("no-such-repository");
    await page.locator("#search-page-q").press("Enter");
    await page.waitForURL(/\/search\/\?q=no-such-repository$/);
    // 검색 결과의 구획이 없다(아래의 "이 사이트에서 분석된 저장소"는 결과가 아니다).
    expect(await page.locator("#results-title").count()).toBe(0);
    expect(await page.locator(".empty-head").textContent()).toBe("‘no-such-repository’에 맞는 저장소 없음");
    // 검색 쪽에서는 머리글의 검색 단추를 감춰 검색 자리가 하나만 보인다. 이 너비(375)에서는 머리글의 검색창이 늘 감춰져
    // 있어서 좁은 화면의 검색 단추를 본다. 넓은 화면의 검색창을 감추는 것은 tests/browser/header.test.ts 의 1280px 이 본다.
    expect(await page.locator(".site-header .hdr-m-search").isVisible()).toBe(false);

    // 빈 질의는 검색 결과를 늘어놓지 않고(GitHub 을 부르지 않는다) 이 사이트의 최근 분석을 보인다.
    await page.goto(`${site.origin}/search/`);
    expect(await page.locator(".repo-row").count()).toBe(0);
    await page.locator("#recent-title").waitFor();
  });

  it("0건: 한글 자판으로 친 질의에는 영문 글쇠로 찾는 링크, 그 아래 이 사이트에서 분석된 저장소. 0건 줄이 보이면 0의 뜻", async () => {
    const { page, outside } = await open("/search/?q=ㅁㅁ");
    expect(await page.locator(".empty-head").textContent()).toBe("‘ㅁㅁ’에 맞는 저장소 없음");
    const link = page.getByRole("link", { name: "영문 자판으로 친 ‘aa’로 찾기" });
    expect(await link.getAttribute("href")).toBe("/search/?q=aa");
    // 합성 미리보기는 GitHub 을 부르지 않으므로 가짜 GitHub 안내는 없다(합성 예시 이름표가 말한다).
    expect(await page.locator("main").innerText()).not.toContain("가짜 GitHub");
    expect(await page.locator("#analyzed-title + .tag").textContent()).toBe("합성 예시");
    expect(await page.locator(".sr-list .repo-row").count()).toBe(hits.filter((hit) => hit.analyses > 0).length);
    expect(await page.getByText(SITE.zeroIsNotClearance, { exact: true }).isVisible()).toBe(true);
    await link.click();
    await page.waitForURL(/\/search\/\?q=aa$/);
    expect(await page.locator("#search-page-q").inputValue()).toBe("aa");
    // 영문 질의에는 바꿔 찾는 링크가 없다.
    await page.goto(`${site.origin}/search/?q=zzzz`);
    expect(await page.locator("main").innerText()).not.toContain("영문 자판");
    expect(outside).toEqual([]);
  });

  it("머리글의 검색창은 어느 쪽에서든 검색 쪽으로 간다", async () => {
    // 재디자인 D2: 머리글의 검색창은 768px 이상에서 보인다. 좁은 화면에서는 검색 단추(/search/ 로 가는 링크)다.
    const { page } = await open(analysisHref("example-org", "kids-signup", "wtk33e9zuf"), 1280);
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
    expect(await page.locator(".repo-ttl .tag").textContent()).toBe("합성 예시");
    // 분석 요청 단추는 듣지 않는다고 알리고(aria-disabled), 키보드로 닿아 까닭을 듣는다.
    await expect.poll(() => page.locator(".request button").getAttribute("aria-disabled")).toBe("true");
    await page.locator(".request button").focus();
    expect(await page.evaluate(() => document.activeElement?.closest(".request") !== null)).toBe(true);
    expect(await page.locator("#request-off").textContent()).toBe(SITE.service.noServer);
    expect(await page.locator(".request button").textContent()).toBe("main 최신 커밋 분석");
    // 최신 분석 상자(가장 나중에 끝난 분석)와 분석 기록 표. 요청에 관한 풀이 문장과 실행 자리 문구는 없다.
    expect(await page.locator("#latest-title").textContent()).toBe("최신 분석");
    expect(await page.locator(".latest .latest-hd").innerText()).toContain("64y4jdtazh");
    expect(await page.locator(".latest-fd").count()).toBeGreaterThan(0);
    expect(await page.locator(".an-table tbody tr").count()).toBe(2);
    const text = await page.locator("main").innerText();
    for (const gone of ["실행 자리", "다시 분석 요청", "로그인 없이 누구나 요청하고", "진행 중인 분석"]) expect(text).not.toContain(gone);

    const running = byStatus("running");
    await page.locator(".an-table").getByRole("link", { name: running.id }).click();
    await page.waitForURL(`${site.origin}${hrefOf(running)}`);
    await page.waitForSelector(".steps [aria-current=step]");
    expect(await page.locator(".badge").first().textContent()).toBe("분석 중");

    await page.goBack();
    await page.locator(".an-table").getByRole("link", { name: "64y4jdtazh" }).click();
    await page.waitForURL(`${site.origin}${analysisHref("example-org", "night-push", "64y4jdtazh")}`);
    // (D5) 끝난 분석은 결과 화면(.report)이다. 결과 파일 열기·데모와 같은 부품이다.
    await page.waitForSelector(".report");
    expect(outside).toEqual([]);
  });

  it("주소의 대소문자는 소문자 주소로 보낸다(GitHub 은 이름의 대소문자를 가리지 않는다)", async () => {
    const { page } = await open("/r/Example-Org/KIDS-SIGNUP/");
    expect(page.url()).toBe(`${site.origin}${repoHref("example-org", "kids-signup")}`);
    await page.goto(`${site.origin}/r/EXAMPLE-ORG/kids-signup/a/wtk33e9zuf/`);
    expect(page.url()).toBe(`${site.origin}${analysisHref("example-org", "kids-signup", "wtk33e9zuf")}`);
  });
});

describe("분석 쪽의 세 상태", () => {
  it("진행 중: 단계별 진행과 지금의 단계", async () => {
    const { page } = await open(hrefOf(byStatus("running")));
    // 단계 넷과 검사 단계 안의 차례 셋(정적 검사·AI 판정, 기능 파악, AI 검토). 지금인 것은 AI 검토 한 줄이다.
    expect(await page.locator(".step-item:not(.step-sub)").count()).toBe(4);
    expect(await page.locator(".step-sub").count()).toBe(3);
    expect(await page.locator(".step-item:not(.step-sub).step-active .step-name").allTextContents()).toEqual(["검사"]);
    expect(await page.locator("[aria-current=step] .step-name").innerText()).toContain("AI 검토");
    expect(await page.locator("[aria-current=step] .step-inner").innerText()).toContain("이 안의 차례는 알 수 없음");
    expect(await page.locator(".report").count()).toBe(0);
    // (D5) `진행` 상자 하나에 지금 단계(role=status)와 단계 표. 합성 예시라는 것은 제목 옆의 이름표가 밝힌다.
    expect(await page.locator(".live-box .live-now").textContent()).toBe("지금 ‘AI 검토’ 단계");
    expect(await page.locator(".an-head .tag").textContent()).toBe("합성 예시");
    expect(await page.locator("main").textContent()).not.toContain("누구나 볼 수 있고");
  });

  it("대기: 대기 단계가 진행 중이다", async () => {
    const { page } = await open(hrefOf(byStatus("queued")));
    expect(await page.locator(".step-active .step-name").allTextContents()).toEqual(["대기"]);
  });

  it("실패: 멈춘 단계와 까닭", async () => {
    const failed = byStatus("failed");
    const { page } = await open(hrefOf(failed));
    // (D5) 빨간 테두리의 `진행` 상자: 머리에 멈춘 단계, 안에 까닭과 "검토할 곳이 없다는 뜻이 아닙니다".
    expect(await page.locator(".fail-box #failed-title").textContent()).toBe("‘저장소 받기·도구 설치’ 단계에서 멈춤");
    expect(await page.locator(".fail-box").textContent()).toContain(failed.failure!.reason);
    expect(await page.locator(".fail-box .zero-line").textContent()).toContain("검토할 곳이 없다는 뜻이 아닙니다");
    expect(await page.locator(".step-failed .step-name").allTextContents()).toEqual(["저장소 받기·도구 설치"]);
    expect(await page.locator(".report").count()).toBe(0);
  });

  it("끝남: 요약 한 줄, 곁칸(정책 N → 상자로 옮겨 가기), 그리고 조문별 검사 기록", async () => {
    const { page } = await open(analysisHref("example-org", "kids-signup", "wtk33e9zuf"), 1280);
    // (D5) 수 여섯 칸(.tile)을 요약 한 줄로 줄였다(docs/redesign.md 2.3 낱말 표). 숫자인 사실만 둔다.
    expect(await page.locator(".tile").count()).toBe(0);
    // (2026-11-11 오너 지시) 맨 위는 요약(사람이 볼 곳 N건과 정책마다의 수), 그 아래 옅은 줄에 숫자인 사실.
    expect((await page.locator(".headline").innerText()).replace(/\s+/g, " ")).toBe("사람이 볼 곳 1건 만 14세 미만 아동의 개인정보 처리 1건");
    expect((await page.locator(".sumline").innerText()).replace(/\s+/g, " ")).toBe("검사한 파일 1개");
    // 넓은 화면에서 곁칸(정책 N)은 오른쪽 칸이다.
    const side = await page.locator(".report-side").boundingBox();
    const main = await page.locator(".report-main").boundingBox();
    expect(side!.x).toBeGreaterThan(main!.x + main!.width - 1);
    await page.locator(".side-found a").first().click();
    expect(new URL(page.url()).hash).toBe("#policy-kr-pipa-22-2");
    await page.getByRole("button", { name: `${SITE.record.title} 인쇄용`, exact: true }).click();
    await page.waitForSelector(".record");
    expect(await page.locator(".record").textContent()).toContain("example-org/kids-signup · 분석 wtk33e9zuf");
    expect(await page.locator(".report").isVisible()).toBe(false);
  });

  it("저장소 쪽: 최신 분석이 발견 0건이면 상자 안에, 기록 표에 0건이 있으면 표 아래에 0의 뜻을 보인다", async () => {
    const { page } = await open(repoHref("example-labs", "plain-utils"));
    expect(await page.locator(".latest").innerText()).toContain("사람이 볼 곳 0건");
    expect(await page.locator(".latest .zero-note").textContent()).toBe(SITE.zeroIsNotClearance);
    expect(await page.locator(".repo-history .zero-note").textContent()).toBe(SITE.zeroIsNotClearance);
    // 끝난 분석이 없는 저장소에는 최신 분석 상자가 없다.
    await page.goto(`${site.origin}${repoHref("example-labs", "shop-front")}`);
    expect(await page.locator(".latest").count()).toBe(0);
    expect(await page.locator(".an-table tbody tr").count()).toBe(1);
    // 대기열의 자리를 모르는(합성) 대기 중인 줄은 배지만 적는다("대기 중 대기 중"이 아니다).
    expect((await page.locator(".an-table tbody tr").innerText()).match(/대기 중/g)).toHaveLength(1);
  });

  it("발견이 0인 분석: 0의 뜻을 함께 보인다", async () => {
    const { page } = await open(analysisHref("example-labs", "plain-utils", "w7bc479x2u"));
    // (D5) 요약 바로 아래에 굵게(docs/redesign.md 3장 "발견 0").
    expect(await page.locator(".report > .cols .zero-line").textContent()).toBe(SITE.zeroIsNotClearance);
  });
});

describe("분석 쪽의 완료 조건 (재디자인 D5, docs/redesign.md 6장)", () => {
  // 표준 예시: 광고 푸시의 끝난 분석(발견 둘, 같은 파일·같은 줄의 서로 다른 규칙. 목업 analysis 와 같은 결과).
  const STANDARD = analysisHref("example-org", "night-push", "64y4jdtazh");
  /** 발견 줄의 첫 줄(메시지)마다: 창 안에 온전히 들어와 있는지(처음 화면, 스크롤 전). */
  const sentences = (page: Page) =>
    page.locator("li.finding .msg").evaluateAll((all) =>
      all.map((el) => {
        const box = el.getBoundingClientRect();
        return { text: el.textContent, inView: box.height > 0 && box.top >= 0 && box.bottom <= window.innerHeight };
      }),
    );

  /** 맨 위 요약과 세 단의 머리의 아래 끝, 첫 발견 문장의 위 끝(처음 화면, 스크롤 전). */
  const layout = (page: Page) =>
    page.evaluate(() => ({
      overview: document.querySelector(".overview")!.getBoundingClientRect().bottom,
      tiers: [...document.querySelectorAll(".tier-hd")].map((el) => el.getBoundingClientRect().bottom),
      finding: document.querySelector("li.finding .msg")!.getBoundingClientRect().top,
      height: document.documentElement.scrollHeight,
    }));

  it("1280×900: 첫 화면에 맨 위 요약과 세 단의 머리가 보이고, 발견 두 줄의 문장은 두 화면 안에 서로 다르게 있다", async () => {
    // (2026-11-11 오너 지시) 결과 화면이 맨 위 한 문장 요약과 세 단(프로필, 걸리는 의무, 검토 결과)이 되어 발견은 셋째 단에 있다.
    const { page } = await openPage(browser, site, STANDARD, { viewport: { width: 1280, height: 900 }, contexts, problems });
    const at = await layout(page);
    expect(at.overview).toBeLessThanOrEqual(900);
    expect(at.tiers).toHaveLength(3);
    for (const bottom of at.tiers) expect(bottom).toBeLessThanOrEqual(900);
    expect(at.finding).toBeLessThan(2 * 900);
    const shown = await sentences(page);
    expect(shown).toHaveLength(2);
    expect(new Set(shown.map((entry) => entry.text)).size).toBe(2);
  });

  it("390×844: 맨 위 요약이 첫 화면 안에 있고, 첫 발견 문장은 두 화면 안, 쪽 길이는 3,000px 이하다", async () => {
    const { page } = await openPage(browser, site, STANDARD, { viewport: { width: 390, height: 844 }, contexts, problems });
    const at = await layout(page);
    expect(at.overview).toBeLessThanOrEqual(844);
    expect(at.finding).toBeLessThan(2 * 844);
    expect(at.height).toBeLessThanOrEqual(3000);
    expect(await overflow(page)).toMatchObject({ page: 0, over: [] });
  });

  it("발견 0인 분석: 요약 바로 아래에 0의 뜻(굵게), 그다음 검사에 들지 않는 파일과 정보를 펼친 채로 둔다", async () => {
    const { page } = await open(analysisHref("example-labs", "plain-utils", "w7bc479x2u"), 1280);
    const order = await page.locator(".report").evaluate((report) =>
      [".sumline", ".zero-line", ".empty-report", ".not-seen-box", ".side-pol", ".info"].map((selector) => {
        const el = report.querySelector(selector);
        return el ? Math.round(el.getBoundingClientRect().top) : null;
      }),
    );
    // 곁칸(.side-pol)은 넓은 화면에서 오른쪽 칸이라 위쪽 끝이 본문의 맨 위와 같다. 나머지는 위에서부터 차례다.
    const [sum, zero, empty, scope, , info] = order as number[];
    expect([sum, zero, empty, scope, info].every((top) => top !== null)).toBe(true);
    expect([sum, zero, empty, scope, info]).toEqual([...[sum, zero, empty, scope, info]].sort((a, b) => a - b));
    expect(await page.locator(".zero-line").evaluate((el) => getComputedStyle(el).fontWeight)).toBe("600");
    expect(await page.locator(".not-seen-box .not-seen").isVisible()).toBe(true);
  });
});

describe("너비·테마·요청", () => {
  // 너비와 테마마다 따로 돈다(쪽이 스물 남짓이라 한데 묶으면 창 하나의 한도(28초)에 가까워진다).
  it.each([
    [375, "light"],
    [375, "dark"],
    [1280, "light"],
    [1280, "dark"],
  ] as const)("%ipx %s: 모든 쪽이 가로로 넘치지 않고, 밖으로 나가는 요청과 브라우저 저장소가 없다", async (width, scheme) => {
    const fits: string[] = [];
    const { page, outside } = await open(PAGES[0], width, scheme);
    for (const pathname of PAGES) {
      if (pathname !== PAGES[0]) await page.goto(`${site.origin}${pathname}`, { waitUntil: "networkidle" });
      await page.evaluate(() => {
        for (const details of document.querySelectorAll("details")) details.open = true;
      });
      // review 의 개인정보 흐름 그림은 제 상자(.flow-scroll) 안에서 가로로 밀린다. 쪽은 밀리지 않는다.
      const measured = await overflow(page, ".flow-scroll");
      if (measured.page !== 0 || measured.over.length > 0) fits.push(`${scheme} ${pathname}: ${JSON.stringify(measured)}`);
      // 실행 자리의 수(운영 내부 수치)는 어느 쪽에도 적지 않는다(재디자인 D3).
      if (/실행 자리 \d+개 중/.test(await page.locator("main").innerText())) fits.push(`${scheme} ${pathname}: 실행 자리 문구`);
    }
    expect(outside, scheme).toEqual([]);
    expect(await stored(page), scheme).toEqual(NO_STORAGE);
    expect(fits).toEqual([]);
  });
});
