import { repoContract } from "./repo.contract";
import { freshDb } from "../db/helpers";
import { PgBookingRepo } from "@/db/pg-booking-repo";
import { seedBookingFixture } from "./pg-fixture";

// The real schema (migration + seed) in an in-process Postgres: the exclusion constraint is what actually stops double-booking.
repoContract("Postgres (PGlite, real migration)", async () => {
  const db = await freshDb({ seed: true });
  const fx = await seedBookingFixture((sql, p) => db.query(sql, p as unknown[]));
  return { repo: new PgBookingRepo({ query: (sql, p) => db.query(sql, p as unknown[]) }), ...fx };
});
