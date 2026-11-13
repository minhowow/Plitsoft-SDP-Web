import Link from "next/link";
import type { ReactNode } from "react";
import { keepParticles } from "@/components/text";
import { analysisHref, commitLink, repoHref, shortCommit } from "@/lib/service/href";
import { placeAt, placeOf, placeText, type QueuePlace, type QueueSnapshot } from "@/lib/service/queue";
import {
  activeLabel,
  activeStep,
  ANALYSIS_STATUS_LABEL,
  duration,
  finishedAt,
  formatKst,
  REVIEW_INNER,
  REVIEW_INNER_NOTE,
  SCAN_PART_LABEL,
  scanParts,
  STEP_LABEL,
  STEP_STATE_LABEL,
  stepState,
  stepStateLabel,
} from "@/lib/service/steps";
import type { Analysis, Repository } from "@/lib/service/types";
import { STATUS_LABEL } from "@/lib/report/status";
import { Icon } from "@/components/Icon";
import { SITE } from "@/lib/site";
import { AnalysisBadge, FeatureLine, RepoName } from "./parts";

export { findingCount } from "./parts";
import { RequestButton } from "./RequestButton";

/**
 * 분석 쪽과 저장소 쪽의 서버 부품: 쪽 머리, 진행 단계, 요청 단추, 분석 기록 표.
 */

/**
 * 커밋. 저장소 주소가 있으면 GitHub 의 커밋 고정 링크(새 창), 없으면(합성) 글로만 적는다. `title` 속성은 달지 않는다(터치와
 * 키보드에서 보이지 않는다. docs/redesign.md 2.1). 전체 해시는 링크가 가리키는 주소에 있다.
 */
export function CommitRef({ repository, commit }: { repository: Repository; commit: string }) {
  const href = commitLink(repository.htmlUrl, commit);
  const text = (
    <code translate="no">{shortCommit(commit)}</code>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  ) : (
    text
  );
}

/** 시각 둘을 "2026-11-03 22:11–22:12" 처럼 적는다(한국 표준시). 날이 다르면 끝도 날짜까지 적는다. */
function kstRange(from: string, to: string): { start: string; end: string } {
  const start = formatKst(from);
  const end = formatKst(to);
  return { start, end: end.slice(0, 10) === start.slice(0, 10) ? end.slice(11) : end };
}

/**
 * 분석 쪽 머리의 첫 줄: 저장소 이름(h1, 저장소 쪽으로 가는 링크)과 합성 예시 이름표. 이름표를 달지는 쪽이 서버 설정으로 정한다
 * (`showsSyntheticTag`: 합성 미리보기, 가짜 GitHub).
 */
export function AnalysisTitle({ repository, tagged }: { repository: Repository; tagged: boolean }) {
  return (
    <>
      <h1>
        <Link href={repoHref(repository.owner, repository.name)} translate="no">
          <RepoName owner={repository.owner} name={repository.name} />
        </Link>
      </h1>
      {tagged && <span className="tag">합성 예시</span>}
    </>
  );
}

/**
 * 분석 쪽 머리의 메타 줄: 배지, 분석 id, 커밋과 브랜치, 시각(KST), 걸린 시간. 저장소(위 줄), 커밋, 분석 id, 시각이 한자리에
 * 있다(docs/commitments.md 의 "실제 결과로 보인다"). 끝난 분석은 시작–끝 시각과 걸린 시간을, 그 밖에는 요청 시각을 적는다.
 */
export function AnalysisMeta({ repository, analysis }: { repository: Repository; analysis: Analysis }) {
  const ended = analysis.status === "succeeded" ? finishedAt(analysis) : null;
  const started = analysis.steps[0]?.startedAt ?? analysis.requestedAt;
  const range = ended ? kstRange(started, ended) : null;
  return (
    <div className="meta an-meta">
      <AnalysisBadge status={analysis.status} />
      <span>
        분석{" "}
        <code className="v" translate="no">
          {analysis.id}
        </code>
      </span>
      <span>
        <Icon name="commit" />
        <span className="visually-hidden">커밋 </span>
        <CommitRef repository={repository} commit={analysis.commit} />{" "}
        <span className="v" translate="no">
          {analysis.branch}
        </span>
      </span>
      {range && ended ? (
        <>
          <span className="num">
            <time dateTime={started}>{range.start}</time>–<time dateTime={ended}>{range.end}</time> KST
          </span>
          <span>
            걸린 시간 <span className="v num">{duration(started, ended)}</span>
          </span>
        </>
      ) : (
        <span>
          요청{" "}
          <span className="v num">
            <time dateTime={analysis.requestedAt}>{formatKst(analysis.requestedAt)}</time> KST
          </span>
        </span>
      )}
    </div>
  );
}

