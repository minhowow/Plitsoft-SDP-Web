import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceUnavailableError } from "@/lib/service/errors";
import { isAnalysisId } from "@/lib/service/id";
import { STEP_ORDER } from "@/lib/service/steps";
import type { RequestOutcome, ServiceStore } from "@/lib/service/types";
import { SITE } from "@/lib/site";
import { DEFAULTS, readConfig, type ServerConfig } from "@/server/config";
import { migrate, openDatabase, readMigrations, type Database } from "@/server/db";
import { createGitHub } from "@/server/github";
import type { WakeOutcome } from "@/server/runner";
import { createDbStore, kstDayStart, stalledStep } from "@/server/store/db";
import { createGitHubStub } from "../scripts/github-stub.mjs";

// 운영 저장소 구현(DB + GitHub, src/server/store/db.ts)을 메모리의 PGlite 와 가짜 GitHub 으로 돌린다. 실제 GitHub 과 DB 서버를
// 부르지 않는다. 같은 SQL 이 운영의 Postgres 에서 돈다(DATABASE_URL).

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
});

const T0 = new Date("2026-11-03T03:00:00Z"); // 한국 표준시 12:00

function setup(options: { limits?: Partial<ServerConfig["limits"]>; runner?: Partial<ServerConfig["runner"]>; wake?: () => Promise<WakeOutcome> } = {}) {
  const stub = createGitHubStub({ origin: "http://stub.test" });
  const clock = { now: T0 };
  const base = readConfig({});
  const config = {
    github: base.github,
    limits: { ...base.limits, ...options.limits },
    runner: { ...base.runner, kind: "local" as const, ...options.runner },
  };
  const wakes: unknown[] = [];
  const store = createDbStore({
    db: async () => db,
    // GitHub 의 짧은 캐시(끝 커밋 30초 등)도 같은 시계로 잰다. 새 커밋을 보려면 시계를 30초 넘게 돌린다.
    github: createGitHub({ apiBase: "http://stub.test", token: null, searchCacheSeconds: 60, repoCacheSeconds: 300, fetch: stub.fetch as typeof fetch, now: () => clock.now.getTime() }),
    config,
    now: () => clock.now,
    wake: async (input) => {
      wakes.push(input);
      return options.wake ? options.wake() : { ok: true };
    },
  });
  const later = (minutes: number) => {
    clock.now = new Date(clock.now.getTime() + minutes * 60_000);
  };
  return { store, stub, clock, later, wakes };
}

const created = (outcome: RequestOutcome) => {
  if (!outcome.ok) throw new Error(`요청이 거절됨: ${outcome.reason} ${outcome.message}`);
  return outcome;
};

/** 실행기가 한 것처럼 단계를 적는다(콜백은 다음 차례에 만든다. 여기서는 DB 에 바로 적는다). */
async function finish(id: string, at: Date, result: string | null = JSON.stringify({ ok: true })) {
  const iso = at.toISOString();
  const steps = STEP_ORDER.map((name) => ({ name, startedAt: iso, endedAt: iso }));
  await db.query("UPDATE analyses SET status = 'succeeded', finished_at = $2, steps = $3::jsonb WHERE id = $1", [id, at, JSON.stringify(steps)]);
  if (result !== null) await db.query("INSERT INTO results (analysis_id, json) VALUES ($1, $2)", [id, result]);
}

