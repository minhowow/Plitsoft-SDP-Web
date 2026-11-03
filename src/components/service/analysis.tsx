import Link from "next/link";
import type { ReactNode } from "react";
import { keepParticles } from "@/components/text";
import { analysisHref, commitLink, repoHref, shortCommit } from "@/lib/service/href";
import { countedText, placeOf, placeShort, placeText, poolText, type QueuePlace, type QueueSnapshot } from "@/lib/service/queue";
import { activeStep, duration, finishedAt, formatKst, STEP_LABEL, stepState, stepStateLabel } from "@/lib/service/steps";
import type { Analysis, Repository } from "@/lib/service/types";
import { STATUS_LABEL } from "@/lib/report/status";
import { SITE } from "@/lib/site";
import { AnalysisBadge, RepoName } from "./parts";
import { RequestButton } from "./RequestButton";

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
 * 진행 중(대기·분석 중)인 분석의 본문. `compact` 는 저장소 쪽에 끼워 넣을 때다(제목과 맨 아래 말을 뺀다. 저장소 쪽이
 * 합성 예시라는 것을 따로 밝힌다). `note` 는 맨 아래 말(`PROGRESS_NOTE`). `live` 면 지금 단계를 알리는 줄이 바뀔 때 화면
 * 낭독기가 읽는다(role="status").
 */
export function InProgress({
  analysis,
  compact = false,
  note = null,
  live = false,
  place = null,
  countedAt = null,
}: {
  analysis: Analysis;
  compact?: boolean;
  note?: ReactNode;
  live?: boolean;
  /** 대기 중인 분석이 대기열의 어디에 있는지(DB 에서 센 것). 모르면(합성, 읽지 못함) 적지 않는다. */
  place?: QueuePlace | null;
  /**
   * 대기열을 센 때. 다시 읽지 않는 쪽(저장소 쪽)이 넘긴다. 있으면 숫자가 그때의 것이고 분석 쪽에서 계속 갱신된다고 적는다(지난
   * 숫자를 지금 숫자처럼 보이지 않게).
   */
  countedAt?: string | null;
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
  // 대기열 줄도 바뀌는 대로 화면 낭독기가 읽게 한다(live 일 때).
  const queue = analysis.status === "queued" && place && (
    <p className="hint an-queue" role={live ? "status" : undefined}>
      {countedAt && `${countedText(countedAt)} `}
      {keepParticles(placeText(place))}
      {countedAt && " 분석 쪽에서는 계속 갱신됩니다."}
    </p>
  );
  if (compact) {
    return (
      <>
        <p className="hint">{now}</p>
        {queue}
        <StepList analysis={analysis} />
      </>
    );
  }
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

/**
 * 분석 요청. 요청을 받으면(`closed` 가 null) 같은 사이트의 `/api/analyses/` 를 부르는 단추(`RequestButton`, 브라우저 부품)를
 * 둔다. 받지 않을 때(합성 미리보기, 실행기 없음)는 단추가 듣지 않는다. 누를 수 없게 두고 그 까닭(`closed`)을 바로 옆에 적는다
 * (눌러도 아무 일이 없는 단추를 두지 않는다).
 */
export function RequestPanel({
  repository,
  latest,
  closed,
  queue = null,
}: {
  repository: Repository;
  latest: Analysis | null;
  closed: string | null;
  /** 지금의 대기열과 실행 자리(DB 에서 센 것). 요청을 받을 때만 적는다. */
  queue?: QueueSnapshot | null;
}) {
  const label = latest ? "다시 분석 요청" : "분석 요청";
  return (
    <section className="request" aria-labelledby="request-title">
      <div>
        <h2 id="request-title">분석 요청</h2>
        <p className="hint">
          기본 브랜치 <code>{repository.defaultBranch}</code> 의 끝 커밋을 검사합니다. 로그인 없이 누구나 요청하고, 결과는 누구나
          봅니다.
          {latest && " 이미 분석이 있어도 다시 요청할 수 있습니다. 분석마다 따로 남습니다. 같은 커밋을 최근에 분석했으면 그 분석으로 갑니다."}
        </p>
        {closed === null && queue && (
          <p className="hint request-queue">
            {countedText(queue.countedAt)} 이 사이트 전체에서 {poolText(queue.poolSize, queue.inUse)}, 대기열 {queue.waiting.length}개. 요청은
            대기열에 들어가 차례대로 실행기에 보냅니다.
          </p>
        )}
      </div>
      <div className="request-action">
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
    </section>
  );
}

/** 저장소의 분석 목록. 나중에 요청한 것이 위다. 끝난 분석에는 결과에 실린 발견 수를 적는다(점수가 아니다). */
export function AnalysisList({
  repository,
  analyses,
  findings,
  queue = null,
}: {
  repository: Repository;
  analyses: Analysis[];
  findings: Record<string, number | null>;
  /** 대기열과 실행 자리. 대기 중인 분석에 대기열의 몇 번째인지 적는다. 없으면(합성) 적지 않는다. */
  queue?: QueueSnapshot | null;
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
                : stepNow(analysis, placeOf(queue, analysis.id))}
          </span>
        </li>
      ))}
    </ul>
    {zero && <p className="hint an-list-zero">{SITE.zeroIsNotClearance}</p>}
    {queue && analyses.some((analysis) => placeOf(queue, analysis.id)) && (
      <p className="hint an-list-queue">대기열 순서는 {countedText(queue.countedAt)}의 것입니다. 분석 쪽에서는 계속 갱신됩니다.</p>
    )}
    </>
  );
}

/** 끝난 분석의 발견 수. 결과가 없거나 읽지 못했으면 0 이라고 적지 않고 모른다고 적는다. */
export function findingCount(count: number | null | undefined): string {
  return typeof count === "number" ? `발견 ${count}건` : `발견 수 ${STATUS_LABEL["pack-unknown"]}`;
}

/** 대기·분석 중인 분석의 지금 단계. 대기 중이면 대기열의 몇 번째인지(알 때). 단계 사이에 있으면(앞 단계가 끝나고 다음이 시작하기 전) 대기라고 적지 않는다. */
function stepNow(analysis: Analysis, place: QueuePlace | null): string {
  if (analysis.status === "queued" && place) return placeShort(place);
  const step = activeStep(analysis);
  if (step) return `${STEP_LABEL[step.name]} 중`;
  return analysis.status === "queued" ? `${STEP_LABEL.queued} 중` : "다음 단계 기다림";
}
