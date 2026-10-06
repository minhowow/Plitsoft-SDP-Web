/**
 * policypack CLI 결과 JSON 의 타입. contract/schema/ 의 두 스키마와 짝이다.
 * 필드를 더하거나 뺄 때는 스키마와 tests/contract.test.ts 를 함께 고친다.
 */

/** CLI 가 발견으로 내는 판정. 충족·해당 없음은 발견으로 나오지 않는다. */
export type Outcome = "needs-review" | "needs-review-uncertain";

export interface UnsatisfiedAlternative {
  id: string;
  message: string | null;
  ask_developer: string | null;
  remediation: string | null;
  value: string;
}

export interface Finding {
  policy: string;
  rule: string;
  outcome: Outcome;
  file: string;
  line: number | null;
  title: string;
  /** 대표 조문. 예: "개인정보 보호법 제22조의2 제1항" */
  law: string;
  ask_developer: string;
  /** 판정을 끝까지 하지 못한 이유. no-judge, weak-unconfirmed 등. */
  untested_reasons: string[];
  /** AI 에게 물어야 했는데 판정에 넣을 답이 없는 조건 id. */
  ai_pending: string[];
  fingerprint: string;
  scope: "file" | "anchor";
  /** 함수 단위 규칙(scope: anchor)의 판정 구역. 감싸는 가장 바깥 함수의 줄 범위다. */
  region: { start_line: number; end_line: number } | null;
  /**
   * 함수 단위 규칙에서 판정 구역이 함수 밖(모듈 최상위)의 줄인지. 그때 region 은 null 이다.
   * region 이 null 이고 이 값이 false 면 파일 전체를 본 판정이다. CLI 0.3 은 늘 싣지만, 없는 결과도 읽는다.
   */
  top_level?: boolean;
  unsatisfied_alternatives: UnsatisfiedAlternative[];
  /** 사람이 읽는 판정 경로. 문장을 해석해서 쓰지 않는다. 그대로 보여 주기만 한다. */
  decision_path: string[];
  category?: string;
  anchor_lines?: number[];
}

/**
 * AI 의 '예'로 풀린 경고. 판정자를 켠 결과에만 있다.
 * cite 는 AI 가 인용한 코드 줄이다. 코드이므로 2층(호스팅)에서는 저장하지 않는다(docs/commitments.md).
 */
export interface AiCleared {
  policy: string;
  rule: string;
  file: string;
  line?: number | null;
  alternatives: { id: string; cite?: string | null; gate?: string }[];
}

/** 적용 질문에 AI 가 '아니오'라고 답해 빠진 판정. 판정자를 켠 결과에만 있다. */
export interface AiDismissed {
  policy: string;
  rule: string;
  file: string;
  line?: number | null;
  question?: string;
  answer?: string;
}

/** v1 초안에만 있다. 정책마다 한 줄. */
export interface PolicySummary {
  policy: string;
  units: number;
  needs_review: number;
  uncertain: number;
  compliant: number;
  evidence: { file: string; line: number | null; rule: string; alternative: string }[];
}

export interface Run {
  judge: string | null;
  pack_digest: string;
  ai_pending: number;
  ai_cleared?: AiCleared[];
  ai_dismissed?: AiDismissed[];
  engine: { name: string; version: string | null } | null;
  units: number;
  files?: number;
  unparsed: string[];
  skipped: string[];
  incomplete: string[];
  engine_errors: unknown[];
  coverage_complete: boolean;
  /** v1 초안 */
  policies?: PolicySummary[];
  commit?: string | null;
  remote?: string | null;
}

export interface Report {
  /** v1 초안부터 있다. 없으면 CLI 0.3 의 판 번호 없는 출력이다. */
  schema_version?: string;
  tool: { name: string; version: string };
  run: Run;
  findings: Finding[];
}

/** 어느 계약으로 읽었는지. */
export type Contract = "cli-0.3" | "v1-draft";
