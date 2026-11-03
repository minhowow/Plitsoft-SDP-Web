import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Analysis } from "@/lib/service/types";
import { syntheticStore } from "@/lib/service/synthetic";
import { getAnalysis, postAnalysis, postRunnerClaim, postRunnerEvent, type ApiDeps } from "@/server/api";
import { MAX_REASON_LENGTH } from "@/server/callbacks";
import { readConfig, type ServerConfig } from "@/server/config";
import { openDatabase, type Database } from "@/server/db";
import { createGitHub } from "@/server/github";
import { sign } from "@/server/signature";
import { createDbStore } from "@/server/store/db";
import { createGitHubStub } from "../scripts/github-stub.mjs";
import { root } from "./helpers";

// /api/ 의 일(src/server/api.ts)을 메모리 PGlite 와 가짜 GitHub 으로 부른다. route handler 는 이 함수를 부르기만 한다.
// 실제 GitHub·DB 서버·실행기를 부르지 않는다. 서명 열쇠는 시험용 고정 글이다.

const SECRET = "test-runner-secret";
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
});

function setup(env: Record<string, string> = {}) {
  const stub = createGitHubStub({ origin: "http://stub.test" });
  const clock = { now: T0 };
  const config: ServerConfig = readConfig({ RUNNER: "local", RUNNER_SECRET: SECRET, ...env });
  const store = createDbStore({
    db: async () => db,
    github: createGitHub({ apiBase: "http://stub.test", token: null, searchCacheSeconds: 60, repoCacheSeconds: 300, fetch: stub.fetch as typeof fetch, now: () => clock.now.getTime() }),
    config,
    now: () => clock.now,
  });
  const deps: ApiDeps = { store: () => store, db: async () => db, config: () => config, now: () => clock.now };
  return { deps, clock, stub, later: (minutes: number) => (clock.now = new Date(clock.now.getTime() + minutes * 60_000)) };
}

const request = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request("http://site.test/api/analyses/", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

async function requestAnalysis(deps: ApiDeps, owner = "example-org", repo = "kids-signup") {
  const response = await postAnalysis(request({ owner, repo }), deps);
  return {
    status: response.status,
    body: (await response.json()) as { ok: boolean; reused?: boolean; analysis?: Analysis; queue?: unknown; href?: string; reason?: string; message?: string },
  };
}

/** 실행기가 보내는 것처럼 서명한 콜백. */
function signed(scope: string, payload: unknown, options: { secret?: string; at?: Date; signScope?: string; raw?: string } = {}) {
  const body = options.raw ?? JSON.stringify(payload);
  const timestamp = String(Math.floor((options.at ?? T0).getTime() / 1000));
  return new Request(`http://site.test/api/runner/${scope}/`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-runner-timestamp": timestamp,
      "x-runner-signature": sign(options.secret ?? SECRET, timestamp, options.signScope ?? scope, body),
    },
    body,
  });
}

/** 그 분석 행의 저장소·커밋(실행기가 모든 콜백에 싣는 `target`). 없는 분석이면 아무 값. */
async function targetOf(id: string) {
  const found = (await db.query<{ owner: string; repo: string; commit_sha: string }>("SELECT owner, repo, commit_sha FROM analyses WHERE id = $1", [id])).rows[0];
  return found ? { owner: found.owner, repo: found.repo, commit: found.commit_sha } : { owner: "example-org", repo: "kids-signup", commit: "0".repeat(40) };
}

/** 실행기처럼 보낸다. 본문에 `target` 이 없으면 그 분석 행의 것을 싣는다(`target: null` 이면 싣지 않는다). */
async function event(deps: ApiDeps, id: string, payload: unknown, options: Parameters<typeof signed>[2] = {}) {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    const value = payload as Record<string, unknown>;
    if (!("target" in value)) payload = { ...value, target: await targetOf(id) };
    else if (value.target === null) payload = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "target"));
  }
  const response = await postRunnerEvent(signed(id, payload, { at: deps.now(), ...options }), id, deps);
  return { status: response.status, body: (await response.json()) as { ok: boolean; message: string; status?: string; unchanged?: boolean } };
}

