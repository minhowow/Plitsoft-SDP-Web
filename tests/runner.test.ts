import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { postAnalysis, postRunnerClaim, postRunnerEvent, type ApiDeps } from "@/server/api";
import { readConfig } from "@/server/config";
import { openDatabase, type Database } from "@/server/db";
import { createGitHub } from "@/server/github";
import { sign as serverSign } from "@/server/signature";
import { createDbStore } from "@/server/store/db";
import {
  checkFileCount,
  checkResultSize,
  childEnv,
  copyRepository,
  countJsTs,
  fetchRepository,
  installCli,
  logTail,
  notifyPart,
  readInputs,
  resultBody,
  reviewArgs,
  reviewOptions,
  runProfile,
  runReview,
  runScan,
  sign as runnerSign,
  StepError,
} from "../runner/run.mjs";
import { extractTar, extractTarGz } from "../runner/tar.mjs";
import { createGitHubStub } from "../scripts/github-stub.mjs";
import { main as localRunner, NO_CAPTURE, parseArgs as localArgs, sourceFor, UNKNOWN_REPOSITORY } from "../scripts/local-runner.mjs";
import { root } from "./helpers";

// 실행기(runner/run.mjs, runner/tar.mjs)와 로컬 실행기(scripts/local-runner.mjs). 실제 GitHub·Anthropic·CLI 를 부르지 않는다.
// 압축 파일은 시험이 손으로 만들고, CLI 는 가짜 spawn 으로 바꾼다. 로컬 실행기는 --fixture 로만 돈다.

let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "runner-test-"));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

// ---- 시험용 tar 만들기 ----

type Entry = { name: string; type?: string; data?: string | Buffer; linkname?: string; prefix?: string };

function header(name: string, size: number, type: string, linkname = "", prefix = ""): Buffer {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, "utf8");
  block.write("0000644\0", 100);
  block.write("0000000\0", 108);
  block.write("0000000\0", 116);
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
  block.write("00000000000\0", 136);
  block.write("        ", 148);
  block.write(type, 156);
  block.write(linkname, 157, 100, "utf8");
  block.write("ustar\0", 257);
  block.write("00", 263);
  block.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return block;
}

function tar(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? "");
    parts.push(header(entry.name, data.length, entry.type ?? "0", entry.linkname, entry.prefix));
    parts.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

const pax = (records: Record<string, string>) =>
  Buffer.from(
    Object.entries(records)
      .map(([key, value]) => {
        const body = ` ${key}=${value}\n`;
        let length = Buffer.byteLength(body) + 1;
        while (String(length).length + Buffer.byteLength(body) !== length) length = String(length).length + Buffer.byteLength(body);
        return `${length}${body}`;
      })
      .join(""),
  );

const TOP = "example-org-kids-signup-e8d8015/";

