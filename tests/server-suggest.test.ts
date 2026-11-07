import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { githubSuggestQuery, type GitHubSuggestQuery, type SuggestResponse } from "@/lib/service/suggest";
import { syntheticStore } from "@/lib/service/synthetic";
import { SITE } from "@/lib/site";
import { getSuggestions, postAnalysis, type ApiDeps } from "@/server/api";
import { createSharedBudget } from "@/server/budget";
import { DEFAULTS, localRunnerOnRealGitHub, readConfig, type ServerConfig } from "@/server/config";
import { openDatabase, type Database } from "@/server/db";
import { createGitHub, GitHubError, isGitHubError, localBudget, SUGGEST_TIMEOUT_MS, type GitHubOptions } from "@/server/github";
import { createDbStore } from "@/server/store/db";
import { createGitHubStub } from "../scripts/github-stub.mjs";

// 자동 완성의 서버 쪽(docs/redesign.md 5장): GitHub 클라이언트의 suggest(질의·캐시·함께 기다리기·다시 쓰기·시간 초과·상한),
// 검색 예산의 검색 쪽 몫, 설정의 기본값, `GET /api/repos/suggest/`(메모리 PGlite + 가짜 GitHub), 합성 저장소, 로컬 실행기와 실제
// GitHub 의 거절. 실제 GitHub·DB 서버를 부르지 않는다.

const BASE = "http://stub.test";
const T0 = new Date("2026-11-03T03:00:00Z");

let db: Database;
beforeAll(async () => {
  db = await openDatabase({ databaseUrl: null, pgliteDir: "memory://" });
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.query("DELETE FROM results");
  await db.query("DELETE FROM analyses");
  await db.query("DELETE FROM github_budget");
});

const built = (text: string): GitHubSuggestQuery => {
  const result = githubSuggestQuery(text);
  if (!result.ok) throw new Error(text);
  return result.query;
};

function client(options: Partial<GitHubOptions> & { stub?: ReturnType<typeof createGitHubStub> } = {}) {
  const stub = options.stub ?? createGitHubStub({ origin: BASE });
  const seen: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    seen.push(String(input));
    return stub.fetch(input, init);
  };
  const github = createGitHub({ apiBase: BASE, token: null, searchCacheSeconds: 60, repoCacheSeconds: 300, fetch: fetcher, ...options });
  return { github, stub, seen };
}

