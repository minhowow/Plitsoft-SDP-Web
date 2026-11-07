import type { Metadata } from "next";
import { SearchHome, SearchResults, type LoadedActivity } from "@/components/service/SearchResults";
import { orUnavailable } from "@/lib/service/errors";
import { MAX_QUERY_LENGTH } from "@/lib/service/names";
import type { SearchOutcome, ServiceStore } from "@/lib/service/types";
import { readConfig, showsSyntheticTag, usesFakeGitHub } from "@/server/config";
import { getStore } from "@/server/store";

export const metadata: Metadata = { title: "저장소 검색" };

// 질의마다 서버가 찾는다(요청 때 그린다).
export const dynamic = "force-dynamic";

/** 빈 검색 쪽의 최근 분석 줄 수. */
const RECENT_ROWS = 8;
/** 검색 0건 아래에 보이는 이 사이트의 분석된 저장소 수. */
const ANALYZED_ROWS = 20;

/** 이 사이트의 최근 분석(저장소마다 한 줄)과 끝난 분석의 발견 수. DB 에 닿지 못하면 그 까닭. */
async function activity(store: ServiceStore, limit: number): Promise<LoadedActivity> {
  const loaded = await orUnavailable(
    (async () => {
      const rows = await store.recentActivity(limit);
      const findings = await store.findingCounts(rows.filter(({ analysis }) => analysis.status === "succeeded").map(({ analysis }) => analysis.id));
      return { rows, findings };
    })(),
  );
  return loaded.ok ? { ok: true, ...loaded.value } : loaded;
}

/**
 * 검색 쪽. 질의가 없으면 도구 화면의 시작(검색창, 최근 분석, 검사하는 정책. 머리글의 이름이 여기로 온다), 있으면 서버가 `?q=` 로
 * 저장소를 찾아 그린다. 운영은 GitHub 검색(서버가 부르고 짧게 캐시한다), 합성 미리보기는 합성 목록.
 */
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const raw = (await searchParams).q;
  const query = (Array.isArray(raw) ? raw[0] : raw ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const store = getStore();
  const config = readConfig();
  const tagged = showsSyntheticTag(config);

  if (query === "") {
    return (
      <>
        <h1 className="visually-hidden">저장소 검색</h1>
        <SearchHome recent={await activity(store, RECENT_ROWS)} tagged={tagged} />
      </>
    );
  }

  const searched = await orUnavailable(store.search(query));
  const outcome: SearchOutcome = searched.ok ? searched.value : searched;
  const analyzed = !outcome.ok || outcome.hits.length === 0 ? await activity(store, ANALYZED_ROWS) : null;
  return (
    <SearchResults
      query={query}
      outcome={outcome}
      tagged={tagged}
      fakeGitHub={config.store === "db" && usesFakeGitHub(config)}
      github={config.store === "db"}
      analyzed={analyzed}
    />
  );
}
