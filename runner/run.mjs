#!/usr/bin/env node
// 분석 실행기. GitHub Actions 의 워크플로(.github/workflows/analyze.yml)가 단계마다 이 파일을 부르고, 로컬 실행기
// (scripts/local-runner.mjs)는 같은 함수를 가져다 쓴다. Node 내장 모듈만 쓴다.
//
// 하는 일(설계 8): 저장소 받기·도구 설치 → 검사(정적 검사와 AI 판정, CLI 명령 하나) → 정리(결과 보내기). 단계를 시작할 때마다
// 사이트에 서명한 콜백을 보내고, 멈추면 그 단계와 까닭을 보낸다. 대상 코드는 읽기만 한다(설치·빌드·실행하지 않는다).
//
// 워크플로에서 부르는 법(값은 모두 환경 변수로 받는다. 워크플로 입력을 셸 글에 끼워 넣지 않는다):
//   node runner/run.mjs check              입력 검사(분석 id·owner·repo·커밋·콜백 주소 모양)
//   node runner/run.mjs notify <단계>      단계 시작 콜백 (RUNNER_SECRET)
//   node runner/run.mjs fetch              tarball 받기·풀기, JS/TS 파일 수 상한 (GITHUB_TOKEN: 이 워크플로의 읽기 토큰)
//   node runner/run.mjs install            uv 와 CLI 설치(고정 커밋) (CLI_REPO_TOKEN: CLI 저장소가 비공개일 때만)
//   node runner/run.mjs scan               policypack scan (ANTHROPIC_API_KEY)
//   node runner/run.mjs finish             정리 단계 시작 콜백과 결과 콜백 (RUNNER_SECRET)
//   node runner/run.mjs fail               멈춘 단계와 까닭 콜백 (RUNNER_SECRET). 워크플로가 실패·취소됐을 때만 돈다
//
// 단계 사이의 형편(지금 단계, 멈춘 까닭)은 $WORK/state.json 에 둔다. 비밀값은 그 파일에도, 출력에도 적지 않는다.

import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ArchiveError, extractTarGz } from "./tar.mjs";

/** 실행기가 알리는 단계(사이트의 STEP_ORDER 에서 대기를 뺀 것. src/lib/service/steps.ts). */
export const RUNNER_STEPS = ["fetch", "scan", "finish"];

export const DEFAULTS = {
  maxTarballMb: 100,
  maxExtractMb: 400,
  maxJsTsFiles: 3000,
  resultMaxKb: 4000,
  scanTimeoutMinutes: 15,
};

/** 멈춘 단계와 사람이 읽는 까닭. 사이트의 화면에 그대로 적힌다(비밀값·내부 경로를 싣지 않는다). */
export class StepError extends Error {
  constructor(step, reason) {
    super(reason);
    this.name = "StepError";
    this.step = step;
    this.reason = reason;
  }
}

// ---- 서명 (src/server/signature.ts 와 같은 글을 서명한다. tests/runner.test.ts 가 견준다) ----

export function sign(secret, timestamp, scope, body) {
  const text = `v1\n${timestamp}\n${scope}\n${body}`;
  return `v1=${createHmac("sha256", secret).update(text, "utf8").digest("hex")}`;
}

/**
 * 서명한 JSON 을 보낸다. 닿지 못하거나 서버가 5xx 로 답하면 몇 번 다시 보낸다(같은 단계를 다시 알리는 것은 서버가 받아 준다).
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function post(url, scope, payload, { secret, fetcher = fetch, attempts = 3, delayMs = 2000 } = {}) {
  if (!secret) throw new StepError("fetch", "실행기에 콜백 서명 열쇠가 없어 사이트에 알리지 못했습니다.");
  const body = JSON.stringify(payload);
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-runner-timestamp": timestamp,
          "x-runner-signature": sign(secret, timestamp, scope, body),
        },
        body,
        // 서명한 본문을 다른 곳으로 옮겨 보내지 않는다.
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      if (response.status < 500) return { status: response.status, body: parsed };
      last = `응답 ${response.status}`;
    } catch {
      last = "닿지 못함";
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
  }
  throw new Error(`사이트에 알리지 못했습니다(${last}).`);
}

/**
 * 단계 이벤트를 보내고, 서버가 받지 않으면 던진다(끝난 분석·차례 어긋남이면 더 하지 않는다).
 *
 * 모든 이벤트에 이 실행기가 검사하는 저장소·커밋(`target`)을 싣는다. 본문은 서명되므로, 서버는 이것을 분석 행의 저장소·커밋과
 * 견주어 다른 저장소를 검사한 실행(워크플로를 다른 입력으로 부른 것)의 콜백을 받지 않는다.
 */
