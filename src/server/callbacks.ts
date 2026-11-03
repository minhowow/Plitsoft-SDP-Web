import "server-only";
import { parseReportText } from "@/lib/report/parse";
import { repoKey } from "@/lib/service/href";
import { isAnalysisId } from "@/lib/service/id";
import { isRepoFullName } from "@/lib/service/names";
import { STEP_ORDER } from "@/lib/service/steps";
import type { AnalysisStep, StepName } from "@/lib/service/types";
import type { Database, Queryable } from "./db";
import { sweepStale, tidyQueue, type PumpDeps, type QueueLimits } from "./queue";
import { COLUMNS, readSteps, rowToAnalysis, type Row } from "./store/rows";

/**
 * 실행기 콜백이 분석 행을 바꾸는 규칙(설계 6). route handler(`src/app/api/runner/`)는 서명을 본 뒤 이것만 부른다.
 *
 * 받는 것(본문 JSON). 모두 `"target": { "owner", "repo", "commit" }`(실행기가 검사하는 저장소·커밋)을 함께 싣는다. 서명한 본문
 * 안에 있으므로, 이것이 분석 행의 저장소(대소문자 가리지 않음)·커밋과 다르면 409 로 받지 않는다(워크플로를 다른 저장소로 부른
 * 실행의 결과를 이 분석에 붙이지 못하게).
 *
 * - `{ "event": "step", "step": "fetch" | "scan" | "finish", "run"?: { "id", "url" } }`: 그 단계를 시작했다.
 * - `{ "event": "result", "output": "<CLI 가 낸 JSON 글 그대로>" }`: 정리 단계에서 결과를 보낸다.
 * - `{ "event": "fail", "step": …, "reason": "…" }`: 그 단계에서 멈췄다.
 *
 * 상태 전이만 허용한다.
 * - 끝난(succeeded·failed) 분석은 다시 바꾸지 못한다(409). 시간을 넘긴 분석은 먼저 '시간 초과'로 끝낸 뒤 본다.
 * - 아직 실행기에 보내지 않은(대기열에 있는) 분석의 알림은 받지 않는다(409). 실행기는 보낸 분석만 안다.
 * - 한 분석에는 실행 하나만 붙인다. 이미 다른 실행(run id)을 적었으면 다른 실행의 단계 알림은 받지 않는다(409).
 * - 단계는 차례대로 하나씩 간다(대기 → 저장소 받기·도구 설치 → 검사 → 정리). 지금 단계를 다시 알리면 바꾸지 않고 받는다(같은
 *   콜백을 다시 보낸 것). 건너뛰거나 뒤로 가면 409.
 * - 결과는 정리 단계에서만 받는다. CLI 의 결과로 읽히면 끝남(도구·팩 판을 결과에서 적는다), 읽히지 않으면 받은 글을 그대로 두고
 *   실패('결과를 읽지 못함')로 적는다.
 * - 실패는 지금 단계나 그다음 단계(시작을 알리기 전에 멈춤)에서만 받는다.
 *
 * 시각은 이 서버가 콜백을 받은 때다(실행기가 보낸 시각을 믿지 않는다).
 */

/** 실행기가 검사하는 저장소·커밋. 모든 콜백에 싣는다(서명한 본문 안). 분석 행의 것과 다르면 받지 않는다. */
export interface RunnerTarget {
  owner: string;
  repo: string;
  commit: string;
}

export type RunnerEvent = { target: RunnerTarget } & (
  | { event: "step"; step: Exclude<StepName, "queued">; run: { id: string; url: string } | null }
  | { event: "result"; output: string }
  | { event: "fail"; step: Exclude<StepName, "queued">; reason: string }
);

export interface EventOutcome {
  status: 200 | 400 | 404 | 409;
  body: { ok: boolean; message: string; status?: string; unchanged?: boolean };
}

const RUNNER_STEPS = STEP_ORDER.filter((name): name is Exclude<StepName, "queued"> => name !== "queued");
/** 실패 까닭의 길이 상한(글자). 넘는 것은 자른다. */
export const MAX_REASON_LENGTH = 500;
const RUN_ID = /^\d{1,20}$/;
const RUN_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/actions\/runs\/\d{1,20}$/;
/** 판 문자열(도구 판, 팩 지문)로 받는 모양. 그 밖이면 판을 적지 않는다. */
const VERSION = /^[A-Za-z0-9._+-]{1,64}$/;

