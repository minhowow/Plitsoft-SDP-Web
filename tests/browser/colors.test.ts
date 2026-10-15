import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEMO_APPS, DEMO_VARIANTS } from "@/lib/demo/apps";
import { policyHref } from "@/lib/pack/href";
import { STATUS_ORDER } from "@/lib/report/status";
import type { Report } from "@/lib/report/types";
import { SAMPLES } from "@/lib/samples";
import { SITE } from "@/lib/site";
import { jsonFiles, readJson, readPackFile, root } from "../helpers";
import {
  borderContrast,
  closeChrome,
  focusRingContrast,
  inkContrast,
  launchChrome,
  openPage,
  particleBreaks,
  pixelAt,
  serveOut,
  textContrast,
  type ContrastScan,
  type ParticleBreak,
  type Site,
} from "./site";

// 글꼴·간격·색(ROADMAP 9번)에서 쪽마다 재는 것.
//
// 두 테마의 명도 대비(9번의 완료 조건). 모든 쪽 종류(첫 화면, 결과 보기의 결과 여럿, 데모 여섯 판, 조문 도감의 목록과 모든
// 정책 쪽, 조문별 검사 기록, 없는 주소의 쪽(404))를 밝은 테마와 어두운 테마로 열어, 그려진 글자 조각마다 글자색과 그 뒤에 실제로
// 깔린 바탕색의 명도 대비가 4.5:1 이상인지 잰다(tests/browser/site.ts 의 `textContrast`. 쪽마다 한 번의 evaluate). 큰 글자라고
// 3:1 로 낮추지 않는다. 접힌 채로 한 번, 접어 둔 것을 모두 펼친 채로 한 번 잰다. 좁은 화면(375px)에서 모두 재고, 넓은 화면
// (1280px)에서도 표가 든 쪽(결과 보기와 기록, 데모, 정책 쪽)을 잰다. 좁은 화면에서 1px 로 가려 두는 표의 칸 머리는 넓은 화면에서만
// 그려진다.
//
// 상태 칩은 status.ts 의 상태마다 하나 이상이 실제로 그려졌는지도 본다. 칩이 없어서 통과하는 일이 없게, 결과 보기에서 일곱 상태가
// 모두 나오는 결과를 고른다(수집본과 v1 초안 예시, 시험용 자료, 그리고 판정자가 꺼지지 않은 미충족 신호와 다른 판의 팩으로 만든
// 결과는 수집본을 고쳐 만든다. 손으로 만든 것이다).
//
// 실패하면 어느 쪽(무엇을 열었는지, 접힌 채인지)·어느 글(요소와 글의 앞부분)·몇 대 1 인지(글자색과 바탕색)가 실패 글에 남는다.
//
// 인쇄: 기록이 열려 있지 않은 쪽(결과 화면, 데모, 조문 도감, 404)도 어두운 테마에서 인쇄하면 밝은 색으로 찍힌다(흰 종이 위에서
// 잰다). 화면에서 고르는 데만 쓰는 것은 찍지 않는다. 기록의 인쇄는 tests/browser/record.test.ts 가 본다.
//
// 강제 색 모드(윈도의 고대비 테마 등)에서 고르는 단추의 눌린 것이 드러나는지와, 사이트가 쓴 글에서 닫는 따옴표·괄호 뒤의 조사가
// 줄 머리로 떨어지지 않는지도 여기서 본다(9번의 첫 검토 뒤에 더했다).

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

afterAll(async () => {
  await closeChrome(browser);
  await site?.close();
});

type Scheme = "light" | "dark";
const SCHEMES: Scheme[] = ["light", "dark"];

const open = (pathname: string, colorScheme: Scheme, width = 375) =>
  openPage(browser, site, pathname, { viewport: { width, height: 720 }, colorScheme, contexts, problems });

/** 잰 것을 모아 둔다. 기준에 못 미친 것은 어느 쪽의 무엇인지와 함께 적는다. */
class Scans {
  readonly low: string[] = [];
  readonly chips = new Set<string>();
  measured = 0;
  lowest = Infinity;