async function send(ctx, payload, step) {
  const { status, body } = await post(ctx.callbackUrl, ctx.analysisId, { ...payload, target: ctx.target }, { secret: ctx.secret, fetcher: ctx.fetcher, delayMs: ctx.retryDelayMs });
  if (status !== 200) {
    const message = typeof body?.message === "string" ? body.message : `응답 ${status}`;
    const error = new StepError(step, `사이트가 실행기의 알림을 받지 않았습니다: ${message}`);
    error.refused = true;
    throw error;
  }
  return body;
}

export const notifyStep = (ctx, step, run = null) => send(ctx, run ? { event: "step", step, run } : { event: "step", step }, step);
export const sendResult = (ctx, output) => send(ctx, { event: "result", output }, "finish");
export const sendFailure = (ctx, step, reason) => send(ctx, { event: "fail", step, reason }, step);

// ---- 입력 ----

const ID = /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const SHA = /^[0-9a-f]{40}$/;

/**
 * 워크플로 입력을 본다. 콜백 주소는 https 이고 이 분석의 주소(`/api/runner/{id}/`)로 끝나야 하며, 그 출처(scheme·host·port)가
 * 워크플로 파일이 정한 사이트 주소(`SITE_ORIGIN`, Actions 변수 SITE_URL)와 같아야 한다. 워크플로를 부를 수 있는 누군가가 콜백
 * 주소를 다른 곳으로 돌려 서명한 콜백을 받아 가지 못하게 한다. `SITE_ORIGIN` 이 없으면 콜백 주소를 믿지 않는다.
 */
