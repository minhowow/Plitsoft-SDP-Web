import { describe, expect, it } from "vitest";
import { isOwnerName, isRepoFullName, isRepoName } from "@/lib/service/names";
import { createGitHub, GitHubError, toRepository } from "@/server/github";
import { createGitHubStub } from "../scripts/github-stub.mjs";

// GitHub 클라이언트(src/server/github.ts). 실제 GitHub 을 부르지 않는다. 가짜 GitHub(scripts/github-stub.mjs)의 응답을 서버
// 없이 받는 fetch 를 넘긴다.

const BASE = "http://stub.test";

function client(options: { token?: string | null; now?: () => number; searchPerMinute?: number; callsPerMinute?: number } = {}) {
  const stub = createGitHubStub({ origin: BASE });
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
    return stub.fetch(input, init);
  };
  const github = createGitHub({
    apiBase: BASE,
    token: options.token ?? null,
    searchCacheSeconds: 60,
    repoCacheSeconds: 300,
    fetch: fetcher,
    now: options.now,
    searchPerMinute: options.searchPerMinute,
    callsPerMinute: options.callsPerMinute,
  });
  return { github, stub, seen };
}

describe("이름 검사", () => {
  it("GitHub 의 이름 규칙(영숫자·빼기표·밑줄·점)과 길이만 받는다", () => {
    expect(isOwnerName("example-org")).toBe(true);
    expect(isOwnerName("a".repeat(39))).toBe(true);
    expect(isOwnerName("a".repeat(40))).toBe(false);
    expect(isOwnerName("-lead")).toBe(false);
    expect(isOwnerName("dot.ted")).toBe(false);
    expect(isRepoName("next.js")).toBe(true);
    expect(isRepoName("a".repeat(100))).toBe(true);
    expect(isRepoName("a".repeat(101))).toBe(false);
    for (const bad of ["", ".", "..", "a/b", "a b", "a?b", "a%2fb", "a#b", "한글"]) expect(isRepoName(bad), bad).toBe(false);
    expect(isRepoFullName("example-org", "../etc")).toBe(false);
  });

  it("규칙에 맞지 않는 이름은 GitHub 을 부르지 않고 없음이다", async () => {
    const { github, seen } = client();
    expect(await github.getRepository("example-org", "../../user")).toBeNull();
    expect(await github.getRepository("a/b", "c")).toBeNull();
    expect(await github.headCommit("example-org", "a b", "main")).toBeNull();
    expect(seen).toEqual([]);
  });
});

describe("검색", () => {
  it("공개 저장소만 찾게 is:public 을 붙여 부르고, 결과를 Repository 로 옮긴다", async () => {
    const { github, seen } = client();
    const page = await github.search("kids");
    expect(page.total).toBe(1);
    expect(page.repositories).toEqual([
      {
        owner: "example-org",
        name: "kids-signup",
        // 가짜 GitHub 의 설명은 "합성 예시 저장소입니다"를 적지 않는다(재디자인 D4: 이름표와 안내 줄이 말한다).
        description: "아동도 쓰는 회원 가입 화면",
        defaultBranch: "main",
        language: "TypeScript",
        // 가짜 서버의 주소는 github.com 이 아니라 링크를 걸지 않는다.
        htmlUrl: null,
        synthetic: false,
        sizeKb: 12,
      },
    ]);
    const url = new URL(seen[0].url);
    expect(url.pathname).toBe("/search/repositories");
    expect(url.searchParams.get("q")).toBe("kids is:public");
    expect(url.searchParams.get("per_page")).toBe("20");
  });

  it("빈 질의는 부르지 않는다. 같은 질의는 60초 동안 다시 부르지 않는다", async () => {
    let now = 1_000_000;
    const { github, seen } = client({ now: () => now });
    expect(await github.search("   ")).toEqual({ repositories: [], total: 0 });
    expect(seen).toHaveLength(0);
    await github.search("example");
    await github.search("example");
    expect(seen).toHaveLength(1);
    now += 59_000;
    await github.search("example");
    expect(seen).toHaveLength(1);
    now += 1_000;
    await github.search("example");
    expect(seen).toHaveLength(2);
  });

  it("토큰이 있으면 Authorization 머리에 싣고, 없으면 싣지 않는다", async () => {
    const withToken = client({ token: "test-token-not-a-secret" });
    await withToken.github.search("kids");
    expect(withToken.seen[0].headers.authorization).toBe("Bearer test-token-not-a-secret");
    const without = client();
    await without.github.search("kids");
    expect(without.seen[0].headers.authorization).toBeUndefined();
    expect(without.seen[0].headers.accept).toBe("application/vnd.github+json");
  });

  it("요청 수 상한에 닿으면 까닭을 담은 오류다. 오류에 토큰이 없다", async () => {
    const { github, stub } = client({ token: "test-token-not-a-secret" });
    stub.setRateLimited(true);
    const error = await github.search("kids").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe("rate-limit");
    expect(String((error as Error).message)).not.toContain("test-token");
  });

  it("GitHub 에 닿지 못하면 unavailable 이다", async () => {
    const github = createGitHub({
      apiBase: BASE,
      token: null,
      searchCacheSeconds: 60,
      repoCacheSeconds: 300,
      fetch: async () => {
        throw new TypeError("fetch failed: connect ECONNREFUSED 10.0.0.1");
      },
    });
    const error = (await github.search("kids").catch((e: unknown) => e)) as GitHubError;
    expect(error.kind).toBe("unavailable");
    expect(error.message).not.toContain("ECONNREFUSED");
  });
});