describe("GitHub 클라이언트의 자동 완성 (suggest)", () => {
  it("검색 API 를 한 번, per_page=10 으로 부르고 core(저장소 정보·목록)는 부르지 않는다", async () => {
    const { github, seen } = client();
    const page = await github.suggest(built("example-org/kid"));
    expect(page.repositories.map((r) => `${r.owner}/${r.name}`)).toEqual(["example-org/kids-signup"]);
    expect(page).toMatchObject({ total: 1, complete: true });
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0]);
    expect(url.pathname).toBe("/search/repositories");
    expect(url.searchParams.get("q")).toBe("user:example-org kid in:name is:public");
    expect(url.searchParams.get("per_page")).toBe("10");
    expect(seen.some((u) => new URL(u).pathname.startsWith("/repos/") || new URL(u).pathname.startsWith("/users/"))).toBe(false);
  });

  it("결과를 600초 둔다(대소문자 없이 같은 질의)", async () => {
    let now = 0;
    const { github, seen } = client({ now: () => now });
    await github.suggest(built("night"));
    await github.suggest(built("NIGHT"));
    now += 599_000;
    await github.suggest(built("night"));
    expect(seen).toHaveLength(1);
    now += 1_000;
    await github.suggest(built("night"));
    expect(seen).toHaveLength(2);
  });

  it("같은 질의가 동시에 오면 한 번만 부른다", async () => {
    const stub = createGitHubStub({ origin: BASE, delayMs: 50 });
    const { github, seen } = client({ stub });
    const pages = await Promise.all([github.suggest(built("plain")), github.suggest(built("plain")), github.suggest(built("Plain"))]);
    expect(seen).toHaveLength(1);
    expect(pages.every((page) => page.repositories.length === 1)).toBe(true);
  });

  it("앞 질의의 결과가 모두였으면 늘인 질의는 걸러 다시 쓰고 GitHub 을 부르지 않는다. 모두가 아니면 다시 부른다", async () => {
    const { github, seen } = client();
    // example-org 의 공개 저장소는 둘이다(per_page 10 안에 모두).
    expect((await github.suggest(built("example-org/"))).complete).toBe(true);
    const reused = await github.suggest(built("example-org/nig"));
    expect(reused.repositories.map((r) => r.name)).toEqual(["night-push"]);
    expect(reused).toMatchObject({ total: 1, complete: true });
    expect(seen).toHaveLength(1);
    // 다른 owner 는 다시 쓰지 않는다.
    await github.suggest(built("example-labs/pla"));
    expect(seen).toHaveLength(2);

    // 모두가 아니면(GitHub 이 센 수가 받은 수보다 많다) 다시 쓰지 않는다.
    const many = createGitHubStub({
      origin: BASE,
      repositories: Array.from({ length: 12 }, (_, i) => ({ owner: "many-org", name: `repo-${i}`, description: "합성", language: "TypeScript", size: 1, fixture: null, private: false })),
    });
    const other = client({ stub: many });
    expect((await other.github.suggest(built("many-org/"))).complete).toBe(false);
    await other.github.suggest(built("many-org/repo"));
    expect(other.seen).toHaveLength(2);
  });

  it("다시 쓴 답은 GitHub 에 바로 물은 답과 같다(이름 검색·owner 검색. 앞 결과가 이름 밖의 것으로 맞았으면 다시 묻는다. D4 검토)", async () => {
    const names = (page: { repositories: { owner: string; name: string }[] }) => page.repositories.map((r) => `${r.owner}/${r.name}`);
    for (const [first, next] of [
      ["exa", "exam"],
      ["exa", "example"],
      ["example-org/exa", "example-org/exam"],
      ["example-org/", "example-org/nig"],
      ["example-org/n", "example-org/night"],
      ["gen", "genai"],
      ["pla", "plain"],
    ] as const) {
      const typed = client();
      await typed.github.suggest(built(first));
      const reused = await typed.github.suggest(built(next));
      const direct = await client().github.suggest(built(next));
      expect(names(reused), `${first} → ${next}`).toEqual(names(direct));
      expect(reused.total, `${first} → ${next}`).toBe(direct.total);
    }

    // 앞 결과에 이름이 앞 글자를 품지 않은 것이 있으면(GitHub 이 owner 등으로 맞췄다) 걸러 쓰지 않고 다시 묻는다.
    // 이 가짜는 어느 질의에나 owner 로 맞춘 저장소 하나(이름에 exa 가 없다)를 돌려준다.
    const seen: string[] = [];
    const items = [{ name: "night-push", owner: { login: "example-org" }, private: false, visibility: "public", default_branch: "main" }];
    const loose = createGitHub({
      apiBase: BASE,
      token: null,
      searchCacheSeconds: 60,
      repoCacheSeconds: 300,
      fetch: async (input) => {
        seen.push(String(input));
        return new Response(JSON.stringify({ total_count: 1, incomplete_results: false, items }), { status: 200 });
      },
    });
    await loose.suggest(built("exa"));
    expect((await loose.suggest(built("exam"))).repositories.map((r) => r.name)).toEqual(["night-push"]);
    expect(seen).toHaveLength(2);
  });

  it("걸러 다시 쓴 답도 처음 받은 때부터 600초까지만 쓴다(걸러 낼 때마다 시간이 새로 시작하지 않는다. D4 검토)", async () => {
    let now = 0;
    const { github, seen } = client({ now: () => now });
    await github.suggest(built("example-org/"));
    now = 590_000;
    await github.suggest(built("example-org/k"));
    expect(seen).toHaveLength(1);
    now = 601_000;
    // 다시 쓴 'example-org/k' 도 t=0 에 받은 것이라 끝났다. GitHub 을 다시 부른다.
    await github.suggest(built("example-org/ki"));
    expect(seen).toHaveLength(2);
    await github.suggest(built("example-org/k"));
    expect(seen).toHaveLength(3);
  });

  it("3초가 넘으면 timeout 이다(AbortController. 실제 시계로 3초를 기다린다)", async () => {
    const stub = createGitHubStub({ origin: BASE, delayMs: SUGGEST_TIMEOUT_MS + 2_000 });
    const { github } = client({ stub });
    const started = Date.now();
    const error = (await github.suggest(built("kids")).catch((e: unknown) => e)) as GitHubError;
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(SUGGEST_TIMEOUT_MS + 1_500);
  }, 10_000);

  it("GitHub 의 403(remaining 0)·429 는 rate-limit, 5xx 와 닿지 못함은 unavailable", async () => {
    const limited = client();
    limited.stub.setSearchLimit(0);
    expect(await limited.github.suggest(built("kids")).catch((e: GitHubError) => e.kind)).toBe("rate-limit");
    const tooMany = createGitHub({ apiBase: BASE, token: null, searchCacheSeconds: 60, repoCacheSeconds: 300, fetch: async () => new Response("{}", { status: 429 }) });
    expect(await tooMany.suggest(built("kids")).catch((e: GitHubError) => e.kind)).toBe("rate-limit");
    // 2차 한도: 403 인데 남은 수가 0 이 아니다. retry-after 머리나 본문의 'rate limit' 으로 가린다(D4 검토).
    const secondary = (headers: Record<string, string>, message: string) =>
      createGitHub({
        apiBase: BASE,
        token: null,
        searchCacheSeconds: 60,
        repoCacheSeconds: 300,
        fetch: async () => new Response(JSON.stringify({ message }), { status: 403, headers: { "x-ratelimit-remaining": "25", ...headers } }),
      });
    expect(await secondary({ "retry-after": "60" }, "").suggest(built("kids")).catch((e: GitHubError) => e.kind)).toBe("rate-limit");
    expect(await secondary({}, "You have exceeded a secondary rate limit.").suggest(built("kids")).catch((e: GitHubError) => e.kind)).toBe("rate-limit");
    expect(await secondary({}, "Resource not accessible").suggest(built("kids")).catch((e: GitHubError) => e.kind)).toBe("unavailable");
    const broken = createGitHub({ apiBase: BASE, token: null, searchCacheSeconds: 60, repoCacheSeconds: 300, fetch: async () => new Response("oops", { status: 502 }) });
    expect(await broken.suggest(built("kids")).catch((e: GitHubError) => e.kind)).toBe("unavailable");
    const down = createGitHub({
      apiBase: BASE,
      token: null,
      searchCacheSeconds: 60,
      repoCacheSeconds: 300,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await down.suggest(built("kids")).catch((e: GitHubError) => e.kind)).toBe("unavailable");
  });

  it("GitHubError 는 이름과 갈래로 가린다(다른 묶음이 만든 같은 이름의 클래스도. instanceof 에 기대지 않는다)", () => {
    expect(isGitHubError(new GitHubError("rate-limit", "x"))).toBe(true);
    const foreign = Object.assign(new Error("x"), { name: "GitHubError", kind: "timeout" });
    expect(isGitHubError(foreign)).toBe(true);
    expect(isGitHubError(Object.assign(new Error("x"), { name: "GitHubError", kind: "other" }))).toBe(false);
    expect(isGitHubError(new TypeError("fetch failed"))).toBe(false);
    expect(isGitHubError({ name: "GitHubError", kind: "timeout" })).toBe(false);
  });

  it("가짜 GitHub 은 요청 수 상한 머리를 싣는다", async () => {
    const stub = createGitHubStub({ origin: BASE, searchPerMinute: 2, now: () => T0.getTime() });
    const first = stub.respond("GET", "/search/repositories?q=kids");
    expect(first.headers).toMatchObject({ "x-ratelimit-limit": "2", "x-ratelimit-remaining": "1", "x-ratelimit-reset": String(Math.ceil((T0.getTime() + 60_000) / 1000)) });
    stub.respond("GET", "/search/repositories?q=kids");
    const third = stub.respond("GET", "/search/repositories?q=kids");
    expect(third.status).toBe(403);
    expect((third.headers as Record<string, string>)["x-ratelimit-remaining"]).toBe("0");
  });
});

