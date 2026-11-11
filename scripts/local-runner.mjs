#!/usr/bin/env node
// 로컬 실행기. 이 컴퓨터에서 분석 요청부터 결과까지 돌려 보려고 둔다(계정·비밀값 없이). GitHub Actions 의 실행기
// (.github/workflows/analyze.yml)와 같은 runner/run.mjs 를 쓰되, 다음이 다르다.
//   - 저장소를 GitHub 에서 받지 않는다. 가짜 GitHub(scripts/github-stub.mjs)의 합성 저장소마다 정한 합성 데모 코드
//     (contract/fixtures/<이름>/main)를 옮긴다. 그 목록에 없는 저장소는 실패로 적는다(실제 저장소 이름에 합성 결과를 붙이지
//     않는다. docs/redesign.md 5장 "로컬을 정직하게"). --source 를 직접 준 때만 그 폴더를 검사한다(--fixture 면 CLI 를 돌리지
//     않으므로 그때도 실패다. 그 폴더의 수집본이 없다).
//   - AI 판정자를 켜지 않는다(--judge none. 로컬에는 키가 없다). 결과의 run.judge 가 그렇게 말한다.
//   - --fixture: CLI 를 돌리지 않고 contract/cli-current/<이름>.main.json(실제 CLI 출력의 수집본)을 결과로 보낸다. uv 나
//     옆 폴더의 CLI 저장소(../Plitsoft-SDP)가 없어도 돈다. npm run check 의 시험은 이 모드로만 돈다.
//
// 사이트는 RUNNER=local 로 띄운다. 실행기는 서명한 요청으로 대기 중인 분석을 집어 가고(POST /api/runner/claim/), 단계마다
// 서명한 콜백을 보낸다. 서명 열쇠는 사이트와 같은 RUNNER_SECRET 환경 변수다(로컬에서 아무 글이나 정해 둘에 같이 준다).
//
//   RUNNER_SECRET=… node scripts/local-runner.mjs --fixture [--site http://127.0.0.1:3000] [--once] [--step-delay 800] [--parallel 2]
//
//   --once          대기 중인 분석이 하나도 없을 때까지 돌리고 끝낸다(없으면 바로 끝낸다). 없으면 계속 기다린다.
//   --interval ms   기다리는 동안 몇 ms 마다 다시 물을지(기본 2000)
//   --step-delay ms 단계 사이에 쉬는 시간(화면에서 진행을 보려고. 기본 0)
//   --source dir    가짜 GitHub 에 없는 저장소를 요청했을 때 검사할 폴더(기본 없음: 그런 저장소는 실패로 적는다)
//   --parallel n    한 번에 돌리는 분석 수(기본 1). 사이트의 POOL_SIZE 와 같게 둔다. 사이트는 실행 자리 수만큼만 '보냄'으로
//                   표시하므로, 이보다 작으면 보냄 표시를 받은 분석이 집히지 않은 채 기다리다 DISPATCH_TIMEOUT_MINUTES 에 실패한다.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  checkFileCount,
  childEnv,
  copyRepository,
  DEFAULTS,
  notifyStep,
  post,
  resultBody,
  runProfile,
  runScan,
  sendFailure,
  sendResult,
  StepError,
} from "../runner/run.mjs";
import { STUB_REPOSITORIES } from "./github-stub.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const options = {
    fixture: false,
    once: false,
    site: "http://127.0.0.1:3000",
    interval: 2000,
    stepDelay: 0,
    source: null,
    parallel: 1,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} 다음에 값이 없습니다.`);
      return next;
    };
    if (arg === "--fixture") options.fixture = true;
    else if (arg === "--once") options.once = true;
    else if (arg === "--site") options.site = value().replace(/\/+$/, "");
    else if (arg === "--interval") options.interval = Number(value());
    else if (arg === "--step-delay") options.stepDelay = Number(value());
    else if (arg === "--source") options.source = path.resolve(value());
    else if (arg === "--parallel") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) throw new Error("--parallel 은 1 이상의 정수입니다.");
      options.parallel = n;
    }
    else throw new Error(`모르는 인자: ${arg}`);
  }
  return options;
}

/** 가짜 GitHub 의 목록에 없는(또는 합성 데모 코드가 없는) 저장소를 받았을 때의 까닭. 저장소 받기 단계의 실패로 적는다. */
export const UNKNOWN_REPOSITORY = "로컬 실행기는 가짜 GitHub 의 합성 저장소만 검사합니다. 이 저장소에는 합성 데모 코드가 없습니다.";
/** --fixture 인데 --source 의 저장소를 받았을 때. 수집본이 없으므로 결과를 꾸미지 않고 실패로 적는다. */
export const NO_CAPTURE = "--fixture 는 합성 저장소의 수집본만 보냅니다. --source 의 폴더를 검사하려면 --fixture 없이 돌리세요.";

/**
 * 저장소마다 검사할 합성 데모 코드와 그 수집본. 가짜 GitHub 의 목록에 있고 합성 데모 코드가 있는 저장소만이다. 그 밖의
 * 저장소는 --source 를 직접 준 때만 그 폴더(수집본 없음)이고, 아니면 null(실패로 적는다).
 */
export function sourceFor(owner, repo, options) {
  const known = STUB_REPOSITORIES.find((entry) => `${entry.owner}/${entry.name}`.toLowerCase() === `${owner}/${repo}`.toLowerCase());
  const fixture = known?.fixture ?? null;
  if (fixture) {
    return {
      dir: path.join(root, "contract", "fixtures", fixture, "main"),
      capture: path.join(root, "contract", "cli-current", `${fixture}.main.json`),
    };
  }
  return options.source ? { dir: options.source, capture: null } : null;
}

/** 옆 폴더의 CLI 저장소로 휠을 만들어 그 휠로 돌릴 명령(scripts/capture-cli-output.mjs 와 같은 까닭: uvx 는 폴더를 다시 빌드하지 않는다). */
function cliCommand(work) {
  const from = path.resolve(root, "..", "Plitsoft-SDP");
  if (!existsSync(from)) throw new StepError("scan", "옆 폴더의 CLI 저장소(../Plitsoft-SDP)가 없습니다. --fixture 로 돌리세요.");
  const wheels = path.join(work, "wheel");
  const build = spawnSync("uv", ["build", "--quiet", "--wheel", "--out-dir", wheels, from], { encoding: "utf8" });
  if (build.error || build.status !== 0) throw new StepError("scan", "CLI 를 빌드하지 못했습니다(uv 가 있는지 보세요). --fixture 로 돌릴 수 있습니다.");
  const wheel = readdirSync(wheels).find((name) => name.endsWith(".whl"));
  return ["uvx", "--quiet", "--from", path.join(wheels, wheel), "policypack"];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 수집본(contract/cli-current/<표본>.json)과 같은 표본의 저장소 프로필 수집본(contract/cli-current/profile/<표본>.json). 없거나
 * 읽지 못하면 null(결과만 보낸다).
 */
export function profileCaptureFor(capture) {
  const file = path.join(path.dirname(capture), "profile", path.basename(capture));
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** 분석 하나를 끝까지 돌린다. 멈추면 그 단계와 까닭을 알린다. */
export async function runOne(claimed, options, secret) {
  const ctx = {
    analysisId: claimed.id,
    callbackUrl: `${options.site}/api/runner/${claimed.id}/`,
    secret,
    retryDelayMs: 200,
    target: { owner: claimed.owner, repo: claimed.repo, commit: claimed.commit },
  };
  const work = mkdtempSync(path.join(tmpdir(), "plitsoft-local-runner-"));
  let step = "fetch";
  try {
    await notifyStep(ctx, "fetch");
    const source = sourceFor(claimed.owner, claimed.repo, options);
    if (!source) throw new StepError("fetch", UNKNOWN_REPOSITORY);
    if (options.fixture && !source.capture) throw new StepError("fetch", NO_CAPTURE);
    const { dir, capture } = source;
    const src = path.join(work, "src");
    copyRepository(dir, src);
    checkFileCount(src, DEFAULTS.maxJsTsFiles);
    await sleep(options.stepDelay);

    step = "scan";
    await notifyStep(ctx, "scan");
    // CLI 검사는 spawnSync 로 돌려 이 과정을 막는다. --parallel 로 여럿을 집어 와도 검사는 한 번에 하나뿐이다. 한 컴퓨터에서 검사를
    // 여럿 동시에 돌리면 큰 파일에서 엔진 시간 초과가 나 '판단 보류'가 는다(CLI 가 2026-11-11 에 잰 것). 바꾸지 않는다.
    // GitHub Actions 의 실행기는 분석마다 새 VM 이고 그 안에서 검사는 하나다.
    const command = options.fixture ? null : cliCommand(work);
    const env = childEnv(process.env, { GIT_CEILING_DIRECTORIES: work });
    const output = options.fixture
      ? readFileSync(capture, "utf8")
      : runScan({ dir: src, judge: "none", command, env, timeoutMs: DEFAULTS.scanTimeoutMinutes * 60_000 });
    // 저장소 프로필(모델 호출 없음): 수집본이면 같은 표본의 프로필 수집본, CLI 면 policypack profile 을 검사 다음에 돌린다(역시
    // spawnSync 로 하나씩). 없거나 실패하면 결과만 보낸다.
    const profile = options.fixture
      ? profileCaptureFor(capture)
      : runProfile({ dir: src, command, env, timeoutMs: DEFAULTS.profileTimeoutMinutes * 60_000 });
    await sleep(options.stepDelay);

    step = "finish";
    await notifyStep(ctx, "finish");
    const body = await sendResult(ctx, output, resultBody(ctx, output, profile, DEFAULTS.resultMaxKb));
    return body?.status ?? "succeeded";
  } catch (error) {
    if (error instanceof StepError && error.refused) throw error;
    const reason = error instanceof StepError ? error.reason : "로컬 실행기의 일이 실패했습니다.";
    await sendFailure(ctx, error instanceof StepError ? error.step : step, reason);
    return "failed";
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** 대기 중인 분석 하나를 집어 온다. 없으면 null. */
export async function claim(options, secret) {
  const { status, body } = await post(`${options.site}/api/runner/claim/`, "claim", {}, { secret, attempts: 1 });
  if (status !== 200) throw new Error(`사이트가 집어 가기를 받지 않았습니다(응답 ${status}${body?.message ? `: ${body.message}` : ""}).`);
  return body?.analysis ?? null;
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export async function main(argv, env = process.env) {
  const options = parseArgs(argv);
  const secret = env.RUNNER_SECRET;
  if (!secret) throw new Error("RUNNER_SECRET 이 없습니다. 사이트(RUNNER=local)와 같은 값을 주세요.");
  // 도는 분석. --parallel 만큼까지 집어 와 함께 돌린다.
  const active = new Set();
  let fatal = null;
  const start = (claimed) => {
    const job = runOne(claimed, options, secret)
      .then((status) => console.log(`로컬 실행기: ${claimed.owner}/${claimed.repo} 분석 ${claimed.id} → ${status}`))
      .catch((error) => {
        fatal ??= error;
      })
      .finally(() => active.delete(job));
    active.add(job);
  };
  for (;;) {
    if (fatal) throw fatal;
    if (active.size < options.parallel) {
      let claimed;
      try {
        claimed = await claim(options, secret);
      } catch (error) {
        // 기다리는 동안 사이트가 아직 뜨지 않았거나 잠깐 닿지 않을 수 있다. 한 번만 돌릴 때는 그대로 알린다.
        if (options.once) {
          await Promise.all(active);
          throw error;
        }
        console.error(`로컬 실행기: ${error.message} 잠시 뒤에 다시 묻습니다.`);
        await Promise.race([sleep(options.interval), ...active]);
        continue;
      }
      if (claimed) {
        start(claimed);
        continue;
      }
      if (options.once && active.size === 0) return;
    }
    // 자리가 다 찼거나 집을 것이 없다. 하나가 끝나거나 잠시 지나면 다시 묻는다.
    await Promise.race([sleep(options.interval), ...active]);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`로컬 실행기: ${error.message}`);
    process.exit(1);
  });
}
