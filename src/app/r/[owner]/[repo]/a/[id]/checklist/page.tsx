import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChecklistSheet } from "@/components/review/ChecklistSheet";
import { orUnavailable } from "@/lib/service/errors";
import { analysisHref, checklistMarkdownHref, repoKey } from "@/lib/service/href";
import { isAnalysisId } from "@/lib/service/id";
import { isRepoFullName } from "@/lib/service/names";
import { analysisChecklist } from "@/server/checklist";

// 분석의 review 결과(DB)를 요청 때 읽는다.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/r/[owner]/[repo]/a/[id]/checklist">): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `의무 체크리스트 · ${owner}/${repo}` };
}

/** 끝난 분석의 의무 체크리스트 인쇄용 보기(2026-11-13 오너 지시). review 결과가 없는 분석에는 없다. */
export default async function AnalysisChecklistPage({ params }: PageProps<"/r/[owner]/[repo]/a/[id]/checklist">) {
  const { owner, repo, id } = await params;
  if (!isAnalysisId(id) || !isRepoFullName(owner, repo)) notFound();
  const found = await orUnavailable(analysisChecklist(id));
  if (!found.ok) return <p className="notice notice-warn">{found.message}</p>;
  if (!found.value || repoKey(found.value.analysis.owner, found.value.analysis.name) !== repoKey(owner, repo)) notFound();
  const { analysis, doc, source } = found.value;
  return <ChecklistSheet doc={doc} source={source} back={analysisHref(analysis.owner, analysis.name, analysis.id)} markdown={checklistMarkdownHref(analysis.id)} />;
}
