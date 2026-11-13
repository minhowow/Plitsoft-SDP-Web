import Link from "next/link";
import { Icon } from "@/components/Icon";
import { analysisHref, shortCommit } from "@/lib/service/href";
import { activeLabel, activeStep, ANALYSIS_STATUS_LABEL, formatKst, stepState } from "@/lib/service/steps";
import type { Analysis, RepositoryActivity } from "@/lib/service/types";
import { SITE } from "@/lib/site";
import { FeatureLine, findingCount, RepoName } from "./parts";

/**
 * 이 사이트의 최근 분석(저장소마다 한 줄, `ServiceStore.recentActivity`). 첫 화면(`feed`: 검색창 아래 같은 단)과 검색 쪽의 빈
 * 상태(`box`: 상자 안의 줄)가 같은 줄을 쓴다(docs/redesign.md 3장 "첫 화면", 목업 home-feed·search-home).
 *
 * 줄은 그 분석의 쪽으로 가는 링크다. 첫 줄은 상태 표시, 저장소 이름, 오른쪽에 발견 수(끝남) 또는 상태 글(`steps.ts` 의 말).
 * 둘째 줄은 분석 id, 커밋, 요청 시각(KST)이다. 끝난 분석에 저장소 프로필이 있으면 셋째 줄에 감지된 기능을 짧게 적는다(발견 0건
 * 줄도 빈 줄로 보이지 않게. 2026-11-11). 분석 중이면 단계 점 넷과 지금 단계 이름을 더한다. 끝난 분석의 결과가 없거나
 * 읽지 못했으면 0 이라고 적지 않고 "발견 수 알 수 없음"이다. 발견 0건 줄이 보이면 목록 아래에 0의 뜻을 둔다.
 */
export function ActivityList({
  rows,
  findings,
  features = {},
  variant,
}: {
  rows: RepositoryActivity[];
  /** 끝난 분석마다 결과에 실린 발견 수(`ServiceStore.findingCounts`). */
  findings: Record<string, number | null>;
  /** 끝난 분석마다 감지된 기능의 이름(`ServiceStore.featureNames`). */
  features?: Record<string, string[] | null>;
  variant: "feed" | "box";
}) {
  const zero = rows.some(({ analysis }) => analysis.status === "succeeded" && findings[analysis.id] === 0);
  return (
    <>
      <ol className={`act act-${variant}`}>
        {rows.map(({ repository, analysis }) => (
          <li key={analysis.id}>
            <Link href={analysisHref(repository.owner, repository.name, analysis.id)} className="act-row" data-status={analysis.status}>
              {variant === "feed" && <span className="act-mark" aria-hidden="true" />}
              <span className="act-name" translate="no">
                <RepoName owner={repository.owner} name={repository.name} />
              </span>
              <span className="act-state">
                <ActivityState analysis={analysis} count={findings[analysis.id]} />
              </span>
              <span className="act-sub">
                <code translate="no">{analysis.id}</code>{" "}
                <span className="nw">
                  커밋 <code translate="no">{shortCommit(analysis.commit)}</code>
                </span>{" "}
                <time dateTime={analysis.requestedAt}>{formatKst(analysis.requestedAt)}</time>
              </span>
              {analysis.status === "succeeded" && <FeatureLine names={features[analysis.id]} className="act-feat" />}
              {analysis.status === "running" && <StepTrail analysis={analysis} />}
              {variant === "box" && <Icon name="chevron-right" />}
            </Link>
          </li>
        ))}
      </ol>
      {/* 발견 0건이 보이면 그 수의 뜻을 바로 아래에 둔다(docs/commitments.md 의 1). */}
      {zero && <p className="act-zero">{SITE.zeroIsNotClearance}</p>}
    </>
  );
}

/** 오른쪽의 말. 끝난 분석은 발견 수(화면 낭독기에는 "끝남, " 을 앞에), 나머지는 분석의 상태(단계 사이면 "다음 단계 기다림"). */
function ActivityState({ analysis, count }: { analysis: Analysis; count: number | null | undefined }) {
  if (analysis.status === "succeeded") {
    return (
      <>
        <span className="visually-hidden">{ANALYSIS_STATUS_LABEL.succeeded}, </span>
        {findingCount(count)}
      </>
    );
  }
  if (analysis.status === "running" && activeStep(analysis) === null) return <>다음 단계 기다림</>;
  return <>{ANALYSIS_STATUS_LABEL[analysis.status]}</>;
}

/** 분석 중인 줄의 단계 점 넷(끝남·지금·아직)과 지금 단계의 이름. 점은 그림이라 화면 낭독기에는 숨긴다. */
function StepTrail({ analysis }: { analysis: Analysis }) {
  const step = activeStep(analysis);
  return (
    <span className="act-step">
      <span className="act-trail" aria-hidden="true">
        {analysis.steps.map((s) => {
          const state = stepState(analysis, s);
          return <i key={s.name} className={state === "done" ? "done" : state === "active" ? "now" : undefined} />;
        })}
      </span>
      {step && <span>{activeLabel(analysis)}</span>}
    </span>
  );
}
