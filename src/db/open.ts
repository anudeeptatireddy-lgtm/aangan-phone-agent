import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlClient } from "./pg-booking-repo";

export interface DbConfig { DATABASE_URL?: string; LOCAL_DB_DIR?: string }
export interface OpenDb extends SqlClient { close(): Promise<void>; kind: "postgres" | "pglite" }

const MIGRATIONS = "supabase/migrations";

/**
 * Local Postgres (PGlite, a real Postgres compiled to WASM) persisted in a directory. The first query creates Supabase's three roles, applies every
 * migration not yet applied, and loads the generated seed. One process at a time may hold the directory: stop `next dev` before `seed:demo`.
 */
class LocalPglite implements OpenDb {
  readonly kind = "pglite" as const;
  private ready: Promise<{ query: SqlClient["query"]; close(): Promise<void> }>;
  constructor(private dir: string, private root = process.cwd()) { this.ready = this.boot(); }

  private async boot() {
    const { PGlite } = await import("@electric-sql/pglite");
    const { btree_gist } = await import("@electric-sql/pglite/contrib/btree_gist");
    mkdirSync(this.dir, { recursive: true });
    const db = await PGlite.create(this.dir, { extensions: { btree_gist } });
    await db.exec(`do $$ begin
      if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
    alter table public.app_migrations enable row level security;`);
    const dir = join(this.root, MIGRATIONS);
    const applied = new Set((await db.query<{ name: string }>("select name from public.app_migrations")).rows.map((r) => r.name));
    let changed = false;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
      if (applied.has(f)) continue;
      await db.exec(readFileSync(join(dir, f), "utf8"));
      await db.query("insert into public.app_migrations(name) values ($1)", [f]);
      changed = true;
    }
    const seed = join(this.root, "supabase/seed.sql");
    if (changed && existsSync(seed)) await db.exec(readFileSync(seed, "utf8"));
    return db as unknown as { query: SqlClient["query"]; close(): Promise<void> };
  }
  async query(sql: string, params?: unknown[]) { return (await this.ready).query(sql, params); }
  async close() { await (await this.ready).close(); }
}

class PgPool implements OpenDb {
  readonly kind = "postgres" as const;
  private pool: Promise<{ query: SqlClient["query"]; end(): Promise<void> }>;
  constructor(url: string) {
    this.pool = import("pg").then(({ default: pg }) => new pg.Pool({ connectionString: url, max: 5 }) as unknown as { query: SqlClient["query"]; end(): Promise<void> });
  }
  async query(sql: string, params?: unknown[]) { return (await this.pool).query(sql, params); }
  async close() { await (await this.pool).end(); }
}

/** DATABASE_URL (Supabase / any Postgres) wins; else LOCAL_DB_DIR (local PGlite); else undefined (in-memory stores: tests only). */
export function openDb(cfg: DbConfig, root?: string): OpenDb | undefined {
  if (cfg.DATABASE_URL) return new PgPool(cfg.DATABASE_URL);
  if (cfg.LOCAL_DB_DIR) return new LocalPglite(cfg.LOCAL_DB_DIR, root);
  return undefined;
}

/** A client whose rows are all marked demo data (sets `app.demo` for the connection). Single-connection clients only (PGlite). */
export async function demoScoped<T extends SqlClient>(db: T, on = true): Promise<T> {
  await db.query("select set_config('app.demo', $1, false)", [on ? "on" : "off"]);
  return db;
}
