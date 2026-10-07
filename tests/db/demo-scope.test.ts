import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./helpers";
import { PgBookingRepo } from "@/db/pg-booking-repo";
import { PgPostCallRepo } from "@/db/pg-postcall-repo";
import { PgCalBookingStore } from "@/db/pg-calcom-store";

// Demo rows must never meet real traffic: real rotation, real outbox drains and real booking matching only see live rows,
// and the demo seeder (which sets app.demo) only sees demo rows.
let db: PGlite;
const setDemo = (on: boolean) => db.query("select set_config('app.demo', $1, false)", [on ? "on" : "off"]);
const keys = { pepper: "pepper-0123456789ab", encKey: "0".repeat(63) + "1" };
beforeAll(async () => {
  db = await freshDb({ seed: false });
  await setDemo(false);
  await db.query("insert into designers(name, active) values ('Real Rita', true)");
  await setDemo(true);
  await db.query("insert into designers(name, active) values ('Demo Dev', true)");
  await setDemo(false);
}, 60_000);

describe("rotation", () => {
  it("a live booking can never be assigned to a demo designer, and the demo seeder only ever sees demo designers", async () => {
    const repo = new PgBookingRepo(db);
    await setDemo(false);
    expect((await repo.listActiveDesigners()).map((d) => d.name)).toEqual(["Real Rita"]);
    await setDemo(true);
    expect((await repo.listActiveDesigners()).map((d) => d.name)).toEqual(["Demo Dev"]);
    await setDemo(false);
  });
});

describe("outbox drains", () => {
  it("demo outbox items (alerts, deals, emails) are invisible to live workers", async () => {
    const repo = new PgPostCallRepo(db, keys);
    await setDemo(true); await repo.enqueue("owner_alert", { flag: "other" }, "demo-alert");
    await setDemo(false); await repo.enqueue("owner_alert", { flag: "other" }, "real-alert");
    expect((await repo.pendingOutbox(["owner_alert"], 10)).map((o) => o.dedupeKey)).toEqual(["real-alert"]);
    await setDemo(true);
    expect((await repo.pendingOutbox(["owner_alert"], 10)).map((o) => o.dedupeKey)).toEqual(["demo-alert"]);
    await setDemo(false);
  });
});

describe("Cal.com booking matching", () => {
  it("a live call can never claim a demo booking", async () => {
    const store = new PgCalBookingStore(db);
    const b = (uid: string) => ({ uid, eventTypeId: 1, title: null, status: "accepted" as const, startsAt: new Date("2026-10-08T05:30:00Z"), endsAt: new Date("2026-10-08T06:30:00Z"), attendeeEmail: null, attendeeName: null, attendeePhoneHash: null, createdAt: new Date("2026-10-07T06:00:00Z") });
    await setDemo(true); await store.upsert(b("demo-bk"));
    await setDemo(false); await store.upsert(b("real-bk"));
    const w = [new Date("2026-10-07T05:00:00Z"), new Date("2026-10-07T07:00:00Z")] as const;
    expect((await store.findUnclaimed(...w)).map((x) => x.uid)).toEqual(["real-bk"]);
    await setDemo(true);
    expect((await store.findUnclaimed(...w)).map((x) => x.uid)).toEqual(["demo-bk"]);
    await setDemo(false);
  });
});
