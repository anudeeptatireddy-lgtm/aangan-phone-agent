import { writeFileSync } from "node:fs";
import { buildSeedSql } from "../src/db/seed";

writeFileSync("supabase/seed.sql", buildSeedSql());
console.log("wrote supabase/seed.sql");
