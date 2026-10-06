import type { Finding } from "./types";

/**
 * 판정이 본 범위. CLI 가 발견마다 낸 `scope`, `region`, `top_level` 을 그대로 옮긴 것이다. 줄 번호(`line`)는 이 범위
 * 안에서 조문이 닿는다고 본 첫 줄일 뿐이고, 그 줄이 문제의 줄이라는 뜻이 아니다.
 *
 * - 파일 단위 규칙(`scope: file`)은 늘 파일 전체다.
 * - 함수 단위 규칙(`scope: anchor`)은 셋으로 갈린다(CLI README 의 "함수 단위 판정", `report/outcome.py` 의 Finding):
 *   감싸는 함수가 있으면 그 함수(`region`), 함수 안팎에 섞여 있을 때의 함수 밖 줄(`top_level: true`),
 *   감싸는 함수가 없으면 파일 전체(`region: null`, `top_level: false`).
 * - 함수 단위인데 `region` 도 `top_level` 도 없는 결과는 어느 쪽인지 알 수 없다. 짐작하지 않는다.
 */
export type JudgedScope =
  | { kind: "file" }
  | { kind: "function"; startLine: number; endLine: number }
  | { kind: "top-level" }
  | { kind: "unknown" };

export function judgedScope(finding: Pick<Finding, "scope" | "region" | "top_level">): JudgedScope {
  if (finding.scope === "file") return { kind: "file" };
  if (finding.region) {
    return { kind: "function", startLine: finding.region.start_line, endLine: finding.region.end_line };
  }
  if (finding.top_level === true) return { kind: "top-level" };
  if (finding.top_level === false) return { kind: "file" };
  return { kind: "unknown" };
}

/** 발견 줄에서 줄 번호 옆에 늘 보이는 짧은 이름. 발견을 펼치지 않아도 줄 번호가 무엇을 가리키는지 알 수 있게 한다. */
export function scopeLabel(scope: JudgedScope): string {
  switch (scope.kind) {
    case "file":
      return "파일 전체 판정";
    case "function":
      return `함수 ${scope.startLine}~${scope.endLine}행 판정`;
    case "top-level":
      return "함수 밖 판정";
    case "unknown":
      return "판정 구역 알 수 없음";
  }
}

/** 발견을 펼친 안쪽에 적는 설명. 줄 번호가 없는 발견에는 줄 번호 이야기를 하지 않는다. */
export function scopeNote(scope: JudgedScope, hasLine: boolean): string {
  switch (scope.kind) {
    case "file":
      return hasLine
        ? "파일 전체를 보고 내린 판정입니다. 줄 번호는 이 조문이 닿는다고 본 첫 줄입니다."
        : "파일 전체를 보고 내린 판정입니다.";
    case "function":
      return `함수 단위로 내린 판정입니다. 판정 구역은 ${scope.startLine}~${scope.endLine}행입니다.`;
    case "top-level":
      return "함수 밖(모듈 최상위)의 줄을 보고 내린 판정입니다.";
    case "unknown":
      return "함수 단위 규칙의 판정입니다. 판정 구역은 결과에 실려 있지 않아 알 수 없습니다.";
  }
}
