import { isOwnerName, isRepoName } from "./names";

/**
 * 자동 완성(docs/redesign.md 5장)의 데이터 모양과 순수 함수. 서버(`src/server/api.ts` 의 `getSuggestions`, 저장소 구현)와 브라우저
 * 부품(`components/service/SearchCombobox.tsx`)이 함께 쓴다. 데이터를 불러오지 않는다.
 *
 * 출처는 둘이다.
 *  ① 이 사이트의 DB: 이 사이트에서 분석된 저장소 가운데 `owner/name`(소문자) 안에 친 글자가 그대로 든 것(부분 문자열. 대소문자를
 *    가리지 않는다). 1글자부터. GitHub 을 부르지 않는다.
 *  ② GitHub 검색 API 한 번(`githubSuggestQuery` 가 만든 질의). 3글자 이상이고 영문·숫자가 들어 있고, GitHub 이름에 쓰는 글자
 *    (`A-Z a-z 0-9 . _ -`)와 빗금 하나 말고는 없을 때만. 그 밖의 글자가 있으면 부르지 않는다(다른 한정어를 끼워 넣지 못하게).
 */

/** 자동 완성 질의의 길이 상한(글자). 넘는 것은 자른다. */
export const SUGGEST_MAX_LENGTH = 100;
/** GitHub 을 부르는 최소 길이(글자). */
export const GITHUB_MIN_LENGTH = 3;
/** GitHub 검색 한 번에 받는 저장소 수(`per_page`). */
export const SUGGEST_PAGE_SIZE = 10;
/** 펼침 목록에 보이는 저장소 줄 수 상한(두 출처를 합해). 그 아래에 `‘q’ 전체 검색` 줄이 하나 더 붙는다. */
export const SUGGEST_ROWS = 8;
/** 이 사이트의 줄이 많아도 GitHub 결과가 이만큼은 보이게 남겨 둔다. */
const GITHUB_KEEP = 3;

/** GitHub 쪽의 상태. 펼침 목록의 바닥 줄이 이것으로 "GitHub 에 없음"과 "묻지 못함(까닭)"을 가른다. */
export type GitHubSuggestStatus = "ok" | "limited" | "timeout" | "unavailable" | "off" | "skipped";

/** GitHub 에 묻지 않은 까닭(`skipped`): 너무 짧다, GitHub 이름에 쓸 수 없는 글자가 있다(또는 영문·숫자가 없다). */
export type SkipReason = "short" | "chars";

/** ① 이 사이트에서 분석된 저장소. */
export interface SiteSuggestion {
  owner: string;
  name: string;
  /** 이 사이트의 분석 수. */
  analyses: number;
  /** 가장 나중에 요청한 때(ISO 8601). */
  latestAt: string;
}

/** ② GitHub 검색 결과. 별 수는 싣지 않는다(인기 순위처럼 읽힐 수 있다. docs/commitments.md:23 의 취지). */
export interface GitHubSuggestion {
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
}

export interface GitHubSuggestPart {
  status: GitHubSuggestStatus;
  /** 겹침을 뺀 뒤 보이는 결과. */
  items: GitHubSuggestion[];
  /** GitHub 이 센 맞는 저장소 수(`ok` 일 때만. 보이는 것보다 많을 수 있다). */
  total: number | null;
  /** `skipped` 일 때 그 까닭. */
  skipped?: SkipReason;
}

/** `GET /api/repos/suggest/?q=` 의 응답(늘 200). */
export interface SuggestResponse {
  /** 다듬은 질의(`cleanSuggestText`). */
  q: string;
  /** ① 이 사이트에서 분석된 저장소. DB 를 읽지 못했으면 null. */
  site: SiteSuggestion[] | null;
  /** ② GitHub. `scope=site`(이 사이트만 먼저 묻는 요청)이면 null. */
  github: GitHubSuggestPart | null;
  /** 합성 예시 이름표를 다는지(서버가 `showsSyntheticTag` 로 정한다). */
  tagged: boolean;
  /** 로컬 가짜 GitHub 에 묻는 사이트인지(안내 줄). */
  fakeGitHub: boolean;
}

/**
 * 받은 질의를 다듬는다: 제어 문자와 보이지 않는 서식 문자를 빼고, 빈칸을 하나로, 앞뒤를 자르고, 빗금 둘레의 빈칸을 뗀다
 * (`example-org / kids` 처럼 화면에 보이는 대로 쳐도 `example-org/kids`). 길이는 `SUGGEST_MAX_LENGTH` 까지.
 */
export function cleanSuggestText(raw: string | null | undefined): string {
  if (!raw) return "";
  const visible = Array.from(raw)
    .filter((char) => !isInvisible(char.codePointAt(0)!))
    .join("");
  return Array.from(visible.replace(/\s+/g, " ").trim().replace(/\s*\/\s*/g, "/"))
    .slice(0, SUGGEST_MAX_LENGTH)
    .join("")
    .trim();
}