describe("검색 예산: 검색 쪽(/search) 몫", () => {
  it("이 서버 메모리의 통: 자동 완성은 몫(3)을 남기고, 검색 쪽은 그 몫까지 꺼낸다", () => {
    const take = localBudget({ searchPerMinute: 10, searchReserve: 3 }, () => 0);
    let suggested = 0;
    while (take("suggest")) suggested += 1;
    expect(suggested).toBe(7);
    let searched = 0;
    while (take("search")) searched += 1;
    expect(searched).toBe(3);
  });

  it("함께 쓰는 DB 의 카운터: 자동 완성은 상한-몫까지, 검색 쪽은 남긴 몫을 꺼낸다. 한 행(search)을 함께 센다", async () => {
    const take = createSharedBudget({ db: async () => db, searchPerMinute: 5, searchReserve: 3, callsPerMinute: 60, now: () => T0.getTime() });
    expect(await take("suggest")).toBe(true);
    expect(await take("suggest")).toBe(true);
    expect(await take("suggest")).toBe(false);
    expect(await take("search")).toBe(true);
    expect(await take("search")).toBe(true);
    expect(await take("search")).toBe(true);
    expect(await take("search")).toBe(false);
    expect((await db.query("SELECT bucket, used FROM github_budget")).rows).toEqual([{ bucket: "search", used: 5 }]);
  });

  it("몫은 늘 상한보다 작다(상한 1 이면 몫 0. 자동 완성도 하나는 꺼낸다)", async () => {
    const take = createSharedBudget({ db: async () => db, searchPerMinute: 1, searchReserve: 3, callsPerMinute: 60, now: () => T0.getTime() });
    expect(await take("suggest")).toBe(true);
    expect(await take("search")).toBe(false);
  });

  it("예산이 비면 GitHub 을 부르지 않고 rate-limit 이다(자동 완성의 limited)", async () => {
    const { github, seen } = client({ searchPerMinute: 4, searchReserve: 3, now: () => 0 });
    await github.suggest(built("kids"));
    expect(await github.suggest(built("night")).catch((e: GitHubError) => e.kind)).toBe("rate-limit");
    expect(seen).toHaveLength(1);
    // 검색 쪽은 남긴 몫으로 부른다.
    await github.search("plain");
    expect(seen).toHaveLength(2);
  });
});