  add(where: string, scan: ContrastScan): void {
    this.measured += scan.measured;
    this.lowest = Math.min(this.lowest, scan.lowest);
    for (const chip of scan.chips) this.chips.add(chip);
    for (const entry of scan.low) {
      this.low.push(`${where}: ${entry.what} "${entry.text}" ${entry.ratio}:1 (글자 ${entry.color} / 바탕 ${entry.background})`);
    }
    if (scan.lowCount > scan.low.length) this.low.push(`${where}: 그 밖에 ${scan.lowCount - scan.low.length}곳`);
  }

  /** 접힌 채로 한 번 재고, 접어 둔 것을 모두 펼친 채로 한 번 더 잰다. */
  async both(page: Page, where: string): Promise<void> {
    this.add(`${where} (접힌 채)`, await textContrast(page));
    await page.evaluate(() => {
      for (const details of document.querySelectorAll("details")) details.open = true;
    });
    this.add(`${where} (펼친 채)`, await textContrast(page));
  }
}

/** 테마가 실제로 바뀌었는지(같은 색을 두 번 잰 것이 아닌지): 쪽의 바탕이 어두운 테마에서는 어둡고 밝은 테마에서는 밝다. */
async function expectScheme(page: Page, scheme: Scheme): Promise<void> {
  const dark = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
  expect(dark).toBe(scheme === "dark");
  const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const channels = body.match(/\d+/g)!.slice(0, 3).map(Number);
  expect(Math.max(...channels) < 60).toBe(scheme === "dark");
}

/** 기준에 못 미친 것이 없고, 잰 것이 있다. */
function expectReadable(scans: Scans, what: string): void {
  expect(scans.low, `${what}: 명도 대비가 4.5:1 에 못 미친 글`).toEqual([]);
  expect(scans.measured, what).toBeGreaterThan(0);
  expect(scans.lowest, what).toBeGreaterThanOrEqual(4.5);
}

// ── 결과 보기에서 여는 것 ──

/** 그 결과가 열려 다 그려질 때까지 기다린다(제목이 바뀌고 여는 중 표시가 풀린다). */
async function opened(page: Page, title: string): Promise<void> {
  await page.waitForFunction(
    (want) =>
      document.querySelector(".viewer-title")?.textContent === want && document.querySelector(".opened")?.getAttribute("aria-busy") === "false",
    title,
  );
}

async function pickSample(page: Page, id: string): Promise<void> {
  const sample = SAMPLES.find((entry) => entry.id === id)!;
  await page.locator("#sample-select").selectOption(id);
  await opened(page, `${sample.label} (${sample.origin})`);
}

async function pickFile(page: Page, parts: string[]): Promise<void> {
  await page.locator("#report-file").setInputFiles(path.join(root, ...parts));
  await opened(page, parts.at(-1)!);
}

