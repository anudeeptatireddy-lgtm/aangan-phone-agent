import { afterAll, describe, it } from "vitest";
import { execSync } from "node:child_process";
import { Pool } from "pg";
import { repoContract } from "../booking/repo.contract";
import { cleanupBookingFixture, seedBookingFixture } from "../booking/pg-fixture";
import { PgBookingRepo } from "@/db/pg-booking-repo";

// The booking-repo contract against the REAL local Supabase Postgres, over a connection pool: the "simultaneous holds" test
// therefore runs on two real connections and the exclusion constraint must pick exactly one winner.
const ON = process.env.SUPABASE_LOCAL === "1";

if (ON) {
  let pool: Pool | undefined;
  const getPool = () => {
    if (pool) return pool;
    const env = execSync("npx supabase status -o env", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const url = /^DB_URL="(.+)"$/m.exec(env)![1]!;
    return (pool = new Pool({ connectionString: url, max: 4 }));
  };
  afterAll(async () => { if (pool) { await cleanupBookingFixture((sql, p) => pool!.query(sql, p as unknown[])); await pool.end(); } });

  repoContract("Postgres (local Supabase, real connections)", async () => {
    const p = getPool();
    const fx = await seedBookingFixture((sql, params) => p.query(sql, params as unknown[]));
    return { repo: new PgBookingRepo({ query: (sql, params) => p.query(sql, params as unknown[]) }), ...fx };
  });
} else {
  describe.skip("BookingRepo contract: Postgres (local Supabase)", () => { it("runs only with SUPABASE_LOCAL=1 (pnpm test:supabase-local)", () => {}); });
}
