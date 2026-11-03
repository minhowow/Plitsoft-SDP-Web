import Link from "next/link";
import { analysisHref, repoHref } from "@/lib/service/href";
import { ANALYSIS_STATUS_LABEL, formatKst } from "@/lib/service/steps";
import type { AnalysisStatus, RepositoryHit } from "@/lib/service/types";

/**
 * 분석 서비스의 작은 부품. 데이터를 불러오지 않으므로 브라우저에서 도는 검색 쪽도 쓴다.
 */

/** 분석의 상태 표. 결과의 판정 칩(`StatusChip`)과 모양을 달리한다(네모, 테두리). 분석이 어디까지 갔는지만 말한다. */
export function AnalysisBadge({ status }: { status: AnalysisStatus }) {
  return <span className={`badge badge-${status}`}>{ANALYSIS_STATUS_LABEL[status]}</span>;
}

/** 저장소 이름. owner 는 옅게, 이름은 굵게(GitHub 과 같은 위계). */
export function RepoName({ owner, name }: { owner: string; name: string }) {
  return (
    <>
      <span className="repo-owner">{owner}</span>
      <span className="repo-slash"> / </span>
      <strong className="repo-name">{name}</strong>
    </>
  );
}

/** 저장소 목록의 한 줄(검색 결과). 분석된 적이 있는지와 가장 나중의 분석을 함께 적는다. */
export function RepoRow({ hit }: { hit: RepositoryHit }) {
  const { repository: repo, analyses, latest } = hit;
  return (
    <li className="repo-row">
      <div className="repo-row-main">
        <Link href={repoHref(repo.owner, repo.name)} className="repo-link">
          <RepoName owner={repo.owner} name={repo.name} />
        </Link>
        {repo.synthetic && <span className="tag">합성 예시</span>}
      </div>
      {repo.description && <p className="repo-desc">{repo.description}</p>}
      <p className="repo-facts">
        {repo.language && <span>{repo.language}</span>}
        {latest ? (
          <>
            <span>분석 {analyses}회</span>
            <span className="repo-latest">
              최근 분석{" "}
              <Link href={analysisHref(repo.owner, repo.name, latest.id)} prefetch={false}>
                <code>{latest.id}</code>
              </Link>{" "}
              <AnalysisBadge status={latest.status} /> <time dateTime={latest.requestedAt}>{formatKst(latest.requestedAt)}</time>
            </span>
          </>
        ) : (
          <span>분석된 적 없음</span>
        )}
      </p>
    </li>
  );
}
