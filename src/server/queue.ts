import "server-only";
import { WAKE_RETRY_MINUTES, type QueueSnapshot } from "@/lib/service/queue";
import { STEP_LABEL } from "@/lib/service/steps";
import type { StepName } from "@/lib/service/types";
import type { RunnerKind, ServerConfig } from "./config";
import type { Database, Queryable } from "./db";
import type { WakeInput, WakeOutcome } from "./runner";
import { readSteps, stalledStep, type Row } from "./store/rows";

/**
 * 대기열과 실행 자리(2026-11-03, 오너 제안: "최대 pool 을 정해서 tasks 로서 작동해서, 계속 큐를 처리").
 *
 * - 요청은 (같은 커밋으로 보내기, 하루 상한, 크기 상한을 지나면) 늘 대기열(`status = 'queued'`, `dispatched_at IS NULL`)에 받는다.
 *   대기열이 `QUEUE_LIMIT` 이면 그때만 받지 않는다.
 * - 실행 자리(`POOL_SIZE`)를 쓰는 것: 실행기에 보냈고 시작을 알리지 않은 분석(`queued`, `dispatched_at` 있음)과 분석 중(`running`).
 *   자리가 비면 가장 먼저 요청한 대기열의 분석부터 실행기를 깨운다(`pumpQueue`).
 * - 깨우는 때(`tidyQueue`): 요청을 받았을 때, 실행기 콜백을 받았을 때, 쪽·진행을 읽을 때, 로컬 실행기가 집어 갈 때. 주기적으로
 *   깨우는 것(cron)은 아직 없다(docs/ROADMAP.md 의 사람 결정). 그래서 아무도 읽지 않는 동안 자리가 비어도 대기열은 다음 깨우는
 *   때까지 기다린다. 그 기다림을 대기열 탓으로 실패시키지 않게, 정리는 "실행 시간 초과·보냄 시간 초과 → 넘기기 → 대기 시간 초과"
 *   차례로 한다.
 * - 자리가 없거나 대기열이 비었으면 잠금 없이 한 번 세고 돌아간다.
 * - 서버 메모리에 상태를 두지 않는다. 자리를 셀 때와 보낼 분석을 고를 때는 권고 잠금(`QUEUE_LOCK`) 안에서 하고, 고른 행은
 *   `UPDATE … WHERE status = 'queued' AND dispatched_at IS NULL … RETURNING` 으로 표시한다. 서버 인스턴스 여럿이 동시에 깨워도
 *   한 분석을 두 번 보내지 않고, 자리 수를 넘겨 보내지 않는다.
 * - 실행기를 깨우는 HTTP 요청은 잠금 밖에서 한다(GitHub 이 느려도 다른 요청이 기다리지 않게). 깨우지 못하면 그 분석을 실패로
 *   적지 않고 대기열의 제자리에 되돌린다(`dispatched_at` 을 비운다). 깨우지 못한 때와 까닭은 DB(`runner_wake`)에 적고, 그 뒤
 *   `WAKE_RETRY_MINUTES`(2분) 동안은 어느 인스턴스도 깨우지 않는다. 실행기 장애가 이어져도 쪽을 읽을 때마다 대기열의 분석이 하나씩
 *   실패로 적히지 않는다. 장애가 오래가면 대기 시간 초과가 까닭(마지막으로 깨우지 못한 까닭)과 함께 끝낸다.
 *
 * 시간 상한:
 * - 실행기에 보낸 뒤 `DISPATCH_TIMEOUT_MINUTES`(10) 안에 시작을 알리지 않으면 실패(대기 단계). 자리가 빈다(`sweepStale`).
 * - 실행기에 보낸 뒤 `RUN_TIMEOUT_MINUTES`(32) 안에 끝나지 않으면 '시간 초과'. 요청한 때가 아니라 보낸 때부터 센다(대기열에
 *   오래 있던 것은 실행 시간이 아니다)(`sweepStale`).
 * - 대기열에서 `QUEUE_TIMEOUT_MINUTES`(120)를 넘게 기다리면 실패(대기 단계, 까닭). 넘기기를 해 본 뒤에도 보내지 못한 것만이다
 *   (`expireWaiting`). 까닭에는 그때 센 사실만 적는다.
 */

