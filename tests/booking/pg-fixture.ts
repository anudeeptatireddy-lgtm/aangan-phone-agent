import type { RepoFixture } from "./repo.contract";

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** Removes everything this fixture created (so shared databases such as the local Supabase stay clean). */
export async function cleanupBookingFixture(q: Q): Promise<void> {
  await q("delete from handoffs");
  await q("delete from bookings");
  await q("delete from enquiries where caller_id in (select id from callers where phone_hash like 'h-%')");
  await q("delete from callers where phone_hash like 'h-%'");
  await q("delete from designers where name like 'Fixture %'");
}

/** Inserts two active designers, one inactive, and three enquiries (the seed's rule version stamps them) into a seeded database. */
export async function seedBookingFixture(q: Q): Promise<Pick<RepoFixture, "designerIds" | "inactiveDesignerId" | "enquiryIds">> {
  await cleanupBookingFixture(q);
  const d = async (name: string, active: boolean) => (await q(
    "insert into designers(name, areas, project_types, calendar_id, telegram_chat_id, active) values ($1, '{}', '{home,office}', $2, 777, $3) returning id", [name, `cal-${name}`, active])).rows[0]!.id as string;
  const a = await d("Fixture A", true), b = await d("Fixture B", true), z = await d("Fixture Z", false);
  const caller = (await q("insert into callers(phone_hash, phone_enc, phone_masked) values ($1, '\\x01', 'm') returning id", [`h-${Math.random()}`])).rows[0]!.id as string;
  const e = async () => (await q("insert into enquiries(caller_id) values ($1) returning id", [caller])).rows[0]!.id as string;
  return { designerIds: [a, b], inactiveDesignerId: z, enquiryIds: [await e(), await e(), await e()] };
}
