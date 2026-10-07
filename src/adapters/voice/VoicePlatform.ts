// Seam between Aangan's core and any voice vendor (Vaani today, Bolna possible). Core code depends only on this.
export interface VoiceEvent {
  id: string;            // vendor event id, used for idempotency
  type: string;
  createdAt: Date;
  data: Record<string, unknown>;
}
export interface TransferTarget { phoneE164: string; label: string }
export interface TransferResult { ok: boolean; detail?: string }

export class NotDocumentedError extends Error {
  constructor(what: string) {
    super(`${what} is not documented by the vendor yet; refusing to guess (hard rule 7)`);
    this.name = "NotDocumentedError";
  }
}

export interface VoicePlatform {
  readonly name: string;
  /** Verify and normalize an inbound webhook. Returns null if the signature or envelope is invalid. */
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): VoiceEvent | null;
  /** Live transfer to a human during working hours. */
  transferCall(callId: string, target: TransferTarget): Promise<TransferResult>;
}
