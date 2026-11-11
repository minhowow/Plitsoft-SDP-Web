import "server-only";
import { parseProfileText } from "@/lib/profile";
import { parseReviewText } from "@/lib/review";
import { ServiceUnavailableError } from "@/lib/service/errors";
import { repoKey } from "@/lib/service/href";
import { isAnalysisId, newAnalysisId } from "@/lib/service/id";
import { isRepoFullName } from "@/lib/service/names";
import { githubSuggestQuery, SUGGEST_ROWS, type GitHubSuggestPart, type SiteSuggestion } from "@/lib/service/suggest";
import type { Analysis, AnalysisStatus, Repository, RepositoryHit, RequestOutcome, ServiceStore } from "@/lib/service/types";
import { SITE } from "@/lib/site";
import { localRunnerOnRealGitHub, type ServerConfig } from "../config";
import { isUniqueViolation, type Database, type Queryable } from "../db";
import { isGitHubError, type GitHubClient, type GitHubError } from "../github";
import { readQueue, sweepStale, tidyQueue, type PumpDeps } from "../queue";
import { wakeRunner, type WakeOutcome } from "../runner";
import { COLUMNS, initialSteps, iso, rowToAnalysis, type Row } from "./rows";

// 다른 곳(콜백, 시험)이 이 파일에서 읽던 것.
/** 분석 행의 감지된 기능 이름(JSON 글 배열). 비었거나 모양이 다르면 null(모름). */
function readNames(text: string | null): string[] | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) && value.every((name) => typeof name === "string") ? value : null;
  } catch {
    return null;
  }
}

export { COLUMNS, initialSteps, readSteps, rowToAnalysis, stalledStep, type Row } from "./rows";
export { sweepStale, timeoutReason } from "../queue";

/**
 * 운영 저장소 구현: 분석 기록은 DB, 저장소 정보와 검색은 GitHub API.
 *
 * 요청은 대기열에 받고, 실행 자리가 비면 실행기를 깨운다(`../queue.ts`). 읽거나 요청할 때 `tidyQueue` 를 한다: 실행기에 보낸
 * 뒤 시간을 넘긴 분석을 실패로 적고, 빈 자리만큼 대기열을 넘기고, 그래도 보내지 못한 오래된 대기열의 분석을 대기 시간 초과로
 * 적는다. 멈춘 시각은 모르므로 그 단계의 끝난 시각을 적지 않는다(화면이 멈춘 시각을 꾸미지 않게).
 */

export interface DbStoreDeps {
  db: () => Promise<Database>;
  github: GitHubClient;
  config: Pick<ServerConfig, "limits" | "runner" | "github">;
  now?: () => Date;
  /** 실행기 깨우기. 시험이 바꿔 끼운다. */
  wake?: (input: Parameters<typeof wakeRunner>[1]) => Promise<WakeOutcome>;
  newId?: () => string;
}

/** 한국 표준시로 오늘이 시작한 시각(UTC). 하루 상한을 셀 때 쓴다. */
export function kstDayStart(now: Date): Date {
  const KST = 9 * 60 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  return new Date(Math.floor((now.getTime() + KST) / DAY) * DAY - KST);
}

/** 요청을 하나씩 차례로 받게 하는 권고 잠금의 번호(같은 커밋 확인 → 상한 확인 → 행 만들기 사이에 다른 요청이 끼지 않게). */
const REQUEST_LOCK = 31_000_002;

