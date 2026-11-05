import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openDatabase } from "../src/db/client";
import { migrateDatabase } from "../src/db/migrate";
import { seedWithTestUsers } from "../src/db/test-users";
import { ACCENT_HEX, SURFACE_HEX } from "../src/ui/style";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const template = readFileSync(
  join(root, "scripts", "usage-card.template.html"),
  "utf8",
);

function templateColor(token: string): string | undefined {
  return template.match(new RegExp(`--${token}: (#[0-9a-f]{6});`))?.[1];
}

describe("usage card template", () => {
  // The card cannot import style.ts; this keeps its literals from drifting (D42, #131).
  it("uses the D42 accent and floor", () => {
    expect(templateColor("accent")).toBe(ACCENT_HEX);
    expect(templateColor("floor")).toBe(SURFACE_HEX);
  });

  it("uses the red measured in docs/design.md", () => {
    const design = readFileSync(join(root, "docs", "design.md"), "utf8");
    const red = design.match(/`red-700` \(`(#[0-9a-f]{6})`\)/)?.[1];

    expect(red).toBeDefined();
    expect(templateColor("alert")).toBe(red);
  });
});

describe("pnpm usage:audit", () => {
  let dir: string;
  let databasePath: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "kst-usage-audit-"));
    databasePath = join(dir, "kids.db");
    migrateDatabase(databasePath);
    const connection = openDatabase(databasePath);
    try {
      seedWithTestUsers(connection);
      connection.sqlite.exec(`
        insert into ledger (user_id, kind, hours, occurred_on, destination, created_by)
        select k.id, r.kind, r.hours, r.day, r.destination, a.id
        from users k, users a, (
          select 'earn' as kind, 5.0 as hours, '2026-01-10' as day, null as destination
          union all select 'spend', 1.0, '2026-01-10', 'ZAP'
          union all select 'spend', 0.5, '2026-01-11', 'Zap'
          union all select 'refund', 0.5, '2026-01-11', null
        ) r
        where k.username = 'kid1' and a.username = 'admin1';
        insert into ledger (user_id, kind, hours, occurred_on, destination, created_by, voided_at)
        select k.id, 'spend', 2.0, '2026-01-10', 'Insta', k.id, 1
        from users k where k.username = 'kid1';
      `);
    } finally {
      connection.sqlite.close();
    }
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(args: string[]) {
    return spawnSync("node", ["scripts/usage-audit.mjs", ...args], {
      cwd: root,
      env: { ...process.env, DATABASE_PATH: databasePath },
      encoding: "utf8",
    });
  }

  const fileHash = () =>
    createHash("sha256").update(readFileSync(databasePath)).digest("hex");

  it("prints declared spend per destination and the balance, skipping voided rows", () => {
    const result = run(["--kid", "KID1", "--since", "2026-01-10"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2026-01-10  5h        zap 1h");
    expect(result.stdout).toMatch(/ {2}zap +1h30\n/);
    expect(result.stdout).not.toContain("insta");
    expect(result.stdout).toContain("saldo atual:     4h\n");
  });

  it("applies the free WhatsApp hour and counts only the three apps on the card", () => {
    const familyLink = join(dir, "family-link.json");
    const out = join(dir, "card.html");
    writeFileSync(
      familyLink,
      JSON.stringify({
        device: "SM-TEST",
        days: {
          "2026-01-10": { whatsapp: 172, instagram: 20, chrome: 28, tv: 90 },
          "2026-01-11": { whatsapp: 50 },
        },
      }),
    );

    const result = run([
      "--kid",
      "kid1",
      "--familylink",
      familyLink,
      "--out",
      out,
    ]);
    const card = readFileSync(out, "utf8");

    expect(result.status).toBe(0);
    // WhatsApp: 2 × 1h free + 1h30 declared = 3h30 allowed, 3h42 used.
    expect(card).toMatch(
      /WhatsApp<\/h2><span class="badge over">\+12 min<\/span>[\s\S]*?<b>3h30<\/b>[\s\S]*?<b>3h42<\/b>/,
    );
    expect(card).toMatch(
      /Chrome<\/h2><span class="badge over">\+28 min<\/span>[\s\S]*?não declarou/,
    );
    expect(card).toContain('<span class="num over">+1h</span>');
    expect(card).toContain("SM-TEST");
    expect(card).not.toMatch(/__[A-Z_]+__/);
  });

  it("never writes to the database", () => {
    const before = fileHash();

    run(["--kid", "kid1", "--since", "2026-01-10"]);

    expect(fileHash()).toBe(before);
  });
});
