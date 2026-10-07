import { describe, it, expect } from "vitest";
import { lookupCaller } from "@/core/lookup";
import { InMemoryRepo } from "@/server/repo";
import { hashPhone } from "@/lib/phone";

const PEPPER = "test-pepper";
const PHONE = "+919876543210";
const now = new Date("2026-10-07T08:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
const mk = () => new InMemoryRepo(PEPPER);

describe("lookupCaller", () => {
  it("unknown number -> not found, no flags", async () => {
    const r = await lookupCaller(mk(), PHONE, now);
    expect(r).toMatchObject({ found: false, is_repeat: false, is_existing_client: false, lost_enquiry: false, dropped_call: null });
  });
  it("never returns the full phone number", async () => {
    const repo = mk();
    repo.upsertCaller({ phone: PHONE, name: "Priya" });
    const r = await lookupCaller(repo, PHONE, now);
    expect(JSON.stringify(r)).not.toContain("9876543210");
    expect(r.phone_masked).toBe("+91 98••••••10");
  });
  it("existing client is flagged", async () => {
    const repo = mk();
    repo.upsertCaller({ phone: PHONE, isExistingClient: true });
    expect((await lookupCaller(repo, PHONE, now)).is_existing_client).toBe(true);
  });
  it("T16: repeat caller whose earlier enquiry was lost", async () => {
    const repo = mk();
    const c = repo.upsertCaller({ phone: PHONE, name: "Girish" });
    repo.addCall({ callerId: c.id, endedAt: minsAgo(60 * 24 * 4), endedReason: "completed", handoffDelivered: false, enquiryId: "enq-1" });
    const r = await lookupCaller(repo, PHONE, now);
    expect(r.is_repeat).toBe(true);
    expect(r.lost_enquiry).toBe(true);
  });
  it("repeat caller with a delivered handoff is not a lost enquiry", async () => {
    const repo = mk();
    const c = repo.upsertCaller({ phone: PHONE });
    repo.addCall({ callerId: c.id, endedAt: minsAgo(60 * 24), endedReason: "completed", handoffDelivered: true });
    expect((await lookupCaller(repo, PHONE, now)).lost_enquiry).toBe(false);
  });
  it("T17: call dropped within 30 min continues the same record (boundary inclusive)", async () => {
    const repo = mk();
    const c = repo.upsertCaller({ phone: PHONE });
    repo.addCall({ id: "call-1", callerId: c.id, endedAt: minsAgo(2), endedReason: "dropped", enquiryId: "enq-9" });
    const r = await lookupCaller(repo, PHONE, now);
    expect(r.dropped_call).toEqual({ call_id: "call-1", enquiry_id: "enq-9", minutes_ago: 2 });

    const repo2 = mk();
    const c2 = repo2.upsertCaller({ phone: PHONE });
    repo2.addCall({ id: "x", callerId: c2.id, endedAt: minsAgo(30), endedReason: "dropped" });
    expect((await lookupCaller(repo2, PHONE, now)).dropped_call).not.toBeNull();

    const repo3 = mk();
    const c3 = repo3.upsertCaller({ phone: PHONE });
    repo3.addCall({ id: "y", callerId: c3.id, endedAt: minsAgo(31), endedReason: "dropped" });
    expect((await lookupCaller(repo3, PHONE, now)).dropped_call).toBeNull();
  });
  it("a completed call 2 minutes ago is not a dropped call", async () => {
    const repo = mk();
    const c = repo.upsertCaller({ phone: PHONE });
    repo.addCall({ callerId: c.id, endedAt: minsAgo(2), endedReason: "completed" });
    expect((await lookupCaller(repo, PHONE, now)).dropped_call).toBeNull();
  });
  it("accepts any Indian format and finds the same caller", async () => {
    const repo = mk();
    repo.upsertCaller({ phone: PHONE, isExistingClient: true });
    expect((await lookupCaller(repo, "98765 43210", now)).is_existing_client).toBe(true);
    expect(hashPhone(PHONE, PEPPER)).toHaveLength(64);
  });
  it("missing/withheld caller ID is handled", async () => {
    const r = await lookupCaller(mk(), "", now);
    expect(r).toMatchObject({ found: false, caller_id_available: false });
  });
});