export function createDbStore(deps: DbStoreDeps): ServiceStore {
  const now = deps.now ?? (() => new Date());
  const { limits } = deps.config;
  const wake = deps.wake ?? ((input) => wakeRunner(deps.config, input));
  const newId = deps.newId ?? (() => newAnalysisId());

  async function database(): Promise<Database> {
    try {
      return await deps.db();
    } catch {
      throw new ServiceUnavailableError("분석 기록을 읽지 못했습니다. 잠시 뒤에 다시 해 보세요.");
    }
  }

  const sweep = (db: Queryable) => sweepStale(db, now(), limits);
  const pump: PumpDeps = {
    now,
    limits,
    wake,
    callbackBase: deps.config.runner.callbackBase,
    runner: deps.config.runner.kind,
    review: deps.config.runner.review,
  };

  /**
   * 읽기 전에: DB 를 열고 `tidyQueue`(정리 → 빈 자리만큼 넘기기 → 대기 시간 초과)를 한다. 아무도 깨우지 않는 동안 자리가 비어
   * 있었으면 대기열의 분석은 이때 넘어간다. 할 일이 없으면 잠금 없는 질의 몇 개로 끝난다. 깨우기를 쉬는 동안(앞서 깨우지 못함)은
   * 깨우지 않는다.
   */
  async function reading(): Promise<Database> {
    const db = await database();
    await tidyQueue(db, pump, "읽기");
    return db;
  }

  async function analysesOf(db: Queryable, owner: string, name: string): Promise<Analysis[]> {
    const rows = await db.query<Row>(`SELECT ${COLUMNS} FROM analyses WHERE repo_key = $1 ORDER BY requested_at DESC, id`, [
      repoKey(owner, name),
    ]);
    return rows.rows.map(rowToAnalysis);
  }

  /** 기록에 있는 이름으로 만든 저장소. GitHub 에 닿지 못할 때만 쓴다. GitHub 에서 오는 것은 비워 둔다. */
  function recorded(analysis: Analysis): Repository {
    return {
      owner: analysis.owner,
      name: analysis.name,
      description: null,
      defaultBranch: analysis.branch,
      language: null,
      htmlUrl: null,
      synthetic: false,
    };
  }

  const requestsClosed = () => {
    if (deps.config.runner.kind === "none") return SITE.service.runnerOff;
    // 로컬 실행기는 합성 데모 코드만 검사한다. 실제 GitHub 의 저장소 이름에 가짜 결과를 붙이지 않게 요청을 받지 않는다.
    if (localRunnerOnRealGitHub(deps.config)) return SITE.service.localRealGitHub;
    return null;
  };

  /** GitHub 을 부르지 못한 까닭을 자동 완성·검색 쪽이 함께 쓰는 갈래로. */
  const failureKind = (error: GitHubError) => (error.kind === "rate-limit" ? "limited" : error.kind) as "limited" | "timeout" | "unavailable";

  /** ① 이 사이트에서 분석된 저장소 가운데 owner/name(소문자)에 글자가 그대로 든 것. 읽기만 한다(정리하지 않는다). 읽지 못하면 null. */
  async function siteSuggestions(text: string): Promise<SiteSuggestion[] | null> {
    const pattern = `%${text.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    try {
      const db = await database();
      const rows = await db.query<{ owner: string; repo: string; n: number; latest_at: Date | string }>(
        `SELECT l.owner, l.repo, s.n, s.latest_at
         FROM (
           SELECT repo_key, count(*)::int AS n, max(requested_at) AS latest_at
           FROM analyses WHERE repo_key LIKE $1 ESCAPE '\\' GROUP BY repo_key
         ) s
         CROSS JOIN LATERAL (
           SELECT owner, repo FROM analyses a WHERE a.repo_key = s.repo_key ORDER BY requested_at DESC, id LIMIT 1
         ) l
         ORDER BY s.latest_at DESC, s.repo_key
         LIMIT $2`,
        [pattern, SUGGEST_ROWS],
      );
      return rows.rows.map((row) => ({ owner: row.owner, name: row.repo, analyses: row.n, latestAt: iso(row.latest_at) }));
    } catch (error) {
      // DB 를 열지 못했거나 읽다 틀렸다: 이 출처만 '읽지 못함'(null)이다. GitHub 쪽의 답은 그대로 둔다(그 상태를 덮지 않는다).
      // 질의를 싣지 않고 오류 이름만 적는다.
      if (!(error instanceof ServiceUnavailableError)) console.error(`[GET /api/repos/suggest] 이 사이트의 줄: ${error instanceof Error ? error.name : "오류"}`);
      return null;
    }
  }

  /** ② GitHub 검색 한 번. 묻지 못하면 그 까닭(상태)이다. */
  async function githubSuggestions(text: string): Promise<GitHubSuggestPart> {
    const eligible = githubSuggestQuery(text);
    if (!eligible.ok) return { status: "skipped", items: [], total: null, skipped: eligible.reason };
    try {
      const page = await deps.github.suggest(eligible.query);
      return {
        status: "ok",
        items: page.repositories.map((r) => ({ owner: r.owner, name: r.name, description: r.description, language: r.language })),
        total: page.total,
      };
    } catch (error) {
      if (isGitHubError(error)) return { status: failureKind(error), items: [], total: null };
      throw error;
    }
  }

  /** 화면에 쓰는 것만 남긴다(요청 검사용 크기를 쪽으로 넘기지 않는다). */
  const strip = (r: Repository): Repository => ({
    owner: r.owner,
    name: r.name,
    description: r.description,
    defaultBranch: r.defaultBranch,
    language: r.language,
    htmlUrl: r.htmlUrl,
    synthetic: r.synthetic,
  });

  return {
    synthetic: false,

    requestsClosed,

    async search(query) {
      let page;
      try {
        page = await deps.github.search(query);
      } catch (error) {
        if (isGitHubError(error)) return { ok: false, message: error.message, github: failureKind(error) };
        throw error;
      }
      const db = await reading();
      const keys = page.repositories.map((repository) => repoKey(repository.owner, repository.name));
      const counts = new Map<string, { n: number; id: string; status: AnalysisStatus; requested_at: Date | string }>();
      if (keys.length > 0) {
        const rows = await db.query<{ repo_key: string; n: number; id: string; status: AnalysisStatus; requested_at: Date | string }>(
          `SELECT c.repo_key, c.n, l.id, l.status, l.requested_at
           FROM (SELECT repo_key, count(*)::int AS n FROM analyses WHERE repo_key = ANY($1::text[]) GROUP BY repo_key) c
           CROSS JOIN LATERAL (
             SELECT id, status, requested_at FROM analyses a WHERE a.repo_key = c.repo_key ORDER BY requested_at DESC, id LIMIT 1
           ) l`,
          [keys],
        );
        for (const row of rows.rows) counts.set(row.repo_key, row);
      }
      const hits: RepositoryHit[] = page.repositories.map((repository) => {
        const count = counts.get(repoKey(repository.owner, repository.name));
        return {
          repository: strip(repository),
          analyses: count?.n ?? 0,
          latest: count ? { id: count.id, status: count.status, requestedAt: iso(count.requested_at) } : null,
        };
      });
      return { ok: true, hits, total: page.total };
    },

    async getRepository(owner, name) {
      if (!isRepoFullName(owner, name)) return null;
      try {
        const found = await deps.github.getRepository(owner, name);
        return found && strip(found);
      } catch (error) {
        if (!isGitHubError(error)) throw error;
        // GitHub 에 닿지 못해도 이 사이트에 남은 분석은 보인다. 이름은 기록에 있는 그대로다.
        const [latest] = await analysesOf(await reading(), owner, name);
        if (latest) return recorded(latest);
        throw new ServiceUnavailableError(error.message);
      }
    },

    async listAnalyses(owner, name) {
      return analysesOf(await reading(), owner, name);
    },

    async getAnalysis(owner, name, id) {
      const db = await reading();
      const rows = await db.query<Row>(`SELECT ${COLUMNS} FROM analyses WHERE id = $1 AND repo_key = $2`, [id, repoKey(owner, name)]);
      return rows.rows[0] ? rowToAnalysis(rows.rows[0]) : null;
    },

    async findAnalysis(id) {
      if (!isAnalysisId(id)) return null;
      const db = await reading();
      const rows = await db.query<Row>(`SELECT ${COLUMNS} FROM analyses WHERE id = $1`, [id]);
      return rows.rows[0] ? rowToAnalysis(rows.rows[0]) : null;
    },

    async getResult(id) {
      const db = await database();
      const rows = await db.query<{ json: string }>(
        "SELECT r.json FROM results r JOIN analyses a ON a.id = r.analysis_id WHERE r.analysis_id = $1 AND a.status = 'succeeded'",
        [id],
      );
      const text = rows.rows[0]?.json;
      if (text === undefined) return null;
      // 받은 그대로 두었다. JSON 이 아니면 글 그대로 넘긴다(파서가 읽지 못한다고 말한다).
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    },

    async findingCounts(ids) {
      const wanted = ids.filter(isAnalysisId);
      if (wanted.length === 0) return {};
      const db = await database();
      const rows = await db.query<{ id: string; finding_count: number | null }>(
        "SELECT id, finding_count FROM analyses WHERE id = ANY($1::text[]) AND status = 'succeeded'",
        [wanted],
      );
      return Object.fromEntries(rows.rows.map((row) => [row.id, row.finding_count]));
    },

    async getProfile(id) {
      if (!isAnalysisId(id)) return null;
      const db = await database();
      const rows = await db.query<{ profile: string | null }>(
        "SELECT r.profile FROM results r JOIN analyses a ON a.id = r.analysis_id WHERE r.analysis_id = $1 AND a.status = 'succeeded'",
        [id],
      );
      return parseProfileText(rows.rows[0]?.profile);
    },

    async getReview(owner, name, commit) {
      if (!/^[0-9a-f]{40}$/.test(commit)) return null;
      const db = await database();
      // 같은 커밋의 다른 분석이 받은 것도 보인다(같은 커밋은 다시 돌리지 않는다). 가장 나중에 받은 것.
      const rows = await db.query<{ review: string }>(
        `SELECT r.review FROM results r JOIN analyses a ON a.id = r.analysis_id
         WHERE a.repo_key = $1 AND a.commit_sha = $2 AND a.status = 'succeeded' AND r.review IS NOT NULL
         ORDER BY a.finished_at DESC NULLS LAST, a.requested_at DESC, a.id DESC LIMIT 1`,
        [repoKey(owner, name), commit],
      );
      return parseReviewText(rows.rows[0]?.review);
    },

    async featureNames(ids) {
      const wanted = ids.filter(isAnalysisId);
      if (wanted.length === 0) return {};
      const db = await database();
      const rows = await db.query<{ id: string; feature_names: string | null }>(
        "SELECT id, feature_names FROM analyses WHERE id = ANY($1::text[]) AND status = 'succeeded'",
        [wanted],
      );
      return Object.fromEntries(rows.rows.map((row) => [row.id, readNames(row.feature_names)]));
    },

    async queue() {
      return readQueue(await database(), limits.poolSize, now());
    },

    async recentActivity(limit) {
      // 정리(tidyQueue) 뒤에 읽는다: 시간을 넘긴 분석은 이미 실패로 적혀 있다. 저장소마다(소문자 열쇠 repo_key) 한 줄을 고르는
      // 차례는 src/lib/service/activity.ts 의 pickActivity 와 같다(대기·분석 중 먼저, 그다음 나중에 요청한 것, 같으면 id).
      const db = await reading();
      const rows = await db.query<Row & { n: number; latest_at: Date | string }>(
        `SELECT * FROM (
           SELECT DISTINCT ON (repo_key) ${COLUMNS}, (count(*) OVER per_repo)::int AS n, max(requested_at) OVER per_repo AS latest_at
           FROM analyses
           WINDOW per_repo AS (PARTITION BY repo_key)
           ORDER BY repo_key, (status IN ('queued', 'running')) DESC, requested_at DESC, id
         ) picked
         ORDER BY requested_at DESC, id
         LIMIT $1`,
        [Math.max(0, Math.floor(limit))],
      );
      return rows.rows.map((row) => {
        const analysis = rowToAnalysis(row);
        return { repository: recorded(analysis), analysis, analyses: row.n, latestAt: iso(row.latest_at) };
      });
    },

    async suggest(text, options) {
      const [site, github] = await Promise.all([siteSuggestions(text), options.github ? githubSuggestions(text) : Promise.resolve(null)]);
      return { site, github };
    },

    async requestAnalysis(owner, name): Promise<RequestOutcome> {
      const closed = requestsClosed();
      if (closed) return { ok: false, reason: "closed", message: closed };
      const notFound: RequestOutcome = { ok: false, reason: "not-found", message: "그런 공개 저장소를 찾지 못했습니다." };
      if (!isRepoFullName(owner, name)) return notFound;

      let repository;
      let commit: string | null;
      try {
        repository = await deps.github.getRepository(owner, name);
        if (!repository) return notFound;
        if (repository.sizeKb > limits.maxRepoKb) {
          return {
            ok: false,
            reason: "too-large",
            message: `저장소가 너무 커서 분석하지 않습니다(GitHub 이 센 크기 ${repository.sizeKb.toLocaleString("en-US")}KB, 상한 ${limits.maxRepoKb.toLocaleString("en-US")}KB).`,
          };
        }
        commit = await deps.github.headCommit(repository.owner, repository.name, repository.defaultBranch);
      } catch (error) {
        // 요청 수 상한(GitHub 의 것이든 이 사이트의 예산이든)은 상한으로(429), 닿지 못함은 쓸 수 없음으로(503) 답한다.
        if (isGitHubError(error)) {
          return { ok: false, reason: error.kind === "rate-limit" ? "limit" : "unavailable", message: error.message };
        }
        throw error;
      }
      if (!commit) return { ok: false, reason: "not-found", message: "기본 브랜치의 끝 커밋을 찾지 못했습니다." };

      // 받기 전에 정리한다(오래 기다린 대기열의 분석이 대기열 상한을 붙들지 않게, 비어 있던 자리를 먼저 채우게).
      const db = await reading();
      const key = repoKey(repository.owner, repository.name);
      const requestedAt = now();
      const created = await db.transaction(async (tx): Promise<RequestOutcome> => {
        await tx.query("SELECT pg_advisory_xact_lock($1)", [REQUEST_LOCK]);
        await sweep(tx);
        const dedupeFrom = new Date(requestedAt.getTime() - limits.dedupeMinutes * 60_000);
        const same = await tx.query<Row>(
          `SELECT ${COLUMNS} FROM analyses
           WHERE repo_key = $1 AND commit_sha = $2
             AND (status IN ('queued', 'running') OR (status = 'succeeded' AND finished_at > $3))
           ORDER BY requested_at DESC LIMIT 1`,
          [key, commit, dedupeFrom],
        );
        if (same.rows[0]) return { ok: true, analysis: rowToAnalysis(same.rows[0]), reused: true };

        const today = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM analyses WHERE requested_at >= $1", [
          kstDayStart(requestedAt),
        ]);
        if (today.rows[0].n >= limits.daily) {
          return {
            ok: false,
            reason: "limit",
            message: `오늘(한국 표준시) 받을 수 있는 분석 ${limits.daily}건을 모두 받았습니다. 내일 다시 요청해 주세요.`,
          };
        }
        // 실행 자리(POOL_SIZE)가 차 있어도 받는다. 대기열이 QUEUE_LIMIT 이면 그때만 받지 않는다.
        const waiting = await tx.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM analyses WHERE status = 'queued' AND dispatched_at IS NULL",
        );
        if (waiting.rows[0].n >= limits.queueLimit) {
          return {
            ok: false,
            reason: "limit",
            message: `대기열이 가득 차 받지 않았습니다(실행 자리를 기다리는 분석 ${waiting.rows[0].n}건, 대기열 상한 ${limits.queueLimit}건). 앞의 분석이 실행기로 넘어간 뒤 다시 요청해 주세요.`,
          };
        }
        const at = requestedAt.toISOString();
        const rows = await tx.query<Row>(
          `INSERT INTO analyses (id, owner, repo, repo_key, commit_sha, branch, status, requested_at, steps)
           VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8::jsonb) RETURNING ${COLUMNS}`,
          [newId(), repository.owner, repository.name, key, commit, repository.defaultBranch, requestedAt, JSON.stringify(initialSteps(at))],
        );
        return { ok: true, analysis: rowToAnalysis(rows.rows[0]), reused: false };
      }).catch(async (error: unknown): Promise<RequestOutcome> => {
        // 권고 잠금이 있어도, 잠금 밖에서 같은 커밋의 분석이 생기는 길(다른 판의 서버 등)이 남을 수 있다. 고유 제약이 마지막 그물이다.
        if (!isUniqueViolation(error)) throw error;
        const rows = await db.query<Row>(
          `SELECT ${COLUMNS} FROM analyses WHERE repo_key = $1 AND commit_sha = $2 AND status IN ('queued', 'running') LIMIT 1`,
          [key, commit],
        );
        if (!rows.rows[0]) throw error;
        return { ok: true, analysis: rowToAnalysis(rows.rows[0]), reused: true };
      });
      if (!created.ok || created.reused) return created;

      // 자리가 비어 있으면 이 분석(또는 그 앞의 분석)을 실행기에 보낸다. 깨우지 못하거나 넘기다 DB 오류가 나도 요청은 받은
      // 것이다(대기열에 남고, 다음 깨우는 때 넘어간다).
      await tidyQueue(db, pump, "요청").catch(() => null);
      const after = await db.query<Row>(`SELECT ${COLUMNS} FROM analyses WHERE id = $1`, [created.analysis.id]).catch(() => null);
      return { ok: true, analysis: after?.rows[0] ? rowToAnalysis(after.rows[0]) : created.analysis, reused: false };
    },
  };
}
