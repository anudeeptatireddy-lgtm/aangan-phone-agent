import { NotDocumentedError, TransferResult, TransferTarget, VoiceEvent, VoicePlatform } from "../VoicePlatform";
import { parseVaaniEnvelope, verifyVaaniSignature } from "./webhook";

export class VaaniPlatform implements VoicePlatform {
  readonly name = "vaani";
  constructor(private webhookSecret: string) {}

  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): VoiceEvent | null {
    if (!verifyVaaniSignature(rawBody, headers["x-vaanivoice-signature"], this.webhookSecret)) return null;
    const e = parseVaaniEnvelope(rawBody);
    return e ? { id: e.id, type: e.type, createdAt: new Date(e.created * 1000), data: e.data } : null;
  }

  async transferCall(_callId: string, _target: TransferTarget): Promise<TransferResult> {
    // Vaani's public docs/OpenAPI (read 2026-10-07) do not describe call transfer. Needs vendor docs or an answer from them.
    throw new NotDocumentedError("Vaani call transfer");
  }
}
