import "server-only";
import { analysisHref } from "@/lib/service/href";
import { isAnalysisId } from "@/lib/service/id";
import type { Analysis, RequestRefusal, ServiceStore } from "@/lib/service/types";
import { ServiceUnavailableError } from "@/lib/service/errors";
import { applyRunnerEvent, claimQueued, readEvent } from "./callbacks";
import { readConfig, type ServerConfig } from "./config";
import { getDatabase, type Database } from "./db";
import { internalError, isJsonRequest, json, readBody } from "./http";
import { precheck, SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./signature";
import { getStore } from "./store";

/**
 * `/api/` 의 일. route handler(`src/app/api/**\/route.ts`)는 이 함수를 부르기만 한다. 시험은 저장소·DB·설정·시계를 바꿔 끼워
 * 같은 함수를 부른다(tests/server-api.test.ts).
 */

export interface ApiDeps {
  store: () => ServiceStore;
  db: () => Promise<Database>;
  config: () => ServerConfig;
  now: () => Date;
}

export const defaultDeps: ApiDeps = { store: getStore, db: getDatabase, config: () => readConfig(), now: () => new Date() };

/** 분석 요청 본문의 크기 상한(바이트). owner·repo 두 이름만 싣는다. */
const REQUEST_BODY_MAX = 2_048;

const REFUSAL_STATUS: Record<RequestRefusal, number> = {
  "no-server": 503,
  closed: 503,
  "not-found": 404,
  "too-large": 422,
  limit: 429,
  unavailable: 503,
};

/** 브라우저에 보내는 분석. 화면이 단계를 다시 그리는 데 쓰는 것만 싣는다(실행기 run 같은 내부 값은 싣지 않는다). */
function publicAnalysis(analysis: Analysis) {
  return {
    id: analysis.id,
    owner: analysis.owner,
    name: analysis.name,
    commit: analysis.commit,
    branch: analysis.branch,
    requestedAt: analysis.requestedAt,
    status: analysis.status,
    steps: analysis.steps,
    failure: analysis.failure,
    versions: analysis.versions,
  } satisfies Analysis;
}

/** POST /api/analyses/  본문 {"owner","repo"}. 만들면 201, 같은 커밋의 분석으로 보내면 200, 받지 않으면 그 까닭. */
export async function postAnalysis(request: Request, deps: ApiDeps = defaultDeps): Promise<Response> {
  if (!isJsonRequest(request)) return json({ ok: false, reason: "bad-request", message: "JSON 본문만 받습니다." }, 415);
  const body = await readBody(request, REQUEST_BODY_MAX);
  if (!body.ok) return json({ ok: false, reason: "bad-request", message: "요청 본문이 너무 큽니다." }, 413);
  let owner: unknown;
  let repo: unknown;
  try {
    ({ owner, repo } = JSON.parse(body.text) as { owner?: unknown; repo?: unknown });
  } catch {
    return json({ ok: false, reason: "bad-request", message: "요청 본문을 읽지 못했습니다." }, 400);
  }
  if (typeof owner !== "string" || typeof repo !== "string") {
    return json({ ok: false, reason: "bad-request", message: "저장소 이름(owner, repo)이 없습니다." }, 400);
  }
  try {
    const outcome = await deps.store().requestAnalysis(owner, repo);
    if (!outcome.ok) {
      return json({ ok: false, reason: outcome.reason, message: outcome.message }, REFUSAL_STATUS[outcome.reason]);
    }
    const { analysis, reused } = outcome;
    return json(
      { ok: true, reused, analysis: publicAnalysis(analysis), href: analysisHref(analysis.owner, analysis.name, analysis.id) },
      reused ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof ServiceUnavailableError) return json({ ok: false, reason: "unavailable", message: error.message }, 503);
    return internalError("POST /api/analyses", error);
  }
}

/** GET /api/analyses/{id}/  진행 중인 분석 쪽이 몇 초마다 읽는다. */
export async function getAnalysis(id: string, deps: ApiDeps = defaultDeps): Promise<Response> {
  if (!isAnalysisId(id)) return json({ ok: false, message: "그런 분석이 없습니다." }, 404);
  try {
    const analysis = await deps.store().findAnalysis(id);
    if (!analysis) return json({ ok: false, message: "그런 분석이 없습니다." }, 404);
    return json({ ok: true, analysis: publicAnalysis(analysis) });
  } catch (error) {
    if (error instanceof ServiceUnavailableError) return json({ ok: false, message: error.message }, 503);
    return internalError("GET /api/analyses/[id]", error);
  }
}

/**
 * 서명을 보고 본문을 읽는다. 열쇠가 없거나(RUNNER_SECRET), 합성 미리보기거나, 서명이 맞지 않으면 그 응답을 돌려준다.
 * 응답에는 왜 서명이 맞지 않는지 자세히 싣지 않는다(시각 어긋남만 알린다. 실행기의 시계를 고칠 수 있게).
 */
async function signed(
  request: Request,
  scope: string,
  deps: ApiDeps,
): Promise<{ ok: true; text: string; config: ServerConfig } | { ok: false; response: Response }> {
  const config = deps.config();
  if (!config.runner.secret || config.store === "synthetic") {
    return { ok: false, response: json({ ok: false, message: "이 서버는 실행기 콜백을 받지 않습니다." }, 503) };
  }
  const refused = (reason: string) => {
    const message = reason === "stale" ? "요청 시각이 서버 시각과 5분 넘게 어긋납니다." : "서명이 맞지 않습니다.";
    return { ok: false as const, response: json({ ok: false, message }, 401) };
  };
  // 본문을 읽기 전에 머리(모양·시각)부터 본다. 맞지 않으면 본문을 읽지 않는다.
  const pre = precheck({
    secret: config.runner.secret,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
    now: deps.now().getTime(),
  });
  if (!pre.ok) {
    await request.body?.cancel().catch(() => undefined);
    return refused(pre.reason);
  }
  const body = await readBody(request, config.limits.maxResultKb * 1024);
  if (!body.ok) {
    return {
      ok: false,
      response: json({ ok: false, message: `본문이 상한(${config.limits.maxResultKb}KB)보다 큽니다.` }, 413),
    };
  }
  const checked = verify({
    secret: config.runner.secret,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
    scope,
    body: body.text,
    now: deps.now().getTime(),
  });
  if (!checked.ok) return refused(checked.reason);
  return { ok: true, text: body.text, config };
}

/** POST /api/runner/{id}/  실행기 콜백(단계 시작, 결과, 실패). */
export async function postRunnerEvent(request: Request, id: string, deps: ApiDeps = defaultDeps): Promise<Response> {
  const checked = await signed(request, id, deps);
  if (!checked.ok) return checked.response;
  let data: unknown;
  try {
    data = JSON.parse(checked.text);
  } catch {
    return json({ ok: false, message: "본문을 읽지 못했습니다." }, 400);
  }
  const event = readEvent(data);
  if (!event) return json({ ok: false, message: "모르는 콜백입니다." }, 400);
  try {
    const outcome = await applyRunnerEvent(await deps.db(), id, event, {
      now: deps.now(),
      runTimeoutMinutes: checked.config.limits.runTimeoutMinutes,
    });
    return json(outcome.body, outcome.status);
  } catch (error) {
    return internalError("POST /api/runner/[id]", error);
  }
}

/** POST /api/runner/claim/  로컬 실행기(RUNNER=local)가 대기 중인 분석 하나를 집어 간다. 다른 실행기에서는 404. */
export async function postRunnerClaim(request: Request, deps: ApiDeps = defaultDeps): Promise<Response> {
  const checked = await signed(request, "claim", deps);
  if (!checked.ok) return checked.response;
  if (checked.config.runner.kind !== "local") return json({ ok: false, message: "로컬 실행기를 쓰지 않는 서버입니다." }, 404);
  try {
    const claimed = await claimQueued(await deps.db(), {
      now: deps.now(),
      runTimeoutMinutes: checked.config.limits.runTimeoutMinutes,
    });
    return json({ ok: true, analysis: claimed });
  } catch (error) {
    return internalError("POST /api/runner/claim", error);
  }
}
