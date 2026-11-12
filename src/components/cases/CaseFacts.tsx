import { casesFile, modelId, type CaseData } from "@/lib/cases";
import { parseReview } from "@/lib/review";
import { commitLink, shortCommit } from "@/lib/service/href";
import { secondsText } from "@/lib/service/steps";
import { SITE } from "@/lib/site";

/**
 * 사례의 사실 한 줄(review 2판의 실측, 2026-11-12 오너 지시): 미리 돌린 결과라는 것, 돌린 날, 조사 모델과 반박 모델, CLI 커밋.
 * 사례 쪽 하나면 그 저장소의 커밋과 비용 어림·걸린 시간을 더한다. 모델·비용·시간은 결과에 실린 그대로다.
 */
export function CaseFacts({ cases, one }: { cases: CaseData[]; one?: CaseData }) {
  const runs = cases.map((c) => parseReview(c.review)?.run).filter((run) => run !== undefined);
  const investigate = [...new Set(runs.map((run) => run.models.investigate))].join(", ");
  const verify = [...new Set(runs.map((run) => run.models.verify))].join(", ");
  const run = one ? parseReview(one.review)?.run : undefined;
  return (
    <p className="pi-meta">
      <span>{SITE.cases.prerun}</span>{" "}
      <span>
        <time dateTime={casesFile.reviewRun.ranOn}>{casesFile.reviewRun.ranOn}</time>
      </span>{" "}
      <span>
        조사 <code translate="no">{investigate}</code>
      </span>{" "}
      <span>
        반박 <code translate="no">{verify}</code>
      </span>{" "}
      <span>
        CLI <code translate="no">{casesFile.reviewRun.cli}</code>
      </span>
      {one && (
        <>
          {" "}
          <span>
            커밋{" "}
            <a href={commitLink(one.htmlUrl, one.commit) ?? undefined} target="_blank" rel="noopener noreferrer">
              <code translate="no">{shortCommit(one.commit)}</code>
            </a>
          </span>
          {run && (
            <>
              {" "}
              <span>비용 어림 ${run.usdEstimate.toFixed(2)}</span> <span>걸린 시간 {secondsText(run.seconds)}</span>
            </>
          )}
        </>
      )}
    </p>
  );
}

/** 앞서 돌린 정적 검사 + AI 판정(`--agent`)의 사실 한 줄: 돌린 날, 찾는 모델과 재확인 모델, CLI 커밋, 검사한 파일 수. */
export function EarlierFacts({ one }: { one: CaseData }) {
  return (
    <p className="pi-meta">
      <span>
        <time dateTime={casesFile.ranOn}>{casesFile.ranOn}</time>
      </span>{" "}
      <span>
        찾기 <code translate="no">{modelId(one.finder)}</code>
      </span>{" "}
      <span>
        재확인 <code translate="no">{modelId(one.rechecker)}</code>
      </span>{" "}
      <span>
        CLI <code translate="no">{casesFile.cli.commit}</code>
      </span>{" "}
      <span>검사한 파일 {one.files}개</span>
    </p>
  );
}