describe("설정: 검색 예산의 기본값", () => {
  it("토큰이 있으면 1분 25번, 없으면 10번. 검색 쪽 몫 3. 환경 변수로 바꾸고, 몫은 상한보다 작게 읽는다", () => {
    expect(readConfig({}).github).toMatchObject({ searchPerMinute: 10, searchReserve: 3, suggestCacheSeconds: 600 });
    expect(readConfig({ GITHUB_TOKEN: "test-token" }).github).toMatchObject({ searchPerMinute: 25, searchReserve: 3 });
    expect(DEFAULTS).toMatchObject({ githubSearchPerMinute: 10, githubSearchPerMinuteWithToken: 25, githubSearchReserve: 3, suggestCacheSeconds: 600 });
    expect(readConfig({ GITHUB_TOKEN: "t", GITHUB_SEARCH_PER_MINUTE: "12" }).github.searchPerMinute).toBe(12);
    expect(readConfig({ GITHUB_SEARCH_RESERVE: "0" }).github.searchReserve).toBe(0);
    expect(readConfig({ GITHUB_SEARCH_RESERVE: "5" }).github.searchReserve).toBe(5);
    expect(readConfig({ GITHUB_SEARCH_RESERVE: "10" }).github.searchReserve).toBe(9);
    expect(readConfig({ GITHUB_SEARCH_PER_MINUTE: "1" }).github.searchReserve).toBe(0);
    expect(readConfig({ GITHUB_SEARCH_RESERVE: "x" }).github.searchReserve).toBe(3);
    expect(readConfig({ SUGGEST_CACHE_SECONDS: "30" }).github.suggestCacheSeconds).toBe(30);
  });
});

// ---- GET /api/repos/suggest/ (메모리 PGlite + 가짜 GitHub) ----

function setup(env: Record<string, string> = {}, stub = createGitHubStub({ origin: BASE })) {
  const config: ServerConfig = readConfig({ RUNNER: "none", GITHUB_API_BASE: BASE, ...env });
  const store = createDbStore({
    db: async () => db,
    github: createGitHub({ ...config.github, apiBase: BASE, fetch: stub.fetch as typeof fetch, now: () => T0.getTime() }),
    config,
    now: () => T0,
  });
  const deps: ApiDeps = { store: () => store, db: async () => db, config: () => config, now: () => T0 };
  return { deps, stub, config };
}

