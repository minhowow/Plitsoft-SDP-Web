import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { STEP_ORDER } from "@/lib/service/steps";
import { SITE } from "@/lib/site";
import { openDatabase } from "@/server/db";
import { startGitHubStub } from "../../scripts/github-stub.mjs";
import { readJson } from "../helpers";
import { closeChrome, contrast, launchChrome, NO_STORAGE, openPage, overflow, serveSite, stored, type Site } from "./site";

// 검색창의 자동 완성(재디자인 D4, docs/redesign.md 5장, components/service/SearchCombobox.tsx). 운영 저장소 구현(DB + GitHub)으로
// 띄운 사이트를 연다. DB 는 이 시험만의 PGlite 폴더, GitHub 은 이 시험이 띄운 가짜 GitHub(scripts/github-stub.mjs)이다. 실제
// GitHub 을 부르지 않는다.
//
// 본다: 치면 두 무리(이 사이트·GitHub)와 전체 검색 줄, ↑↓ 와 aria-activedescendant·aria-selected, Enter 로 옮겨 가기, Esc, 한글
// 조합 중에는 묻지 않기, 같은 사이트의 /api/ 말고는 요청이 없고 브라우저 저장소를 쓰지 않기, 첫 화면의 빈 검색창(펼치지 않고 ↓ 로
// 최근 분석), 좁은 화면의 검색 모드, 요청 수 상한일 때의 줄, 375·1280 두 테마에서 펼친 목록이 넘치지 않기, 머리글·검색 쪽의 검색창,
// 스크립트 없이 보내기.

let stub: Awaited<ReturnType<typeof startGitHubStub>>;
let site: Site;
let browser: Browser;
let dataDir: string;
const contexts: BrowserContext[] = [];
const problems: string[] = [];

beforeAll(async () => {
  // 시험이 여러 번 치므로 가짜 GitHub 과 사이트의 1분 예산을 넉넉히 둔다(상한은 아래 시험이 따로 만든다).
  stub = await startGitHubStub({ searchPerMinute: 1_000 });
  dataDir = mkdtempSync(path.join(tmpdir(), "policypack-pglite-cbx-"));
  const db = await openDatabase({ databaseUrl: null, pgliteDir: dataDir });
  const at = (minutes: number) => new Date(Date.parse("2026-11-03T01:00:00Z") + minutes * 60_000).toISOString();
  const steps = (start: number) => JSON.stringify(STEP_ORDER.map((name, i) => ({ name, startedAt: at(start + i), endedAt: at(start + i + 1) })));
  const insert = async (id: string, owner: string, repo: string, commit: string, minutes: number, capture: string) => {
    const result = readJson("contract", "cli-current", `${capture}.json`) as { tool: { version: string }; run: { pack_digest: string }; findings: unknown[] };
    await db.query(
      `INSERT INTO analyses (id, owner, repo, repo_key, commit_sha, branch, status, requested_at, finished_at, steps, tool_version, pack_digest, finding_count)
       VALUES ($1, $2, $3, $4, $5, 'main', 'succeeded', $6, $7, $8::jsonb, $9, $10, $11)`,
      [id, owner, repo, `${owner}/${repo}`.toLowerCase(), commit, at(minutes), at(minutes + 5), steps(minutes), result.tool.version, result.run.pack_digest, result.findings.length],
    );
    await db.query("INSERT INTO results (analysis_id, json) VALUES ($1, $2)", [id, JSON.stringify(result)]);
  };
  await insert("cbxk7wq2zh", "example-org", "kids-signup", stub.head("example-org", "kids-signup")!, 10, "kids-signup.main");
  await insert("cbxk7wq2zm", "example-labs", "plain.utils", "e".repeat(40), 0, "plain.main");
  await db.close();
  site = await serveSite({ SERVICE_STORE: "db", PGLITE_DIR: dataDir, GITHUB_API_BASE: stub.origin, RUNNER: "none", GITHUB_SEARCH_PER_MINUTE: "600" });
  try {
    browser = await launchChrome();
  } catch (error) {
    await site.close();
    throw error;
  }
}, 60_000);

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
  expect(problems.splice(0)).toEqual([]);
});