export type QueueLimits = Pick<
  ServerConfig["limits"],
  "poolSize" | "runTimeoutMinutes" | "dispatchTimeoutMinutes" | "queueTimeoutMinutes"
>;

export interface PumpDeps {
  now: () => Date;
  limits: QueueLimits;
  wake: (input: WakeInput) => Promise<WakeOutcome>;
  /** 실행기가 콜백할 이 사이트의 주소(SITE_URL). */
  callbackBase: string | null;
  /** RUNNER. `none` 이면 대기열을 넘기지 않는다(정리만 한다). */
  runner: RunnerKind;
  /** REVIEW 스위치(`ServerConfig.runner.review`). 없으면 끔이다. */
  review?: boolean;
}

/**
 * 같은 저장소(소문자 열쇠)·커밋의 끝난 분석에 저장된 review 가 있는지. 있으면 다시 돌리지 않고 그것을 보인다(2026-11-11 오너 지시).
 * 조건은 `getReview` 와 같다(보일 수 있는 review 가 있을 때만 건너뛴다).
 */
export async function storedReviewExists(db: Queryable, repoKey: string, commit: string): Promise<boolean> {
  const rows = await db.query(
    `SELECT 1 FROM results r JOIN analyses a ON a.id = r.analysis_id
     WHERE a.repo_key = $1 AND a.commit_sha = $2 AND a.status = 'succeeded' AND r.review IS NOT NULL LIMIT 1`,
    [repoKey, commit],
  );
  return rows.rows.length > 0;
}

/** 이 분석에서 review 를 돌릴지: 스위치가 켜져 있고 같은 커밋의 저장된 review 가 없을 때만. */
export async function wantsReview(db: Queryable, deps: Pick<PumpDeps, "review">, owner: string, repo: string, commit: string): Promise<boolean> {
  if (!deps.review) return false;
  return !(await storedReviewExists(db, `${owner.toLowerCase()}/${repo.toLowerCase()}`, commit));
}

/** 실행 자리를 쓰는 분석(실행기에 보냈거나 분석 중)의 조건. 자리를 셀 때와 대기열을 읽을 때 같은 것을 쓴다. */
const IN_USE = "(status = 'running' OR (status = 'queued' AND dispatched_at IS NOT NULL))";
/** 대기열(아직 실행기에 보내지 않음). */
const WAITING = "(status = 'queued' AND dispatched_at IS NULL)";

/** 실행 자리를 고르고 표시하는 일을 하나씩 하게 하는 권고 잠금의 번호. */
const QUEUE_LOCK = 31_000_003;

export function timeoutReason(minutes: number, step: StepName): string {
  return `시간 초과: 실행기에 보낸 뒤 ${minutes}분 안에 끝나지 않아 멈춘 것으로 적었습니다. ‘${STEP_LABEL[step]}’ 단계에 머물러 있었습니다.`;
}

export function dispatchTimeoutReason(minutes: number): string {
  return `실행기에 보낸 뒤 ${minutes}분 안에 실행기가 시작을 알리지 않아 멈춘 것으로 적었습니다. 실행기가 이 분석을 받지 못했을 수 있습니다. 다시 요청할 수 있습니다.`;
}

/** 대기 시간 초과를 적을 때 센 사실. 까닭에는 이것만 적는다. */
export interface QueueFacts {
  poolSize: number;
  inUse: number;
  /** 실행기를 깨우지 못한 마지막 까닭(`runner_wake`). 없으면 null. */
  wakeFailure: string | null;
  runner: RunnerKind;
}