describe("DB: 마이그레이션", () => {
  it("이름 차례로 한 번만 적용한다", async () => {
    expect(readMigrations().map((m) => m.name)).toEqual(["001_init.sql", "002_finding_count.sql"]);
    // 이미 열 때 적용했다. 다시 돌려도 아무것도 하지 않는다.
    expect(await migrate(db)).toEqual([]);
    const applied = await db.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
    expect(applied.rows.map((row) => row.name)).toEqual(["001_init.sql", "002_finding_count.sql"]);
  });

  it("표에 저장하지 않기로 한 것(IP·사용자·코드)을 담을 열이 없다", async () => {
    const columns = await db.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('analyses', 'results') ORDER BY table_name, ordinal_position",
    );
    const names = columns.rows.map((row) => `${row.table_name}.${row.column_name}`);
    expect(names).toEqual([
      "analyses.id",
      "analyses.owner",
      "analyses.repo",
      "analyses.repo_key",
      "analyses.commit_sha",
      "analyses.branch",
      "analyses.status",
      "analyses.failure_step",
      "analyses.failure_reason",
      "analyses.requested_at",
      "analyses.finished_at",
      "analyses.steps",
      "analyses.tool_version",
      "analyses.pack_digest",
      "analyses.runner_run_id",
      "analyses.runner_run_url",
      "analyses.finding_count",
      "results.analysis_id",
      "results.json",
    ]);
  });

  it("같은 저장소·커밋에 대기·진행 중인 분석은 DB 제약으로도 하나뿐이다", async () => {
    const row = (id: string, status: string) =>
      db.query(
        `INSERT INTO analyses (id, owner, repo, repo_key, commit_sha, branch, status, requested_at, steps, failure_step, failure_reason)
         VALUES ($1, 'A', 'B', 'a/b', $2, 'main', $3, now(), '[]'::jsonb, $4, $5)`,
        [id, "a".repeat(40), status, status === "failed" ? "fetch" : null, status === "failed" ? "x" : null],
      );
    await row("aaaaaaaaaa", "queued");
    await expect(row("bbbbbbbbbb", "running")).rejects.toMatchObject({ code: "23505" });
    // 끝난 분석은 몇 개든 된다.
    await row("cccccccccc", "failed");
    await row("dddddddddd", "failed");
  });

  it("열에 맞지 않는 값(커밋·상태·id·소문자 열쇠)은 DB 가 받지 않는다", async () => {
    const insert = (values: { id?: string; key?: string; sha?: string; status?: string }) =>
      db.query(
        `INSERT INTO analyses (id, owner, repo, repo_key, commit_sha, branch, status, requested_at, steps) VALUES ($1, 'A', 'B', $2, $3, 'main', $4, now(), '[]'::jsonb)`,
        [values.id ?? "eeeeeeeeee", values.key ?? "a/b", values.sha ?? "b".repeat(40), values.status ?? "queued"],
      );
    await expect(insert({ id: "000000000l" })).rejects.toThrow();
    await expect(insert({ key: "A/B" })).rejects.toThrow();
    await expect(insert({ sha: "main" })).rejects.toThrow();
    await expect(insert({ status: "done" })).rejects.toThrow();
    // 실패에는 단계와 까닭이 함께 있어야 한다.
    await expect(insert({ status: "failed" })).rejects.toThrow();
  });
});