const row = async (id: string) =>
  (await db.query<Record<string, unknown>>("SELECT * FROM analyses WHERE id = $1", [id])).rows[0] as {
    status: string;
    failure_step: string | null;
    failure_reason: string | null;
    tool_version: string | null;
    pack_digest: string | null;
    runner_run_id: string | null;
    runner_run_url: string | null;
    steps: { name: string; startedAt: string | null; endedAt: string | null }[];
  };

const capture = readFileSync(path.join(root, "contract", "cli-current", "kids-signup.main.json"), "utf8");

async function runToFinish(deps: ApiDeps, id: string) {
  for (const step of ["fetch", "scan", "finish"]) expect((await event(deps, id, { event: "step", step })).status).toBe(200);
}

describe("POST /api/analyses/ (설계 5)", () => {
  it("새 분석은 201 과 분석 쪽 주소, 같은 커밋의 진행 중인 분석은 200 과 reused", async () => {
    const { deps } = setup();
    const first = await requestAnalysis(deps);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ ok: true, reused: false, analysis: { owner: "example-org", name: "kids-signup", status: "queued" } });
    expect(first.body.href).toBe(`/r/example-org/kids-signup/a/${first.body.analysis!.id}/`);
    const again = await requestAnalysis(deps, "EXAMPLE-ORG", "Kids-Signup");
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ ok: true, reused: true, analysis: { id: first.body.analysis!.id } });
  });

  it("같은 요청이 동시에 여러 번 와도 분석은 하나다", async () => {
    const { deps } = setup({ POOL_SIZE: "5" });
    const answers = await Promise.all(Array.from({ length: 6 }, () => requestAnalysis(deps)));
    expect(new Set(answers.map((a) => a.body.analysis!.id)).size).toBe(1);
    expect(answers.filter((a) => a.status === 201)).toHaveLength(1);
    expect((await db.query("SELECT id FROM analyses")).rows).toHaveLength(1);
  });

  it("받지 않는 까닭마다 상태 코드와 화면에 적을 말: 없음 404, 너무 큼 422, 대기열 상한 429, 실행기 없음 503", async () => {
    const { deps } = setup({ POOL_SIZE: "1", QUEUE_LIMIT: "1" });
    expect(await requestAnalysis(deps, "example-labs", "secret-repo")).toMatchObject({ status: 404, body: { reason: "not-found" } });
    expect(await requestAnalysis(deps, "example-labs", "no-such")).toMatchObject({ status: 404, body: { reason: "not-found" } });
    expect(await requestAnalysis(deps, "../etc", "passwd")).toMatchObject({ status: 404, body: { reason: "not-found" } });
    expect(await requestAnalysis(deps, "example-labs", "huge-monorepo")).toMatchObject({ status: 422, body: { reason: "too-large" } });
    // 실행 자리(1)가 차도 받는다. 대기열(1)이 차면 그때 받지 않는다.
    const first = await requestAnalysis(deps);
    expect(first).toMatchObject({ status: 201, body: { queue: { kind: "dispatched", poolSize: 1, inUse: 1 } } });
    const second = await requestAnalysis(deps, "example-org", "night-push");
    expect(second).toMatchObject({ status: 201, body: { analysis: { status: "queued" }, queue: { kind: "waiting", ahead: 0, poolSize: 1, inUse: 1 } } });
    const limited = await requestAnalysis(deps, "example-studio", "genai-chat");
    expect(limited).toMatchObject({ status: 429, body: { reason: "limit" } });
    expect(limited.body.message).toContain("대기열 상한 1건");
    const closed = setup({ RUNNER: "none" });
    expect(await requestAnalysis(closed.deps)).toMatchObject({ status: 503, body: { reason: "closed" } });
    expect((await postAnalysis(request({ owner: "example-org", repo: "kids-signup" }), { ...deps, store: () => syntheticStore })).status).toBe(503);
  });

  it("JSON 본문만 받는다: 양식·글 본문은 415, 읽히지 않는 본문·이름 없음은 400, 큰 본문은 413", async () => {
    const { deps } = setup();
    expect((await postAnalysis(request("owner=a&repo=b", { "content-type": "application/x-www-form-urlencoded" }), deps)).status).toBe(415);
    expect((await postAnalysis(request("{", { "content-type": "application/json" }), deps)).status).toBe(400);
    expect((await postAnalysis(request({ owner: "a" }), deps)).status).toBe(400);
    expect((await postAnalysis(request({ owner: "a", repo: "b", pad: "x".repeat(4000) }), deps)).status).toBe(413);
    expect((await db.query("SELECT id FROM analyses")).rows).toHaveLength(0);
  });

  it("모르는 오류는 500 과 정해진 말만 싣는다(내부 오류 글·비밀값을 싣지 않는다)", async () => {
    const { deps } = setup();
    const broken: ApiDeps = {
      ...deps,
      store: () => ({
        ...syntheticStore,
        synthetic: false,
        requestAnalysis: async () => {
          throw new Error(`connect ECONNREFUSED postgres://user:${SECRET}@db`);
        },
      }),
    };
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const response = await postAnalysis(request({ owner: "example-org", repo: "kids-signup" }), broken);
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("ECONNREFUSED");
      expect(JSON.stringify(errors)).not.toContain(SECRET);
    } finally {
      console.error = original;
    }
  });
});

