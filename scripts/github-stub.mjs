#!/usr/bin/env node
// 가짜 GitHub API. 개발과 시험에서 실제 api.github.com 을 부르지 않으려고 둔다(Node 내장 모듈만 쓴다).
//
//   node scripts/github-stub.mjs [--port 4010]
//   GITHUB_API_BASE=http://127.0.0.1:4010 npm run dev
//
// 합성 저장소 몇 개만 안다. 이름은 분명한 합성 이름(example-*)이고, 저장소 주소(html_url)는 github.com 이 아니라 이 서버의
// 주소라서 사이트가 GitHub 링크를 걸지 않는다(같은 이름의 남의 계정으로 보내지 않는다. src/server/github.ts 의 toRepository).
// 끝 커밋은 저장소 이름에서 정해지는 고정 값이다. `setHead` 로 바꿀 수 있다(새 커밋이 생긴 것처럼).
//
// 부르는 쪽(시험)은 `createGitHubStub()` 로 같은 응답을 서버 없이(`respond`) 받거나, `startGitHubStub()` 로 127.0.0.1 에 띄운다.

import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

/** 합성 저장소. `fixture` 는 로컬 실행기가 검사할 합성 데모 코드 폴더(contract/fixtures/ 아래)다. */
export const STUB_REPOSITORIES = [
  { owner: "example-org", name: "kids-signup", description: "아동도 쓰는 회원 가입 화면. 합성 예시 저장소입니다.", language: "TypeScript", size: 12, fixture: "kids-signup" },
  { owner: "example-org", name: "night-push", description: "마케팅 앱 푸시를 보내는 코드. 합성 예시 저장소입니다.", language: "TypeScript", size: 9, fixture: "night-push" },
  { owner: "Example-Studio", name: "GenAI-Chat", description: "생성형 AI 채팅 화면. 대소문자가 섞인 합성 예시 저장소입니다.", language: "TypeScript", size: 15, fixture: "genai-chat" },
  { owner: "example-labs", name: "plain.utils", description: "숫자 계산 유틸리티. 이름에 점이 든 합성 예시 저장소입니다.", language: "JavaScript", size: 4, fixture: "plain" },
  { owner: "example-labs", name: "huge-monorepo", description: "크기 상한을 넘는 합성 예시 저장소입니다.", language: "TypeScript", size: 5_000_000, fixture: null },
  { owner: "example-labs", name: "secret-repo", description: "비공개 합성 예시 저장소입니다.", language: "TypeScript", size: 3, fixture: null, private: true },
];

const sha = (text) => createHash("sha1").update(text).digest("hex");

export function createGitHubStub({ origin = "http://127.0.0.1", repositories = STUB_REPOSITORIES } = {}) {
  const heads = new Map(repositories.map((repo) => [`${repo.owner}/${repo.name}`.toLowerCase(), sha(`${repo.owner}/${repo.name}@1`)]));
  /** 받은 요청(방법, 경로). 시험이 GitHub 을 몇 번 불렀는지 본다. */
  const calls = [];
  /** workflow_dispatch 로 받은 본문. */
  const dispatches = [];
  let rateLimited = false;

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
    if (rateLimited) return json(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0" });
    const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (method === "GET" && pathname === "/search/repositories") {
      const words = (searchParams.get("q") ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word && !word.includes(":"));
      const items = repositories
        .filter((repo) => !repo.private)
        .filter((repo) => words.length > 0 && words.every((word) => `${repo.owner}/${repo.name} ${repo.description}`.toLowerCase().includes(word)))
        .map(toJson);
      return json(200, { total_count: items.length, incomplete_results: false, items });
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
    /** 서버 없이 같은 응답을 내는 fetch. 시험이 GitHub 클라이언트에 넘긴다. */
    fetch: async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      const { pathname, search } = new URL(url);
      const answer = respond(init.method ?? "GET", `${pathname}${search}`, typeof init.body === "string" ? init.body : "");
      return new Response(answer.body === null ? null : JSON.stringify(answer.body), { status: answer.status, headers: answer.headers });
    },
  };
}

/** 127.0.0.1 에 띄운다. port 0 이면 빈 포트를 운영체제가 고른다. */
export async function startGitHubStub({ port = 0 } = {}) {
  let stub = null;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const answer = stub.respond(request.method ?? "GET", request.url ?? "/", body);
      response.writeHead(answer.status, answer.headers);
      response.end(answer.body === null ? undefined : JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  stub = createGitHubStub({ origin });
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
  const at = process.argv.indexOf("--port");
  const port = at === -1 ? 4010 : Number.parseInt(process.argv[at + 1], 10);
  const stub = await startGitHubStub({ port });
  console.log(`가짜 GitHub API: ${stub.origin}  (GITHUB_API_BASE=${stub.origin})`);
}
