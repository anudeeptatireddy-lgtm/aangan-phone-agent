import { maskPhone, normalizeE164 } from "@/lib/phone";
import type { CallRepo } from "./repo";

export const DROPPED_CALL_WINDOW_MIN = 30;

export interface LookupResult {
  caller_id_available: boolean;
  found: boolean;
  caller_id?: string;
  name?: string;
  phone_masked?: string;
  is_repeat: boolean;
  is_existing_client: boolean;
  lost_enquiry: boolean;
  dropped_call: { call_id: string; enquiry_id: string | null; minutes_ago: number } | null;
}

export async function lookupCaller(repo: CallRepo, rawPhone: string, now: Date): Promise<LookupResult> {
  const empty: LookupResult = { caller_id_available: true, found: false, is_repeat: false, is_existing_client: false, lost_enquiry: false, dropped_call: null };
  const e164 = normalizeE164(rawPhone);
  if (!e164) return { ...empty, caller_id_available: false };

  const caller = await repo.findCallerByPhone(e164);
  if (!caller) return { ...empty, phone_masked: maskPhone(e164) };

  const calls = (await repo.listCalls(caller.id)).sort((a, b) => b.endedAt.localeCompare(a.endedAt));
  const lastDropped = calls.find((c) => c.endedReason === "dropped");
  const minutesAgo = lastDropped ? Math.floor((now.getTime() - Date.parse(lastDropped.endedAt)) / 60_000) : Infinity;

  return {
    caller_id_available: true,
    found: true,
    caller_id: caller.id,
    name: caller.name,
    phone_masked: maskPhone(e164),
    is_repeat: calls.length > 0,
    is_existing_client: caller.isExistingClient,
    lost_enquiry: calls.some((c) => c.endedReason === "completed" && c.handoffDelivered === false),
    dropped_call:
      lastDropped && minutesAgo >= 0 && minutesAgo <= DROPPED_CALL_WINDOW_MIN
        ? { call_id: lastDropped.id, enquiry_id: lastDropped.enquiryId ?? null, minutes_ago: minutesAgo }
        : null,
  };
}
