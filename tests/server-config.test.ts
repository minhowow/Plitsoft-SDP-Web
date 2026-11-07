import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULTS, readConfig, showsSyntheticTag, usesFakeGitHub } from "@/server/config";
import { wakeRunner } from "@/server/runner";
import { root } from "./helpers";

// 서버 설정(src/server/config.ts)과 실행기 깨우기(src/server/runner.ts). 실제 GitHub 을 부르지 않는다.

describe("설정", () => {
  it("환경 변수가 없으면 기본값이다", () => {
    const config = readConfig({});
    expect(config.store).toBe("db");
    expect(config.databaseUrl).toBeNull();
    expect(config.pgliteDir).toBe(".data/pglite");
    expect(config.github).toEqual({
      apiBase: "https://api.github.com",
      token: null,
      searchCacheSeconds: 60,
      suggestCacheSeconds: 600,
      repoCacheSeconds: 300,
      commitCacheSeconds: 30,
      searchPerMinute: 10,
      searchReserve: 3,
      callsPerMinute: 60,
    });
    expect(config.limits).toEqual({
      maxRepoKb: 100_000,
      dedupeMinutes: 60,
      daily: 30,
      poolSize: 2,
      queueLimit: 20,
      runTimeoutMinutes: 25,
      dispatchTimeoutMinutes: 10,
      queueTimeoutMinutes: 120,
      maxResultKb: 4_000,
    });
    // 설정하지 않은 배포는 요청을 받지 않는다.
    expect(config.runner).toEqual({ kind: "none", repo: null, workflow: "analyze.yml", ref: "main", token: null, callbackBase: null, secret: null });
  });

  it("환경 변수로 바꾼다. 읽을 수 없는 수는 기본값으로 둔다(0·음수·글자를 받지 않는다)", () => {
    const config = readConfig({
      SERVICE_STORE: "synthetic",
      DATABASE_URL: "postgres://example.invalid/db",
      GITHUB_API_BASE: "http://127.0.0.1:4010/",
      GITHUB_TOKEN: "test-token",
      DAILY_LIMIT: "5",
      POOL_SIZE: "0",
      QUEUE_LIMIT: "7",
      DISPATCH_TIMEOUT_MINUTES: "x",
      QUEUE_TIMEOUT_MINUTES: "90",
      DEDUPE_MINUTES: "-3",
      MAX_REPO_KB: "lots",
      RUN_TIMEOUT_MINUTES: " 40 ",
      RUNNER: "github",
      RUNNER_REPO: "owner/runner",
      SITE_URL: "https://site.example/",
    });
    expect(config.store).toBe("synthetic");
    expect(config.databaseUrl).toBe("postgres://example.invalid/db");
    expect(config.github.apiBase).toBe("http://127.0.0.1:4010");
    expect(config.github.token).toBe("test-token");
    expect(config.limits).toEqual({
      maxRepoKb: DEFAULTS.maxRepoKb,
      dedupeMinutes: 60,
      daily: 5,
      poolSize: 2,
      queueLimit: 7,
      runTimeoutMinutes: 40,
      dispatchTimeoutMinutes: 10,
      queueTimeoutMinutes: 90,
      maxResultKb: DEFAULTS.maxResultKb,
    });
    expect(config.runner).toMatchObject({ kind: "github", repo: "owner/runner", callbackBase: "https://site.example" });
    expect(readConfig({ RUNNER: "anything" }).runner.kind).toBe("none");
    expect(readConfig({ SERVICE_STORE: "other" }).store).toBe("db");
  });

  it("실행 자리 수는 POOL_SIZE, 없으면 옛 이름 CONCURRENT_LIMIT 을 읽는다(둘 다 있으면 POOL_SIZE)", () => {
    expect(readConfig({ POOL_SIZE: "3" }).limits.poolSize).toBe(3);
    expect(readConfig({ CONCURRENT_LIMIT: "4" }).limits.poolSize).toBe(4);
    expect(readConfig({ POOL_SIZE: "3", CONCURRENT_LIMIT: "4" }).limits.poolSize).toBe(3);
    expect(readConfig({ POOL_SIZE: "nope", CONCURRENT_LIMIT: "4" }).limits.poolSize).toBe(4);
  });

  it("기본값이 docs/direction.md 의 표에 적혀 있다", () => {
    const doc = readFileSync(path.join(root, "docs", "direction.md"), "utf8");
    for (const [name, value] of [
      ["MAX_REPO_KB", DEFAULTS.maxRepoKb],
      ["DEDUPE_MINUTES", DEFAULTS.dedupeMinutes],
      ["DAILY_LIMIT", DEFAULTS.daily],
      ["POOL_SIZE", DEFAULTS.poolSize],
      ["QUEUE_LIMIT", DEFAULTS.queueLimit],
      ["RUN_TIMEOUT_MINUTES", DEFAULTS.runTimeoutMinutes],
      ["DISPATCH_TIMEOUT_MINUTES", DEFAULTS.dispatchTimeoutMinutes],
      ["QUEUE_TIMEOUT_MINUTES", DEFAULTS.queueTimeoutMinutes],
      ["SEARCH_CACHE_SECONDS", DEFAULTS.searchCacheSeconds],
      ["SUGGEST_CACHE_SECONDS", DEFAULTS.suggestCacheSeconds],
      ["REPO_CACHE_SECONDS", DEFAULTS.repoCacheSeconds],
      ["COMMIT_CACHE_SECONDS", DEFAULTS.commitCacheSeconds],
      ["GITHUB_SEARCH_PER_MINUTE", DEFAULTS.githubSearchPerMinute],
      ["GITHUB_SEARCH_RESERVE", DEFAULTS.githubSearchReserve],
      ["GITHUB_CALLS_PER_MINUTE", DEFAULTS.githubCallsPerMinute],
      ["RESULT_MAX_KB", DEFAULTS.maxResultKb],
    ] as const) {
      expect(doc, name).toMatch(new RegExp(`\\| \`${name}\` \\| ${value} \\|`));
    }
  });
});

