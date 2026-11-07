import { describe, expect, it } from "vitest";
import {
  canReuse,
  cleanSuggestText,
  githubStatusLine,
  githubSuggestQuery,
  matchRange,
  mergeSuggestions,
  reuseFilter,
  SUGGEST_MAX_LENGTH,
  SUGGEST_ROWS,
  type GitHubSuggestion,
  type GitHubSuggestQuery,
  type SiteSuggestion,
} from "@/lib/service/suggest";
import nextConfig from "../next.config";
import { matchesSearch, parseSearchQuery, STUB_REPOSITORIES } from "../scripts/github-stub.mjs";

// 자동 완성의 순수 함수(src/lib/service/suggest.ts, docs/redesign.md 5장)와 가짜 GitHub 의 검색 규칙, 개발 서버의 요청 기록에서
// 질의를 빼는 설정. 네트워크·DB 를 부르지 않는다. 서버 쪽은 tests/server-suggest.test.ts 가 본다.

const query = (text: string): GitHubSuggestQuery => {
  const built = githubSuggestQuery(text);
  if (!built.ok) throw new Error(`묻지 않음: ${text} (${built.reason})`);
  return built.query;
};

describe("질의 다듬기 (cleanSuggestText)", () => {
  it("제어 문자와 보이지 않는 서식 문자를 빼고, 빈칸을 하나로, 빗금 둘레 빈칸을 떼고, 100자까지", () => {
    expect(cleanSuggestText("  exa  ")).toBe("exa");
    expect(cleanSuggestText("ex\u0000a​‮")).toBe("exa");
    expect(cleanSuggestText("kids\n\tsignup")).toBe("kids signup");
    expect(cleanSuggestText("example-org / kids")).toBe("example-org/kids");
    expect(cleanSuggestText(null)).toBe("");
    expect(Array.from(cleanSuggestText("가".repeat(300)))).toHaveLength(SUGGEST_MAX_LENGTH);
  });
});

describe("GitHub 검색 질의 (githubSuggestQuery)", () => {
  it("빗금 없음 → `접두 in:name is:public`", () => {
    expect(githubSuggestQuery("exa")).toEqual({ ok: true, query: { form: "name", owner: null, term: "exa", q: "exa in:name is:public" } });
    expect(query("next.js").q).toBe("next.js in:name is:public");
  });

  it("owner/접두 → `user:owner 접두 in:name is:public`, owner/ → `user:owner is:public`", () => {
    expect(query("vercel/nex")).toEqual({ form: "user", owner: "vercel", term: "nex", q: "user:vercel nex in:name is:public" });
    expect(query("example-org/")).toEqual({ form: "user", owner: "example-org", term: "", q: "user:example-org is:public" });
    // 이름 전체를 쳐도 같은 꼴이다(치는 동안에는 이름이 끝났는지 알 수 없다. 이름이 같은 저장소는 그 결과에 든다).
    expect(query("vercel/next.js").q).toBe("user:vercel next.js in:name is:public");
  });

  it("이름이 . _ - 로 시작하면 owner/name 그대로 `repo:owner/name is:public`", () => {
    expect(query("octo-org/.github")).toEqual({ form: "repo", owner: "octo-org", term: ".github", q: "repo:octo-org/.github is:public" });
    expect(query("octo/-x").q).toBe("repo:octo/-x is:public");
    expect(githubSuggestQuery("octo/..")).toEqual({ ok: false, reason: "chars" });
  });

  it("3글자 미만은 묻지 않는다(short)", () => {
    expect(githubSuggestQuery("ex")).toEqual({ ok: false, reason: "short" });
    expect(githubSuggestQuery("")).toEqual({ ok: false, reason: "short" });
    expect(githubSuggestQuery("ㅁㅁ")).toEqual({ ok: false, reason: "short" });
  });

  it("GitHub 이름 글자와 빗금 하나 밖의 것, 영문·숫자가 없는 것, 맞지 않는 owner, '-' 로 시작하는 낱말은 묻지 않는다(chars)", () => {
    // 다른 한정어를 끼워 넣는 것: 빈칸, 쌍점, 따옴표, 빗금 둘.
    for (const text of [
      "exa user:octo",
      "exa is:private",
      "repo:a/b",
      '"exa"',
      "a/b/c",
      "kids signup",
      "회원가입",
      "...",
      "---",
      "-exa",
      "bad_owner!/x",
      "-own/x",
      "a".repeat(40) + "/x",
      "exa*",
      "exa OR",
    ]) {
      expect(githubSuggestQuery(text), text).toEqual({ ok: false, reason: "chars" });
    }
  });

  it("소문자로 묻는다: 대문자 NOT·AND·OR 는 GitHub 의 연산자다. 소문자면 보통 낱말이다(D4 검토)", () => {
    expect(query("NOT").q).toBe("not in:name is:public");
    expect(query("AND").q).toBe("and in:name is:public");
    expect(query("OR1").q).toBe("or1 in:name is:public");
    expect(query("owner/NOT")).toEqual({ form: "user", owner: "owner", term: "not", q: "user:owner not in:name is:public" });
    expect(query("Example-Org/Kids").q).toBe("user:example-org kids in:name is:public");
    expect(query("Octo/.GitHub").q).toBe("repo:octo/.github is:public");
    for (const text of ["NOT", "AND", "OR1", "owner/NOT", "Example-Org/Kids"]) expect(query(text).q, text).not.toMatch(/[A-Z]/);
  });

  it("만든 q 에는 쌍점이 든 낱말이 정해 둔 한정어(in:name, user:, repo:, is:public)뿐이다", () => {
    for (const text of ["exa", "a-b.c_d", "example-org/", "example-org/kid", "o/.x", "123"]) {
      const words = query(text).q.split(" ").filter((word) => word.includes(":"));
      for (const word of words) expect(word, text).toMatch(/^(in:name|is:public|user:[A-Za-z0-9-_]+|repo:[A-Za-z0-9-_]+\/[A-Za-z0-9._-]+)$/);
    }
  });
});

