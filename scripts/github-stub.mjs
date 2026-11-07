#!/usr/bin/env node
// 가짜 GitHub API. 개발과 시험에서 실제 api.github.com 을 부르지 않으려고 둔다(Node 내장 모듈만 쓴다).
//
//   node scripts/github-stub.mjs [--port 4010] [--search-per-minute 30] [--delay 0]
//   GITHUB_API_BASE=http://127.0.0.1:4010 npm run dev
//
// 실제 GitHub 처럼 답한다(재디자인 D4, docs/redesign.md 5장 "로컬을 정직하게").
//   - 검색(search/repositories): 낱말마다 이름 낱말(`-` `.` `_` 로 나눈 것)과 이름 전체의 머리로 찾는다. `in:name` 이면 그것뿐이고
//     (owner 로는 찾지 않는다. 실제 GitHub 의 in:name 은 저장소 이름만 본다), 없으면 owner·owner/name 의 머리와 설명에 든 글자로도
//     찾는다. 한정어 `in:name`, `user:`, `repo:`, `is:public` 을 읽고, 모르는 한정어는 버린다.
//     `per_page` 만큼 돌려주고 `total_count` 는 맞는 수 전부다.
//   - 요청 수 상한 머리(`x-ratelimit-limit`·`-remaining`·`-reset`)를 싣는다. 검색은 1분 창에 `--search-per-minute`(기본 30, 토큰이
//     있을 때의 GitHub 과 같다)번까지 받고, 넘으면 403 과 remaining 0 이다. `--search-per-minute 0` 이면 검색이 늘 상한이다(시험·캡처).
//   - `--delay ms` 만큼 늦게 답한다(시간 초과를 볼 때).
//
// 합성 저장소 몇 개만 안다. 이름은 분명한 합성 이름(example-*)이고, 저장소 주소(html_url)는 github.com 이 아니라 이 서버의
// 주소라서 사이트가 GitHub 링크를 걸지 않는다(같은 이름의 남의 계정으로 보내지 않는다. src/server/github.ts 의 toRepository).
// 끝 커밋은 저장소 이름에서 정해지는 고정 값이다. `setHead` 로 바꿀 수 있다(새 커밋이 생긴 것처럼).
//
// 부르는 쪽(시험)은 `createGitHubStub()` 로 같은 응답을 서버 없이(`respond`) 받거나, `startGitHubStub()` 로 127.0.0.1 에 띄운다.

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

/**
 * 합성 저장소. `fixture` 는 로컬 실행기가 검사할 합성 데모 코드 폴더(contract/fixtures/ 아래)다. 이름에는 대소문자가 섞인 것
 * (Example-Studio/GenAI-Chat), 점이 든 것(plain.utils), 크기 상한을 넘는 것, 비공개인 것이 있다. 설명에 "합성 예시 저장소"라고
 * 적지 않는다(사이트의 합성 예시 이름표와 가짜 GitHub 안내 줄이 말한다).
 */
export const STUB_REPOSITORIES = [
  { owner: "example-org", name: "kids-signup", description: "아동도 쓰는 회원 가입 화면", language: "TypeScript", size: 12, fixture: "kids-signup" },
  { owner: "example-org", name: "night-push", description: "마케팅 앱 푸시를 보내는 코드", language: "TypeScript", size: 9, fixture: "night-push" },
  { owner: "Example-Studio", name: "GenAI-Chat", description: "생성형 AI 채팅 화면", language: "TypeScript", size: 15, fixture: "genai-chat" },
  { owner: "example-labs", name: "plain.utils", description: "숫자 계산 유틸리티", language: "JavaScript", size: 4, fixture: "plain" },
  { owner: "example-labs", name: "huge-monorepo", description: "크기 상한을 넘는 저장소", language: "TypeScript", size: 5_000_000, fixture: null },
  { owner: "example-labs", name: "secret-repo", description: "비공개 저장소", language: "TypeScript", size: 3, fixture: null, private: true },
];

/** 이름의 낱말(`-` `.` `_` 로 나눈 것). */
const wordsOf = (text) => text.toLowerCase().split(/[-._]+/).filter(Boolean);

/**
 * 검색 질의(`q`)를 읽는다: 한정어(in:, user:, repo:, is:)와 낱말. 모르는 한정어는 버린다. 쌍점이 든 낱말은 한정어로 본다.
 * @param {string} q
 */