async function pickContent(page: Page, name: string, content: unknown): Promise<void> {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  await page.locator("#report-file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text, "utf8") });
  await opened(page, name);
}

const capture = (name: string) => readJson("contract", "cli-current", name) as Report;

/**
 * 손으로 만든 결과 둘. 수집본에도 시험용 자료에도 없는 상태의 칩을 그리게 한다.
 * - 판정자 없이 검사한 결과의 발견에서 AI 에게 물을 조건을 걷어 낸 것: "미충족 신호(검토 필요)". 수집본은 판정자 없이 만들어서
 *   발견마다 AI 확인 전이다.
 * - 팩 판만 다른 결과: 발견이 없는 정책이 "알 수 없음"이다.
 */
function withoutPending(): Report {
  const base = capture("kids-signup.main.json");
  return {
    ...base,
    findings: base.findings.map((finding) => ({
      ...finding,
      ai_pending: [],
      untested_reasons: finding.untested_reasons.filter((reason) => reason !== "no-judge"),
    })),
  };
}

function otherPack(): Report {
  const base = capture("night-push.fixed.json");
  return { ...base, run: { ...base.run, pack_digest: "0123456789abcdef" } };
}

/** 결과 보기에서 차례로 여는 것. 이름은 실패 글에 남는다. */
const VIEW_STEPS: { name: string; act: (page: Page) => Promise<void> }[] = [
  // 처음에 열려 있는 예시(SAMPLES[0])는 쪽을 열 때 잰다.
  ...SAMPLES.slice(1).map((sample) => ({ name: `예시 ${sample.id}`, act: (page: Page) => pickSample(page, sample.id) })),
  ...jsonFiles("tests", "fixtures").map((name) => ({ name: `tests/fixtures/${name}`, act: (page: Page) => pickFile(page, ["tests", "fixtures", name]) })),
  { name: "SARIF kids-signup.main", act: (page) => pickFile(page, ["contract", "cli-current", "kids-signup.main.sarif"]) },
  { name: "AI 에게 물을 조건이 없는 발견(손으로 만든 것)", act: (page) => pickContent(page, "without-pending.json", withoutPending()) },
  { name: "다른 판의 팩으로 만든 결과(손으로 만든 것)", act: (page) => pickContent(page, "other-pack.json", otherPack()) },
  { name: "읽지 못한 파일의 안내", act: (page) => pickContent(page, "scan.txt", "검토 필요 1건\n") },
];

/** 결과 화면과 조문별 검사 기록을 오가는 단추. */
async function showRecord(page: Page): Promise<void> {
  await page.getByRole("group", { name: "결과와 검사 기록 고르기" }).getByRole("button", { name: SITE.record.title }).click();
  await page.waitForSelector(".record, .record-refused");
}

async function showResult(page: Page): Promise<void> {
  await page.getByRole("group", { name: "결과와 검사 기록 고르기" }).getByRole("button", { name: "결과", exact: true }).click();
  await page.waitForSelector(".report");
}

async function pickDemo(page: Page, app: string, variant: string): Promise<void> {
  await page.getByRole("group", { name: "데모 코드 고르기" }).getByRole("button", { name: app, exact: true }).click();
  await page.getByRole("group", { name: "고치기 전과 고친 뒤 고르기" }).getByRole("button", { name: variant, exact: true }).click();
  await page.waitForFunction((want) => document.querySelector(".demo-title")?.textContent === want, `${app} · ${variant}`);
}

describe("두 테마의 명도 대비: 그려진 글자마다 4.5:1 이상", () => {
  it.each(SCHEMES)("%s: 첫 화면, 조문 도감(목록, 모든 정책 쪽), 없는 주소의 쪽(404)", async (scheme) => {
    const scans = new Scans();
    const { policies } = readPackFile();
    // 없는 주소에는 Next 가 빌드한 기본 404 쪽(out/404.html)이 뜬다. 사이트의 머리와 바닥글이 있고, 본문은 Next 의 기본 화면이다
    // (그 쪽이 싣는 body 의 색을 사이트의 색이 이긴다. src/app/globals.css 의 html body).
    const pages = ["/", "/policy/", ...policies.map((policy) => policyHref(policy.id)), "/404.html"];
    const { page } = await open(pages[0], scheme);
    await expectScheme(page, scheme);
    for (const pathname of pages) {
      if (pathname !== pages[0]) await page.goto(`${site.origin}${pathname}`, { waitUntil: "networkidle" });
      await scans.both(page, `${scheme} ${pathname}`);
    }
    expectReadable(scans, scheme);
  });

  it.each(SCHEMES)("%s: 결과 보기의 결과 스무 가지(처음에 열린 예시와 고른 것 열아홉). 상태 칩은 status.ts 의 일곱 상태가 모두 그려진다", async (scheme) => {
    const scans = new Scans();
    const { page } = await open("/view/", scheme);
    await expectScheme(page, scheme);
    // 처음에 열린 예시부터 잰다.
    await scans.both(page, `${scheme} /view/ 처음`);
    for (const step of VIEW_STEPS) {
      await step.act(page);
      await scans.both(page, `${scheme} /view/ ${step.name}`);
    }
    expectReadable(scans, scheme);
    // 칩은 일곱 상태가 모두 그려졌다(칩이 없어서 통과한 것이 아니다).
    expect([...scans.chips].sort()).toEqual([...STATUS_ORDER].sort());
  });

  it.each(SCHEMES)("%s: 데모 세 앱 × 두 판", async (scheme) => {
    const scans = new Scans();
    const { page } = await open("/demo/", scheme);
    await expectScheme(page, scheme);
    for (const app of DEMO_APPS) {
      for (const variant of DEMO_VARIANTS) {
        await pickDemo(page, app.label, variant.label);
        await scans.both(page, `${scheme} /demo/ ${app.key}.${variant.key}`);
      }
    }
    expectReadable(scans, scheme);
    // 데모의 칩: 수집본에 있는 상태(AI 확인 전, 판단 보류, 발견 없음)가 그려졌다.
    expect([...scans.chips]).toEqual(expect.arrayContaining(["needs-review-ai-pending", "uncertain", "not-reported"]));
  });

  it.each(SCHEMES)("%s: 조문별 검사 기록(데모의 판, 경고가 든 결과, AI 의 표가 든 결과, 만들지 않는 결과)", async (scheme) => {
    const scans = new Scans();
    const demo = await open("/demo/", scheme);
    await expectScheme(demo.page, scheme);
    await pickDemo(demo.page, "광고 푸시", "고치기 전");
    await showRecord(demo.page);
    await scans.both(demo.page, `${scheme} /demo/ 광고 푸시 · 고치기 전의 기록`);

    const { page } = await open("/view/", scheme);
    for (const name of ["incomplete-coverage.json", "judge-on.cleared.json", "judge-on.dismissed.json", "repeated-rule.json"]) {
      await pickFile(page, ["tests", "fixtures", name]);
      await showRecord(page);
      await scans.both(page, `${scheme} /view/ ${name} 의 기록`);
    }
    await pickContent(page, "other-pack.json", otherPack());
    await showRecord(page);
    expect(await page.locator(".record-refused").count()).toBe(1);
    await scans.both(page, `${scheme} /view/ 다른 판의 팩으로 만든 결과(기록을 만들지 않는다)`);
    expectReadable(scans, scheme);
  });

  it.each(SCHEMES)("%s: 넓은 화면(1280px)의 결과 보기와 기록, 데모 여섯 판, 정책 쪽. 좁은 화면에서는 가려 두는 표의 칸 머리도 잰다", async (scheme) => {
    // 위의 시험은 375px 에서 잰다. 표의 칸 머리(기록의 표, 데모의 두 결과의 표, 정책 쪽의 대안 표)는 좁은 화면에서 1px 로 가려
    // 두고 넓은 화면에서만 그린다. 그 글은 여기서만 잰다(9번의 첫 검토에서, 넓은 화면에서만 듣는 규칙으로 칸 머리를 옅게 해도
    // 375px 의 재기가 통과하는 것이 드러났다). "다 보지 못한 것" 표의 칸 머리는 어느 너비에서나 화면 낭독기에만 읽힌다.
    const scans = new Scans();
    /**
     * 넓은 화면에서 재어진 칸 머리 글의 수. 위의 재기와 같은 셈(`textContrast`)으로 세어, 좁은 화면에서 가려 두는 것이 여기서는
     * 그려져 재어졌다는 것을 본다(1px 로 자른 상자 안의 글은 그 셈에서 빠진다).
     */
    const heads = new Map<string, number>();
    const countHeads = async (page: Page, selector: string) => {
      const scan = await textContrast(page, { root: selector });
      heads.set(selector, (heads.get(selector) ?? 0) + scan.measured);
    };

    const { page } = await open("/view/", scheme, 1280);
    await expectScheme(page, scheme);
    await scans.both(page, `${scheme} 1280 /view/ 처음`);
    await showRecord(page);
    await countHeads(page, ".record-table thead th");
    await scans.both(page, `${scheme} 1280 /view/ 처음의 기록`);
    await showResult(page);
    for (const name of ["incomplete-coverage.json", "judge-on.cleared.json", "judge-on.dismissed.json"]) {
      await pickFile(page, ["tests", "fixtures", name]);
      await scans.both(page, `${scheme} 1280 /view/ ${name}`);
      await showRecord(page);
      await countHeads(page, ".record-table thead th");
      await scans.both(page, `${scheme} 1280 /view/ ${name} 의 기록`);
      await showResult(page);
    }

    const demo = await open("/demo/", scheme, 1280);
    for (const app of DEMO_APPS) {
      for (const variant of DEMO_VARIANTS) {
        await pickDemo(demo.page, app.label, variant.label);
        await countHeads(demo.page, ".compare thead th");
        await scans.both(demo.page, `${scheme} 1280 /demo/ ${app.key}.${variant.key}`);
      }
    }

    for (const policy of readPackFile().policies) {
      await demo.page.goto(`${site.origin}${policyHref(policy.id)}`, { waitUntil: "networkidle" });
      await countHeads(demo.page, ".alts thead th");
      await scans.both(demo.page, `${scheme} 1280 ${policyHref(policy.id)}`);
    }
    expectReadable(scans, scheme);
    // 좁은 화면에서는 가려 두는 칸 머리가 넓은 화면에서는 그려져 위에서 재어졌다(가려진 채라 빠진 것이 아니다).
    for (const selector of [".record-table thead th", ".compare thead th", ".alts thead th"]) {
      expect(heads.get(selector), selector).toBeGreaterThan(0);
    }
  });
});

describe("키보드 초점의 둘레선", () => {
  it.each(SCHEMES)("%s: 둘레선과 그 바깥 바탕의 명도 대비가 3:1 이상이다 (결과 보기, 데모, 정책 쪽에서 Tab 으로 닿는 곳)", async (scheme) => {
    const { policies } = readPackFile();
    const low: string[] = [];
    let seen = 0;
    for (const pathname of ["/view/", "/demo/", policyHref(policies[0].id)]) {
      const { page } = await open(pathname, scheme);
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press("Tab");
        const ring = await focusRingContrast(page);
        if (ring.what === "(초점 없음)") continue;
        seen += 1;
        if (ring.ratio < 3) low.push(`${scheme} ${pathname} ${i + 1}번째 ${ring.what}: ${ring.ratio}:1 (${ring.color} / ${ring.background})`);
      }
    }
    expect(low).toEqual([]);
    expect(seen).toBeGreaterThanOrEqual(30);
  });
});

