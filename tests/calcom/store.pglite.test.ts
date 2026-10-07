import { calStoreContract } from "./store.contract";
import { freshDb } from "../db/helpers";
import { PgCalBookingStore } from "@/db/pg-calcom-store";
let db: Awaited<ReturnType<typeof freshDb>> | undefined;
calStoreContract("Postgres (PGlite, real migrations)", async () => {
  db ??= await freshDb({ seed: true });
  await db.exec("truncate calcom_bookings");
  return new PgCalBookingStore({ query: (sql, p) => db!.query(sql, p as unknown[]) as Promise<{ rows: Record<string, unknown>[] }> });
});
