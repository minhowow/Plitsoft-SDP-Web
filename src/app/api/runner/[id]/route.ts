import { postRunnerEvent } from "@/server/api";

// 실행기 콜백(설계 6): 서명한 요청만 받는다. 일은 src/server/api.ts 와 src/server/callbacks.ts 가 한다.
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext<"/api/runner/[id]">) {
  const { id } = await context.params;
  return postRunnerEvent(request, id);
}