/** 분석 쪽의 머리(결과가 없는 분석: 대기·분석 중·실패). 끝난 분석은 조문별 검사 기록 단추와 함께 결과의 틀이 그린다. */
export function AnalysisHeader({ repository, analysis, tagged }: { repository: Repository; analysis: Analysis; tagged: boolean }) {
  return (
    <header className="an-head">
      <div className="ttl">
        <AnalysisTitle repository={repository} tagged={tagged} />
      </div>
      <AnalysisMeta repository={repository} analysis={analysis} />
    </header>
  );
}

/** 단계 하나의 오른쪽 칸: 끝난 단계는 걸린 시간, 그 밖에는 형편(진행 중, 기다림, 멈춤, 하지 않음). */
function stepEnd(analysis: Analysis, step: Analysis["steps"][number]): ReactNode {
  const state = stepState(analysis, step);
  const took = step.startedAt && step.endedAt ? duration(step.startedAt, step.endedAt) : null;
  if (state === "done") {
    return took ? (
      <>
        <span className="visually-hidden">{STEP_STATE_LABEL.done}, </span>
        {took}
      </>
    ) : (
      STEP_STATE_LABEL.done
    );
  }
  if (state === "failed" && took) return `${took}, ${STEP_STATE_LABEL.failed}`;
  return stepStateLabel(analysis, step);
}

/**
 * 진행 단계. 단계마다 점, 이름, 시작 시각(시:분, KST), 걸린 시간이나 형편을 적는다. 진행 중인 단계는 화면 낭독기에도 그렇다고
 * 알린다(aria-current). 검사 단계 아래에는 그 안의 차례(`scanParts`)를 한 칸 들여 적는다. 진행 중·멈춘 분석이거나 실행기가 알린
 * 차례가 있을 때만 적는다(그 알림이 생기기 전에 끝난 분석에는 적을 것이 없다).
 */
export function StepList({ analysis }: { analysis: Analysis }) {
  const showParts = analysis.status !== "succeeded" || Boolean(analysis.scanPart);
  return (
    <ol className="steps">
      {analysis.steps.flatMap((step) => {
        const state = stepState(analysis, step);
        const parts = step.name === "scan" && showParts ? scanParts(analysis) : [];
        // 검사 단계가 진행 중이면 지금인 것은 그 안의 일이다(aria-current 는 그 줄에). 안의 일이 지금이 아니면 단계 줄에 둔다.
        const current = state === "active" && !parts.some((part) => part.state === "active");
        const row = (
          <li key={step.name} className={`step-item step-${state}`} aria-current={current ? "step" : undefined}>
            <span className="step-dot" aria-hidden="true" />
            <span className="step-name">{STEP_LABEL[step.name]}</span>
            <span className="step-time">{step.startedAt && <time dateTime={step.startedAt}>{formatKst(step.startedAt).slice(11)}</time>}</span>
            <span className="step-state">{stepEnd(analysis, step)}</span>
          </li>
        );
        return [
          row,
          ...parts.map((part) => (
            <li
              key={`scan-${part.name}`}
              className={`step-item step-sub step-${part.state}`}
              aria-current={part.state === "active" ? "step" : undefined}
            >
              <span className="step-dot" aria-hidden="true" />
              <span className="step-name">
                {SCAN_PART_LABEL[part.name]}
                {part.name === "review" && !part.skipped && (
                  <span className="step-inner">
                    {REVIEW_INNER} <span className="step-inner-note">({REVIEW_INNER_NOTE})</span>
                  </span>
                )}
              </span>
              <span className="step-time">{part.startedAt && <time dateTime={part.startedAt}>{formatKst(part.startedAt).slice(11)}</time>}</span>
              <span className="step-state">{part.skipped ?? STEP_STATE_LABEL[part.state]}</span>
            </li>
          )),
        ];
      })}
    </ol>
  );
}

/** 진행 중인 합성 분석의 맨 아래 말. 합성은 움직이지 않는 한 순간이다(실제 분석은 쪽이 몇 초마다 다시 읽는다. `LiveAnalysis`). */
export const PROGRESS_NOTE = {
  synthetic: "합성 예시의 한 순간을 고정해 보인 것이라 이 쪽은 움직이지 않습니다.",
} as const;

