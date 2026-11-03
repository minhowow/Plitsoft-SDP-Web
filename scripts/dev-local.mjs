#!/usr/bin/env node
// 계정 없이 이 컴퓨터에서 서비스 전체를 띄운다(docs/deploy.md 의 3). 셋을 함께 띄우고, 하나가 멈추거나 Ctrl-C 를 누르면 모두 끈다.
//   1. 가짜 GitHub API(scripts/github-stub.mjs)     http://127.0.0.1:4010
//   2. 사이트(next dev, RUNNER=local, PGlite)       http://127.0.0.1:3000
//   3. 로컬 실행기(scripts/local-runner.mjs)          대기 중인 분석을 집어 단계마다 쉬어 가며 끝까지 돌린다
//
//   npm run local                 실제 CLI 수집본(--fixture)으로 돈다. uv·옆 폴더 CLI 가 없어도 된다
//   npm run local -- --cli        옆 폴더(../Plitsoft-SDP)의 CLI 를 uv 로 실제로 돌린다(판정자 없음)
//   npm run local -- --step-delay 3000   단계 사이 쉬는 시간(ms, 기본 1500)
//   POOL_SIZE=3 npm run local     실행 자리 수(기본 2). 사이트와 로컬 실행기(--parallel)에 같은 값을 준다
//
// DB 는 .data/local 에 남는다(지우면 처음부터). 서명 열쇠 local-dev 는 이 컴퓨터에서만 쓰는 아무 글이다(비밀값이 아니다).

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const useCli = args.includes("--cli");
const at = args.indexOf("--step-delay");
const stepDelay = at === -1 ? "1500" : args[at + 1];
const site = "http://127.0.0.1:3000";
// 사이트의 실행 자리 수와 로컬 실행기가 함께 돌리는 수를 같게 둔다(사이트가 '보냄'으로 표시한 분석을 모두 곧바로 집어 가게).
const poolSize = /^[1-9]\d*$/.test(process.env.POOL_SIZE ?? "") ? process.env.POOL_SIZE : "2";

const env = {
  ...process.env,
  GITHUB_API_BASE: "http://127.0.0.1:4010",
  RUNNER: "local",
  RUNNER_SECRET: "local-dev",
  SITE_URL: site,
  PGLITE_DIR: path.join(root, ".data", "local"),
  POOL_SIZE: poolSize,
};
delete env.DATABASE_URL;
delete env.SERVICE_STORE;

const children = [];
function start(name, command, commandArgs) {
  const child = spawn(command, commandArgs, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => `[${name}] ${line}`)
      .join("\n");
  child.stdout.on("data", (chunk) => console.log(prefix(chunk)));
  child.stderr.on("data", (chunk) => console.error(prefix(chunk)));
  child.on("exit", (code) => {
    console.log(`[${name}] 끝남 (${code})`);
    stop();
  });
  children.push(child);
}

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

start("github", process.execPath, ["scripts/github-stub.mjs", "--port", "4010"]);
start("site", "npx", ["next", "dev", "--hostname", "127.0.0.1", "--port", "3000"]);
start("runner", process.execPath, [
  "scripts/local-runner.mjs",
  ...(useCli ? [] : ["--fixture"]),
  "--site",
  site,
  "--step-delay",
  stepDelay,
  "--parallel",
  poolSize,
]);
console.log(`\n열기: ${site}  (검색 예: kids, genai, example-labs)  끄기: Ctrl-C\n`);
