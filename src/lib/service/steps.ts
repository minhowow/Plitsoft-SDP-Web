import type { Analysis, AnalysisStatus, AnalysisStep, StepName } from "./types";

/**
 * 단계의 차례. 대기 → 저장소 받기·도구 설치 → 검사 → 정리. 끝나면 분석의 상태가 succeeded 다.
 *
 * 정적 검사와 AI 판정은 한 단계(`scan`)다. 실행기는 CLI 명령 하나(`policypack scan … --judge anthropic:…`)를 부르고, CLI 는
 * 정적 검사가 끝나고 AI 판정이 시작한 때를 알려 주지 않는다(결과에는 걸린 초만 있다). 알 수 없는 경계를 꾸며 두 단계로 적지
 * 않는다. AI 판정자가 무엇이었는지는 끝난 분석의 결과(`run.judge`)가 말한다.
 */
export const STEP_ORDER: StepName[] = ["queued", "fetch", "scan", "finish"];

export const STEP_LABEL: Record<StepName, string> = {
  queued: "대기",
  fetch: "저장소 받기·도구 설치",
  scan: "검사(정적 검사와 AI 판정)",
  finish: "정리",
};

/** 분석의 상태 이름. 결과의 판정 문구(`lib/report/status.ts`)와 다른 것이다. 분석이 어디까지 갔는지만 말한다. */
export const ANALYSIS_STATUS_LABEL: Record<AnalysisStatus, string> = {
  queued: "대기 중",
  running: "분석 중",
  succeeded: "끝남",
  failed: "실패",
};

/** 화면에서 단계 하나의 형편. */
export type StepState = "done" | "active" | "failed" | "waiting" | "notrun";

export const STEP_STATE_LABEL: Record<StepState, string> = {
  done: "끝남",
  active: "진행 중",
  failed: "멈춤",
  waiting: "기다림",
  notrun: "하지 않음",
};

/**
 * 화면에 적는 단계의 형편. 대기 중인 분석의 '대기' 단계는 "진행 중"이 아니라 머리의 상태와 같은 "대기 중"이라고 적는다
 * (형편은 여전히 active 다. 지금 머문 단계라서 aria-current 로 알린다).
 */
export function stepStateLabel(analysis: Analysis, step: AnalysisStep): string {
  const state = stepState(analysis, step);
  if (state === "active" && step.name === "queued") return ANALYSIS_STATUS_LABEL.queued;
  return STEP_STATE_LABEL[state];
}

export function stepState(analysis: Analysis, step: AnalysisStep): StepState {
  if (analysis.failure?.step === step.name) return "failed";
  if (step.endedAt) return "done";
  if (step.startedAt && analysis.status === "failed") {
    // 멈춘 단계보다 앞 단계는 끝났다(실행기가 다음 단계로 갔다). 끝난 시각을 모르면 시각만 비운다(멈춤으로 적지 않는다).
    const failedAt = analysis.failure ? STEP_ORDER.indexOf(analysis.failure.step) : -1;
    return STEP_ORDER.indexOf(step.name) < failedAt ? "done" : "failed";
  }
  if (step.startedAt) return "active";
  // 실패한 분석에서 시작하지 않은 단계는 앞으로도 하지 않는다. "기다림"이라고 적으면 아직 돌 것처럼 읽힌다.
  return analysis.status === "failed" ? "notrun" : "waiting";
}

/** 지금 진행 중인 단계. 대기 중이거나 분석 중일 때만 있다. */
export function activeStep(analysis: Analysis): AnalysisStep | null {
  if (analysis.status !== "queued" && analysis.status !== "running") return null;
  return analysis.steps.find((step) => stepState(analysis, step) === "active") ?? null;
}

/**
 * 분석이 끝난 시각(마지막으로 끝난 단계). 끝나지 않았으면 null. 실패한 단계에 끝난 시각이 없으면(실행기가 끝을 알리지 못함)
 * 언제 멈췄는지 모르므로 null 이다(시작한 시각을 멈춘 시각으로 적지 않는다).
 */
export function finishedAt(analysis: Analysis): string | null {
  if (analysis.status !== "succeeded" && analysis.status !== "failed") return null;
  if (analysis.status === "failed") {
    const failed = analysis.steps.find((step) => step.name === analysis.failure?.step);
    if (!failed?.endedAt) return null;
  }
  const ends = analysis.steps.map((step) => step.endedAt ?? step.startedAt).filter((at): at is string => at !== null);
  return ends.length > 0 ? ends.sort().at(-1)! : null;
}

/** 두 시각 사이를 "4분 12초"처럼 적는다. */
export function duration(from: string, to: string): string {
  return secondsText((Date.parse(to) - Date.parse(from)) / 1000);
}

/** 초를 "4분 12초"처럼 적는다(초는 반올림). */
export function secondsText(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}초`;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

/**
 * 시각을 한국 표준시로 "2026-10-24 14:03"처럼 적는다. 빌드하는 컴퓨터와 보는 사람의 시간대에 기대지 않게 손으로 9시간을
 * 더한다. "몇 분 전"처럼 지금과 견주어 적지 않는다(쪽을 연 뒤에도 글이 그대로 맞게).
 */
export function formatKst(iso: string): string {
  const at = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}
