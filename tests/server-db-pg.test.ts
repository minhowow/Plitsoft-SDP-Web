import type { EventEmitter } from "node:events";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestOutcome } from "@/lib/service/types";
import { claimQueued } from "@/server/callbacks";
import { readConfig } from "@/server/config";
import { openDatabase, type Database, type Queryable } from "@/server/db";
import { createGitHub } from "@/server/github";
import { createDbStore } from "@/server/store/db";
import { createGitHubStub } from "../scripts/github-stub.mjs";

// 검토 1(정확성): 운영의 `pg` 길과 동시 요청의 보호.
//
// 1. `pg` 의 Pool 을 감싼 것(openPostgres)을 가짜 `pg` 로 부른다. 실제 Postgres 를 부르지 않는다.
// 2. 동시 요청을 막는 장치(권고 잠금, SKIP LOCKED, 고유 제약 뒤의 되찾기)가 질의에 들어 있고 그 차례인지, 고유 제약에 걸렸을 때
//    되찾는 길이 도는지를 PGlite 로 본다. PGlite 는 연결이 하나라 트랜잭션이 하나씩 돈다. 그래서 여기서 보는 것은 "장치가
//    있고 그 길이 돈다"까지이고, READ COMMITTED 의 여러 연결에서 잠금이 상한을 지키는지는 3 이 본다.
// 3. TEST_DATABASE_URL(비어 있는 시험용 Postgres. 표를 지우고 쓴다)이 있을 때만: 연결 여럿으로 같은 요청을 동시에 보낸다.
//    이 컴퓨터와 `npm run check` 에는 Postgres 가 없어 건너뛴다(docs/ROADMAP.md 의 "사람 결정이 필요한 것").

// ---- 1. 가짜 pg ----

const fake = vi.hoisted(() => ({
  pools: [] as unknown[],
  log: [] as string[],
  released: 0,
  failOn: null as RegExp | null,
}));

vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeClient {
    async query(text: string) {
      fake.log.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
      if (fake.failOn?.test(text)) throw Object.assign(new Error("boom"), { code: "XX000" });
      return { rows: [], rowCount: null };
    }
    release() {
      fake.released += 1;
    }
  }
  class Pool extends EventEmitter {
    options: unknown;
    constructor(options: unknown) {
      super();
      this.options = options;
      fake.pools.push(this);
    }
    query(text: string) {
      return new FakeClient().query(text);
    }
    async connect() {
      return new FakeClient();
    }
    async end() {}
  }
  return { Pool, default: { Pool } };
});

describe("운영 DB(pg 의 Pool)를 감싼 것", () => {
  it("쉬는 연결의 오류를 듣는다(듣지 않으면 과정이 죽는다). 트랜잭션은 BEGIN·COMMIT, 던지면 ROLLBACK 하고 연결을 돌려준다", async () => {
    const before = fake.pools.length;
    const db = await openDatabase({ databaseUrl: "postgres://example.invalid/db", pgliteDir: "memory://" });
    expect(db.kind).toBe("postgres");
    const pool = fake.pools[before] as EventEmitter & { options: Record<string, unknown> };
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    expect(pool.options).toMatchObject({ max: 3, idleTimeoutMillis: 10_000 });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Neon 등이 쉬는 연결을 끊은 것처럼 낸다. 던지지 않고, 주소·메시지를 적지 않는다.
    expect(() => pool.emit("error", new Error("terminating connection postgres://user:pw@host/db"))).not.toThrow();
    expect(quiet.mock.calls.flat().join(" ")).not.toContain("postgres://");
    quiet.mockRestore();
    // 마이그레이션은 한 트랜잭션 안에서 잠금을 잡고 돌았다.
    expect(fake.log.slice(0, 2)).toEqual(["BEGIN", "SELECT pg_advisory_xact_lock($1)"]);
    expect(fake.log).toContain("COMMIT");

    fake.log.length = 0;
    const released = fake.released;
    expect((await db.query("SELECT 1")).rowCount).toBe(0);
    await expect(
      db.transaction(async (tx) => {
        await tx.query("SELECT 1");
        throw new Error("fn 이 던짐");
      }),
    ).rejects.toThrow("fn 이 던짐");
    expect(fake.log).toEqual(["SELECT 1", "BEGIN", "SELECT 1", "ROLLBACK"]);
    expect(fake.released).toBe(released + 1);
    await db.close();
  });

  it("마이그레이션이 실패하면 Pool 을 닫고 던진다", async () => {
    fake.failOn = /CREATE TABLE IF NOT EXISTS schema_migrations/;
    try {
      await expect(openDatabase({ databaseUrl: "postgres://example.invalid/db", pgliteDir: "memory://" })).rejects.toThrow("boom");
    } finally {
      fake.failOn = null;
    }
  });
});

