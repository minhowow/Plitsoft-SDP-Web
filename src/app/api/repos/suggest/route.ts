import { getSuggestions } from "@/server/api";

// 검색창의 자동 완성(docs/redesign.md 5장). 늘 200, 캐시하지 않는다. 일은 src/server/api.ts 가 한다. 질의와 IP 를 적지 않는다.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return getSuggestions(request);
}