describe("압축 풀기 (runner/tar.mjs)", () => {
  it("최상위 폴더를 떼고 일반 파일·폴더만 푼다. 파일은 실행 권한 없이 쓴다", () => {
    const counts = extractTarGz(
      gzipSync(
        tar([
          { name: "pax_global_header", type: "g", data: pax({ comment: "e8d8015c26e6e1c553cf79187eabc073558efe4c" }) },
          { name: TOP, type: "5" },
          { name: `${TOP}src/`, type: "5" },
          { name: `${TOP}src/app.ts`, data: "export const a = 1;\n" },
          { name: `${TOP}run.sh`, data: "#!/bin/sh\n" },
        ]),
      ),
      path.join(scratch, "out"),
      { maxBytes: 1_000_000 },
    );
    expect(counts).toEqual({ files: 2, bytes: 30, links: 0, others: 0 });
    expect(readFileSync(path.join(scratch, "out", "src", "app.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(lstatSync(path.join(scratch, "out", "run.sh")).mode & 0o111).toBe(0);
    expect(existsSync(path.join(scratch, "out", "pax_global_header"))).toBe(false);
  });

  it("심볼릭 링크와 하드 링크는 만들지 않고 센다", () => {
    const counts = extractTar(
      tar([
        { name: `${TOP}src/real.ts`, data: "x" },
        { name: `${TOP}src/link.ts`, type: "2", linkname: "/etc/passwd" },
        { name: `${TOP}src/hard.ts`, type: "1", linkname: `${TOP}src/real.ts` },
      ]),
      path.join(scratch, "out"),
    );
    expect(counts.links).toBe(2);
    expect(readdirSync(path.join(scratch, "out", "src"))).toEqual(["real.ts"]);
  });

  it.each([
    ["..", `${TOP}../escape.ts`],
    ["절대 경로", "/tmp/escape.ts"],
    ["가운데 ..", `${TOP}src/../../escape.ts`],
    ["역빗금", `${TOP}src\\..\\..\\escape.ts`],
    ["밖을 가리키는 링크 이름", `${TOP}../link`],
  ])("경로가 폴더 밖을 가리키면(%s) 압축 파일 전체를 받지 않는다", (_what, name) => {
    const entries: Entry[] = [{ name: `${TOP}ok.ts`, data: "ok" }, { name, data: "bad", type: name.endsWith("link") ? "2" : "0" }];
    expect(() => extractTar(tar(entries), path.join(scratch, "out"))).toThrow("저장소 밖을 가리키는 경로");
    expect(existsSync(path.join(scratch, "escape.ts"))).toBe(false);
  });

  it("pax 의 path 와 GNU 긴 이름도 같은 검사를 받는다", () => {
    const long = `${TOP}${"d/".repeat(70)}deep.ts`;
    const counts = extractTar(
      tar([
        { name: "PaxHeader", type: "x", data: pax({ path: `${TOP}한글 이름.ts` }) },
        { name: "short", data: "pax" },
        { name: "././@LongLink", type: "L", data: `${long}\0` },
        { name: long.slice(0, 99), data: "gnu" },
      ]),
      path.join(scratch, "out"),
    );
    expect(counts.files).toBe(2);
    expect(readFileSync(path.join(scratch, "out", "한글 이름.ts"), "utf8")).toBe("pax");
    expect(readFileSync(path.join(scratch, "out", ...Array(70).fill("d"), "deep.ts"), "utf8")).toBe("gnu");
    expect(() =>
      extractTar(tar([{ name: "PaxHeader", type: "x", data: pax({ path: `${TOP}../../x.ts` }) }, { name: "short", data: "x" }]), path.join(scratch, "o2")),
    ).toThrow("저장소 밖을 가리키는 경로");
  });

  it("푼 크기 상한을 넘으면(압축 폭탄) 그만 푼다. gzip 이 아니거나 머리가 깨졌으면 받지 않는다", () => {
    const bomb = gzipSync(tar([{ name: `${TOP}zeros.ts`, data: Buffer.alloc(2_000_000) }]));
    expect(bomb.length).toBeLessThan(10_000);
    expect(() => extractTarGz(bomb, path.join(scratch, "out"), { maxBytes: 1_000_000 })).toThrow("상한");
    expect(() => extractTarGz(Buffer.from("not gzip"), path.join(scratch, "o2"), { maxBytes: 1_000_000 })).toThrow("풀지 못했습니다");
    const broken = tar([{ name: `${TOP}a.ts`, data: "a" }]);
    broken[0] ^= 0xff;
    expect(() => extractTar(broken, path.join(scratch, "o3"))).toThrow("깨져");
  });
});

describe("저장소 받기 (fetchRepository)", () => {
  const archive = gzipSync(tar([{ name: `${TOP}src/a.ts`, data: "a" }]));
  const respond = (status: number, body: Buffer | null, headers: Record<string, string> = {}) =>
    (async () => new Response(body === null ? null : new Uint8Array(body), { status, headers })) as unknown as typeof fetch;

  it("그 커밋의 tarball 을 받는다. 토큰이 있으면 머리에만 싣는다", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get("authorization") });
      return new Response(new Uint8Array(archive), { status: 200 });
    }) as unknown as typeof fetch;
    const commit = "e8d8015c26e6e1c553cf79187eabc073558efe4c";
    await fetchRepository({ apiBase: "http://gh.test", owner: "o", repo: "r", commit, token: "t0ken", dest: path.join(scratch, "src"), maxTarballBytes: 1e6, maxExtractBytes: 1e6, fetcher });
    expect(seen).toEqual([{ url: `http://gh.test/repos/o/r/tarball/${commit}`, auth: "Bearer t0ken" }]);
    expect(readFileSync(path.join(scratch, "src", "src", "a.ts"), "utf8")).toBe("a");
  });

  it("없음·큰 압축 파일·응답 오류는 저장소 받기 단계의 까닭이 된다", async () => {
    const base = { apiBase: "http://gh.test", owner: "o", repo: "r", commit: "a".repeat(40), token: null, dest: path.join(scratch, "src"), maxTarballBytes: 100, maxExtractBytes: 1e6 };
    const failure = async (fetcher: typeof fetch) => {
      try {
        await fetchRepository({ ...base, fetcher });
      } catch (error) {
        return error as StepError;
      }
      throw new Error("던지지 않았다");
    };
    expect(await failure(respond(404, null))).toMatchObject({ step: "fetch", reason: expect.stringContaining("없거나 비공개") });
    expect(await failure(respond(200, Buffer.alloc(500)))).toMatchObject({ step: "fetch", reason: expect.stringContaining("상한") });
    expect(await failure(respond(200, Buffer.alloc(10), { "content-length": "999999" }))).toMatchObject({ reason: expect.stringContaining("상한") });
    expect(await failure(respond(502, Buffer.alloc(1)))).toMatchObject({ reason: expect.stringContaining("응답 502") });
  });
});