export function parseSearchQuery(q) {
  const parsed = { terms: [], inName: false, user: null, repo: null, isPublic: false };
  for (const token of q.split(/\s+/).filter(Boolean)) {
    const at = token.indexOf(":");
    if (at === -1) {
      parsed.terms.push(token.toLowerCase());
      continue;
    }
    const key = token.slice(0, at).toLowerCase();
    const value = token.slice(at + 1);
    if (key === "in") parsed.inName = value.toLowerCase().split(",").includes("name");
    else if (key === "user") parsed.user = value.toLowerCase();
    else if (key === "repo") parsed.repo = value.toLowerCase();
    else if (key === "is") parsed.isPublic = parsed.isPublic || value.toLowerCase() === "public";
  }
  return parsed;
}

/**
 * 저장소가 질의에 맞는지. 낱말은 모두 맞아야 한다. 이름 낱말·이름의 머리. `in:name` 이 아니면 owner 낱말·owner·owner/name 의 머리와
 * 설명에 든 글자도. 낱말이 없으면(한정어만) 한정어로만 거른다.
 */
export function matchesSearch(repo, parsed) {
  if (parsed.user && repo.owner.toLowerCase() !== parsed.user) return false;
  if (parsed.repo && `${repo.owner}/${repo.name}`.toLowerCase() !== parsed.repo) return false;
  if (parsed.terms.length === 0) return Boolean(parsed.user || parsed.repo);
  const name = repo.name.toLowerCase();
  const owner = repo.owner.toLowerCase();
  const heads = [name, ...wordsOf(repo.name), ...(parsed.inName ? [] : [owner, `${owner}/${name}`, ...wordsOf(repo.owner)])];
  return parsed.terms.every(
    (term) => heads.some((head) => head.startsWith(term)) || (!parsed.inName && (repo.description ?? "").toLowerCase().includes(term)),
  );
}

const sha = (text) => createHash("sha1").update(text).digest("hex");

/** ms 만큼 기다린다. signal 이 끊기면 그 까닭으로 던진다. */
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

