import type { RepositoryHit } from "./types";

/**
 * 저장소 목록을 질의로 거른다. B1 의 합성 저장소와 브라우저의 검색 쪽이 함께 쓴다(B2 에서는 서버가 GitHub 검색을 부른다).
 *
 * 질의를 빈칸으로 나눈 낱말이 모두 "owner/name 설명 언어" 안에 들어 있으면 맞는다. 대소문자를 가리지 않는다. 빈 질의는 빈
 * 목록이다(무엇을 찾는지 모르면 늘어놓지 않는다). 순서는 받은 차례 그대로다. 점수를 매겨 늘어놓지 않는다.
 */
export function matchRepositories(hits: readonly RepositoryHit[], query: string): RepositoryHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return hits.filter(({ repository }) => {
    const text = [`${repository.owner}/${repository.name}`, repository.description ?? "", repository.language ?? ""]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
