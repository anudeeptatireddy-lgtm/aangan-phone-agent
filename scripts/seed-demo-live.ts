// pnpm seed:demo:live          load (or reload) the demo data into the HOSTED database (DATABASE_URL), every row marked is_demo
// pnpm seed:demo:live --reset  remove it again
// One dedicated connection on Supabase's SESSION pooler (port 5432): the demo marker is a per-connection setting, so a pooled or transaction-mode
// connection would leave some rows unmarked and mix them into the live data. Refuses to run while real calls exist unless --force.
import { existsSync } from "node:fs";
import pg from "pg";
import { SUPABASE_CA } from "../src/db/supabase-ca";
import type { SqlClient } from "../src/db/pg-booking-repo";
import { seedDemo } from "./demo/seed";
import { countDemo, resetDemo } from "./demo/reset";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { DATABASE_URL, PHONE_HASH_PEPPER, PHONE_ENC_KEY } = process.env;
if (!DATABASE_URL || !PHONE_HASH_PEPPER || !PHONE_ENC_KEY) { console.error("DATABASE_URL, PHONE_HASH_PEPPER and PHONE_ENC_KEY are needed (all in .env.local)."); process.exit(1); }
const url = DATABASE_URL.replace(":6543/", ":5432/");
const client = new pg.Client({ connectionString: url, ssl: { ca: SUPABASE_CA } });
await client.connect();
const db = client as unknown as SqlClient;
try {
  const force = process.argv.includes("--force");
  if (process.argv.includes("--reset")) { const r = await resetDemo(db, { force }); console.log(`Removed ${r.deleted} demo rows.`); }
  else {
    console.log("Loading the 40 September enquiries into the hosted database as DEMO data ...");
    const r = await seedDemo(db, { PHONE_HASH_PEPPER, PHONE_ENC_KEY }, { force, log: (s) => console.log(s) });
    console.log(`Done: ${r.calls} calls, ${r.booked} bookings, ${r.handoffs} hand-offs, ${r.deals} deals with a value.`);
  }
  const c = await countDemo(db);
  const live = Number(((await client.query("select count(*)::int n from calls where not is_demo")).rows[0] as { n: number }).n);
  console.log(`Demo rows now: ${c.total}. Real (non-demo) calls: ${live}.`);
} catch (e) { console.error(String((e as Error).message)); process.exitCode = 1; } finally { await client.end(); }
