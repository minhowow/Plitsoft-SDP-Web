import "server-only";
import type { Database } from "./db";
import { localBudget, searchReserveOf, type BudgetBucket } from "./github";

/**
 * GitHub 을 부르는 수의 예산을 서버 인스턴스가 함께 쓴다(2026-11-03. 전에는 인스턴스마다 메모리의 토큰 통이라, Vercel 이 함수
 * 인스턴스를 여럿 띄우면 예산도 그만큼 늘었다).
 *
 * DB 의 작은 표 `github_budget(bucket, window_start, used)` 에 1분 창마다 쓴 수를 센다(`003_queue.sql`). 하나를 꺼낼 때
 * `INSERT … ON CONFLICT DO UPDATE SET used = used + 1 WHERE used < 상한 RETURNING used` 한 문으로 세고 막으므로, 여러 인스턴스가
 * 동시에 꺼내도 한 창에서 상한을 넘지 않는다. 고정된 1분 창이라 창의 끝과 다음 창의 처음에 몰리면 2분 사이에 상한의 두 배까지
 * 부를 수 있다(토큰 통처럼 고르게 차지는 않는다). 요청한 사람에 관한 것은 적지 않는다.
 *
 * 자동 완성(`suggest`)은 검색과 같은 행(`search`)을 세되, 그 창에서 쓴 수가 `상한 - 검색 쪽 몫(GITHUB_SEARCH_RESERVE)` 보다 적을
 * 때만 꺼낸다. 같은 한 문의 `WHERE used < $3` 에 더 낮은 수를 넘길 뿐이라, 자동 완성이 몰려도 검색 쪽(`/search`)은 남겨 둔 수만큼
 * 꺼낼 수 있다(검색 쪽은 상한까지 꺼낸다).
 *
 * 새 창을 열 때 한 시간보다 오래된 창을 지운다. DB 에 닿지 못하면 이 서버 메모리의 토큰 통으로 센다(그때 예산은 인스턴스마다다).
 * 캐시는 그대로 인스턴스마다다(`github.ts`).
 */

export interface SharedBudgetOptions {
  db: () => Promise<Database>;
  searchPerMinute: number;
  /** 검색 쪽 몫(자동 완성이 남기는 수). 상한보다 작게 줄인다. 없으면 3. */
  searchReserve?: number;
  callsPerMinute: number;
  now?: () => number;
}

export function windowStart(at: number): Date {
  return new Date(Math.floor(at / 60_000) * 60_000);
}

export function createSharedBudget(options: SharedBudgetOptions): (bucket: BudgetBucket) => Promise<boolean> {
  const now = options.now ?? Date.now;
  const fallback = localBudget(options, now);
  const reserve = searchReserveOf(options);
  const limit = { search: options.searchPerMinute, suggest: options.searchPerMinute - reserve, core: options.callsPerMinute };
  // 자동 완성은 검색과 같은 행을 센다.
  const row = { search: "search", suggest: "search", core: "core" } as const;
  return async (bucket) => {
    const at = now();
    const window = windowStart(at);
    let used: number | undefined;
    try {
      const db = await options.db();
      const rows = await db.query<{ used: number }>(
        `INSERT INTO github_budget (bucket, window_start, used) VALUES ($1, $2, 1)
         ON CONFLICT (bucket, window_start) DO UPDATE SET used = github_budget.used + 1
         WHERE github_budget.used < $3
         RETURNING used`,
        [row[bucket], window, limit[bucket]],
      );
      used = rows.rows[0]?.used;
      if (used === 1) {
        await db.query("DELETE FROM github_budget WHERE window_start < $1", [new Date(window.getTime() - 60 * 60_000)]);
      }
    } catch (error) {
      console.error(`[github] 함께 쓰는 예산을 읽지 못해 이 서버의 예산으로 셉니다 (${error instanceof Error ? error.name : "오류"})`);
      return fallback(bucket);
    }
    return used !== undefined;
  };
}
