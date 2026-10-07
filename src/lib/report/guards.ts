import type { Outcome, UnsatisfiedAlternative } from "./types";

/**
 * 값의 모양을 보는 작은 함수들. 결과 JSON 의 파서(`parse.ts`)와 SARIF 의 파서(`sarif.ts`)가 함께 쓴다.
 * 발견·대안·AI 기록은 두 출력에서 모양이 같다. 두 파서가 같은 기준으로 받아들이게 한곳에 둔다.
 */
export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export const isStr = (v: unknown): v is string => typeof v === "string";
export const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
export const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
export const isNullOr = <T>(v: unknown, check: (x: unknown) => x is T): v is T | null => v === null || check(v);

const OUTCOMES = new Set(["needs-review", "needs-review-uncertain"]);

/** 발견의 판정(`outcome`). CLI 는 이 둘만 발견으로 낸다. */
export const isOutcome = (v: unknown): v is Outcome => isStr(v) && OUTCOMES.has(v);

/** 판정 단위(`scope`). 파일 단위이거나 함수 단위다. */
export const isScope = (v: unknown): v is "file" | "anchor" => v === "file" || v === "anchor";

/** 확인되지 않은 대안의 목록(JSON 의 `unsatisfied_alternatives`, SARIF 의 `unsatisfiedAlternatives`). */
export const isUnsatisfiedAlternatives = (v: unknown): v is UnsatisfiedAlternative[] =>
  Array.isArray(v) &&
  v.every(
    (a) =>
      isObj(a) &&
      isStr(a.id) &&
      isNullOr(a.message, isStr) &&
      isNullOr(a.ask_developer, isStr) &&
      isNullOr(a.remediation, isStr) &&
      isStr(a.value),
  );

/** AI 가 푼 경고와 적용 질문으로 빠진 판정의 기록 목록. 화면에 쓰는 필드만 본다. */
export const isAiRecords = (v: unknown): v is Obj[] =>
  Array.isArray(v) && v.every((x) => isObj(x) && isStr(x.policy) && isStr(x.rule) && isStr(x.file));

/** AI 가 푼 경고의 기록마다 대안 목록이 있고, 대안마다 id 가 있는지. */
export const haveAlternativeIds = (records: unknown[]): boolean =>
  records.every(
    (x) => isObj(x) && Array.isArray(x.alternatives) && x.alternatives.every((a) => isObj(a) && isStr(a.id)),
  );
