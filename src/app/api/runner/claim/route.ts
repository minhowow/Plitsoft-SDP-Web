import { postRunnerClaim } from "@/server/api";

// 로컬 실행기(RUNNER=local, scripts/local-runner.mjs)가 대기 중인 분석을 집어 간다. 서명한 요청만 받는다.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return postRunnerClaim(request);
}
