import "server-only";
import { syntheticStore } from "@/lib/service/synthetic";
import type { ServiceStore } from "@/lib/service/types";
import { createSharedBudget } from "../budget";
import { readConfig } from "../config";
import { getDatabase } from "../db";
import { createGitHub, type GitHubClient } from "../github";
import { createDbStore } from "./db";

/**
 * 쪽과 route handler 가 읽는 저장소 구현을 고른다. 부를 때마다 환경 변수를 읽는다.
 * - SERVICE_STORE=synthetic: 합성 저장소(미리보기·시험용. 쪽마다 "합성 예시"를 밝힌다).
 * - 그 밖(기본): DB(DATABASE_URL 이 있으면 Postgres, 없으면 PGlite) + GitHub API(GITHUB_API_BASE).
 *
 * GitHub 클라이언트는 짧은 캐시를 지니므로 설정(바탕 주소·토큰·캐시 시간)이 같으면 하나를 다시 쓴다. GitHub 을 부르는 수의
 * 예산은 DB 의 카운터라 서버 인스턴스가 함께 쓴다(`../budget.ts`). 캐시는 인스턴스마다다.
 */
const CLIENT = Symbol.for("plitsoft.github");
type Holder = { [CLIENT]?: { key: string; client: GitHubClient } };

function github(config: ReturnType<typeof readConfig>["github"]): GitHubClient {
  const holder = globalThis as Holder;
  const key = JSON.stringify(config);
  if (holder[CLIENT]?.key !== key) {
    const budget = createSharedBudget({ db: getDatabase, searchPerMinute: config.searchPerMinute, callsPerMinute: config.callsPerMinute });
    holder[CLIENT] = { key, client: createGitHub({ ...config, budget }) };
  }
  return holder[CLIENT].client;
}

export function getStore(): ServiceStore {
  const config = readConfig();
  if (config.store === "synthetic") return syntheticStore;
  return createDbStore({ db: getDatabase, github: github(config.github), config });
}
