import "server-only";
import { isRepoFullName, MAX_QUERY_LENGTH } from "@/lib/service/names";
import { canReuse, reuseFilter, SUGGEST_PAGE_SIZE, type GitHubSuggestQuery } from "@/lib/service/suggest";
import type { Repository } from "@/lib/service/types";

/**
 * GitHub API 를 부르는 곳. 서버만 부른다(브라우저는 같은 사이트의 쪽과 /api/ 만 부른다). 토큰이 있으면 쓰고 없으면 토큰
 * 없이 부른다. 토큰은 요청 머리에만 싣고, 오류와 로그에 남기지 않는다.
 *
 * 부르는 것: 저장소 검색(search/repositories. 검색 쪽과 자동 완성), 저장소 정보(repos/{owner}/{repo}), 브랜치 끝 커밋
 * (repos/{o}/{r}/commits/{ref}). 자동 완성은 검색 API 만 부른다(core 를 부르지 않는다. docs/redesign.md 5장).
 * 검색과 저장소 정보는 서버 메모리에 짧게 둔다(같은 질의가 잇따라 오면 GitHub 을 다시 부르지 않는다). 끝 커밋도 아주 짧게
 * (기본 30초) 둔다. 같은 저장소의 분석 요청이 잇따라 와도 GitHub 을 한 번만 부른다(그 사이에 올라온 커밋은 30초 뒤의 요청이 본다).
 *
 * 요청 수 예산(검토 1): 한 사람이 검색어를 바꿔 가며, 또는 분석 요청을 되풀이해 이 사이트의 GitHub 요청 수 상한을 다 쓰면 모든
 * 사람의 검색·저장소 쪽이 멈춘다. 그래서 GitHub 을 부르기 전에 예산에서 하나를 꺼낸다. 요청한 사람을 가리지 않는다(IP 등 요청한
 * 사람에 관한 것을 적지 않는다). 검색(1분에 GitHub 이 30번, 토큰 없이 10번 받는다)과 그 밖의 부름(1시간에 5000번)을 따로 센다.
 * 자동 완성은 검색과 같은 통에서 꺼내되, 검색 쪽 몫(`searchReserve`)을 남겨 둔다(통 이름 `suggest`).
 * 예산이 비면 GitHub 을 부르지 않고 '요청 수 상한'으로 답한다. 캐시에서 꺼낸 답은 세지 않는다.
 * 예산은 `budget` 으로 받는다. 운영은 서버 인스턴스가 함께 쓰는 DB 의 1분 창 카운터다(`budget.ts`, `store/index.ts`). 주지 않으면
 * 이 서버 메모리의 토큰 통(token bucket)이다(서버 인스턴스마다 하나. 시험과 DB 를 쓰지 못할 때).
 *
 * 시험은 가짜 fetch 를 넘긴다(`createGitHub({ fetch })`). 실제 GitHub 을 부르지 않는다.
 */

/** 저장소 정보. 화면에 쓰는 `Repository` 에 요청 검사에 쓰는 것(공개 여부, 크기)을 더했다. */
export interface GitHubRepository extends Repository {
  /** GitHub 의 `size`(KB). 기록 전체를 포함한 크기라 받는 압축 파일보다 크다. */
  sizeKb: number;
}

export type GitHubFailure = "rate-limit" | "timeout" | "unavailable";

/** GitHub 을 부르지 못했다(요청 수 상한, 연결 실패, 모르는 응답). 까닭은 화면에 쓸 수 있는 말만 담는다. */
export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubFailure,
    message: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/**
 * GitHubError 인지. `instanceof` 로 가리지 않는다: GitHub 클라이언트는 캐시를 지녀 서버 프로세스에 하나만 두는데
 * (`store/index.ts` 의 globalThis), 그것을 처음 만든 묶음(쪽이나 route handler)과 오류를 받는 묶음이 다르면 같은 이름의 클래스가
 * 둘이라 `instanceof` 가 거짓이 된다(D4 에서 첫 화면을 연 뒤 자동 완성의 상한이 '연결 실패'로 보였다). 이름과 갈래로 가린다.
 */