afterAll(async () => {
  await closeChrome(browser);
  await site?.close();
  await stub?.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const open = (pathname: string, width = 1280, colorScheme: "light" | "dark" = "light", height = 800) =>
  openPage(browser, site, pathname, { viewport: { width, height }, colorScheme, contexts, problems });

const suggests = () => site.requests.filter((request) => request.url.startsWith("/api/repos/suggest/"));
const expanded = (page: Page, id: string) => page.locator(`#${id}`).getAttribute("aria-expanded");
/** GitHub 까지 물은 지금 글자의 답이 그려질 때까지(펼침 목록의 data-github 에 그 상태가 달린다). */
const settled = (page: Page, id: string) => page.locator(`.cbx-pop[data-github]:has(#${id}-list)`).waitFor();
const optionNames = (page: Page, id: string) =>
  page.locator(`#${id}-list [role=option]`).evaluateAll((options) => options.map((option) => (option.textContent ?? "").replace(/\s+/g, " ").trim()));
const optionIds = (page: Page, id: string) => page.locator(`#${id}-list [role=option]`).evaluateAll((options) => options.map((option) => option.id));
const live = (page: Page) => page.locator("main [aria-live=polite]").textContent();

describe("첫 화면에서 치기", () => {
  it("두 무리(이 사이트·GitHub)와 전체 검색 줄. 무리는 이름으로 묶이고, 안내 줄은 목록 밖, 수는 aria-live 로 알린다", async () => {
    const { page, outside } = await open("/");
    const input = page.locator("#home-q");
    expect(await input.getAttribute("role")).toBe("combobox");
    expect(await input.getAttribute("aria-controls")).toBe("home-q-list");
    expect(await input.getAttribute("aria-autocomplete")).toBe("list");
    await input.focus();
    // owner 의 공개 저장소를 묻는 꼴(user:example-org). 가짜 GitHub 의 in:name 은 이름만 보므로(실제처럼) 'exa' 는 GitHub 에 없다.
    await page.keyboard.type("example-org/");
    await settled(page, "home-q");
    expect(await expanded(page, "home-q")).toBe("true");
    expect(await page.locator("#home-q-list").getAttribute("role")).toBe("listbox");

    const site_ = page.locator("[role=group][aria-labelledby='home-q-g-site']");
    const github = page.locator("[role=group][aria-labelledby='home-q-g-gh']");
    expect((await page.locator("#home-q-g-site").innerText()).replace(/\s+/g, " ")).toBe("이 사이트에서 분석된 저장소 합성 예시");
    expect((await page.locator("#home-q-g-gh").innerText()).replace(/\s+/g, " ")).toBe("GitHub 공개 저장소 검색 결과 합성 예시");
    expect(await site_.locator("[role=option] .cbx-nm").allTextContents()).toEqual(["example-org / kids-signup"]);
    // GitHub 결과에서 이 사이트의 줄과 겹치는 저장소(kids-signup)는 빠진다.
    expect(await github.locator("[role=option] .cbx-nm").allTextContents()).toEqual(["example-org / night-push"]);
    expect((await site_.locator("[role=option]").first().innerText()).replace(/\s+/g, " ")).toMatch(/^example-org \/ kids-signup 분석 1회 2026-11-03$/);
    expect((await github.locator("[role=option]").first().innerText()).replace(/\s+/g, " ")).toBe("example-org / night-push 마케팅 앱 푸시를 보내는 코드 TypeScript");
    // 친 부분은 굵게(owner 와 빗금).
    expect(await page.locator("#home-q-list .cbx-nm b").allTextContents()).toEqual(["example-org", "/", "example-org", "/"]);
    // 줄은 진짜 링크다. 끝 줄은 전체 검색.
    expect(await page.locator("#home-q-list [role=option]").evaluateAll((options) => options.map((o) => o.getAttribute("href")))).toEqual([
      "/r/example-org/kids-signup/",
      "/r/example-org/night-push/",
      "/search/?q=example-org%2F",
    ]);
    expect((await optionNames(page, "home-q")).at(-1)).toBe("‘example-org/’ 전체 검색");
    // 안내 줄(가짜 GitHub)은 listbox 밖이다. 저장소 수는 적지 않는다. 별 수 같은 인기 수치는 없다.
    const note = page.locator("main .cbx-note", { hasText: "로컬 가짜 GitHub" });
    expect(await note.textContent()).toBe("로컬 가짜 GitHub: 합성 저장소만 찾습니다.");
    expect(await note.evaluate((el) => el.closest("[role=listbox]") === null)).toBe(true);
    expect(await page.locator("main .cbx-pop").innerText()).not.toMatch(/★|star|별/i);
    expect(await live(page)).toBe("제안 2개");
    // 같은 사이트의 /api/ 만 불렀다. 이 사이트만 먼저 묻는 요청과 GitHub 까지 묻는 요청.
    expect(suggests().map((request) => request.url)).toEqual(
      expect.arrayContaining(["/api/repos/suggest/?q=example-org%2F&scope=site", "/api/repos/suggest/?q=example-org%2F"]),
    );
    expect(outside).toEqual([]);
    expect(await stored(page)).toEqual(NO_STORAGE);
  });

  it("'exa': 이 사이트의 줄과 'GitHub 에 없음'. 'exam' 으로 늘여도 같다(앞 결과를 걸러 쓰다 GitHub 의 결과를 숨기지 않는다)", async () => {
    const { page } = await open("/");
    await page.locator("#home-q").focus();
    await page.keyboard.type("exa");
    await settled(page, "home-q");
    expect(await page.locator("#home-q-list [role=option] .cbx-nm").allTextContents()).toEqual(["example-org / kids-signup", "example-labs / plain.utils"]);
    expect(await page.locator("main .cbx-status").textContent()).toBe("GitHub 에 없음");
    expect(await live(page)).toBe("제안 2개. GitHub 에 없음");
    await page.keyboard.type("m");
    await expect.poll(() => page.evaluate(() => document.querySelector(".cbx-pop[data-github]") !== null && document.querySelector("#home-q-list .cbx-echo")?.textContent === "exam")).toBe(true);
    await settled(page, "home-q");
    expect(await page.locator("main .cbx-status").textContent()).toBe("GitHub 에 없음");
    // 다른 꼴: owner 의 저장소. 'example-org/' 의 결과를 걸러 쓴 'example-org/nig' 는 바로 물은 것과 같다.
    await page.locator("#home-q").fill("");
    await page.keyboard.type("example-org/");
    await settled(page, "home-q");
    await page.keyboard.type("nig");
    await expect.poll(() => page.locator("#home-q-list [role=option] .cbx-nm").allTextContents()).toEqual(["example-org / night-push"]);
  });

  it("↑↓ 는 줄을 고르고(끝에서 돈다) aria-activedescendant·aria-selected 를 바꾼다. 고른 줄은 띠가 3:1 넘게 보인다. Enter 는 그 줄로 간다", async () => {
    const { page } = await open("/");
    await page.locator("#home-q").focus();
    await page.keyboard.type("example-org/");
    await settled(page, "home-q");
    const state = () =>
      page.evaluate(() => ({
        active: document.getElementById("home-q")!.getAttribute("aria-activedescendant"),
        selected: [...document.querySelectorAll("#home-q-list [role=option]")].filter((o) => o.getAttribute("aria-selected") === "true").map((o) => o.id),
      }));
    const ids = await optionIds(page, "home-q");
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(await state()).toEqual({ active: null, selected: [] });
    await page.keyboard.press("ArrowDown");
    expect(await state()).toEqual({ active: ids[0], selected: [ids[0]] });
    await page.keyboard.press("ArrowUp");
    expect(await state()).toEqual({ active: ids[2], selected: [ids[2]] });
    await page.keyboard.press("ArrowDown");
    expect(await state()).toEqual({ active: ids[0], selected: [ids[0]] });
    // 초점은 입력창에 남는다(가상 초점).
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("home-q");
    const look = await page.locator(`[id="${ids[0]}"]`).evaluate((el) => {
      const style = getComputedStyle(el);
      return { band: /rgb\([^)]*\)/.exec(style.boxShadow)?.[0] ?? "", width: /inset 0px 0px 0px (\d+)px/.exec(style.boxShadow)?.[1] ?? /0px 0px 0px (\d+)px inset/.exec(style.boxShadow)?.[1], bg: style.backgroundColor };
    });
    expect(look.width).toBe("2");
    expect(contrast(look.band, look.bg)).toBeGreaterThanOrEqual(3);
    await page.keyboard.press("Enter");
    await page.waitForURL(`${site.origin}/r/example-org/kids-signup/`);
    expect(await page.locator("h1").textContent()).toBe("example-org / kids-signup");
  });

  it("고른 줄은 GitHub 결과가 늦게 와서 줄이 밀려도 같은 줄이다(자리로 기억하지 않는다). Enter 는 고른 줄로 간다", async () => {
    const { page } = await open("/");
    // GitHub 까지 묻는 답만 1.5초 늦춘다. 이 사이트만 묻는 답(150ms)이 먼저 그려진다.
    await page.route(
      (url) => url.pathname === "/api/repos/suggest/" && !url.searchParams.has("scope"),
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await route.continue();
      },
    );
    await page.locator("#home-q").focus();
    await page.keyboard.type("example-org/");
    await expect.poll(() => page.locator("#home-q-list [role=option] :is(.cbx-nm, .cbx-all-q)").allTextContents()).toEqual(["example-org / kids-signup", "‘example-org/’ 전체 검색"]);
    await page.keyboard.press("ArrowUp");
    const all = await page.locator("#home-q-list .cbx-all").getAttribute("id");
    expect(await page.locator("#home-q").getAttribute("aria-activedescendant")).toBe(all);
    // GitHub 결과(night-push)가 전체 검색 줄 앞에 들어온다. 고른 줄은 그대로 전체 검색이다.
    await settled(page, "home-q");
    expect(await optionIds(page, "home-q")).toHaveLength(3);
    expect(await page.locator("#home-q").getAttribute("aria-activedescendant")).toBe(all);
    expect(await page.locator("#home-q-list [aria-selected=true]").evaluateAll((options) => options.map((o) => o.textContent))).toEqual(["‘example-org/’ 전체 검색"]);
    await page.keyboard.press("Enter");
    await page.waitForURL(`${site.origin}/search/?q=example-org%2F`);
  });

  it("가운데 단추로 누르면 새 탭에 열리고 목록은 열린 채다(pointerdown 을 막아도 auxclick 은 남는다)", async () => {
    const { context, page } = await open("/");
    await page.locator("#home-q").focus();
    await page.keyboard.type("example-org/");
    await settled(page, "home-q");
    const opened = context.waitForEvent("page");
    await page.locator("#home-q-list [role=option]").first().click({ button: "middle" });
    const tab = await opened;
    await tab.waitForLoadState();
    expect(new URL(tab.url()).pathname).toBe("/r/example-org/kids-signup/");
    await tab.close();
    expect(await expanded(page, "home-q")).toBe("true");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("home-q");
    // 오른쪽 단추도 목록을 닫지 않는다(주소 복사 메뉴가 링크에 닿는다).
    await page.locator("#home-q-list [role=option]").first().click({ button: "right" });
    expect(await expanded(page, "home-q")).toBe("true");
    expect(page.url()).toBe(`${site.origin}/`);
  });

  it("Esc 는 목록을 닫고, 닫혀 있으면 글자를 지운다. Tab 과 초점이 떠나면 닫는다", async () => {
    const { page } = await open("/");
    const input = page.locator("#home-q");
    await input.focus();
    await page.keyboard.type("kid");
    await page.locator("main .cbx-pop:not([hidden])").waitFor();
    await settled(page, "home-q");
    expect(await live(page)).toMatch(/^제안 \d+개/);
    await page.keyboard.press("Escape");
    expect(await expanded(page, "home-q")).toBe("false");
    expect(await page.locator("main .cbx-pop").isVisible()).toBe(false);
    // 닫을 때 '제안 0개'를 알리지 않는다.
    expect(await live(page)).toBe("");
    expect(await input.inputValue()).toBe("kid");
    await page.keyboard.press("Escape");
    expect(await input.inputValue()).toBe("");
    await page.keyboard.type("kid");
    expect(await expanded(page, "home-q")).toBe("true");
    await page.keyboard.press("Tab");
    expect(await expanded(page, "home-q")).toBe("false");
    expect(await page.locator("main .cbx-pop").isVisible()).toBe(false);
    expect(await live(page)).toBe("");
  });

  it("뒤로 가기로 돌아오면(bfcache 의 pageshow, persisted) 닫힌 처음 모습이다", async () => {
    const { page } = await open("/");
    await page.locator("#home-q").focus();
    await page.keyboard.type("kid");
    await page.locator("main .cbx-pop:not([hidden])").waitFor();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    expect(await expanded(page, "home-q")).toBe("false");
    expect(await page.locator("main .cbx-pop").isVisible()).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("home-q");
  });

  it("고른 줄이 없을 때 Enter 는 양식을 보낸다(비면 /search/). 전체 검색 줄을 누르면 검색 쪽으로 간다", async () => {
    const { page } = await open("/");
    await page.locator("#home-q").focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(`${site.origin}/search/`);
    await page.goto(`${site.origin}/`, { waitUntil: "networkidle" });
    await page.locator("#home-q").focus();
    await page.keyboard.type("night");
    await page.locator("main .cbx-all").click();
    await page.waitForURL(`${site.origin}/search/?q=night`);
    expect(await page.locator(".repo-row .repo-link").allTextContents()).toEqual(["example-org / night-push"]);
  });

  it("한글을 조합하는 동안은 묻지 않고 Enter 도 받지 않는다. 조합이 끝나면 묻는다(CDP Input.imeSetComposition)", async () => {
    const { context, page } = await open("/");
    await page.locator("#home-q").focus();
    const before = suggests().length;
    const cdp = await context.newCDPSession(page);
    for (const text of ["ㄱ", "기", "김"]) await cdp.send("Input.imeSetComposition", { text, selectionStart: 1, selectionEnd: 1 });
    expect(await page.locator("#home-q").inputValue()).toBe("김");
    // 조합 중의 Enter(keyCode 229, isComposing)는 받지 않는다.
    await page.evaluate(() =>
      document.getElementById("home-q")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true })),
    );
    await page.waitForTimeout(800);
    expect(suggests().length).toBe(before);
    expect(await expanded(page, "home-q")).toBe("false");
    expect(page.url()).toBe(`${site.origin}/`);
    // 조합을 끝낸다(글자를 넣는다). 이제 묻는다.
    await cdp.send("Input.insertText", { text: "김" });
    await expect.poll(() => suggests().length).toBeGreaterThan(before);
    expect(suggests().at(-1)?.url).toContain(`q=${encodeURIComponent("김")}`);
    expect(await expanded(page, "home-q")).toBe("true");
    // 한글은 GitHub 이름 글자가 아니라 GitHub 에 묻지 않는다. 그 사실을 적는다.
    await expect.poll(() => page.locator("main .cbx-status").textContent()).toBe("GitHub 에 묻지 않음(3글자 미만)");
  });

  it("조합 이벤트를 직접 보내도 같다(compositionstart·update·isComposing 인 input, 그다음 compositionend)", async () => {
    const { page } = await open("/");
    await page.locator("#home-q").focus();
    const before = suggests().length;
    await page.evaluate(() => {
      const el = document.getElementById("home-q") as HTMLInputElement;
      el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      for (const value of ["ㅎ", "하", "한"]) {
        el.value = value;
        el.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: value }));
        el.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: value, inputType: "insertCompositionText" }));
      }
    });
    await page.waitForTimeout(800);
    expect(suggests().length).toBe(before);
    expect(await expanded(page, "home-q")).toBe("false");
    await page.evaluate(() => document.getElementById("home-q")!.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "한" })));
    await expect.poll(() => suggests().length).toBeGreaterThan(before);
    expect(suggests().at(-1)?.url).toContain(`q=${encodeURIComponent("한")}`);
  });
});

