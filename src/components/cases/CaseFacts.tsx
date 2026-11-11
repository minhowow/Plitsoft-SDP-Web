import { casesFile, modelId, type CaseData } from "@/lib/cases";
import { commitLink, shortCommit } from "@/lib/service/href";
import { SITE } from "@/lib/site";

/**
 * 사례의 사실 한 줄: 미리 돌린 결과라는 것, 돌린 날, 찾는 모델과 재확인 모델, CLI 커밋, 프로필을 돌린 CLI 커밋(모델 호출 없음). 사례 쪽 하나면 그 저장소의 커밋과
 * 검사한 파일 수를 더한다. 모델은 결과에 실린 이름의 끝(모델 id)이다.
 */
export function CaseFacts({ cases, one }: { cases: CaseData[]; one?: CaseData }) {
  const finders = [...new Set(cases.map((c) => modelId(c.finder)))].join(", ");
  const recheckers = [...new Set(cases.map((c) => modelId(c.rechecker)))].join(", ");
  return (
    <p className="pi-meta">
      <span>{SITE.cases.prerun}</span>{" "}
      <span>
        <time dateTime={casesFile.ranOn}>{casesFile.ranOn}</time>
      </span>{" "}
      <span>
        찾기 <code translate="no">{finders}</code>
      </span>{" "}
      <span>
        재확인 <code translate="no">{recheckers}</code>
      </span>{" "}
      <span>
        CLI <code translate="no">{casesFile.cli.commit}</code>
      </span>{" "}
      <span>
        프로필 CLI <code translate="no">{casesFile.profileCli.commit}</code>
      </span>
      {one && (
        <>
          {" "}
          <span>
            커밋{" "}
            <a href={commitLink(one.htmlUrl, one.commit) ?? undefined} target="_blank" rel="noopener noreferrer">
              <code translate="no">{shortCommit(one.commit)}</code>
            </a>
          </span>{" "}
          <span>검사한 파일 {one.files}개</span>
        </>
      )}
    </p>
  );
}
