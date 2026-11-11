import type { PackIndex } from "@/lib/pack/types";
import { judgedScope, type JudgedScope } from "./scope";
import { findingStatus, STATUS_ORDER, worst, type Status } from "./status";
import { isNonServiceRole, serviceFindingCount, type AiCleared, type AiDismissed, type Contract, type Finding, type PolicySummary, type Report, type StaticCleared } from "./types";

/**
 * 발견 하나. 단위는 정책 × 규칙 × 파일이다(함수 단위 규칙이면 함수).
 * 같은 파일·같은 줄에 규칙이 다른 발견이 둘 있을 수 있다. 서로 다른 의무다.
 */
export interface LocationView {
  file: string;
  /** 파일 단위 규칙에서는 적용 조건이 처음 맞은 줄이다. 판정 대상은 파일 전체다. */
  line: number | null;
  /**
   * 줄 번호가 조문이 닿는다고 본 줄인지 알 수 없는 발견. SARIF 는 줄이 없는 발견도 1행으로 싣는다(CLI 소스
   * `report/sarif.py` 의 `_result`). 그래서 SARIF 에서 옮긴 결과의 1행은 실제 1행일 수도, 줄이 없는 발견일 수도 있다.
   * 판정 구역이 함께 실린 발견은 줄이 있는 발견이다(CLI 는 줄이 그 구역 안에 있을 때만 구역을 싣는다).
   */
  lineUnsure: boolean;
  /** 판정이 본 범위. 발견 줄에서는 줄 번호 옆에 늘 함께 보인다(줄 번호는 문제의 줄이 아니다). */
  scope: JudgedScope;
  rule: string;
  /**
   * 이 규칙이 이 사이트의 팩(data/pack-meta.json)에 있는지. 있으면 화면이 규칙 id 를 조문 도감의 그 정책 쪽으로 잇고, 없으면
   * (다른 판의 팩, 손으로 만든 파일) 글로만 적는다.
   */
  ruleInPack: boolean;
  status: Status;
  fingerprint: string;
  finding: Finding;
  /**
   * 서비스 코드가 아닌 파일(시험·예시·설정)의 발견인지. CLI 가 발견마다 실은 파일 역할(`finding.role`)로만 가른다. 역할이
   * 실려 있지 않으면 거짓이다(경로 이름으로 짐작하지 않는다).
   */
  nonService: boolean;
}

/** 같은 규칙이 여러 곳에 반복될 때 먼저 보이는 대표 위치의 수. 나머지는 접는다. */
export const SHOWN_PER_RULE = 3;

/** 화면에 적는 출력 형식의 이름. 결과 머리의 "출력 형식"과 빈 결과 화면의 한계 문구가 같은 이름을 쓴다. */
export const CONTRACT_LABEL: Record<Contract, string> = { "cli-0.3": "CLI 0.3", "v1-draft": "v1 초안", sarif: "SARIF" };

/**
 * 같은 규칙의 발견 묶음. 접는 단위다. 규칙이 다르면 서로 다른 의무이므로, 다른 규칙의 발견을 접어 가리지 않는다.
 */
export interface RuleGroupView {
  rule: string;
  /** 이 묶음에서 가장 먼저 봐야 할 상태. */
  status: Status;
  /**
   * 먼저 보이는 대표 위치. CLI 가 대표 위치를 주지 않으므로(docs/cli-requests.md 의 R6) 웹이 고른다.
   * 먼저 봐야 할 상태, 파일, 줄 순서로 앞에서 SHOWN_PER_RULE 곳이다.
   */
  shown: LocationView[];
  /** 접어 두는 나머지. 같은 규칙이 SHOWN_PER_RULE 곳보다 많이 반복될 때만 생긴다. */
  folded: LocationView[];
  /** 상태별 개수(접힌 곳 포함). 접힌 곳에만 있는 상태도 묶음 머리에서 보이게 한다. 점수가 아니다. */
  counts: { status: Status; count: number }[];
}

