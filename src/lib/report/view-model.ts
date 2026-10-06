import type { PackMeta } from "@/lib/pack/types";
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
  rule: string;
  status: Status;
  fingerprint: string;
  finding: Finding;
}

export interface PolicyView {
  id: string;
  title: string;
  law: string;
  status: Status;
  locations: LocationView[];
  /** 충족 근거 위치. v1 초안에서만 채워진다. */
  evidence: PolicySummary["evidence"];
  /** AI 의 '예'로 풀린 경고 수. 0 보다 크면 "구분할 수 없다"는 설명 대신 이 사실을 보인다. */
  aiCleared: number;
  /** 팩 메타데이터에 이 정책이 있는지. 없으면 조문 도감으로 이어 줄 수 없다. */
  inPack: boolean;
}

export interface CoverageView {
  files: number | null;
  units: number;
  /** 검사하지 않은 파일. 결과에 없다. */
  skipped: string[];
  /** 일부를 파싱하지 못한 파일. 구문 조건이 '모름'이 되어 판단 보류로 남았을 수 있다. 결과에는 있다. */
  unparsed: string[];
  /** 엔진이 조건을 끝내지 못한 파일. 끝나지 않은 조건은 판단 보류로 남는다. 결과에는 있다. */
  incomplete: string[];
  engineErrors: number;
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
  /** 발견 수(검토 필요 + AI 확인 전 + 판단 보류). 점수가 아니다. */
  findingCount: number;
  /** AI 가 푼 경고와 적용 질문으로 빠진 판정. 숨기지 않는다. 사람이 인용한 줄을 확인해야 한다. */
  aiCleared: AiCleared[];
  aiDismissed: AiDismissed[];
}

/**
 * 결과 JSON 을 화면용 구조로 바꾼다. 같은 정책의 발견은 정책 하나 아래로 묶는다.
 * 팩 메타데이터를 주면 발견이 없는 정책도 함께 보여 준다.
 */
export function buildReportView(report: Report, contract: Contract, pack?: PackMeta): ReportView {
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

  // 팩 순서를 먼저 따르고, 팩에 없는 정책(다른 팩의 결과)은 뒤에 붙인다.
  const ids = [...packPolicies.keys()];
  for (const id of [...summaries.keys(), ...byPolicy.keys(), ...clearedCount.keys()]) {
    if (!ids.includes(id)) ids.push(id);
  }

  const policies: PolicyView[] = ids.map((id) => {
    const findings = byPolicy.get(id) ?? [];
    const summary = summaries.get(id);
    const meta = packPolicies.get(id);
    const locations: LocationView[] = findings
      .map((finding) => ({
        file: finding.file,
        line: finding.line,
        rule: finding.rule,
        status: findingStatus(finding),
        fingerprint: finding.fingerprint,
        finding,
      }))
      .sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule));

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
      evidence: summary?.evidence ?? [],
      aiCleared: clearedCount.get(id) ?? 0,
      inPack: meta !== undefined,
    };
  });

  // 정렬은 안정적이다. 같은 상태 안에서는 팩 순서가 남는다.
  policies.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

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
      complete: report.run.coverage_complete,
    },
    policies,
    findingCount: report.findings.length,
    aiCleared,
    aiDismissed,
  };
}
