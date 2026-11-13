import { getChecklistMarkdown } from "@/server/checklist";

// 끝난 분석의 의무 체크리스트 마크다운 파일. 요청 때 DB 에서 읽는다.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/analyses/[id]/checklist">) {
  const { id } = await context.params;
  return getChecklistMarkdown(id);
}
