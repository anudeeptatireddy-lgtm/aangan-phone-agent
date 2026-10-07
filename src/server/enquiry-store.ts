import { randomUUID } from "node:crypto";
import type { EnquiryRecord } from "@/core/enquiry";

/** Local-dev store for enquiries (the post-call pipeline persists them to Postgres in Session 4). */
export class InMemoryEnquiryStore {
  private items = new Map<string, EnquiryRecord>();

  create(e: Omit<EnquiryRecord, "id" | "createdAt"> & { createdAt: string }): EnquiryRecord {
    const rec: EnquiryRecord = { ...e, id: randomUUID() };
    this.items.set(rec.id, rec);
    return rec;
  }
  get(id: string): EnquiryRecord | undefined { return this.items.get(id); }
  update(id: string, patch: Partial<EnquiryRecord>): EnquiryRecord | undefined {
    const cur = this.items.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, id: cur.id };
    this.items.set(id, next);
    return next;
  }
}
