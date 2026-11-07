import type { SearchOutcome } from "@/lib/service/types";
import { RepoRow } from "./parts";
import { SearchForm } from "./SearchForm";

/**
 * 되뇌는 검색어 ‘…’에. 검색어는 주소(`?q=`)에서 오는 남의 글이라 빈칸 없이 길 수 있다. 통째로 줄을 바꾸지 않는 조각
 * (`keepParticles` 의 `.nobreak`)으로 묶으면 좁은 화면에서 가로로 넘친다(검토 1: 375px 에서 60자가 434px). 그래서 검색어는
 * 아무 데서나 줄이 바뀌게 두고(`.search-q`), 마지막 글자와 닫는 따옴표·조사(’에)만 묶는다(조사가 줄 머리로 떨어지지 않게).
 * 글자는 그대로다.
 */
function EchoedQuery({ query }: { query: string }) {
  const chars = Array.from(query);
  const last = chars.pop() ?? "";
  return (
    <>
      ‘<span className="search-q">{chars.join("")}</span>
      <span className="nobreak">{last}’에</span>
    </>
  );
}

/**
 * 검색 쪽의 본문. 서버가 질의(`?q=`)로 저장소를 찾아 그린다(운영: GitHub 검색, 합성 미리보기: 합성 목록). 검색창은 보통의 GET
 * 양식이라 엔터나 단추로 `/search/?q=…` 로 간다. 치는 동안 찾지 않는다(GitHub 을 글자마다 부르지 않는다).
 */
export function SearchResults({ query, outcome, synthetic }: { query: string; outcome: SearchOutcome | null; synthetic: boolean }) {
  return (
    <div className="search-page">
      <SearchForm id="search-page-q" label="저장소 검색(이 쪽)" defaultValue={query} />
      {outcome === null ? (
        <p className="search-count">
          {synthetic
            ? "찾을 저장소의 이름이나 설명을 넣으세요. 이 미리보기에는 합성 예시 저장소만 있습니다(예: kids-signup, genai, example-labs)."
            : "찾을 GitHub 공개 저장소의 이름이나 설명을 넣으세요."}
        </p>
      ) : !outcome.ok ? (
        <p className="notice notice-warn" role="status">
          검색하지 못했습니다. {outcome.message}
        </p>
      ) : (
        <>
          <p className="search-count" role="status">
            <EchoedQuery query={query} />
            {outcome.total > outcome.hits.length
              ? ` 맞는 저장소 ${outcome.total.toLocaleString("en-US")}개 가운데 ${outcome.hits.length}개`
              : ` 맞는 저장소 ${outcome.hits.length}개`}
          </p>
          {outcome.hits.length > 0 ? (
            <ul className="repo-list" aria-label="검색 결과">
              {outcome.hits.map((hit) => (
                <RepoRow key={`${hit.repository.owner}/${hit.repository.name}`} hit={hit} />
              ))}
            </ul>
          ) : (
            <p className="notice">
              맞는 저장소가 없습니다.{" "}
              {synthetic ? "이 미리보기는 합성 예시 저장소만 찾습니다." : "공개 저장소만 찾습니다. 이름을 owner/repo 로 넣어 보세요."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
