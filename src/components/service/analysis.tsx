import Link from "next/link";
import type { ReactNode } from "react";
import { keepParticles } from "@/components/text";
import { analysisHref, commitLink, repoHref, shortCommit } from "@/lib/service/href";
import { activeStep, duration, finishedAt, formatKst, STEP_LABEL, stepState, stepStateLabel } from "@/lib/service/steps";
import type { Analysis, Repository } from "@/lib/service/types";
import { STATUS_LABEL } from "@/lib/report/status";
import { SITE } from "@/lib/site";
import { AnalysisBadge, RepoName } from "./parts";

/**
 * 분석 쪽과 저장소 쪽의 서버 부품: 쪽 머리, 진행 단계, 요청 단추, 분석 목록.
 */

/** 커밋. 저장소 주소가 있으면 GitHub 의 커밋 고정 링크(새 창), 없으면(합성) 글로만 적는다. 전체 해시는 title 에 둔다. */
export function CommitRef({ repository, commit }: { repository: Repository; commit: string }) {
  const href = commitLink(repository.htmlUrl, commit);
  const text = <code title={commit}>{shortCommit(commit)}</code>;
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
 * 진행 단계. 단계마다 형편(끝남, 진행 중, 대기 중, 기다림, 건너뜀, 멈춤, 하지 않음)과 시각을 적는다. 진행 중인 단계는 화면 낭독기에도 그렇다고
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
              {state === "skipped" && step.name === "judge" && "판정자 없이 만든 결과라 이 단계가 없었습니다."}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 진행 중(대기·분석 중)인 분석의 본문. `compact` 는 저장소 쪽에 끼워 넣을 때다(제목과 고정된 순간이라는 말을 뺀다. 저장소 쪽이
 * 합성 예시라는 것을 따로 밝힌다).
 */
export function InProgress({ analysis, compact = false }: { analysis: Analysis; compact?: boolean }) {
  const step = activeStep(analysis);
  const now = step ? keepParticles(`지금 ‘${STEP_LABEL[step.name]}’ 단계입니다.`) : "다음 단계를 기다리고 있습니다.";
  if (compact) {
    return (
      <>
        <p className="hint">{now}</p>
        <StepList analysis={analysis} />
      </>
    );
  }
  return (
    <section className="an-progress" aria-labelledby="progress-title">
      <h2 id="progress-title">진행 상황</h2>
      <p className="notice">
        {now} 진행 중인 분석은 누구나 볼 수 있고, 끝나면 이 주소에 결과가 그려집니다.
      </p>
      <StepList analysis={analysis} />
      <p className="hint">
        합성 예시의 한 순간을 고정해 보인 것이라 이 쪽은 움직이지 않습니다. 서버가 붙으면 몇 초마다 새로 읽습니다.
      </p>
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

/**
 * 분석 요청. B1 에는 서버가 없어 단추가 듣지 않는다. 누를 수 없게 두고 그 까닭을 바로 옆에 적는다(눌러도 아무 일이 없는 단추를
 * 두지 않는다).
 */
export function RequestPanel({ repository, latest }: { repository: Repository; latest: Analysis | null }) {
  return (
    <section className="request" aria-labelledby="request-title">
      <div>
        <h2 id="request-title">분석 요청</h2>
        <p className="hint">
          기본 브랜치 <code>{repository.defaultBranch}</code> 의 끝 커밋을 검사합니다. 로그인 없이 누구나 요청하고, 결과는 누구나
          봅니다.
          {latest && " 이미 분석이 있어도 다시 요청할 수 있습니다. 분석마다 따로 남습니다."}
        </p>
      </div>
      <div className="request-action">
        {/* disabled 대신 aria-disabled: 키보드로 단추에 닿아 까닭(aria-describedby)을 들을 수 있게 한다. 듣는 손잡이가 없어
            눌러도 아무 일이 없다. */}
        <button type="button" aria-disabled="true" aria-describedby="request-off">
          {latest ? "다시 분석 요청" : "분석 요청"}
        </button>
        <p id="request-off" className="hint">
          {SITE.service.noServer}
        </p>
      </div>
    </section>
  );
}

/** 저장소의 분석 목록. 나중에 요청한 것이 위다. 끝난 분석에는 결과에 실린 발견 수를 적는다(점수가 아니다). */
export function AnalysisList({
  repository,
  analyses,
  findings,
}: {
  repository: Repository;
  analyses: Analysis[];
  findings: Record<string, number | null>;
}) {
  // 발견 0건인 끝난 분석이 목록에 있으면 0의 뜻을 목록 바로 아래에 적는다(docs/commitments.md 의 1).
  const zero = analyses.some((analysis) => analysis.status === "succeeded" && findings[analysis.id] === 0);
  return (
    <>
    <ul className="an-list">
      {analyses.map((analysis) => (
        <li key={analysis.id} className={`an-row an-row-${analysis.status}`}>
          <Link href={analysisHref(repository.owner, repository.name, analysis.id)} className="an-row-id">
            <code>{analysis.id}</code>
          </Link>
          <AnalysisBadge status={analysis.status} />
          <span className="an-row-commit">
            <span className="an-dim">커밋</span> <CommitRef repository={repository} commit={analysis.commit} />
          </span>
          <time className="an-row-time" dateTime={analysis.requestedAt}>
            {formatKst(analysis.requestedAt)}
          </time>
          <span className="an-row-out">
            {analysis.status === "succeeded"
              ? findingCount(findings[analysis.id])
              : analysis.status === "failed"
                ? `${STEP_LABEL[analysis.failure!.step]}에서 멈춤`
                : stepNow(analysis)}
          </span>
        </li>
      ))}
    </ul>
    {zero && <p className="hint an-list-zero">{SITE.zeroIsNotClearance}</p>}
    </>
  );
}

/** 끝난 분석의 발견 수. 결과가 없거나 읽지 못했으면 0 이라고 적지 않고 모른다고 적는다. */
export function findingCount(count: number | null | undefined): string {
  return typeof count === "number" ? `발견 ${count}건` : `발견 수 ${STATUS_LABEL["pack-unknown"]}`;
}

/** 대기·분석 중인 분석의 지금 단계. 단계 사이에 있으면(앞 단계가 끝나고 다음이 시작하기 전) 대기라고 적지 않는다. */
function stepNow(analysis: Analysis): string {
  const step = activeStep(analysis);
  if (step) return `${STEP_LABEL[step.name]} 중`;
  return analysis.status === "queued" ? `${STEP_LABEL.queued} 중` : "다음 단계 기다림";
}
