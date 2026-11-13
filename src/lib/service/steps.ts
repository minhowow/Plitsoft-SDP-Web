import type { Analysis, AnalysisStatus, AnalysisStep, StepName } from "./types";

/**
 * 단계의 차례. 대기 → 저장소 받기·도구 설치 → 검사 → 정리. 끝나면 분석의 상태가 succeeded 다.
 *
 * 정적 검사와 AI 판정은 한 단계(`scan`)다. 실행기는 CLI 명령 하나(`policypack scan … --judge anthropic:…`)를 부르고, CLI 는
 * 정적 검사가 끝나고 AI 판정이 시작한 때를 알려 주지 않는다(결과에는 걸린 초만 있다). 알 수 없는 경계를 꾸며 두 단계로 적지
 * 않는다. AI 판정자가 무엇이었는지는 끝난 분석의 결과(`run.judge`)가 말한다.
 *
 * 검사 단계 안에서 실행기가 명령 사이마다 알리는 차례(정적 검사·AI 판정 → 기능 파악 → 켰을 때 AI 검토)는 `scanParts` 가 단계 아래에
 * 적는다(2026-11-13 오너 지시). AI 검토 안의 단계(의무 고르기·의무별 조사·반박)는 CLI 가 알리지 않아 형편 없이 이름만 적는다.
 */
export const STEP_ORDER: StepName[] = ["queued", "fetch", "scan", "finish"];

export const STEP_LABEL: Record<StepName, string> = {
  queued: "대기",
  fetch: "저장소 받기·도구 설치",
  scan: "검사",
  finish: "정리",
};

/** 검사 단계 안의 일. `judge` 는 검사 단계가 시작한 때부터다. `review` 는 그 분석에서 review 를 돌릴 때(`review` 가 run)만 있다. */
export type ScanPartName = "judge" | "profile" | "review";

export const SCAN_PART_LABEL: Record<ScanPartName, string> = {
  judge: "정적 검사·AI 판정",
  profile: "기능 파악",
  review: "AI 검토",
};

/** AI 검토 안의 단계. CLI 가 어디까지 갔는지 알리지 않아 차례만 적는다. */
export const REVIEW_INNER = "의무 고르기 → 의무별 조사 → 반박";
export const REVIEW_INNER_NOTE = "이 안의 차례는 알 수 없음";

/** review 를 돌리지 않는 분석의 AI 검토 줄에 적는 까닭. */
const REVIEW_SKIPPED: Partial<Record<NonNullable<Analysis["review"]>, string>> = {
  stored: "같은 커밋의 저장된 결과를 씀",
  limit: "오늘 한도가 차서 하지 않음",
};

export interface ScanPartRow {
  name: ScanPartName;
  state: StepState;
  /** 시작한 때. 정적 검사·AI 판정은 검사 단계가 시작한 때, 나머지는 실행기의 알림을 받은 때. 모르면 null. */
  startedAt: string | null;
  /** 형편 대신 적는 말(review 를 돌리지 않는 까닭). */
  skipped?: string;
}

/**
 * 검사 단계 안의 차례와 형편. 실행기는 명령을 시작할 때마다 알리고(`Analysis.scanPart`, 마지막 것만 남는다), 알림은 빠질 수 있다.
 * 받은 알림보다 앞의 일은 끝났고, 받은 일이 지금이다(검사 단계가 진행 중일 때). 검사 단계가 끝났으면 모두 끝났다. 멈춘 분석은
 * 지금이던 일에서 멈췄다. review 를 돌리지 않는 분석(저장된 결과, 하루 한도)은 그 까닭을 적은 줄을 둔다. review 스위치가 꺼져 있던
 * 분석(`review` 없음)에는 AI 검토 줄이 없다.
 */
export function scanParts(analysis: Analysis): ScanPartRow[] {
  const scan = analysis.steps.find((step) => step.name === "scan");
  if (!scan) return [];
  const scanState = stepState(analysis, scan);
  const order: ScanPartName[] = ["judge", "profile", ...(analysis.review === "run" ? (["review"] as const) : [])];
  const part = scanState === "active" || scanState === "failed" ? (analysis.scanPart?.name ?? "judge") : null;
  const at = part ? order.indexOf(part) : -1;
  const rows: ScanPartRow[] = order.map((name, i) => {
    let state: StepState = scanState;
    if (scanState === "active") state = i < at ? "done" : i === at ? "active" : "waiting";
    if (scanState === "failed") state = i < at ? "done" : i === at ? "failed" : "notrun";
    const startedAt = name === "judge" ? scan.startedAt : analysis.scanPart?.name === name ? analysis.scanPart.startedAt : null;
    return { name, state, startedAt };
  });
  const skipped = analysis.review ? REVIEW_SKIPPED[analysis.review] : undefined;
  if (skipped) rows.push({ name: "review", state: "notrun", startedAt: null, skipped });
  return rows;
}

/** 지금 하는 일의 이름: 검사 단계면 그 안의 일(정적 검사·AI 판정, 기능 파악, AI 검토), 그 밖에는 단계 이름. 진행 중이 아니면 null. */
export function activeLabel(analysis: Analysis): string | null {
  const step = activeStep(analysis);
  if (!step) return null;
  if (step.name !== "scan") return STEP_LABEL[step.name];
  const part = scanParts(analysis).find((row) => row.state === "active");
  return part ? SCAN_PART_LABEL[part.name] : STEP_LABEL.scan;
}

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