export function isGitHubError(error: unknown): error is GitHubError {
  return (
    error instanceof Error &&
    error.name === "GitHubError" &&
    ["rate-limit", "timeout", "unavailable"].includes((error as { kind?: unknown }).kind as string)
  );
}

export interface SearchPage {
  repositories: GitHubRepository[];
  /** GitHub 이 센 맞는 저장소 수(보이는 것보다 많을 수 있다). */
  total: number;
}

/** 자동 완성의 GitHub 검색 결과. */
export interface SuggestPage extends SearchPage {
  /** 맞는 저장소를 모두 받았는지(GitHub 이 센 수가 받은 수보다 많지 않다). 뒤 질의가 이것을 걸러 다시 쓴다. */
  complete: boolean;
}

export interface GitHubClient {
  /** 공개 저장소 검색. 빈 질의는 부르지 않고 빈 목록이다. */
  search(query: string): Promise<SearchPage>;
  /**
   * 자동 완성의 검색 한 번(`per_page` 10, 3초 넘으면 `timeout`). 결과는 `suggestCacheSeconds` 동안 두고, 같은 질의가 동시에 오면
   * 한 번만 부르고, 앞 질의의 모든 결과로 걸러 낼 수 있으면 부르지 않는다(`canReuse`).
   */
  suggest(query: GitHubSuggestQuery): Promise<SuggestPage>;
  /** 공개 저장소 정보. 없거나 비공개거나 이름이 규칙에 맞지 않으면 null. */
  getRepository(owner: string, repo: string): Promise<GitHubRepository | null>;
  /** 브랜치(또는 다른 ref)의 끝 커밋(40자리). 없으면 null. */
  headCommit(owner: string, repo: string, ref: string): Promise<string | null>;
}

export interface GitHubOptions {
  apiBase: string;
  token: string | null;
  searchCacheSeconds: number;
  repoCacheSeconds: number;
  /** 자동 완성 결과를 메모리에 두는 시간(초). 기본 600. */
  suggestCacheSeconds?: number;
  /** 끝 커밋을 메모리에 두는 시간(초). 기본 30. */
  commitCacheSeconds?: number;
  /** 이 서버가 1분에 GitHub 검색을 부르는 수 상한. 기본 10. */
  searchPerMinute?: number;
  /** 그 가운데 검색 쪽 몫(자동 완성이 쓰지 않고 남기는 수). 기본 3(상한보다 작게 줄인다). */
  searchReserve?: number;
  /** 이 서버가 1분에 검색 밖의 GitHub API(저장소 정보·끝 커밋)를 부르는 수 상한. 기본 60. */
  callsPerMinute?: number;
  /**
   * 예산에서 하나를 꺼낸다. 꺼내지 못하면 false(부르지 않는다). 없으면 이 서버 메모리의 토큰 통(위 두 수)을 쓴다.
   * 운영은 서버 인스턴스가 함께 쓰는 DB 의 카운터를 넘긴다(`budget.ts`).
   */
  budget?: (bucket: BudgetBucket) => Promise<boolean>;
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * GitHub 을 부르는 수를 세는 통: 검색(검색 쪽), 자동 완성(검색과 같은 수를 세되 검색 쪽 몫을 남긴다), 그 밖(저장소 정보·끝 커밋).
 */
export type BudgetBucket = "search" | "suggest" | "core";

export const GITHUB_BUDGET_DEFAULTS = {
  commitCacheSeconds: 30,
  suggestCacheSeconds: 600,
  searchPerMinute: 10,
  searchReserve: 3,
  callsPerMinute: 60,
} as const;

/** 검색 한 번에 받는 저장소 수. */
export const SEARCH_PAGE_SIZE = 20;
/** 메모리에 두는 항목 수 상한(넘으면 오래된 것부터 버린다). */
const CACHE_ENTRIES = 500;
/** GitHub 이 이 시간 안에 답하지 않으면 그만둔다(ms). */
const TIMEOUT_MS = 10_000;
/** 자동 완성은 이 시간(ms)을 넘으면 그만두고 `timeout` 이다. 치는 사람을 오래 기다리게 하지 않는다. */
export const SUGGEST_TIMEOUT_MS = 3_000;

/** 화면 링크에 쓰는 GitHub 주소는 https://github.com/ 으로 시작하는 것만 받는다. 그 밖(가짜 서버 등)은 링크를 걸지 않는다. */
const GITHUB_WEB = "https://github.com/";
const SHA = /^[0-9a-f]{40}$/;

class TtlCache<T> {
  private readonly entries = new Map<string, { at: number; value: T }>();
  constructor(
    private readonly seconds: number,
    private readonly now: () => number,
  ) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at >= this.seconds * 1000) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }
  /** 넣는다. `at` 은 값을 받은 때(기본은 지금). 앞 값에서 걸러 낸 값은 앞 값의 때를 물려받는다(시간이 새로 시작하지 않는다). */
  set(key: string, value: T, at = this.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { at, value });
    while (this.entries.size > CACHE_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
  }
  /** 아직 시간이 남은 값들과 받은 때(나중에 넣은 것이 앞). */
  *fresh(): Generator<{ at: number; value: T }> {
    const live = [...this.entries.entries()].filter(([, entry]) => this.now() - entry.at < this.seconds * 1000);
    for (let i = live.length - 1; i >= 0; i -= 1) yield live[i][1];
  }
}

