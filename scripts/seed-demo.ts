// pnpm seed:demo         load (or reload) the demo data into the LOCAL database
// pnpm seed:demo:reset   remove it again
// Stop `pnpm dev` first: the local Postgres (PGlite) directory can be held by one process at a time.
import { existsSync } from "node:fs";
import { openDb } from "../src/db/open";
import { seedDemo } from "./demo/seed";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const dir = process.env.LOCAL_DB_DIR || "data/local/pglite";
const { PHONE_HASH_PEPPER, PHONE_ENC_KEY } = process.env;
if (!PHONE_HASH_PEPPER || !PHONE_ENC_KEY) { console.error("PHONE_HASH_PEPPER and PHONE_ENC_KEY are needed (they are in .env.local): demo callers' phones are stored encrypted like real ones."); process.exit(1); }
if (process.env.DATABASE_URL) console.log("Note: DATABASE_URL is set, but the demo only ever goes into the local database (LOCAL_DB_DIR).");

const db = openDb({ LOCAL_DB_DIR: dir })!;
try {
  console.log(`Loading the 40 September enquiries into ${dir} (demo data) ...`);
  const r = await seedDemo(db, { PHONE_HASH_PEPPER, PHONE_ENC_KEY }, { force: process.argv.includes("--force"), log: (s) => console.log(s) });
  console.log(`Done: ${r.calls} calls, ${r.booked} bookings, ${r.handoffs} hand-offs, ${r.deals} deals with a value.\nOpen the dashboard and switch to "Demo".`);
} catch (e) { console.error(String((e as Error).message)); process.exitCode = 1; } finally { await db.close(); }