describe("입력·파일 수·결과 크기", () => {
  const good = {
    ANALYSIS_ID: "abcdefghjk",
    REPO_OWNER: "example-org",
    REPO_NAME: "kids.signup",
    REPO_COMMIT: "a".repeat(40),
    CALLBACK_URL: "https://site.example/api/runner/abcdefghjk/",
    SITE_ORIGIN: "https://site.example",
  };

  it("워크플로 입력의 모양을 본다. 콜백 주소는 https 이고 그 분석의 주소여야 한다", () => {
    expect(readInputs(good).problems).toEqual([]);
    for (const [key, value] of [
      ["ANALYSIS_ID", "ABC"],
      ["REPO_OWNER", "a;rm -rf /"],
      ["REPO_NAME", ".."],
      ["REPO_COMMIT", "main"],
      ["CALLBACK_URL", "http://site.example/api/runner/abcdefghjk/"],
      ["CALLBACK_URL", "https://site.example/api/runner/zzzzzzzzzz/"],
      ["CALLBACK_URL", "https://user:pw@site.example/api/runner/abcdefghjk/"],
      ["CALLBACK_URL", "https://site.example/api/runner/abcdefghjk/?x=1"],
      // 콜백 주소의 출처는 워크플로 파일이 정한 사이트(SITE_ORIGIN)와 같아야 한다(입력으로 다른 곳에 돌리지 못한다).
      ["CALLBACK_URL", "https://evil.example/api/runner/abcdefghjk/"],
      ["CALLBACK_URL", "https://site.example:8443/api/runner/abcdefghjk/"],
      ["SITE_ORIGIN", ""],
      ["SITE_ORIGIN", "not a url"],
    ]) {
      expect(readInputs({ ...good, [key]: value }).problems.length, `${key}=${value}`).toBeGreaterThan(0);
    }
    expect(
      readInputs({ ...good, CALLBACK_URL: "http://127.0.0.1:3000/api/runner/abcdefghjk/", SITE_ORIGIN: "http://127.0.0.1:3000" }, { allowHttp: true }).problems,
    ).toEqual([]);
    expect(readInputs({ ...good, SITE_ORIGIN: "https://site.example/" }).problems).toEqual([]);
  });

  it("JS/TS 파일 수는 CLI 가 보지 않는 폴더(node_modules 등)와 심볼릭 링크를 빼고 센다. 상한을 넘으면 저장소 받기에서 멈춘다", () => {
    const dir = path.join(scratch, "repo");
    for (const file of ["src/a.ts", "src/b.tsx", "src/c.mjs", "README.md", "node_modules/x/index.js", "dist/out.js", "src/d.cjs"]) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), "");
    }
    symlinkSync(path.join(dir, "src"), path.join(dir, "loop"));
    expect(countJsTs(dir)).toBe(4);
    expect(checkFileCount(dir, 4)).toBe(4);
    expect(() => checkFileCount(dir, 3)).toThrow("상한(3개)");
    // 로컬 폴더를 옮길 때도 링크는 옮기지 않는다.
    copyRepository(dir, path.join(scratch, "copy"));
    expect(existsSync(path.join(scratch, "copy", "loop"))).toBe(false);
    expect(existsSync(path.join(scratch, "copy", "src", "a.ts"))).toBe(true);
  });

  it("결과 크기 상한을 넘으면 정리 단계에서 멈춘다", () => {
    expect(() => checkResultSize("x".repeat(2048), 2)).not.toThrow();
    expect(() => checkResultSize("x".repeat(2049), 2)).toThrow(StepError);
  });

  it("실패한 자식 과정의 표준 오류는 끝부분만, 비밀값을 가려 로그에 남긴다", () => {
    const lines: string[] = [];
    const env = { CLI_REPO_TOKEN: "ghp_secret", ANTHROPIC_API_KEY: "sk-ant-k" };
    logTail("CLI 설치", `${"a".repeat(3000)}\nfatal: https://x-access-token:ghp_secret@github.com/x sk-ant-k`, env, { log: (text: string) => lines.push(text) });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("ghp_secret");
    expect(lines[0]).not.toContain("sk-ant-k");
    expect(lines[0]).toContain("x-access-token:***@github.com");
    expect(lines[0].length).toBeLessThan(2100);
    logTail("검사", "  \n", env, { log: (text: string) => lines.push(text) });
    expect(lines).toHaveLength(1);
  });
});