export function readInputs(env, { allowHttp = false } = {}) {
  const inputs = {
    analysisId: env.ANALYSIS_ID ?? "",
    owner: env.REPO_OWNER ?? "",
    repo: env.REPO_NAME ?? "",
    commit: env.REPO_COMMIT ?? "",
    callbackUrl: env.CALLBACK_URL ?? "",
  };
  const problems = [];
  if (!ID.test(inputs.analysisId)) problems.push("분석 id");
  if (!OWNER.test(inputs.owner)) problems.push("저장소 계정 이름");
  if (!REPO.test(inputs.repo) || inputs.repo === "." || inputs.repo === "..") problems.push("저장소 이름");
  if (!SHA.test(inputs.commit)) problems.push("커밋");
  let url = null;
  try {
    url = new URL(inputs.callbackUrl);
  } catch {
    url = null;
  }
  const schemeOk = url && (url.protocol === "https:" || (allowHttp && url.protocol === "http:"));
  let site = null;
  try {
    site = env.SITE_ORIGIN ? new URL(env.SITE_ORIGIN) : null;
  } catch {
    site = null;
  }
  if (
    !url ||
    !schemeOk ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/api/runner/${inputs.analysisId}/` ||
    !site ||
    url.origin !== site.origin
  ) {
    problems.push("콜백 주소");
  }
  return { inputs, problems };
}

// ---- 저장소 받기 ----

/** 크기 상한을 두고 응답 본문을 받는다. */
async function download(url, headers, maxBytes, fetcher) {
  let response;
  try {
    response = await fetcher(url, { headers, redirect: "follow", signal: AbortSignal.timeout(5 * 60_000) });
  } catch {
    throw new StepError("fetch", "저장소 압축 파일을 받지 못했습니다(GitHub 에 닿지 못함).");
  }
  if (response.status === 404) throw new StepError("fetch", "그 커밋의 저장소를 받지 못했습니다(없거나 비공개입니다).");
  if (!response.ok || !response.body) throw new StepError("fetch", `저장소 압축 파일을 받지 못했습니다(응답 ${response.status}).`);
  const declared = Number(response.headers.get("content-length") ?? "NaN");
  const tooBig = () => new StepError("fetch", `저장소 압축 파일이 상한(${Math.round(maxBytes / 1_000_000)}MB)보다 커서 받지 않았습니다.`);
  if (Number.isFinite(declared) && declared > maxBytes) throw tooBig();
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw tooBig();
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** GitHub 의 tarball 을 그 커밋으로 받아 dest 에 푼다. */
export async function fetchRepository({ apiBase = "https://api.github.com", owner, repo, commit, token, dest, maxTarballBytes, maxExtractBytes, fetcher = fetch }) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "plitsoft-sdp-runner", "x-github-api-version": "2022-11-28" };
  if (token) headers.authorization = `Bearer ${token}`;
  const gz = await download(`${apiBase}/repos/${owner}/${repo}/tarball/${commit}`, headers, maxTarballBytes, fetcher);
  try {
    return extractTarGz(gz, dest, { maxBytes: maxExtractBytes });
  } catch (error) {
    if (error instanceof ArchiveError) throw new StepError("fetch", error.message);
    throw error;
  }
}

/** 로컬 폴더를 dest 로 옮긴다(로컬 실행기). 심볼릭 링크는 옮기지 않는다. */
export function copyRepository(source, dest) {
  mkdirSync(dest, { recursive: true });
  cpSync(source, dest, { recursive: true, filter: (from) => !lstatSync(from).isSymbolicLink() });
}

/** CLI 가 검사하지 않는 폴더(policypack 의 discover.SKIP_DIRS 와 같은 이름). 상한을 셀 때 뺀다. */
const SKIP_DIRS = new Set([".git", ".hg", ".svn", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".nuxt", ".output", "coverage", ".pytest_cache", ".ruff_cache", ".mypy_cache", "vendor", ".yarn"]);
const JS_TS = /\.(js|jsx|mjs|cjs|ts|tsx)$/;

/** JS/TS 파일 수(상한 검사용). 심볼릭 링크는 따라가지 않는다. */
export function countJsTs(dir) {
  let count = 0;
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(at, entry.name));
      } else if (entry.isFile() && JS_TS.test(entry.name)) count += 1;
    }
  };
  walk(dir);
  return count;
}

export function checkFileCount(dir, max) {
  const count = countJsTs(dir);
  if (count > max) {
    throw new StepError("fetch", `JS/TS 파일이 ${count.toLocaleString("en-US")}개라 상한(${max.toLocaleString("en-US")}개)을 넘어 검사하지 않았습니다.`);
  }
  return count;
}

// ---- 도구 설치와 검사 ----

/** 자식 과정에 넘길 환경. 이 과정의 환경을 통째로 넘기지 않는다(비밀값이 엉뚱한 곳으로 가지 않게). */
export function childEnv(env, extra = {}) {
  const keep = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_BIN_HOME", "UV_CACHE_DIR", "UV_TOOL_DIR", "UV_TOOL_BIN_DIR", "UV_PYTHON_INSTALL_DIR"];
  const out = Object.fromEntries(keep.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));
  return { ...out, ...extra };
}

/** uv(고정 판)와 CLI(고정 커밋, extra api)를 설치한다. */
export function installCli(env, { run = spawnSync } = {}) {
  const uvVersion = env.UV_VERSION ?? "";
  const cliRepo = env.CLI_REPO ?? "";
  const cliCommit = env.CLI_COMMIT ?? "";
  const excludeNewer = env.CLI_EXCLUDE_NEWER ?? "";
  if (
    !/^\d+\.\d+\.\d+$/.test(uvVersion) ||
    !/^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(cliRepo) ||
    !SHA.test(cliCommit) ||
    !/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(excludeNewer)
  ) {
    throw new StepError("fetch", "실행기의 도구 설정(uv 판, CLI 저장소, 고정 커밋)이 맞지 않아 도구를 설치하지 못했습니다.");
  }
  const uv = run("pipx", ["install", `uv==${uvVersion}`], { env: childEnv(env), encoding: "utf8", timeout: 5 * 60_000 });
  if (uv.status !== 0) throw new StepError("fetch", "도구(uv)를 설치하지 못했습니다.");
  // CLI 저장소가 비공개면 읽기 토큰을 git 설정으로만 넘긴다(명령줄과 출력에 싣지 않는다).
  const git = env.CLI_REPO_TOKEN
    ? { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.https://x-access-token:${env.CLI_REPO_TOKEN}@github.com/.insteadOf`, GIT_CONFIG_VALUE_0: "https://github.com/" }
    : {};
  const spec = `policypack[api] @ git+https://github.com/${cliRepo}@${cliCommit}`;
  // git 의 CLI 를 설치하면 CLI 의 uv.lock 이 쓰이지 않는다. 딸린 꾸러미(pydantic, anthropic, semgrep 등)가 PyPI 의 가장 새 판으로
  // 풀리지 않게, 고정한 날짜(CLI_EXCLUDE_NEWER) 뒤에 나온 판은 고르지 않는다(이 단계와 검사 단계에서 돌 코드를 그날까지로 묶는다).
  const cli = run("uv", ["tool", "install", "--quiet", "--python", "3.12", "--exclude-newer", excludeNewer, spec], { env: childEnv(env, git), encoding: "utf8", timeout: 10 * 60_000 });
  if (cli.status !== 0) throw new StepError("fetch", "검사 도구(CLI)를 설치하지 못했습니다.");
}