/** 1분에 perMinute 개가 고르게 차는 통. 처음에는 가득 차 있다. */
export class TokenBucket {
  private tokens: number;
  private at: number;
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number,
  ) {
    this.tokens = perMinute;
    this.at = now();
  }
  /** 하나를 꺼낸다. `keep` 개는 남겨 둔다(꺼낸 뒤에도 `keep` 개 이상이 남을 때만 꺼낸다). */
  take(keep = 0): boolean {
    const t = this.now();
    this.tokens = Math.min(this.perMinute, this.tokens + ((t - this.at) / 60_000) * this.perMinute);
    this.at = t;
    if (this.tokens < 1 + keep) return false;
    this.tokens -= 1;
    return true;
  }
}

/** 검색 쪽 몫. 상한보다 작게(상한이 1 이면 0) 줄인다. */
export function searchReserveOf(options: Pick<GitHubOptions, "searchPerMinute" | "searchReserve">): number {
  const limit = options.searchPerMinute ?? GITHUB_BUDGET_DEFAULTS.searchPerMinute;
  return Math.max(0, Math.min(options.searchReserve ?? GITHUB_BUDGET_DEFAULTS.searchReserve, limit - 1));
}

/**
 * 이 서버 메모리의 토큰 통 둘(검색, 그 밖). 서버 인스턴스마다 하나다. 자동 완성(`suggest`)은 검색 통에서 꺼내되 검색 쪽 몫
 * (`searchReserve`)을 남겨 둔다.
 */
export function localBudget(
  options: Pick<GitHubOptions, "searchPerMinute" | "searchReserve" | "callsPerMinute">,
  now: () => number = Date.now,
): (bucket: BudgetBucket) => boolean {
  const search = new TokenBucket(options.searchPerMinute ?? GITHUB_BUDGET_DEFAULTS.searchPerMinute, now);
  const core = new TokenBucket(options.callsPerMinute ?? GITHUB_BUDGET_DEFAULTS.callsPerMinute, now);
  const reserve = searchReserveOf(options);
  return (bucket) => (bucket === "core" ? core.take() : search.take(bucket === "suggest" ? reserve : 0));
}

type Raw = Record<string, unknown>;

/**
 * GitHub 의 요청 수 상한인지: 429, 또는 403 가운데 남은 수가 0 이거나(1차 한도) `retry-after` 가 있거나 본문이 'rate limit' 을
 * 말하는 것(2차 한도. GitHub 은 이때 남은 수를 0 으로 적지 않는다).
 */
