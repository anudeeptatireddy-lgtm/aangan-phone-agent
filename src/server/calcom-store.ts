import type { CalBooking, CalBookingStore } from "@/core/calcom/types";

export class InMemoryCalBookingStore implements CalBookingStore {
  items = new Map<string, CalBooking>();
  async upsert(b: Omit<CalBooking, "claimedByCall">) { this.items.set(b.uid, { ...b, claimedByCall: this.items.get(b.uid)?.claimedByCall ?? null }); }
  async get(uid: string) { const b = this.items.get(uid); return b ? { ...b } : null; }
  async findUnclaimed(from: Date, to: Date) {
    return [...this.items.values()].filter((b) => b.status === "accepted" && !b.claimedByCall && b.createdAt >= from && b.createdAt <= to)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((b) => ({ ...b }));
  }
  async claim(uid: string, vendorCallId: string) {
    const b = this.items.get(uid);
    if (!b) return false;
    if (b.claimedByCall && b.claimedByCall !== vendorCallId) return false; // synchronous check-and-set
    b.claimedByCall = vendorCallId;
    return true;
  }
  async forCall(vendorCallId: string) { const b = [...this.items.values()].find((x) => x.claimedByCall === vendorCallId); return b ? { ...b } : null; }
}
