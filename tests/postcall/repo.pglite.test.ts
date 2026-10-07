import { randomBytes } from "node:crypto";
import { postCallRepoContract } from "./repo.contract";
import { freshDb } from "../db/helpers";
import { PgPostCallRepo } from "@/db/pg-postcall-repo";

// The real schema (both migrations + seed) in an in-process Postgres. One database for the file, emptied between tests.
let db: Awaited<ReturnType<typeof freshDb>> | undefined;
const keys = { pepper: "pepper-0123456789ab", encKey: randomBytes(32).toString("hex") };

postCallRepoContract("Postgres (PGlite, real migrations)", async () => {
  db ??= await freshDb({ seed: true });
  await db.exec("truncate outbox, usage_costs, audit_flags, escalations, rule_evaluations, calls, enquiries, callers restart identity cascade");
  return new PgPostCallRepo({ query: (sql, p) => db!.query(sql, p as unknown[]) }, keys);
});
