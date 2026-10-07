import { TransferResult, TransferTarget, VoiceEvent, VoicePlatform } from "../VoicePlatform";

/** Local simulation: records transfers instead of placing them. */
export class FakeVoicePlatform implements VoicePlatform {
  readonly name = "fake";
  transfers: { callId: string; target: TransferTarget }[] = [];
  parseWebhook(rawBody: string): VoiceEvent | null {
    try {
      const j = JSON.parse(rawBody);
      return { id: String(j.id), type: String(j.type), createdAt: new Date((j.created ?? 0) * 1000), data: j.data ?? {} };
    } catch { return null; }
  }
  async transferCall(callId: string, target: TransferTarget): Promise<TransferResult> {
    this.transfers.push({ callId, target });
    return { ok: true, detail: "simulated" };
  }
}
