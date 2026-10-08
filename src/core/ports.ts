import type { Interval } from "./booking/types";

// Ports: the only things the booking core knows about Google Calendar and Telegram. Real adapters implement these;
// tests and local runs use in-memory fakes (src/adapters/*/fake.ts).
export interface CalendarEventInput {
  calendarId: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  attendeeEmails: string[];
  location?: string;
}
export interface CalendarPort {
  /** Busy intervals per calendar id within [from, to). */
  freeBusy(calendarIds: string[], from: Date, to: Date): Promise<Map<string, Interval[]>>;
  createEvent(e: CalendarEventInput): Promise<{ eventId: string }>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

export interface HandoffButton { text: string; data: string }
export interface HandoffNote { text: string; acceptData: string; declineData: string; buttons: HandoffButton[] }
export interface NotifierPort {
  sendHandoff(chatId: number, note: HandoffNote): Promise<{ messageId: number }>;
  sendAlert(chatId: number, text: string): Promise<void>;
  /** Edit a sent note. Omitting `buttons` removes the inline keyboard. */
  editHandoff(chatId: number, messageId: number, text: string, buttons?: HandoffButton[]): Promise<void>;
  /** Telegram requires every callback press to be answered, even with no text. */
  answerCallback(callbackQueryId: string, text?: string): Promise<void>;
}

export interface EmailMessage { to: string; subject: string; text: string; html?: string; idempotencyKey: string }
export interface EmailPort { send(m: EmailMessage): Promise<{ id: string }> }

export interface CrmContact { email?: string; phone?: string; firstName?: string; lastName?: string }
export interface CrmPort {
  /** Create-or-update the contact and create a deal associated with it. The deal carries NO amount (the system never sets a price). */
  createDealForEnquiry(i: { contact: CrmContact; deal: { name: string; description: string } }): Promise<{ dealId: string; contactId: string }>;
  /** Read deals back (stage and the designer's amount). Deals HubSpot did not return are listed as `missing`. */
  readDeals(dealIds: string[]): Promise<{ deals: DealSnapshot[]; missing: string[] }>;
  /** A pipeline's stages with HubSpot's own closed / probability metadata. */
  dealStages(pipelineId: string): Promise<StageInfo[]>;
  /** The account's deal pipelines (to choose the right one). */
  dealPipelines(): Promise<{ id: string; label: string }[]>;
}
export interface DealSnapshot { dealId: string; pipelineId: string | null; stageId: string | null; amount: number | null; currency: string | null }
export interface StageInfo { id: string; label: string; closed: boolean | null; probability: number | null }
