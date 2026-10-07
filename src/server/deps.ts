import { DEFAULT_HOURS, HoursConfig } from "@/core/hours";
import { getEnv, Env } from "@/lib/env";
import { InMemoryRepo } from "./repo";

export interface Deps {
  env: Env;
  repo: InMemoryRepo;
  now: () => Date;
  hours: HoursConfig;
  designerNames: string[]; // from designers table once it exists
}

export function makeDeps(o: { env?: Record<string, string | undefined>; now?: () => Date; hours?: HoursConfig; designerNames?: string[] } = {}): Deps {
  const env = getEnv(o.env ?? process.env);
  return { env, repo: new InMemoryRepo(env.PHONE_HASH_PEPPER), now: o.now ?? (() => new Date()),
    hours: o.hours ?? DEFAULT_HOURS, designerNames: o.designerNames ?? [] };
}

// Process-wide singleton for the Next dev server (state is in-memory until Supabase lands).
const g = globalThis as unknown as { __aanganDeps?: Deps };
export function getDeps(): Deps {
  return (g.__aanganDeps ??= makeDeps());
}