describe("앞 질의의 결과 다시 쓰기 (canReuse, reuseFilter)", () => {
  it("앞 결과가 모두였고, 꼴·owner 가 같고, 글자를 늘인 질의만 다시 쓴다", () => {
    const named = ["example-app"];
    expect(canReuse(query("exa"), true, query("exam"), named)).toBe(true);
    expect(canReuse(query("exa"), false, query("exam"), named)).toBe(false);
    expect(canReuse(query("exa"), true, query("exa"), named)).toBe(false);
    expect(canReuse(query("exa"), true, query("kid"), named)).toBe(false);
    expect(canReuse(query("example-org/"), true, query("example-org/kid"), ["kids-signup", "night-push"])).toBe(true);
    expect(canReuse(query("example-org/"), true, query("Example-Org/kid"), ["kids-signup"])).toBe(true);
    expect(canReuse(query("example-org/"), true, query("other-org/kid"), ["kids-signup"])).toBe(false);
    // 꼴이 다르면(이름 검색 → owner 검색) 다시 쓰지 않는다. 저장소 하나(repo:)도 다시 쓰지 않는다.
    expect(canReuse(query("exa"), true, query("exa/kid"), named)).toBe(false);
    expect(canReuse(query("o/.git"), true, query("o/.github"), [".git"])).toBe(false);
  });

  it("앞 결과에 이름이 앞 글자를 품지 않은 저장소가 있으면 다시 쓰지 않는다(GitHub 이 이름 밖의 것으로 맞췄다. D4 검토)", () => {
    expect(canReuse(query("exa"), true, query("exam"), ["example-app", "night-push"])).toBe(false);
    expect(canReuse(query("exa"), true, query("exam"), [])).toBe(true);
  });

  it("늘인 글자에 - . _ 가 들면 다시 쓰지 않는다(GitHub 은 그 자리에서 낱말을 나눠 찾는다. hello- 가 hello_world 에 맞는다)", () => {
    const names = ["hello_world", "hello-web"];
    expect(canReuse(query("smallorg/"), true, query("smallorg/hello"), names)).toBe(true);
    expect(canReuse(query("smallorg/"), true, query("smallorg/hello-"), names)).toBe(false);
    expect(canReuse(query("smallorg/"), true, query("smallorg/hello_"), names)).toBe(false);
    expect(canReuse(query("smallorg/hello"), true, query("smallorg/hello.j"), names)).toBe(false);
  });

  it("거르는 규칙: 이름(소문자)에 새 글자가 그대로 든 것만. 앞 결과에 없던 것을 만들지 않는다", () => {
    const items = [{ name: "kids-signup" }, { name: "night-push" }, { name: "Kid-Tools" }];
    expect(reuseFilter(items, query("example-org/kid"))).toEqual([{ name: "kids-signup" }, { name: "Kid-Tools" }]);
    expect(reuseFilter(items, query("example-org/kids"))).toEqual([{ name: "kids-signup" }]);
  });
});

