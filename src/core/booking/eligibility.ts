import type { Designer } from "./types";

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const CITY_ONLY = ["pune", "pune city", "pcmc", "pimpri chinchwad"].map(norm);

/** Does the caller's location fall inside the designer's areas? Empty areas / a bare city name / no location match everyone. */
export function matchesArea(location: string | undefined, areas: string[]): boolean {
  if (!areas.length || !location) return true;
  const h = norm(location);
  return areas.some((a) => h.includes(norm(a))) || CITY_ONLY.includes(h);
}

export interface EligibilityTarget { location?: string; project_type?: string }

export function isEligible(d: Designer, e: EligibilityTarget, opts: { principalOnly?: boolean } = {}): boolean {
  if (!d.active || !d.calendarId) return false;
  if (opts.principalOnly && !d.isPrincipal) return false;
  if (!matchesArea(e.location, d.areas)) return false;
  const type = e.project_type === "studio" ? "office" : e.project_type;
  return !type || d.projectTypes.includes(type);
}
