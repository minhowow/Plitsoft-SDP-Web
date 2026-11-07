import { repoKey } from "./href";
import type { Analysis } from "./types";

/**
 * 첫 화면·검색 쪽의 "최근 분석": 저장소마다 한 줄. 그 저장소에 대기·분석 중인 분석이 있으면 그것(여럿이면 나중에 요청한 것),
 * 없으면 가장 나중에 요청한 분석이다. 줄은 그 분석을 요청한 때의 차례(나중 것이 앞)다. 저장소는 소문자 열쇠(`repoKey`)로 가른다.
 *
 * 합성 저장소가 이 함수를 쓰고, 운영 저장소(`src/server/store/db.ts`)는 같은 규칙을 SQL 로 한다(tests/server-store.test.ts 가
 * 둘을 같은 경우로 견준다).
 */
export interface PickedActivity {
  analysis: Analysis;
  /** 그 저장소의 분석 수. */
  analyses: number;
  /** 그 저장소에서 가장 나중에 요청한 때(보이는 분석이 진행 중인 앞의 것이어도). */
  latestAt: string;
}

const active = (analysis: Analysis) => analysis.status === "queued" || analysis.status === "running";
const newestFirst = (a: Analysis, b: Analysis) => b.requestedAt.localeCompare(a.requestedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function pickActivity(analyses: readonly Analysis[], limit: number): PickedActivity[] {
  const byRepo = new Map<string, Analysis[]>();
  for (const analysis of [...analyses].sort(newestFirst)) {
    const key = repoKey(analysis.owner, analysis.name);
    const list = byRepo.get(key) ?? [];
    list.push(analysis);
    byRepo.set(key, list);
  }
  return [...byRepo.values()]
    .map((list) => ({ analysis: list.find(active) ?? list[0], analyses: list.length, latestAt: list[0].requestedAt }))
    .sort((a, b) => newestFirst(a.analysis, b.analysis))
    .slice(0, Math.max(0, limit));
}
