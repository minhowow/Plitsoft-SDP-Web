import "server-only";
import { analysisHref } from "@/lib/service/href";
import { isAnalysisId } from "@/lib/service/id";
import type { Analysis, RequestRefusal, ServiceStore } from "@/lib/service/types";
import { ServiceUnavailableError } from "@/lib/service/errors";
import { placeOf, type QueuePlace } from "@/lib/service/queue";
import { cleanSuggestText, mergeSuggestions, type SuggestResponse } from "@/lib/service/suggest";
import { applyRunnerEvent, claimQueued, readEvent } from "./callbacks";
import { readConfig, showsSyntheticTag, usesFakeGitHub, type ServerConfig } from "./config";
import { getDatabase, type Database } from "./db";
import { internalError, isJsonRequest, json, readBody } from "./http";
import { tidyQueue, type PumpDeps } from "./queue";
import { wakeRunner, type WakeInput, type WakeOutcome } from "./runner";
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
  /** 실행기 깨우기(콜백·집어 가기 뒤에 대기열을 넘길 때). 없으면 설정대로(`wakeRunner`). 시험이 바꿔 끼운다. */
  wake?: (input: WakeInput) => Promise<WakeOutcome>;
}

/** 대기열을 넘기는 데 드는 것. 콜백과 집어 가기가 쓴다(요청은 저장소 구현이 같은 것을 쓴다). */
function pumpDeps(deps: ApiDeps, config: ServerConfig): PumpDeps {
  return {
    now: deps.now,
    limits: config.limits,
    wake: deps.wake ?? ((input) => wakeRunner(config, input)),
    callbackBase: config.runner.callbackBase,
    runner: config.runner.kind,
    review: config.runner.review,
  };
}

/** 대기 중인 분석이 대기열의 어디에 있는지(DB 에서 센 것). 대기 중이 아니거나 합성이면 null. 읽지 못해도 null(진행 읽기를 막지 않는다). */
async function placeFor(store: ServiceStore, analysis: Analysis): Promise<QueuePlace | null> {
  if (analysis.status !== "queued") return null;
  try {
    return placeOf(await store.queue(), analysis.id);
  } catch {
    return null;
  }
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
    const queue = await placeFor(deps.store(), analysis);
    return json(
      { ok: true, reused, analysis: publicAnalysis(analysis), queue, href: analysisHref(analysis.owner, analysis.name, analysis.id) },
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
    return json({ ok: true, analysis: publicAnalysis(analysis), queue: await placeFor(deps.store(), analysis) });
  } catch (error) {
    if (error instanceof ServiceUnavailableError) return json({ ok: false, message: error.message }, 503);
    return internalError("GET /api/analyses/[id]", error);
  }
}

/**
 * GET /api/repos/suggest/?q=…[&scope=site]  검색창의 자동 완성(docs/redesign.md 5장). 늘 200 이고 캐시하지 않는다.
 *
 * - `q` 는 다듬는다(`cleanSuggestText`: 제어 문자를 빼고 100자까지). 비면 빈 답이다.
 * - `scope=site` 면 이 사이트의 DB 만 읽는다(브라우저가 150ms 뒤에 먼저 묻는다). 아니면 GitHub 검색 한 번도 함께(500ms 뒤).
 * - 두 출처를 합쳐 8줄까지(`mergeSuggestions`). GitHub 상태(`ok | limited | timeout | unavailable | off | skipped`)를 싣는다.
 * - 질의와 요청한 사람(IP)을 어디에도 적지 않는다. 모르는 오류도 이름만 적는다(질의를 싣지 않는다). 개발 서버의 요청 기록에서도
 *   이 경로를 뺀다(next.config.ts 의 `logging.incomingRequests.ignore`).
 */
export async function getSuggestions(request: Request, deps: ApiDeps = defaultDeps): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const q = cleanSuggestText(params.get("q"));
  const withGitHub = params.get("scope") !== "site";
  const config = deps.config();
  const base: SuggestResponse = {
    q,
    site: [],
    github: null,
    tagged: showsSyntheticTag(config),
    fakeGitHub: config.store === "db" && usesFakeGitHub(config),
  };
  if (q === "") return json(base);
  try {
    const found = await deps.store().suggest(q, { github: withGitHub });
    const merged = mergeSuggestions(found.site ?? [], found.github?.items ?? []);
    return json({
      ...base,
      site: found.site === null ? null : merged.site,
      github: found.github === null ? null : { ...found.github, items: merged.github },
    } satisfies SuggestResponse);
  } catch (error) {
    console.error(`[GET /api/repos/suggest] ${error instanceof Error ? error.name : "오류"}`);
    return json({ ...base, site: null, github: withGitHub ? { status: "unavailable", items: [], total: null } : null } satisfies SuggestResponse);
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
    const db = await deps.db();
    const outcome = await applyRunnerEvent(db, id, event, { now: deps.now(), limits: checked.config.limits });
    // 분석이 끝나거나 멈췄으면(또는 정리하며 다른 분석을 멈췄으면) 실행 자리가 났다. 대기열의 다음을 보낸다. 넘기지 못해도
    // 콜백의 답은 그대로다(실행기가 같은 콜백을 다시 보내지 않게).
    await tidyQueue(db, pumpDeps(deps, checked.config), "콜백").catch(() => null);
    return json(outcome.body, outcome.status);
  } catch (error) {
    return internalError("POST /api/runner/[id]", error);
  }
}

/**
 * POST /api/runner/claim/  로컬 실행기(RUNNER=local)가 실행 자리를 얻은 분석 하나를 집어 간다(먼저 대기열을 넘긴다). 다른
 * 실행기에서는 404.
 */
export async function postRunnerClaim(request: Request, deps: ApiDeps = defaultDeps): Promise<Response> {
  const checked = await signed(request, "claim", deps);
  if (!checked.ok) return checked.response;
  if (checked.config.runner.kind !== "local") return json({ ok: false, message: "로컬 실행기를 쓰지 않는 서버입니다." }, 404);
  try {
    const claimed = await claimQueued(await deps.db(), pumpDeps(deps, checked.config));
    return json({ ok: true, analysis: claimed });
  } catch (error) {
    return internalError("POST /api/runner/claim", error);
  }
}