describe("분석 요청", () => {
  it("공개 저장소의 기본 브랜치 끝 커밋으로 대기 중인 분석을 만들고 실행기를 깨운다", async () => {
    const { store, stub, wakes } = setup();
    const { analysis, reused } = created(await store.requestAnalysis("Example-Org", "KIDS-SIGNUP"));
    expect(reused).toBe(false);
    expect(isAnalysisId(analysis.id)).toBe(true);
    // 이름은 GitHub 이 돌려준 대소문자다.
    expect([analysis.owner, analysis.name, analysis.branch]).toEqual(["example-org", "kids-signup", "main"]);
    expect(analysis.commit).toBe(stub.head("example-org", "kids-signup"));
    expect(analysis.status).toBe("queued");
    expect(analysis.requestedAt).toBe(T0.toISOString());
    expect(analysis.steps.map((s) => [s.name, s.startedAt, s.endedAt])).toEqual(
      STEP_ORDER.map((name) => [name, name === "queued" ? T0.toISOString() : null, null]),
    );
    expect(analysis.failure).toBeNull();
    expect(analysis.versions).toBeNull();
    expect(wakes).toEqual([{ analysisId: analysis.id, owner: "example-org", repo: "kids-signup", commit: analysis.commit, callbackBase: null }]);
    expect(await store.getAnalysis("EXAMPLE-ORG", "kids-signup", analysis.id)).toEqual(analysis);
  });

  it("같은 커밋에 대기·진행 중인 분석이 있으면 그 분석을 돌려준다(reused)", async () => {
    const { store, later, wakes } = setup();
    const first = created(await store.requestAnalysis("example-org", "kids-signup"));
    later(5);
    const again = created(await store.requestAnalysis("example-org", "kids-signup"));
    expect(again).toEqual({ ok: true, analysis: first.analysis, reused: true });
    expect(wakes).toHaveLength(1);
  });

  it("같은 커밋의 분석이 DEDUPE_MINUTES(기본 60) 안에 끝났으면 그것을, 지나면 새로 만든다", async () => {
    const { store, clock, later } = setup({ limits: { concurrent: 5 } });
    const first = created(await store.requestAnalysis("example-org", "kids-signup"));
    later(3);
    await finish(first.analysis.id, clock.now);
    later(DEFAULTS.dedupeMinutes - 1);
    expect(created(await store.requestAnalysis("example-org", "kids-signup"))).toMatchObject({ reused: true, analysis: { id: first.analysis.id } });
    later(1);
    const fresh = created(await store.requestAnalysis("example-org", "kids-signup"));
    expect(fresh.reused).toBe(false);
    expect(fresh.analysis.id).not.toBe(first.analysis.id);
  });

  it("새 커밋이면 진행 중인 분석이 있어도 새 분석이다. 실패한 분석은 다시 요청하면 새로 만든다", async () => {
    const { store, stub, later } = setup({ limits: { concurrent: 5 } });
    const first = created(await store.requestAnalysis("example-org", "kids-signup"));
    stub.setHead("example-org", "kids-signup", "2");
    // 끝 커밋은 30초 동안 서버 메모리에 둔다. 그 안의 요청은 앞의 커밋을 보므로 진행 중인 분석으로 간다.
    expect(created(await store.requestAnalysis("example-org", "kids-signup")).analysis.id).toBe(first.analysis.id);
    later(1);
    const second = created(await store.requestAnalysis("example-org", "kids-signup"));
    expect(second.reused).toBe(false);
    expect(second.analysis.commit).not.toBe(first.analysis.commit);
    await db.query("UPDATE analyses SET status = 'failed', failure_step = 'fetch', failure_reason = 'x', finished_at = now() WHERE id = $1", [second.analysis.id]);
    later(1);
    expect(created(await store.requestAnalysis("example-org", "kids-signup")).reused).toBe(false);
  });

  it("같은 요청이 동시에 여러 번 와도 분석은 하나만 생긴다", async () => {
    const { store, wakes } = setup();
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => store.requestAnalysis("example-org", "night-push")));
    const ids = new Set(outcomes.map((outcome) => created(outcome).analysis.id));
    expect(ids.size).toBe(1);
    expect(outcomes.filter((outcome) => outcome.ok && !outcome.reused)).toHaveLength(1);
    expect(wakes).toHaveLength(1);
    const count = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM analyses");
    expect(count.rows[0].n).toBe(1);
  });

  it("동시 상한(CONCURRENT_LIMIT, 기본 2)에 닿으면 받지 않고 까닭을 말한다", async () => {
    expect(DEFAULTS.concurrent).toBe(2);
    const { store } = setup();
    created(await store.requestAnalysis("example-org", "kids-signup"));
    created(await store.requestAnalysis("example-org", "night-push"));
    const refused = await store.requestAnalysis("example-studio", "genai-chat");
    expect(refused).toEqual({
      ok: false,
      reason: "limit",
      message: "지금 분석 2건이 대기·진행 중이라(동시에 2건까지) 받지 않았습니다. 그 분석이 끝난 뒤 다시 요청해 주세요.",
    });
  });

  it("하루 상한(DAILY_LIMIT)은 한국 표준시 하루로 센다", async () => {
    const { store, clock, stub } = setup({ limits: { daily: 2, concurrent: 10 } });
    // 한국 표준시 23:50 에 둘.
    clock.now = new Date("2026-11-03T14:50:00Z");
    created(await store.requestAnalysis("example-org", "kids-signup"));
    created(await store.requestAnalysis("example-org", "night-push"));
    const refused = await store.requestAnalysis("example-studio", "genai-chat");
    expect(refused).toMatchObject({ ok: false, reason: "limit" });
    expect(!refused.ok && refused.message).toContain("오늘(한국 표준시) 받을 수 있는 분석 2건");
    // 한국 표준시 자정이 지나면 다시 받는다(UTC 로는 아직 같은 날이다).
    clock.now = new Date("2026-11-03T15:00:00Z");
    stub.setHead("example-org", "kids-signup", "3");
    expect((await store.requestAnalysis("example-studio", "genai-chat")).ok).toBe(true);
    expect(kstDayStart(new Date("2026-11-03T15:00:00Z")).toISOString()).toBe("2026-11-03T15:00:00.000Z");
    expect(kstDayStart(new Date("2026-11-03T14:59:59Z")).toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });

  it("없거나 비공개거나 이름이 규칙에 맞지 않거나 너무 큰 저장소는 받지 않는다", async () => {
    const { store, wakes } = setup();
    expect(await store.requestAnalysis("example-labs", "nothing")).toMatchObject({ ok: false, reason: "not-found" });
    expect(await store.requestAnalysis("example-labs", "secret-repo")).toMatchObject({ ok: false, reason: "not-found" });
    expect(await store.requestAnalysis("example-labs", "../x")).toMatchObject({ ok: false, reason: "not-found" });
    const big = await store.requestAnalysis("example-labs", "huge-monorepo");
    expect(big).toMatchObject({ ok: false, reason: "too-large" });
    expect(!big.ok && big.message).toContain(`상한 ${DEFAULTS.maxRepoKb.toLocaleString("en-US")}KB`);
    expect(wakes).toEqual([]);
  });

  it("RUNNER=none 이면 요청을 받지 않고, 쪽에 그 까닭을 준다", async () => {
    const { store, stub } = setup({ runner: { kind: "none" } });
    expect(store.requestsClosed()).toBe(SITE.service.runnerOff);
    expect(await store.requestAnalysis("example-org", "kids-signup")).toEqual({ ok: false, reason: "closed", message: SITE.service.runnerOff });
    expect(stub.calls).toEqual([]);
    expect(setup().store.requestsClosed()).toBeNull();
  });

  it("실행기를 깨우지 못하면 분석을 실패로 적고 까닭을 남긴다", async () => {
    const reason = "실행기(GitHub Actions)가 분석을 받지 않았습니다(응답 404).";
    const { store } = setup({ wake: async () => ({ ok: false, reason }) });
    const outcome = created(await store.requestAnalysis("example-org", "kids-signup"));
    expect(outcome.analysis.status).toBe("failed");
    expect(outcome.analysis.failure).toEqual({ step: "queued", reason });
    // 대기에 남지 않으므로 같은 커밋을 다시 요청할 수 있다.
    expect(created(await store.requestAnalysis("example-org", "kids-signup")).reused).toBe(false);
  });

  it("GitHub 의 요청 수 상한이면 limit, 닿지 못하면 unavailable 이고 분석을 만들지 않는다", async () => {
    const { store, stub } = setup();
    stub.setRateLimited(true);
    expect(await store.requestAnalysis("example-org", "kids-signup")).toMatchObject({ ok: false, reason: "limit" });
    const down = createDbStore({
      db: async () => db,
      github: createGitHub({ apiBase: "http://stub.test", token: null, searchCacheSeconds: 60, repoCacheSeconds: 300, fetch: (async () => { throw new TypeError("down"); }) as typeof fetch }),
      config: { github: readConfig({}).github, limits: readConfig({}).limits, runner: { ...readConfig({}).runner, kind: "local" } },
    });
    expect(await down.requestAnalysis("example-org", "kids-signup")).toMatchObject({ ok: false, reason: "unavailable" });
    const count = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM analyses");
    expect(count.rows[0].n).toBe(0);
  });

  it("같은 저장소의 분석 요청을 되풀이해도 GitHub 은 저장소 정보·끝 커밋을 한 번씩만 부른다(검토 1)", async () => {
    const { store, stub } = setup();
    const first = created(await store.requestAnalysis("example-org", "kids-signup"));
    for (let i = 0; i < 10; i += 1) {
      expect(created(await store.requestAnalysis("example-org", "kids-signup")).analysis.id).toBe(first.analysis.id);
    }
    expect(stub.calls.filter((call: { path: string }) => call.path.startsWith("/repos/example-org/kids-signup")).length).toBe(2);
  });
});

