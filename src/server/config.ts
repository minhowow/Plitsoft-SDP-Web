import "server-only";

/**
 * 서버의 설정. 모두 환경 변수로 바꿀 수 있고, 없으면 아래 기본값이다(docs/direction.md 의 "기본 제한 값"과 같게 둔다).
 * 비밀값(토큰·키)은 이 파일이 읽기만 하고 어디에도 적지 않는다. 화면과 응답에는 비밀값이 있는지 없는지도 싣지 않는다.
 *
 * 값은 부를 때마다 `process.env` 에서 다시 읽는다(빌드한 때가 아니라 요청 때의 값. 시험이 환경 변수를 바꿔 볼 수 있다).
 */

export type StoreKind = "db" | "synthetic";
export type RunnerKind = "github" | "local" | "none";

export interface ServerConfig {
  /** `synthetic` 이면 합성 저장소(미리보기·시험용). 그 밖에는 DB + GitHub. */
  store: StoreKind;
  /** 운영 Postgres 주소. 없으면 PGlite(파일)를 쓴다. */
  databaseUrl: string | null;
  /** PGlite 의 폴더. 기본 `.data/pglite`. `memory://` 이면 메모리에만 둔다(시험). */
  pgliteDir: string;
  github: {
    /** GitHub API 의 바탕 주소. 기본 https://api.github.com. 개발·시험에서는 로컬 가짜 서버로 바꾼다. */
    apiBase: string;
    /** 있으면 쓴다. 없으면 토큰 없이 부른다(요청 수 상한이 낮다). */
    token: string | null;
    /** 검색 결과를 서버 메모리에 두는 시간(초). */
    searchCacheSeconds: number;
    /** 저장소 정보를 서버 메모리에 두는 시간(초). */
    repoCacheSeconds: number;
    /** 기본 브랜치 끝 커밋을 서버 메모리에 두는 시간(초). */
    commitCacheSeconds: number;
    /** 이 사이트 전체(서버 인스턴스 모두가 DB 의 카운터를 함께 쓴다)가 1분에 GitHub 검색을 부르는 수 상한(요청한 사람을 가리지 않는다). */
    searchPerMinute: number;
    /** 이 사이트 전체가 1분에 검색 밖의 GitHub API 를 부르는 수 상한. */
    callsPerMinute: number;
  };
  limits: {
    /** 받는 저장소 크기 상한(KB, GitHub 의 `size`). */
    maxRepoKb: number;
    /** 같은 커밋의 끝난 분석으로 보내는 시간(분). */
    dedupeMinutes: number;
    /** 하루(한국 표준시) 새로 만드는 분석 수 상한. */
    daily: number;
    /**
     * 실행 자리 수(POOL_SIZE. 옛 이름 CONCURRENT_LIMIT 도 읽는다). 실행기에 보냈거나 분석 중인 분석이 이보다 적을 때만 대기열의
     * 다음 분석을 실행기에 보낸다(`src/server/queue.ts`). 요청은 이 수 때문에 거절하지 않는다.
     */
    poolSize: number;
    /** 대기열(실행기에 보내기 전)에 둘 수 있는 분석 수. 넘으면 그때만 요청을 받지 않는다(429). */
    queueLimit: number;
    /** 실행기에 보낸 뒤 이 시간(분)을 넘게 끝나지 않은 분석은 '시간 초과'로 실패 처리한다(요청한 때가 아니라 보낸 때부터 센다). */
    runTimeoutMinutes: number;
    /** 실행기에 보낸 뒤 이 시간(분) 안에 실행기가 시작을 알리지 않으면 실패로 적고 다음을 보낸다. */
    dispatchTimeoutMinutes: number;
    /** 대기열에서 이 시간(분)을 넘게 실행 자리를 기다린 분석은 까닭과 함께 실패로 적는다. */
    queueTimeoutMinutes: number;
    /** 실행기가 보내는 결과 JSON 의 크기 상한(KB). 넘는 콜백은 받지 않는다(413). */
    maxResultKb: number;
  };
  runner: {
    kind: RunnerKind;
    /** RUNNER=github: workflow_dispatch 를 부를 실행기 저장소(owner/repo)와 워크플로 파일, 토큰. */
    repo: string | null;
    workflow: string;
    ref: string;
    token: string | null;
    /** 실행기가 진행·결과를 알릴 이 사이트의 주소(SITE_URL, 예: https://….vercel.app). 끝 빗금은 뗀다. */
    callbackBase: string | null;
    /**
     * 실행기 콜백의 서명 열쇠(RUNNER_SECRET, 비밀값). 실행기와 이 서버가 같은 값을 지닌다. 없으면 콜백을 모두 거절한다
     * (`src/server/signature.ts`).
     */
    secret: string | null;
  };
}

/** 기본값. docs/direction.md 의 표와 같다(tests/server-config.test.ts 가 견준다). */
export const DEFAULTS = {
  pgliteDir: ".data/pglite",
  githubApiBase: "https://api.github.com",
  searchCacheSeconds: 60,
  repoCacheSeconds: 300,
  commitCacheSeconds: 30,
  githubSearchPerMinute: 10,
  githubCallsPerMinute: 60,
  maxRepoKb: 100_000,
  dedupeMinutes: 60,
  daily: 30,
  poolSize: 2,
  queueLimit: 20,
  runTimeoutMinutes: 25,
  dispatchTimeoutMinutes: 10,
  queueTimeoutMinutes: 120,
  // Vercel 의 함수가 받는 요청 본문은 4.5MB 까지다. 그보다 조금 작게 둔다.
  maxResultKb: 4_000,
  // 설정하지 않은 배포가 요청을 받아 놓고 아무도 집어 가지 않는 일이 없게, 기본은 받지 않음이다.
  runner: "none" as RunnerKind,
  runnerWorkflow: "analyze.yml",
  runnerRef: "main",
} as const;