export interface PolicyView {
  id: string;
  title: string;
  law: string;
  status: Status;
  /**
   * 이 정책의 "사람이 볼 곳": 서비스 코드의 발견 전부. 파일, 줄, 규칙 순서다. 시험·예시·설정 파일의 발견은 `aside` 에 따로 둔다
   * (2026-11-11 오너 지시). 정책의 상태도 이것으로 정한다.
   */
  locations: LocationView[];
  /** 같은 발견을 규칙별로 묶은 것. */
  rules: RuleGroupView[];
  /**
   * 체크리스트의 두 묶음(2026-11-11 오너 지시): 확인할 것(검토 필요·AI 확인 전)과 코드로는 알 수 없음(판단 보류)의 발견을
   * 저마다 규칙별로 묶은 것. 화면은 이 묶음으로 그린다. 셋째 묶음(지킨 근거 있음)은 `evidence` 와 `cleared` 다.
   */
  checks: RuleGroupView[];
  unknowns: RuleGroupView[];
  /** 서비스 코드가 아닌 파일(시험·예시·설정)의 발견. 파일, 줄, 규칙 순서다. "사람이 볼 곳"에 세지 않는다. */
  aside: LocationView[];
  /** 이 정책의 AI 가 푼 경고의 줄(`ReportView.cleared` 가운데 이 정책의 것). 체크리스트의 "지킨 근거 있음"에 든다. */
  cleared: ReviewItem[];
  /**
   * 충족 근거 위치. v1 초안에서는 정책별 요약의 것이다. CLI 결과 판 1 에서는 강한 정적 대안으로 풀린 단위
   * (`run.static_cleared`)를 옮긴 것이다: 대안이 맞은 줄마다 한 줄(줄이 실려 있지 않으면 줄 없이 한 줄), 규칙과 대안 id 는
   * 실린 그대로다. 판 번호 없는 출력과 SARIF 에는 그 자리가 없어 비어 있다.
   */
  evidence: PolicySummary["evidence"];
  /**
   * 이 정책의 판정 단위 수. 결과에 정책별 요약이 있을 때(v1 초안)만 안다. 없으면 null 이다.
   * CLI 0.3 의 전체 수(`run.units`)에서 짐작해 채우지 않는다.
   */
  units: number | null;
  /** AI 의 '예'로 풀린 경고 수. 0 보다 크면 "나누어 적지 않는다"는 설명 대신 이 사실을 보인다. */
  aiCleared: number;
  /** 팩 메타데이터에 이 정책이 있는지. 없으면 조문 도감으로 이어 줄 수 없다. */
  inPack: boolean;
}

/**
 * 결과에 실린 대로 옮긴 것이다. 세 목록의 뜻과 화면에 적는 말은 `coverage.ts` 에 있다.
 * 한 파일이 두 목록에 함께 실릴 수 있다(일부를 읽지 못했고 엔진도 끝내지 못한 파일). 세 수를 더하지 않는다.
 */
export interface CoverageView {
  /** 검사한 파일 수. 결과에 없으면 null 이다(SARIF 에는 실리지 않는다). */
  files: number | null;
  /** 판정 단위 수. SARIF 에는 실리지 않는다. 그때만 null 이다. 0 과 다르다. */
  units: number | null;
  /** 검사하지 않은 파일. 결과에 없다. */
  skipped: string[];
  /** 일부를 파싱하지 못한 파일. 구문 조건이 '모름'이 되어 판단 보류로 남았을 수 있다. 결과에는 있다. */
  unparsed: string[];
  /** 엔진이 조건을 끝내지 못한 파일. 끝나지 않은 조건은 판단 보류로 남았을 수 있다. 결과에는 있다. */
  incomplete: string[];
  /** 어느 파일인지 엔진이 밝히지 않은 오류의 수. */
  engineErrors: number;
  /**
   * 그 오류마다 결과에 실린 문장. 엔진의 문장 그대로가 아니라, CLI 가 오류 종류를 앞에 붙이고 앞 200자까지만 실은
   * 글이다(`coverage.ts` 의 `GapRow.texts`). 문자열로 실린 것만 옮긴다. 실린 그대로 보여 주기만 한다.
   */
  engineErrorTexts: string[];
  /** 결과의 `coverage_complete`. 목록이 비어 있지 않은데 참인 결과도 읽으므로, 화면은 목록도 함께 본다. */
  complete: boolean;
}