describe("도구 설치와 검사", () => {
  it("검사 명령: policypack scan . --judge <판정자> --output-format json 을 저장소 폴더에서, 넘긴 환경만으로 돌린다", () => {
    const calls: { bin: string; args: string[]; cwd: string; env: Record<string, string> }[] = [];
    const fake = ((bin: string, args: string[], options: { cwd: string; env: Record<string, string> }) => {
      calls.push({ bin, args, cwd: options.cwd, env: options.env });
      return { status: 1, stdout: '{"ok":1}', stderr: "" };
    }) as never;
    const env = childEnv({ PATH: "/bin", HOME: "/h", RUNNER_SECRET: "s", GITHUB_TOKEN: "g" }, { ANTHROPIC_API_KEY: "k" });
    expect(runScan({ dir: "/w/src", judge: "anthropic:haiku", env, timeoutMs: 1000, run: fake })).toBe('{"ok":1}');
    expect(calls).toEqual([
      { bin: "policypack", args: ["scan", ".", "--judge", "anthropic:haiku", "--output-format", "json"], cwd: "/w/src", env: { PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "k" } },
    ]);
  });

  it("종료 코드 0·1 은 결과, 2 는 검사 단계의 실패, 빈 출력·시간 초과도 실패다", () => {
    const with_ = (result: object) => () => runScan({ dir: ".", judge: "none", env: {}, timeoutMs: 60_000, run: (() => result) as never });
    expect(with_({ status: 0, stdout: "{}" })()).toBe("{}");
    expect(with_({ status: 2, stdout: "" })).toThrow("종료 코드 2");
    expect(with_({ status: 0, stdout: "  " })).toThrow("결과를 내지 않았습니다");
    expect(with_({ status: null, error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }) })).toThrow("1분 안에 끝나지 않아");
  });

  it("저장소 프로필: policypack profile . 을 저장소 폴더에서 돌린다. 실패해도 던지지 않고 null 이며, 까닭의 비밀값은 가린다", () => {
    const calls: { args: string[]; cwd: string }[] = [];
    const ok = ((_bin: string, args: string[], options: { cwd: string }) => {
      calls.push({ args, cwd: options.cwd });
      return { status: 0, stdout: '{"profile_version":1,"features":[]}', stderr: "" };
    }) as never;
    expect(runProfile({ dir: "/w/src", env: {}, timeoutMs: 1000, run: ok })).toEqual({ profile_version: 1, features: [] });
    expect(calls).toEqual([{ args: ["profile", "."], cwd: "/w/src" }]);
    const logged: string[] = [];
    const failed = (result: object) =>
      runProfile({ dir: ".", env: { RUNNER_SECRET: "sek" }, timeoutMs: 60_000, run: (() => result) as never, log: (line: string) => logged.push(line) });
    expect(failed({ status: 2, stdout: "", stderr: "boom sek" })).toBeNull();
    expect(failed({ status: null, error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }) })).toBeNull();
    expect(failed({ status: 0, stdout: "not json", stderr: "" })).toBeNull();
    expect(logged.join("\n")).toContain("boom ***");
    expect(logged.join("\n")).not.toContain("sek");
  });

  it("결과 콜백의 본문: 프로필·review 를 실으면 상한을 넘을 때 review 를 먼저, 그다음 프로필을 빼고 보낸다. 결과만으로 넘으면 멈춘다", () => {
    const ctx = { target: { owner: "o", repo: "r", commit: "a".repeat(40) } };
    const quiet = { log: () => {} };
    const profile = { profile_version: 1 };
    const review = { review_version: 2 };
    const bigProfile = { profile_version: 1, features: [], pad: "x".repeat(4000) };
    const bigReview = { review_version: 2, pad: "x".repeat(4000) };
    expect(resultBody(ctx, "{}", { profile, review }, 1, quiet)).toEqual({ profile, review });
    expect(resultBody(ctx, "{}", { profile, review: bigReview }, 1, quiet)).toEqual({ profile, review: null });
    expect(resultBody(ctx, "{}", { profile: bigProfile, review }, 1, quiet)).toEqual({ profile: null, review: null });
    expect(resultBody(ctx, "{}", { profile: bigProfile, review: null }, 1, quiet)).toEqual({ profile: null, review: null });
    expect(() => resultBody(ctx, "y".repeat(2000), { profile: null, review: null }, 1, quiet)).toThrow("결과가 너무 큽니다");
  });

  it("review: 워크플로의 REVIEW_* 를 CLI 옵션으로 넘긴다(한 건의 금액·시간 상한). 실패해도 던지지 않고 null 이며, 까닭의 비밀값은 가린다", () => {
    // 기본값은 워크플로에 값이 없을 때다(조사 haiku, 반박 sonnet, $3, 420초).
    expect(reviewArgs(reviewOptions({}))).toEqual([
      "review", ".", "--model", "anthropic:claude-haiku-5-5", "--checker", "anthropic:claude-sonnet-5-5", "--max-usd", "3", "--time-limit", "420",
    ]);
    const options = reviewOptions({ REVIEW_MODEL: "anthropic:m1", REVIEW_CHECKER: "anthropic:m2", REVIEW_MAX_USD: "0.5", REVIEW_TIME_LIMIT_SECONDS: "120" });
    expect(reviewArgs(options)).toEqual(["review", ".", "--model", "anthropic:m1", "--checker", "anthropic:m2", "--max-usd", "0.5", "--time-limit", "120"]);
    // 읽을 수 없는 상한은 기본값이고, 모양이 맞지 않는 모델 id 는 돌리지 않는다.
    expect(reviewOptions({ REVIEW_MAX_USD: "-1", REVIEW_TIME_LIMIT_SECONDS: "x" })).toMatchObject({ maxUsd: 3, timeLimitSeconds: 420 });
    expect(reviewArgs({ ...options, model: "a b" })).toBeNull();

    const calls: { args: string[]; cwd: string; timeout: number; key?: string }[] = [];
    const ok = ((_bin: string, args: string[], o: { cwd: string; timeout: number; env: Record<string, string> }) => {
      calls.push({ args, cwd: o.cwd, timeout: o.timeout, key: o.env.ANTHROPIC_API_KEY });
      return { status: 0, stdout: '{"review_version":2}', stderr: "" };
    }) as never;
    expect(runReview({ dir: "/w/src", env: { ANTHROPIC_API_KEY: "k" }, options, run: ok })).toEqual({ review_version: 2 });
    // 과정은 시간 상한에 틈(90초)을 더한 만큼 기다린다.
    expect(calls).toEqual([{ args: reviewArgs(options), cwd: "/w/src", timeout: (120 + 90) * 1000, key: "k" }]);
    const logged: string[] = [];
    const failed = (result: object) =>
      runReview({ dir: ".", env: { ANTHROPIC_API_KEY: "sek" }, options, run: (() => result) as never, log: (line: string) => logged.push(line) });
    expect(failed({ status: 1, stdout: "", stderr: "boom sek" })).toBeNull();
    expect(failed({ status: null, error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }) })).toBeNull();
    expect(failed({ status: 0, stdout: "not json", stderr: "" })).toBeNull();
    expect(logged.join("\n")).toContain("boom ***");
    expect(logged.join("\n")).not.toContain("sek");
  });

  it("도구 설치: uv 판·CLI 저장소·커밋이 고정 모양이 아니면 설치하지 않는다. CLI 저장소 토큰은 git 설정 환경으로만 넘긴다", () => {
    const calls: { bin: string; args: string[]; env: Record<string, string> }[] = [];
    const fake = ((bin: string, args: string[], options: { env: Record<string, string> }) => {
      calls.push({ bin, args, env: options.env });
      return { status: 0 };
    }) as never;
    const env = { PATH: "/bin", UV_VERSION: "0.13.0", CLI_REPO: "minhowow/Plitsoft-SDP", CLI_COMMIT: "7300205b7e0db18e171aa2d730120416f2136d3c", CLI_EXCLUDE_NEWER: "2026-10-08T00:00:00Z", CLI_REPO_TOKEN: "tok" };
    installCli(env, { run: fake });
    expect(calls.map((c) => [c.bin, ...c.args])).toEqual([
      ["pipx", "install", "uv==0.13.0"],
      ["uv", "tool", "install", "--quiet", "--python", "3.12", "--exclude-newer", "2026-10-08T00:00:00Z", "policypack @ git+https://github.com/minhowow/Plitsoft-SDP@7300205b7e0db18e171aa2d730120416f2136d3c"],
    ]);
    expect(JSON.stringify(calls.map((c) => c.args))).not.toContain("tok");
    expect(calls[0].env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(calls[1].env.GIT_CONFIG_KEY_0).toContain("tok");
    for (const bad of [{ UV_VERSION: "latest" }, { CLI_COMMIT: "main" }, { CLI_REPO: "a b" }, { CLI_EXCLUDE_NEWER: "" }, { CLI_EXCLUDE_NEWER: "2026-10-08" }]) {
      expect(() => installCli({ ...env, ...bad }, { run: fake }), JSON.stringify(bad)).toThrow("도구를 설치하지 못했습니다");
    }
  });
});

