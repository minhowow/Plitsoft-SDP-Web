import "server-only";
import { STEP_ORDER } from "@/lib/service/steps";
import type { Analysis, AnalysisStatus, AnalysisStep, ReviewPlan, StepName } from "@/lib/service/types";

/** 분석 행을 화면의 모델(`Analysis`)로 옮기는 것. 저장소 구현(`db.ts`), 대기열(`../queue.ts`), 콜백이 함께 쓴다. */

export interface Row {
  id: string;
  owner: string;
  repo: string;
  commit_sha: string;
  branch: string;
  status: AnalysisStatus;
  failure_step: StepName | null;
  failure_reason: string | null;
  requested_at: Date | string;
  steps: AnalysisStep[] | string;
  tool_version: string | null;
  pack_digest: string | null;
  review_plan: ReviewPlan | null;
}

export const COLUMNS =
  "id, owner, repo, commit_sha, branch, status, failure_step, failure_reason, requested_at, steps, tool_version, pack_digest, review_plan";

export const iso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

/** DB 의 단계 JSON 을 STEP_ORDER 의 차례로 모두 있게 읽는다. 없는 단계는 시작하지 않은 것으로 둔다. */
export function readSteps(raw: Row["steps"]): AnalysisStep[] {
  const list = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<AnalysisStep>[];
  return STEP_ORDER.map((name) => {
    const found = Array.isArray(list) ? list.find((step) => step?.name === name) : undefined;
    return {
      name,
      startedAt: typeof found?.startedAt === "string" ? found.startedAt : null,
      endedAt: typeof found?.endedAt === "string" ? found.endedAt : null,
    };
  });
}

export function rowToAnalysis(row: Row): Analysis {
  return {
    id: row.id,
    owner: row.owner,
    name: row.repo,
    commit: row.commit_sha,
    branch: row.branch,
    requestedAt: iso(row.requested_at),
    status: row.status,
    steps: readSteps(row.steps),
    failure:
      row.status === "failed" && row.failure_step && row.failure_reason
        ? { step: row.failure_step, reason: row.failure_reason }
        : null,
    versions: row.tool_version && row.pack_digest ? { tool: row.tool_version, pack: row.pack_digest } : null,
    review: row.review_plan ?? undefined,
  };
}

/** 새 분석의 단계: 대기 단계가 요청한 때 시작했다. */
export function initialSteps(requestedAt: string): AnalysisStep[] {
  return STEP_ORDER.map((name) => ({ name, startedAt: name === "queued" ? requestedAt : null, endedAt: null }));
}

/** 끝나지 않은 분석이 머문 단계: 시작했고 끝나지 않은 단계, 없으면 시작하지 않은 첫 단계(단계 사이), 그것도 없으면 정리. */
export function stalledStep(steps: AnalysisStep[]): StepName {
  const open = steps.find((step) => step.startedAt && !step.endedAt);
  if (open) return open.name;
  const next = steps.find((step) => !step.startedAt && !step.endedAt);
  return next?.name ?? "finish";
}