export interface ReportView {
  contract: Contract;
  tool: string;
  engine: string | null;
  judge: string | null;
  packDigest: string;
  /**
   * 검사한 커밋. 결과에 커밋 해시의 모양으로 실려 있을 때만 있다(`COMMIT_HASH`). CLI 0.3 의 JSON 과 SARIF 에는 없어서 늘
   * null 이다(`docs/cli-requests.md` 의 R7). v1 초안의 스키마에는 `run.commit` 이 있다. 조문별 검사 기록이 쓴다
   * (`record.ts`). 검사한 날은 어느 출력에도 없다.
   */
  commit: string | null;
  /** 결과를 만든 팩과 이 사이트에 실린 팩 메타데이터의 판이 같은지. 메타데이터가 없으면 null. */
  packMatches: boolean | null;
  coverage: CoverageView;
  policies: PolicyView[];
  /**
   * 검사에 쓰인 정책의 수. 결과에는 정책 목록이 없으므로(CLI 0.3) 두 가지 길로만 안다.
   * 결과에 정책별 요약이 있으면(v1 초안) 그 수이고, 없으면 결과와 팩 판이 같은 이 사이트의 팩에 실린 정책의 수다.
   * 팩 판이 다르거나 팩 메타데이터가 없으면 알 수 없다(null).
   *
   * v1 초안에서는 정책별 수(`PolicyView.units`)가 적힌 카드의 수와 같다. 요약에 없는데 발견이나 AI 가 푼 경고에만
   * 나온 정책이 있으면 카드(`policies`)가 이 수보다 많다.
   */
  policyCount: number | null;
  /**
   * "사람이 볼 곳"의 수: 서비스 코드의 발견 수(검토 필요 + AI 확인 전 + 판단 보류). 시험·예시·설정 파일의 발견은 빼고
   * `asideCount` 로 따로 센다. 점수가 아니다.
   */
  findingCount: number;
  /** 서비스 코드가 아닌 파일(시험·예시·설정)의 발견 수. 결과에 파일 역할이 실려 있을 때만 0 보다 클 수 있다. */
  asideCount: number;
  /** AI 가 푼 경고와 적용 질문으로 빠진 판정. 숨기지 않는다. 사람이 인용한 줄을 확인해야 한다. */
  aiCleared: AiCleared[];
  /**
   * 강한 정적 대안으로 풀린 단위(CLI 결과 판 1 의 `run.static_cleared`). 정책 카드에서는 충족 근거 위치로 보인다.
   * v1 초안에서는 쓰지 않는다(정책별 요약이 그 자리다). 결과에 그 목록이 없으면 null 이다. 빈 목록과 다르다.
   */
  staticCleared: StaticCleared[] | null;
  aiDismissed: AiDismissed[];
  /**
   * 적용 질문으로 빠진 판정이 `aiDismissed` 에 실린 것뿐이라는 것을 아는지. 판정자가 꺼져 있었으면 AI 에게 묻지
   * 않으므로 빠진 판정이 없다. 켜져 있었으면 결과에 `run.ai_dismissed` 가 실려 있어야 안다(CLI 0.3 은 늘 싣는다.
   * 없는 결과도 읽으므로, 그때는 `aiDismissed` 가 비어 있어도 빠진 판정이 없었다고 하지 않는다).
   */
  aiDismissedKnown: boolean;
  /**
   * 검사 정보의 AI 줄. 이름표와 값의 목록이다(화면은 줄마다 하나씩 그린다). 지금은 결과의 `run.judge` 를 CLI 가 낸 글 그대로
   * 옮긴 한 줄이고, 판정자가 꺼져 있었으면 "꺼짐"이다. AI 검토를 한 무엇이 결과에 더 실리면 이 목록에 줄을 더한다.
   */
  aiRows: InfoRow[];
  /**
   * AI 가 푼 경고의 줄(화면의 "AI 가 푼 경고" 상자). 어디서 온 기록인지와 상관없는 모양이다(`ReviewItem`). 지금은
   * `run.ai_cleared` 를 옮긴 것이다.
   */
  cleared: ReviewItem[];
  /** AI 가 적용되지 않는다고 답해 빠진 판정의 줄. 지금은 `run.ai_dismissed` 를 옮긴 것이다. */
  dismissed: ReviewItem[];
}

