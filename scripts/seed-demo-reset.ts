import { existsSync } from "node:fs";
import { openDb } from "../src/db/open";
import { countDemo, resetDemo } from "./demo/reset";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const dir = process.env.LOCAL_DB_DIR || "data/local/pglite";
const db = openDb({ LOCAL_DB_DIR: dir })!;
try {
  const before = await countDemo(db);
  const r = await resetDemo(db, { force: process.argv.includes("--force") });
  console.log(`Removed ${r.deleted} demo rows from ${dir} (${before.total} before). Real rows were not touched.`);
} catch (e) { console.error(String((e as Error).message)); process.exitCode = 1; } finally { await db.close(); }
