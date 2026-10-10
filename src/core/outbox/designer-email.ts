import type { CallTurn } from "../postcall/types";

// The email a designer gets when a consultation is assigned to them: what the project is, the meeting link, and what was said on the call.
// Plain text first (it must read well in any client); an HTML twin escapes everything it prints.
export interface DesignerEmailInput {
  designerName: string;
  callerName: string | null;
  location: string | null;
  startsAt: Date | null;        // null = no consultation is booked yet (a qualified enquiry the caller will be called back about)
  meetingUrl: string | null;
  details: string;              // the stored designer note (built by noteLines)
  transcript: CallTurn[];
  forDesigner?: string;         // set when the mail is redirected (demo / Resend test sender): who it is really for
}

const when = (d: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true }).format(d) + " IST";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function buildDesignerEmail(i: DesignerEmailInput): { subject: string; text: string; html: string } {
  const what = [i.callerName, i.location].filter(Boolean).join(" · ") || "a new enquiry";
  const booked = i.startsAt !== null;
  const subject = `${i.forDesigner ? `[for ${i.forDesigner}] ` : ""}${booked ? "New project assigned" : "New enquiry, no consultation booked yet"}: ${what}`;
  const link = i.meetingUrl ?? "No meeting link yet: Cal.com has not sent one. Check the booking in Cal.com.";
  const talk = i.transcript.length ? i.transcript.map((t) => `${t.speaker === "agent" ? "Agent" : "Caller"}: ${t.text}`).join("\n") : "(No transcript was available for this call.)";
  const text = [
    `Hi ${i.designerName},`, "",
    booked ? "You have a new project. The details are below, including the meeting link with the customer." : "You have a new enquiry. No consultation is booked yet: the caller was told someone will call back during working hours.", "",
    ...(booked ? ["THE CONSULTATION", `When: ${when(i.startsAt!)}`, `Meeting link: ${link}`, ""] : ["NEXT STEP", "Please call the customer back and offer a consultation.", ""]),
    "PROJECT DETAILS", i.details || "(No details were captured.)", "",
    "WHAT WAS SAID ON THE CALL", talk, "",
    booked ? "This was set up by Aangan's virtual assistant. Please be on the link at the time above." : "This enquiry was taken by Aangan's virtual assistant.",
  ].join("\n");
  const linkHtml = i.meetingUrl ? `<a href="${esc(i.meetingUrl)}">${esc(i.meetingUrl)}</a>` : esc(link);
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;max-width:640px">
<p>Hi ${esc(i.designerName)},</p><p><b>${booked ? "You have a new project." : "You have a new enquiry."}</b> ${booked ? "The details are below, including the meeting link with the customer." : "No consultation is booked yet: the caller was told someone will call back during working hours."}</p>
${booked ? `<h3 style="margin:18px 0 4px">The consultation</h3><p style="margin:0">When: ${esc(when(i.startsAt!))}<br>Meeting link: ${linkHtml}</p>` : `<h3 style="margin:18px 0 4px">Next step</h3><p style="margin:0">Please call the customer back and offer a consultation.</p>`}
<h3 style="margin:18px 0 4px">Project details</h3><pre style="white-space:pre-wrap;font:inherit;margin:0">${esc(i.details || "(No details were captured.)")}</pre>
<h3 style="margin:18px 0 4px">What was said on the call</h3><pre style="white-space:pre-wrap;font:inherit;margin:0">${esc(talk)}</pre>
<p style="color:#666;margin-top:18px">${booked ? "This was set up by Aangan's virtual assistant. Please be on the link at the time above." : "This enquiry was taken by Aangan's virtual assistant."}</p></div>`;
  return { subject, text, html };
}
