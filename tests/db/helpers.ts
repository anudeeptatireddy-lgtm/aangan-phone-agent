import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readdirSync, readFileSync } from "node:fs";

/** A real Postgres (WASM) with Supabase's roles pre-created, the migrations applied, and optionally the seed. */
export async function freshDb(opts: { seed: boolean }): Promise<PGlite> {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;");
  for (const f of readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  if (opts.seed) await db.exec(readFileSync("supabase/seed.sql", "utf8"));
  return db;
}
