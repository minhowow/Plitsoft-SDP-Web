import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, BrowserContext } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { analysisHref, repoHref } from "@/lib/service/href";
import { STEP_ORDER } from "@/lib/service/steps";
import { openDatabase } from "@/server/db";
import { startGitHubStub } from "../../scripts/github-stub.mjs";
import { main as runLocalRunner } from "../../scripts/local-runner.mjs";
import { sign } from "../../runner/run.mjs";
import { readJson } from "../helpers";
import { closeChrome, launchChrome, NO_STORAGE, openPage, overflow, stored, serveSite, textContrast, type Site } from "./site";

// 운영 저장소 구현(DB + GitHub)으로 띄운 사이트를 연다. DB 는 이 시험만의 PGlite 폴더, GitHub 은 가짜 GitHub(scripts/github-stub.mjs)
// 이다. 실제 GitHub 과 DB 서버를 부르지 않는다. 합성 저장소로 띄운 사이트는 tests/browser/service.test.ts 가 본다.
//
// 서버를 띄우기 전에 DB 에 끝난 분석 하나(결과는 contract/cli-current 의 수집본)와 실패한 분석 하나를 넣어 둔다. PGlite 는 한
// 폴더를 두 프로세스가 함께 열 수 없어서, 넣은 뒤 닫고 서버를 띄운다.

let stub: Awaited<ReturnType<typeof startGitHubStub>>;
let site: Site;
let browser: Browser;
let dataDir: string;
const contexts: BrowserContext[] = [];
const problems: string[] = [];

const SUCCEEDED = "dbk7wq2zhm";
/** 시험용 고정 서명 열쇠(비밀값이 아니다). 서버와 로컬 실행기에 같이 준다. */
const RUNNER_SECRET = "browser-test-runner-secret";
const FAILED = "dbk7wq2zhn";
/** 띄울 때 대기 중으로 넣어 두는 분석(진행 다시 읽기와 탭이 숨었을 때 쉬는 것을 본다). 아무 실행기도 집어 가지 않는다. */
const WAITING = "dbk7wq2zhp";