export function queueTimeoutReason(minutes: number, facts: QueueFacts): string {
  const head = `대기열에서 ${minutes}분 넘게 기다려 멈춘 것으로 적었습니다.`;
  const tail = "다시 요청할 수 있습니다.";
  if (facts.runner === "none") return `${head} 이 사이트는 지금 실행기를 깨우지 않는 설정이라 대기열을 넘기지 않았습니다. ${tail}`;
  if (facts.wakeFailure && facts.inUse < facts.poolSize) {
    return `${head} 실행기를 깨우지 못해 보내지 못했습니다. 마지막으로 깨우지 못한 까닭: ${facts.wakeFailure} ${tail}`;
  }
  return `${head} 멈춘 것으로 적을 때 실행 자리 ${facts.poolSize}개 중 ${facts.inUse}개가 쓰이고 있었습니다. ${tail}`;
}

/**
 * 실행기에 보낸 뒤 시간을 넘긴 분석(시작을 알리지 않음, 끝나지 않음)을 실패로 적고, 적은 수를 돌려준다. 대기열의 분석은 보지
 * 않는다(`expireWaiting`). 다른 요청이 그새 바꿨으면(끝났거나 시작했으면) 건드리지 않는다. 멈춘 때는 모르므로 단계의 끝난 시각을
 * 적지 않는다(화면이 멈춘 시각을 꾸미지 않게). 트랜잭션 안에서도 부른다(콜백, 요청).
 */
export async function sweepStale(db: Queryable, now: Date, limits: QueueLimits): Promise<number> {
  const before = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const dispatchCutoff = before(limits.dispatchTimeoutMinutes);
  const runCutoff = before(limits.runTimeoutMinutes);
  const stale = await db.query<Pick<Row, "id" | "steps" | "status"> & { sent_at: Date | string }>(
    `SELECT id, steps, status, COALESCE(dispatched_at, requested_at) AS sent_at
     FROM analyses
     WHERE (status = 'queued' AND dispatched_at IS NOT NULL AND dispatched_at < $1)
        OR (${IN_USE} AND COALESCE(dispatched_at, requested_at) < $2)`,
    [dispatchCutoff, runCutoff],
  );
  let changed = 0;
  for (const row of stale.rows) {
    let step: StepName;
    let reason: string;
    let guard: string;
    if (row.status === "queued" && new Date(row.sent_at).getTime() < dispatchCutoff.getTime()) {
      step = "queued";
      reason = dispatchTimeoutReason(limits.dispatchTimeoutMinutes);
      guard = "(status = 'queued' AND dispatched_at IS NOT NULL)";
    } else {
      step = stalledStep(readSteps(row.steps));
      reason = timeoutReason(limits.runTimeoutMinutes, step);
      guard = `${IN_USE}`;
    }
    const updated = await db.query(
      `UPDATE analyses SET status = 'failed', failure_step = $2, failure_reason = $3, finished_at = $4
       WHERE id = $1 AND ${guard} RETURNING id`,
      [row.id, step, reason, now],
    );
    changed += updated.rows.length;
  }
  return changed;
}

/** 실행기를 깨우지 못한 마지막 때와 까닭. 없으면 null. */
async function readWakeFailure(db: Queryable): Promise<{ at: Date; reason: string } | null> {
  const rows = await db.query<{ failed_at: Date | string; reason: string }>("SELECT failed_at, reason FROM runner_wake WHERE id = 1");
  const row = rows.rows[0];
  return row ? { at: new Date(row.failed_at), reason: row.reason } : null;
}

/**
 * 대기열에서 `QUEUE_TIMEOUT_MINUTES` 를 넘게 기다린 분석을 까닭과 함께 실패로 적는다. 넘기기(`pumpQueue`)를 해 본 뒤에 부른다.
 * 자리가 비어 있고 깨우기도 쉬고 있지 않으면(그러면 다음 넘기기가 보낼 수 있다) 적지 않는다. 까닭에는 지금 센 사실만 적는다.
 */