/**
 * 진행 중(대기·분석 중)인 분석의 `진행` 상자(분석 쪽). 지금 단계 한 줄과 단계 표. 대기 중이고 대기열의 자리를 알면 지금 단계 대신
 * 그 자리를 적는다(실행 자리의 수는 적지 않는다). `live` 면 그 줄이 바뀔 때 화면 낭독기가 읽는다(role="status"). `note` 는 맨
 * 아래 말(합성의 고정된 순간, 다시 읽지 못한 까닭).
 */
export function InProgress({
  analysis,
  note = null,
  live = false,
  place = null,
}: {
  analysis: Analysis;
  note?: ReactNode;
  live?: boolean;
  /** 대기 중인 분석이 대기열의 어디에 있는지(DB 에서 센 것). 모르면(합성, 읽지 못함) 적지 않는다. */
  place?: QueuePlace | null;
}) {
  const step = activeLabel(analysis);
  // 다시 읽는 쪽(`LiveAnalysis`)은 끝난 분석을 서버가 새로 그리기 전 잠깐 이 부품으로 그린다.
  const now =
    analysis.status === "succeeded"
      ? "분석이 끝났습니다."
      : analysis.status === "failed"
        ? "분석이 멈췄습니다."
        : analysis.status === "queued" && place
          ? placeText(place)
          : step
            ? `지금 ‘${step}’ 단계`
            : "다음 단계를 기다리고 있습니다.";
  return (
    <section className="box live-box" aria-labelledby="progress-title">
      <div className="box-hd">
        <h2 id="progress-title">진행</h2>
      </div>
      <div className="bd">
        <p className="live-now" role={live ? "status" : undefined}>
          {keepParticles(now)}
        </p>
        {analysis.review === "run" && (analysis.status === "queued" || analysis.status === "running") && (
          <p className="hint">{SITE.service.reviewTakes}</p>
        )}
        <StepList analysis={analysis} />
        {note && <div className="hint an-progress-note">{note}</div>}
      </div>
    </section>
  );
}

/** 실패한 분석의 `진행` 상자(빨간 테두리). 멈춘 단계와 까닭을 숨기지 않는다. */
export function Failed({ analysis }: { analysis: Analysis }) {
  const failure = analysis.failure!;
  return (
    <section className="box live-box fail-box" aria-labelledby="failed-title">
      <div className="box-hd">
        <h2 id="failed-title">{keepParticles(`‘${STEP_LABEL[failure.step]}’ 단계에서 멈춤`)}</h2>
      </div>
      <div className="bd">
        <p>{failure.reason}</p>
        <p className="zero-line">검사를 끝내지 못해 결과가 없습니다. 검토할 곳이 없다는 뜻이 아닙니다.</p>
        <StepList analysis={analysis} />
      </div>
    </section>
  );
}

/** 요청 단추의 이름: 기본 브랜치의 끝 커밋을 검사한다는 것을 단추 하나가 말한다(docs/redesign.md 2.3 의 낱말 표). */
export function requestLabel(repository: Repository): string {
  return `${repository.defaultBranch} 최신 커밋 분석`;
}

/**
 * 분석 요청(저장소 쪽 머리의 오른쪽). 요청을 받으면(`closed` 가 null) 같은 사이트의 `/api/analyses/` 를 부르는 단추
 * (`RequestButton`, 브라우저 부품)를 둔다. 받지 않을 때(합성 미리보기, 실행기 없음)는 단추가 듣지 않는다. 누를 수 없게 두고 그
 * 까닭(`closed`)을 바로 옆에 적는다(눌러도 아무 일이 없는 단추를 두지 않는다).
 */