describe("검사 단계 안의 일 알림 (2026-11-13)", () => {
  const ID = "abcdefghjk";
  const target = { owner: "example-org", repo: "kids-signup", commit: "e".repeat(40) };
  const ctxWith = (fetcher: (url: string, init: RequestInit) => Promise<Response>, secret = "s") => ({
    analysisId: ID,
    callbackUrl: `https://site.test/api/runner/${ID}/`,
    secret,
    target,
    fetcher,
    retryDelayMs: 1,
  });

  it("서명한 { event: part, part, target } 을 보낸다. 받지 않거나 닿지 못해도 던지지 않고 false 이며 로그만 남긴다", async () => {
    const sent: { body: string; signature: string | null }[] = [];
    const answer = (status: number, message = "") => async (_url: string, init: RequestInit) => {
      sent.push({ body: String(init.body), signature: new Headers(init.headers).get("x-runner-signature") });
      return new Response(JSON.stringify({ ok: status === 200, message }), { status });
    };
    const logs: string[] = [];
    const log = (line: string) => logs.push(line);
    expect(await notifyPart(ctxWith(answer(200)), "profile", { log })).toBe(true);
    expect(JSON.parse(sent[0].body)).toEqual({ event: "part", part: "profile", target });
    expect(sent[0].signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(await notifyPart(ctxWith(answer(409, "검사 단계 안의 일은 검사 단계에서만 받습니다.")), "review", { log })).toBe(false);
    expect(logs.at(-1)).toContain("검사 단계에서만 받습니다");
    // 5xx 는 한 번 더 보낸 뒤 그만둔다.
    sent.length = 0;
    expect(await notifyPart(ctxWith(answer(503)), "review", { log })).toBe(false);
    expect(sent).toHaveLength(2);
    expect(await notifyPart(ctxWith(async () => Promise.reject(new Error("down"))), "profile", { log })).toBe(false);
    expect(logs.at(-1)).toContain("알리지 못했습니다");
    // 서명 열쇠가 없거나 모르는 일이면 보내지 않는다.
    sent.length = 0;
    expect(await notifyPart(ctxWith(answer(200), ""), "profile", { log })).toBe(false);
    expect(await notifyPart(ctxWith(answer(200)), "judge", { log })).toBe(false);
    expect(sent).toHaveLength(0);
  });

  /** 워크플로처럼 실행기 명령 하나를 따로 돌린다. 콜백 주소는 닿지 않는 곳이다. CLI 는 PATH 에 없다. */
  const runCommand = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [path.join(root, "runner", "run.mjs"), ...args], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        NODE_ENV: "test",
        PATH: path.dirname(process.execPath),
        WORK_DIR: scratch,
        ANALYSIS_ID: ID,
        REPO_OWNER: target.owner,
        REPO_NAME: target.repo,
        REPO_COMMIT: target.commit,
        CALLBACK_URL: `https://127.0.0.1:1/api/runner/${ID}/`,
        SITE_ORIGIN: "https://127.0.0.1:1",
        ...env,
      },
    });
  const state = () => JSON.parse(readFileSync(path.join(scratch, "state.json"), "utf8")) as { step: string; reason: string | null; refused?: boolean };

  it("part 는 알리지 못해도 성공으로 끝나고 형편 파일을 바꾸지 않는다. 프로필·review 는 따로 돌고 실패해도 성공으로 끝난다", () => {
    mkdirSync(path.join(scratch, "src"), { recursive: true });
    writeFileSync(path.join(scratch, "state.json"), JSON.stringify({ step: "scan", reason: null }));
    const part = runCommand(["part", "profile"], { RUNNER_SECRET: "s" });
    expect(part.status, part.stderr).toBe(0);
    expect(part.stderr).toContain("알리지 못했습니다");
    expect(state()).toEqual({ step: "scan", reason: null });
    expect(runCommand(["part", "judge"], { RUNNER_SECRET: "s" }).status).toBe(0);
    expect(state()).toEqual({ step: "scan", reason: null });
    // 프로필: CLI 가 없으면 파일을 남기지 않고(앞의 것도 지운다) 성공으로 끝난다. 멈추면 검사 단계의 멈춤이다.
    writeFileSync(path.join(scratch, "profile.json"), "{}");
    const profile = runCommand(["profile"]);
    expect(profile.status, profile.stderr).toBe(0);
    expect(profile.stderr).toContain("저장소 프로필을 만들지 못했습니다");
    expect(existsSync(path.join(scratch, "profile.json"))).toBe(false);
    expect(state()).toEqual({ step: "scan", reason: null });
    // review: 입력이 "true" 가 아니면 돌리지 않고 앞의 파일을 지운다. "true" 라도 키가 없으면 돌리지 않는다.
    writeFileSync(path.join(scratch, "review.json"), "{}");
    expect(runCommand(["review"]).status).toBe(0);
    expect(existsSync(path.join(scratch, "review.json"))).toBe(false);
    const noKey = runCommand(["review"], { REVIEW: "true" });
    expect(noKey.status).toBe(0);
    expect(noKey.stderr).toContain("review 를 돌리지 않았습니다");
    // 검사는 키가 없으면 검사 단계에서 멈춘다(여기서만 실패로 끝난다).
    const scan = runCommand(["scan"], { JUDGE_MODEL: "claude-haiku-5-5" });
    expect(scan.status).toBe(1);
    expect(state()).toMatchObject({ step: "scan", reason: "실행기에 AI 판정자의 API 키가 없어 검사하지 않았습니다." });
  });
});