export function createGitHubStub({ origin = "http://127.0.0.1", repositories = STUB_REPOSITORIES, searchPerMinute = 30, delayMs = 0, now = Date.now } = {}) {
  const heads = new Map(repositories.map((repo) => [`${repo.owner}/${repo.name}`.toLowerCase(), sha(`${repo.owner}/${repo.name}@1`)]));
  /** 받은 요청(방법, 경로). 시험이 GitHub 을 몇 번 불렀는지 본다. */
  const calls = [];
  /** workflow_dispatch 로 받은 본문. */
  const dispatches = [];
  let rateLimited = false;
  let searchLimit = searchPerMinute;
  let delay = delayMs;
  /** 검색의 1분 창(GitHub 의 search 한도처럼 센다). */
  const window = { start: 0, used: 0 };

  const find = (owner, name) => repositories.find((repo) => `${repo.owner}/${repo.name}`.toLowerCase() === `${owner}/${name}`.toLowerCase());
  const json = (status, body, headers = {}) => ({ status, body, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
  const toJson = (repo) => ({
    name: repo.name,
    full_name: `${repo.owner}/${repo.name}`,
    owner: { login: repo.owner },
    private: Boolean(repo.private),
    visibility: repo.private ? "private" : "public",
    html_url: `${origin}/${repo.owner}/${repo.name}`,
    description: repo.description,
    default_branch: "main",
    language: repo.language,
    size: repo.size,
  });

  /** 요청 하나에 답한다. method·url(경로와 질의)·본문(글)을 받는다. */
  function respond(method, url, body = "") {
    const { pathname, searchParams } = new URL(url, "http://stub");
    calls.push({ method, path: `${pathname}${searchParams.size ? `?${searchParams}` : ""}` });
    const isSearch = method === "GET" && pathname === "/search/repositories";
    // 요청 수 상한 머리. 검색은 1분 창, 그 밖은 넉넉한 시간당 한도로 적는다(가짜라 세지 않는다).
    const t = now();
    if (t - window.start >= 60_000) {
      window.start = Math.floor(t / 60_000) * 60_000;
      window.used = 0;
    }
    const reset = String(Math.ceil((window.start + 60_000) / 1000));
    if (rateLimited) return json(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset });
    if (isSearch && window.used >= searchLimit) {
      return json(
        403,
        { message: "API rate limit exceeded for search" },
        { "x-ratelimit-limit": String(searchLimit), "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset, "x-ratelimit-resource": "search" },
      );
    }
    const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (isSearch) {
      window.used += 1;
      const parsed = parseSearchQuery(searchParams.get("q") ?? "");
      const perPage = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("per_page") ?? "30", 10) || 30));
      const found = repositories.filter((repo) => !repo.private).filter((repo) => matchesSearch(repo, parsed));
      return json(
        200,
        { total_count: found.length, incomplete_results: false, items: found.slice(0, perPage).map(toJson) },
        {
          "x-ratelimit-limit": String(searchLimit),
          "x-ratelimit-remaining": String(Math.max(0, searchLimit - window.used)),
          "x-ratelimit-reset": reset,
          "x-ratelimit-resource": "search",
        },
      );
    }
    if (parts[0] === "repos" && parts.length >= 3) {
      const repo = find(parts[1], parts[2]);
      // GitHub 은 비공개 저장소를 볼 권한이 없으면 404 로 답한다.
      if (!repo || repo.private) return json(404, { message: "Not Found" });
      if (method === "GET" && parts.length === 3) return json(200, toJson(repo));
      if (method === "GET" && parts[3] === "commits" && parts.length === 5) {
        if (parts[4] !== "main") return json(404, { message: "No commit found" });
        return json(200, { sha: heads.get(`${repo.owner}/${repo.name}`.toLowerCase()) });
      }
      if (method === "POST" && parts[3] === "actions" && parts[4] === "workflows" && parts[6] === "dispatches") {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(400, { message: "Problems parsing JSON" });
        }
        dispatches.push({ repo: `${parts[1]}/${parts[2]}`, workflow: parts[5], body: parsed });
        return { status: 204, body: null, headers: {} };
      }
    }
    return json(404, { message: "Not Found" });
  }

  return {
    respond,
    calls,
    dispatches,
    repositories,
    /** 그 저장소의 끝 커밋을 바꾼다(새 커밋이 생긴 것처럼). */
    setHead(owner, name, label) {
      heads.set(`${owner}/${name}`.toLowerCase(), sha(`${owner}/${name}@${label}`));
      return heads.get(`${owner}/${name}`.toLowerCase());
    },
    head(owner, name) {
      return heads.get(`${owner}/${name}`.toLowerCase()) ?? null;
    },
    setRateLimited(value) {
      rateLimited = value;
    },
    /** 검색을 1분에 몇 번까지 받는지(0 이면 늘 상한). */
    setSearchLimit(value) {
      searchLimit = value;
    },
    /** 답을 늦추는 시간(ms). */
    setDelay(ms) {
      delay = ms;
    },
    get delay() {
      return delay;
    },
    /** 서버 없이 같은 응답을 내는 fetch. 시험이 GitHub 클라이언트에 넘긴다. 늦추는 동안 끊으면(signal) 실제 fetch 처럼 던진다. */
    fetch: async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      const { pathname, search } = new URL(url);
      if (delay > 0) await wait(delay, init.signal);
      const answer = respond(init.method ?? "GET", `${pathname}${search}`, typeof init.body === "string" ? init.body : "");
      return new Response(answer.body === null ? null : JSON.stringify(answer.body), { status: answer.status, headers: answer.headers });
    },
  };
}

/** 127.0.0.1 에 띄운다. port 0 이면 빈 포트를 운영체제가 고른다. */
export async function startGitHubStub({ port = 0, searchPerMinute = 30, delayMs = 0 } = {}) {
  let stub = null;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const answer = () => {
        if (response.destroyed) return;
        const out = stub.respond(request.method ?? "GET", request.url ?? "/", body);
        response.writeHead(out.status, out.headers);
        response.end(out.body === null ? undefined : JSON.stringify(out.body));
      };
      if (stub.delay > 0) setTimeout(answer, stub.delay);
      else answer();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  stub = createGitHubStub({ origin, searchPerMinute, delayMs });
  return {
    ...stub,
    origin,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const arg = (name, fallback) => {
    const at = process.argv.indexOf(name);
    if (at === -1) return fallback;
    const n = Number.parseInt(process.argv[at + 1], 10);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${name} 다음에는 0 이상의 정수를 적습니다.`);
    return n;
  };
  const stub = await startGitHubStub({ port: arg("--port", 4010), searchPerMinute: arg("--search-per-minute", 30), delayMs: arg("--delay", 0) });
  console.log(`가짜 GitHub API: ${stub.origin}  (GITHUB_API_BASE=${stub.origin})`);
}
