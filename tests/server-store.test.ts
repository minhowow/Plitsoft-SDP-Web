import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceUnavailableError } from "@/lib/service/errors";
import { isAnalysisId } from "@/lib/service/id";
import { STEP_ORDER } from "@/lib/service/steps";
import type { RequestOutcome, ServiceStore } from "@/lib/service/types";
import { SITE } from "@/lib/site";
import { DEFAULTS, readConfig, type ServerConfig } from "@/server/config";
import { migrate, openDatabase, readMigrations, type Database } from "@/server/db";
import { createSharedBudget } from "@/server/budget";
import { createGitHub, GitHubError } from "@/server/github";
import type { WakeOutcome } from "@/server/runner";
import { placeAt, placeOf, placeShort, placeText } from "@/lib/service/queue";
import { dispatchTimeoutReason, pumpQueue, queueTimeoutReason } from "@/server/queue";
import { WAKE_RETRY_MINUTES } from "@/lib/service/queue";
import { createDbStore, kstDayStart, stalledStep } from "@/server/store/db";
import { pickActivity } from "@/lib/service/activity";
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
  await db.query("DELETE FROM runner_wake");
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
    expect(readMigrations().map((m) => m.name)).toEqual(["001_init.sql", "002_finding_count.sql", "003_queue.sql", "004_runner_wake.sql"]);
    // 이미 열 때 적용했다. 다시 돌려도 아무것도 하지 않는다.
    expect(await migrate(db)).toEqual([]);
    const applied = await db.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
    expect(applied.rows.map((row) => row.name)).toEqual(["001_init.sql", "002_finding_count.sql", "003_queue.sql", "004_runner_wake.sql"]);
  });

  it("표에 저장하지 않기로 한 것(IP·사용자·코드)을 담을 열이 없다", async () => {
    const columns = await db.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('analyses', 'results', 'github_budget', 'runner_wake') ORDER BY table_name, ordinal_position",
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
      "analyses.dispatched_at",
      "github_budget.bucket",
      "github_budget.window_start",
      "github_budget.used",
      "results.analysis_id",
      "results.json",
      "runner_wake.id",
      "runner_wake.failed_at",
      "runner_wake.reason",
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
    const { store, clock, later } = setup({ limits: { poolSize: 5 } });
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
    const { store, stub, later } = setup({ limits: { poolSize: 5 } });
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

  it("실행 자리(POOL_SIZE, 기본 2)가 차도 거절하지 않고 대기열에 받는다. 실행기는 자리 수만큼만 깨운다", async () => {
    expect(DEFAULTS.poolSize).toBe(2);
    const { store, wakes, later } = setup();
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    later(1);
    const b = created(await store.requestAnalysis("example-org", "night-push"));
    later(1);
    const c = created(await store.requestAnalysis("example-studio", "genai-chat"));
    expect([a, b, c].map((o) => [o.reused, o.analysis.status])).toEqual([[false, "queued"], [false, "queued"], [false, "queued"]]);
    expect(wakes.map((w) => (w as { analysisId: string }).analysisId)).toEqual([a.analysis.id, b.analysis.id]);
    expect(await store.queue()).toMatchObject({ poolSize: 2, inUse: 2, waiting: [c.analysis.id], dispatched: [a.analysis.id, b.analysis.id] });
  });

  it("하루 상한(DAILY_LIMIT)은 한국 표준시 하루로 센다", async () => {
    const { store, clock, stub } = setup({ limits: { daily: 2, poolSize: 10 } });
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

  it("실행기를 깨우지 못하면 분석을 실패로 적지 않고 대기열에 둔다. 깨우지 못한 때와 까닭은 대기열 정보로 보인다", async () => {
    const reason = "실행기(GitHub Actions)가 분석을 받지 않았습니다(응답 404).";
    const { store } = setup({ wake: async () => ({ ok: false, reason }) });
    const outcome = created(await store.requestAnalysis("example-org", "kids-signup"));
    expect(outcome.analysis.status).toBe("queued");
    expect(outcome.analysis.failure).toBeNull();
    const queue = (await store.queue())!;
    expect(queue.waiting).toEqual([outcome.analysis.id]);
    expect(queue.wakeFailure).toEqual({ at: T0.toISOString(), reason });
    const place = placeOf(queue, outcome.analysis.id)!;
    expect(place).toEqual({ kind: "waiting", ahead: 0, poolSize: 2, inUse: 0, wakeFailure: reason });
    expect(placeText(place)).toBe(
      `대기열 1번째. 실행기를 깨우지 못해 대기열이 잠시 멈춰 있습니다. 까닭: ${reason} ${WAKE_RETRY_MINUTES}분이 지난 뒤 다시 깨워 봅니다.`,
    );
    // 대기열에 있으므로 같은 커밋을 다시 요청하면 그 분석으로 보낸다(새로 만들지 않는다).
    expect(created(await store.requestAnalysis("example-org", "kids-signup"))).toMatchObject({ reused: true, analysis: { id: outcome.analysis.id } });
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

describe("대기열과 실행 자리 (2026-11-03)", () => {
  const ids = (wakes: unknown[]) => wakes.map((w) => (w as { analysisId: string }).analysisId);
  const running = (id: string) => db.query("UPDATE analyses SET status = 'running' WHERE id = $1", [id]);

  it("대기열은 먼저 요청한 차례이고, 분석마다 앞에 몇 개가 있는지 DB 에서 센다", async () => {
    const { store, later } = setup({ limits: { poolSize: 1 } });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    later(1);
    const b = created(await store.requestAnalysis("example-org", "night-push"));
    later(1);
    const c = created(await store.requestAnalysis("example-studio", "genai-chat"));
    const queue = await store.queue();
    expect(queue).toEqual({
      countedAt: new Date(T0.getTime() + 2 * 60_000).toISOString(),
      poolSize: 1,
      inUse: 1,
      waiting: [b.analysis.id, c.analysis.id],
      dispatched: [a.analysis.id],
      wakeFailure: null,
    });
    expect(placeOf(queue, a.analysis.id)).toEqual({ kind: "dispatched", poolSize: 1, inUse: 1 });
    expect(placeOf(queue, b.analysis.id)).toEqual({ kind: "waiting", ahead: 0, poolSize: 1, inUse: 1 });
    expect(placeOf(queue, c.analysis.id)).toEqual({ kind: "waiting", ahead: 1, poolSize: 1, inUse: 1 });
    // 화면에는 대기열의 몇 번째인지만 적는다. 실행 자리의 수는 적지 않는다(docs/redesign.md 2.3, D3).
    expect(placeText(placeOf(queue, c.analysis.id)!)).toBe("대기열 2번째");
    expect(placeShort(placeOf(queue, a.analysis.id)!)).toBe("실행기에 보냄, 시작 기다림");
    // 다시 읽지 않는 저장소 쪽은 센 때(한국 표준시 12:02)를 붙인다.
    expect(placeAt(placeOf(queue, c.analysis.id)!, queue!.countedAt)).toBe("대기열 2번째 (12:02 KST 기준)");
    // 대기 중이 아닌 분석은 대기열에 없다.
    await running(a.analysis.id);
    expect(placeOf(await store.queue(), a.analysis.id)).toBeNull();
  });

  it("앞의 분석이 끝나면 다음 것을 깨운다(쪽을 읽을 때 넘긴다). 분석 중인 것도 자리를 쓴다", async () => {
    const { store, clock, later, wakes } = setup({ limits: { poolSize: 1 } });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    const b = created(await store.requestAnalysis("example-org", "night-push"));
    expect(ids(wakes)).toEqual([a.analysis.id]);
    await running(a.analysis.id);
    await store.listAnalyses("example-org", "kids-signup");
    expect(ids(wakes)).toEqual([a.analysis.id]);
    later(3);
    await finish(a.analysis.id, clock.now);
    await store.listAnalyses("example-org", "kids-signup");
    expect(ids(wakes)).toEqual([a.analysis.id, b.analysis.id]);
    // 한 번 보낸 분석은 다시 보내지 않는다.
    await store.listAnalyses("example-org", "night-push");
    expect(ids(wakes)).toEqual([a.analysis.id, b.analysis.id]);
  });

  it("깨우기에 실패하면 그 분석을 대기열의 제자리에 되돌리고, WAKE_RETRY_MINUTES 동안은 깨우지 않으며, 그 뒤 같은 차례로 다시 깨운다", async () => {
    expect(WAKE_RETRY_MINUTES).toBe(2);
    let fail = false;
    const reason = "실행기(GitHub Actions)가 분석을 받지 않았습니다(응답 500).";
    const { store, clock, later, wakes } = setup({ limits: { poolSize: 1 }, wake: async () => (fail ? { ok: false, reason } : { ok: true }) });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    const b = created(await store.requestAnalysis("example-org", "night-push"));
    later(1);
    const c = created(await store.requestAnalysis("example-studio", "genai-chat"));
    await finish(a.analysis.id, clock.now);
    fail = true;
    await store.findAnalysis(a.analysis.id);
    // 읽기가 넘기다 b 를 깨우지 못했다. b 는 실패가 아니고 대기열의 맨 앞에 그대로 있다(DB 를 바로 본다).
    const row = (await db.query<{ status: string; dispatched: boolean; failure_reason: string | null }>(
      "SELECT status, dispatched_at IS NOT NULL AS dispatched, failure_reason FROM analyses WHERE id = $1",
      [b.analysis.id],
    )).rows[0];
    expect(row).toEqual({ status: "queued", dispatched: false, failure_reason: null });
    expect(ids(wakes)).toEqual([a.analysis.id, b.analysis.id]);
    expect((await store.queue())?.waiting).toEqual([b.analysis.id, c.analysis.id]);
    // 쉬는 동안은 몇 번을 읽어도 깨우지 않는다(실행기가 나아졌어도).
    fail = false;
    later(1);
    for (let i = 0; i < 5; i += 1) await store.findAnalysis(c.analysis.id);
    expect(ids(wakes)).toEqual([a.analysis.id, b.analysis.id]);
    // 쉬는 시간이 지나면 같은 차례(b 가 먼저)로 깨운다. 깨우기에 성공하면 깨우지 못한 기록을 지운다.
    later(WAKE_RETRY_MINUTES);
    expect((await store.findAnalysis(c.analysis.id))?.status).toBe("queued");
    expect(ids(wakes)).toEqual([a.analysis.id, b.analysis.id, b.analysis.id]);
    const queue = (await store.queue())!;
    expect(queue.dispatched).toEqual([b.analysis.id]);
    expect(queue.waiting).toEqual([c.analysis.id]);
    expect(queue.wakeFailure).toBeNull();
  });

  it("실행기 장애가 이어져도 진행을 몇 번 읽든 대기열의 분석을 하나씩 실패로 적지 않는다. 오래가면 대기 시간 초과가 깨우지 못한 까닭과 함께 끝낸다(검토)", async () => {
    let fail = false;
    const reason = "실행기(GitHub Actions)에 닿지 못해 분석을 시작하지 못했습니다.";
    const { store, clock, later } = setup({ limits: { poolSize: 1 }, runner: { kind: "github" }, wake: async () => (fail ? { ok: false, reason } : { ok: true }) });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    const rest: string[] = [];
    for (const [owner, repo] of [["example-org", "night-push"], ["example-studio", "genai-chat"], ["example-labs", "plain.utils"]] as const) {
      rest.push(created(await store.requestAnalysis(owner, repo)).analysis.id);
    }
    await finish(a.analysis.id, clock.now);
    fail = true;
    const statuses = async () =>
      (await db.query<{ status: string }>("SELECT status FROM analyses WHERE id = ANY($1::text[]) ORDER BY requested_at", [rest])).rows.map((r) => r.status);
    // 진행 쪽이 3초마다 읽는 것처럼, 그리고 몇 분씩 지나며 읽는다.
    for (let i = 0; i < 40; i += 1) {
      await store.findAnalysis(rest[0]);
      later(1);
    }
    expect(await statuses()).toEqual(["queued", "queued", "queued"]);
    // 요청한 지 120분을 넘기면, 깨우지 못한 까닭(센 사실)과 함께 끝낸다.
    later(81);
    await store.findAnalysis(rest[0]);
    expect(await statuses()).toEqual(["failed", "failed", "failed"]);
    const stale = (await store.findAnalysis(rest[2]))!;
    expect(stale.failure).toEqual({
      step: "queued",
      reason: queueTimeoutReason(120, { poolSize: 1, inUse: 0, wakeFailure: reason, runner: "github" }),
    });
    expect(stale.failure!.reason).toBe(
      `대기열에서 120분 넘게 기다려 멈춘 것으로 적었습니다. 실행기를 깨우지 못해 보내지 못했습니다. 마지막으로 깨우지 못한 까닭: ${reason} 다시 요청할 수 있습니다.`,
    );
  });

  it("깨우기 실패 뒤 아무도 읽지 않아 자리가 빈 채 오래 지나도, 나중의 첫 읽기는 맨 앞의 분석을 먼저 보내고, 그래도 자리가 없는 분석만 그때 센 사실을 까닭으로 끝낸다(검토 R1)", async () => {
    let fail = false;
    const { store, clock, later, wakes } = setup({ limits: { poolSize: 1 }, runner: { kind: "github" }, wake: async () => (fail ? { ok: false, reason: "x." } : { ok: true }) });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    later(1);
    const b = created(await store.requestAnalysis("example-org", "night-push"));
    later(1);
    const c = created(await store.requestAnalysis("example-studio", "genai-chat"));
    later(1);
    await finish(a.analysis.id, clock.now);
    fail = true;
    // 결과 콜백 뒤의 넘기기: b 를 깨우지 못하고 멈춘다.
    await store.findAnalysis(a.analysis.id);
    expect((await store.queue())?.waiting).toEqual([b.analysis.id, c.analysis.id]);
    fail = false;
    later(121); // 그동안 아무 요청·콜백·읽기 없음(진행 쪽은 탭이 숨으면 다시 읽지 않는다)
    const cc = (await store.findAnalysis(c.analysis.id))!;
    // 넘기기가 대기 시간 초과보다 먼저다: b(요청한 지 122분)는 실패하지 않고 실행기에 갔다.
    expect((await store.findAnalysis(b.analysis.id))?.status).toBe("queued");
    expect((await store.queue())?.dispatched).toEqual([b.analysis.id]);
    expect(ids(wakes)).toEqual([a.analysis.id, b.analysis.id, b.analysis.id]);
    // c 는 b 가 자리를 얻은 뒤에도 자리가 없어 끝났다. 까닭은 그때 센 사실이다("그동안 앞의 분석들이 자리를 쓰고 있었다"고
    // 말하지 않는다. 실제로는 자리가 오래 비어 있었다).
    expect(cc.status).toBe("failed");
    expect(cc.failure?.reason).toBe(queueTimeoutReason(120, { poolSize: 1, inUse: 1, wakeFailure: null, runner: "github" }));
    expect(cc.failure?.reason).not.toContain("그동안");
  });

  it("실행기가 콜백 없이 죽은 뒤 오래 지나 첫 읽기가 오면, 죽은 분석은 시간 초과로 적고 기다리던 분석은 실패시키지 않고 보낸다(검토 R2)", async () => {
    const { store, later, wakes } = setup({ limits: { poolSize: 1 }, runner: { kind: "github" } });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    await running(a.analysis.id);
    later(1);
    const b = created(await store.requestAnalysis("example-org", "night-push"));
    later(130);
    const bb = (await store.findAnalysis(b.analysis.id))!;
    expect(bb.status).toBe("queued");
    expect(bb.failure).toBeNull();
    expect((await store.findAnalysis(a.analysis.id))?.failure?.reason).toMatch(/^시간 초과: 실행기에 보낸 뒤 25분 안에/);
    expect(ids(wakes)).toEqual([a.analysis.id, b.analysis.id]);
  });

  it("실행기에 보낸 뒤 DISPATCH_TIMEOUT_MINUTES(기본 10) 안에 시작을 알리지 않으면 실패로 적고 다음을 보낸다", async () => {
    expect(DEFAULTS.dispatchTimeoutMinutes).toBe(10);
    const { store, later, wakes } = setup({ limits: { poolSize: 1 } });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    const b = created(await store.requestAnalysis("example-org", "night-push"));
    later(10);
    expect((await store.findAnalysis(a.analysis.id))?.status).toBe("queued");
    later(1);
    const stale = (await store.findAnalysis(a.analysis.id))!;
    expect(stale.status).toBe("failed");
    expect(stale.failure).toEqual({ step: "queued", reason: dispatchTimeoutReason(10) });
    expect(stale.failure!.reason).toBe(
      "실행기에 보낸 뒤 10분 안에 실행기가 시작을 알리지 않아 멈춘 것으로 적었습니다. 실행기가 이 분석을 받지 못했을 수 있습니다. 다시 요청할 수 있습니다.",
    );
    expect(ids(wakes)).toEqual([a.analysis.id, b.analysis.id]);
    // b 는 대기열에서 11분 기다렸지만 실패가 아니다. 보낸 때부터 다시 센다.
    expect((await store.findAnalysis(b.analysis.id))?.status).toBe("queued");
  });

  it("실행 시간 초과(RUN_TIMEOUT_MINUTES)는 요청한 때가 아니라 실행기에 보낸 때부터 센다", async () => {
    const { store, clock, later, wakes } = setup({ limits: { poolSize: 1 } });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    later(1);
    const b = created(await store.requestAnalysis("example-org", "night-push"));
    await running(a.analysis.id);
    later(19);
    await finish(a.analysis.id, clock.now);
    await store.findAnalysis(b.analysis.id);
    expect(ids(wakes)).toEqual([a.analysis.id, b.analysis.id]);
    await running(b.analysis.id);
    // b 는 요청한 지 44분, 보낸 지 25분: 아직 돈다.
    later(25);
    expect((await store.findAnalysis(b.analysis.id))?.status).toBe("running");
    later(1);
    const stale = (await store.findAnalysis(b.analysis.id))!;
    expect(stale.status).toBe("failed");
    expect(stale.failure?.reason).toMatch(/^시간 초과: 실행기에 보낸 뒤 25분 안에/);
  });

  it("대기열에서 QUEUE_TIMEOUT_MINUTES(기본 120)를 넘게 기다리면 까닭과 함께 실패로 적는다", async () => {
    expect(DEFAULTS.queueTimeoutMinutes).toBe(120);
    const { store, later } = setup({ limits: { poolSize: 1, runTimeoutMinutes: 1_000 } });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    const b = created(await store.requestAnalysis("example-org", "night-push"));
    await running(a.analysis.id);
    later(120);
    expect((await store.findAnalysis(b.analysis.id))?.status).toBe("queued");
    later(1);
    const stale = (await store.findAnalysis(b.analysis.id))!;
    expect(stale.status).toBe("failed");
    expect(stale.failure).toEqual({ step: "queued", reason: queueTimeoutReason(120, { poolSize: 1, inUse: 1, wakeFailure: null, runner: "local" }) });
    // 까닭에는 적을 때 센 사실만 적는다(그동안 줄곧 자리가 찼었다고 말하지 않는다).
    expect(stale.failure!.reason).toBe(
      "대기열에서 120분 넘게 기다려 멈춘 것으로 적었습니다. 멈춘 것으로 적을 때 실행 자리 1개 중 1개가 쓰이고 있었습니다. 다시 요청할 수 있습니다.",
    );
    expect((await store.findAnalysis(a.analysis.id))?.status).toBe("running");
  });

  it("RUNNER=none 이면 대기열을 넘기지 않고, 오래 기다린 분석은 그 사실을 까닭으로 끝낸다", async () => {
    const { store, later } = setup({ runner: { kind: "none" } });
    await db.query(
      `INSERT INTO analyses (id, owner, repo, repo_key, commit_sha, branch, status, requested_at, steps)
       VALUES ('nnnnnnnnnn', 'example-org', 'kids-signup', 'example-org/kids-signup', $1, 'main', 'queued', $2, '[]'::jsonb)`,
      ["a".repeat(40), T0],
    );
    later(60);
    expect((await store.findAnalysis("nnnnnnnnnn"))?.status).toBe("queued");
    later(61);
    expect((await store.findAnalysis("nnnnnnnnnn"))?.failure?.reason).toBe(
      "대기열에서 120분 넘게 기다려 멈춘 것으로 적었습니다. 이 사이트는 지금 실행기를 깨우지 않는 설정이라 대기열을 넘기지 않았습니다. 다시 요청할 수 있습니다.",
    );
  });

  it("대기열이 QUEUE_LIMIT(기본 20)이면 그때만 받지 않는다(같은 커밋으로 보내기가 먼저다)", async () => {
    expect(DEFAULTS.queueLimit).toBe(20);
    const { store, wakes } = setup({ limits: { poolSize: 1, queueLimit: 2 } });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    const b = created(await store.requestAnalysis("example-org", "night-push"));
    created(await store.requestAnalysis("example-studio", "genai-chat"));
    const refused = await store.requestAnalysis("example-labs", "plain.utils");
    expect(refused).toEqual({
      ok: false,
      reason: "limit",
      message: "대기열이 가득 차 받지 않았습니다(실행 자리를 기다리는 분석 2건, 대기열 상한 2건). 앞의 분석이 실행기로 넘어간 뒤 다시 요청해 주세요.",
    });
    // 실행기에 간 것(a)은 대기열에 세지 않는다. 대기열의 분석과 같은 커밋이면 그 분석으로 보낸다.
    expect(created(await store.requestAnalysis("example-org", "night-push"))).toMatchObject({ reused: true, analysis: { id: b.analysis.id } });
    expect(ids(wakes)).toEqual([a.analysis.id]);
  });

  it("여러 서버가 동시에 넘겨도 한 분석은 한 번만 보내고, 자리 수를 넘겨 보내지 않는다", async () => {
    const { store } = setup({ limits: { poolSize: 2 } });
    // 대기열만 채운다(요청하면 그 자리에서 넘기므로 행을 바로 넣는다).
    const made = ["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc"];
    for (const [i, id] of made.entries()) {
      const at = new Date(T0.getTime() + i * 1000);
      await db.query(
        `INSERT INTO analyses (id, owner, repo, repo_key, commit_sha, branch, status, requested_at, steps)
         VALUES ($1, 'o', $2, $3, $4, 'main', 'queued', $5, '[]'::jsonb)`,
        [id, `r${i}`, `o/r${i}`, String(i).repeat(40), at],
      );
    }
    const woken: string[] = [];
    const deps = {
      now: () => T0,
      limits: readConfig({ POOL_SIZE: "2" }).limits,
      callbackBase: null,
      runner: "local" as const,
      wake: async (input: { analysisId: string }) => {
        woken.push(input.analysisId);
        return { ok: true as const };
      },
    };
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => pumpQueue(db, deps)));
    expect(woken).toEqual(made.slice(0, 2));
    expect(outcomes.flatMap((o) => o.dispatched).sort()).toEqual(made.slice(0, 2).sort());
    expect(await store.queue()).toMatchObject({ poolSize: 2, inUse: 2, waiting: [made[2]], dispatched: made.slice(0, 2), wakeFailure: null });
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
      reason: "시간 초과: 실행기에 보낸 뒤 25분 안에 끝나지 않아 멈춘 것으로 적었습니다. ‘검사(정적 검사와 AI 판정)’ 단계에 머물러 있었습니다.",
    });
    // 언제 멈췄는지는 모르므로 그 단계의 끝난 시각을 꾸며 적지 않는다.
    expect(stale.steps.find((s) => s.name === "scan")?.endedAt).toBeNull();
  });

  it("요청할 때도 정리한다: 시간을 넘긴 분석은 실행 자리에 세지 않고, 같은 커밋이면 새 분석을 만든다", async () => {
    const { store, later } = setup();
    const first = created(await store.requestAnalysis("example-org", "kids-signup"));
    created(await store.requestAnalysis("example-org", "night-push"));
    later(30);
    const again = created(await store.requestAnalysis("example-org", "kids-signup"));
    expect(again.reused).toBe(false);
    expect((await store.getAnalysis("example-org", "kids-signup", first.analysis.id))?.failure?.step).toBe("queued");
    // 새 분석은 빈 자리로 곧바로 실행기에 갔다.
    expect((await store.queue())?.dispatched).toEqual([again.analysis.id]);
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
    const { store, later, stub } = setup({ limits: { poolSize: 5 } });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    later(1);
    stub.setHead("example-org", "kids-signup", "2");
    const b = created(await store.requestAnalysis("example-org", "kids-signup"));
    expect((await store.listAnalyses("example-org", "kids-signup")).map((x) => x.id)).toEqual([b.analysis.id, a.analysis.id]);
    expect(await store.getAnalysis("example-org", "night-push", a.analysis.id)).toBeNull();
  });

  it("결과는 끝난 분석만, 받은 그대로 돌려준다. JSON 이 아니면 글 그대로다", async () => {
    const { store, clock, stub } = setup({ limits: { poolSize: 5 } });
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

  it("최근 분석: 저장소마다 한 줄(진행 중이 먼저, 없으면 가장 나중의 분석), 요청 시각 차례, 기록에 있는 이름(GitHub 을 부르지 않는다)", async () => {
    const { store, clock, later, stub } = setup({ limits: { poolSize: 5 } });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    later(1);
    const b = created(await store.requestAnalysis("example-studio", "genai-chat"));
    later(1);
    await finish(a.analysis.id, clock.now);
    await finish(b.analysis.id, clock.now);
    // kids-signup 의 새 커밋: 진행 중인 분석이 생긴다. 그 뒤에 genai-chat 을 다시 분석해 끝낸다.
    later(1);
    stub.setHead("example-org", "kids-signup", "2");
    const c = created(await store.requestAnalysis("example-org", "kids-signup"));
    await db.query("UPDATE analyses SET status = 'running' WHERE id = $1", [c.analysis.id]);
    later(1);
    stub.setHead("example-studio", "genai-chat", "2");
    const d = created(await store.requestAnalysis("example-studio", "genai-chat"));
    later(1);
    await finish(d.analysis.id, clock.now);
    // 이름만 대소문자가 다른 기록은 같은 저장소다(repo_key).
    await db.query(
      `INSERT INTO analyses (id, owner, repo, repo_key, commit_sha, branch, status, requested_at, steps, failure_step, failure_reason)
       VALUES ('zzzzzzzzzz', 'EXAMPLE-ORG', 'Kids-Signup', 'example-org/kids-signup', $1, 'main', 'failed', $2, '[]'::jsonb, 'fetch', '시험')`,
      ["f".repeat(40), new Date(T0.getTime() - 60_000)],
    );
    const before = stub.calls.length;
    const recent = await store.recentActivity(10);
    expect(stub.calls.length).toBe(before);
    // genai-chat(d, 3분)이 kids-signup 의 진행 중인 분석(c, 2분)보다 나중에 요청됐다.
    expect(recent.map(({ analysis }) => analysis.id)).toEqual([d.analysis.id, c.analysis.id]);
    expect(recent.map(({ analyses }) => analyses)).toEqual([2, 3]);
    expect(recent[1].analysis.status).toBe("running");
    expect(recent[1].latestAt).toBe(c.analysis.requestedAt);
    expect(recent[0].repository).toEqual({
      owner: "Example-Studio",
      name: "GenAI-Chat",
      description: null,
      defaultBranch: "main",
      language: null,
      htmlUrl: null,
      synthetic: false,
    });
    expect((await store.recentActivity(1)).map(({ analysis }) => analysis.id)).toEqual([d.analysis.id]);

    // 진행 중인 분석(c)보다 나중에 요청한 분석(e)이 끝나도(여기서는 실패) kids-signup 의 줄은 여전히 진행 중인 c 다. 저장소의
    // 가장 나중 요청 때(latestAt)는 e 의 것이고, 줄의 차례는 보이는 분석(c)의 요청 시각이다.
    later(1);
    stub.setHead("example-org", "kids-signup", "3");
    const e = created(await store.requestAnalysis("example-org", "kids-signup"));
    await db.query("UPDATE analyses SET status = 'failed', failure_step = 'fetch', failure_reason = '시험' WHERE id = $1", [e.analysis.id]);
    const after = await store.recentActivity(10);
    expect(after.map(({ analysis }) => analysis.id)).toEqual([d.analysis.id, c.analysis.id]);
    expect(after[1].analysis.status).toBe("running");
    expect(after[1].analyses).toBe(4);
    expect(after[1].latestAt).toBe(e.analysis.requestedAt);
    expect(after[1].latestAt).not.toBe(after[1].analysis.requestedAt);
  });

  it("최근 분석은 읽기 전에 정리한다: 시간을 넘긴 진행 중인 분석은 실패로 보이고, 그 저장소의 줄은 그 실패한 분석이다", async () => {
    const { store, later } = setup({ limits: { poolSize: 5 } });
    const a = created(await store.requestAnalysis("example-org", "kids-signup"));
    await db.query("UPDATE analyses SET status = 'running' WHERE id = $1", [a.analysis.id]);
    expect((await store.recentActivity(5))[0].analysis.status).toBe("running");
    later(DEFAULTS.runTimeoutMinutes + 1);
    const [row] = await store.recentActivity(5);
    expect(row.analysis).toMatchObject({ id: a.analysis.id, status: "failed" });
  });

  it("합성 저장소와 같은 규칙으로 고른다(src/lib/service/activity.ts 의 pickActivity)", async () => {
    const { store, clock, later, stub } = setup({ limits: { poolSize: 5 } });
    // 끝남·실패·진행 중이 섞이고, 진행 중인 분석보다 나중에 요청한 끝난(또는 실패한) 분석이 있는 저장소가 둘이다. 그래서 "진행
    // 중이 먼저"를 빼면 고르는 분석과 줄의 차례가 모두 달라진다.
    const k1 = created(await store.requestAnalysis("example-org", "kids-signup")); // T0, 분석 중
    await db.query("UPDATE analyses SET status = 'running' WHERE id = $1", [k1.analysis.id]);
    later(1);
    const n1 = created(await store.requestAnalysis("example-org", "night-push")); // T1, 끝남
    await finish(n1.analysis.id, clock.now);
    later(1);
    created(await store.requestAnalysis("example-studio", "genai-chat")); // T2, 대기 중
    later(1);
    stub.setHead("example-org", "kids-signup", "3");
    const k2 = created(await store.requestAnalysis("example-org", "kids-signup")); // T3, 실패
    await db.query("UPDATE analyses SET status = 'failed', failure_step = 'fetch', failure_reason = '시험' WHERE id = $1", [k2.analysis.id]);
    later(1);
    stub.setHead("example-studio", "genai-chat", "3");
    const g2 = created(await store.requestAnalysis("example-studio", "genai-chat")); // T4, 끝남
    await finish(g2.analysis.id, clock.now);
    const all = (
      await Promise.all(
        [["example-org", "kids-signup"], ["example-org", "night-push"], ["example-studio", "genai-chat"]].map(([o, n]) => store.listAnalyses(o, n)),
      )
    ).flat();
    const fromDb = (await store.recentActivity(10)).map(({ analysis, analyses, latestAt }) => ({ id: analysis.id, analyses, latestAt }));
    const fromPick = pickActivity(all, 10).map(({ analysis, analyses, latestAt }) => ({ id: analysis.id, analyses, latestAt }));
    expect(fromDb).toEqual(fromPick);
    expect(fromDb).toHaveLength(3);
    // 진행 중인 분석이 먼저: genai-chat(T2 대기) · night-push(T1 끝남) · kids-signup(T0 분석 중). 가장 나중 것만 보면 g2 · k2 · n1 이다.
    expect(fromDb.map(({ id }) => id)).not.toContain(g2.analysis.id);
    expect(fromDb.map(({ id }) => id)).not.toContain(k2.analysis.id);
    expect(fromDb[2]).toEqual({ id: k1.analysis.id, analyses: 2, latestAt: k2.analysis.requestedAt });
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

describe("GitHub 을 부르는 수의 예산을 서버 인스턴스가 함께 쓴다 (DB 의 1분 창)", () => {
  beforeEach(async () => {
    await db.query("DELETE FROM github_budget");
  });

  it("두 서버(클라이언트 둘)가 한 예산을 나눠 쓰고, 다음 1분 창에서 다시 찬다. 캐시는 서버마다다", async () => {
    const stub = createGitHubStub({ origin: "http://stub.test" });
    const clock = { now: T0.getTime() };
    const server = () =>
      createGitHub({
        apiBase: "http://stub.test",
        token: null,
        searchCacheSeconds: 60,
        repoCacheSeconds: 300,
        fetch: stub.fetch as typeof fetch,
        now: () => clock.now,
        budget: createSharedBudget({ db: async () => db, searchPerMinute: 2, callsPerMinute: 60, now: () => clock.now }),
      });
    const one = server();
    const two = server();
    await one.search("kids");
    await two.search("night");
    // 서버마다 따로 셌다면 둘 다 한 번씩 더 부를 수 있었다.
    await expect(one.search("genai")).rejects.toBeInstanceOf(GitHubError);
    await expect(two.search("plain")).rejects.toMatchObject({ kind: "rate-limit" });
    // 캐시에서 꺼낸 답은 세지 않는다.
    expect((await one.search("kids")).repositories.length).toBeGreaterThan(0);
    const rows = await db.query<{ bucket: string; used: number }>("SELECT bucket, used FROM github_budget");
    expect(rows.rows).toEqual([{ bucket: "search", used: 2 }]);
    clock.now += 60_000;
    await one.search("genai");
    // 한 시간보다 오래된 창은 새 창을 열 때 지운다.
    clock.now += 61 * 60_000;
    await two.search("plain");
    expect((await db.query("SELECT * FROM github_budget")).rows).toHaveLength(1);
  });

  it("DB 에 닿지 못하면 이 서버 메모리의 예산으로 센다(주소를 적지 않는다)", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const take = createSharedBudget({
      db: async () => {
        throw new Error("connect ECONNREFUSED postgres://user:pw@10.0.0.1/db");
      },
      searchPerMinute: 1,
      callsPerMinute: 1,
      now: () => T0.getTime(),
    });
    expect(await take("search")).toBe(true);
    expect(await take("search")).toBe(false);
    expect(await take("core")).toBe(true);
    expect(quiet.mock.calls.flat().join(" ")).not.toContain("postgres://");
    quiet.mockRestore();
  });
});