describe("오래된 분석", () => {
  it("RUN_TIMEOUT_MINUTES(기본 25)를 넘게 끝나지 않은 분석은 읽을 때 '시간 초과'로 실패한다. 멈춘 단계는 그때의 단계다", async () => {
    expect(DEFAULTS.runTimeoutMinutes).toBe(25);
    const { store, later } = setup();
    const { analysis } = created(await store.requestAnalysis("example-org", "kids-signup"));
    // 실행기가 저장소 받기까지 알렸다(검사는 시작했고 끝나지 않았다).
    const at = new Date(T0.getTime() + 60_000).toISOString();
    const steps = [
      { name: "queued", startedAt: T0.toISOString(), endedAt: at },
      { name: "fetch", startedAt: at, endedAt: at },
      { name: "scan", startedAt: at, endedAt: null },
      { name: "finish", startedAt: null, endedAt: null },
    ];
    await db.query("UPDATE analyses SET status = 'running', steps = $2::jsonb WHERE id = $1", [analysis.id, JSON.stringify(steps)]);
    later(25);
    expect((await store.getAnalysis("example-org", "kids-signup", analysis.id))?.status).toBe("running");
    later(1);
    const stale = (await store.getAnalysis("example-org", "kids-signup", analysis.id))!;
    expect(stale.status).toBe("failed");
    expect(stale.failure).toEqual({
      step: "scan",
      reason: "시간 초과: 요청한 뒤 25분 안에 끝나지 않아 멈춘 것으로 적었습니다. ‘검사(정적 검사와 AI 판정)’ 단계에 머물러 있었습니다.",
    });
    // 언제 멈췄는지는 모르므로 그 단계의 끝난 시각을 꾸며 적지 않는다.
    expect(stale.steps.find((s) => s.name === "scan")?.endedAt).toBeNull();
  });

  it("요청할 때도 정리한다: 시간을 넘긴 분석은 동시 상한에 세지 않고, 같은 커밋이면 새 분석을 만든다", async () => {
    const { store, later } = setup();
    const first = created(await store.requestAnalysis("example-org", "kids-signup"));
    created(await store.requestAnalysis("example-org", "night-push"));
    later(30);
    const again = created(await store.requestAnalysis("example-org", "kids-signup"));
    expect(again.reused).toBe(false);
    expect((await store.getAnalysis("example-org", "kids-signup", first.analysis.id))?.failure?.step).toBe("queued");
  });

  it("머문 단계: 시작했고 끝나지 않은 단계, 없으면 시작하지 않은 첫 단계", () => {
    const step = (name: (typeof STEP_ORDER)[number], startedAt: string | null, endedAt: string | null) => ({ name, startedAt, endedAt });
    expect(stalledStep([step("queued", "t", null), step("fetch", null, null)])).toBe("queued");
    expect(stalledStep([step("queued", "t", "t"), step("fetch", "t", "t"), step("scan", null, null)])).toBe("scan");
    expect(stalledStep([step("queued", "t", "t"), step("fetch", "t", "t"), step("scan", "t", "t"), step("finish", "t", "t")])).toBe("finish");
  });
});

