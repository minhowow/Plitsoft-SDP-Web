import type { PackIndex } from "@/lib/pack/types";
import { judgedScope, type JudgedScope } from "./scope";
import { findingStatus, STATUS_ORDER, worst, type Status } from "./status";
import type { AiCleared, AiDismissed, Contract, Finding, PolicySummary, Report } from "./types";

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
  status: Status;
  fingerprint: string;
  finding: Finding;
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
  /** 이 정책의 발견 전부. 파일, 줄, 규칙 순서다. */
  locations: LocationView[];
  /** 같은 발견을 규칙별로 묶은 것. 화면은 이 묶음으로 그린다. */
  rules: RuleGroupView[];
  /** 충족 근거 위치. v1 초안에서만 채워진다. */
  evidence: PolicySummary["evidence"];
  /**
   * 이 정책의 판정 단위 수. 결과에 정책별 요약이 있을 때(v1 초안)만 안다. 없으면 null 이다.
   * CLI 0.3 의 전체 수(`run.units`)에서 짐작해 채우지 않는다.
   */
  units: number | null;
  /** AI 의 '예'로 풀린 경고 수. 0 보다 크면 "구분할 수 없다"는 설명 대신 이 사실을 보인다. */
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
  /** 발견 수(검토 필요 + AI 확인 전 + 판단 보류). 점수가 아니다. */
  findingCount: number;
  /** AI 가 푼 경고와 적용 질문으로 빠진 판정. 숨기지 않는다. 사람이 인용한 줄을 확인해야 한다. */
  aiCleared: AiCleared[];
  aiDismissed: AiDismissed[];
  /**
   * 적용 질문으로 빠진 판정이 `aiDismissed` 에 실린 것뿐이라는 것을 아는지. 판정자가 꺼져 있었으면 AI 에게 묻지
   * 않으므로 빠진 판정이 없다. 켜져 있었으면 결과에 `run.ai_dismissed` 가 실려 있어야 안다(CLI 0.3 은 늘 싣는다.
   * 없는 결과도 읽으므로, 그때는 `aiDismissed` 가 비어 있어도 빠진 판정이 없었다고 하지 않는다).
   */
  aiDismissedKnown: boolean;
}

const byUrgency = (a: Status, b: Status) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b);

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
  const packMatches = pack ? pack.pack.digest === report.run.pack_digest : null;

  const aiCleared = report.run.ai_cleared ?? [];
  const aiDismissed = report.run.ai_dismissed ?? [];
  const clearedCount = new Map<string, number>();
  for (const cleared of aiCleared) {
    clearedCount.set(cleared.policy, (clearedCount.get(cleared.policy) ?? 0) + 1);
  }

  // 카드로 그릴 정책. 팩 순서를 먼저 따르고, 팩에 없는 정책(다른 팩의 결과)은 뒤에 붙인다.
  // CLI 0.3 결과에는 정책 목록이 없어서 이 사이트의 팩에 실린 정책을 모두 그린다. v1 초안은 요약이 그 결과를 만든 팩의
  // 모든 정책이므로(스키마의 run.policies) 결과에 나온 정책만 그린다. 이 사이트의 팩에서 채워 넣으면 요약에 없는
  // 정책이 "발견 없음"이나 "알 수 없음" 카드로 끼어들어, 화면에 적는 정책 수(policyCount)와 카드가 어긋난다.
  const reported = new Set([...summaries.keys(), ...byPolicy.keys(), ...clearedCount.keys()]);
  const ids = [...packPolicies.keys()].filter((id) => contract !== "v1-draft" || reported.has(id));
  for (const id of reported) {
    if (!ids.includes(id)) ids.push(id);
  }

  const policies: PolicyView[] = ids.map((id) => {
    const findings = byPolicy.get(id) ?? [];
    const summary = summaries.get(id);
    const meta = packPolicies.get(id);
    const found: LocationView[] = findings.map((finding) => ({
      file: finding.file,
      line: finding.line,
      lineUnsure: contract === "sarif" && finding.line === 1 && finding.region === null,
      scope: judgedScope(finding),
      rule: finding.rule,
      status: findingStatus(finding),
      fingerprint: finding.fingerprint,
      finding,
    }));
    const locations = [...found].sort(byPlace);

    let status: Status;
    if (locations.length > 0) {
      status = worst(locations.map((l) => l.status));
    } else if (summary) {
      status = summary.compliant > 0 ? "evidence-found" : "no-signal";
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
      evidence: summary?.evidence ?? [],
      units: summary ? summary.units : null,
      aiCleared: clearedCount.get(id) ?? 0,
      inPack: meta !== undefined,
    };
  });

  // 정렬은 안정적이다. 같은 상태 안에서는 팩 순서가 남는다.
  policies.sort((a, b) => byUrgency(a.status, b.status));

  const engine = report.run.engine;
  return {
    contract,
    tool: `${report.tool.name} ${report.tool.version}`,
    engine: engine ? [engine.name, engine.version].filter(Boolean).join(" ") : null,
    judge: report.run.judge,
    packDigest: report.run.pack_digest,
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
    findingCount: report.findings.length,
    aiCleared,
    aiDismissed,
    aiDismissedKnown: report.run.judge === null || report.run.ai_dismissed !== undefined,
  };
}
