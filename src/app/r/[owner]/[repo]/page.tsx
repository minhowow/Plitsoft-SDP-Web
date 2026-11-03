import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnalysisList, InProgress, RequestPanel } from "@/components/service/analysis";
import { RepoName } from "@/components/service/parts";
import { parseReport } from "@/lib/report/parse";
import { store } from "@/lib/service";
import { analysisHref } from "@/lib/service/href";
import { SITE } from "@/lib/site";
import Link from "next/link";

// 정적 내보내기에서는 빌드 때 아는 저장소만 쪽이 된다(합성 저장소). B2 에서 서버가 그리면 이 두 줄을 걷는다.
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await store.listRepositories()).map(({ repository }) => ({
    owner: repository.owner.toLowerCase(),
    repo: repository.name.toLowerCase(),
  }));
}

export async function generateMetadata({ params }: PageProps<"/r/[owner]/[repo]">): Promise<Metadata> {
  const { owner, repo } = await params;
  const repository = await store.getRepository(owner, repo);
  return { title: repository ? `${repository.owner}/${repository.name}` : "저장소" };
}

export default async function RepositoryPage({ params }: PageProps<"/r/[owner]/[repo]">) {
  const { owner, repo } = await params;
  const repository = await store.getRepository(owner, repo);
  if (!repository) notFound();
  const analyses = await store.listAnalyses(repository.owner, repository.name);
  const moving = analyses.filter((analysis) => analysis.status === "queued" || analysis.status === "running");

  // 끝난 분석마다 결과에 실린 발견 수. 결과를 해석하는 것은 결과 화면과 같은 파서다. 결과가 없거나 읽지 못하면 null 이다
  // (0 으로 적지 않는다).
  const findings: Record<string, number | null> = {};
  for (const analysis of analyses) {
    if (analysis.status !== "succeeded") continue;
    const parsed = parseReport(await store.getResult(analysis.id));
    findings[analysis.id] = parsed.ok ? parsed.report.findings.length : null;
  }

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

      <RequestPanel repository={repository} latest={analyses[0] ?? null} />

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
