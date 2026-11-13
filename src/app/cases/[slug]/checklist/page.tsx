import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChecklistSheet } from "@/components/review/ChecklistSheet";
import { caseChecklistMarkdownHref, casesFile, casesHref, findCase } from "@/lib/cases";
import { caseChecklist } from "@/lib/cases/checklist";

type Params = { params: Promise<{ slug: string }> };

// 빌드할 때 아는 사례만 쪽이 된다.
export const dynamicParams = false;

export function generateStaticParams() {
  return casesFile.cases.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const c = findCase(slug);
  return { title: c ? `의무 체크리스트 · ${c.owner}/${c.name}` : "의무 체크리스트" };
}

/** 사례의 의무 체크리스트 인쇄용 보기(2026-11-13 오너 지시). */
export default async function CaseChecklistPage({ params }: Params) {
  const { slug } = await params;
  const c = findCase(slug);
  const found = c && caseChecklist(c);
  if (!found) notFound();
  return <ChecklistSheet doc={found.doc} source={found.source} back={casesHref(slug)} markdown={caseChecklistMarkdownHref(slug)} />;
}