const SHA = /^[0-9a-f]{40}$/;

function readTarget(raw: unknown): RunnerTarget | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { owner, repo, commit } = raw as Record<string, unknown>;
  if (typeof owner !== "string" || typeof repo !== "string" || typeof commit !== "string") return null;
  if (!isRepoFullName(owner, repo) || !SHA.test(commit)) return null;
  return { owner, repo, commit };
}

/** 본문을 읽는다. 모양이 맞지 않으면 null(400). */
export function readEvent(data: unknown): RunnerEvent | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  const target = readTarget(value.target);
  if (!target) return null;
  const step = RUNNER_STEPS.find((name) => name === value.step);
  if (value.event === "step" && step) {
    const run = value.run as Record<string, unknown> | undefined | null;
    if (run === undefined || run === null) return { event: "step", step, run: null, target };
    if (typeof run !== "object" || typeof run.id !== "string" || typeof run.url !== "string") return null;
    if (!RUN_ID.test(run.id) || !RUN_URL.test(run.url)) return null;
    return { event: "step", step, run: { id: run.id, url: run.url }, target };
  }
  if (value.event === "result" && typeof value.output === "string") return { event: "result", output: value.output, target };
  if (value.event === "fail" && step && typeof value.reason === "string") {
    // 제어 문자를 빼고, 길면 자른다. 화면에 그대로 적는 글이다.
    const reason = value.reason.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, MAX_REASON_LENGTH);
    if (!reason) return null;
    return { event: "fail", step, reason, target };
  }
  return null;
}

const refuse = (status: EventOutcome["status"], message: string): EventOutcome => ({ status, body: { ok: false, message } });

/** 지금 단계: 시작한 단계 가운데 마지막(대기 단계는 요청한 때 시작했다). */
function currentIndex(steps: AnalysisStep[]): number {
  let index = 0;
  steps.forEach((step, i) => {
    if (step.startedAt) index = i;
  });
  return index;
}

