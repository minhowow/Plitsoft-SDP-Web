import "server-only";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { readConfig } from "../config";

/**
 * DB 층. 운영은 Postgres(`DATABASE_URL` 이 있으면 `pg` 의 Pool), 로컬 개발과 시험은 PGlite(같은 Postgres 를 WebAssembly 로
 * 돌린 것)다. 둘 다 같은 SQL 을 돌리고, 쪽과 저장소 구현은 아래의 작은 인터페이스(`query`, `transaction`)만 안다.
 *
 * 스키마는 `migrations/*.sql` 을 이름 차례로, 처음 열 때 한 번 적용한다(적용한 이름은 `schema_migrations` 에 남는다).
 * 여러 서버가 동시에 열어도 한 번만 적용되게 권고 잠금(advisory lock) 안에서 한다.
 */

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Database extends Queryable {
  /** fn 안의 질의는 한 트랜잭션이다. fn 이 던지면 되돌린다. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: "postgres" | "pglite";
}

/** Postgres 오류 코드(SQLSTATE). 고유 제약(unique)에 걸렸다. */
export const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}

const MIGRATIONS_DIR = path.join(process.cwd(), "src", "server", "db", "migrations");
/** 마이그레이션을 한 서버만 적용하게 하는 권고 잠금의 번호(아무 값이나 고정). */
const MIGRATION_LOCK = 7_300_205;

export function readMigrations(dir = MIGRATIONS_DIR): { name: string; sql: string }[] {
  return readdirSync(dir)
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(dir, name), "utf8") }));
}

export async function migrate(db: Database, migrations = readMigrations()): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
    await tx.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await tx.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((row) => row.name));
    const applied: string[] = [];
    for (const { name, sql } of migrations) {
      if (done.has(name)) continue;
      // 한 파일에 여러 문이 있다. 매개변수 없는 단순 질의로 보낸다.
      await execMany(tx, sql);
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      applied.push(name);
    }
    return applied;
  });
}

/** 세미콜론으로 끝나는 문을 하나씩 보낸다. 마이그레이션 파일에는 문자열 안의 세미콜론을 두지 않는다. */
async function execMany(tx: Queryable, sql: string): Promise<void> {
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await tx.query(statement);
}

async function openPostgres(url: string): Promise<Database> {
  const { Pool } = await import("pg");
  // 서버리스 함수 하나가 여는 연결 수를 작게 둔다. Neon 같은 곳은 풀러 주소를 쓴다. 쉬는 연결은 오래 붙들지 않는다(DB 쪽이
  // 먼저 끊기 전에 이쪽에서 닫는다).
  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
  // 쉬는 연결을 DB 가 끊으면(Neon 등은 쉬는 연결을 닫는다) pg 의 Pool 이 'error' 를 낸다. 듣는 쪽이 없으면 과정 전체가
  // 죽는다. 이름만 적고 넘어간다(그 연결은 Pool 이 버리고, 다음 질의는 새 연결로 간다). 메시지에는 주소가 실릴 수 있어 적지 않는다.
  pool.on("error", (error: Error) => {
    console.error(`[db] 쉬는 연결 오류: ${error.name}`);
  });
  const wrap = (client: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> }): Queryable => ({
    async query<T>(text: string, params?: unknown[]) {
      const result = await client.query(text, params);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    },
  });
  return {
    kind: "postgres",
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await fn(wrap(client));
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite(dir: string): Promise<Database> {
  let PGlite: typeof import("@electric-sql/pglite").PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    throw new Error("DATABASE_URL 이 없고 PGlite(@electric-sql/pglite, 개발 의존성)도 없습니다. 운영에서는 DATABASE_URL 을 둡니다.");
  }
  if (!dir.startsWith("memory://")) await mkdir(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  type Lite = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> };
  const wrap = (client: Lite): Queryable => ({
    async query<T>(text: string, params?: unknown[]) {
      const result = await client.query(text, params);
      return { rows: result.rows as T[], rowCount: result.rows.length || (result.affectedRows ?? 0) };
    },
  });
  return {
    kind: "pglite",
    ...wrap(db),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close(),
  };
}

/** 설정대로 DB 를 열고 마이그레이션을 적용한다. */
export async function openDatabase(options: { databaseUrl: string | null; pgliteDir: string }): Promise<Database> {
  const db = options.databaseUrl ? await openPostgres(options.databaseUrl) : await openPglite(options.pgliteDir);
  try {
    await migrate(db);
  } catch (error) {
    await db.close().catch(() => undefined);
    throw error;
  }
  return db;
}

/**
 * 서버가 함께 쓰는 DB. 처음 부를 때 연다. 개발 서버가 모듈을 다시 불러와도 연결을 새로 만들지 않게 globalThis 에 둔다
 * (PGlite 는 한 폴더를 두 번 열면 안 된다). 열다 실패하면 다음 부름에서 다시 연다.
 */
const SHARED = Symbol.for("plitsoft.db");
type Holder = { [SHARED]?: Promise<Database> };

export function getDatabase(): Promise<Database> {
  const holder = globalThis as Holder;
  if (!holder[SHARED]) {
    const config = readConfig();
    holder[SHARED] = openDatabase({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir }).catch((error) => {
      delete holder[SHARED];
      throw error;
    });
  }
  return holder[SHARED];
}
