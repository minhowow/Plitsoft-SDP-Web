import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportWithRecord } from "@/components/result/ReportWithRecord";
import { AnalysisHeader, Failed, InProgress, StepList } from "@/components/service/analysis";
import { AnalysisDashboard, type Statute } from "@/components/service/AnalysisDashboard";
import { packIndex, packMeta } from "@/lib/pack";
import { parseReport } from "@/lib/report/parse";
import { buildReportView } from "@/lib/report/view-model";
import { store } from "@/lib/service";
import { formatKst } from "@/lib/service/steps";
import { SITE } from "@/lib/site";

// 정적 내보내기에서는 빌드 때 아는 분석만 쪽이 된다(합성 분석). B2 에서 서버가 그리면 이 두 줄을 걷는다.
export const dynamicParams = false;

export async function generateStaticParams() {
  const params: { owner: string; repo: string; id: string }[] = [];
  for (const { repository } of await store.listRepositories()) {
    for (const analysis of await store.listAnalyses(repository.owner, repository.name)) {
      params.push({ owner: repository.owner.toLowerCase(), repo: repository.name.toLowerCase(), id: analysis.id });
    }
  }
  return params;
}

export async function generateMetadata({ params }: PageProps<"/r/[owner]/[repo]/a/[id]">): Promise<Metadata> {
  const { owner, repo, id } = await params;
  const repository = await store.getRepository(owner, repo);
  return { title: repository ? `분석 ${id} · ${repository.owner}/${repository.name}` : `분석 ${id}` };
}

export default async function AnalysisPage({ params }: PageProps<"/r/[owner]/[repo]/a/[id]">) {
  const { owner, repo, id } = await params;
  const repository = await store.getRepository(owner, repo);
  const analysis = repository && (await store.getAnalysis(repository.owner, repository.name, id));
  if (!repository || !analysis) notFound();

  const synthetic = store.synthetic && <p className="notice">{SITE.service.synthetic}</p>;

  if (analysis.status !== "succeeded") {
    return (
      <div className="page-wide an-page">
        <AnalysisHeader repository={repository} analysis={analysis} />
        {synthetic}
        {analysis.status === "failed" ? <Failed analysis={analysis} /> : <InProgress analysis={analysis} />}
      </div>
    );
  }

  // 끝난 분석: 결과 JSON 을 결과 화면과 같은 파서와 화면 구조로 읽는다. 빌드할 때 하므로 팩 메타데이터는 브라우저로 가지 않는다.
  const parsed = parseReport(await store.getResult(analysis.id));
  if (!parsed.ok) {
    return (
      <div className="page-wide an-page">
        <AnalysisHeader repository={repository} analysis={analysis} />
        {synthetic}
        <p className="notice notice-warn">이 분석의 결과를 읽지 못했습니다. {parsed.errors.slice(0, 3).join(" ")}</p>
      </div>
    );
  }
  const view = buildReportView(parsed.report, parsed.contract, packMeta);
  const code = repository.htmlUrl ? { htmlUrl: repository.htmlUrl, commit: analysis.commit } : null;
  // 정책마다 대표 근거 조문(원문이 있는 첫 조문). 팩 메타데이터의 글을 그대로 옮긴다. 빌드할 때 HTML 에 들어간다.
  // 결과가 다른 판의 팩으로 만들어졌으면 이 사이트의 팩 조문이 그 정책의 근거라고 말할 수 없으므로 싣지 않는다.
  const statutes: Record<string, Statute> = {};
  for (const policy of view.packMatches ? packMeta.policies : []) {
    const ref = policy.legal.find((legal) => legal.text);
    if (ref?.text) statutes[policy.id] = { label: ref.label, text: ref.text };
  }
  // 기록의 "검사한 날"은 정적 검사 단계가 시작한 때다(분석 기록의 값).
  const scannedAt = analysis.steps.find((step) => step.name === "static")?.startedAt ?? analysis.requestedAt;

  return (
    <div className="page-wide an-page">
      <AnalysisHeader
        repository={repository}
        analysis={analysis}
        extra={
          <>
            <div>
              <dt>판정자</dt>
              <dd>{view.judge ?? "꺼짐"}</dd>
            </div>
            <div>
              <dt>엔진</dt>
              <dd>{view.engine ?? "실행 안 함"}</dd>
            </div>
          </>
        }
      />
      {store.synthetic && (
        <p className="notice">
          {SITE.service.synthetic}
          {!code && repository.synthetic && " 합성 저장소는 GitHub 에 없어서 파일·줄과 커밋에 링크를 걸지 않습니다."}
        </p>
      )}
      <ReportWithRecord
        view={view}
        pack={packIndex}
        source={{
          name: `${repository.owner}/${repository.name} · 분석 ${analysis.id}`,
          synthetic: repository.synthetic,
          analysis: { id: analysis.id, commit: analysis.commit, scannedAt: `${formatKst(scannedAt)} KST` },
        }}
      >
        <AnalysisDashboard view={view} code={code} statutes={statutes} />
      </ReportWithRecord>
      <details className="fold an-steps">
        <summary>진행 기록</summary>
        <StepList analysis={analysis} />
      </details>
    </div>
  );
}