describe("GET /api/analyses/{id}/", () => {
  it("분석의 진행을 돌려준다. 실행기 run 같은 내부 값은 싣지 않는다. 모양이 아닌 id·없는 id 는 404", async () => {
    const { deps } = setup();
    const { body } = await requestAnalysis(deps);
    const id = body.analysis!.id;
    await event(deps, id, { event: "step", step: "fetch", run: { id: "123", url: "https://github.com/o/runner/actions/runs/123" } });
    const response = await getAnalysis(id, deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = (await response.json()) as { analysis: Analysis };
    expect(data.analysis.status).toBe("running");
    expect(data.analysis.steps.map((s) => [s.name, Boolean(s.startedAt), Boolean(s.endedAt)])).toEqual([
      ["queued", true, true],
      ["fetch", true, false],
      ["scan", false, false],
      ["finish", false, false],
    ]);
    expect(JSON.stringify(data)).not.toContain("actions/runs");
    expect((await getAnalysis("zzzzzzzzzz", deps)).status).toBe(404);
    expect((await getAnalysis("../../etc", deps)).status).toBe(404);
  });
});

describe("실행기 콜백: 서명 (설계 6)", () => {
  it("RUNNER_SECRET 이 없으면 모든 콜백을 거절한다(서명이 맞아 보여도)", async () => {
    const { deps } = setup({ RUNNER_SECRET: "" });
    const id = "abcdefghjk";
    const response = await postRunnerEvent(signed(id, { event: "step", step: "fetch" }, { secret: "" }), id, deps);
    expect(response.status).toBe(503);
    expect((await postRunnerClaim(signed("claim", {}), deps)).status).toBe(503);
  });

  it("합성 미리보기(SERVICE_STORE=synthetic)는 콜백을 받지 않는다", async () => {
    const { deps } = setup({ SERVICE_STORE: "synthetic" });
    expect((await event(deps, "abcdefghjk", { event: "step", step: "fetch" })).status).toBe(503);
  });

  it("위조한 서명, 서명 없음, 다른 분석에 보낸 서명, 다른 본문은 401 이고 아무것도 바꾸지 않는다", async () => {
    const { deps } = setup();
    const id = (await requestAnalysis(deps)).body.analysis!.id;
    const payload = { event: "step", step: "fetch" };
    expect((await event(deps, id, payload, { secret: "wrong-secret" })).status).toBe(401);
    expect((await event(deps, id, payload, { signScope: "abcdefghjk" })).status).toBe(401);
    const unsigned = new Request(`http://site.test/api/runner/${id}/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    expect((await postRunnerEvent(unsigned, id, deps)).status).toBe(401);
    // 서명한 본문과 다른 본문
    const good = signed(id, payload);
    const tampered = new Request(good.url, { method: "POST", headers: good.headers, body: JSON.stringify({ event: "fail", step: "fetch", reason: "x" }) });
    expect((await postRunnerEvent(tampered, id, deps)).status).toBe(401);
    expect((await row(id)).status).toBe("queued");
  });

  it("시각이 5분 넘게 어긋나면 401 이고 그렇다고 알린다. 5분 안이면 받는다", async () => {
    const { deps } = setup();
    const id = (await requestAnalysis(deps)).body.analysis!.id;
    const payload = { event: "step", step: "fetch" };
    const old = await event(deps, id, payload, { at: new Date(T0.getTime() - 5 * 60_000 - 2_000) });
    expect(old.status).toBe(401);
    expect(old.body.message).toContain("5분");
    expect((await event(deps, id, payload, { at: new Date(T0.getTime() + 6 * 60_000) })).status).toBe(401);
    expect((await event(deps, id, payload, { at: new Date(T0.getTime() - 4 * 60_000) })).status).toBe(200);
  });

  it("결과 크기 상한(RESULT_MAX_KB)을 넘는 본문은 413 이고 아무것도 바꾸지 않는다", async () => {
    const { deps } = setup({ RESULT_MAX_KB: "2" });
    const id = (await requestAnalysis(deps)).body.analysis!.id;
    await runToFinish(deps, id);
    const big = await event(deps, id, { event: "result", output: "x".repeat(3_000) });
    expect(big.status).toBe(413);
    expect((await row(id)).status).toBe("running");
    expect((await db.query("SELECT * FROM results")).rows).toHaveLength(0);
  });

  it("모양이 맞지 않는 콜백은 400", async () => {
    const { deps } = setup();
    const id = (await requestAnalysis(deps)).body.analysis!.id;
    for (const payload of [
      { event: "step", step: "queued" },
      { event: "step", step: "judge" },
      { event: "step", step: "fetch", run: { id: "1", url: "https://evil.example/actions/runs/1" } },
      { event: "result" },
      { event: "fail", step: "scan", reason: "   " },
      { event: "other" },
      [],
    ]) {
      expect((await event(deps, id, payload)).status, JSON.stringify(payload)).toBe(400);
    }
    expect((await event(deps, id, null, { raw: "{" })).status).toBe(400);
  });
});

describe("실행기 콜백: 머리를 먼저 보고, 저장소·커밋을 묶는다 (검토 1)", () => {
  /** 읽힌 만큼 세는 큰 본문. 읽기 전에는 아무것도 꺼내지 않는다(highWaterMark 0). */
  function counted(headers: Record<string, string>) {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += 1;
          if (pulled > 64) controller.close();
          else controller.enqueue(new Uint8Array(64 * 1024));
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request("http://site.test/api/runner/abcdefghjk/", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: stream,
      duplex: "half",
    } as RequestInit);
    return { request, pulled: () => pulled };
  }

  it("서명 머리가 없거나 모양이 틀리거나 시각이 어긋나면 본문을 읽지 않고 401", async () => {
    const { deps } = setup();
    const at = String(Math.floor(T0.getTime() / 1000));
    for (const headers of [
      {} as Record<string, string>,
      { "x-runner-timestamp": "1", "x-runner-signature": "x" },
      { "x-runner-timestamp": at, "x-runner-signature": "v1=zz" },
      { "x-runner-timestamp": String(Number(at) - 3600), "x-runner-signature": `v1=${"0".repeat(64)}` },
    ]) {
      const { request, pulled } = counted(headers);
      expect((await postRunnerEvent(request, "abcdefghjk", deps)).status, JSON.stringify(headers)).toBe(401);
      expect(pulled(), JSON.stringify(headers)).toBe(0);
    }
    // 머리 모양이 맞으면 그때 본문을 읽는다(서명이 틀려 401 이지만 읽기는 했다).
    const { request, pulled } = counted({ "x-runner-timestamp": at, "x-runner-signature": `v1=${"0".repeat(64)}` });
    expect((await postRunnerEvent(request, "abcdefghjk", deps)).status).toBe(413);
    expect(pulled()).toBeGreaterThan(0);
  });

  it("콜백은 그 분석의 저장소·커밋(target)을 실어야 한다. 없으면 400, 다르면 409 이고 아무것도 바꾸지 않는다. 대소문자는 가리지 않는다", async () => {
    const { deps } = setup();
    const id = (await requestAnalysis(deps)).body.analysis!.id;
    const target = await targetOf(id);
    expect((await event(deps, id, { event: "step", step: "fetch", target: null })).status).toBe(400);
    expect((await event(deps, id, { event: "step", step: "fetch", target: { ...target, commit: "main" } })).status).toBe(400);
    for (const other of [
      { ...target, repo: "night-push" },
      { ...target, owner: "someone-else" },
      { ...target, commit: "f".repeat(40) },
    ]) {
      const refused = await event(deps, id, { event: "step", step: "fetch", target: other });
      expect(refused.status, JSON.stringify(other)).toBe(409);
      expect(refused.body.message).toContain("저장소·커밋");
    }
    expect((await row(id)).status).toBe("queued");
    await runToFinish(deps, id);
    // 다른 저장소를 검사한 결과는 붙지 않는다.
    expect((await event(deps, id, { event: "result", output: capture, target: { ...target, repo: "night-push" } })).status).toBe(409);
    expect((await db.query("SELECT * FROM results")).rows).toHaveLength(0);
    const upper = { ...target, owner: target.owner.toUpperCase(), repo: target.repo.toUpperCase() };
    expect((await event(deps, id, { event: "result", output: capture, target: upper })).status).toBe(200);
    expect((await row(id)).status).toBe("succeeded");
  });
});

describe("발견 수를 결과를 받을 때 세어 둔다 (검토 1)", () => {
  it("끝난 분석의 발견 수는 결과 화면과 같은 파서로 센 값이고, 쪽은 결과 JSON 을 읽지 않고 그 값을 읽는다. 읽지 못한 결과·끝나지 않은 분석은 없음", async () => {
    const { deps, stub, later } = setup({ POOL_SIZE: "5" });
    const good = (await requestAnalysis(deps)).body.analysis!.id;
    await runToFinish(deps, good);
    expect((await event(deps, good, { event: "result", output: capture })).status).toBe(200);
    stub.setHead("example-org", "kids-signup", "2");
    later(1);
    const bad = (await requestAnalysis(deps)).body.analysis!.id;
    await runToFinish(deps, bad);
    expect((await event(deps, bad, { event: "result", output: "{}" })).status).toBe(200);
    const waiting = (await requestAnalysis(deps, "example-org", "night-push")).body.analysis!.id;
    const expected = (JSON.parse(capture) as { findings: unknown[] }).findings.length;
    expect(expected).toBeGreaterThan(0);
    expect(await deps.store().findingCounts([good, bad, waiting, "not-an-id"])).toEqual({ [good]: expected });
    expect((await db.query<{ finding_count: number | null }>("SELECT finding_count FROM analyses WHERE id = $1", [bad])).rows[0].finding_count).toBeNull();
    // 합성 저장소도 같은 뜻이다.
    const synthetic = (await syntheticStore.recentSucceeded(10)).map(({ analysis }) => analysis.id);
    const counts = await syntheticStore.findingCounts(synthetic);
    expect(Object.keys(counts).sort()).toEqual([...synthetic].sort());
  });
});

describe("실행기 콜백: 상태 전이 (설계 6)", () => {
  it("차례대로: 저장소 받기 → 검사 → 정리 → 결과. 끝나면 succeeded, 도구·팩 판을 결과에서 적고 결과는 받은 글 그대로다", async () => {
    const { deps, later } = setup();
    const id = (await requestAnalysis(deps)).body.analysis!.id;
    const run = { id: "987654", url: "https://github.com/owner/runner/actions/runs/987654" };
    expect(await event(deps, id, { event: "step", step: "fetch", run })).toMatchObject({ status: 200, body: { status: "running" } });
    later(1);
    await event(deps, id, { event: "step", step: "scan" });
    later(2);
    await event(deps, id, { event: "step", step: "finish" });
    expect((await event(deps, id, { event: "result", output: capture })).body).toMatchObject({ ok: true, status: "succeeded" });
    const stored = await row(id);
    expect(stored).toMatchObject({ status: "succeeded", tool_version: "0.3.0.dev0", pack_digest: "fa6fc2b3e62d8d0d", runner_run_id: "987654", runner_run_url: run.url });
    // 시각은 콜백을 받은 때다. 단계마다 시작과 끝이 있고, 앞 단계의 끝이 다음 단계의 시작이다.
    expect(stored.steps.map((s) => [s.name, s.startedAt, s.endedAt])).toEqual([
      ["queued", T0.toISOString(), T0.toISOString()],
      ["fetch", T0.toISOString(), new Date(T0.getTime() + 60_000).toISOString()],
      ["scan", new Date(T0.getTime() + 60_000).toISOString(), new Date(T0.getTime() + 180_000).toISOString()],
      ["finish", new Date(T0.getTime() + 180_000).toISOString(), new Date(T0.getTime() + 180_000).toISOString()],
    ]);
    expect((await db.query<{ json: string }>("SELECT json FROM results WHERE analysis_id = $1", [id])).rows[0].json).toBe(capture);
    const { store } = { store: deps.store() };
    expect(await store.getResult(id)).toEqual(JSON.parse(capture));
    expect((await store.findAnalysis(id))?.versions).toEqual({ tool: "0.3.0.dev0", pack: "fa6fc2b3e62d8d0d" });
  });

  it("같은 단계를 다시 알리면 바꾸지 않고 받는다(실행기가 다시 보낸 것)", async () => {
    const { deps, later } = setup();
    const id = (await requestAnalysis(deps)).body.analysis!.id;
    await event(deps, id, { event: "step", step: "fetch" });
    const before = await row(id);
    later(1);
    expect(await event(deps, id, { event: "step", step: "fetch" })).toMatchObject({ status: 200, body: { unchanged: true } });
    expect((await row(id)).steps).toEqual(before.steps);
  });

  it("순서가 어긋난 단계는 409: 건너뛰기, 뒤로 가기, 정리 전의 결과", async () => {
    const { deps } = setup();
    const id = (await requestAnalysis(deps)).body.analysis!.id;
    expect((await event(deps, id, { event: "step", step: "scan" })).status).toBe(409);
    expect((await event(deps, id, { event: "result", output: capture })).status).toBe(409);
    await event(deps, id, { event: "step", step: "fetch" });
    expect((await event(deps, id, { event: "step", step: "finish" })).status).toBe(409);
    await event(deps, id, { event: "step", step: "scan" });
    expect((await event(deps, id, { event: "step", step: "fetch" })).status).toBe(409);
    expect((await event(deps, id, { event: "result", output: capture })).status).toBe(409);
    expect((await row(id)).status).toBe("running");
    expect((await db.query("SELECT * FROM results")).rows).toHaveLength(0);
  });

  it("끝난 분석은 다시 바꾸지 못한다(단계·결과·실패 모두 409)", async () => {
    const { deps } = setup();
    const id = (await requestAnalysis(deps)).body.analysis!.id;
    await runToFinish(deps, id);
    await event(deps, id, { event: "result", output: capture });
    const done = await row(id);
    for (const payload of [
      { event: "result", output: "{}" },
      { event: "fail", step: "finish", reason: "덮어쓰기" },
      { event: "step", step: "fetch" },
      { event: "step", step: "finish" },
    ]) {
      expect((await event(deps, id, payload)).status, JSON.stringify(payload)).toBe(409);
    }
    expect(await row(id)).toEqual(done);
    // 실패한 분석도 그렇다.
    const other = (await requestAnalysis(deps, "example-org", "night-push")).body.analysis!.id;
    await event(deps, other, { event: "fail", step: "fetch", reason: "받지 못함" });
    expect((await event(deps, other, { event: "step", step: "fetch" })).status).toBe(409);
    expect((await event(deps, other, { event: "fail", step: "fetch", reason: "다시" })).status).toBe(409);
    expect((await row(other)).failure_reason).toBe("받지 못함");
  });

  it("읽히지 않는 결과는 받은 그대로 두고 실패('결과를 읽지 못함', 정리 단계)로 적는다. 화면에는 결과로 내지 않는다", async () => {
    const { deps } = setup({ POOL_SIZE: "5" });
    for (const [repo, output] of [
      ["kids-signup", "not json at all"],
      ["night-push", JSON.stringify({ tool: { name: "policypack" } })],
    ] as const) {
      const id = (await requestAnalysis(deps, "example-org", repo)).body.analysis!.id;
      await runToFinish(deps, id);
      expect((await event(deps, id, { event: "result", output })).body).toMatchObject({ ok: true, status: "failed" });
      const stored = await row(id);
      expect(stored.status).toBe("failed");
      expect(stored.failure_step).toBe("finish");
      expect(stored.failure_reason).toMatch(/^결과를 읽지 못함: /);
      expect(stored.tool_version).toBeNull();
      expect((await db.query<{ json: string }>("SELECT json FROM results WHERE analysis_id = $1", [id])).rows[0].json).toBe(output);
      expect(await deps.store().getResult(id)).toBeNull();
    }
  });

  it("실패: 지금 단계나 그다음 단계에서만 받는다. 까닭은 제어 문자를 빼고 자른다. 멈춘 시각은 받은 때다", async () => {
    const { deps, later } = setup();
    const id = (await requestAnalysis(deps)).body.analysis!.id;
    await event(deps, id, { event: "step", step: "fetch" });
    expect((await event(deps, id, { event: "fail", step: "finish", reason: "멀리" })).status).toBe(409);
    later(2);
    const long = `줄\n바꿈\u0007${"가".repeat(MAX_REASON_LENGTH)}`;
    expect((await event(deps, id, { event: "fail", step: "scan", reason: long })).status).toBe(200);
    const stored = await row(id);
    expect(stored.status).toBe("failed");
    expect(stored.failure_step).toBe("scan");
    expect(stored.failure_reason!.startsWith("줄 바꿈 가")).toBe(true);
    expect(stored.failure_reason!.length).toBe(MAX_REASON_LENGTH);
    // 저장소 받기가 언제 끝났는지는 모른다(적지 않는다). 검사 단계는 시작을 알리지 않았고 멈춘 때만 안다.
    expect(stored.steps.find((s) => s.name === "fetch")).toMatchObject({ endedAt: null });
    expect(stored.steps.find((s) => s.name === "scan")).toMatchObject({ startedAt: null, endedAt: new Date(T0.getTime() + 120_000).toISOString() });
  });

  it("시간을 넘긴 분석(RUN_TIMEOUT_MINUTES)은 콜백을 받기 전에 '시간 초과'로 끝내므로, 늦은 콜백은 409", async () => {
    const { deps, later } = setup();
    const id = (await requestAnalysis(deps)).body.analysis!.id;
    await event(deps, id, { event: "step", step: "fetch" });
    later(26);
    expect((await event(deps, id, { event: "step", step: "scan" })).status).toBe(409);
    expect((await row(id))).toMatchObject({ status: "failed", failure_step: "fetch" });
    expect((await row(id)).failure_reason).toContain("시간 초과");
  });

  it("없는 분석·모양이 아닌 id 는 404", async () => {
    const { deps } = setup();
    expect((await event(deps, "abcdefghjk", { event: "step", step: "fetch" })).status).toBe(404);
    expect((await event(deps, "NOT-AN-ID", { event: "step", step: "fetch" })).status).toBe(404);
  });
});

describe("대기열과 실행 자리 (2026-11-03)", () => {
  it("진행 읽기(GET)는 대기 중인 분석의 대기열 자리를 준다. 대기 중이 아니면 null", async () => {
    const { deps, later } = setup({ POOL_SIZE: "1" });
    const a = (await requestAnalysis(deps)).body.analysis!.id;
    later(1);
    const b = (await requestAnalysis(deps, "example-org", "night-push")).body.analysis!.id;
    const read = async (id: string) => (await (await getAnalysis(id, deps)).json()) as { queue: unknown };
    expect((await read(a)).queue).toEqual({ kind: "dispatched", poolSize: 1, inUse: 1 });
    expect((await read(b)).queue).toEqual({ kind: "waiting", ahead: 0, poolSize: 1, inUse: 1 });
    await event(deps, a, { event: "step", step: "fetch" });
    expect((await read(a)).queue).toBeNull();
  });

  it("아직 실행기에 보내지 않은(대기열의) 분석에 온 알림은 409 이고 바꾸지 않는다", async () => {
    const { deps, later } = setup({ POOL_SIZE: "1" });
    await requestAnalysis(deps);
    later(1);
    const waiting = (await requestAnalysis(deps, "example-org", "night-push")).body.analysis!.id;
    const before = await row(waiting);
    for (const payload of [{ event: "step", step: "fetch" }, { event: "fail", step: "fetch", reason: "x" }]) {
      const answer = await event(deps, waiting, payload);
      expect(answer.status).toBe(409);
      expect(answer.body.message).toContain("대기열");
    }
    expect(await row(waiting)).toEqual(before);
  });

  it("한 분석에는 실행 하나만 붙는다: 다른 실행(run id)의 단계 알림은 409 다(깨우기를 대기열에 되돌린 뒤 실행이 둘 생긴 경우)", async () => {
    const { deps } = setup();
    const id = (await requestAnalysis(deps)).body.analysis!.id;
    const run = (n: string) => ({ id: n, url: `https://github.com/example-runner/runner/actions/runs/${n}` });
    expect((await event(deps, id, { event: "step", step: "fetch", run: run("111") })).status).toBe(200);
    const late = await event(deps, id, { event: "step", step: "fetch", run: run("222") });
    expect(late.status).toBe(409);
    expect(late.body.message).toContain("다른 실행");
    expect((await row(id)).runner_run_id).toBe("111");
    // 같은 실행이 다시 알리면 받는다.
    expect((await event(deps, id, { event: "step", step: "fetch", run: run("111") })).body.unchanged).toBe(true);
  });

  it("실행기가 결과나 실패를 알리면 자리가 나서 대기열의 다음 분석을 실행기에 보낸다", async () => {
    const woken: string[] = [];
    const { deps, later } = setup({ POOL_SIZE: "1" });
    const wake = async (input: { analysisId: string }) => {
      woken.push(input.analysisId);
      return { ok: true as const };
    };
    const withWake: ApiDeps = { ...deps, wake };
    const a = (await requestAnalysis(deps)).body.analysis!.id;
    later(1);
    const b = (await requestAnalysis(deps, "example-org", "night-push")).body.analysis!.id;
    later(1);
    const c = (await requestAnalysis(deps, "example-studio", "genai-chat")).body.analysis!.id;
    await runToFinish(withWake, a);
    expect(woken).toEqual([]);
    expect((await event(withWake, a, { event: "result", output: capture })).body.status).toBe("succeeded");
    expect(woken).toEqual([b]);
    expect((await row(b)).status).toBe("queued");
    expect((await deps.store().queue())).toMatchObject({ inUse: 1, waiting: [c], dispatched: [b] });
    await event(withWake, b, { event: "fail", step: "fetch", reason: "받지 못함" });
    expect(woken).toEqual([b, c]);
  });
});

describe("로컬 실행기가 집어 가기 (RUNNER=local)", () => {
  it("가장 먼저 요청한 대기 중인 분석을 한 번만 내준다. 없으면 null", async () => {
    const { deps, later } = setup({ POOL_SIZE: "5" });
    const first = (await requestAnalysis(deps)).body.analysis!;
    later(1);
    const second = (await requestAnalysis(deps, "example-org", "night-push")).body.analysis!;
    const claim = async () => (await (await postRunnerClaim(signed("claim", {}, { at: deps.now() }), deps)).json()) as { analysis: { id: string; owner: string; repo: string; commit: string } | null };
    const both = await Promise.all([claim(), claim()]);
    expect(both.map((b) => b.analysis?.id).sort()).toEqual([first.id, second.id].sort());
    expect((await claim()).analysis).toBeNull();
    expect(both.find((b) => b.analysis?.id === first.id)!.analysis).toEqual({ id: first.id, owner: "example-org", repo: "kids-signup", commit: first.commit });
  });

  it("집어 가기도 실행 자리 수를 지킨다: 자리가 차 있으면 대기열의 분석을 내주지 않고, 앞의 것이 끝나면 내준다", async () => {
    const { deps, later } = setup({ POOL_SIZE: "1" });
    const first = (await requestAnalysis(deps)).body.analysis!.id;
    later(1);
    const second = (await requestAnalysis(deps, "example-org", "night-push")).body.analysis!.id;
    const claim = async () => ((await (await postRunnerClaim(signed("claim", {}, { at: deps.now() }), deps)).json()) as { analysis: { id: string } | null }).analysis;
    expect((await claim())?.id).toBe(first);
    expect(await claim()).toBeNull();
    await runToFinish(deps, first);
    await event(deps, first, { event: "result", output: capture });
    expect((await claim())?.id).toBe(second);
    expect(await claim()).toBeNull();
  });

  it("RUNNER=local 이 아니면 404, 서명이 틀리면 401", async () => {
    const github = setup({ RUNNER: "github" });
    expect((await postRunnerClaim(signed("claim", {}), github.deps)).status).toBe(404);
    const local = setup();
    expect((await postRunnerClaim(signed("claim", {}, { secret: "nope" }), local.deps)).status).toBe(401);
    // 분석 id 에 보낸 서명으로 집어 가지 못한다.
    expect((await postRunnerClaim(signed("claim", {}, { signScope: "abcdefghjk" }), local.deps)).status).toBe(401);
  });
});
