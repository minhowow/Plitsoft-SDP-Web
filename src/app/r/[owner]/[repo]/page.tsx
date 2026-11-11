import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { HistoryTable, RequestAction } from "@/components/service/analysis";
import { RepoName } from "@/components/service/parts";
import { LatestAnalysis } from "@/components/service/repository";
import { packMeta } from "@/lib/pack";
import { parseReport } from "@/lib/report/parse";
import { buildReportView } from "@/lib/report/view-model";
import { orUnavailable } from "@/lib/service/errors";
import { repoHref } from "@/lib/service/href";
import { isRepoFullName } from "@/lib/service/names";
import { showsSyntheticTag } from "@/server/config";
import { getStore } from "@/server/store";

// 저장소 정보(GitHub)와 분석 기록(DB)을 요청 때 읽는다.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/r/[owner]/[repo]">): Promise<Metadata> {
  const { owner, repo } = await params;
  // 주소의 이름을 그대로 쓴다(제목을 위해 GitHub 을 한 번 더 부르지 않는다. 쪽이 같은 값을 짧게 캐시해 두긴 한다).
  return { title: `${owner}/${repo}` };
}

/**
 * 저장소 쪽(docs/redesign.md 3장 "저장소", 목업 repo): 머리(이름, 설명, 기본 브랜치·언어·분석 수, 오른쪽에 요청 단추), 최신 분석
 * 상자(가장 나중에 끝난 분석), 분석 기록 표.
 */
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
      // (0 으로 적지 않는다). 결과 JSON 전체는 최신 분석 하나만 읽는다.
      const done = analyses.filter((analysis) => analysis.status === "succeeded").map((analysis) => analysis.id);
      const findings = await store.findingCounts(done);
      // 끝난 분석마다 감지된 기능(저장소 프로필에서 결과를 받을 때 적어 둔 이름). 프로필이 없던 분석은 null.
      const features = await store.featureNames(done);
      const latest = analyses.find((analysis) => analysis.status === "succeeded") ?? null;
      const result = latest ? await store.getResult(latest.id) : null;
      // 대기열(DB 에서 센 것). 대기 중인 분석이 몇 번째인지 적는다. 합성은 null.
      const queue = await store.queue();
      return { repository, analyses, findings, features, latest, result, queue };
    })(),
  );
  if (!found.ok) return <Unavailable owner={owner} repo={repo} message={found.message} />;
  if (!found.value) notFound();
  const { repository, analyses, findings, features, latest, result, queue } = found.value;
  const parsed = latest ? parseReport(result) : null;
  const view = parsed?.ok ? buildReportView(parsed.report, parsed.contract, packMeta) : null;

  return (
    <div className="page-wide repo-page">
      <header className="repo-head">
        <div className="repo-ttl">
          <h1 translate="no">
            <RepoName owner={repository.owner} name={repository.name} />
          </h1>
          {showsSyntheticTag() && <span className="tag">합성 예시</span>}
        </div>
        {repository.description && <p className="repo-desc">{repository.description}</p>}
        <p className="repo-meta">
          <span>
            기본 브랜치{" "}
            <span className="v" translate="no">
              {repository.defaultBranch}
            </span>
          </span>
          {repository.language && <span className="v">{repository.language}</span>}
          <span>
            분석 <span className="v">{analyses.length}회</span>
          </span>
        </p>
        <RequestAction repository={repository} closed={store.requestsClosed()} />
      </header>

      {latest && <LatestAnalysis repository={repository} analysis={latest} view={view} features={features[latest.id]} />}

      <section aria-labelledby="history-title" className="repo-history">
        <div className="sec-h">
          <h2 id="history-title">
            분석 기록 <span className="count">{analyses.length}</span>
          </h2>
        </div>
        {analyses.length > 0 ? (
          <HistoryTable repository={repository} analyses={analyses} findings={findings} features={features} queue={queue} />
        ) : (
          <p className="box-empty box">아직 분석 없음</p>
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
