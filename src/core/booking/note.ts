import type { HandoffNote } from "../ports";
import type { EnquiryRecord } from "../enquiry";
import { formatSlot } from "./slots";

export interface NoteInput {
  handoffId: string;
  enquiry: EnquiryRecord;
  start: Date;
  mode: string;
  principalRequested: boolean;
  callSeconds?: number;
}

const clip = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Indian digit grouping: 4000000 -> 40,00,000 */
function inr(n: number): string {
  const s = String(Math.round(n));
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

const SCOPE: Record<string, string> = {
  full_home: "full home, design + execution", partial_home: "partial home, design + execution", single_room: "single room, design + execution",
  office_fitout: "office fit-out, design + execution",
};
const ROLE: Record<string, string> = { owner: "caller is the owner", family_on_behalf: "family member calling on the owners' behalf", employee: "employee of the company", unknown: "not confirmed" };
const FLAG: Record<string, string> = {
  vip_referrer: "VIP referrer", frustrated_prospect: "Frustrated prospect", decision_maker_unverified: "Decision-maker not confirmed",
  price_asked: "Asked for a price", partial_rooms_threshold_assumed: "Budget check assumed", budget_unassessed: "Budget not assessed",
};

function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${d} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`;
}

/** The note body (no phone, no email: Telegram is a personal chat app; HubSpot holds the full record). */
export function noteLines(i: Omit<NoteInput, "handoffId">): string[] {
  const e = i.enquiry, f = e.input;
  const flags = e.flags.map((x) => FLAG[x]).filter((x): x is string => !!x);
  const vip = e.flags.includes("vip_referrer");
  const place = [f.is_villa ? "Villa" : f.bhk ? `${f.bhk}BHK` : f.project_type === "office" ? "Office" : f.project_type ? f.project_type[0]!.toUpperCase() + f.project_type.slice(1) : undefined,
    f.carpet_sqft ? `~${f.carpet_sqft.toLocaleString("en-US")} sq ft` : undefined].filter(Boolean).join(", ");
  const timeline = f.deadline_date ? `finish by ${dateLabel(f.deadline_date)}` : f.start_date ? `start ${dateLabel(f.start_date)}` : f.possession_date ? `possession ${dateLabel(f.possession_date)}` : "not discussed";
  const attend = f.owners_attending === true ? ", owners will attend" : f.owners_attending === false ? ", owners will NOT attend" : "";
  const lines = [
    `NEW CONSULTATION · Qualified${vip ? " · VIP" : ""}`,
    [clip(e.callerName ?? "Caller", 80), clip(f.location ?? "location not given"), place].filter(Boolean).join(" · "),
    `Booked: ${formatSlot(i.start)} · ${i.mode === "site_visit" ? "Site visit" : i.mode}${i.principalRequested ? " · Principal designer asked for" : ""}`,
    `Scope: ${SCOPE[f.scope ?? ""] ?? "to be confirmed"}`,
    `Timeline: ${timeline}`,
    `Decision-maker: ${ROLE[f.decision_maker ?? "unknown"]}${attend}`,
    `Budget: ${f.budget_inr !== undefined ? `volunteered by caller, ₹${inr(f.budget_inr)}` : "not discussed"} · Asked about price: ${f.price_asked ? "yes" : "no"}`,
  ];
  if (f.referrer) lines.push(`Referred by: ${clip(f.referrer, 80)}`);
  if (flags.length) lines.push(`Flags: ${flags.join(", ")}`);
  if (i.callSeconds !== undefined) lines.push(`Call: ${Math.floor(i.callSeconds / 60)} min ${i.callSeconds % 60} s`);
  return lines;
}

export function buildHandoffNote(i: NoteInput): HandoffNote {
  const acceptData = `h:${i.handoffId}:a`, declineData = `h:${i.handoffId}:d`;
  return {
    text: noteLines(i).join("\n").slice(0, 4096),
    acceptData, declineData,
    buttons: [{ text: "Accept", data: acceptData }, { text: "Can't take it", data: declineData }],
  };
}