// ---- 2. PGlite: 장치가 질의에 있고 그 길이 돈다 ----

const T0 = new Date("2026-11-03T03:00:00Z");
let lite: Database;
beforeAll(async () => {
  lite = await openDatabase({ databaseUrl: null, pgliteDir: "memory://" });
});
afterAll(async () => {
  await lite?.close();
});
beforeEach(async () => {
  await lite.query("DELETE FROM results");
  await lite.query("DELETE FROM analyses");
});

/** 트랜잭션 안의 질의를 적는 DB. `rewrite` 로 트랜잭션 안의 질의 결과를 바꿀 수 있다. */
function recording(
  base: Database,
  options: { before?: () => Promise<void>; rewrite?: (text: string, rows: unknown[]) => unknown[] } = {},
): Database & { transactions: string[][] } {
  const transactions: string[][] = [];
  return {
    kind: base.kind,
    transactions,
    query: (text, params) => base.query(text, params),
    close: () => base.close(),
    async transaction(fn) {
      await options.before?.();
      const seen: string[] = [];
      transactions.push(seen);
      return base.transaction((tx) =>
        fn({
          async query<T>(text: string, params?: unknown[]) {
            seen.push(text.replace(/\s+/g, " ").trim());
            const result = await tx.query<T>(text, params);
            return options.rewrite ? { ...result, rows: options.rewrite(text, result.rows) as T[] } : result;
          },
        } satisfies Queryable),
      );
    },
  } as Database & { transactions: string[][] };
}

function storeOn(db: Database) {
  const stub = createGitHubStub({ origin: "http://stub.test" });
  const base = readConfig({});
  return createDbStore({
    db: async () => db,
    github: createGitHub({ apiBase: "http://stub.test", token: null, searchCacheSeconds: 60, repoCacheSeconds: 300, fetch: stub.fetch as typeof fetch }),
    config: { github: base.github, limits: { ...base.limits, concurrent: 2 }, runner: { ...base.runner, kind: "local" } },
    now: () => T0,
    wake: async () => ({ ok: true }),
  });
}