/**
 * 검사: `policypack scan . --judge <판정자> --output-format json` 을 저장소 폴더에서 돌린다. 종료 코드 0(검토할 것 없음)과
 * 1(검토 필요)은 결과다. 2 는 도구 오류다. 표준 출력(결과 JSON)을 그대로 돌려준다. 읽어 보는 것은 사이트가 한다.
 */
export function runScan({ dir, judge, command = ["policypack"], env, timeoutMs, run = spawnSync }) {
  const [bin, ...pre] = command;
  const result = run(bin, [...pre, "scan", ".", "--judge", judge, "--output-format", "json"], {
    cwd: dir,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
  });
  if (result.error && result.error.code === "ETIMEDOUT") {
    throw new StepError("scan", `검사가 ${Math.round(timeoutMs / 60_000)}분 안에 끝나지 않아 멈췄습니다.`);
  }
  if (result.error) throw new StepError("scan", "검사 도구(CLI)를 실행하지 못했습니다.");
  if (result.status !== 0 && result.status !== 1) {
    throw new StepError("scan", `검사 도구가 오류로 끝났습니다(종료 코드 ${result.status ?? "없음"}).`);
  }
  if (!result.stdout || result.stdout.trim() === "") throw new StepError("scan", "검사 도구가 결과를 내지 않았습니다.");
  return result.stdout;
}

/** 결과 크기 상한. 넘으면 보내지 않고 멈춘다(사이트도 받지 않는다). */
export function checkResultSize(output, maxKb) {
  const bytes = Buffer.byteLength(output, "utf8");
  if (bytes > maxKb * 1024) {
    throw new StepError("finish", `결과가 너무 큽니다(${Math.ceil(bytes / 1024).toLocaleString("en-US")}KB, 상한 ${maxKb.toLocaleString("en-US")}KB).`);
  }
}

// ---- 워크플로의 단계 사이 형편 ----

const statePath = (work) => path.join(work, "state.json");

export function readState(work) {
  try {
    return JSON.parse(readFileSync(statePath(work), "utf8"));
  } catch {
    return { step: "fetch", reason: null };
  }
}

export function writeState(work, state) {
  mkdirSync(work, { recursive: true });
  writeFileSync(statePath(work), JSON.stringify(state));
}

const positive = (value, fallback) => (/^\d+$/.test(value ?? "") && Number(value) > 0 ? Number(value) : fallback);

