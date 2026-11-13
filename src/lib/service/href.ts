/**
 * 분석 서비스의 주소. 데이터를 불러오지 않는 파일이라 브라우저에서 도는 부품(검색)도 쓴다.
 *
 * 저장소 주소는 `/r/{owner}/{repo}/` 이고 owner·repo 를 소문자로 적는다. GitHub 은 저장소 이름의 대소문자를 가리지 않으므로,
 * 같은 저장소가 대소문자만 다른 주소 둘을 갖지 않게 한다. 화면에는 GitHub 이 돌려준 대소문자를 적는다.
 *
 * 점: GitHub 의 저장소 이름에는 점이 들 수 있다(owner 에는 들 수 없다). 점이 든 마지막 조각은 Next 가 파일 이름으로 보고 링크의
 * 끝 슬래시를 떼어, 정적 호스팅에서는 열리지 않는다(조문 도감이 정책 id 의 점을 빼기표로 바꾸는 까닭. `lib/pack/href.ts`).
 * 저장소 이름은 빼기표도 쓰므로 바꾸면 두 이름이 한 주소로 겹친다. 그래서 바꾸지 않는다. B1 의 합성 저장소 이름에는 점을 넣지
 * 않고(tests/service.test.ts), B2 에서는 서버가 동적으로 그리므로 끝 슬래시가 없어도 같은 쪽이 열린다. 분석 쪽 주소의 마지막
 * 조각은 분석 id 라 점이 없다. 자세한 것은 docs/architecture.md 의 "분석 서비스(B1)".
 */

export function repoKey(owner: string, name: string): string {
  return `${owner.toLowerCase()}/${name.toLowerCase()}`;
}

export function repoHref(owner: string, name: string): string {
  return `/r/${encodeURIComponent(owner.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}/`;
}

export function analysisHref(owner: string, name: string, id: string): string {
  return `${repoHref(owner, name)}a/${encodeURIComponent(id)}/`;
}

/** 끝난 분석의 의무 체크리스트 인쇄용 보기(2026-11-13). */
export function checklistHref(owner: string, name: string, id: string): string {
  return `${analysisHref(owner, name, id)}checklist/`;
}

/** 끝난 분석의 의무 체크리스트 마크다운 파일(같은 사이트의 `/api/`). */
export function checklistMarkdownHref(id: string): string {
  return `/api/analyses/${encodeURIComponent(id)}/checklist/`;
}

export function searchHref(query: string): string {
  return query === "" ? "/search/" : `/search/?q=${encodeURIComponent(query)}`;
}

/** 커밋 해시를 화면에 짧게 적는다(앞 7자리. GitHub 과 같다). */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

/**
 * GitHub 의 커밋 고정 링크. 저장소 주소(`Repository.htmlUrl`)가 없으면(합성 저장소) null 이다. 브랜치 이름이 아니라 커밋으로
 * 고정하므로, 저장소가 바뀌어도 분석한 그때의 코드로 간다.
 */
export function commitLink(htmlUrl: string | null, commit: string): string | null {
  return htmlUrl ? `${htmlUrl}/commit/${commit}` : null;
}

/** 파일·줄의 커밋 고정 링크. 줄이 없으면 파일로 간다. 경로의 조각마다 주소에 맞게 바꾼다. */
export function fileLink(htmlUrl: string | null, commit: string, file: string, line: number | null): string | null {
  if (!htmlUrl) return null;
  const path = file.split("/").map(encodeURIComponent).join("/");
  return `${htmlUrl}/blob/${commit}/${path}${line === null ? "" : `#L${line}`}`;
}