describe("동시 요청을 막는 장치 (PGlite)", () => {
  it("분석 요청의 트랜잭션은 맨 먼저 권고 잠금을 잡고, 그 뒤에 같은 커밋·상한을 보고 행을 만든다", async () => {
    const db = recording(lite);
    await storeOn(db).requestAnalysis("example-org", "kids-signup");
    const tx = db.transactions.at(-1)!;
    expect(tx[0]).toBe("SELECT pg_advisory_xact_lock($1)");
    const insert = tx.findIndex((text) => text.startsWith("INSERT INTO analyses"));
    const limits = tx.findIndex((text) => text.includes("status IN ('queued', 'running')") && text.startsWith("SELECT count"));
    expect(limits).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(limits);
  });

  it("로컬 실행기가 집어 갈 때는 FOR UPDATE SKIP LOCKED 로 한 행만 잠근다", async () => {
    const db = recording(lite);
    await claimQueued(db, { now: T0, runTimeoutMinutes: 25 });
    expect(db.transactions.at(-1)!.some((text) => text.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
  });

  it("잠금 밖에서 같은 커밋의 분석이 그새 생겨 고유 제약에 걸리면, 그 분석을 되찾아 돌려준다(reused)", async () => {
    // 다른 서버가 잠금 없이 같은 커밋의 분석을 만든 것처럼: 이 요청이 같은 커밋을 찾을 때는 아직 보이지 않았고(빈 결과),
    // 행을 넣을 때는 이미 있다.
    const other = "zzzzzzzzzz";
    let commit = "";
    const db = recording(lite, {
      before: async () => {
        const stub = createGitHubStub({ origin: "http://stub.test" });
        commit = stub.head("example-org", "kids-signup") ?? "";
        await lite.query(
          `INSERT INTO analyses (id, owner, repo, repo_key, commit_sha, branch, status, requested_at, steps)
           VALUES ($1, 'example-org', 'kids-signup', 'example-org/kids-signup', $2, 'main', 'queued', $3, '[]'::jsonb)`,
          [other, commit, T0],
        );
      },
      rewrite: (text, rows) => (text.includes("AND commit_sha = $2") && text.includes("ORDER BY requested_at DESC LIMIT 1") ? [] : rows),
    });
    const outcome: RequestOutcome = await storeOn(db).requestAnalysis("example-org", "kids-signup");
    expect(outcome).toMatchObject({ ok: true, reused: true, analysis: { id: other, commit } });
    const count = await lite.query<{ n: number }>("SELECT count(*)::int AS n FROM analyses");
    expect(count.rows[0].n).toBe(1);
  });
});

// ---- 3. 실제 Postgres: 연결 여럿 ----

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("동시 요청 (실제 Postgres, TEST_DATABASE_URL)", () => {
  const dbs: Database[] = [];
  beforeAll(async () => {
    vi.doUnmock("pg");
    vi.resetModules();
    const { openDatabase: openReal } = await import("@/server/db");
    for (let i = 0; i < 4; i += 1) dbs.push(await openReal({ databaseUrl: url!, pgliteDir: "memory://" }));
  });
  afterAll(async () => {
    await Promise.all(dbs.map((db) => db.close()));
  });
  beforeEach(async () => {
    await dbs[0].query("DELETE FROM results");
    await dbs[0].query("DELETE FROM analyses");
  });

  it("같은 요청이 여러 연결로 동시에 와도 분석은 하나, 다른 저장소 셋이 동시에 와도 동시 상한(2)을 넘지 않는다", async () => {
    const stores = dbs.map(storeOn);
    const same = await Promise.all(stores.flatMap((store) => [store.requestAnalysis("example-org", "night-push"), store.requestAnalysis("example-org", "night-push")]));
    expect(new Set(same.map((o) => (o.ok ? o.analysis.id : "refused"))).size).toBe(1);
    await dbs[0].query("DELETE FROM analyses");
    const repos: [string, string][] = [["example-org", "kids-signup"], ["example-org", "night-push"], ["example-studio", "genai-chat"]];
    const many = await Promise.all(repos.map(([owner, repo], i) => stores[i].requestAnalysis(owner, repo)));
    expect(many.filter((o) => o.ok && !o.reused)).toHaveLength(2);
    const count = await dbs[0].query<{ n: number }>("SELECT count(*)::int AS n FROM analyses WHERE status IN ('queued', 'running')");
    expect(count.rows[0].n).toBe(2);
  });

  it("실행기 넷이 동시에 집어 가도 한 분석은 한 번만 나간다", async () => {
    const stores = dbs.map(storeOn);
    await stores[0].requestAnalysis("example-org", "kids-signup");
    await stores[0].requestAnalysis("example-org", "night-push");
    const claimed = await Promise.all(dbs.map((db) => claimQueued(db, { now: T0, runTimeoutMinutes: 25 })));
    const ids = claimed.filter((c) => c !== null).map((c) => c!.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