describe("읽기", () => {
  it("저장소의 분석은 나중 것이 앞이다. 다른 저장소의 id 로는 찾지 못한다", async () => {
    const { store, later, stub } = setup({ limits: { concurrent: 5 } });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    later(1);
    stub.setHead("example-org", "kids-signup", "2");
    const b = created(await store.requestAnalysis("example-org", "kids-signup"));
    expect((await store.listAnalyses("example-org", "kids-signup")).map((x) => x.id)).toEqual([b.analysis.id, a.analysis.id]);
    expect(await store.getAnalysis("example-org", "night-push", a.analysis.id)).toBeNull();
  });

  it("결과는 끝난 분석만, 받은 그대로 돌려준다. JSON 이 아니면 글 그대로다", async () => {
    const { store, clock, stub } = setup({ limits: { concurrent: 5 } });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    expect(await store.getResult(a.analysis.id)).toBeNull();
    await finish(a.analysis.id, clock.now, '{"tool":{"version":"x"}}');
    expect(await store.getResult(a.analysis.id)).toEqual({ tool: { version: "x" } });
    stub.setHead("example-org", "kids-signup", "2");
    clock.now = new Date(clock.now.getTime() + 60_000);
    const b = created(await store.requestAnalysis("example-org", "kids-signup"));
    await finish(b.analysis.id, clock.now, "not json");
    expect(await store.getResult(b.analysis.id)).toBe("not json");
  });

  it("최근에 끝난 분석: 끝난 차례, 기록에 있는 이름(GitHub 을 부르지 않는다)", async () => {
    const { store, clock, later, stub } = setup({ limits: { concurrent: 5 } });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    const b = created(await store.requestAnalysis("example-studio", "genai-chat"));
    later(2);
    await finish(b.analysis.id, clock.now);
    later(2);
    await finish(a.analysis.id, clock.now);
    const before = stub.calls.length;
    const recent = await store.recentSucceeded(3);
    expect(stub.calls.length).toBe(before);
    expect(recent.map(({ analysis }) => analysis.id)).toEqual([a.analysis.id, b.analysis.id]);
    expect(recent[1].repository).toEqual({
      owner: "Example-Studio",
      name: "GenAI-Chat",
      description: null,
      defaultBranch: "main",
      language: null,
      htmlUrl: null,
      synthetic: false,
    });
  });

  it("검색은 GitHub 검색에 이 사이트의 분석 수와 가장 나중의 분석을 붙인다", async () => {
    const { store } = setup();
    const a = created(await store.requestAnalysis("example-studio", "genai-chat"));
    const outcome = await store.search("example");
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.hits.map((hit) => `${hit.repository.owner}/${hit.repository.name}:${hit.analyses}`)).toEqual([
      "example-org/kids-signup:0",
      "example-org/night-push:0",
      "Example-Studio/GenAI-Chat:1",
      "example-labs/plain.utils:0",
      "example-labs/huge-monorepo:0",
    ]);
    expect(outcome.hits[2].latest).toEqual({ id: a.analysis.id, status: "queued", requestedAt: T0.toISOString() });
    // 화면에 쓰는 Repository 에는 요청 검사용 크기가 실리지 않는다.
    expect(Object.keys(outcome.hits[0].repository)).not.toContain("sizeKb");
  });

  it("GitHub 에 닿지 못하면: 검색은 까닭을 돌려주고, 분석 기록이 있는 저장소는 기록의 이름으로 보인다", async () => {
    const { store, stub } = setup();
    created(await store.requestAnalysis("example-org", "kids-signup"));
    // 캐시를 피하려고 새 저장소 구현으로 본다.
    const fresh = setup();
    fresh.stub.setRateLimited(true);
    stub.setRateLimited(true);
    const search = await fresh.store.search("kids");
    expect(search).toEqual({ ok: false, message: "GitHub 의 요청 수 상한에 닿았습니다. 잠시 뒤에 다시 해 보세요." });
    expect(await fresh.store.getRepository("example-org", "kids-signup")).toMatchObject({ owner: "example-org", name: "kids-signup", htmlUrl: null });
    await expect(fresh.store.getRepository("example-org", "night-push")).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("DB 에 닿지 못하면 화면에 적을 까닭을 담은 오류다(내부 오류를 싣지 않는다)", async () => {
    const stub = createGitHubStub({ origin: "http://stub.test" });
    const store: ServiceStore = createDbStore({
      db: async () => {
        throw new Error("connect ECONNREFUSED postgres://user:pw@10.0.0.1/db");
      },
      github: createGitHub({ apiBase: "http://stub.test", token: null, searchCacheSeconds: 60, repoCacheSeconds: 300, fetch: stub.fetch as typeof fetch }),
      config: readConfig({}),
    });
    const error = (await store.listAnalyses("a", "b").catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error.message).toBe("분석 기록을 읽지 못했습니다. 잠시 뒤에 다시 해 보세요.");
  });
});
