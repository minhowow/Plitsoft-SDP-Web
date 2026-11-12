import raw from "@data/cases.json";
import type { ReviewStatus } from "@/lib/review";
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
  /** 저장소 프로필(`policypack profile` 의 JSON 그대로. 의무 항목은 화면이 쓰는 필드만). 읽는 것은 `lib/profile` 이 한다. */
  profile: unknown;
  /** review 2판의 실측 결과(화면이 읽는 필드만). 읽는 것은 `lib/review` 가 한다. */
  review: unknown;
  /** review 결과 가운데 사람이 답을 읽고 말이 안 된다고 짚은 의무(상태를 보이지 않고 "다시 검토 중"으로 접는다). */
  recheck: string[];
}

/** 성격이 다른 저장소 한 곳의 review 결과(이름·주소·코드 없이 갈래별 건수·시간·비용만). */
export interface OtherRepo {
  /** 오너가 정한 성격 이름(쇼핑몰, 위치, …). */
  kind: string;
  /** 갈래별 건수(다시 검토 중인 것은 뺐다). */
  counts: Record<ReviewStatus, number>;
  recheck: number;
  seconds: number;
  /** 공식 단가로 다시 센 금액(결과의 사용량 × 단가, scripts/export-cases.mjs). */
  usd: number;
}

export interface CasesFile {
  ranOn: string;
  cli: { commit: string; version: string };
  packDigest: string;
  /** 프로필을 돌린 CLI 커밋과 날(검토 결과와 다른 판이다). */
  profileCli: { commit: string; ranOn: string };
  /** 사례 4곳의 review 2판을 돌린 날과 CLI 커밋. */
  reviewRun: { ranOn: string; cli: string };
  /** 성격이 다른 저장소 8곳의 review 2판을 돌린 날과 CLI 커밋(사례 4곳보다 앞선 판). */
  othersRun: { ranOn: string; cli: string };
  cases: CaseData[];
  others: OtherRepo[];
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