export function isRateLimited(response: Pick<Response, "status" | "headers">, body: unknown): boolean {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")) return true;
  const message = typeof body === "object" && body !== null ? (body as Raw).message : null;
  return typeof message === "string" && /rate limit/i.test(message);
}
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** GitHub 의 저장소 JSON 을 옮긴다. 모양이 다르거나 공개가 아니면 null(꾸며 채우지 않는다). */
export function toRepository(raw: unknown): GitHubRepository | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Raw;
  const owner = str((r.owner as Raw | null)?.login);
  const name = str(r.name);
  const defaultBranch = str(r.default_branch);
  if (!owner || !name || !defaultBranch || !isRepoFullName(owner, name)) return null;
  if (r.private !== false) return null;
  if (r.visibility !== undefined && r.visibility !== "public") return null;
  const htmlUrl = str(r.html_url);
  return {
    owner,
    name,
    description: str(r.description),
    defaultBranch,
    language: str(r.language),
    htmlUrl: htmlUrl && htmlUrl.toLowerCase() === `${GITHUB_WEB}${owner}/${name}`.toLowerCase() ? htmlUrl : null,
    synthetic: false,
    sizeKb: typeof r.size === "number" && Number.isFinite(r.size) ? r.size : 0,
  };
}

export function createGitHub(options: GitHubOptions): GitHubClient {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const searches = new TtlCache<SearchPage>(options.searchCacheSeconds, now);
  const repos = new TtlCache<GitHubRepository | null>(options.repoCacheSeconds, now);
  const commits = new TtlCache<string | null>(options.commitCacheSeconds ?? GITHUB_BUDGET_DEFAULTS.commitCacheSeconds, now);
  const suggestions = new TtlCache<SuggestPage & { query: GitHubSuggestQuery }>(
    options.suggestCacheSeconds ?? GITHUB_BUDGET_DEFAULTS.suggestCacheSeconds,
    now,
  );
  /** 부르는 중인 자동 완성(질의마다 하나). 같은 질의가 동시에 오면 이것을 함께 기다린다. 서버 인스턴스마다다. */
  const inflight = new Map<string, Promise<SuggestPage>>();
  const local = localBudget(options, now);
  const take = options.budget ?? (async (bucket: BudgetBucket) => local(bucket));

  async function call(
    pathAndQuery: string,
    budget: BudgetBucket = "core",
    timeoutMs = TIMEOUT_MS,
  ): Promise<{ status: number; body: unknown }> {
    if (!(await take(budget))) {
      throw new GitHubError("rate-limit", "이 사이트가 GitHub 에 보내는 요청이 잠시 많아 쉬고 있습니다. 1분쯤 뒤에 다시 해 보세요.");
    }
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "plitsoft-sdp-web",
    };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const signal = AbortSignal.timeout(timeoutMs);
    const timedOut = () => new GitHubError("timeout", "GitHub 이 제때 답하지 않았습니다. 잠시 뒤에 다시 해 보세요.");
    let response: Response;
    try {
      response = await fetcher(`${options.apiBase}${pathAndQuery}`, { headers, cache: "no-store", signal });
    } catch {
      if (signal.aborted) throw timedOut();
      throw new GitHubError("unavailable", "GitHub 에 닿지 못했습니다. 잠시 뒤에 다시 해 보세요.");
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      if (signal.aborted) throw timedOut();
      body = null;
    }
    if (isRateLimited(response, body)) throw new GitHubError("rate-limit", "GitHub 의 요청 수 상한에 닿았습니다. 잠시 뒤에 다시 해 보세요.");
    return { status: response.status, body };
  }

  const unexpected = () => new GitHubError("unavailable", "GitHub 이 알 수 없는 답을 했습니다. 잠시 뒤에 다시 해 보세요.");

  /** 검색 응답을 옮긴다. 모양이 다르면 `unexpected`. */
  function readSearch(status: number, body: unknown): SearchPage & { incomplete: boolean } {
    if (status !== 200 || typeof body !== "object" || body === null || !Array.isArray((body as Raw).items)) throw unexpected();
    const items = (body as Raw).items as unknown[];
    return {
      repositories: items.map(toRepository).filter((repo): repo is GitHubRepository => repo !== null),
      total: typeof (body as Raw).total_count === "number" ? ((body as Raw).total_count as number) : items.length,
      incomplete: (body as Raw).incomplete_results === true,
    };
  }

  async function fetchSuggest(query: GitHubSuggestQuery): Promise<SuggestPage> {
    const params = new URLSearchParams({ q: query.q, per_page: String(SUGGEST_PAGE_SIZE) });
    const { status, body } = await call(`/search/repositories?${params}`, "suggest", SUGGEST_TIMEOUT_MS);
    if (status === 422) {
      const page = { repositories: [], total: 0, complete: true };
      suggestions.set(query.q.toLowerCase(), { ...page, query });
      return page;
    }
    const read = readSearch(status, body);
    const page: SuggestPage = {
      repositories: read.repositories,
      total: read.total,
      complete: !read.incomplete && read.total <= ((body as Raw).items as unknown[]).length,
    };
    suggestions.set(query.q.toLowerCase(), { ...page, query });
    return page;
  }

  return {
    async search(query) {
      const q = query.trim().slice(0, MAX_QUERY_LENGTH);
      if (q === "") return { repositories: [], total: 0 };
      const cached = searches.get(q);
      if (cached) return cached;
      // 공개 저장소만 찾는다. 토큰이 비공개 저장소를 볼 수 있어도 검색에 섞이지 않게 한다.
      const params = new URLSearchParams({ q: `${q} is:public`, per_page: String(SEARCH_PAGE_SIZE) });
      const { status, body } = await call(`/search/repositories?${params}`, "search");
      // 422: GitHub 이 질의를 받지 않았다(문법). 맞는 저장소가 없는 것으로 본다.
      if (status === 422) return { repositories: [], total: 0 };
      const { repositories, total } = readSearch(status, body);
      const page: SearchPage = { repositories, total };
      searches.set(q, page);
      return page;
    },

    async suggest(query) {
      // GitHub 검색은 대소문자를 가리지 않는다. 캐시와 함께 기다리기의 열쇠는 소문자다.
      const key = query.q.toLowerCase();
      const cached = suggestions.get(key);
      if (cached) return { repositories: cached.repositories, total: cached.total, complete: cached.complete };
      // 앞 질의(이 질의가 늘인 것)의 결과가 모두였으면 걸러 다시 쓴다. GitHub 을 부르지 않는다. 걸러 낸 것은 앞 결과를 받은 때를
      // 물려받는다(600초가 걸러 낼 때마다 새로 시작하지 않는다).
      for (const { at, value: previous } of suggestions.fresh()) {
        const names = previous.repositories.map((repo) => repo.name);
        if (!canReuse(previous.query, previous.complete, query, names)) continue;
        const repositories = reuseFilter(previous.repositories, query);
        const page: SuggestPage = { repositories, total: repositories.length, complete: true };
        suggestions.set(key, { ...page, query }, at);
        return page;
      }
      const running = inflight.get(key);
      if (running) return running;
      const work = fetchSuggest(query).finally(() => inflight.delete(key));
      inflight.set(key, work);
      return work;
    },

    async getRepository(owner, repo) {
      if (!isRepoFullName(owner, repo)) return null;
      const key = `${owner}/${repo}`.toLowerCase();
      const cached = repos.get(key);
      if (cached !== undefined) return cached;
      const { status, body } = await call(`/repos/${owner}/${repo}`);
      // 없거나, 비공개라 보이지 않거나(404), 막힌 저장소(451)는 같은 "없음"이다.
      if (status === 404 || status === 451) {
        repos.set(key, null);
        return null;
      }
      if (status !== 200) throw unexpected();
      const found = toRepository(body);
      repos.set(key, found);
      return found;
    },

    async headCommit(owner, repo, ref) {
      if (!isRepoFullName(owner, repo) || ref === "" || ref.length > 255) return null;
      const key = `${owner}/${repo}`.toLowerCase() + `@${ref}`;
      const cached = commits.get(key);
      if (cached !== undefined) return cached;
      const { status, body } = await call(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`);
      if (status === 404 || status === 409 || status === 422) {
        commits.set(key, null);
        return null;
      }
      if (status !== 200) throw unexpected();
      const sha = str((body as Raw | null)?.sha);
      const found = sha && SHA.test(sha) ? sha : null;
      commits.set(key, found);
      return found;
    },
  };
}