beforeAll(async () => {
  stub = await startGitHubStub();
  dataDir = mkdtempSync(path.join(tmpdir(), "policypack-pglite-"));
  const db = await openDatabase({ databaseUrl: null, pgliteDir: dataDir });
  const commit = stub.head("example-org", "kids-signup");
  const at = (minutes: number) => new Date(Date.parse("2026-11-03T01:00:00Z") + minutes * 60_000).toISOString();
  const steps = STEP_ORDER.map((name, i) => ({ name, startedAt: at(i), endedAt: at(i + 1) }));
  const result = readJson("contract", "cli-current", "kids-signup.main.json") as { tool: { version: string }; run: { pack_digest: string }; findings: unknown[] };
  // 발견 수는 서버가 결과를 받을 때 세어 적는 열이다(src/server/callbacks.ts). 여기서는 같은 값을 손으로 적는다.
  await db.query(
    `INSERT INTO analyses (id, owner, repo, repo_key, commit_sha, branch, status, requested_at, finished_at, steps, tool_version, pack_digest, finding_count)
     VALUES ($1, 'example-org', 'kids-signup', 'example-org/kids-signup', $2, 'main', 'succeeded', $3, $4, $5::jsonb, $6, $7, $8)`,
    [SUCCEEDED, commit, at(0), at(5), JSON.stringify(steps), result.tool.version, result.run.pack_digest, result.findings.length],
  );
  await db.query("INSERT INTO results (analysis_id, json) VALUES ($1, $2)", [SUCCEEDED, JSON.stringify(result)]);
  await db.query(
    `INSERT INTO analyses (id, owner, repo, repo_key, commit_sha, branch, status, requested_at, finished_at, steps, failure_step, failure_reason)
     VALUES ($1, 'example-org', 'kids-signup', 'example-org/kids-signup', $2, 'main', 'failed', $3, $3, $4::jsonb, 'fetch', $5)`,
    [FAILED, "b".repeat(40), at(10), JSON.stringify(STEP_ORDER.map((name) => ({ name, startedAt: name === "queued" || name === "fetch" ? at(10) : null, endedAt: name === "queued" ? at(10) : null }))), "저장소를 받지 못했습니다(시험)."],
  );
  // 대기 중인 분석은 요청한 때가 지금이어야 한다(25분이 지나면 서버가 시간 초과로 적는다).
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO analyses (id, owner, repo, repo_key, commit_sha, branch, status, requested_at, steps)
     VALUES ($1, 'example-labs', 'plain.utils', 'example-labs/plain.utils', $2, 'main', 'queued', $3, $4::jsonb)`,
    [WAITING, "c".repeat(40), now, JSON.stringify(STEP_ORDER.map((name) => ({ name, startedAt: name === "queued" ? now : null, endedAt: null })))],
  );
  await db.close();
  site = await serveSite({ SERVICE_STORE: "db", PGLITE_DIR: dataDir, GITHUB_API_BASE: stub.origin, RUNNER: "local", RUNNER_SECRET });
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

const open = (pathname: string) => openPage(browser, site, pathname, { viewport: { width: 375, height: 800 }, colorScheme: "light", contexts, problems });

describe("DB + GitHub 으로 띄운 사이트", () => {
  it("첫 화면의 최근 분석은 DB 에서 온다. 합성 예시라고 적지 않는다", async () => {
    const { page, outside } = await open("/");
    expect(await page.locator(".recent-card").count()).toBe(1);
    expect(await page.locator(".recent-card").textContent()).toContain(SUCCEEDED);
    expect(await page.locator("main").textContent()).not.toContain("합성 예시입니다");
    expect(outside).toEqual([]);
  });

  it("검색은 서버가 (가짜) GitHub 을 불러 그리고, 저장소마다 이 사이트의 분석 수를 붙인다", async () => {
    const { page, outside } = await open("/search/?q=example");
    const rows = await page.locator(".repo-row").allTextContents();
    // 비공개 저장소는 나오지 않는다.
    expect(await page.locator(".repo-row .repo-link").allTextContents()).toEqual([
      "example-org / kids-signup",
      "example-org / night-push",
      "Example-Studio / GenAI-Chat",
      "example-labs / plain.utils",
      "example-labs / huge-monorepo",
    ]);
    expect(rows[0]).toContain("분석 2회");
    expect(rows[1]).toContain("분석된 적 없음");
    // 브라우저는 GitHub 을 부르지 않는다. 서버만 불렀다.
    expect(outside).toEqual([]);
    expect(stub.calls.some((call) => call.path.startsWith("/search/repositories"))).toBe(true);
  });

  it("저장소 쪽: GitHub 이 돌려준 이름, DB 의 분석 기록, 그리고 누를 수 있는 요청 단추", async () => {
    const { page, outside } = await open(repoHref("example-org", "kids-signup"));
    expect(await page.locator("h1").textContent()).toBe("example-org / kids-signup");
    expect(await page.locator(".an-list .an-row").count()).toBe(2);
    const button = page.locator(".request button");
    expect(await button.textContent()).toBe("다시 분석 요청");
    expect(await button.getAttribute("aria-disabled")).toBeNull();
    expect(await page.locator("#request-off").count()).toBe(0);
    // 가짜 GitHub 의 저장소 주소는 github.com 이 아니라 링크를 걸지 않는다.
    expect(await page.locator("a[href^='http']").count()).toBe(0);
    expect(outside).toEqual([]);
    expect(await stored(page)).toEqual(NO_STORAGE);
  });

  it("이름에 점이 든 저장소와 대소문자가 섞인 저장소도 열린다(주소는 소문자)", async () => {
    const { page } = await open(repoHref("example-labs", "plain.utils"));
    expect(await page.locator("h1").textContent()).toBe("example-labs / plain.utils");
    await page.goto(`${site.origin}/r/Example-Studio/GenAI-Chat/`);
    expect(page.url()).toBe(`${site.origin}${repoHref("example-studio", "genai-chat")}`);
    expect(await page.locator("h1").textContent()).toBe("Example-Studio / GenAI-Chat");
  });

  it("없거나 비공개인 저장소는 없는 쪽이다", async () => {
    for (const pathname of [repoHref("example-labs", "secret-repo"), repoHref("example-labs", "nothing"), analysisHref("example-org", "kids-signup", "zzzzzzzzzz")]) {
      const response = await fetch(`${site.origin}${pathname}`);
      await response.arrayBuffer();
      expect(response.status, pathname).toBe(404);
    }
  });

  it("끝난 분석은 대시보드, 실패한 분석은 멈춘 단계와 까닭", async () => {
    const { page } = await open(analysisHref("example-org", "kids-signup", SUCCEEDED));
    await page.waitForSelector(".dash");
    expect(await page.locator("main").textContent()).not.toContain("합성 예시입니다");
    await page.goto(`${site.origin}${analysisHref("example-org", "kids-signup", FAILED)}`);
    expect(await page.locator(".notice-warn").first().textContent()).toContain("저장소를 받지 못했습니다(시험).");
    expect(await page.locator(".step-failed .step-name").allTextContents()).toEqual(["저장소 받기·도구 설치"]);
  });

  it("요청을 받지 않으면 서버가 돌려준 까닭을 단추 옆에 그대로 적고, 단추는 다시 듣는다", async () => {
    // 가짜 GitHub 의 huge-monorepo 는 크기 상한(MAX_REPO_KB)을 넘는다. 서버가 정말 받지 않는다(422).
    const { page, outside } = await open(repoHref("example-labs", "huge-monorepo"));
    await page.locator(".request button").click();
    const note = page.locator("#request-note.request-refused");
    await note.waitFor();
    expect(await note.textContent()).toMatch(/^요청하지 못했습니다\. 저장소가 너무 커서 분석하지 않습니다\(GitHub 이 센 크기 [\d,]+KB, 상한 100,000KB\)\.$/);
    expect(await page.locator(".request button").getAttribute("aria-disabled")).toBeNull();
    expect(await page.locator(".request button").textContent()).toBe("분석 요청");
    expect(page.url()).toBe(`${site.origin}${repoHref("example-labs", "huge-monorepo")}`);
    expect(site.requests.filter((r) => r.method === "POST" && r.url === "/api/analyses/").at(-1)?.status).toBe(422);
    // 브라우저는 4xx 응답마다 콘솔에 한 줄을 남긴다. 이 시험은 그 응답을 일부러 받았다. 그 한 줄만 봐준다.
    expect(problems.splice(0)).toEqual(["콘솔: Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)"]);
    expect(outside).toEqual([]);
  });

  it("누르는 동안은 다시 눌러도 요청이 하나이고, 서버에 닿지 못하면 그렇다고 적는다", async () => {
    const { page } = await open(repoHref("example-org", "kids-signup"));
    let calls = 0;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/analyses/", async (route) => {
      calls += 1;
      await held;
      await route.abort();
    });
    const button = page.locator(".request button");
    await button.click();
    await page.locator(".request button[aria-busy='true']").waitFor();
    expect(await button.textContent()).toBe("요청하는 중…");
    expect(await button.getAttribute("aria-disabled")).toBe("true");
    // 키보드로도, 마우스로도 다시 누른다.
    await button.focus();
    await page.keyboard.press("Enter");
    await button.click({ force: true });
    expect(calls).toBe(1);
    release();
    await page.locator("#request-note.request-refused").waitFor();
    expect(await page.locator("#request-note").textContent()).toBe(
      "요청하지 못했습니다. 서버에 닿지 못했거나 응답을 읽지 못했습니다. 잠시 뒤 다시 요청해 주세요.",
    );
    expect(calls).toBe(1);
    expect(await button.getAttribute("aria-disabled")).toBeNull();
    // 끊은 요청은 콘솔에 한 줄을 남긴다.
    expect(problems.splice(0)).toEqual(["콘솔: Failed to load resource: net::ERR_FAILED"]);
  });

  it.each(["light", "dark"] as const)("%s 375px: 거절된 요청, 진행 중인 쪽, 진행을 읽지 못한 쪽이 넘치지 않고 글자 대비가 4.5:1 이상", async (scheme) => {
    const { page } = await openPage(browser, site, repoHref("example-labs", "huge-monorepo"), {
      viewport: { width: 375, height: 800 },
      colorScheme: scheme,
      contexts,
      problems,
    });
    const check = async (where: string) => {
      const measured = await overflow(page);
      expect(measured.page, where).toBe(0);
      expect(measured.over, where).toEqual([]);
      const contrast = await textContrast(page);
      expect(contrast.low, where).toEqual([]);
      expect(contrast.lowest, where).toBeGreaterThanOrEqual(4.5);
    };
    await page.locator(".request button").click();
    await page.locator("#request-note.request-refused").waitFor();
    await check("거절된 요청");
    expect(problems.splice(0)).toEqual(["콘솔: Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)"]);

    await page.goto(`${site.origin}${analysisHref("example-labs", "plain.utils", WAITING)}`, { waitUntil: "networkidle" });
    await check("진행 중");
    // 서버가 진행을 돌려주지 못하면 그렇다고 적고(빨간 글), 다시 읽기를 이어 간다.
    await page.route(`**/api/analyses/${WAITING}/`, (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, message: "DB 에 닿지 못했습니다(시험)." }) }),
    );
    const trouble = page.locator(".an-progress-trouble");
    await trouble.waitFor({ timeout: 5_000 });
    expect(await trouble.textContent()).toBe("진행을 다시 읽지 못했습니다. DB 에 닿지 못했습니다(시험). 잠시 뒤 다시 읽습니다.");
    await check("진행을 읽지 못함");
    await page.unroute(`**/api/analyses/${WAITING}/`);
    await trouble.waitFor({ state: "detached", timeout: 5_000 });
    expect(new Set(problems.splice(0))).toEqual(new Set(["콘솔: Failed to load resource: the server responded with a status of 503 (Service Unavailable)"]));
  });

  it("진행 중인 분석 쪽은 몇 초마다 다시 읽고, 탭이 숨으면 쉬고, 실패하면 다시 열지 않아도 멈춘 단계와 까닭을 그린다", async () => {
    const progress = `/api/analyses/${WAITING}/`;
    const polls = () => site.requests.filter((r) => r.method === "GET" && r.url === progress).length;
    const { page, outside } = await open(analysisHref("example-labs", "plain.utils", WAITING));
    await page.evaluate(() => ((window as unknown as { __sameDocument: boolean }).__sameDocument = true));
    expect(await page.locator(".step-active .step-name").allTextContents()).toEqual(["대기"]);
    expect(await page.locator(".an-progress").textContent()).toContain("몇 초마다 진행을 다시 읽고");
    await expect.poll(polls, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);

    // 탭을 숨긴다(헤드리스 Chrome 은 탭을 숨기지 못해 문서의 값을 바꾸고 알린다).
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hidden = polls();
    await page.waitForTimeout(4_000);
    expect(polls()).toBe(hidden);
    // 다시 보이면 곧바로 읽는다.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(polls, { timeout: 1_500 }).toBeGreaterThan(hidden);

    // 실행기가 저장소를 받기 시작하기 전에 멈췄다고 알린다(서명한 콜백. 실패는 지금 단계나 바로 다음 단계로 알린다).
    const body = JSON.stringify({
      event: "fail",
      step: "fetch",
      reason: "저장소를 받지 못했습니다(진행 시험).",
      target: { owner: "example-labs", repo: "plain.utils", commit: "c".repeat(40) },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const failed = await fetch(`${site.origin}/api/runner/${WAITING}/`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-runner-timestamp": timestamp, "x-runner-signature": sign(RUNNER_SECRET, timestamp, WAITING, body) },
      body,
    });
    await failed.arrayBuffer();
    expect(failed.status).toBe(200);
    await page.locator("#failed-title").waitFor({ timeout: 8_000 });
    expect(await page.locator(".notice-warn").first().textContent()).toContain("저장소를 받지 못했습니다(진행 시험).");
    expect(await page.locator(".an-title .badge").textContent()).toBe("실패");
    // 쪽을 다시 연 것이 아니라 같은 문서가 서버가 새로 그린 것을 받았다(router.refresh).
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
    // 끝난 뒤에는 더 읽지 않는다.
    const after = polls();
    await page.waitForTimeout(3_500);
    expect(polls()).toBe(after);
    expect(outside).toEqual([]);
    expect(await stored(page)).toEqual(NO_STORAGE);
  });

  it("요청 단추 → 로컬 실행기(--fixture) → 단계 콜백 → 결과: 분석 쪽이 스스로 단계를 다시 그리고 대시보드가 된다", async () => {
    const { page, outside } = await open(repoHref("example-org", "night-push"));
    await page.evaluate(() => ((window as unknown as { __sameDocument: boolean }).__sameDocument = true));
    expect(await page.locator(".request button").textContent()).toBe("분석 요청");
    await page.locator(".request button").click();
    await page.waitForURL(/\/r\/example-org\/night-push\/a\/[a-z0-9]{10}\/$/);
    const id = page.url().match(/\/a\/([a-z0-9]{10})\/$/)![1];
    expect(page.url()).toBe(`${site.origin}${analysisHref("example-org", "night-push", id)}`);
    const created = site.requests.filter((r) => r.method === "POST" && r.url === "/api/analyses/").at(-1);
    expect(created?.status).toBe(201);
    await page.locator(".an-title .badge").waitFor();
    expect(await page.locator(".an-title .badge").textContent()).toBe("대기 중");
    expect(await page.locator(".step-active .step-name").allTextContents()).toEqual(["대기"]);

    // 실행기는 단계 사이를 4초씩 쉰다. 쪽이 3초마다 읽으므로 중간 단계 하나는 쪽에 그려진다.
    const runner = runLocalRunner(["--fixture", "--once", "--step-delay", "4000", "--site", site.origin], { RUNNER_SECRET });
    try {
      await page.locator(".step-active .step-name", { hasText: /저장소 받기|검사/ }).waitFor({ timeout: 12_000 });
      expect(await page.locator(".an-title .badge").textContent()).toBe("분석 중");
      await page.locator(".dash").waitFor({ timeout: 15_000 });
    } finally {
      await runner;
    }
    expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
    expect(await page.locator("main").textContent()).not.toContain("합성 예시입니다");
    expect(await page.locator(".steps .step-done .step-name").allTextContents()).toEqual([
      "대기",
      "저장소 받기·도구 설치",
      "검사(정적 검사와 AI 판정)",
      "정리",
    ]);
    // 진행은 같은 사이트의 /api/ 로만 읽었다.
    expect(site.requests.filter((r) => r.url === `/api/analyses/${id}/`).length).toBeGreaterThanOrEqual(2);
    expect(outside).toEqual([]);
    expect(await stored(page)).toEqual(NO_STORAGE);

    // 같은 커밋을 다시 요청하면 새로 만들지 않고 그 분석으로 간다.
    await page.goto(`${site.origin}${repoHref("example-org", "night-push")}`);
    await page.locator(".request button").click();
    await page.waitForURL(`${site.origin}${analysisHref("example-org", "night-push", id)}`);
    expect(site.requests.filter((r) => r.method === "POST" && r.url === "/api/analyses/").at(-1)?.status).toBe(200);

    // 서명 없는 콜백은 서버가 받지 않는다.
    const forged = await fetch(`${site.origin}/api/runner/${id}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "fail", step: "finish", reason: "위조" }),
    });
    expect(forged.status).toBe(401);
  });
});
