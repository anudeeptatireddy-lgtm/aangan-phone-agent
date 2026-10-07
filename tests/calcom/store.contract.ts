import { describe, it, expect, beforeEach } from "vitest";
import type { CalBookingStore } from "@/core/calcom/types";

const d = (s: string) => new Date(s);
const bk = (uid: string, o: Record<string, unknown> = {}) => ({ uid, eventTypeId: 7, title: "Aangan consultation", status: "accepted" as const, startsAt: d("2026-10-08T05:30:00Z"), endsAt: d("2026-10-08T06:30:00Z"),
  attendeeEmail: "priya@example.com", attendeeName: "Priya", attendeePhoneHash: null, createdAt: d("2026-10-07T05:03:00Z"), ...o });

export function calStoreContract(name: string, make: () => Promise<CalBookingStore>) {
  describe(`CalBookingStore contract: ${name}`, () => {
    let store: CalBookingStore;
    beforeEach(async () => { store = await make(); }, 60_000);

    it("stores and reads a booking; an update by uid replaces details but not the claim", async () => {
      await store.upsert(bk("u1"));
      expect(await store.get("u1")).toMatchObject({ uid: "u1", status: "accepted", attendeeEmail: "priya@example.com", claimedByCall: null, eventTypeId: 7 });
      expect(await store.claim("u1", "call-1")).toBe(true);
      await store.upsert(bk("u1", { status: "cancelled" }));
      expect(await store.get("u1")).toMatchObject({ status: "cancelled", claimedByCall: "call-1" });
      expect(await store.get("nope")).toBeNull();
    });
    it("finds accepted, unclaimed bookings created inside a window, oldest first", async () => {
      await store.upsert(bk("a", { createdAt: d("2026-10-07T05:03:00Z") }));
      await store.upsert(bk("b", { createdAt: d("2026-10-07T05:01:00Z") }));
      await store.upsert(bk("c", { createdAt: d("2026-10-07T09:00:00Z") }));          // outside
      await store.upsert(bk("d", { status: "cancelled" }));                             // not accepted
      await store.upsert(bk("e"));
      await store.claim("e", "call-9");                                                  // already claimed
      const got = await store.findUnclaimed(d("2026-10-07T05:00:00Z"), d("2026-10-07T06:00:00Z"));
      expect(got.map((x) => x.uid)).toEqual(["b", "a"]);
    });
    it("a booking can be claimed by only one call (a single winner)", async () => {
      await store.upsert(bk("u2"));
      const r = await Promise.all([store.claim("u2", "call-1"), store.claim("u2", "call-2")]);
      expect(r.filter(Boolean)).toHaveLength(1);
      const winner = (await store.get("u2"))!.claimedByCall;
      expect((await store.forCall(winner!))!.uid).toBe("u2");
      expect(await store.claim("u2", winner!)).toBe(true);                               // the same call claiming again is fine
    });
    it("forCall is null when nothing was claimed", async () => {
      expect(await store.forCall("call-x")).toBeNull();
    });
  });
}