describe("누르거나 고르는 것의 테두리", () => {
  // 고르기 상자, 파일 고르기 단추, 고르는 단추는 사이트의 색으로 그린다(9번 전에는 앞의 둘이 브라우저의 기본 모양이었다). 테두리는
  // 나누는 선(--rule)보다 짙은 --control-line 이다. 나누는 선으로 그리면 바탕과 1.3~1.6:1 이라 테두리로는 단추인 줄 보이지 않는다.
  const CONTROLS: [string, "::file-selector-button"?][] = [["#sample-select"], ["#report-file", "::file-selector-button"], [".segmented button"]];

  it.each(SCHEMES)("%s: 고르기 상자, 파일 고르기 단추, 고르는 단추의 테두리가 그 바깥 바탕과 3:1 이상이다 (결과 보기, 데모)", async (scheme) => {
    const low: string[] = [];
    const seen = new Map<string, number>();
    for (const pathname of ["/view/", "/demo/"]) {
      const { page } = await open(pathname, scheme);
      await expectScheme(page, scheme);
      for (const [selector, pseudo] of CONTROLS) {
        for (const border of await borderContrast(page, selector, pseudo)) {
          seen.set(`${pathname} ${selector}${pseudo ?? ""}`, (seen.get(`${pathname} ${selector}${pseudo ?? ""}`) ?? 0) + 1);
          if (border.ratio < 3) low.push(`${scheme} ${pathname} ${border.what}: ${border.ratio}:1 (테두리 ${border.border} / 바탕 ${border.background})`);
        }
      }
    }
    expect(low).toEqual([]);
    // 잰 것이 있다: 결과 보기의 고르기 상자·파일 고르기 단추·결과와 기록을 오가는 단추 둘, 데모의 단추 일곱(앱 셋, 판 둘, 결과와 기록 둘).
    expect(Object.fromEntries(seen)).toEqual({
      "/view/ #sample-select": 1,
      "/view/ #report-file::file-selector-button": 1,
      "/view/ .segmented button": 2,
      "/demo/ .segmented button": 7,
    });
  });
});