export async function expireWaiting(db: Queryable, now: Date, limits: QueueLimits, runner: RunnerKind): Promise<number> {
  const cutoff = new Date(now.getTime() - limits.queueTimeoutMinutes * 60_000);
  const old = await db.query<{ id: string }>(`SELECT id FROM analyses WHERE ${WAITING} AND requested_at < $1`, [cutoff]);
  if (old.rows.length === 0) return 0;
  const inUse = (await counts(db)).rows[0]?.in_use ?? 0;
  const failure = await readWakeFailure(db);
  const blocked = runner === "none" || inUse >= limits.poolSize || failure !== null;
  if (!blocked) return 0;
  const reason = queueTimeoutReason(limits.queueTimeoutMinutes, {
    poolSize: limits.poolSize,
    inUse,
    wakeFailure: failure?.reason ?? null,
    runner,
  });
  const updated = await db.query(
    `UPDATE analyses SET status = 'failed', failure_step = 'queued', failure_reason = $2, finished_at = $3
     WHERE id = ANY($1::text[]) AND ${WAITING} RETURNING id`,
    [old.rows.map((row) => row.id), reason, now],
  );
  return updated.rows.length;
}

/** 지금의 대기열과 실행 자리(DB 에서 센 것). */
export async function readQueue(db: Queryable, poolSize: number, now: Date): Promise<QueueSnapshot> {
  const rows = await db.query<{ id: string; status: string; dispatched: boolean }>(
    `SELECT id, status, dispatched_at IS NOT NULL AS dispatched FROM analyses
     WHERE status IN ('queued', 'running') ORDER BY requested_at, id`,
  );
  const waiting: string[] = [];
  const dispatched: string[] = [];
  let inUse = 0;
  for (const row of rows.rows) {
    if (row.status === "running" || row.dispatched) inUse += 1;
    if (row.status === "queued") (row.dispatched ? dispatched : waiting).push(row.id);
  }
  const failure = await readWakeFailure(db);
  return {
    countedAt: now.toISOString(),
    poolSize,
    inUse,
    waiting,
    dispatched,
    wakeFailure: failure ? { at: failure.at.toISOString(), reason: failure.reason } : null,
  };
}

export interface PumpOutcome {
  /** 실행기에 보낸 분석. */
  dispatched: string[];
  /** 실행기를 깨우지 못해 대기열에 되돌린 분석. */
  returned: string[];
  /** 앞서 깨우지 못한 뒤 쉬는 중이라 깨우지 않았으면 true. */
  resting: boolean;
}

const counts = (db: Queryable) =>
  db.query<{ in_use: number; waiting: number }>(
    `SELECT count(*) FILTER (WHERE ${IN_USE})::int AS in_use, count(*) FILTER (WHERE ${WAITING})::int AS waiting
     FROM analyses WHERE status IN ('queued', 'running')`,
  );

/** 깨우기를 쉬는 중인지(마지막으로 깨우지 못한 때가 `WAKE_RETRY_MINUTES` 안). */
async function resting(db: Queryable, now: Date): Promise<boolean> {
  const rows = await db.query("SELECT 1 FROM runner_wake WHERE id = 1 AND failed_at > $1", [
    new Date(now.getTime() - WAKE_RETRY_MINUTES * 60_000),
  ]);
  return rows.rows.length > 0;
}

/**
 * 실행 자리가 비어 있는 만큼 대기열의 앞에서부터 실행기를 깨운다. 서버 인스턴스 여럿이 동시에 불러도 한 분석은 한 번만
 * 보내고, 자리 수를 넘겨 보내지 않는다(위 설명).
 */
