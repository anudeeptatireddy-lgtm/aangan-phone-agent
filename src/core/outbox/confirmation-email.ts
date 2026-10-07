import { formatSlot } from "../booking/slots";

/** The caller's confirmation email. English only until HI/MR wording is reviewed. It never mentions money (hard rule 1). */
export function buildConfirmationEmail(i: { name?: string | null; startsAt: Date }): { subject: string; text: string } {
  const when = formatSlot(i.startsAt);
  const hello = i.name?.trim() ? `Hello ${i.name.trim().split(/\s+/)[0]},` : "Hello,";
  return {
    subject: `Your Aangan Studio consultation: ${when}`,
    text: [
      hello,
      "",
      `Thank you for calling Aangan Studio. Your consultation is booked for ${when} (India time).`,
      "One of our designers will already have what you told us on the call, so you will not need to repeat it.",
      "",
      "If you need to change the time, just reply to this email.",
      "",
      "Aangan Studio, Pune",
    ].join("\n"),
  };
}
