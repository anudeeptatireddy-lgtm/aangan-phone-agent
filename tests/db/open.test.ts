import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, demoScoped } from "@/db/open";

describe("openDb", () => {
  it("is undefined with nothing configured (in-memory stores: tests only), and DATABASE_URL wins over LOCAL_DB_DIR", () => {
    expect(openDb({})).toBeUndefined();
    const pg = openDb({ DATABASE_URL: "postgres://u:p@127.0.0.1:1/x", LOCAL_DB_DIR: "x" });
    expect(pg?.kind).toBe("postgres");
  });
  it("a local directory is a real Postgres that keeps its data between runs, creates its own parent folders, and applies each migration once", async () => {
    const root = mkdtempSync(join(tmpdir(), "aangan-pg-"));
    const dir = join(root, "a", "b", "pglite");
    try {
      const a = openDb({ LOCAL_DB_DIR: dir })!;
      expect(a.kind).toBe("pglite");
      expect(((await a.query("select count(*)::int n from public.app_migrations")).rows[0] as { n: number }).n).toBeGreaterThanOrEqual(5);
      await a.query("insert into calls(vaani_call_id) values ('persist-1')");
      expect(((await a.query("select count(*)::int n from rule_versions where status='active'")).rows[0] as { n: number }).n).toBe(1); // the seed ran
      await a.close();
      const b = openDb({ LOCAL_DB_DIR: dir })!;
      expect((await b.query("select vaani_call_id from calls")).rows).toEqual([{ vaani_call_id: "persist-1" }]);
      expect(((await b.query("select count(*)::int n from public.app_migrations")).rows[0] as { n: number }).n).toBeGreaterThanOrEqual(5);
      await b.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 120_000);
  it("demoScoped marks every later insert on the connection as demo, and can switch it off again", async () => {
    const root = mkdtempSync(join(tmpdir(), "aangan-pg-"));
    try {
      const db = openDb({ LOCAL_DB_DIR: join(root, "p") })!;
      await demoScoped(db, true); await db.query("insert into calls(vaani_call_id) values ('d')");
      await demoScoped(db, false); await db.query("insert into calls(vaani_call_id) values ('r')");
      expect((await db.query("select vaani_call_id, is_demo from calls order by 1")).rows).toEqual([{ vaani_call_id: "d", is_demo: true }, { vaani_call_id: "r", is_demo: false }]);
      await db.close();
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 120_000);
});
