import { createHmac, timingSafeEqual } from "node:crypto";

// Who may open the dashboard. Decided from NODE_ENV and DASHBOARD_PASSWORD ONLY: never from the Host header, the URL or any other request detail,
// because a caller controls those. Outside production there is no login. In production a password is required, and without one nothing opens,
// unless the owner sets DASHBOARD_OPEN=true for a public read-only demo.
export type Access =
  | { mode: "open"; who: "local user"; public: false }
  | { mode: "open"; who: "open demo"; public: true }          // production with DASHBOARD_OPEN=true: a public, READ-ONLY demo (no phone reveal, no review changes)
  | { mode: "password"; password: string; who: "dashboard" }
  | { mode: "blocked" };

export function dashboardAccess(env: { NODE_ENV: string; DASHBOARD_PASSWORD?: string; DASHBOARD_OPEN?: string }): Access {
  if (env.NODE_ENV !== "production") return { mode: "open", who: "local user", public: false };
  // An explicit, exact opt-in. Unset, "false" or any other value keeps the fail-closed rule below.
  if (env.DASHBOARD_OPEN === "true") return { mode: "open", who: "open demo", public: true };
  if (!env.DASHBOARD_PASSWORD) return { mode: "blocked" };
  return { mode: "password", password: env.DASHBOARD_PASSWORD, who: "dashboard" };
}

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** What the `dash` cookie holds: a value derived from the password, so the password itself never sits in a browser. */
export const sessionValue = (password: string) => createHmac("sha256", password).update("aangan-dashboard-session-v1").digest("hex");

export type Verdict = "ok" | "login" | "blocked";
/** Bearer password (API use) or the session cookie (the page). Never the URL: query strings end up in logs and browser history. */
export function verdictFor(req: Request, access: Access): Verdict {
  if (access.mode === "open") return "ok";
  if (access.mode === "blocked") return "blocked";
  const bearer = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (bearer && same(bearer, access.password)) return "ok";
  const cookie = /(?:^|;\s*)dash=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  return cookie && same(decodeURIComponent(cookie), sessionValue(access.password)) ? "ok" : "login";
}
