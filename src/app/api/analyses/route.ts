import { postAnalysis } from "@/server/api";

// 분석 요청(설계 5). 일은 src/server/api.ts 가 한다.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return postAnalysis(request);
}