/** 이름표와 값 한 쌍(검사 정보의 한 줄). 값은 결과에 실린 글 그대로다. */
export interface InfoRow {
  label: string;
  value: string;
}

/**
 * 인용한 줄 하나: 파일, 줄(모르면 null), 글. 글은 결과에 실린 그대로다(여러 줄일 수 있다). 줄 번호가 실려 있지 않으면 짐작해
 * 채우지 않는다(AI 가 인용한 글에는 줄 번호가 없다. 판정 단위의 줄을 인용한 줄로 옮기지 않는다).
 */
export interface QuotedLine {
  file: string;
  line: number | null;
  text: string;
  /**
   * 이 인용이 받치는 대안의 id(풀린 경고). 사람이 "그 줄이 그 대안의 근거가 맞는지" 확인하려면 어느 대안의 인용인지 알아야
   * 한다(CLI 는 대안마다 인용 하나를 싣는다). 대안과 이어지지 않은 인용이면 null.
   */
  alternative: string | null;
}

/**
 * AI 의 답으로 풀리거나 빠진 판정 하나. 화면의 상자가 받는 모양이다. 어떤 기록에서 왔는지(지금은 `run.ai_cleared`,
 * `run.ai_dismissed`)를 상자는 모른다.
 */
export interface ReviewItem {
  policy: string;
  /** 정책의 제목(발견이나 팩에서). 모르면 정책 id. */
  title: string;
  rule: string;
  ruleInPack: boolean;
  file: string;
  line: number | null;
  /** 풀린 대안의 id(실린 차례). 빠진 판정에는 없다. */
  alternatives: string[];
  /** 인용한 줄. 대안마다 하나이고 그 대안의 id 를 지닌다(`QuotedLine.alternative`). 없으면 빈 목록이다. */
  quotes: QuotedLine[];
  /** 인용이 없는 대안의 id(풀린 경고). "인용 없음"으로 적는다. */
  uncited: string[];
  /** 빠진 판정: 묻는 말과 답(결과에 실린 그대로). */
  question: string | null;
  answer: string | null;
}

/**
 * 이 결과에서 AI 검토(판정자)가 돌았는지. "판정자를 켜 보라"는 권고(`/view`·데모), 요약 줄의 AI 수, 저장소 쪽 최신 분석의 AI 수가
 * 이 함수로 가른다. 적용 질문으로 빠진 판정이 결과에 다 실렸는지(`aiDismissedKnown`. 조문별 검사 기록, 빈 결과의 `검사한 것`,
 * 요약 줄이 쓴다)도 `buildReportView` 에서 이 함수로 셈한다. 지금은 결과의 `run.judge` 가 있는지다.
 */
export function aiReviewRan(view: Pick<ReportView, "judge">): boolean {
  return view.judge !== null;
}

/**
 * 커밋 해시의 모양: 16진수 7~64자(git 이 줄여 적는 해시부터 SHA-256 까지). `run.commit` 은 파서가 모양을 보지 않는 글이고
 * 조문별 검사 기록에 글자 그대로 실린다. 기록에는 코드를 싣지 않으므로, 해시가 아닌 글(손으로 고친 파일에는 무엇이든 들 수
 * 있다)은 커밋으로 치지 않는다.
 */
const COMMIT_HASH = /^[0-9a-f]{7,64}$/i;

const byUrgency = (a: Status, b: Status) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b);

/** 체크리스트의 "확인할 것"에 드는 발견의 상태. 나머지(판단 보류)는 "코드로는 알 수 없음"이다. */
const CHECK_STATUSES: Status[] = ["needs-review", "needs-review-ai-pending"];

