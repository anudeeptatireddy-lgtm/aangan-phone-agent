import type { Designer } from "./types";

/** Rotation rule (owner-approved default): least-recently-assigned first; never-assigned first of all; ties by name then id. */
export function pickInOrder(designers: Designer[]): Designer[] {
  return [...designers].sort((a, b) => {
    const ta = a.lastAssignedAt?.getTime() ?? -Infinity, tb = b.lastAssignedAt?.getTime() ?? -Infinity;
    return ta === tb ? a.name.localeCompare(b.name) || a.id.localeCompare(b.id) : ta < tb ? -1 : 1;
  });
}
