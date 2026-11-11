import raw from "@data/cases.json";
import type { Status } from "@/lib/report/status";

/**
 * 사례 쪽(/cases)의 데이터. CLI 세션이 미리 돌린 공개 저장소 결과에서 쪽이 쓰는 필드만 옮긴 것이다
 * (`node scripts/export-cases.mjs`, 2026-11-10·11 오너 결정). 서비스의 분석 결과와 따로 둔다: 이 결과는 AI 가 여러 파일을 읽는
 * 방식(`--agent`)으로 만든 것이고, 그 필드(`run.agent`)는 서비스의 결과 계약에 없다. 읽기만 하고 다시 돌리지 않는다.
 */

/** AI 가 댄 근거 줄. 인용 검사를 통과한 것만 옮겼다. */
export interface CaseCitation {
  file: string;
  line: number;
  text: string;
}

/** 규칙만 돌린 결과의 발견과, 그 발견을 AI 가 검토한 기록(남김 kept · 풂 cleared · 확정 confirmed). */
export interface RuleOnlyFinding {
  policy: string;
  rule: string;
  file: string;
  line: number;
  outcome: string;
  review: { action: string; citations: CaseCitation[] } | null;
}

/** AI 를 켠 결과의 발견. 규칙이 `agent-discovered` 면 AI 가 새로 찾은 것이다. */
export interface FinalFinding {
  policy: string;
  rule: string;
  title: string;
  law: string;
  file: string;
  line: number;
  outcome: string;
  action: string | null;
  citations: CaseCitation[];
}

export interface CaseData {
  slug: string;
  owner: string;
  name: string;
  htmlUrl: string;
  commit: string;
  files: number;
  /** 찾는 모델과 재확인 모델(결과에 실린 그대로, 예 `agent:anthropic:claude-haiku-5-5`). */
  finder: string;
  rechecker: string;
  ruleOnly: RuleOnlyFinding[];
  final: FinalFinding[];
}

export interface CasesFile {
  ranOn: string;
  cli: { commit: string; version: string };
  packDigest: string;
  cases: CaseData[];
}

export const casesFile = raw as CasesFile;

export function casesHref(slug?: string): string {
  return slug ? `/cases/${slug}/` : "/cases/";
}

export function findCase(slug: string): CaseData | undefined {
  return casesFile.cases.find((c) => c.slug === slug);
}

/** 결과에 실린 모델 이름(`agent:anthropic:<모델>`)의 끝, 모델 id. */
export function modelId(judge: string): string {
  return judge.slice(judge.lastIndexOf(":") + 1);
}

export function caseStatus(outcome: string): Status {
  return outcome === "needs-review-uncertain" ? "uncertain" : "needs-review";
}

const same = (a: { policy: string; rule: string; file: string; line: number }, b: typeof a) =>
  a.policy === b.policy && a.rule === b.rule && a.file === b.file && a.line === b.line;

/** 규칙만 본 발견 가운데 AI 를 켠 결과에 남지 않은 것(AI 가 푼 것). */
export function clearedByAi(c: CaseData): RuleOnlyFinding[] {
  return c.ruleOnly.filter((r) => !c.final.some((f) => same(r, f)));
}

/** AI 를 켠 결과의 발견 가운데 규칙만 본 결과에 없던 것(AI 가 새로 찾은 것). */
export function isNewByAi(c: CaseData, finding: FinalFinding): boolean {
  return !c.ruleOnly.some((r) => same(r, finding));
}

/** 결과의 발견에 나온 정책(처음 나온 차례). */
export function casePolicies(c: CaseData): string[] {
  return [...new Set(c.final.map((f) => f.policy))];
}
