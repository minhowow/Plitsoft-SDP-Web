import type { Finding } from "./types";

/**
 * 판정이 본 범위. CLI 가 발견마다 낸 `scope`, `region`, `top_level` 을 그대로 옮긴 것이다. 줄 번호(`line`)는 이 범위
 * 안에서 조문이 닿는다고 본 첫 줄일 뿐이고, 그 줄이 문제의 줄이라는 뜻이 아니다.
 *
 * - 파일 단위 규칙(`scope: file`)은 늘 파일 전체다.
 * - 함수 단위 규칙(`scope: anchor`)은 셋으로 갈린다(CLI README 의 "함수 단위 판정", `report/outcome.py` 의 Finding):
 *   감싸는 함수가 있으면 그 함수(`region`), 함수 안팎에 섞여 있을 때의 함수 밖 줄(`top_level: true`),
 *   감싸는 함수가 없으면 파일 전체(`region: null`, `top_level: false`).
 * - 함수 단위인데 `region` 도 `top_level` 도 없는 결과는 어느 쪽인지 알 수 없다. 짐작하지 않는다. SARIF 에서 옮긴
 *   결과가 그렇다. SARIF 에는 `top_level` 이 없고 구역도 일부에만 실린다(`sarif.ts`).
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

/**
 * 줄 번호를 아는 정도. 줄이 있거나(`known`), 없거나(`none`), SARIF 에서 옮긴 1행이라 조문이 닿는다고 본 줄인지 알 수
 * 없다(`unsure`. `view-model.ts` 의 `LocationView.lineUnsure`).
 */
export type LineKnown = "known" | "none" | "unsure";

/**
 * SARIF 가 줄이 없는 발견을 어떻게 싣는지. 발견을 펼친 안쪽의 설명(아래 `UNSURE_LINE`)과 조문별 검사 기록의 발견 표 위
 * (`record.ts`)가 함께 쓴다.
 */
export const SARIF_LINE_ONE = "SARIF 는 줄이 없는 발견도 1행으로 싣습니다.";

/** SARIF 에서 옮긴 결과의 1행에 적는 말. "줄 번호는 조문이 닿는다고 본 첫 줄"이라고 적을 수 없는 자리에 대신 온다. */
const UNSURE_LINE = `${SARIF_LINE_ONE} 이 1행이 조문이 닿는다고 본 줄인지는 알 수 없습니다.`;

/**
 * 설명을 적는 자리. 같은 설명이라도 곁에 있는 것이 달라서, 가리키는 말이 자리마다 다르다.
 *
 * - `finding`: 발견을 펼친 안쪽. 정책 카드 안이라 바로 위에 조문 이름이 있고, 바로 아래에 판정 경로가 있다.
 * - `code`: 데모의 코드 상자에서 칠한 줄 아래. 곁에 조문 이름이 없고, 한 줄에 조문이 다른 발견이 함께 실릴 수 있다
 *   (`genai-chat` 의 1행은 제31조 제1항과 제2항의 발견이 함께 실린 줄이다). 판정 경로는 쪽 아래의 결과 안에 있다.
 */
export type NotePlace = "finding" | "code";

/**
 * 줄 번호가 무엇인지 적는 문장. 곁에 조문 이름이 없는 자리에서 쓴다: 데모의 코드 상자(아래 `FIRST_LINE`)와 조문별 검사
 * 기록의 발견 표 위(`record.ts`). "이 조문"이 가리킬 조문이 없으므로 그 말을 뺀 것이다.
 */
export const LINE_IS_FIRST = "줄 번호는 조문이 닿는다고 본 첫 줄입니다.";

/** 줄 번호가 무엇인지 적는 문장. 코드 상자에는 "이 조문"이 가리킬 조문이 없으므로 그 말을 뺀다. */
const FIRST_LINE: Record<NotePlace, string> = {
  finding: "줄 번호는 이 조문이 닿는다고 본 첫 줄입니다.",
  code: LINE_IS_FIRST,
};

/** 판정 경로를 가리키는 문장. */
const SEE_PATH: Record<NotePlace, string> = {
  finding: "아래 판정 경로의 문장을 보세요.",
  code: "아래 결과에서 그 발견의 판정 경로를 보세요.",
};

/**
 * 판정이 본 범위를 적는 설명. 발견을 펼친 안쪽의 첫 줄에 적고, 데모의 코드 상자에서는 칠한 줄 아래에 적는다(`place`).
 * 줄 번호가 없는 발견에는 줄 번호 이야기를 하지 않는다.
 *
 * 구역을 알 수 없는 함수 단위 판정(`unknown`)에는 "알 수 없다"고 잘라 적지 않는다. CLI 는 함수 단위 규칙의 판정 경로
 * 첫 문장 끝에 구역을 글로 적는다(" [구역 12~34행]", " [구역 함수 밖]", " [구역 파일 전체]". CLI 소스
 * `evaluate/engine.py`). 그 문장은 바로 아래에 그대로 보이므로, 위에서 알 수 없다고 하면 서로 어긋나 보인다. 웹은 그
 * 문장을 해석해 구역을 만들지 않는다. 구역이 필드로는 실려 있지 않다고 적고 그 문장을 가리키기만 한다. 판정 경로가
 * 실려 있지 않으면(`hasPath` 가 거짓) 가리킬 곳이 없으므로 가리키지 않는다.
 */
export function scopeNote(scope: JudgedScope, line: LineKnown, hasPath: boolean, place: NotePlace = "finding"): string {
  switch (scope.kind) {
    case "file":
      if (line === "known") return `파일 전체를 보고 내린 판정입니다. ${FIRST_LINE[place]}`;
      return line === "unsure" ? `파일 전체를 보고 내린 판정입니다. ${UNSURE_LINE}` : "파일 전체를 보고 내린 판정입니다.";
    case "function":
      return `함수 단위로 내린 판정입니다. 판정 구역은 ${scope.startLine}~${scope.endLine}행입니다.`;
    case "top-level":
      return "함수 밖(모듈 최상위)의 줄을 보고 내린 판정입니다.";
    case "unknown": {
      const note = hasPath
        ? `함수 단위 규칙의 판정입니다. 판정 구역은 결과에 따로 실려 있지 않습니다. ${SEE_PATH[place]}`
        : "함수 단위 규칙의 판정입니다. 판정 구역은 결과에 실려 있지 않습니다.";
      return line === "unsure" ? `${note} ${UNSURE_LINE}` : note;
    }
  }
}
