import type { ReactNode } from "react";
import type { CodeSource } from "@/components/result/PolicyCard";
import { ReportSummary, type Statute } from "@/components/result/ReportSummary";
import { ObligationTier, ProfileTier, Tier } from "@/components/result/Tiers";
import type { Profile } from "@/lib/profile";
import { CHECKLIST_LABEL } from "@/lib/report/status";
import type { ReportView } from "@/lib/report/view-model";

export type { Statute } from "@/components/result/ReportSummary";

/** 체크리스트 묶음의 발견 수(접힌 곳까지). */
const placesIn = (view: ReportView, pick: "checks" | "unknowns") =>
  view.policies.reduce((sum, policy) => sum + policy[pick].reduce((n, group) => n + group.shown.length + group.folded.length, 0), 0);

/**
 * 맨 위 한 문장 요약(2026-11-11 오너 지시): 감지된 기능 N가지 · 걸릴 수 있는 의무 M개 · 확인할 것 K건. 코드로는 알 수 없는 발견이
 * 있으면 그 수도 잇는다(빼면 그 발견이 요약에서 사라진다). 프로필이 없으면 셋째 단의 수만 적는다. 개수만 센다. 사례 쪽도 쓴다.
 */
export function OverviewLine({ profile, check, unknown }: { profile: Profile | null; check: number; unknown: number }) {
  return (
    <p className="overview">
      {profile && (
        <>
          <span>
            감지된 기능 <b>{profile.features.length}가지</b>
          </span>{" "}
          <span>
            걸릴 수 있는 의무 <b>{profile.totals.duties}개</b>
          </span>{" "}
        </>
      )}
      <span>
        {CHECKLIST_LABEL.check} <b>{check}건</b>
      </span>
      {unknown > 0 && (
        <>
          {" "}
          <span>
            {CHECKLIST_LABEL.unknown} <b>{unknown}건</b>
          </span>
        </>
      )}
    </p>
  );
}

/**
 * 끝난 분석의 결과 화면(분석 쪽). 맨 위 한 문장 요약 다음에 세 단으로 읽힌다(2026-11-11 오너 지시): 1 프로필, 2 걸리는 의무,
 * 3 검토 결과. 1·2단은 CLI 의 저장소 프로필(`profile`)이고, 프로필이 없는 분석(그 명령이 없던 판으로 돌린 것)에는 "아직
 * 없음"이다. 3단은 결과 파일 열기(`/view`)와 데모가 쓰는 결과 화면(`ReportSummary`)을 같은 부품, 같은 차례로 쓴다(docs/redesign.md
 * 3장).
 *
 * 분석 쪽만 더하는 것은 셋이다: 발견 줄의 GitHub 커밋 고정 링크(`code`), 정책 상자 맨 아래에 접어 두는 근거 조문 원문
 * (`statutes`, 서버가 팩 메타데이터에서 고른다), 검사 정보 안의 진행 기록(`progress`). 판정자를 켜 보라고 권하지 않는다(서버의
 * 분석은 판정자를 늘 켠다. docs/commitments.md 의 "CLI 가 이미 약속한 것").
 */
export function AnalysisDashboard({
  view,
  code,
  statutes = {},
  progress,
  profile = null,
}: {
  view: ReportView;
  code: CodeSource | null;
  /** 정책 id → 대표 근거 조문. 없으면 조문을 싣지 않는다. */
  statutes?: Record<string, Statute | undefined>;
  progress?: ReactNode;
  /** 저장소 프로필. 없으면 1·2단에 "아직 없음"이라고 적는다. */
  profile?: Profile | null;
}) {
  return (
    <div className="tiers">
      <OverviewLine profile={profile} check={placesIn(view, "checks")} unknown={placesIn(view, "unknowns")} />
      <ProfileTier profile={profile} code={code} />
      <ObligationTier profile={profile} />
      <Tier n={3} name="검토 결과">
        <ReportSummary view={view} code={code} statutes={statutes} progress={progress} />
      </Tier>
    </div>
  );
}
