import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PHONE_HASH_PEPPER: z.string().min(16, "PHONE_HASH_PEPPER must be at least 16 chars"),
  // AES-256 key for callers.phone_enc (64 hex chars). Required once the database repository is used.
  PHONE_ENC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "PHONE_ENC_KEY must be 64 hex chars").optional(),
  TOOL_SHARED_SECRET: z.string().min(16, "TOOL_SHARED_SECRET must be at least 16 chars"),
  // Optional until the Vaani integration is verified against docs (hard rule 7).
  VAANI_API_KEY: z.string().optional(),
  VAANI_WEBHOOK_SECRET: z.string().optional(),
  // Live-transfer targets (E.164). Complaints -> design lead, falling back to front desk; "I want a person" -> front desk.
  FRONT_DESK_NUMBER: z.string().optional(),
  DESIGN_LEAD_NUMBER: z.string().optional(),
});
export type Env = z.infer<typeof Env>;

let cached: Env | undefined;
export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  if (source === process.env && cached) return cached;
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${missing}`); // names only, never values
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}
