/**
 * GitHub 의 계정·저장소 이름 검사. 서버가 GitHub 을 부르기 전과 주소를 받을 때 쓴다(데이터를 불러오지 않아 어디서든 쓴다).
 *
 * 이름 규칙(GitHub): 계정은 영숫자와 빼기표로 39자까지, 저장소는 영숫자·빼기표·밑줄·점으로 100자까지다. 계정에 밑줄이 드는
 * 경우(기업 관리 계정)가 있어 계정에도 밑줄을 받는다. 그 밖의 글자(빗금, 빈칸, 물음표, 퍼센트 등)는 받지 않는다. 그래서 이
 * 검사를 지난 이름은 GitHub API 주소에 그대로 넣어도 경로를 벗어나지 못한다. 저장소 이름 `.` 과 `..` 은 받지 않는다.
 */

const OWNER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export function isOwnerName(value: string): boolean {
  return OWNER.test(value);
}

export function isRepoName(value: string): boolean {
  return REPO.test(value) && value !== "." && value !== "..";
}

export function isRepoFullName(owner: string, repo: string): boolean {
  return isOwnerName(owner) && isRepoName(repo);
}

/** 검색어의 길이 상한. GitHub 검색은 256자를 넘는 질의를 받지 않는다. */
export const MAX_QUERY_LENGTH = 256;