describe("두 출처 합치기 (mergeSuggestions)", () => {
  const site = (n: number): SiteSuggestion[] =>
    Array.from({ length: n }, (_, i) => ({ owner: "o", name: `s${i}`, analyses: 1, latestAt: "2026-11-03T00:00:00Z" }));
  const gh = (names: string[]): GitHubSuggestion[] => names.map((full) => ({ owner: full.split("/")[0], name: full.split("/")[1], description: null, language: null }));

  it("같은 저장소(대소문자 없이)는 이 사이트의 줄만 남는다", () => {
    const merged = mergeSuggestions(site(2), gh(["O/S1", "o/new", "o/new"]));
    expect(merged.site.map((r) => r.name)).toEqual(["s0", "s1"]);
    expect(merged.github.map((r) => r.name)).toEqual(["new"]);
  });

  it("모두 합해 8줄까지. 이 사이트의 줄이 많아도 GitHub 결과는 3줄까지 남긴다", () => {
    const many = mergeSuggestions(site(8), gh(["a/1", "a/2", "a/3", "a/4", "a/5"]));
    expect(many.site).toHaveLength(5);
    expect(many.github).toHaveLength(3);
    const few = mergeSuggestions(site(2), gh(["a/1", "a/2", "a/3", "a/4", "a/5", "a/6", "a/7", "a/8"]));
    expect(few.site).toHaveLength(2);
    expect(few.github).toHaveLength(6);
    expect(mergeSuggestions(site(10), []).site).toHaveLength(SUGGEST_ROWS);
  });
});

describe("GitHub 상태 한 줄 (githubStatusLine)", () => {
  it("'GitHub 에 없음'과 'GitHub 에 묻지 못함(까닭)'을 가른다. 결과가 보이면 적지 않는다", () => {
    expect(githubStatusLine({ status: "ok", total: 0 })).toBe("GitHub 에 없음");
    expect(githubStatusLine({ status: "ok", total: 4 })).toBeNull();
    expect(githubStatusLine({ status: "limited", total: null })).toBe("GitHub 에 묻지 못함(요청 수 상한)");
    expect(githubStatusLine({ status: "timeout", total: null })).toBe("GitHub 에 묻지 못함(시간 초과)");
    expect(githubStatusLine({ status: "unavailable", total: null })).toBe("GitHub 에 묻지 못함(연결 실패)");
    expect(githubStatusLine({ status: "off", total: null })).toBe("GitHub 에 묻지 않음(합성 미리보기)");
    expect(githubStatusLine({ status: "skipped", total: null, skipped: "short" })).toBe("GitHub 에 묻지 않음(3글자 미만)");
    expect(githubStatusLine({ status: "skipped", total: null, skipped: "chars" })).toBe("GitHub 에 묻지 않음(이름에 쓰지 않는 글자)");
  });
});

describe("굵게 적을 자리 (matchRange)", () => {
  it("owner/name 을 소문자로 견준 처음 한 곳. 빗금을 넘어도 된다", () => {
    expect(matchRange("Example-Studio", "GenAI-Chat", "exa")).toEqual([0, 3]);
    expect(matchRange("example-org", "kids-signup", "org/kid")).toEqual([8, 15]);
    expect(matchRange("example-org", "kids-signup", "zzz")).toBeNull();
    expect(matchRange("a", "b", "")).toBeNull();
  });
});

