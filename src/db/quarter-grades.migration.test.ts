import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "./client";
import { migrationsFolder } from "./migrate";
import { activities, activityLogs, categories, ledger, users } from "./schema";

const QUARTER_GRADES = "0016_quarter_grades";

let root: string;
let folder: string;
let connection: ReturnType<typeof openDatabase>;

function journal(tags: (tag: string) => boolean) {
  const path = join(folder, "meta", "_journal.json");
  const full = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };

  writeFileSync(
    path,
    JSON.stringify({
      ...full,
      entries: full.entries.filter((entry) => tags(entry.tag)),
    }),
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-"));
  folder = join(root, "drizzle");
  cpSync(migrationsFolder, folder, { recursive: true });
  connection = openDatabase(join(root, "kids.db"));
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

describe("0016, the quarter grades (D60)", () => {
  it("keeps a frozen 0,7 entry, its value and its ledger line byte for byte (D37)", () => {
    journal((tag) => tag < QUARTER_GRADES);
    migrate(connection.db, { migrationsFolder: folder });

    const { db } = connection;
    const [admin] = db
      .insert(users)
      .values({ username: "admin1", displayName: "Admin1", role: "admin" })
      .returning()
      .all();
    const [kid] = db
      .insert(users)
      .values({ username: "kid1", displayName: "Kid1", role: "kid" })
      .returning()
      .all();
    const [category] = db
      .insert(categories)
      .values({ name: "Casa", baseRate: 1, decayStepHours: null })
      .returning()
      .all();
    if (!admin || !kid || !category) throw new Error("insert returned no row");
    const [activity] = db
      .insert(activities)
      .values({
        categoryId: category.id,
        name: "Lavar o carro",
        calcMode: "delivery",
        value: 3,
        qualityGraded: true,
      })
      .returning()
      .all();
    if (!activity) throw new Error("insert returned no row");
    const [log] = db
      .insert(activityLogs)
      .values({
        userId: kid.id,
        activityId: activity.id,
        categoryId: category.id,
        status: "approved",
        source: "admin",
        occurredOn: "2026-10-20",
        quality: 0.7,
        computedHours: 2.1,
        createdBy: admin.id,
        reviewedBy: admin.id,
        reviewedAt: new Date(1_792_000_000_000),
      })
      .returning()
      .all();
    if (!log) throw new Error("insert returned no row");
    db.insert(ledger)
      .values({
        userId: kid.id,
        kind: "earn",
        hours: 2.1,
        occurredOn: "2026-10-20",
        activityLogId: log.id,
        createdBy: admin.id,
      })
      .run();

    const before = {
      logs: db.select().from(activityLogs).all(),
      ledger: db.select().from(ledger).all(),
    };

    journal(() => true);
    migrate(connection.db, { migrationsFolder: folder });
    expect(
      connection.sqlite
        .prepare("select sql from sqlite_master where name = 'activity_logs'")
        .pluck()
        .get(),
    ).toContain("0.25");

    expect({
      logs: db.select().from(activityLogs).all(),
      ledger: db.select().from(ledger).all(),
    }).toStrictEqual(before);
    expect(
      connection.sqlite
        .prepare(
          "select name from sqlite_master where type = 'trigger' order by name",
        )
        .all(),
    ).toEqual([
      { name: "activity_logs_credited_guard" },
      { name: "ledger_owner_guard_insert" },
      { name: "ledger_owner_guard_update" },
    ]);
  });
});
