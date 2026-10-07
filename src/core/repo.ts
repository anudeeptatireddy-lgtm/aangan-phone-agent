export interface Caller {
  id: string;
  phoneHash: string;
  phoneE164: string; // service-side only; never leaves via tools or logs
  name?: string;
  isExistingClient: boolean;
}
export interface CallRecord {
  id: string;
  callerId: string;
  endedAt: string; // ISO
  endedReason: "completed" | "dropped";
  handoffDelivered?: boolean;
  enquiryId?: string;
}
export interface CallRepo {
  findCallerByPhone(e164: string): Promise<Caller | undefined>;
  listCalls(callerId: string): Promise<CallRecord[]>;
}