export function RequestAction({ repository, closed }: { repository: Repository; closed: string | null }) {
  const label = requestLabel(repository);
  return (
    <div className="request">
      {closed === null ? (
        <RequestButton owner={repository.owner} name={repository.name} label={label} />
      ) : (
        <>
          {/* disabled 대신 aria-disabled: 키보드로 단추에 닿아 까닭(aria-describedby)을 들을 수 있게 한다. 듣는 손잡이가 없어
              눌러도 아무 일이 없다. */}
          <button type="button" aria-disabled="true" aria-describedby="request-off">
            {label}
          </button>
          <p id="request-off" className="hint">
            {closed}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * 저장소의 분석 기록 표. 나중에 요청한 것이 위다. 칸은 분석 id(그 쪽으로 가는 링크), 상태, 커밋, 요청 시각(KST), 발견. 끝난
 * 분석에는 결과에 실린 발견 수를 적는다(점수가 아니다). 대기 중인 분석은 대기열의 몇 번째인지를 센 때와 함께 적는다(이 쪽은
 * 다시 읽지 않는다).
 */
export function HistoryTable({
  repository,
  analyses,
  findings,
  features = {},
  queue = null,
}: {
  repository: Repository;
  analyses: Analysis[];
  findings: Record<string, number | null>;
  /** 끝난 분석마다 감지된 기능(`ServiceStore.featureNames`). 분석 칸의 id 아래에 짧게 적는다. */
  features?: Record<string, string[] | null>;
  /** 대기열(DB 에서 센 것). 없으면(합성) 대기열의 자리를 적지 않는다. */
  queue?: QueueSnapshot | null;
}) {
  // 발견 0건인 끝난 분석이 표에 있으면 0의 뜻을 표 바로 아래에 적는다(docs/commitments.md 의 1).
  const zero = analyses.some((analysis) => analysis.status === "succeeded" && findings[analysis.id] === 0);
  return (
    <>
      <div className="box box-scroll">
        <table className="tbl an-table" aria-labelledby="history-title">
          <thead>
            <tr>
              <th scope="col">분석</th>
              <th scope="col">상태</th>
              <th scope="col">커밋</th>
              <th scope="col" className="hide-sm">
                요청 시각 (KST)
              </th>
              <th scope="col" className="r">
                발견
              </th>
            </tr>
          </thead>
          <tbody>
            {analyses.map((analysis) => {
              const note = progressNote(analysis, queue);
              return (
                <tr key={analysis.id} className={`an-row-${analysis.status}`}>
                  <td>
                    <Link href={analysisHref(repository.owner, repository.name, analysis.id)} className="an-row-id">
                      <code translate="no">{analysis.id}</code>
                    </Link>
                    {analysis.status === "succeeded" && <FeatureLine names={features[analysis.id]} className="an-row-feat" />}
                  </td>
                  <td className="an-row-state">
                    <AnalysisBadge status={analysis.status} />
                    {note && <span className="an-row-note">{note}</span>}
                  </td>
                  <td>
                    <CommitRef repository={repository} commit={analysis.commit} />
                  </td>
                  <td className="hide-sm">
                    <time dateTime={analysis.requestedAt}>{formatKst(analysis.requestedAt)}</time>
                  </td>
                  <td className="r an-row-out">{analysis.status === "succeeded" ? findingCell(findings[analysis.id]) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {zero && <p className="hint zero-note">{SITE.zeroIsNotClearance}</p>}
    </>
  );
}

/** 표의 발견 칸. 결과가 없거나 읽지 못했으면 0 이라고 적지 않고 모른다고 적는다. */
function findingCell(count: number | null | undefined): string {
  return typeof count === "number" ? `${count}건` : STATUS_LABEL["pack-unknown"];
}

/**
 * 상태 칸의 덧붙임: 멈춘 단계, 지금 단계, 대기열의 자리(센 때와 함께). 끝난 분석에는 없다. 배지와 같은 말이면(대기열의 자리를
 * 모르는 대기 중) 적지 않는다("대기 중 대기 중"이 되지 않게).
 */
function progressNote(analysis: Analysis, queue: QueueSnapshot | null): string | null {
  if (analysis.status === "succeeded") return null;
  if (analysis.status === "failed") return analysis.failure ? `${STEP_LABEL[analysis.failure.step]}에서 멈춤` : null;
  const place = analysis.status === "queued" ? placeOf(queue, analysis.id) : null;
  if (place && queue) return placeAt(place, queue.countedAt);
  const now = stepNow(analysis);
  return now === ANALYSIS_STATUS_LABEL[analysis.status] ? null : now;
}

/**
 * 대기·분석 중인 분석의 지금 단계. 단계 사이에 있으면(앞 단계가 끝나고 다음이 시작하기 전) 대기라고 적지 않는다. 대기열의 자리는
 * 부르는 쪽이 따로 적는다.
 */
export function stepNow(analysis: Analysis): string {
  const step = activeStep(analysis);
  if (step) return step.name === "queued" ? ANALYSIS_STATUS_LABEL.queued : `${activeLabel(analysis)} 중`;
  return analysis.status === "queued" ? ANALYSIS_STATUS_LABEL.queued : "다음 단계 기다림";
}