/** 제어 문자(C0·C1, 탭과 줄바꿈 제외)와 보이지 않는 서식 문자(폭 없는 빈칸, 방향 바꾸기, BOM). 탭·줄바꿈은 빈칸으로 바뀐다. */
function isInvisible(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/**
 * GitHub 검색 질의의 꼴.
 * - `name`: `접두 in:name is:public`(빗금 없음)
 * - `user`: `user:owner 접두 in:name is:public`(`owner/접두`. 접두가 비면 `user:owner is:public`)
 * - `repo`: `repo:owner/name is:public`(`owner/name` 의 이름이 `.` `_` `-` 로 시작할 때. 아래)
 */
export type GitHubQueryForm = "name" | "user" | "repo";

export interface GitHubSuggestQuery {
  form: GitHubQueryForm;
  /** `user`·`repo` 꼴의 owner(소문자). */
  owner: string | null;
  /** 이름에서 찾는 글자(소문자. `repo` 꼴은 이름 전체). */
  term: string;
  /** GitHub 에 보내는 `q`. */
  q: string;
}

export type GitHubEligibility = { ok: true; query: GitHubSuggestQuery } | { ok: false; reason: SkipReason };

/** GitHub 이름에 쓰는 글자와 빗금. 이것 밖의 글자(빈칸, 쌍점, 따옴표, 한글 등)가 하나라도 있으면 GitHub 에 묻지 않는다. */
const ALLOWED = /^[A-Za-z0-9._/-]+$/;

/**
 * 친 글자(`cleanSuggestText` 를 지난 것)로 GitHub 검색 질의를 만든다. 묻지 않을 것이면 그 까닭이다. 순수 함수다(tests/suggest.test.ts).
 *
 * `owner/name` 과 `owner/접두` 는 꼴이 같다(치는 동안에는 이름이 끝났는지 알 수 없다). 그래서 `user:owner 접두 in:name` 하나로
 * 묻는다. 이름 전체를 친 저장소도 이 질의의 결과에 든다(GitHub 은 이름이 같은 것을 앞에 둔다). `repo:owner/name` 은 이름이
 * `.` `_` `-` 로 시작할 때만 쓴다(`owner/.github` 처럼. 이런 이름은 `in:name` 의 낱말로 잡히지 않고, `-` 로 시작하는 낱말은
 * GitHub 이 '빼기'로 읽는다). 모든 꼴에 `is:public` 을 붙인다(토큰이 볼 수 있는 비공개 저장소가 섞이지 않게).
 */
export function githubSuggestQuery(typed: string): GitHubEligibility {
  if (Array.from(typed).length < GITHUB_MIN_LENGTH) return { ok: false, reason: "short" };
  if (!ALLOWED.test(typed) || !/[A-Za-z0-9]/.test(typed)) return { ok: false, reason: "chars" };
  // 소문자로 묻는다. GitHub 은 대문자 NOT·AND·OR 를 연산자로 읽는다(소문자는 보통 낱말). 이름·user:·repo: 는 대소문자를 가리지 않는다.
  const text = typed.toLowerCase();
  const slash = text.indexOf("/");
  if (slash === -1) {
    // '-' 로 시작하는 낱말은 GitHub 이 그 낱말을 뺀다(NOT). 이름 검색에서는 묻지 않는다.
    if (text.startsWith("-")) return { ok: false, reason: "chars" };
    return { ok: true, query: { form: "name", owner: null, term: text, q: `${text} in:name is:public` } };
  }
  if (text.indexOf("/", slash + 1) !== -1) return { ok: false, reason: "chars" };
  const owner = text.slice(0, slash);
  const rest = text.slice(slash + 1);
  if (!isOwnerName(owner)) return { ok: false, reason: "chars" };
  if (rest === "") return { ok: true, query: { form: "user", owner, term: "", q: `user:${owner} is:public` } };
  if (/^[._-]/.test(rest)) {
    if (!isRepoName(rest)) return { ok: false, reason: "chars" };
    return { ok: true, query: { form: "repo", owner, term: rest, q: `repo:${owner}/${rest} is:public` } };
  }
  return { ok: true, query: { form: "user", owner, term: rest, q: `user:${owner} ${rest} in:name is:public` } };
}

/**
 * 앞서 받은 결과(`previous`)를 새 질의(`next`)에 걸러 다시 쓸 수 있는지. 모두 맞아야 한다.
 * - 앞 결과가 모두였다(GitHub 이 센 수가 받은 수보다 많지 않다). 꼴과 owner 가 같다. `repo` 꼴(저장소 하나)은 다시 쓰지 않는다.
 * - 새 질의가 앞 질의의 글자를 늘인 것이고, 새 글자가 영문·숫자뿐이다. `-` `.` `_` 가 들면 GitHub 은 그 자리에서 낱말을 나눠
 *   찾으므로(`hello-` 가 `hello_world` 에 맞는다) 글자 그대로 거르는 규칙과 어긋난다.
 * - 앞 결과의 이름(`names`)이 모두 앞 질의의 글자를 품었다. 아니면 GitHub 이 이름 밖의 것(owner 등)으로도 맞췄다는 뜻이라 이름으로
 *   거르면 GitHub 이 돌려줄 저장소를 숨긴다("GitHub 에 없음"이 거짓이 된다).
 */
export function canReuse(previous: GitHubSuggestQuery, complete: boolean, next: GitHubSuggestQuery, names: readonly string[]): boolean {
  if (!complete || previous.form !== next.form || previous.form === "repo") return false;
  if ((previous.owner ?? "").toLowerCase() !== (next.owner ?? "").toLowerCase()) return false;
  const before = previous.term.toLowerCase();
  const after = next.term.toLowerCase();
  if (!(after.length > before.length && after.startsWith(before)) || !/^[a-z0-9]+$/.test(after)) return false;
  return names.every((name) => name.toLowerCase().includes(before));
}

/**
 * 다시 쓸 때 거르는 규칙: 이름(소문자)에 새 질의의 글자가 그대로 든 것만 남긴다. GitHub 의 `in:name` 은 이름의 낱말 머리로 찾아
 * 이 규칙보다 좁다. 그래서 남는 것은 앞 질의(더 짧은 글자)의 결과 안에서 이 글자를 품은 것뿐이다(앞 결과에 없던 저장소를
 * 꾸며 넣지 않는다). 숨기지 않는다는 것은 `canReuse` 의 조건(영문·숫자만 늘임, 앞 결과가 모두 이름으로 맞음)이 지킨다.
 */
export function reuseFilter<T extends { name: string }>(items: readonly T[], next: GitHubSuggestQuery): T[] {
  const term = next.term.toLowerCase();
  return items.filter((item) => item.name.toLowerCase().includes(term));
}

const keyOf = (owner: string, name: string) => `${owner}/${name}`.toLowerCase();

/**
 * 두 출처를 합친다: 같은 저장소(owner/name, 대소문자 없이)는 이 사이트의 줄만 남기고, 모두 합해 `SUGGEST_ROWS` 줄까지. 이 사이트의
 * 줄이 앞이다. 다만 이 사이트의 줄이 많아도 GitHub 결과는 `GITHUB_KEEP` 줄까지 남긴다(GitHub 쪽이 통째로 가려지지 않게).
 * 차례는 받은 그대로다(점수를 매겨 늘어놓지 않는다).
 */
export function mergeSuggestions(
  site: readonly SiteSuggestion[],
  github: readonly GitHubSuggestion[],
  limit = SUGGEST_ROWS,
): { site: SiteSuggestion[]; github: GitHubSuggestion[] } {
  const seen = new Set(site.map((row) => keyOf(row.owner, row.name)));
  const fresh: GitHubSuggestion[] = [];
  for (const row of github) {
    const key = keyOf(row.owner, row.name);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(row);
  }
  const siteShown = site.slice(0, Math.max(0, limit - Math.min(fresh.length, GITHUB_KEEP)));
  return { site: siteShown, github: fresh.slice(0, limit - siteShown.length) };
}

/**
 * 펼침 목록 바닥과 검색 0건 화면에 적는 GitHub 의 상태 한 줄. 결과가 보이면(ok, 하나 이상) 적지 않는다. "GitHub 에 없음"과
 * "GitHub 에 묻지 못함(까닭)"을 가른다(조용히 이 사이트의 것만 보이지 않는다).
 */
export function githubStatusLine(part: Pick<GitHubSuggestPart, "status" | "total" | "skipped">): string | null {
  switch (part.status) {
    case "ok":
      return part.total === 0 ? "GitHub 에 없음" : null;
    case "limited":
      return "GitHub 에 묻지 못함(요청 수 상한)";
    case "timeout":
      return "GitHub 에 묻지 못함(시간 초과)";
    case "unavailable":
      return "GitHub 에 묻지 못함(연결 실패)";
    case "off":
      return "GitHub 에 묻지 않음(합성 미리보기)";
    case "skipped":
      return part.skipped === "short" ? `GitHub 에 묻지 않음(${GITHUB_MIN_LENGTH}글자 미만)` : "GitHub 에 묻지 않음(이름에 쓰지 않는 글자)";
  }
}

/** 로컬 가짜 GitHub 에 묻는 사이트의 안내 줄(저장소 수는 적지 않는다. 가짜 GitHub 이 정한다). */
export const FAKE_GITHUB_NOTE = "로컬 가짜 GitHub: 합성 저장소만 찾습니다.";

/**
 * 이름에서 친 글자가 든 자리. `owner/name` 을 소문자로 견준다(부분 문자열, 처음 한 곳). 없으면 null. 화면은 이 자리를 owner,
 * 빗금, name 조각에 나눠 굵게 적는다(글은 데이터 그대로이고 HTML 로 끼워 넣지 않는다).
 */
export function matchRange(owner: string, name: string, text: string): [number, number] | null {
  const needle = text.toLowerCase();
  if (needle === "") return null;
  const at = `${owner}/${name}`.toLowerCase().indexOf(needle);
  return at === -1 ? null : [at, at + needle.length];
}
