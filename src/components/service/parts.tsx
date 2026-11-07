import Link from "next/link";
import { Icon } from "@/components/Icon";
import { STATUS_LABEL } from "@/lib/report/status";
import { repoHref } from "@/lib/service/href";
import { ANALYSIS_STATUS_LABEL, formatKst } from "@/lib/service/steps";
import type { AnalysisStatus, RepositoryActivity, RepositoryHit } from "@/lib/service/types";

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

/** 날짜만(한국 표준시). "2026-11-03" */
function kstDate(iso: string): string {
  return formatKst(iso).slice(0, 10);
}

/**
 * 검색 결과의 한 줄(목업 search). 줄 전체가 저장소 쪽으로 가는 링크다. 이름(굵게), 설명 한 줄, 그리고 오른쪽에 언어, 이 사이트의
 * 분석 수, 가장 나중의 분석 날짜. 데이터에 있는 것만 적는다(GitHub 이 준 설명·언어, DB 의 분석).
 */
export function RepoRow({ hit }: { hit: RepositoryHit }) {
  const { repository: repo, analyses, latest } = hit;
  return (
    <li>
      <Link href={repoHref(repo.owner, repo.name)} className="sr-row repo-row">
        <span className="sr-name repo-link" translate="no">
          <RepoName owner={repo.owner} name={repo.name} />
        </span>
        <span className="sr-facts">
          {repo.language && <span>{repo.language}</span>}
          {latest ? (
            <>
              <span>분석 {analyses}회</span>
              <span>
                최근 <time dateTime={latest.requestedAt}>{kstDate(latest.requestedAt)}</time>
              </span>
            </>
          ) : (
            <span>분석된 적 없음</span>
          )}
        </span>
        <Icon name="chevron-right" />
        {repo.description && <span className="sr-desc">{repo.description}</span>}
      </Link>
    </li>
  );
}

/**
 * 이 사이트에서 분석된 저장소의 한 줄(검색 0건 화면, 목업 search-empty). 분석 수, 가장 나중의 분석 날짜, 그리고 보이는 분석의
 * 발견 수(끝남) 또는 상태. 설명은 기록에 있을 때만(운영 DB 의 기록에는 없다).
 */
export function AnalyzedRow({ activity, count }: { activity: RepositoryActivity; count: number | null | undefined }) {
  const { repository: repo, analysis, analyses, latestAt } = activity;
  return (
    <li>
      <Link href={repoHref(repo.owner, repo.name)} className="sr-row repo-row">
        <span className="sr-name repo-link" translate="no">
          <RepoName owner={repo.owner} name={repo.name} />
        </span>
        <span className="sr-facts">
          <span>분석 {analyses}회</span>
          <span>
            최근 <time dateTime={latestAt}>{kstDate(latestAt)}</time>
          </span>
          <span>{analysis.status === "succeeded" ? findingCount(count) : ANALYSIS_STATUS_LABEL[analysis.status]}</span>
        </span>
        <Icon name="chevron-right" />
        {repo.description && <span className="sr-desc">{repo.description}</span>}
      </Link>
    </li>
  );
}

/** 끝난 분석의 발견 수. 결과가 없거나 읽지 못했으면 0 이라고 적지 않고 모른다고 적는다. */
export function findingCount(count: number | null | undefined): string {
  return typeof count === "number" ? `발견 ${count}건` : `발견 수 ${STATUS_LABEL["pack-unknown"]}`;
}