describe("첫 화면의 빈 검색창", () => {
  it("초점이 와도 펼치지 않는다(aria-expanded=false). ↓ 는 최근 분석의 첫 줄로, 그 안에서 ↑↓, 첫 줄에서 ↑ 는 검색창으로", async () => {
    const { page } = await open("/");
    await page.locator("#home-q").focus();
    expect(await expanded(page, "home-q")).toBe("false");
    expect(await page.locator("main .cbx-pop").isVisible()).toBe(false);
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute("href") ?? document.activeElement?.id ?? "");
    const rows = await page.locator(".home-feed .act-row").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(rows.length).toBe(2);
    await page.keyboard.press("ArrowDown");
    expect(await focused()).toBe(rows[0]);
    await page.keyboard.press("ArrowDown");
    expect(await focused()).toBe(rows[1]);
    await page.keyboard.press("ArrowDown");
    expect(await focused()).toBe(rows[1]);
    await page.keyboard.press("ArrowUp");
    expect(await focused()).toBe(rows[0]);
    await page.keyboard.press("ArrowUp");
    expect(await focused()).toBe("home-q");
    expect(suggests().filter((request) => request.url === "/api/repos/suggest/?q=")).toEqual([]);
  });

  it("390px: 초점이 있는 동안 검색 모드(표지 20px·600 을 왼쪽 위로, 검색창을 위로). 펼친 목록이 화면 안에서 끝난다", async () => {
    const { page } = await open("/", 390, "light", 844);
    const before = await page.locator("#home-q").boundingBox();
    await page.locator("#home-q").focus();
    expect(await page.locator(".home").getAttribute("data-mode")).toBe("search");
    const wordmark = await page.locator(".wm").evaluate((el) => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight, left: el.getBoundingClientRect().left }));
    expect(wordmark).toMatchObject({ size: "20px", weight: "600" });
    expect(wordmark.left).toBeLessThan(24);
    const after = (await page.locator("#home-q").boundingBox())!;
    expect(after.y).toBeLessThan(before!.y);
    expect(after.y).toBeLessThan(100);
    await page.keyboard.type("exa");
    await settled(page, "home-q");
    const pop = (await page.locator("main .cbx-pop").boundingBox())!;
    expect(pop.y + pop.height).toBeLessThanOrEqual(844);
    // 좁은 화면에서는 날짜를 감춘다.
    expect(await page.locator("main .cbx-when").first().isVisible()).toBe(false);
    await page.locator("#home-q").blur();
    expect(await page.locator(".home").getAttribute("data-mode")).toBeNull();
  });
});