describe("인쇄: 기록이 열려 있지 않은 쪽", () => {
  /** 쪽마다 화면에서 고르는 데만 쓰는 것. 인쇄할 때는 찍지 않는다. */
  const CONTROLS: Record<string, string[]> = {
    "/view/": [".dropzone", ".samples", ".report-switch > .segmented"],
    "/demo/": [".demo-pick", ".report-switch > .segmented"],
  };
  const drawn = (page: Page, selectors: string[]) =>
    page.evaluate((list) => list.map((selector) => [...document.querySelectorAll(selector)].some((el) => el.getClientRects().length > 0)), selectors);

  it.each(SCHEMES)("%s 테마에서 인쇄해도 글자가 흰 종이와 계산된 바탕 위에서 4.5:1 이상이다. 고르는 데만 쓰는 것은 찍지 않는다", async (scheme) => {
    const { policies } = readPackFile();
    const scans = new Scans();
    // 404 쪽(Next 의 기본 화면)은 본문 안에 body 의 색을 정하는 <style> 을 싣는다. 그 어두운 테마 갈래는 인쇄에도 들어서, 사이트의
    // 색이 이기지 않으면 어두운 테마에서 인쇄할 때 흰 종이에 흰 글자(1:1)로 찍힌다(9번의 첫 검토).
    for (const pathname of ["/", "/view/", "/demo/", "/policy/", policyHref(policies[0].id), "/404.html"]) {
      const { page } = await open(pathname, scheme, 1280);
      if (pathname === "/view/") await pickFile(page, ["tests", "fixtures", "incomplete-coverage.json"]);
      // 화면에서는 고르는 것들이 그려져 있다(대조).
      const controls = CONTROLS[pathname] ?? [];
      expect(await drawn(page, controls), `${pathname} 화면`).toEqual(controls.map(() => true));
      await page.emulateMedia({ media: "print", colorScheme: scheme });
      // 인쇄할 때는 어두운 테마에서도 밝은 색이다(어두운 테마의 색은 화면에서만 듣는다).
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), pathname).toBe("rgb(255, 255, 255)");
      expect(await drawn(page, controls), `${pathname} 인쇄`).toEqual(controls.map(() => false));
      // 결과 화면과 사이트의 머리·바닥글은 그대로 찍힌다(기록이 없으면 기록만 찍는 규칙이 듣지 않는다).
      expect(await drawn(page, [".site-header", ".site-footer", "main"]), pathname).toEqual([true, true, true]);
      if (pathname === "/view/" || pathname === "/demo/") expect(await drawn(page, [".report"]), pathname).toEqual([true]);
      scans.add(`${scheme} 인쇄 ${pathname} (접힌 채)`, await textContrast(page, { paper: "rgb(255, 255, 255)" }));
      await page.evaluate(() => {
        for (const details of document.querySelectorAll("details")) details.open = true;
      });
      scans.add(`${scheme} 인쇄 ${pathname} (펼친 채)`, await textContrast(page, { paper: "rgb(255, 255, 255)" }));
    }
    expectReadable(scans, `${scheme} 인쇄`);
  });
});

