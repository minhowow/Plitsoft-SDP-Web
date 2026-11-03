import "server-only";
import { ServiceUnavailableError } from "@/lib/service/errors";
import { repoKey } from "@/lib/service/href";
import { isAnalysisId, newAnalysisId } from "@/lib/service/id";
import { isRepoFullName } from "@/lib/service/names";
import { STEP_LABEL, STEP_ORDER } from "@/lib/service/steps";
import type {
  Analysis,
  AnalysisStatus,
  AnalysisStep,
  Repository,
  RepositoryHit,
  RequestOutcome,
  ServiceStore,
  StepName,
} from "@/lib/service/types";
import { SITE } from "@/lib/site";
import type { ServerConfig } from "../config";
import { isUniqueViolation, type Database, type Queryable } from "../db";
import { GitHubError, type GitHubClient } from "../github";
import { wakeRunner, type WakeOutcome } from "../runner";

/**
 * 운영 저장소 구현: 분석 기록은 DB, 저장소 정보와 검색은 GitHub API.
 *
 * 오래된 분석(설계 7): RUN_TIMEOUT_MINUTES 를 넘게 끝나지 않은 분석은 읽거나 요청할 때 실패로 적는다. 까닭은 "시간 초과"이고
 * 멈춘 단계는 그때 진행 중이던 단계다. 멈춘 시각은 모르므로 그 단계의 끝난 시각을 적지 않는다(화면이 멈춘 시각을 꾸미지 않게).
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

export interface Row {
  id: string;
  owner: string;
  repo: string;
  commit_sha: string;
  branch: string;
  status: AnalysisStatus;
  failure_step: StepName | null;
  failure_reason: string | null;
  requested_at: Date | string;
  steps: AnalysisStep[] | string;
  tool_version: string | null;
  pack_digest: string | null;
}

export const COLUMNS =
  "id, owner, repo, commit_sha, branch, status, failure_step, failure_reason, requested_at, steps, tool_version, pack_digest";

const iso = (value: Date | string): string => (value instanceof Date ? value : new Date(value)).toISOString();

/** DB 의 단계 JSON 을 STEP_ORDER 의 차례로 모두 있게 읽는다. 없는 단계는 시작하지 않은 것으로 둔다. */
export function readSteps(raw: Row["steps"]): AnalysisStep[] {
  const list = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<AnalysisStep>[];
  return STEP_ORDER.map((name) => {
    const found = Array.isArray(list) ? list.find((step) => step?.name === name) : undefined;
    return {
      name,
      startedAt: typeof found?.startedAt === "string" ? found.startedAt : null,
      endedAt: typeof found?.endedAt === "string" ? found.endedAt : null,
    };
  });
}

export function rowToAnalysis(row: Row): Analysis {
  return {
    id: row.id,
    owner: row.owner,
    name: row.repo,
    commit: row.commit_sha,
    branch: row.branch,
    requestedAt: iso(row.requested_at),
    status: row.status,
    steps: readSteps(row.steps),
    failure:
      row.status === "failed" && row.failure_step && row.failure_reason
        ? { step: row.failure_step, reason: row.failure_reason }
        : null,
    versions: row.tool_version && row.pack_digest ? { tool: row.tool_version, pack: row.pack_digest } : null,
  };
}

/** 새 분석의 단계: 대기 단계가 요청한 때 시작했다. */
export function initialSteps(requestedAt: string): AnalysisStep[] {
  return STEP_ORDER.map((name) => ({ name, startedAt: name === "queued" ? requestedAt : null, endedAt: null }));
}

/** 끝나지 않은 분석이 머문 단계: 시작했고 끝나지 않은 단계, 없으면 시작하지 않은 첫 단계(단계 사이), 그것도 없으면 정리. */
export function stalledStep(steps: AnalysisStep[]): StepName {
  const open = steps.find((step) => step.startedAt && !step.endedAt);
  if (open) return open.name;
  const next = steps.find((step) => !step.startedAt && !step.endedAt);
  return next?.name ?? "finish";
}

