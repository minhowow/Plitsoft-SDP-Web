import type { Browser, BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { syntheticRepositories, syntheticStore as store } from "@/lib/service/synthetic";
import { analysisHref, repoHref } from "@/lib/service/href";
import { closeChrome, launchChrome, openPage, serveSite, textContrast, type ContrastScan, type Site } from "./site";

// 분석 서비스(방향 B, B1)의 쪽의 명도 대비. tests/browser/colors.test.ts 와 같은 재기(`textContrast`)다. 그 파일과 나란히 돌게
// 따로 둔다(한 파일 안의 시험은 차례로 돈다. 그 파일이 가장 오래 걸린다). 첫 화면은 그 파일이 잰다.
//
// 검색(빈 질의와 질의), 저장소마다, 분석마다(진행 중·대기·실패·끝남)를 375px 에서 재고, 넓은 화면에서만 두 칸이 되는
// 대시보드와 저장소·검색 쪽을 1280px 에서도 잰다. 접힌 채로 한 번, 접어 둔 것을 모두 펼친 채로 한 번 잰다. 분석의 상태 표,
// 진행 단계, 대시보드의 수와 정책별 요약, 누를 수 없는 분석 요청 단추의 글이 든다.

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

type Scheme = "light" | "dark";

const hits = syntheticRepositories();
// 재디자인 D3 의 새 면: 첫 화면(머리글 없는 한 단), 검색 빈 상태(상자 둘), 검색 0건(이 사이트에서 분석된 저장소).
const PAGES = ["/", "/search/", "/search/?q=example", "/search/?q=ㅁㅁ"];
const WIDE = ["/", "/search/", "/search/?q=example"];
for (const { repository: r } of hits) {
  PAGES.push(repoHref(r.owner, r.name));
  for (const analysis of await store.listAnalyses(r.owner, r.name)) {
    PAGES.push(analysisHref(r.owner, r.name, analysis.id));
    if (analysis.status === "succeeded") WIDE.push(analysisHref(r.owner, r.name, analysis.id));
  }
}
WIDE.push(repoHref("example-org", "night-push"));

async function scan(page: Page, where: string, low: string[], chips: Set<string>): Promise<number> {
  let measured = 0;
  const add = (label: string, result: ContrastScan) => {
    measured += result.measured;
    for (const chip of result.chips) chips.add(chip);
    for (const entry of result.low) low.push(`${where} ${label}: ${entry.what} "${entry.text}" ${entry.ratio}:1 (${entry.color} / ${entry.background})`);
    expect(result.lowest, `${where} ${label}`).toBeGreaterThanOrEqual(4.5);
  };
  add("(접힌 채)", await textContrast(page));
  await page.evaluate(() => {
    for (const details of document.querySelectorAll("details")) details.open = true;
  });
  add("(펼친 채)", await textContrast(page));
  return measured;
}

describe("두 테마의 명도 대비: 분석 서비스의 쪽", () => {
  // 테마와 너비마다 따로 돈다. 한데 묶으면 쪽이 스물 남짓이라 다른 시험 파일과 함께 돌 때 시험 하나의 한도(30초)를 넘었다
  // (재디자인 D2 에서 시험 파일이 하나 늘어난 뒤. 혼자 돌리면 두 너비를 합쳐 15초 남짓이다). 재는 쪽과 기준은 그대로다.
  it.each([
    ["light", 375],
    ["light", 1280],
    ["dark", 375],
    ["dark", 1280],
  ] as [Scheme, number][])("%s %ipx: 그려진 글자마다 4.5:1 이상", async (scheme, width) => {
    const low: string[] = [];
    const chips = new Set<string>();
    const pages = width === 375 ? PAGES : WIDE;
    const { page } = await openPage(browser, site, pages[0], { viewport: { width, height: 720 }, colorScheme: scheme, contexts, problems });
    expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(scheme === "dark");
    let measured = 0;
    for (const pathname of pages) {
      if (pathname !== pages[0]) await page.goto(`${site.origin}${pathname}`, { waitUntil: "networkidle" });
      measured += await scan(page, `${scheme} ${width} ${pathname}`, low, chips);
    }
    expect(low).toEqual([]);
    expect(measured).toBeGreaterThan(0);
    // 칩이 실제로 그려졌다(대시보드의 정책별 요약과 카드).
    expect([...chips]).toEqual(expect.arrayContaining(["needs-review-ai-pending", "not-reported"]));
  });
});
