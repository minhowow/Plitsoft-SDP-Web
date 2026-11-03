import "server-only";
import { isRepoFullName, MAX_QUERY_LENGTH } from "@/lib/service/names";
import type { Repository } from "@/lib/service/types";

/**
 * GitHub API 를 부르는 곳. 서버만 부른다(브라우저는 같은 사이트의 쪽과 /api/ 만 부른다). 토큰이 있으면 쓰고 없으면 토큰
 * 없이 부른다. 토큰은 요청 머리에만 싣고, 오류와 로그에 남기지 않는다.
 *
 * 부르는 것: 저장소 검색(search/repositories), 저장소 정보(repos/{owner}/{repo}), 브랜치 끝 커밋(repos/{o}/{r}/commits/{ref}).
 * 검색과 저장소 정보는 서버 메모리에 짧게 둔다(같은 질의가 잇따라 오면 GitHub 을 다시 부르지 않는다). 끝 커밋도 아주 짧게
 * (기본 30초) 둔다. 같은 저장소의 분석 요청이 잇따라 와도 GitHub 을 한 번만 부른다(그 사이에 올라온 커밋은 30초 뒤의 요청이 본다).
 *
 * 요청 수 예산(검토 1): 한 사람이 검색어를 바꿔 가며, 또는 분석 요청을 되풀이해 이 사이트의 GitHub 요청 수 상한을 다 쓰면 모든
 * 사람의 검색·저장소 쪽이 멈춘다. 그래서 GitHub 을 부르기 전에 서버 메모리의 토큰 통(token bucket)에서 하나를 꺼낸다. 통은
 * 서버 인스턴스마다 하나이고 요청한 사람을 가리지 않는다(IP 등 요청한 사람에 관한 것을 적지 않는다). 검색(1분에 GitHub 이 30번,
 * 토큰 없이 10번 받는다)과 그 밖의 부름(1시간에 5000번)을 따로 센다. 통이 비면 GitHub 을 부르지 않고 '요청 수 상한'으로 답한다.
 * 캐시에서 꺼낸 답은 세지 않는다.
 *
 * 시험은 가짜 fetch 를 넘긴다(`createGitHub({ fetch })`). 실제 GitHub 을 부르지 않는다.
 */

/** 저장소 정보. 화면에 쓰는 `Repository` 에 요청 검사에 쓰는 것(공개 여부, 크기)을 더했다. */
export interface GitHubRepository extends Repository {
  /** GitHub 의 `size`(KB). 기록 전체를 포함한 크기라 받는 압축 파일보다 크다. */
  sizeKb: number;
}

export type GitHubFailure = "rate-limit" | "unavailable";

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

export interface SearchPage {
  repositories: GitHubRepository[];
  /** GitHub 이 센 맞는 저장소 수(보이는 것보다 많을 수 있다). */
  total: number;
}

export interface GitHubClient {
  /** 공개 저장소 검색. 빈 질의는 부르지 않고 빈 목록이다. */
  search(query: string): Promise<SearchPage>;
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
  /** 끝 커밋을 메모리에 두는 시간(초). 기본 30. */
  commitCacheSeconds?: number;
  /** 이 서버가 1분에 GitHub 검색을 부르는 수 상한. 기본 10. */
  searchPerMinute?: number;
  /** 이 서버가 1분에 검색 밖의 GitHub API(저장소 정보·끝 커밋)를 부르는 수 상한. 기본 60. */
  callsPerMinute?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

export const GITHUB_BUDGET_DEFAULTS = { commitCacheSeconds: 30, searchPerMinute: 10, callsPerMinute: 60 } as const;

/** 검색 한 번에 받는 저장소 수. */
export const SEARCH_PAGE_SIZE = 20;
/** 메모리에 두는 항목 수 상한(넘으면 오래된 것부터 버린다). */
const CACHE_ENTRIES = 500;
/** GitHub 이 이 시간 안에 답하지 않으면 그만둔다(ms). */
const TIMEOUT_MS = 10_000;

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
  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { at: this.now(), value });
    while (this.entries.size > CACHE_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
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
  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.perMinute, this.tokens + ((t - this.at) / 60_000) * this.perMinute);
    this.at = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

type Raw = Record<string, unknown>;
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
  const budgets = {
    search: new TokenBucket(options.searchPerMinute ?? GITHUB_BUDGET_DEFAULTS.searchPerMinute, now),
    core: new TokenBucket(options.callsPerMinute ?? GITHUB_BUDGET_DEFAULTS.callsPerMinute, now),
  };

  async function call(pathAndQuery: string, budget: keyof typeof budgets = "core"): Promise<{ status: number; body: unknown }> {
    if (!budgets[budget].take()) {
      throw new GitHubError("rate-limit", "이 사이트가 GitHub 에 보내는 요청이 잠시 많아 쉬고 있습니다. 1분쯤 뒤에 다시 해 보세요.");
    }
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "plitsoft-sdp-web",
    };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    let response: Response;
    try {
      response = await fetcher(`${options.apiBase}${pathAndQuery}`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new GitHubError("unavailable", "GitHub 에 닿지 못했습니다. 잠시 뒤에 다시 해 보세요.");
    }
    const limited =
      response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
    if (limited) throw new GitHubError("rate-limit", "GitHub 의 요청 수 상한에 닿았습니다. 잠시 뒤에 다시 해 보세요.");
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  const unexpected = () => new GitHubError("unavailable", "GitHub 이 알 수 없는 답을 했습니다. 잠시 뒤에 다시 해 보세요.");

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
      if (status !== 200 || typeof body !== "object" || body === null || !Array.isArray((body as Raw).items)) throw unexpected();
      const items = (body as Raw).items as unknown[];
      const page: SearchPage = {
        repositories: items.map(toRepository).filter((repo): repo is GitHubRepository => repo !== null),
        total: typeof (body as Raw).total_count === "number" ? ((body as Raw).total_count as number) : items.length,
      };
      searches.set(q, page);
      return page;
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
