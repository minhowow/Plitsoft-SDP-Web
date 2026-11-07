import type { Metadata } from "next";
import { SearchResults } from "@/components/service/SearchResults";
import { orUnavailable } from "@/lib/service/errors";
import { MAX_QUERY_LENGTH } from "@/lib/service/names";
import type { SearchOutcome } from "@/lib/service/types";
import { getStore } from "@/server/store";

export const metadata: Metadata = { title: "저장소 검색" };

// 질의마다 서버가 찾는다(요청 때 그린다).
export const dynamic = "force-dynamic";

/** 검색 쪽. 서버가 `?q=` 로 저장소를 찾아 그린다. 운영은 GitHub 검색(서버가 부르고 짧게 캐시한다), 합성 미리보기는 합성 목록. */
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const raw = (await searchParams).q;
  const query = (Array.isArray(raw) ? raw[0] : raw ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const store = getStore();
  let outcome: SearchOutcome | null = null;
  if (query !== "") {
    const searched = await orUnavailable(store.search(query));
    outcome = searched.ok ? searched.value : searched;
  }
  return (
    <>
      <h1>저장소 검색</h1>
      <SearchResults query={query} outcome={outcome} synthetic={store.synthetic} />
    </>
  );
}
