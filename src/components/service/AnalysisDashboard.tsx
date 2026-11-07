import type { ReactNode } from "react";
import type { CodeSource } from "@/components/result/PolicyCard";
import { ReportSummary, type Statute } from "@/components/result/ReportSummary";
import type { ReportView } from "@/lib/report/view-model";

export type { Statute } from "@/components/result/ReportSummary";

/**
 * 끝난 분석의 결과 화면(분석 쪽). 결과 파일 열기(`/view`)와 데모가 쓰는 결과 화면(`ReportSummary`)을 같은 부품, 같은 차례로
 * 쓴다(docs/redesign.md 3장). 분석 쪽만 더하는 것은 셋이다: 발견 줄의 GitHub 커밋 고정 링크(`code`), 정책 상자 맨 아래에 접어
 * 두는 근거 조문 원문(`statutes`, 서버가 팩 메타데이터에서 고른다), 검사 정보 안의 진행 기록(`progress`). 판정자를 켜 보라고
 * 권하지 않는다(서버의 분석은 판정자를 늘 켠다. docs/commitments.md 의 "CLI 가 이미 약속한 것").
 */
export function AnalysisDashboard({
  view,
  code,
  statutes = {},
  progress,
}: {
  view: ReportView;
  code: CodeSource | null;
  /** 정책 id → 대표 근거 조문. 없으면 조문을 싣지 않는다. */
  statutes?: Record<string, Statute | undefined>;
  progress?: ReactNode;
}) {
  return <ReportSummary view={view} code={code} statutes={statutes} progress={progress} />;
}
