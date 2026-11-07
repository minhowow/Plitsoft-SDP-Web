import Link from "next/link";
import type { ReactNode } from "react";
import { keepParticles } from "@/components/text";
import { analysisHref, commitLink, repoHref, shortCommit } from "@/lib/service/href";
import { placeAt, placeOf, placeText, type QueuePlace, type QueueSnapshot } from "@/lib/service/queue";
import { activeStep, ANALYSIS_STATUS_LABEL, duration, finishedAt, formatKst, STEP_LABEL, stepState, stepStateLabel } from "@/lib/service/steps";
import type { Analysis, Repository } from "@/lib/service/types";
import { STATUS_LABEL } from "@/lib/report/status";
import { SITE } from "@/lib/site";
import { AnalysisBadge, RepoName } from "./parts";

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

/** 이름표와 값 한 쌍(쪽 머리의 사실 줄). */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * 분석 쪽의 머리. 저장소·분석 id·상태를 맨 위에, 그 아래에 커밋·시각·도구와 팩의 판을 한 줄로 늘어놓는다(GitHub 의 저장소 쪽
 * 머리처럼). 판정자·엔진처럼 결과에서만 아는 것은 `extra` 로 받는다(끝난 분석).
 */
export function AnalysisHeader({ repository, analysis, extra }: { repository: Repository; analysis: Analysis; extra?: ReactNode }) {
  const ended = finishedAt(analysis);
  return (
    <header className="an-head">
      <p className="an-crumbs">
        <Link href={repoHref(repository.owner, repository.name)}>
          <RepoName owner={repository.owner} name={repository.name} />
        </Link>
        {repository.synthetic && <span className="tag">합성 예시</span>}
      </p>
      <div className="an-title">
        <h1>
          분석 <code>{analysis.id}</code>
        </h1>
        <AnalysisBadge status={analysis.status} />
      </div>
      <dl className="an-facts">
        <Fact label="커밋">
          <CommitRef repository={repository} commit={analysis.commit} /> <span className="an-branch">{analysis.branch}</span>
        </Fact>
        <Fact label="요청">
          <time dateTime={analysis.requestedAt}>{formatKst(analysis.requestedAt)}</time>
        </Fact>
        {ended && (
          <Fact label={analysis.status === "failed" ? "멈춤" : "끝남"}>
            <time dateTime={ended}>{formatKst(ended)}</time>{" "}
            <span className="an-dim">({duration(analysis.requestedAt, ended)})</span>
          </Fact>
        )}
        <Fact label="도구">
          {analysis.versions ? (
            <>
              {SITE.cli} {analysis.versions.tool}
            </>
          ) : (
            <span className="an-dim">설치 전</span>
          )}
        </Fact>
        <Fact label="팩 판">
          {analysis.versions ? <code>{analysis.versions.pack}</code> : <span className="an-dim">설치 전</span>}
        </Fact>
        {extra}
      </dl>
      <p className="an-time-note">시각은 한국 표준시(KST)입니다.</p>
    </header>
  );
}

/**
 * 진행 단계. 단계마다 형편(끝남, 진행 중, 대기 중, 기다림, 멈춤, 하지 않음)과 시각을 적는다. 진행 중인 단계는 화면 낭독기에도 그렇다고
 * 알린다(aria-current).
 */
export function StepList({ analysis }: { analysis: Analysis }) {
  return (
    <ol className="steps">
      {analysis.steps.map((step) => {
        const state = stepState(analysis, step);
        return (
          <li key={step.name} className={`step-item step-${state}`} aria-current={state === "active" ? "step" : undefined}>
            <span className="step-dot" aria-hidden="true" />
            <span className="step-name">{STEP_LABEL[step.name]}</span>
            <span className="step-state">{stepStateLabel(analysis, step)}</span>
            <span className="step-time">
              {step.startedAt && <time dateTime={step.startedAt}>{formatKst(step.startedAt)}</time>}
              {step.startedAt && step.endedAt && ` · ${duration(step.startedAt, step.endedAt)}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** 진행 중인 분석 쪽의 맨 아래 말. 합성은 움직이지 않는 한 순간이고, 실제 분석은 쪽이 몇 초마다 다시 읽는다(`LiveAnalysis`). */
export const PROGRESS_NOTE = {
  synthetic: "합성 예시의 한 순간을 고정해 보인 것이라 이 쪽은 움직이지 않습니다.",
  live: "이 쪽은 몇 초마다 진행을 다시 읽고, 끝나면 이 자리에 결과를 그립니다. 탭이 보이지 않는 동안은 읽기를 쉽니다.",
} as const;

/**
 * 진행 중(대기·분석 중)인 분석의 본문(분석 쪽). `note` 는 맨 아래 말(`PROGRESS_NOTE`). `live` 면 지금 단계를 알리는 줄이 바뀔 때
 * 화면 낭독기가 읽는다(role="status").
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
  const step = activeStep(analysis);
  // 다시 읽는 쪽(`LiveAnalysis`)은 끝난 분석을 서버가 새로 그리기 전 잠깐 이 부품으로 그린다.
  const now =
    analysis.status === "succeeded"
      ? "분석이 끝났습니다."
      : analysis.status === "failed"
        ? "분석이 멈췄습니다."
        : step
          ? keepParticles(`지금 ‘${STEP_LABEL[step.name]}’ 단계입니다.`)
          : "다음 단계를 기다리고 있습니다.";
  // 대기열의 몇 번째인지만 적는다(실행 자리의 수는 적지 않는다). 이 쪽은 다시 읽으므로 센 때를 붙이지 않는다. 바뀌는 대로
  // 화면 낭독기가 읽게 한다(live 일 때).
  const queue = analysis.status === "queued" && place && (
    <p className="hint an-queue" role={live ? "status" : undefined}>
      {keepParticles(placeText(place))}
    </p>
  );
  return (
    <section className="an-progress" aria-labelledby="progress-title">
      <h2 id="progress-title">진행 상황</h2>
      <p className="notice" role={live ? "status" : undefined}>
        {now} 진행 중인 분석은 누구나 볼 수 있고, 끝나면 이 주소에 결과가 그려집니다.
      </p>
      {queue}
      <StepList analysis={analysis} />
      {note && <div className="hint an-progress-note">{note}</div>}
    </section>
  );
}

/** 실패한 분석의 본문. 까닭과 멈춘 단계를 숨기지 않는다. */
export function Failed({ analysis }: { analysis: Analysis }) {
  const failure = analysis.failure!;
  return (
    <section className="an-progress" aria-labelledby="failed-title">
      <h2 id="failed-title">분석이 끝나지 못했습니다</h2>
      <p className="notice notice-warn">
        <strong>{keepParticles(`‘${STEP_LABEL[failure.step]}’ 단계에서 멈췄습니다.`)}</strong> {failure.reason}
      </p>
      <p className="hint">검사를 끝내지 못해 결과가 없습니다. 검토할 곳이 없다는 뜻이 아닙니다.</p>
      <StepList analysis={analysis} />
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
  queue = null,
}: {
  repository: Repository;
  analyses: Analysis[];
  findings: Record<string, number | null>;
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
  if (step) return step.name === "queued" ? ANALYSIS_STATUS_LABEL.queued : `${STEP_LABEL[step.name]} 중`;
  return analysis.status === "queued" ? ANALYSIS_STATUS_LABEL.queued : "다음 단계 기다림";
}