describe("저장소 정보와 끝 커밋", () => {
  it("공개 저장소를 대소문자 없이 찾고, 없거나 비공개면 null 이다", async () => {
    const { github } = client();
    expect((await github.getRepository("example-studio", "genai-chat"))?.name).toBe("GenAI-Chat");
    expect(await github.getRepository("example-labs", "secret-repo")).toBeNull();
    expect(await github.getRepository("example-labs", "nothing")).toBeNull();
  });

  it("저장소 정보는 300초 동안 다시 부르지 않는다(없음도 둔다)", async () => {
    let now = 0;
    const { github, seen } = client({ now: () => now });
    await github.getRepository("example-org", "kids-signup");
    await github.getRepository("EXAMPLE-ORG", "Kids-Signup");
    await github.getRepository("example-labs", "nothing");
    await github.getRepository("example-labs", "nothing");
    expect(seen).toHaveLength(2);
    now = 300_000;
    await github.getRepository("example-org", "kids-signup");
    expect(seen).toHaveLength(3);
  });

  it("끝 커밋은 30초만 둔다: 잇따른 요청은 GitHub 을 한 번만 부르고, 30초 뒤에는 새 커밋을 본다", async () => {
    let now = 0;
    const { github, stub, seen } = client({ now: () => now });
    const first = await github.headCommit("example-org", "kids-signup", "main");
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    const next = stub.setHead("example-org", "kids-signup", "2");
    for (let i = 0; i < 10; i += 1) expect(await github.headCommit("EXAMPLE-ORG", "kids-signup", "main")).toBe(first);
    expect(seen).toHaveLength(1);
    now = 30_000;
    expect(await github.headCommit("example-org", "kids-signup", "main")).toBe(next);
    expect(next).not.toBe(first);
    expect(await github.headCommit("example-org", "kids-signup", "no-branch")).toBeNull();
    expect(seen).toHaveLength(3);
  });

  it("저장소 JSON 의 모양이 다르거나 공개가 아니면 옮기지 않는다. github.com 의 그 저장소 주소만 링크로 받는다", () => {
    const base = { owner: { login: "a" }, name: "b", default_branch: "main", private: false, size: 1 };
    expect(toRepository({ ...base, html_url: "https://github.com/a/b" })?.htmlUrl).toBe("https://github.com/a/b");
    expect(toRepository({ ...base, html_url: "https://github.com/other/b" })?.htmlUrl).toBeNull();
    expect(toRepository({ ...base, html_url: "javascript:alert(1)" })?.htmlUrl).toBeNull();
    expect(toRepository({ ...base, html_url: "https://github.com.evil.test/a/b" })?.htmlUrl).toBeNull();
    expect(toRepository({ ...base, private: true })).toBeNull();
    expect(toRepository({ ...base, private: undefined })).toBeNull();
    expect(toRepository({ ...base, visibility: "internal" })).toBeNull();
    expect(toRepository({ ...base, name: "../x" })).toBeNull();
    expect(toRepository(null)).toBeNull();
  });
});

describe("요청 수 예산 (검토 1: 한 사람이 사이트의 GitHub 요청 수 상한을 다 쓰지 못하게)", () => {
  it("검색은 1분에 정한 수까지만 GitHub 을 부르고, 넘으면 부르지 않고 '요청 수 상한'이다. 시간이 지나면 다시 찬다", async () => {
    let now = 0;
    const { github, seen } = client({ now: () => now, searchPerMinute: 3 });
    for (const q of ["x1", "x2", "x3"]) await github.search(q);
    expect(seen).toHaveLength(3);
    const error = (await github.search("x4").catch((e: unknown) => e)) as GitHubError;
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.kind).toBe("rate-limit");
    expect(seen).toHaveLength(3);
    // 캐시에 있는 질의는 예산을 쓰지 않는다.
    await github.search("x1");
    expect(seen).toHaveLength(3);
    // 검색 예산이 비어도 저장소 정보는 따로 센다.
    await github.getRepository("example-org", "kids-signup");
    expect(seen).toHaveLength(4);
    now = 20_000; // 1분에 3개 → 20초에 하나가 찬다.
    await github.search("x4");
    expect(seen).toHaveLength(5);
  });

  it("저장소 정보·끝 커밋도 1분에 정한 수까지다. 같은 저장소의 분석 요청을 되풀이해도 캐시 덕에 예산을 쓰지 않는다", async () => {
    const { github, seen } = client({ now: () => 0, callsPerMinute: 2 });
    for (let i = 0; i < 10; i += 1) {
      await github.getRepository("example-org", "kids-signup");
      await github.headCommit("example-org", "kids-signup", "main");
    }
    expect(seen).toHaveLength(2);
    const error = (await github.getRepository("example-org", "night-push").catch((e: unknown) => e)) as GitHubError;
    expect(error.kind).toBe("rate-limit");
    expect(seen).toHaveLength(2);
  });
});
