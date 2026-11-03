import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchForm } from "@/components/service/SearchForm";
import { SearchResults } from "@/components/service/SearchResults";
import { store } from "@/lib/service";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "저장소 검색" };

/**
 * 검색 쪽. 정적 쪽이라 질의는 브라우저가 읽는다(`SearchResults`). 빌드할 때 합성 저장소 목록을 넘겨 두고 브라우저에서 거른다.
 * B2 에서는 서버가 질의를 받아 GitHub 검색을 부르고 그 결과를 그린다.
 */
export default async function SearchPage() {
  const hits = await store.listRepositories();
  return (
    <>
      <h1>저장소 검색</h1>
      <p className="lede">
        저장소를 찾아 들어가면 그 저장소의 분석을 봅니다. {store.synthetic && "지금은 합성 예시 저장소만 찾습니다."}
      </p>
      {/* 질의를 읽기 전(스크립트가 붙기 전)에는 빈 검색창을 그려 둔다. 양식이라 스크립트 없이도 듣는다. */}
      <Suspense
        fallback={
          <div className="search-page">
            <SearchForm id="search-page-q" label="저장소 검색(이 쪽)" big />
            <p className="search-count">{SITE.service.searchPlaceholder}</p>
          </div>
        }
      >
        <SearchResults hits={hits} />
      </Suspense>
    </>
  );
}