describe("가짜 GitHub 의 검색 규칙 (scripts/github-stub.mjs)", () => {
  const names = (q: string) =>
    STUB_REPOSITORIES.filter((repo) => !("private" in repo && repo.private))
      .filter((repo) => matchesSearch(repo, parseSearchQuery(q)))
      .map((repo) => `${repo.owner}/${repo.name}`);

  it("이름 낱말(- . _ 로 나눈 것)의 머리로 찾는다. 낱말 한가운데는 맞지 않는다", () => {
    expect(names("sign in:name")).toEqual(["example-org/kids-signup"]);
    expect(names("utils in:name")).toEqual(["example-labs/plain.utils"]);
    expect(names("chat in:name")).toEqual(["Example-Studio/GenAI-Chat"]);
    expect(names("ignup in:name")).toEqual([]);
  });

  it("in:name 은 저장소 이름만 본다(owner 로 찾지 않는다). 한정어가 없으면 owner 의 머리로도 찾는다. user: repo: 한정어로 거른다", () => {
    // 실제 GitHub 의 in:name 처럼(docs/redesign.md 5장). owner 로도 맞추면 이름으로 거르는 다시 쓰기와 어긋났다(D4 검토).
    expect(names("exa in:name")).toEqual([]);
    expect(names("exa")).toHaveLength(5);
    expect(names("genai in:name")).toEqual(["Example-Studio/GenAI-Chat"]);
    expect(names("user:example-org kid in:name")).toEqual(["example-org/kids-signup"]);
    expect(names("user:example-org")).toEqual(["example-org/kids-signup", "example-org/night-push"]);
    expect(names("repo:example-labs/plain.utils")).toEqual(["example-labs/plain.utils"]);
    expect(names("repo:EXAMPLE-STUDIO/genai-chat is:public")).toEqual(["Example-Studio/GenAI-Chat"]);
  });

  it("in:name 이 없으면 설명에 든 글자로도 찾는다. in:name 이면 찾지 않는다", () => {
    expect(names("회원")).toEqual(["example-org/kids-signup"]);
    expect(names("회원 in:name")).toEqual([]);
  });

  it("한정어만 있고 낱말이 없으면 이름으로 거르지 않는다. 아무것도 없으면 아무것도 맞지 않는다", () => {
    expect(names("is:public")).toEqual([]);
    expect(parseSearchQuery("kid in:name user:Example-Org is:public bogus:1")).toEqual({
      terms: ["kid"],
      inName: true,
      user: "example-org",
      repo: null,
      isPublic: true,
    });
  });
});

describe("개발 서버의 요청 기록에서 친 질의를 뺀다 (next.config.ts)", () => {
  const rules = (): RegExp[] => {
    const incoming = nextConfig.logging ? nextConfig.logging.incomingRequests : undefined;
    return typeof incoming === "object" && incoming !== null ? (incoming.ignore ?? []) : [];
  };
  const ignored = (url: string) => rules().some((rule) => rule.test(url));

  it("자동 완성과 질의가 있는 검색 쪽은 남기지 않고, 그 밖의 쪽은 남긴다", () => {
    expect(ignored("/api/repos/suggest/?q=kids")).toBe(true);
    // 빗금 없는 주소(308 로 보내기 전에 기록된다)도 뺀다(D4 검토).
    expect(ignored("/api/repos/suggest?q=kids")).toBe(true);
    expect(ignored("/api/repos/suggest")).toBe(true);
    expect(ignored("/api/repos/suggestions/")).toBe(false);
    expect(ignored("http://127.0.0.1:3000/api/repos/suggest/?q=%ED%95%9C")).toBe(true);
    expect(ignored("/search/?q=kids")).toBe(true);
    expect(ignored("/search?q=kids")).toBe(true);
    expect(ignored("/search/")).toBe(false);
    expect(ignored("/r/example-org/kids-signup/")).toBe(false);
    expect(ignored("/api/analyses/")).toBe(false);
  });
});