/** 워크플로에서 부를 때. 하위 명령 하나를 하고 끝난다. */
async function main(argv, env) {
  const [command, arg] = argv;
  // 작업 폴더. 워크플로에서는 RUNNER_TEMP 아래에 둔다(runner 문맥은 job 의 env 에서 쓸 수 없어 여기서 정한다).
  const work = env.WORK_DIR || (env.RUNNER_TEMP ? path.join(env.RUNNER_TEMP, "analysis") : "");
  if (!work) throw new Error("WORK_DIR 이나 RUNNER_TEMP 가 없습니다.");
  const src = path.join(work, "src");
  const { inputs, problems } = readInputs(env);
  const ctx = {
    analysisId: inputs.analysisId,
    callbackUrl: inputs.callbackUrl,
    secret: env.RUNNER_SECRET ?? "",
    target: { owner: inputs.owner, repo: inputs.repo, commit: inputs.commit },
  };
  const step = (name) => writeState(work, { ...readState(work), step: name, reason: null });

  try {
    switch (command) {
      case "check":
        if (problems.length > 0) throw new StepError("fetch", `실행기가 받은 입력이 맞지 않습니다: ${problems.join(", ")}.`);
        writeState(work, { step: "fetch", reason: null });
        return;
      case "notify": {
        if (!RUNNER_STEPS.includes(arg)) throw new Error(`모르는 단계: ${arg}`);
        step(arg);
        const run =
          arg === "fetch" && env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY && env.GITHUB_SERVER_URL === "https://github.com"
            ? { id: env.GITHUB_RUN_ID, url: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` }
            : null;
        await notifyStep(ctx, arg, run);
        return;
      }
      case "fetch": {
        step("fetch");
        rmSync(src, { recursive: true, force: true });
        await fetchRepository({
          owner: inputs.owner,
          repo: inputs.repo,
          commit: inputs.commit,
          token: env.GITHUB_TOKEN ?? null,
          dest: src,
          maxTarballBytes: positive(env.MAX_TARBALL_MB, DEFAULTS.maxTarballMb) * 1_000_000,
          maxExtractBytes: positive(env.MAX_EXTRACT_MB, DEFAULTS.maxExtractMb) * 1_000_000,
        });
        checkFileCount(src, positive(env.MAX_JSTS_FILES, DEFAULTS.maxJsTsFiles));
        return;
      }
      case "install":
        step("fetch");
        installCli(env);
        return;
      case "scan": {
        step("scan");
        const model = env.JUDGE_MODEL ?? "";
        if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) throw new StepError("scan", "실행기의 AI 판정자 설정이 맞지 않습니다.");
        if (!env.ANTHROPIC_API_KEY) throw new StepError("scan", "실행기에 AI 판정자의 API 키가 없어 검사하지 않았습니다.");
        const output = runScan({
          dir: src,
          judge: `anthropic:${model}`,
          env: childEnv(env, { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, GIT_CEILING_DIRECTORIES: work }),
          timeoutMs: positive(env.SCAN_TIMEOUT_MINUTES, DEFAULTS.scanTimeoutMinutes) * 60_000,
        });
        writeFileSync(path.join(work, "output.json"), output);
        return;
      }
      case "finish": {
        step("finish");
        await notifyStep(ctx, "finish");
        const output = readFileSync(path.join(work, "output.json"), "utf8");
        checkResultSize(output, positive(env.RESULT_MAX_KB, DEFAULTS.resultMaxKb));
        await sendResult(ctx, output);
        return;
      }
      case "fail": {
        const state = readState(work);
        // 사이트가 알림을 받지 않았다(끝난 분석, 차례 어긋남). 실패를 다시 알려도 받지 않는다.
        if (state.refused) return;
        const reason =
          state.reason ??
          (env.JOB_STATUS === "cancelled"
            ? "실행기 작업이 취소되었습니다(실행 시간 상한을 넘었거나 사람이 멈췄습니다)."
            : "실행기의 일이 실패했습니다(까닭을 남기지 못했습니다).");
        if (problems.includes("콜백 주소") || problems.includes("분석 id")) return; // 알릴 곳을 믿을 수 없다.
        await sendFailure(ctx, RUNNER_STEPS.includes(state.step) ? state.step : "fetch", reason);
        return;
      }
      default:
        throw new Error(`모르는 명령: ${command}`);
    }
  } catch (error) {
    // 까닭을 남겨 두고 실패로 끝낸다. 워크플로의 마지막 단계(fail)가 사이트에 알린다.
    const reason = error instanceof StepError ? error.reason : "실행기의 일이 실패했습니다.";
    if (command !== "fail") {
      const refused = error instanceof StepError && error.refused === true;
      writeState(work, { step: error instanceof StepError ? error.step : readState(work).step, reason, refused });
    }
    console.error(`실행기: ${reason}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2), process.env);
}