/**
 * 글자 코드 순서(UTF-16 코드 단위). 대문자가 소문자보다 앞이다. 어느 컴퓨터, 어느 브라우저에서나 같다.
 *
 * 보는 사람의 언어 설정을 따르는 비교(localeCompare, Intl.Collator)는 쓰지 않는다. 그 순서는 언어마다 다르다
 * (체코어는 "ch" 를 "h" 뒤의 한 글자로 치고, 한국어는 한글을 로마자 앞에 둔다). 파일 순서가 달라지면 같은 결과
 * 파일인데도 먼저 보이는 대표 위치가 사람마다 달라진다.
 */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const byPlace = (a: LocationView, b: LocationView) =>
  byCodeUnit(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || byCodeUnit(a.rule, b.rule);

/**
 * 한 정책의 발견을 규칙별로 묶는다. 발견은 결과에 나온 순서로 받는다.
 * 묶음은 먼저 봐야 할 상태가 앞에 오고, 같은 상태 안에서는 결과에 처음 나온 순서다(CLI 는 팩의 규칙 순서로 낸다).
 */
function groupByRule(found: LocationView[]): RuleGroupView[] {
  const byRule = new Map<string, LocationView[]>();
  for (const location of found) {
    const list = byRule.get(location.rule) ?? [];
    list.push(location);
    byRule.set(location.rule, list);
  }

  return [...byRule.entries()]
    .map(([rule, list]) => {
      const sorted = [...list].sort((a, b) => byUrgency(a.status, b.status) || byPlace(a, b));
      return {
        rule,
        status: sorted[0].status,
        shown: sorted.slice(0, SHOWN_PER_RULE),
        folded: sorted.slice(SHOWN_PER_RULE),
        counts: STATUS_ORDER.map((status) => ({
          status,
          count: sorted.filter((l) => l.status === status).length,
        })).filter((c) => c.count > 0),
      };
    })
    .sort((a, b) => byUrgency(a.status, b.status));
}

/**
 * 결과 JSON 을 화면용 구조로 바꾼다. 같은 정책의 발견은 정책 하나 아래로 묶고, 그 안에서 규칙별로 다시 묶는다.
 * 팩 메타데이터를 주면 발견이 없는 정책도 함께 보여 준다(CLI 0.3 결과에서. v1 초안은 결과에 나온 정책만 보여 준다).
 *
 * SARIF 에서 옮긴 결과(`sarif.ts`)도 같은 길로 간다. 정책별 요약이 없는 것은 CLI 0.3 의 JSON 과 같으므로 발견과 정책
 * 카드는 같게 만들어지고, SARIF 에 없는 것(판정 단위 수, 검사한 파일 수, 일부 판정 구역)만 "알 수 없음"으로 남는다.
 */
/** 팩의 정책 하나가 지닌 규칙 id. 브라우저로 넘기는 팩 정보(`ruleIds`)와 팩 메타데이터 전체(`rules[].id`)를 함께 받는다. */
function ruleIdsOf(policy: PackIndex["policies"][number]): Set<string> {
  if (policy.ruleIds) return new Set(policy.ruleIds);
  const rules = (policy as { rules?: { id: string | null }[] }).rules ?? [];
  return new Set(rules.map((rule) => rule.id).filter((id): id is string => typeof id === "string"));
}

export function buildReportView(report: Report, contract: Contract, pack?: PackIndex): ReportView {
  const byPolicy = new Map<string, Finding[]>();
  for (const finding of report.findings) {
    const list = byPolicy.get(finding.policy) ?? [];
    list.push(finding);
    byPolicy.set(finding.policy, list);
  }

  // 정책별 요약은 v1 초안에서만 믿는다. 판 번호 없는 결과에 같은 이름의 필드가 있어도 쓰지 않는다.
  const summaries = new Map((contract === "v1-draft" ? (report.run.policies ?? []) : []).map((s) => [s.policy, s]));
  const packPolicies = new Map((pack?.policies ?? []).map((p) => [p.id, p]));
  const packRules = new Map((pack?.policies ?? []).map((p) => [p.id, ruleIdsOf(p)]));
  const inPack = (policy: string, rule: string) => packRules.get(policy)?.has(rule) ?? false;
  const packMatches = pack ? pack.pack.digest === report.run.pack_digest : null;

  const aiCleared = report.run.ai_cleared ?? [];
  const aiDismissed = report.run.ai_dismissed ?? [];
  // 강한 정적 대안으로 풀린 단위. 정책별 요약이 있는 v1 초안에서는 요약을 믿고 이것을 쓰지 않는다(같은 것을 두 번 적지 않게).
  const staticCleared = contract === "v1-draft" ? null : (report.run.static_cleared ?? null);
  const staticEvidence = new Map<string, PolicySummary["evidence"]>();
  for (const cleared of staticCleared ?? []) {
    const list = staticEvidence.get(cleared.policy) ?? [];
    for (const alternative of cleared.alternatives) {
      const lines = alternative.lines.length > 0 ? alternative.lines : [null];
      for (const line of lines) list.push({ file: cleared.file, line, rule: cleared.rule, alternative: alternative.id });
    }
    if (list.length > 0) staticEvidence.set(cleared.policy, list);
  }
  const clearedCount = new Map<string, number>();
  for (const cleared of aiCleared) {
    clearedCount.set(cleared.policy, (clearedCount.get(cleared.policy) ?? 0) + 1);
  }

  // 카드로 그릴 정책. 팩 순서를 먼저 따르고, 팩에 없는 정책(다른 팩의 결과)은 뒤에 붙인다.
  // CLI 0.3 결과에는 정책 목록이 없어서 이 사이트의 팩에 실린 정책을 모두 그린다. v1 초안은 요약이 그 결과를 만든 팩의
  // 모든 정책이므로(스키마의 run.policies) 결과에 나온 정책만 그린다. 이 사이트의 팩에서 채워 넣으면 요약에 없는
  // 정책이 "발견 없음"이나 "알 수 없음" 카드로 끼어들어, 화면에 적는 정책 수(policyCount)와 카드가 어긋난다.
  const reported = new Set([...summaries.keys(), ...byPolicy.keys(), ...clearedCount.keys(), ...staticEvidence.keys()]);
  const ids = [...packPolicies.keys()].filter((id) => contract !== "v1-draft" || reported.has(id));
  for (const id of reported) {
    if (!ids.includes(id)) ids.push(id);
  }

  const policies: PolicyView[] = ids.map((id) => {
    const findings = byPolicy.get(id) ?? [];
    const summary = summaries.get(id);
    const meta = packPolicies.get(id);
    const all: LocationView[] = findings.map((finding) => ({
      file: finding.file,
      line: finding.line,
      lineUnsure: contract === "sarif" && finding.line === 1 && finding.region === null,
      scope: judgedScope(finding),
      rule: finding.rule,
      ruleInPack: inPack(finding.policy, finding.rule),
      status: findingStatus(finding),
      fingerprint: finding.fingerprint,
      finding,
      nonService: isNonServiceRole(finding.role),
    }));
    const found = all.filter((location) => !location.nonService);
    const locations = [...found].sort(byPlace);
    const evidence = summary?.evidence ?? staticEvidence.get(id) ?? [];

    let status: Status;
    if (locations.length > 0) {
      status = worst(locations.map((l) => l.status));
    } else if (summary) {
      status = summary.compliant > 0 ? "evidence-found" : "no-signal";
    } else if (staticEvidence.has(id)) {
      // 강한 정적 대안이 참이라 풀린 단위가 결과에 실려 있다. 팩 판과 상관없이 결과가 이 정책을 두고 적은 사실이다.
      status = "evidence-found";
    } else if (packMatches === false) {
      // 다른 판의 팩으로 만든 결과다. 그 팩에 이 정책이 있었는지 모르므로 "발견 없음"이라고 하지 않는다.
      status = "pack-unknown";
    } else {
      status = "not-reported";
    }

    return {
      id,
      title: findings[0]?.title ?? meta?.title ?? id,
      law: findings[0]?.law ?? meta?.legal[0]?.label ?? "",
      status,
      locations,
      rules: groupByRule(found),
      checks: groupByRule(found.filter((location) => CHECK_STATUSES.includes(location.status))),
      unknowns: groupByRule(found.filter((location) => !CHECK_STATUSES.includes(location.status))),
      aside: all.filter((location) => location.nonService).sort(byPlace),
      cleared: [],
      evidence,
      units: summary ? summary.units : null,
      aiCleared: clearedCount.get(id) ?? 0,
      inPack: meta !== undefined,
    };
  });

  // 정렬은 안정적이다. 같은 상태 안에서는 팩 순서가 남는다.
  policies.sort((a, b) => byUrgency(a.status, b.status));

  const titles = new Map(policies.map((policy) => [policy.id, policy.title]));
  const item = (record: { policy: string; rule: string; file: string; line?: number | null }): ReviewItem => ({
    policy: record.policy,
    title: titles.get(record.policy) ?? record.policy,
    rule: record.rule,
    ruleInPack: inPack(record.policy, record.rule),
    file: record.file,
    line: record.line ?? null,
    alternatives: [],
    quotes: [],
    uncited: [],
    question: null,
    answer: null,
  });

  // AI 검토가 돌았는지는 한 곳(aiReviewRan)에서 정한다. 빠진 판정을 아는지도 이 값에서 셈한다.
  const ran = aiReviewRan({ judge: report.run.judge });
  const engine = report.run.engine;
  // 커밋도 정책별 요약처럼 v1 초안에서만 읽는다. 파서가 모양을 보지 않는 필드라서 커밋 해시의 모양인지 여기서 확인한다.
  const commit = contract === "v1-draft" ? report.run.commit : null;
  const cleared: ReviewItem[] = aiCleared.map((record) => ({
    ...item(record),
    alternatives: record.alternatives.map((alt) => alt.id),
    // 인용한 글에는 줄 번호가 실려 있지 않다. 파일만 적는다. 어느 대안의 인용인지는 함께 옮긴다(CLI 는 대안마다 인용을 싣는다).
    quotes: record.alternatives.flatMap((alt) => (alt.cite ? [{ file: record.file, line: null, text: alt.cite, alternative: alt.id }] : [])),
    uncited: record.alternatives.filter((alt) => !alt.cite).map((alt) => alt.id),
  }));
  for (const policy of policies) policy.cleared = cleared.filter((entry) => entry.policy === policy.id);

  return {
    contract,
    tool: `${report.tool.name} ${report.tool.version}`,
    engine: engine ? [engine.name, engine.version].filter(Boolean).join(" ") : null,
    judge: report.run.judge,
    packDigest: report.run.pack_digest,
    commit: typeof commit === "string" && COMMIT_HASH.test(commit) ? commit : null,
    packMatches,
    coverage: {
      files: report.run.files ?? null,
      units: report.run.units,
      skipped: report.run.skipped,
      unparsed: report.run.unparsed,
      incomplete: report.run.incomplete,
      engineErrors: report.run.engine_errors.length,
      engineErrorTexts: report.run.engine_errors.filter((error): error is string => typeof error === "string"),
      complete: report.run.coverage_complete,
    },
    policies,
    policyCount: contract === "v1-draft" ? summaries.size : packMatches ? packPolicies.size : null,
    findingCount: serviceFindingCount(report.findings),
    asideCount: report.findings.length - serviceFindingCount(report.findings),
    aiCleared,
    staticCleared,
    aiDismissed,
    aiDismissedKnown: !ran || report.run.ai_dismissed !== undefined,
    aiRows: [{ label: "판정자", value: report.run.judge ?? "꺼짐" }],
    cleared,
    dismissed: aiDismissed.map((dismissed) => ({
      ...item(dismissed),
      question: dismissed.question ?? null,
      answer: dismissed.answer ?? null,
    })),
  };
}
