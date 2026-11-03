import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AnalysisList, InProgress, RequestPanel } from "@/components/service/analysis";
import { RepoName } from "@/components/service/parts";
import { orUnavailable } from "@/lib/service/errors";
import { analysisHref, repoHref } from "@/lib/service/href";
import { isRepoFullName } from "@/lib/service/names";
import { SITE } from "@/lib/site";
import Link from "next/link";
import { getStore } from "@/server/store";

// 저장소 정보(GitHub)와 분석 기록(DB)을 요청 때 읽는다.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/r/[owner]/[repo]">): Promise<Metadata> {
  const { owner, repo } = await params;
  // 주소의 이름을 그대로 쓴다(제목을 위해 GitHub 을 한 번 더 부르지 않는다. 쪽이 같은 값을 짧게 캐시해 두긴 한다).
  return { title: `${owner}/${repo}` };
}

export default async function RepositoryPage({ params }: PageProps<"/r/[owner]/[repo]">) {
  const { owner, repo } = await params;
  if (!isRepoFullName(owner, repo)) notFound();
  // GitHub 은 이름의 대소문자를 가리지 않는다. 주소는 소문자 하나로 모은다.
  if (owner !== owner.toLowerCase() || repo !== repo.toLowerCase()) redirect(repoHref(owner, repo));
  const store = getStore();
  const found = await orUnavailable(
    (async () => {
      const repository = await store.getRepository(owner, repo);
      if (!repository) return null;
      const analyses = await store.listAnalyses(repository.owner, repository.name);
      // 끝난 분석마다 결과에 실린 발견 수(결과를 받을 때 결과 화면과 같은 파서로 센 값). 결과가 없거나 읽지 못하면 null 이다
      // (0 으로 적지 않는다). 결과 JSON 전체를 분석마다 읽지 않는다.
      const findings = await store.findingCounts(analyses.filter((analysis) => analysis.status === "succeeded").map((analysis) => analysis.id));
      return { repository, analyses, findings };
    })(),
  );
  if (!found.ok) return <Unavailable owner={owner} repo={repo} message={found.message} />;
  if (!found.value) notFound();
  const { repository, analyses, findings } = found.value;
  const moving = analyses.filter((analysis) => analysis.status === "queued" || analysis.status === "running");

  return (
    <div className="page-wide repo-page">
      <header className="repo-head">
        <h1>
          <RepoName owner={repository.owner} name={repository.name} />
        </h1>
        {repository.description && <p className="lede">{repository.description}</p>}
        <dl className="an-facts">
          <div>
            <dt>기본 브랜치</dt>
            <dd>
              <code>{repository.defaultBranch}</code>
            </dd>
          </div>
          {repository.language && (
            <div>
              <dt>언어</dt>
              <dd>{repository.language}</dd>
            </div>
          )}
          <div>
            <dt>분석</dt>
            <dd>{analyses.length}회</dd>
          </div>
        </dl>
      </header>
      {store.synthetic && <p className="notice">{SITE.service.synthetic}</p>}

      <RequestPanel
        repository={repository}
        latest={analyses[0] ?? null}
        closed={store.requestsClosed()}
      />

      {moving.map((analysis) => (
        <section key={analysis.id} className="repo-moving" aria-label={`진행 중인 분석 ${analysis.id}`}>
          <p className="repo-moving-head">
            진행 중인 분석{" "}
            <Link href={analysisHref(repository.owner, repository.name, analysis.id)}>
              <code>{analysis.id}</code>
            </Link>
          </p>
          <InProgress analysis={analysis} compact />
        </section>
      ))}

      <section aria-labelledby="history-title" className="repo-history">
        <h2 id="history-title">분석 기록</h2>
        {analyses.length > 0 ? (
          <>
            <p className="hint">나중에 요청한 분석이 위입니다. 같은 저장소를 여러 번 분석해도 분석마다 따로 남습니다.</p>
            <AnalysisList repository={repository} analyses={analyses} findings={findings} />
          </>
        ) : (
          <p className="notice">아직 분석된 적이 없습니다. 위에서 분석을 요청하면 이곳에 기록이 생깁니다.</p>
        )}
      </section>
    </div>
  );
}

/** GitHub 이나 DB 에 닿지 못했다. 까닭을 그대로 적는다(없는 저장소라고 말하지 않는다). */
function Unavailable({ owner, repo, message }: { owner: string; repo: string; message: string }) {
  return (
    <div className="page-wide repo-page">
      <h1>
        <RepoName owner={owner} name={repo} />
      </h1>
      <p className="notice notice-warn">{message}</p>
    </div>
  );
}