type Env = Record<string, string | undefined>;

const text = (env: Env, name: string): string | null => {
  const value = env[name]?.trim();
  return value ? value : null;
};

/** 양의 정수. 없거나 읽을 수 없으면 기본값이다(잘못 적은 값을 0 이나 무한으로 읽지 않는다). */
function positive(env: Env, name: string, fallback: number): number {
  const value = text(env, name);
  if (value === null || !/^\d+$/.test(value)) return fallback;
  const n = Number.parseInt(value, 10);
  return n > 0 ? n : fallback;
}

function apiBase(env: Env): string {
  const value = text(env, "GITHUB_API_BASE") ?? DEFAULTS.githubApiBase;
  return value.replace(/\/+$/, "");
}

export function readConfig(env: Env = process.env): ServerConfig {
  const runner = text(env, "RUNNER");
  return {
    store: text(env, "SERVICE_STORE") === "synthetic" ? "synthetic" : "db",
    databaseUrl: text(env, "DATABASE_URL"),
    pgliteDir: text(env, "PGLITE_DIR") ?? DEFAULTS.pgliteDir,
    github: {
      apiBase: apiBase(env),
      token: text(env, "GITHUB_TOKEN"),
      searchCacheSeconds: positive(env, "SEARCH_CACHE_SECONDS", DEFAULTS.searchCacheSeconds),
      repoCacheSeconds: positive(env, "REPO_CACHE_SECONDS", DEFAULTS.repoCacheSeconds),
      commitCacheSeconds: positive(env, "COMMIT_CACHE_SECONDS", DEFAULTS.commitCacheSeconds),
      searchPerMinute: positive(env, "GITHUB_SEARCH_PER_MINUTE", DEFAULTS.githubSearchPerMinute),
      callsPerMinute: positive(env, "GITHUB_CALLS_PER_MINUTE", DEFAULTS.githubCallsPerMinute),
    },
    limits: {
      maxRepoKb: positive(env, "MAX_REPO_KB", DEFAULTS.maxRepoKb),
      dedupeMinutes: positive(env, "DEDUPE_MINUTES", DEFAULTS.dedupeMinutes),
      daily: positive(env, "DAILY_LIMIT", DEFAULTS.daily),
      // POOL_SIZE 가 없으면 옛 이름 CONCURRENT_LIMIT 을 읽는다(이미 그 이름으로 넣어 둔 배포가 같은 값으로 돌게).
      poolSize: positive(env, "POOL_SIZE", positive(env, "CONCURRENT_LIMIT", DEFAULTS.poolSize)),
      queueLimit: positive(env, "QUEUE_LIMIT", DEFAULTS.queueLimit),
      runTimeoutMinutes: positive(env, "RUN_TIMEOUT_MINUTES", DEFAULTS.runTimeoutMinutes),
      dispatchTimeoutMinutes: positive(env, "DISPATCH_TIMEOUT_MINUTES", DEFAULTS.dispatchTimeoutMinutes),
      queueTimeoutMinutes: positive(env, "QUEUE_TIMEOUT_MINUTES", DEFAULTS.queueTimeoutMinutes),
      maxResultKb: positive(env, "RESULT_MAX_KB", DEFAULTS.maxResultKb),
    },
    runner: {
      kind: runner === "github" || runner === "none" || runner === "local" ? runner : DEFAULTS.runner,
      repo: text(env, "RUNNER_REPO"),
      workflow: text(env, "RUNNER_WORKFLOW") ?? DEFAULTS.runnerWorkflow,
      ref: text(env, "RUNNER_REF") ?? DEFAULTS.runnerRef,
      token: text(env, "RUNNER_TOKEN"),
      callbackBase: text(env, "SITE_URL")?.replace(/\/+$/, "") ?? null,
      secret: text(env, "RUNNER_SECRET"),
    },
  };
}

/**
 * GitHub API 의 바탕 주소가 기본값(실제 GitHub)이 아닌지. 로컬 가짜 GitHub(scripts/github-stub.mjs)이나 시험의 가짜 서버다. 그때
 * 찾는 저장소는 합성 저장소뿐이라, 검색 0건 화면이 그 사실을 한 줄로 적는다(docs/redesign.md 3장 "검색").
 */
export function usesFakeGitHub(config: Pick<ServerConfig, "github">): boolean {
  return config.github.apiBase !== DEFAULTS.githubApiBase;
}

/**
 * "합성 예시" 이름표를 다는지(docs/redesign.md 4장, docs/commitments.md 의 1). 합성 저장소(SERVICE_STORE=synthetic)이거나 GitHub 이
 * 가짜(GITHUB_API_BASE 가 기본값이 아님)일 때다. 운영 설정(DB, 실제 GitHub)에서는 거짓이다(tests/server-config.test.ts).
 * 첫 화면·검색·저장소 쪽이 이것 하나로 정한다.
 */
export function showsSyntheticTag(config: Pick<ServerConfig, "store" | "github"> = readConfig()): boolean {
  return config.store === "synthetic" || usesFakeGitHub(config);
}
