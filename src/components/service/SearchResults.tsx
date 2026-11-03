"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { searchHref } from "@/lib/service/href";
import { matchRepositories } from "@/lib/service/search";
import type { RepositoryHit } from "@/lib/service/types";
import { keepParticles } from "@/components/text";
import { RepoRow } from "./parts";
import { SearchForm } from "./SearchForm";

/**
 * 검색 쪽의 본문. 정적 쪽이라 질의(`?q=`)는 브라우저에서 읽고, 쪽이 넘겨준 합성 저장소 목록을 브라우저에서 거른다.
 * B2 에서는 서버가 GitHub 검색을 불러 그린다(그때 이 거르기는 없어진다).
 *
 * 검색창에 치는 대로 거르고, 주소의 질의도 바꿔 둔다(`history.replaceState`. 방문 기록을 늘리지 않는다). 그래서 그 주소를
 * 그대로 건네면 같은 결과가 열린다. 엔터나 단추는 양식 그대로 `/search/?q=…` 로 간다.
 */
export function SearchResults({ hits }: { hits: RepositoryHit[] }) {
  const params = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const found = matchRepositories(hits, query);
  const trimmed = query.trim();

  function change(value: string) {
    setQuery(value);
    window.history.replaceState(null, "", searchHref(value.trim()));
  }

  return (
    <div className="search-page">
      <SearchForm id="search-page-q" label="저장소 검색(이 쪽)" big value={query} onChange={change} />
      <p className="search-count" role="status">
        {trimmed === ""
          ? `찾을 저장소의 이름이나 설명을 넣으세요. 지금 있는 합성 예시 저장소는 ${hits.length}개입니다.`
          : keepParticles(`‘${trimmed}’에 맞는 저장소 ${found.length}개`)}
      </p>
      {trimmed === "" ? (
        <ul className="repo-list" aria-label="모든 합성 예시 저장소">
          {hits.map((hit) => (
            <RepoRow key={`${hit.repository.owner}/${hit.repository.name}`} hit={hit} />
          ))}
        </ul>
      ) : found.length > 0 ? (
        <ul className="repo-list" aria-label="검색 결과">
          {found.map((hit) => (
            <RepoRow key={`${hit.repository.owner}/${hit.repository.name}`} hit={hit} />
          ))}
        </ul>
      ) : (
        <p className="notice">
          맞는 저장소가 없습니다. 지금은 합성 예시 저장소만 찾습니다. 서버가 붙으면 GitHub 의 공개 저장소를 찾습니다.
        </p>
      )}
    </div>
  );
}