async function suggest(deps: ApiDeps, q: string, scope = "") {
  const response = await getSuggestions(new Request(`http://site.test/api/repos/suggest/?q=${encodeURIComponent(q)}${scope}`), deps);
  return { status: response.status, cache: response.headers.get("cache-control"), body: (await response.json()) as SuggestResponse };
}

/** 분석 행을 바로 넣는다. */
async function analysis(id: string, owner: string, repo: string, minutes: number, status = "succeeded") {
  const at = new Date(T0.getTime() + minutes * 60_000);
  await db.query(
    `INSERT INTO analyses (id, owner, repo, repo_key, commit_sha, branch, status, requested_at, steps)
     VALUES ($1, $2, $3, $4, $5, 'main', $6, $7, '[]'::jsonb)`,
    [id, owner, repo, `${owner}/${repo}`.toLowerCase(), id.padEnd(40, "0").slice(0, 40).replace(/[^0-9a-f]/g, "a"), status, at],
  );
}

describe("GET /api/repos/suggest/", () => {
  it("늘 200·no-store. 이 사이트의 줄은 owner/name 에 친 글자가 그대로 든 것(부분 문자열, 대소문자 없이), 가장 나중에 요청한 차례", async () => {
    await analysis("sugaaaaaa5", "example-org", "kids-signup", -30);
    await analysis("sugaaaaaa6", "example-org", "kids-signup", -10);
    await analysis("sugaaaaaa7", "Example-Studio", "GenAI-Chat", -20);
    await analysis("sugaaaaaa8", "other-org", "notes", -5);
    const { deps } = setup();
    const { status, cache, body } = await suggest(deps, "EXAMPLE");
    expect(status).toBe(200);
    expect(cache).toBe("no-store");
    expect(body.q).toBe("EXAMPLE");
    expect(body.site).toEqual([
      { owner: "example-org", name: "kids-signup", analyses: 2, latestAt: new Date(T0.getTime() - 10 * 60_000).toISOString() },
      { owner: "Example-Studio", name: "GenAI-Chat", analyses: 1, latestAt: new Date(T0.getTime() - 20 * 60_000).toISOString() },
    ]);
    // 이름 한가운데의 글자도 맞는다(부분 문자열). 1글자부터.
    expect((await suggest(deps, "ignu")).body.site?.map((r) => r.name)).toEqual(["kids-signup"]);
    expect((await suggest(deps, "o")).body.site?.map((r) => r.name)).toEqual(["notes", "kids-signup", "GenAI-Chat"]);
    // LIKE 의 특수 글자는 글자 그대로다.
    expect((await suggest(deps, "%")).body.site).toEqual([]);
    expect((await suggest(deps, "_")).body.site).toEqual([]);
  });

  it("GitHub 결과와 합쳐 겹침을 빼고(이 사이트의 줄이 남는다) 상태 ok 와 수를 싣는다. 이름표와 가짜 GitHub 안내는 서버가 정한다", async () => {
    await analysis("sugbbbbbb5", "example-org", "kids-signup", -10);
    const { deps } = setup();
    // 가짜 GitHub 의 in:name 은 이름만 본다(D4 검토). owner 의 공개 저장소를 묻는 꼴(example-org/)로 두 출처를 함께 본다.
    const { body } = await suggest(deps, "example-org/");
    expect(body.site?.map((r) => r.name)).toEqual(["kids-signup"]);
    expect(body.github?.status).toBe("ok");
    expect(body.github?.total).toBe(2);
    expect(body.github?.items.map((r) => `${r.owner}/${r.name}`)).toEqual(["example-org/night-push"]);
    expect(body.github?.items[0]).toEqual({ owner: "example-org", name: "night-push", description: "마케팅 앱 푸시를 보내는 코드", language: "TypeScript" });
    // 별 수 같은 인기 수치는 싣지 않는다.
    expect(JSON.stringify(body)).not.toMatch(/star|watch|fork/i);
    expect(body).toMatchObject({ tagged: true, fakeGitHub: true });
  });

  it("scope=site 면 GitHub 을 부르지 않고 github 는 null 이다", async () => {
    const { deps, stub } = setup();
    const { body } = await suggest(deps, "exa", "&scope=site");
    expect(body.github).toBeNull();
    expect(stub.calls).toEqual([]);
  });

  it("묻지 않는 질의는 skipped(까닭과 함께), GitHub 을 부르지 않는다", async () => {
    const { deps, stub } = setup();
    expect((await suggest(deps, "ex")).body.github).toEqual({ status: "skipped", items: [], total: null, skipped: "short" });
    expect((await suggest(deps, "exa user:octo")).body.github).toMatchObject({ status: "skipped", skipped: "chars" });
    expect((await suggest(deps, "회원가입")).body.github).toMatchObject({ status: "skipped", skipped: "chars" });
    expect(stub.calls).toEqual([]);
  });

  it("GitHub 에 없으면 ok·0, 상한이면 limited, 3초 넘으면 timeout, 닿지 못하면 unavailable. 이 사이트의 줄은 그대로다", async () => {
    await analysis("sugcccccc5", "example-org", "kids-signup", -10);
    const none = setup();
    expect((await suggest(none.deps, "zzzz")).body.github).toEqual({ status: "ok", items: [], total: 0 });

    const limited = setup();
    limited.stub.setSearchLimit(0);
    const answer = (await suggest(limited.deps, "kids")).body;
    expect(answer.github).toEqual({ status: "limited", items: [], total: null });
    expect(answer.site?.map((r) => r.name)).toEqual(["kids-signup"]);

    // 이 사이트의 예산(검색 쪽 몫을 남긴 것)이 다 되어도 limited 다.
    const budget = setup({ GITHUB_SEARCH_PER_MINUTE: "4", GITHUB_SEARCH_RESERVE: "3" });
    expect((await suggest(budget.deps, "night")).body.github?.status).toBe("ok");
    expect((await suggest(budget.deps, "plain")).body.github?.status).toBe("limited");

    const slow = setup({}, createGitHubStub({ origin: BASE, delayMs: 10_000 }));
    expect((await suggest(slow.deps, "genai")).body.github?.status).toBe("timeout");

    const config = readConfig({ RUNNER: "none", GITHUB_API_BASE: BASE });
    const store = createDbStore({
      db: async () => db,
      github: createGitHub({
        ...config.github,
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      }),
      config,
    });
    const down = await suggest({ store: () => store, db: async () => db, config: () => config, now: () => T0 }, "kids");
    expect(down.body.github?.status).toBe("unavailable");
    expect(down.status).toBe(200);
  }, 15_000);

  it("DB 를 읽지 못하면 site 는 null 이고 GitHub 은 그대로 묻는다. 질의는 어디에도 적지 않는다", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stub = createGitHubStub({ origin: BASE });
    const config = readConfig({ RUNNER: "none", GITHUB_API_BASE: BASE });
    const store = createDbStore({
      db: async () => {
        throw new Error("connect ECONNREFUSED");
      },
      github: createGitHub({ ...config.github, fetch: stub.fetch as typeof fetch }),
      config,
    });
    const deps: ApiDeps = { store: () => store, db: async () => db, config: () => config, now: () => T0 };
    const { status, body } = await suggest(deps, "secret-query-kids");
    expect(status).toBe(200);
    expect(body.site).toBeNull();
    expect(body.github?.status).toBe("ok");
    // 모르는 오류여도 200 이고, 남기는 기록에 질의가 없다.
    // 열린 DB 의 읽기가 틀려도 이 출처만 null 이다. GitHub 의 답(ok)을 '연결 실패'로 덮지 않는다(D4 검토).
    const queryFails = createDbStore({
      db: async () => ({ ...db, query: async () => Promise.reject(new RangeError("secret-query-kids")) }) as unknown as Database,
      github: createGitHub({ ...config.github, fetch: stub.fetch as typeof fetch }),
      config,
    });
    const misread = await suggest({ ...deps, store: () => queryFails }, "secret-query-kids");
    expect(misread.status).toBe(200);
    expect(misread.body.site).toBeNull();
    expect(misread.body.github?.status).toBe("ok");
    const broken: ApiDeps = { ...deps, store: () => ({ ...store, suggest: async () => Promise.reject(new RangeError("secret-query-kids")) }) };
    const failed = await suggest(broken, "secret-query-kids");
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ site: null, github: { status: "unavailable" } });
    expect(quiet.mock.calls.flat().join(" ")).not.toContain("secret-query");
    quiet.mockRestore();
  });

  it("빈 질의·빈칸·제어 문자뿐이면 묻지 않고 빈 답이다. 질의는 다듬어 100자까지", async () => {
    const { deps, stub } = setup();
    expect((await suggest(deps, "  \u0000 ")).body).toMatchObject({ q: "", site: [], github: null });
    expect((await suggest(deps, "a".repeat(300))).body.q).toHaveLength(100);
    expect(stub.calls.filter((call) => call.path.startsWith("/search/"))).toHaveLength(1);
  });

  it("운영 설정(실제 GitHub, DB)에서는 이름표와 가짜 GitHub 안내가 꺼져 있다", async () => {
    const config = readConfig({});
    const stub = createGitHubStub({ origin: BASE });
    const store = createDbStore({ db: async () => db, github: createGitHub({ ...config.github, apiBase: BASE, fetch: stub.fetch as typeof fetch }), config });
    const { body } = await suggest({ store: () => store, db: async () => db, config: () => config, now: () => T0 }, "exa");
    expect(body).toMatchObject({ tagged: false, fakeGitHub: false });
  });

  it("합성 저장소(SERVICE_STORE=synthetic)는 바깥에 묻지 않고 분석된 합성 저장소로 답한다. GitHub 은 off", async () => {
    const config = readConfig({ SERVICE_STORE: "synthetic" });
    const fetcher = vi.spyOn(globalThis, "fetch");
    const deps: ApiDeps = { store: () => syntheticStore, db: async () => db, config: () => config, now: () => T0 };
    const { body } = await suggest(deps, "exa");
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
    expect(body.site?.map((r) => `${r.owner}/${r.name}`)).toEqual([
      "example-labs/shop-front",
      "example-org/night-push",
      "example-studio/genai-chat",
      "example-org/kids-signup",
      "example-labs/plain-utils",
    ]);
    // 분석된 적 없는 합성 저장소(todo-web)는 이 사이트의 줄이 아니다.
    expect((await suggest(deps, "todo")).body.site).toEqual([]);
    expect(body.github).toEqual({ status: "off", items: [], total: null });
    expect(body).toMatchObject({ tagged: true, fakeGitHub: false });
  });
});

