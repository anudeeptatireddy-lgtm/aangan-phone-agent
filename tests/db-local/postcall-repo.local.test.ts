import { afterAll, describe, it } from "vitest";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { postCallRepoContract } from "../postcall/repo.contract";
import { PgPostCallRepo } from "@/db/pg-postcall-repo";

// The post-call repo contract against the REAL local Supabase Postgres (both migrations + seed applied by the CLI).
const ON = process.env.SUPABASE_LOCAL === "1";

if (ON) {
  let pool: Pool | undefined;
  const keys = { pepper: "pepper-0123456789ab", encKey: randomBytes(32).toString("hex") };
  const getPool = () => {
    if (pool) return pool;
    const env = execSync("npx supabase status -o env", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    return (pool = new Pool({ connectionString: /^DB_URL="(.+)"$/m.exec(env)![1]!, max: 4 }));
  };
  const wipe = () => getPool().query("truncate outbox, usage_costs, audit_flags, escalations, rule_evaluations, calls, enquiries, callers restart identity cascade");
  afterAll(async () => { if (pool) { await wipe(); await pool.end(); } });

  postCallRepoContract("Postgres (local Supabase)", async () => {
    await wipe();
    return new PgPostCallRepo({ query: (sql, p) => getPool().query(sql, p as unknown[]) }, keys);
  });
} else {
  describe.skip("PostCallRepo contract: Postgres (local Supabase)", () => { it("runs only with SUPABASE_LOCAL=1 (pnpm test:supabase-local)", () => {}); });
}