describe("GitHub 에 묻지 못할 때", () => {
  it("요청 수 상한이면 펼침 목록 바닥에 'GitHub 에 묻지 못함(요청 수 상한)'. 이 사이트의 줄은 그대로", async () => {
    stub.setSearchLimit(0);
    try {
      const { page } = await open("/");
      await page.locator("#home-q").focus();
      await page.keyboard.type("plain.u");
      await expect.poll(() => page.locator("main .cbx-status").textContent()).toBe("GitHub 에 묻지 못함(요청 수 상한)");
      expect(await page.locator("#home-q-g-gh").count()).toBe(0);
      expect(await page.locator("#home-q-list [role=option] .cbx-nm").allTextContents()).toEqual(["example-labs / plain.utils"]);
      // 상태 줄은 목록 밖이라 가상 초점으로 닿지 않는다. 수와 함께 알린다.
      expect(await live(page)).toBe("제안 1개. GitHub 에 묻지 못함(요청 수 상한)");
      // 묻지 못한 답은 쪽의 메모리에 두지 않는다. 상한이 풀린 뒤 다시 치면 다시 묻는다.
      stub.setSearchLimit(1_000);
      const before = suggests().filter((request) => request.url === "/api/repos/suggest/?q=plain.u").length;
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.keyboard.type("plain.u");
      await expect.poll(() => suggests().filter((request) => request.url === "/api/repos/suggest/?q=plain.u").length).toBeGreaterThan(before);
      await expect.poll(() => page.locator("main .cbx-status").count()).toBe(0);
      stub.setSearchLimit(0);
      // 검색 쪽(0건 화면)도 같은 말로 가른다.
      await page.goto(`${site.origin}/search/?q=plain.u`, { waitUntil: "networkidle" });
      expect(await page.locator(".empty-block").innerText()).toContain("GitHub 에 묻지 못함(요청 수 상한)");
    } finally {
      stub.setSearchLimit(1_000);
    }
  });

  it("GitHub 까지 묻는 요청이 닿지 못하면(플랫폼의 5xx 등) 'GitHub 에 묻지 못함(연결 실패)'. 조용히 이 사이트의 줄만 두지 않는다", async () => {
    const { page } = await open("/");
    await page.route(
      (url) => url.pathname === "/api/repos/suggest/" && !url.searchParams.has("scope"),
      (route) => route.fulfill({ status: 502, contentType: "text/html", body: "<html>bad gateway</html>" }),
    );
    await page.locator("#home-q").focus();
    await page.keyboard.type("kids");
    await expect.poll(() => page.locator("main .cbx-status").textContent()).toBe("GitHub 에 묻지 못함(연결 실패)");
    expect(await page.locator("#home-q-list [role=option] .cbx-nm").allTextContents()).toEqual(["example-org / kids-signup"]);
    expect(await live(page)).toBe("제안 1개. GitHub 에 묻지 못함(연결 실패)");
    // 일부러 낸 502 의 콘솔 줄만 있다.
    expect(problems.splice(0).filter((line) => !line.includes("status of 502"))).toEqual([]);
  });

  it("GitHub 에 없으면 'GitHub 에 없음'(검색 쪽 0건 화면도)", async () => {
    const { page } = await open("/");
    await page.locator("#home-q").focus();
    await page.keyboard.type("zzzz");
    await expect.poll(() => page.locator("main .cbx-status").textContent()).toBe("GitHub 에 없음");
    await page.goto(`${site.origin}/search/?q=zzzz`, { waitUntil: "networkidle" });
    expect(await page.locator(".empty-block").innerText()).toContain("GitHub 에 없음");
  });
});