describe("강제 색 모드(윈도의 고대비 테마 등)", () => {
  // 이 모드에서는 사이트의 색이 시스템 색으로 바뀐다. 고르는 단추(.segmented)는 눌린 것을 색으로만 가려 보이므로, 그대로 두면 눌린
  // 단추와 눌리지 않은 단추의 바탕·글자·테두리가 똑같아진다(9번의 첫 검토에서 Chrome 의 흉내로 봤다. 9번 전에도 같았다). 눌린
  // 단추는 시스템이 고른 것에 쓰는 색(Highlight)으로 칠한다(src/app/globals.css).
  //
  // 이 모드의 Chrome 은 글자 뒤에 쪽의 바탕색(Canvas)을 한 겹 깐다. 눌린 단추를 Highlight 로 칠하기만 하면 그 위의 글자
  // (HighlightText)가 그 바탕과 같은 색이라 보이지 않는다(첫 검토 뒤의 첫 고침이 그랬다. 계산된 색만 보는 재기는 통과했다). 그래서
  // 계산된 꾸밈이 아니라 그려진 점을 읽는다. 단추 안의 칠(왼쪽 여백의 한 점)과, 글자 상자 안의 가장 밝은 점과 가장 어두운 점.
  it.each(SCHEMES)("%s: 고르는 단추에서 눌린 것이 눌리지 않은 것과 다르게 칠해지고, 단추마다 글자가 바탕과 갈려 보인다 (결과 보기, 데모)", async (scheme) => {
    let seen = 0;
    for (const pathname of ["/view/", "/demo/"]) {
      const { page } = await open(pathname, scheme);
      await page.emulateMedia({ colorScheme: scheme, forcedColors: "active" });
      expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches), pathname).toBe(true);
      const count = await page.locator(".segmented button").count();
      const buttons: { pressed: boolean; name: string; fill: string; ink: number }[] = [];
      for (let i = 0; i < count; i++) {
        const button = page.locator(".segmented button").nth(i);
        await button.scrollIntoViewIfNeeded();
        const box = await button.evaluate((el) => {
          const outer = el.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          const text = range.getBoundingClientRect();
          return {
            pressed: el.getAttribute("aria-pressed") === "true",
            name: (el.textContent ?? "").trim(),
            // 테두리(1px) 안쪽, 글자 왼쪽의 여백(14px) 가운데.
            fill: { x: Math.round(outer.left + 6), y: Math.round(outer.top + outer.height / 2) },
            // 글자 상자. 가장자리 2px 는 뺀다(바깥의 칠이 섞이지 않게).
            text: { x: Math.ceil(text.left) + 2, y: Math.ceil(text.top) + 2, width: Math.floor(text.width) - 4, height: Math.floor(text.height) - 4 },
          };
        });
        expect(box.text.width, `${pathname} "${box.name}"`).toBeGreaterThan(8);
        buttons.push({ pressed: box.pressed, name: box.name, fill: await pixelAt(page, box.fill.x, box.fill.y), ink: await inkContrast(page, box.text) });
      }
      const pressed = buttons.filter((button) => button.pressed);
      const others = buttons.filter((button) => !button.pressed);
      expect(pressed.length, pathname).toBeGreaterThan(0);
      expect(others.length, pathname).toBeGreaterThan(0);
      for (const on of pressed) {
        for (const off of others) expect(on.fill, `${pathname} "${on.name}" 과 "${off.name}"`).not.toBe(off.fill);
      }
      for (const button of buttons) expect(button.ink, `${pathname} "${button.name}" 의 글자`).toBeGreaterThanOrEqual(4.5);
      seen += buttons.length;
    }
    // 결과 보기의 둘(결과와 기록), 데모의 일곱(앱 셋, 판 둘, 결과와 기록 둘).
    expect(seen).toBe(9);
  });
});