export async function pumpQueue(db: Database, deps: PumpDeps): Promise<PumpOutcome> {
  const outcome: PumpOutcome = { dispatched: [], returned: [], resting: false };
  if (deps.runner === "none") return outcome;
  // 자리를 하나씩 채운다. 한 번 돌 때마다 자리가 하나 차므로 자리 수보다 많이 돌지 않는다.
  for (let round = 0; round < deps.limits.poolSize; round += 1) {
    // 잠금 없이 먼저 센다. 할 일이 없으면(대부분의 읽기) 잠금을 잡지 않는다.
    const quick = (await counts(db)).rows[0];
    if (!quick || quick.waiting === 0 || quick.in_use >= deps.limits.poolSize) break;
    if (await resting(db, deps.now())) {
      outcome.resting = true;
      break;
    }
    const picked = await db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock($1)", [QUEUE_LOCK]);
      const now = (await counts(tx)).rows[0];
      if (!now || now.waiting === 0 || now.in_use >= deps.limits.poolSize) return null;
      if (await resting(tx, deps.now())) return "resting" as const;
      const rows = await tx.query<{ id: string; owner: string; repo: string; commit_sha: string; dispatched_at: Date | string }>(
        `UPDATE analyses SET dispatched_at = $1
         WHERE id = (
           SELECT id FROM analyses WHERE ${WAITING}
           ORDER BY requested_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
         ) AND ${WAITING}
         RETURNING id, owner, repo, commit_sha, dispatched_at`,
        [deps.now()],
      );
      return rows.rows[0] ?? null;
    });
    if (picked === "resting") {
      outcome.resting = true;
      break;
    }
    if (!picked) break;
    let woke: WakeOutcome;
    try {
      woke = await deps.wake({
        analysisId: picked.id,
        owner: picked.owner,
        repo: picked.repo,
        commit: picked.commit_sha,
        callbackBase: deps.callbackBase,
        review: await wantsReview(db, deps, picked.owner, picked.repo, picked.commit_sha),
      });
    } catch {
      woke = { ok: false, reason: "실행기를 깨우다 알 수 없는 오류가 나서 분석을 시작하지 못했습니다." };
    }
    if (woke.ok) {
      outcome.dispatched.push(picked.id);
      await db.query("DELETE FROM runner_wake WHERE id = 1");
      continue;
    }
    // 깨우지 못했으면 실행기에 간 것이 아니다. 분석을 실패로 적지 않고 대기열의 제자리(요청한 차례)에 되돌린다. 그새 다른 일이
    // 그 행을 바꿨으면(실행기가 시작을 알림 등) 건드리지 않는다. 깨우지 못한 때와 까닭을 적어 두고, 쉬는 동안 깨우지 않는다.
    // 응답이 늦어 실패로 본 깨우기가 실제로는 실행을 만들었으면, 그 실행이 알리는 단계는 대기열의 분석이라 409 를 받고 멈춘다.
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE analyses SET dispatched_at = NULL WHERE id = $1 AND status = 'queued' AND dispatched_at = $2",
        [picked.id, picked.dispatched_at],
      );
      await tx.query(
        `INSERT INTO runner_wake (id, failed_at, reason) VALUES (1, $1, $2)
         ON CONFLICT (id) DO UPDATE SET failed_at = EXCLUDED.failed_at, reason = EXCLUDED.reason`,
        [deps.now(), woke.reason],
      );
    });
    outcome.returned.push(picked.id);
    break;
  }
  return outcome;
}

/** 깨우기를 부르는 쪽(쪽 읽기, 콜백)이 깨우기의 오류로 멈추지 않게 한다. 오류는 이름만 적는다(메시지에 주소가 실릴 수 있다). */
export async function pumpQuietly(db: Database, deps: PumpDeps, where: string): Promise<PumpOutcome | null> {
  try {
    return await pumpQueue(db, deps);
  } catch (error) {
    console.error(`[queue] ${where}: 대기열을 넘기지 못함 (${error instanceof Error ? error.name : "오류"})`);
    return null;
  }
}

/**
 * 깨우는 때마다 하는 일: 실행 시간 초과·보냄 시간 초과를 정리하고(자리가 빈다), 빈 자리만큼 대기열을 넘긴 뒤, 그래도 보내지
 * 못한 오래된 대기열의 분석을 대기 시간 초과로 적는다. 이 차례라서, 아무도 깨우지 않는 동안 자리가 비어 있었던 대기열의 분석은
 * 실패하지 않고 이번에 보내진다. 넘기다 오류가 나면(DB) 대기 시간 초과는 적지 않는다(다음 깨우는 때 다시 본다).
 */
export async function tidyQueue(db: Database, deps: PumpDeps, where: string): Promise<PumpOutcome | null> {
  await sweepStale(db, deps.now(), deps.limits);
  const pumped = await pumpQuietly(db, deps, where);
  if (pumped) await expireWaiting(db, deps.now(), deps.limits, deps.runner);
  return pumped;
}
