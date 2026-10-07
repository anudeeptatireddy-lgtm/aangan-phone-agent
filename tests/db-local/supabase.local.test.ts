import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { Client } from "pg";
import { SCRIPTS } from "@/core/scripts";

// Runs against the REAL local Supabase stack (Docker): `pnpm test:supabase-local`. Skipped in normal `pnpm test`.
// Checks what PGlite cannot: Supabase's own roles/default privileges, btree_gist on Supabase's Postgres, and PostgREST as `anon`.
const ON = process.env.SUPABASE_LOCAL === "1";

describe.skipIf(!ON)("local Supabase stack", () => {
  let pg: Client;
  let api = "", anon = "", service = "";
  let tables: string[] = [];

  beforeAll(async () => {
    const env: Record<string, string> = {};
    for (const l of execSync("npx supabase status -o env", { stdio: ["ignore", "pipe", "ignore"] }).toString().split("\n")) {
      const i = l.indexOf("=");
      if (i > 0) env[l.slice(0, i)] = l.slice(i + 1).replace(/^"|"$/g, "");
    }
    api = env.API_URL!; anon = env.ANON_KEY!; service = env.SERVICE_ROLE_KEY!;
    pg = new Client({ connectionString: env.DB_URL });
    await pg.connect();
    tables = (await pg.query("select tablename from pg_tables where schemaname='public' order by 1")).rows.map((r) => r.tablename);
  }, 60_000);
  afterAll(async () => { await pg?.end(); });

  const rest = (path: string, key: string, init: RequestInit = {}) =>
    fetch(`${api}/rest/v1/${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const inTx = async (fn: () => Promise<void>) => { await pg.query("begin"); try { await fn(); } finally { await pg.query("rollback"); } };

  it("the migration was applied by the Supabase CLI", async () => {
    const r = await pg.query("select version from supabase_migrations.schema_migrations");
    expect(r.rows.map((x) => x.version)).toContain("20261007000001");
  });

  it("Supabase's own security advisor reports nothing for this schema", () => {
    const out = execSync("npx supabase db advisors --local", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const json = JSON.parse(out.slice(out.indexOf("{")));
    expect(json.results.map((r: { level: string; name: string; detail?: string }) => `${r.level} ${r.name} ${r.detail ?? ""}`)).toEqual([]);
  }, 60_000);

  it("btree_gist is installed (outside public) and the double-booking exclusion constraint really blocks overlaps", async () => {
    expect((await pg.query("select extnamespace::regnamespace::text ns from pg_extension where extname='btree_gist'")).rows).toEqual([{ ns: "extensions" }]);
    expect((await pg.query("select 1 from pg_constraint where conname='no_double_booking' and contype='x'")).rowCount).toBe(1);
    await inTx(async () => {
      const d = (await pg.query("insert into designers(name) values ('X') returning id")).rows[0].id;
      const c = (await pg.query("insert into callers(phone_hash, phone_enc, phone_masked) values ('h-local', '\\x01', 'm') returning id")).rows[0].id;
      const e = (await pg.query("insert into enquiries(caller_id) values ($1) returning id", [c])).rows[0].id;
      const ins = (s: string, t: string) => pg.query("insert into bookings(enquiry_id, designer_id, starts_at, ends_at, status) values ($1,$2,$3,$4,'confirmed')", [e, d, s, t]);
      await ins("2026-10-12T10:00:00+05:30", "2026-10-12T11:00:00+05:30");
      await ins("2026-10-12T11:00:00+05:30", "2026-10-12T12:00:00+05:30"); // back-to-back is fine
      await pg.query("savepoint s");
      await expect(ins("2026-10-12T10:30:00+05:30", "2026-10-12T11:30:00+05:30")).rejects.toThrow(/exclusion constraint/);
      await pg.query("rollback to s");
    });
  });

  it("all 19 tables exist, each with RLS enabled AND forced", async () => {
    expect(tables).toHaveLength(19);
    const r = await pg.query("select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'");
    expect(r.rows).toHaveLength(19);
    for (const x of r.rows) { expect(x.relrowsecurity, x.relname).toBe(true); expect(x.relforcerowsecurity, x.relname).toBe(true); }
    expect((await pg.query("select 1 from pg_policies where schemaname='public'")).rowCount).toBe(0);
  });

  it("anon and authenticated hold no privileges on any table (including future ones)", async () => {
    const g = await pg.query("select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')");
    expect(g.rows).toEqual([]);
    await inTx(async () => {
      await pg.query("create table zz_probe (id int)"); // created by postgres: must NOT be auto-granted to anon/authenticated
      const p = await pg.query("select grantee from information_schema.role_table_grants where table_name='zz_probe' and grantee in ('anon','authenticated')");
      expect(p.rows).toEqual([]);
    });
  });

  it("SQL as anon / authenticated: permission denied on every table", async () => {
    for (const role of ["anon", "authenticated"]) for (const t of tables) {
      await pg.query("begin");
      await pg.query(`set local role ${role}`);
      await expect(pg.query(`select * from public.${t}`), `${role}.${t}`).rejects.toThrow(/permission denied/);
      await pg.query("rollback");
    }
  });

  it("PostgREST as anon reads NOTHING and writes NOTHING, on every table", async () => {
    for (const t of tables) {
      const get = await rest(`${t}?select=*&limit=1`, anon);
      const body = await get.json().catch(() => null);
      // 42501 = Postgres itself refused role `anon` (a bad/foreign key would give PGRST301 instead, so this cannot pass vacuously).
      expect(get.status, `GET ${t}`).toBe(401);
      expect(body?.code, `GET ${t}`).toBe("42501");
      const post = await rest(t, anon, { method: "POST", body: "{}" });
      expect(post.status, `POST ${t}`).toBe(401);
      expect((await post.json()).code, `POST ${t}`).toBe("42501");
    }
  });

  it("the service role (server only) can read; RLS does not lock the server out", async () => {
    const d = await (await rest("designers?select=name", service)).json();
    expect(d).toHaveLength(3);
    const c = await rest("callers?select=id", service);
    expect(c.status).toBe(200);
  });

  it("seed is in place: active rule v1, all scripts in 3 languages, 3 TEST designers", async () => {
    expect((await pg.query("select version, status from rule_versions")).rows).toEqual([{ version: 1, status: "active" }]);
    expect((await pg.query("select count(*)::int n from approved_texts")).rows[0].n).toBe(Object.keys(SCRIPTS).length * 3);
    expect((await pg.query("select count(*)::int n from designers where is_test")).rows[0].n).toBe(3);
  });

  it("no plaintext phone column exists", async () => {
    const r = await pg.query("select table_name||'.'||column_name c from information_schema.columns where table_schema='public' and (column_name ilike '%phone%' or column_name ilike '%e164%') order by 1");
    expect(r.rows.map((x) => x.c)).toEqual(["callers.phone_enc", "callers.phone_hash", "callers.phone_masked"]);
  });
});