describe("합성 예시 이름표의 조건 (docs/redesign.md 4장, D3)", () => {
  it("운영 설정(DB, 실제 GitHub)에서는 꺼져 있다", () => {
    expect(showsSyntheticTag(readConfig({}))).toBe(false);
    expect(showsSyntheticTag(readConfig({ GITHUB_API_BASE: "https://api.github.com/" }))).toBe(false);
    expect(showsSyntheticTag(readConfig({ DATABASE_URL: "postgres://example.invalid/db", RUNNER: "github", GITHUB_TOKEN: "x" }))).toBe(false);
    expect(usesFakeGitHub(readConfig({}))).toBe(false);
  });

  it("합성 저장소(SERVICE_STORE=synthetic)이거나 GitHub 이 가짜(GITHUB_API_BASE 가 기본값이 아님)이면 켠다", () => {
    expect(showsSyntheticTag(readConfig({ SERVICE_STORE: "synthetic" }))).toBe(true);
    expect(showsSyntheticTag(readConfig({ GITHUB_API_BASE: "http://127.0.0.1:4010" }))).toBe(true);
    expect(usesFakeGitHub(readConfig({ GITHUB_API_BASE: "http://127.0.0.1:4010" }))).toBe(true);
    // 합성 저장소는 GitHub 을 부르지 않으므로 가짜 GitHub 안내와는 따로다.
    expect(usesFakeGitHub(readConfig({ SERVICE_STORE: "synthetic" }))).toBe(false);
  });
});

describe("실행기 깨우기", () => {
  const base = readConfig({});
  const input = { analysisId: "abcdefghjk", owner: "o", repo: "r", commit: "a".repeat(40), callbackBase: "https://site.example" };

  it("RUNNER=local 은 아무것도 부르지 않는다", async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    expect(await wakeRunner({ ...base, runner: { ...base.runner, kind: "local" } }, input, fetcher)).toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  it("RUNNER=github 은 실행기 저장소의 워크플로를 workflow_dispatch 로 부른다", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const config = { ...base, runner: { ...base.runner, kind: "github" as const, repo: "owner/runner", token: "test-runner-token" } };
    expect(await wakeRunner(config, input, fetcher)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.github.com/repos/owner/runner/actions/workflows/analyze.yml/dispatches");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer test-runner-token");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      ref: "main",
      inputs: { analysis_id: "abcdefghjk", owner: "o", repo: "r", commit: "a".repeat(40), callback_url: "https://site.example/api/runner/abcdefghjk/" },
    });
  });

  it("설정이 모자라거나 GitHub 이 받지 않으면 까닭을 돌려준다(토큰·응답 본문을 싣지 않는다)", async () => {
    const github = { ...base.runner, kind: "github" as const, repo: "owner/runner", token: "test-runner-token" };
    const refuse = (async () => new Response('{"message":"Bad credentials test-runner-token"}', { status: 401 })) as unknown as typeof fetch;
    const failed = await wakeRunner({ ...base, runner: github }, input, refuse);
    expect(failed).toEqual({ ok: false, reason: "실행기(GitHub Actions)가 분석을 받지 않았습니다(응답 401)." });
    expect(await wakeRunner({ ...base, runner: { ...github, token: null } }, input, refuse)).toMatchObject({ ok: false });
    expect(await wakeRunner({ ...base, runner: { ...github, repo: "../x" } }, input, refuse)).toMatchObject({ ok: false });
    expect(await wakeRunner({ ...base, runner: github }, { ...input, callbackBase: null }, refuse)).toMatchObject({ ok: false });
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await wakeRunner({ ...base, runner: github }, input, down)).toEqual({
      ok: false,
      reason: "실행기(GitHub Actions)에 닿지 못해 분석을 시작하지 못했습니다.",
    });
  });
});
