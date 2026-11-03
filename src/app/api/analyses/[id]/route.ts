import { getAnalysis } from "@/server/api";

// 분석 하나의 진행(진행 중인 분석 쪽이 몇 초마다 읽는다). 캐시하지 않는다.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: RouteContext<"/api/analyses/[id]">) {
  const { id } = await context.params;
  return getAnalysis(id);
}
