import { casesFile, findCase } from "@/lib/cases";
import { caseChecklist } from "@/lib/cases/checklist";
import { markdownResponse } from "@/server/checklist";

// 사례의 의무 체크리스트 마크다운 파일. 빌드할 때 사례마다 만든다(사례 자료는 저장소에 있다).
export const dynamicParams = false;

export function generateStaticParams() {
  return casesFile.cases.map((c) => ({ slug: c.slug }));
}

export async function GET(_request: Request, context: RouteContext<"/api/cases/[slug]/checklist">) {
  const { slug } = await context.params;
  const c = findCase(slug);
  const found = c && caseChecklist(c);
  if (!found) return new Response("그런 사례가 없습니다.", { status: 404 });
  return markdownResponse(found.doc, found.source, "public, max-age=0, must-revalidate");
}
