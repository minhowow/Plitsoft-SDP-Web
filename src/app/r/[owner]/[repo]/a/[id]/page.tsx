import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ReportWithRecord } from "@/components/result/ReportWithRecord";
import { AnalysisHeader, AnalysisMeta, AnalysisTitle, Failed, InProgress, PROGRESS_NOTE, StepList } from "@/components/service/analysis";
import { LiveAnalysis } from "@/components/service/LiveAnalysis";
import { AnalysisDashboard, type Statute } from "@/components/service/AnalysisDashboard";
import { packIndex, packMeta } from "@/lib/pack";
import { parseReport } from "@/lib/report/parse";
import { buildReportView } from "@/lib/report/view-model";
import { orUnavailable } from "@/lib/service/errors";
import { placeOf } from "@/lib/service/queue";
import { analysisHref } from "@/lib/service/href";
import { isAnalysisId } from "@/lib/service/id";
import { isRepoFullName } from "@/lib/service/names";
import { formatKst } from "@/lib/service/steps";
import { showsSyntheticTag } from "@/server/config";
import { getStore } from "@/server/store";

// 분석의 진행과 결과(DB)를 요청 때 읽는다.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/r/[owner]/[repo]/a/[id]">): Promise<Metadata> {
  const { owner, repo, id } = await params;
  return { title: `분석 ${id} · ${owner}/${repo}` };
}

export default async function AnalysisPage({ params }: PageProps<"/r/[owner]/[repo]/a/[id]">) {
  const { owner, repo, id } = await params;
  if (!isAnalysisId(id) || !isRepoFullName(owner, repo)) notFound();
  if (owner !== owner.toLowerCase() || repo !== repo.toLowerCase()) redirect(analysisHref(owner, repo, id));
  const store = getStore();
  const found = await orUnavailable(
    (async () => {
      const repository = await store.getRepository(owner, repo);
      const analysis = repository && (await store.getAnalysis(repository.owner, repository.name, id));
      if (!repository || !analysis) return null;
      const result = analysis.status === "succeeded" ? await store.getResult(analysis.id) : null;
      // 대기 중이면 대기열의 몇 번째인지(DB 에서 센 것). 합성은 대기열이 없다(null).
      const place = analysis.status === "queued" ? placeOf(await store.queue(), analysis.id) : null;
      return { repository, analysis, result, place };
    })(),
  );
  if (!found.ok) {
    return (
      <div className="page-wide an-page">
        <h1>분석 {id}</h1>
        <p className="notice notice-warn">{found.message}</p>
      </div>
    );
  }
  if (!found.value) notFound();
  const { repository, analysis, result, place } = found.value;

  // 합성 예시 이름표: 합성 미리보기이거나 가짜 GitHub 일 때(서버 설정. 저장소 기록의 synthetic 이 아니다. 가짜 GitHub 의 저장소는
  // DB 에 실제 저장소처럼 적힌다).
  const tagged = showsSyntheticTag();
  const head = (
    <>
      <AnalysisHeader repository={repository} analysis={analysis} tagged={tagged} />
    </>
  );

  if (analysis.status === "failed") {
    return (
      <div className="page-wide an-page">
        {head}
        <Failed analysis={analysis} />
      </div>
    );
  }
  if (analysis.status !== "succeeded") {
    // 대기·분석 중. 실제 분석은 브라우저 부품이 몇 초마다 다시 읽고 끝나면 이 쪽을 새로 그린다. 합성 예시는 움직이지 않는다.
    return (
      <div className="page-wide an-page">
        {store.synthetic ? (
          <>
            {head}
            <InProgress analysis={analysis} note={PROGRESS_NOTE.synthetic} />
          </>
        ) : (
          <LiveAnalysis repository={repository} analysis={analysis} place={place} tagged={tagged} />
        )}
      </div>
    );
  }

  // 끝난 분석: 결과 JSON 을 결과 화면과 같은 파서와 화면 구조로 읽는다. 서버에서 하므로 팩 메타데이터는 브라우저로 가지 않는다.
  const parsed = parseReport(result);
  if (!parsed.ok) {
    return (
      <div className="page-wide an-page">
        {head}
        <p className="notice notice-warn">이 분석의 결과를 읽지 못했습니다. {parsed.errors.slice(0, 3).join(" ")}</p>
      </div>
    );
  }
  const view = buildReportView(parsed.report, parsed.contract, packMeta);
  const code = repository.htmlUrl ? { htmlUrl: repository.htmlUrl, commit: analysis.commit } : null;
  // 정책마다 대표 근거 조문(원문이 있는 첫 조문). 팩 메타데이터의 글을 그대로 옮긴다. 서버가 HTML 에 넣는다.
  // 결과가 다른 판의 팩으로 만들어졌으면 이 사이트의 팩 조문이 그 정책의 근거라고 말할 수 없으므로 싣지 않는다.
  const statutes: Record<string, Statute> = {};
  for (const policy of view.packMatches ? packMeta.policies : []) {
    const ref = policy.legal.find((legal) => legal.text);
    if (ref?.text) statutes[policy.id] = { label: ref.label, text: ref.text };
  }
  // 기록의 "검사한 날"은 검사 단계가 시작한 때다(분석 기록의 값).
  const scannedAt = analysis.steps.find((step) => step.name === "scan")?.startedAt ?? analysis.requestedAt;

  return (
    <div className="page-wide an-page">
      <ReportWithRecord
        view={view}
        pack={packIndex}
        heading={<AnalysisTitle repository={repository} tagged={tagged} />}
        meta={<AnalysisMeta repository={repository} analysis={analysis} />}
        source={{
          name: `${repository.owner}/${repository.name} · 분석 ${analysis.id}`,
          synthetic: tagged,
          analysis: { id: analysis.id, commit: analysis.commit, scannedAt: `${formatKst(scannedAt)} KST` },
        }}
      >
        <AnalysisDashboard
          view={view}
          code={code}
          statutes={statutes}
          progress={
            <details className="lg an-steps">
              <summary>
                진행 기록 <span className="lg-name">{analysis.steps.length}단계</span>
              </summary>
              <div className="lg-body">
                <StepList analysis={analysis} />
              </div>
            </details>
          }
        />
      </ReportWithRecord>
    </div>
  );
}