describe("줄바꿈: 사이트가 쓴 글에서 닫는 따옴표·괄호 뒤의 조사가 줄 머리로 떨어지지 않는다", () => {
  // Chrome 은 word-break: keep-all 이어도 닫는 부호와 그 뒤의 한글 사이에서 줄을 바꾼다('‘판정 경로’ ⏎ 에', '(광고) ⏎ 를'). 사이트가
  // 쓴 글은 그 자리를 줄을 바꾸지 않는 조각으로 묶는다(src/components/text.tsx 의 keepParticles). 9번의 첫 검토에서 쪽을 두루
  // 320~1280px 의 열여섯 너비로 훑어 그런 자리를 찾았고, 찾은 자리가 나오던 너비를 여기서 다시 본다.
  //
  // 팩과 CLI 출력의 글(조문 원문, 알리는 말, 질문, 고치는 법, 판정 경로)에도 같은 꼴이 있고 너비에 따라 줄이 바뀐다. 그 글은
  // 손대지 않으므로 뺀다. 줄이 바뀐 글 조각이 팩 메타데이터나 결과 파일(수집본, v1 초안 예시, 시험용 자료)에 든 글의 일부이면
  // 그 글로 친다.
  const WIDTHS = [320, 344, 375, 414, 700, 1280];
  const outside: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") outside.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(readPackFile());
  for (const dir of [["contract", "cli-current"], ["contract", "samples-v1-draft"], ["tests", "fixtures"]]) {
    for (const name of jsonFiles(...dir)) collect(readJson(...dir, name));
  }
  // 사이트가 묶어 둔 조각(.nobreak) 안의 글은 짧아도 사이트가 쓴 글로 친다.
  const isOutside = (found: ParticleBreak) => !found.kept && outside.some((text) => text.includes(found.node));

  /** 지금 연 것을 너비마다 잰다(접어 둔 것을 모두 펼친다). 사이트가 쓴 글에서 줄이 바뀐 곳을 모으고, 본 자리의 수를 센다. */
  async function sweep(page: Page, where: string, own: string[]): Promise<number> {
    await page.evaluate(() => {
      for (const details of document.querySelectorAll("details")) details.open = true;
    });
    let checked = 0;
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 720 });
      const result = await particleBreaks(page);
      checked += result.checked;
      for (const found of result.found.filter((entry) => !isOutside(entry))) own.push(`${width}px ${where}: ${found.what} ${found.around}`);
    }
    return checked;
  }

  it("첫 화면, 조문 도감(목록과 모든 정책 쪽), 결과 보기(결과와 기록), 데모 여섯 판 (320·344·375·414·700·1280px)", async () => {
    const own: string[] = [];
    let checked = 0;
    const { page } = await open("/", "light");
    checked += await sweep(page, "/", own);
    for (const pathname of ["/policy/", ...readPackFile().policies.map((policy) => policyHref(policy.id))]) {
      await page.goto(`${site.origin}${pathname}`, { waitUntil: "networkidle" });
      checked += await sweep(page, pathname, own);
    }

    const view = await open("/view/", "light");
    checked += await sweep(view.page, "/view/ 처음", own);
    await showRecord(view.page);
    checked += await sweep(view.page, "/view/ 처음의 기록", own);
    await showResult(view.page);
    for (const parts of [["contract", "cli-current", "kids-signup.fixed.json"], ["tests", "fixtures", "incomplete-coverage.json"]]) {
      await pickFile(view.page, parts);
      checked += await sweep(view.page, `/view/ ${parts.at(-1)}`, own);
    }

    const demo = await open("/demo/", "light");
    for (const app of DEMO_APPS) {
      for (const variant of DEMO_VARIANTS) {
        await pickDemo(demo.page, app.label, variant.label);
        checked += await sweep(demo.page, `/demo/ ${app.key}.${variant.key}`, own);
      }
    }
    expect(own).toEqual([]);
    // 본 자리가 있다(닫는 부호 바로 뒤에 한글이 붙은 곳을 실제로 쟀다).
    expect(checked).toBeGreaterThan(100);
  });

  it("대조: 묶은 조각이 줄을 바꿀 수 있게 하면 데모 표 아래의 말이 375px 에서 '‘판정 경로’ ⏎ 에'로 끊긴다", async () => {
    // 찾는 법이 실제로 그 자리를 잡는지 본다. 이 컴퓨터의 글꼴로 잰 자리다(9번의 첫 검토에서 그 말이 그렇게 끊겼다).
    const { page } = await open("/demo/", "light");
    await page.addStyleTag({ content: ".nobreak { white-space: normal; }" });
    const result = await particleBreaks(page);
    expect(result.found.filter((entry) => !isOutside(entry)).map((entry) => entry.around)).toEqual([expect.stringContaining("판정 경로’⏎에")]);
  });
});
