import "server-only";
import type { ServerConfig } from "./config";

/**
 * 실행기 깨우기. 분석 행(queued)을 만든 뒤 부른다.
 * - RUNNER=github: 실행기 저장소의 워크플로를 workflow_dispatch 로 부른다(RUNNER_REPO·RUNNER_WORKFLOW·RUNNER_TOKEN).
 * - RUNNER=local: 아무것도 하지 않는다. 이 컴퓨터의 로컬 실행기(scripts/local-runner.mjs)가 대기 중인 분석을 집어 간다.
 * - RUNNER=none: 요청을 받지 않는다(이 함수까지 오지 않는다).
 *
 * 실패하면 화면에 적을 수 있는 까닭을 돌려준다(토큰·응답 본문을 싣지 않는다).
 */

export interface WakeInput {
  analysisId: string;
  owner: string;
  repo: string;
  commit: string;
  /** 실행기가 진행과 결과를 알릴 이 사이트의 주소(끝에 빗금 없음). */
  callbackBase: string | null;
  /**
   * 이 실행에서 `policypack review` 도 돌릴지. 사이트의 REVIEW 스위치가 켜져 있고 같은 저장소·커밋의 저장된 review 가 없을 때만
   * 참이다(`src/server/queue.ts` 의 `wantsReview`). 워크플로 입력 `review`("true" | "false")로 보낸다.
   */
  review: boolean;
}

/** 실행기가 진행과 결과를 알릴 주소. 쪽 주소처럼 끝에 빗금을 둔다(next.config 의 trailingSlash. 빗금 없는 주소는 308 로 보낸다). */
export function callbackUrl(base: string, analysisId: string): string {
  return `${base}/api/runner/${analysisId}/`;
}

export type WakeOutcome = { ok: true } | { ok: false; reason: string };

const REPO = /^[A-Za-z0-9_-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const WORKFLOW = /^[A-Za-z0-9._-]{1,100}\.ya?ml$/;

export async function wakeRunner(
  config: Pick<ServerConfig, "runner" | "github">,
  input: WakeInput,
  fetcher: typeof fetch = fetch,
): Promise<WakeOutcome> {
  const { runner } = config;
  if (runner.kind === "local") return { ok: true };
  if (runner.kind === "none") return { ok: false, reason: "실행기가 설정되지 않아 분석을 시작하지 못했습니다." };
  if (!runner.repo || !REPO.test(runner.repo) || !WORKFLOW.test(runner.workflow) || !runner.token || !input.callbackBase) {
    return { ok: false, reason: "실행기 설정이 갖춰지지 않아 분석을 시작하지 못했습니다." };
  }
  let status = 0;
  let detail = "";
  try {
    const response = await fetcher(
      `${config.github.apiBase}/repos/${runner.repo}/actions/workflows/${runner.workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "plitsoft-sdp-web",
          authorization: `Bearer ${runner.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ref: runner.ref,
          inputs: {
            analysis_id: input.analysisId,
            owner: input.owner,
            repo: input.repo,
            commit: input.commit,
            callback_url: callbackUrl(input.callbackBase, input.analysisId),
            review: input.review ? "true" : "false",
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    status = response.status;
    // GitHub 의 거절 까닭(message)을 서버 로그에만 남긴다(화면에는 응답 번호만). 토큰이 섞여 있으면 가린다.
    if (status !== 204 && status !== 200) detail = (await response.text().catch(() => "")).slice(0, 300).split(runner.token).join("***");
  } catch {
    return { ok: false, reason: "실행기(GitHub Actions)에 닿지 못해 분석을 시작하지 못했습니다." };
  }
  if (status === 204 || status === 200) return { ok: true };
  console.error(`[runner] workflow_dispatch 응답 ${status}: ${detail}`);
  return { ok: false, reason: `실행기(GitHub Actions)가 분석을 받지 않았습니다(응답 ${status}).` };
}