export function timeoutReason(minutes: number, step: StepName): string {
  return `시간 초과: 요청한 뒤 ${minutes}분 안에 끝나지 않아 멈춘 것으로 적었습니다. ‘${STEP_LABEL[step]}’ 단계에 머물러 있었습니다.`;
}

/** 한국 표준시로 오늘이 시작한 시각(UTC). 하루 상한을 셀 때 쓴다. */
export function kstDayStart(now: Date): Date {
  const KST = 9 * 60 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  return new Date(Math.floor((now.getTime() + KST) / DAY) * DAY - KST);
}

/**
 * 시간을 넘긴 분석을 실패로 적는다. 다른 요청이 그새 바꿨으면(끝났으면) 건드리지 않는다. 쪽을 읽을 때, 요청을 받을 때, 실행기
 * 콜백을 받을 때 부른다.
 */
export async function sweepStale(db: Queryable, now: Date, runTimeoutMinutes: number): Promise<void> {
  const cutoff = new Date(now.getTime() - runTimeoutMinutes * 60_000);
  const stale = await db.query<Pick<Row, "id" | "steps">>(
    "SELECT id, steps FROM analyses WHERE status IN ('queued', 'running') AND requested_at < $1",
    [cutoff],
  );
  for (const row of stale.rows) {
    const step = stalledStep(readSteps(row.steps));
    await db.query(
      `UPDATE analyses SET status = 'failed', failure_step = $2, failure_reason = $3, finished_at = $4
       WHERE id = $1 AND status IN ('queued', 'running')`,
      [row.id, step, timeoutReason(runTimeoutMinutes, step), now],
    );
  }
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

  const sweep = (db: Queryable) => sweepStale(db, now(), limits.runTimeoutMinutes);

  /** 읽기 전에: DB 를 열고 오래된 분석을 정리한다. */
  async function reading(): Promise<Database> {
    const db = await database();
    await sweep(db);
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

  const requestsClosed = () => (deps.config.runner.kind === "none" ? SITE.service.runnerOff : null);

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
        if (error instanceof GitHubError) return { ok: false, message: error.message };
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
        if (!(error instanceof GitHubError)) throw error;
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

    async recentSucceeded(limit) {
      const db = await reading();
      const rows = await db.query<Row>(
        `SELECT ${COLUMNS} FROM analyses WHERE status = 'succeeded' ORDER BY finished_at DESC NULLS LAST, requested_at DESC LIMIT $1`,
        [limit],
      );
      return rows.rows.map(rowToAnalysis).map((analysis) => ({ repository: recorded(analysis), analysis }));
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
        if (error instanceof GitHubError) {
          return { ok: false, reason: error.kind === "rate-limit" ? "limit" : "unavailable", message: error.message };
        }
        throw error;
      }
      if (!commit) return { ok: false, reason: "not-found", message: "기본 브랜치의 끝 커밋을 찾지 못했습니다." };

      const db = await database();
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
        const moving = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM analyses WHERE status IN ('queued', 'running')");
        if (moving.rows[0].n >= limits.concurrent) {
          return {
            ok: false,
            reason: "limit",
            message: `지금 분석 ${moving.rows[0].n}건이 대기·진행 중이라(동시에 ${limits.concurrent}건까지) 받지 않았습니다. 그 분석이 끝난 뒤 다시 요청해 주세요.`,
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

      const woke = await wake({
        analysisId: created.analysis.id,
        owner: created.analysis.owner,
        repo: created.analysis.name,
        commit: created.analysis.commit,
        callbackBase: deps.config.runner.callbackBase,
      });
      if (woke.ok) return created;
      // 깨우지 못했으면 대기에 남겨 두지 않는다(아무도 집어 가지 않는다). 실패로 적고 까닭을 남긴다.
      const failed = await db.query<Row>(
        `UPDATE analyses SET status = 'failed', failure_step = 'queued', failure_reason = $2, finished_at = $3
         WHERE id = $1 AND status = 'queued' RETURNING ${COLUMNS}`,
        [created.analysis.id, woke.reason, now()],
      );
      return { ok: true, analysis: failed.rows[0] ? rowToAnalysis(failed.rows[0]) : created.analysis, reused: false };
    },
  };
}