export async function applyRunnerEvent(
  db: Database,
  id: string,
  event: RunnerEvent,
  options: { now: Date; limits: QueueLimits },
): Promise<EventOutcome> {
  if (!isAnalysisId(id)) return refuse(404, "그런 분석이 없습니다.");
  const at = options.now.toISOString();
  return db.transaction(async (tx: Queryable): Promise<EventOutcome> => {
    await sweepStale(tx, options.now, options.limits);
    const found = await tx.query<Row & { dispatched: boolean; runner_run_id: string | null }>(
      `SELECT ${COLUMNS}, dispatched_at IS NOT NULL AS dispatched, runner_run_id FROM analyses WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = found.rows[0];
    if (!row) return refuse(404, "그런 분석이 없습니다.");
    const analysis = rowToAnalysis(row);
    if (analysis.status === "succeeded" || analysis.status === "failed") {
      return refuse(409, "이미 끝난 분석이라 바꾸지 않습니다.");
    }
    if (analysis.status === "queued" && !row.dispatched) {
      return refuse(409, "아직 실행기에 보내지 않은(대기열에 있는) 분석이라 받지 않습니다.");
    }
    if (repoKey(event.target.owner, event.target.repo) !== repoKey(row.owner, row.repo) || event.target.commit !== row.commit_sha) {
      return refuse(409, "이 분석의 저장소·커밋이 아닌 실행의 알림이라 받지 않습니다.");
    }
    const steps = readSteps(row.steps);
    const current = currentIndex(steps);
    const write = (patch: string, params: unknown[]) =>
      tx.query(`UPDATE analyses SET steps = $2::jsonb${patch} WHERE id = $1`, [id, JSON.stringify(steps), ...params]);

    if (event.event === "step") {
      // 한 분석에는 실행 하나만 붙인다. 깨우기의 응답이 늦어 대기열에 되돌린 뒤 다시 보낸 경우처럼 실행이 둘 생기면, 먼저 알린
      // 실행만 받는다(실행 자리를 넘겨 둘이 돌지 않게).
      if (event.run && row.runner_run_id && row.runner_run_id !== event.run.id) {
        return refuse(409, "이 분석에는 다른 실행이 이미 붙어 있어 받지 않습니다.");
      }
      const target = STEP_ORDER.indexOf(event.step);
      if (target === current && !steps[current].endedAt) {
        return { status: 200, body: { ok: true, message: "이미 알린 단계입니다.", status: analysis.status, unchanged: true } };
      }
      if (target !== current + 1) return refuse(409, "단계의 차례가 맞지 않습니다.");
      if (!steps[current].endedAt) steps[current].endedAt = at;
      steps[target].startedAt = at;
      const run = event.run;
      await write(", status = 'running'" + (run ? ", runner_run_id = $3, runner_run_url = $4" : ""), run ? [run.id, run.url] : []);
      return { status: 200, body: { ok: true, message: "단계를 적었습니다.", status: "running" } };
    }

    if (event.event === "fail") {
      const target = STEP_ORDER.indexOf(event.step);
      if (target !== current && target !== current + 1) return refuse(409, "단계의 차례가 맞지 않습니다.");
      // 멈춘 때는 이 콜백을 받은 때다. 그 앞 단계가 언제 끝났는지는 모르므로 적지 않는다.
      steps[target].endedAt = at;
      await write(", status = 'failed', failure_step = $3, failure_reason = $4, finished_at = $5", [
        event.step,
        event.reason,
        options.now,
      ]);
      return { status: 200, body: { ok: true, message: "실패를 적었습니다.", status: "failed" } };
    }

    // 결과
    if (STEP_ORDER[current] !== "finish") return refuse(409, "결과는 정리 단계에서만 받습니다.");
    steps[current].endedAt = at;
    await tx.query("INSERT INTO results (analysis_id, json) VALUES ($1, $2)", [id, event.output]);
    const parsed = parseReportText(event.output);
    if (!parsed.ok) {
      const why = parsed.errors[0] ?? "";
      const reason = `결과를 읽지 못함: 실행기가 보낸 결과가 CLI 의 결과 JSON 으로 읽히지 않았습니다.${why ? ` (${why})` : ""}`.slice(
        0,
        MAX_REASON_LENGTH,
      );
      await write(", status = 'failed', failure_step = 'finish', failure_reason = $3, finished_at = $4", [reason, options.now]);
      return { status: 200, body: { ok: true, message: "결과를 읽지 못해 실패로 적었습니다.", status: "failed" } };
    }
    const tool = parsed.report.tool.version;
    const pack = parsed.report.run.pack_digest;
    // 발견 수는 쪽이 목록에 쓴다. 결과를 받을 때 한 번 세어 둔다(쪽이 결과 전체를 다시 읽지 않게).
    await write(", status = 'succeeded', finished_at = $3, tool_version = $4, pack_digest = $5, finding_count = $6", [
      options.now,
      VERSION.test(tool) ? tool : null,
      VERSION.test(pack) ? pack : null,
      parsed.report.findings.length,
    ]);
    return { status: 200, body: { ok: true, message: "결과를 적었습니다.", status: "succeeded" } };
  });
}

/**
 * 로컬 실행기(RUNNER=local)가 분석 하나를 집어 간다. 먼저 대기열을 넘기고(`pumpQueue`. 로컬의 깨우기는 아무것도 하지 않으므로
 * 실행 자리를 얻은 분석에 '보냄' 표시만 남는다), 그다음 보냈고 아직 아무도 집지 않은 분석을 보낸 차례로 하나 집는다
 * (`runner_run_id` 에 'local' 을 적는다). 그래서 로컬 실행기도 실행 자리 수(POOL_SIZE)를 넘겨 돌리지 않는다. 둘이 동시에 집어도
 * 한 분석은 한 실행기에만 간다.
 */
export async function claimQueued(
  db: Database,
  deps: PumpDeps,
): Promise<{ id: string; owner: string; repo: string; commit: string } | null> {
  await tidyQueue(db, deps, "집어 가기");
  return db.transaction(async (tx) => {
    const rows = await tx.query<{ id: string; owner: string; repo: string; commit_sha: string }>(
      `UPDATE analyses SET runner_run_id = 'local'
       WHERE id = (
         SELECT id FROM analyses WHERE status = 'queued' AND dispatched_at IS NOT NULL AND runner_run_id IS NULL
         ORDER BY dispatched_at, requested_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
       ) AND runner_run_id IS NULL
       RETURNING id, owner, repo, commit_sha`,
    );
    const row = rows.rows[0];
    return row ? { id: row.id, owner: row.owner, repo: row.repo, commit: row.commit_sha } : null;
  });
}