describe("서명: 실행기와 서버가 같은 글을 서명한다", () => {
  it("runner/run.mjs 의 sign 과 src/server/signature.ts 의 sign 이 같다", () => {
    for (const [scope, body] of [["abcdefghjk", '{"event":"step","step":"fetch"}'], ["claim", "{}"], ["abcdefghjk", "한글 본문"]]) {
      expect(runnerSign("s3cret", "1762138800", scope, body)).toBe(serverSign("s3cret", "1762138800", scope, body));
    }
  });
});

describe("워크플로 (.github/workflows/analyze.yml)", () => {
  const workflow = readFileSync(path.join(root, ".github", "workflows", "analyze.yml"), "utf8");

  it("workflow_dispatch 의 입력은 사이트가 보내는 다섯이고(src/server/runner.ts), 셸 글에 끼워 넣지 않는다", () => {
    expect(workflow).toMatch(/workflow_dispatch:/);
    for (const input of ["analysis_id", "owner", "repo", "commit", "callback_url"]) expect(workflow).toContain(`      ${input}:\n`);
    // run: 줄에는 ${{ }} 가 없다(입력은 env 로만 넘긴다).
    for (const line of workflow.split("\n").filter((l) => /^\s*run:/.test(l))) expect(line, line).not.toContain("${{");
  });

  it("job 의 env 에는 그 자리에서 쓸 수 있는 문맥(inputs·vars·secrets·github 등)만 쓴다. runner 문맥은 쓰면 워크플로가 거절된다", () => {
    const jobEnv = workflow.split(/\n    env:\n/)[1].split(/\n    steps:\n/)[0];
    expect(jobEnv).not.toMatch(/\$\{\{\s*(runner|job|steps|env)\./);
  });

  it("실행 시간 상한 30분(검사 15분 + 프로필 3분 + 켰을 때 review 6분 + 받기·설치), 도구는 이 파일에서 고정(CLI 저장소·커밋, uv 판), 비밀값은 그것이 필요한 단계에만", () => {
    expect(workflow).toMatch(/timeout-minutes: 30\n/);
    // review 는 입력(기본 "false")으로만 켜고, 한 건의 상한은 이 파일에서 정한다. 입력은 셸 글이 아니라 환경 변수로 넘긴다.
    expect(workflow).toMatch(/ {6}review:\n {8}description: [^\n]+\n {8}required: false\n {8}default: "false"\n {8}type: string\n/);
    expect(workflow).toMatch(/REVIEW: \$\{\{ inputs\.review \}\}\n/);
    for (const name of ["REVIEW_MODEL", "REVIEW_CHECKER", "REVIEW_MAX_USD", "REVIEW_TIME_LIMIT_SECONDS"]) expect(workflow).toContain(`\n      ${name}: `);
    expect(workflow).toMatch(/CLI_REPO: minhowow\/Plitsoft-SDP\n/);
    expect(workflow).toMatch(/CLI_COMMIT: [0-9a-f]{40}\n/);
    expect(workflow).toMatch(/UV_VERSION: \d+\.\d+\.\d+\n/);
    // 딸린 꾸러미의 판을 고정한 날짜까지로 묶는다. 그 날짜는 고정 커밋의 날짜이고(계약 시험), 오늘보다 앞이다.
    const excludeNewer = /CLI_EXCLUDE_NEWER: "(\d{4}-\d{2}-\d{2})T00:00:00Z"\n/.exec(workflow);
    expect(excludeNewer).not.toBeNull();
    expect(Date.parse(`${excludeNewer![1]}T00:00:00Z`)).toBeLessThanOrEqual(Date.now());
    // 콜백 받을 사이트는 워크플로 입력이 아니라 Actions 변수에서 온다.
    expect(workflow).toMatch(/SITE_ORIGIN: \$\{\{ vars\.SITE_URL \}\}\n/);
    expect(workflow).toMatch(/permissions:\n {2}contents: read\n/);
    // 단계별로 나눈다: 어느 단계가 어느 비밀값을 받는지.
    const steps = workflow.split(/\n {6}- name: /).slice(1);
    const secretsOf = (step: string) => [...step.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    const byName = Object.fromEntries(steps.map((step) => [step.split("\n")[0], secretsOf(step)]));
    expect(byName).toEqual({
      "실행기 코드 받기": [],
      "입력 확인": [],
      '"알림: 저장소 받기·도구 설치 시작"': ["RUNNER_SECRET"],
      "저장소 받기": [],
      "도구 설치": ["CLI_REPO_TOKEN"],
      '"알림: 검사 시작"': ["RUNNER_SECRET"],
      "검사(정적 검사와 AI 판정)": ["ANTHROPIC_API_KEY"],
      '"알림: 저장소 프로필 시작"': ["RUNNER_SECRET"],
      "저장소 프로필(모델 호출 없음)": [],
      '"알림: review 시작"': ["RUNNER_SECRET"],
      'review(입력 review 가 "true" 일 때만)': ["ANTHROPIC_API_KEY"],
      "정리(결과 보내기)": ["RUNNER_SECRET"],
      '"알림: 멈춤"': ["RUNNER_SECRET"],
    });
    // 단계마다 부르는 실행기 명령. 검사 단계 안의 일(프로필, review)은 시작을 알린 뒤 돈다. review 와 그 알림은 입력이 "true" 일 때만.
    const runOf = Object.fromEntries(steps.map((step) => [step.split("\n")[0], /\n {8}run: (.+)/.exec(step)?.[1]]));
    expect(Object.values(runOf).filter(Boolean)).toEqual([
      "node runner/run.mjs check",
      "node runner/run.mjs notify fetch",
      "node runner/run.mjs fetch",
      "node runner/run.mjs install",
      "node runner/run.mjs notify scan",
      "node runner/run.mjs scan",
      "node runner/run.mjs part profile",
      "node runner/run.mjs profile",
      "node runner/run.mjs part review",
      "node runner/run.mjs review",
      "node runner/run.mjs finish",
      "node runner/run.mjs fail",
    ]);
    const ifOf = Object.fromEntries(steps.map((step) => [step.split("\n")[0], /\n {8}if: (.+)/.exec(step)?.[1] ?? null]));
    expect(ifOf['"알림: review 시작"']).toBe("env.REVIEW == 'true'");
    expect(ifOf['review(입력 review 가 "true" 일 때만)']).toBe("env.REVIEW == 'true'");
    expect(ifOf['"알림: 저장소 프로필 시작"']).toBeNull();
    // 쓰는 action 은 커밋으로 고정한다.
    for (const match of workflow.matchAll(/uses: (\S+)/g)) expect(match[1]).toMatch(/@[0-9a-f]{40}$/);
    // 대상 코드를 설치·빌드·실행하지 않는다.
    expect(workflow).not.toMatch(/npm (install|ci|run)|yarn|pnpm|npx/);
  });
});

// ---- 로컬 실행기: 요청 → 집어 감 → 단계 콜백 → 결과 (--fixture) ----

describe("로컬 실행기 (scripts/local-runner.mjs --fixture)", () => {
  const SECRET = "local-test-secret";
  let db: Database;
  let server: Server;
  let site: string;
  let deps: ApiDeps;

  beforeAll(async () => {
    db = await openDatabase({ databaseUrl: null, pgliteDir: "memory://" });
    const stub = createGitHubStub({ origin: "http://stub.test" });
    // 설정의 GitHub 주소도 가짜 GitHub 이다(로컬 실행기 + 실제 GitHub 은 요청을 받지 않는다. 재디자인 D4).
    const config = readConfig({ RUNNER: "local", RUNNER_SECRET: SECRET, POOL_SIZE: "5", GITHUB_API_BASE: "http://stub.test" });
    const store = createDbStore({
      db: async () => db,
      github: createGitHub({ apiBase: "http://stub.test", token: null, searchCacheSeconds: 60, repoCacheSeconds: 300, fetch: stub.fetch as typeof fetch }),
      config,
    });
    deps = { store: () => store, db: async () => db, config: () => config, now: () => new Date() };
    // route handler 대신 같은 함수를 부르는 작은 서버.
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) });
      const match = /^\/api\/runner\/([^/]+)\/$/.exec(req.url ?? "");
      const response = req.url === "/api/runner/claim/" ? await postRunnerClaim(request, deps) : match ? await postRunnerEvent(request, match[1], deps) : new Response(null, { status: 404 });
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    site = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await db?.close();
  });

  const request = async (owner: string, repo: string) => {
    const response = await postAnalysis(new Request(`${site}/api/analyses/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, repo }) }), deps);
    return ((await response.json()) as { analysis: { id: string } }).analysis.id;
  };

  it("대기 중인 분석을 모두 집어 끝까지 돌린다. 결과는 그 저장소의 합성 데모 코드 수집본 그대로다", async () => {
    const kids = await request("example-org", "kids-signup");
    const chat = await request("Example-Studio", "GenAI-Chat");
    await localRunner(["--fixture", "--once", "--site", site], { RUNNER_SECRET: SECRET });
    for (const [id, fixture] of [[kids, "kids-signup"], [chat, "genai-chat"]]) {
      const analysis = await deps.store().findAnalysis(id);
      expect(analysis?.status, id).toBe("succeeded");
      expect(analysis?.steps.every((step) => step.startedAt && step.endedAt)).toBe(true);
      expect(await deps.store().getResult(id)).toEqual(JSON.parse(readFileSync(path.join(root, "contract", "cli-current", `${fixture}.main.json`), "utf8")));
      // 저장소 프로필도 같은 표본의 수집본을 함께 보낸다. 프로필을 시작할 때 알렸다(review 는 맡기지 않아 알리지 않는다).
      expect((await deps.store().getProfile(id))?.features.length, id).toBeGreaterThan(0);
      expect(analysis?.scanPart?.name, id).toBe("profile");
    }
    expect(sourceFor("example-labs", "plain.utils", { source: null })?.dir).toBe(path.join(root, "contract", "fixtures", "plain", "main"));
    // --source 를 줘도 합성 저장소는 제 합성 데모 코드다(다른 폴더의 코드가 그 이름에 붙지 않는다).
    expect(sourceFor("example-labs", "plain.utils", { source: "/x" })?.dir).toBe(path.join(root, "contract", "fixtures", "plain", "main"));
    // 가짜 GitHub 의 목록에 없는 저장소는 --source 를 직접 준 때만 그 폴더(수집본 없음)이고, 아니면 검사하지 않는다(재디자인 D4).
    expect(sourceFor("someone", "else", { source: "/x" })).toEqual({ dir: "/x", capture: null });
    expect(sourceFor("someone", "else", { source: null })).toBeNull();
    // 합성 데모 코드가 없는 합성 저장소(크기 상한을 넘는 것)도 같다.
    expect(sourceFor("example-labs", "huge-monorepo", { source: null })).toBeNull();
    expect(localArgs([]).source).toBeNull();
  });

  /** 가짜 GitHub 에 없는 저장소의 분석이 대기열에 있는 것처럼 만든다(사이트는 가짜 GitHub 에 있는 저장소만 받으므로). */
  const unknownRepository = async () => {
    const id = await request("example-org", "night-push");
    await db.query("UPDATE analyses SET owner = 'someone', repo = 'else', repo_key = 'someone/else' WHERE id = $1", [id]);
    return id;
  };

  it("가짜 GitHub 의 합성 저장소가 아니면 kids-signup 수집본이나 다른 폴더의 결과를 붙이지 않고 저장소 받기에서 실패로 적는다", async () => {
    for (const args of [["--fixture"], []]) {
      const id = await unknownRepository();
      await localRunner([...args, "--once", "--site", site], { RUNNER_SECRET: SECRET });
      const analysis = await deps.store().findAnalysis(id);
      expect(analysis?.status, args.join(" ")).toBe("failed");
      expect(analysis?.failure).toEqual({ step: "fetch", reason: UNKNOWN_REPOSITORY });
      expect(await deps.store().getResult(id)).toBeNull();
    }
    // --source 를 주어도 --fixture 면 그 폴더의 수집본이 없으므로 결과를 꾸미지 않는다.
    const id = await unknownRepository();
    await localRunner(["--fixture", "--once", "--site", site, "--source", path.join(scratch, "missing")], { RUNNER_SECRET: SECRET });
    expect((await deps.store().findAnalysis(id))?.failure).toEqual({ step: "fetch", reason: NO_CAPTURE });
  });

  it("검사할 폴더에 문제가 있으면 그 단계와 까닭을 실패로 알린다(--source 를 직접 준 저장소)", async () => {
    // 없는 폴더를 가리키는 --source. CLI 를 돌리기 전, 저장소 받기에서 멈춘다.
    const id = await unknownRepository();
    await localRunner(["--once", "--site", site, "--source", path.join(scratch, "missing")], { RUNNER_SECRET: SECRET });
    const analysis = await deps.store().findAnalysis(id);
    expect(analysis?.status).toBe("failed");
    expect(analysis?.failure?.step).toBe("fetch");
  });

  it("--parallel n 이면 실행 자리를 얻은 분석을 n 개까지 함께 돌린다(사이트의 POOL_SIZE 와 같게 둔다. 검토)", async () => {
    expect(localArgs([]).parallel).toBe(1);
    expect(() => localArgs(["--parallel", "0"])).toThrow("--parallel");
    // 앞 시험에서 끝난 같은 커밋이면 그 분석으로 보낸다. 새로 만들게 지운다.
    await db.query("DELETE FROM results");
    await db.query("DELETE FROM analyses");
    const ids = [await request("example-org", "kids-signup"), await request("example-org", "night-push"), await request("example-labs", "plain.utils")];
    await localRunner(["--fixture", "--once", "--site", site, "--parallel", "3", "--step-delay", "150"], { RUNNER_SECRET: SECRET });
    const done = await Promise.all(ids.map((id) => deps.store().findAnalysis(id)));
    expect(done.map((a) => a?.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    // 함께 돌았다: 모든 분석이 저장소 받기를 시작한 뒤에야 처음으로 끝난 분석이 있다(하나씩 돌면 앞의 것이 끝난 뒤 다음이 시작한다).
    const fetchStarts = done.map((a) => Date.parse(a!.steps.find((s) => s.name === "fetch")!.startedAt!));
    const finishEnds = done.map((a) => Date.parse(a!.steps.find((s) => s.name === "finish")!.endedAt!));
    expect(Math.max(...fetchStarts)).toBeLessThan(Math.min(...finishEnds));
  });

  it("서명 열쇠가 다르면 집어 가지 못한다", async () => {
    await expect(localRunner(["--fixture", "--once", "--site", site], { RUNNER_SECRET: "other" })).rejects.toThrow("응답 401");
    await expect(localRunner(["--fixture", "--once", "--site", site], {})).rejects.toThrow("RUNNER_SECRET");
  });
});