describe("머리글과 검색 쪽의 검색창", () => {
  it("머리글(넓은 화면): 빈 초점에는 펼치지 않고, 치면 펼친다. 고른 줄이 없을 때 Enter 는 보통의 GET 양식이다", async () => {
    const { page, outside } = await open("/policy/");
    await page.locator("#site-q").focus();
    expect(await expanded(page, "site-q")).toBe("false");
    await page.keyboard.type("night");
    await settled(page, "site-q");
    expect(await page.locator(".site-header .cbx-pop").isVisible()).toBe(true);
    expect(await page.locator("#site-q-list [role=option] .cbx-nm").allTextContents()).toEqual(["example-org / night-push"]);
    const pop = (await page.locator(".site-header .cbx-pop").boundingBox())!;
    expect(pop.x + pop.width).toBeLessThanOrEqual(1280);
    await page.keyboard.press("Enter");
    await page.waitForURL(`${site.origin}/search/?q=night`);
    expect(outside).toEqual([]);
  });

  it("검색 쪽의 검색창: 빈 초점에는 펼치지 않고, 치면 본문의 펼침 목록이 열린다", async () => {
    const { page } = await open("/search/");
    await page.locator("#search-page-q").focus();
    expect(await expanded(page, "search-page-q")).toBe("false");
    await page.keyboard.type("kid");
    await settled(page, "search-page-q");
    expect(await page.locator("#search-page-q-list [role=option] .cbx-nm").first().textContent()).toBe("example-org / kids-signup");
    // 도구 쪽의 줄(목업 search-home): 한 줄 40px, 가장자리에서 4px 안쪽.
    const rows = await page.locator("#search-page-q-list [role=option]").evaluateAll((options) =>
      options.map((o) => ({ h: Math.round(o.getBoundingClientRect().height), inset: Math.round(o.getBoundingClientRect().left - o.closest(".cbx-pop")!.getBoundingClientRect().left) })),
    );
    expect(rows.every((row) => row.h === 40 && row.inset === 4), JSON.stringify(rows)).toBe(true);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForURL(`${site.origin}/r/example-org/kids-signup/`);
  });

  it("스크립트가 없으면 보통의 GET 양식이다", async () => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 800 } });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(`${site.origin}/`, { waitUntil: "networkidle" });
    expect(await page.locator("#home-q").getAttribute("aria-expanded")).toBe("false");
    await page.locator("#home-q").fill("kids");
    await page.locator("#home-q").press("Enter");
    await page.waitForURL(`${site.origin}/search/?q=kids`);
    expect(await page.locator(".repo-row .repo-link").allTextContents()).toEqual(["example-org / kids-signup"]);
  });
});

