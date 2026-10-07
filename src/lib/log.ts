import { maskPhone } from "./phone";

const SECRET_KEY = /(phone|mobile|token|secret|key|authorization|password|email|signature)/i;
const PHONE_IN_TEXT = /(?<![\d])(\+?\d[\d\s-]{8,13}\d)(?![\d])/g;
const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

function redactString(s: string): string {
  return s
    .replace(EMAIL_IN_TEXT, "[email]")
    .replace(PHONE_IN_TEXT, (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 10 ? maskPhone(m.startsWith("+") ? "+" + digits : digits) : m;
    });
}

/** Deep-redact: secret-like keys are blanked, phones/emails inside strings are masked (hard rule 6). */
export function redact(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[REDACTED]" : redact(v)]),
    );
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";
export function log(level: Level, msg: string, ctx: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg: redactString(msg), ...(redact(ctx) as object) });
  (level === "error" ? console.error : console.log)(line);
}