describe("로컬을 정직하게: RUNNER=local 인데 GitHub 이 실제 주소면 분석 요청을 받지 않는다", () => {
  it("설정에서 가른다", () => {
    expect(localRunnerOnRealGitHub(readConfig({ RUNNER: "local" }))).toBe(true);
    expect(localRunnerOnRealGitHub(readConfig({ RUNNER: "local", GITHUB_API_BASE: "https://api.github.com/" }))).toBe(true);
    expect(localRunnerOnRealGitHub(readConfig({ RUNNER: "local", GITHUB_API_BASE: "http://127.0.0.1:4010" }))).toBe(false);
    expect(localRunnerOnRealGitHub(readConfig({ RUNNER: "github" }))).toBe(false);
  });

  it("저장소 쪽의 까닭(requestsClosed)과 POST /api/analyses/ 가 같은 까닭으로 거절한다(503 closed). GitHub 을 부르지 않는다", async () => {
    const stub = createGitHubStub({ origin: BASE });
    const config = readConfig({ RUNNER: "local", RUNNER_SECRET: "test-secret" });
    const store = createDbStore({ db: async () => db, github: createGitHub({ ...config.github, apiBase: BASE, fetch: stub.fetch as typeof fetch }), config });
    expect(store.requestsClosed()).toBe(SITE.service.localRealGitHub);
    const deps: ApiDeps = { store: () => store, db: async () => db, config: () => config, now: () => T0 };
    const response = await postAnalysis(
      new Request("http://site.test/api/analyses/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: "example-org", repo: "kids-signup" }) }),
      deps,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: "closed", message: SITE.service.localRealGitHub });
    expect(stub.calls).toEqual([]);
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM analyses")).rows[0].n).toBe(0);
  });
});