describe("자리표시 글과 줄의 크기", () => {
  it("자리표시 글은 들어가지 않으면 짧은 글로(320px), 넓으면 그대로(1280px)", async () => {
    const narrow = await open("/", 320, "light", 640);
    expect(await narrow.page.locator("#home-q").getAttribute("placeholder")).toBe(SITE.service.searchPlaceholderShort);
    expect(await narrow.page.locator("#home-q").evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    const wide = await open("/", 1280);
    expect(await wide.page.locator("#home-q").getAttribute("placeholder")).toBe(SITE.service.searchPlaceholder);
  });

  it("첫 화면 1280: 줄은 36px. 390: 펼침 목록의 둥글기는 검색창과 같고, 끝 줄의 돋보기는 검색창 돋보기와 같은 세로줄. 검색 쪽 390: 한 줄 44px, 설명 없음", async () => {
    const wide = await open("/", 1280);
    await wide.page.locator("#home-q").focus();
    await wide.page.keyboard.type("example-org/");
    await settled(wide.page, "home-q");
    const heights = await wide.page.locator("#home-q-list .cbx-grp [role=option]").evaluateAll((options) => options.map((o) => Math.round(o.getBoundingClientRect().height)));
    expect(heights).toEqual([36, 36]);

    const { page } = await open("/", 390, "light", 844);
    await page.locator("#home-q").focus();
    await page.keyboard.type("example-org/");
    await settled(page, "home-q");
    const look = await page.evaluate(() => {
      const center = (el: Element) => {
        const box = el.getBoundingClientRect();
        return Math.round(box.left + box.width / 2);
      };
      return {
        pop: getComputedStyle(document.querySelector("main .cbx-pop")!).borderRadius,
        field: getComputedStyle(document.querySelector("main .find")!).borderRadius,
        endIcon: center(document.querySelector("#home-q-list .cbx-all .ic")!),
        fieldIcon: center(document.querySelector("main .find-go .ic")!),
      };
    });
    expect(look.pop).toBe(look.field);
    expect(look.endIcon).toBe(look.fieldIcon);

    await page.goto(`${site.origin}/search/`, { waitUntil: "networkidle" });
    await page.locator("#search-page-q").focus();
    await page.keyboard.type("example-org/");
    await settled(page, "search-page-q");
    const rows = await page.locator("#search-page-q-list [role=option]").evaluateAll((options) => options.map((o) => Math.round(o.getBoundingClientRect().height)));
    expect(rows.every((h) => h === 44), JSON.stringify(rows)).toBe(true);
    expect(await page.locator("#search-page-q-list .cbx-desc").first().isVisible()).toBe(false);
  });
});

describe("너비·테마: 펼친 목록", () => {
  it.each([
    [375, "light"],
    [375, "dark"],
    [1280, "light"],
    [1280, "dark"],
  ] as const)("%ipx %s: 첫 화면·검색 쪽의 펼친 목록이 가로로 넘치지 않는다", async (width, scheme) => {
    const { page, outside } = await open("/", width, scheme);
    const bad: string[] = [];
    for (const [pathname, id] of [
      ["/", "home-q"],
      ["/search/", "search-page-q"],
      ["/search/?q=kids", "search-page-q"],
    ] as const) {
      if (pathname !== "/") await page.goto(`${site.origin}${pathname}`, { waitUntil: "networkidle" });
      await page.locator(`#${id}`).focus();
      await page.locator(`#${id}`).fill("");
      await page.keyboard.type("exa");
      await settled(page, id);
      const measured = await overflow(page);
      if (measured.page !== 0 || measured.over.length > 0) bad.push(`${pathname}: ${JSON.stringify(measured)}`);
    }
    expect(bad).toEqual([]);
    expect(outside).toEqual([]);
  });
});
