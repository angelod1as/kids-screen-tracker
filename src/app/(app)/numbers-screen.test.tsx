import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// D57: the numbers screen is read with the bonus ON; the shipped default is off.
vi.mock("../../engine/flags", () => ({ BONUS_ENABLED: true }));

import { openDatabase } from "../../db/client";
import { readDashboard } from "../../db/dashboard";
import { seedDemoData } from "../../db/demo";
import { migrateDatabase } from "../../db/migrate";
import { seedWithTestUsers } from "../../db/test-users";
import { formatHours } from "../../ui/hours";
import { TOUCH_TARGET_CLASS } from "../../ui/style";

/** #9, the screen half: it renders seeded, with a week in it, and empty. The guard is `dashboard.test.ts`'s. */

const TODAY = "2026-09-20";

const mocked = vi.hoisted(() => ({
  connection: null as unknown,
  requests: [] as { kidId: number | null; period: string }[],
}));

vi.mock("../actions/people", () => ({
  listKidsAction: async () => [
    { id: 3, displayName: "Kid1" },
    { id: 4, displayName: "Kid2" },
  ],
}));

vi.mock("../actions/dashboard", () => ({
  fetchDashboardAction: async (request: {
    kidId: number | null;
    period: "4w" | "all";
  }) => {
    mocked.requests.push(request);

    return readDashboard(mocked.connection as ReturnType<typeof openDatabase>, {
      kidIds: request.kidId === null ? [3, 4] : [request.kidId],
      from: request.period === "4w" ? "2026-08-24" : null,
      to: TODAY,
    });
  },
}));

const NumbersPage = (await import("./admin/numeros/page")).default;
const { bucketed } = await import("./admin/numeros/charts");

let root: string;
let connection: ReturnType<typeof openDatabase>;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-numbers-"));
  const databasePath = join(root, "data", "kids.db");
  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
  seedWithTestUsers(connection);
  mocked.connection = connection;
});

afterAll(() => {
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

async function markup(query: { menino?: string; periodo?: string }) {
  return renderToStaticMarkup(
    await NumbersPage({ searchParams: Promise.resolve(query) }),
  );
}

describe("the numbers screen (#9)", () => {
  it("renders on a database that is only seeded", async () => {
    const page = await markup({});

    expect(page).toContain("Horas por categoria");
    expect(page).toContain("Nenhum registro no período.");
    expect(page).toContain("Saldo de Kid1");
  });

  it("renders a week of entries", async () => {
    seedDemoData(connection, TODAY);
    const page = await markup({});

    expect(page).toContain("Desgaste e bônus");
    expect(page).toContain("Ler livro");
    expect(page).toContain("Sem uso no período");
  });

  it("labels each flow row with its own total, wired end to end (#87)", async () => {
    const dashboard = readDashboard(connection, {
      kidIds: [3, 4],
      from: "2026-08-24",
      to: TODAY,
    });
    const page = await markup({});

    for (const balance of dashboard.balances) {
      expect(page).toContain(
        `aria-label="Lançadas: ${formatHours(balance.earned)} no período"`,
      );
      expect(page).toContain(
        `aria-label="Dadas: ${formatHours(balance.refunded)} no período"`,
      );
      expect(page).toContain(
        `aria-label="Tiradas: ${formatHours(balance.spent)} no período"`,
      );
    }
  });

  it("reads the filters off the URL, and ignores an id that is not a boy's", async () => {
    mocked.requests = [];
    await markup({ menino: "4", periodo: "tudo" });
    await markup({ menino: "1" });

    expect(mocked.requests).toEqual([
      { kidId: 4, period: "all" },
      { kidId: null, period: "4w" },
    ]);
  });

  it("shows one boy when one is chosen", async () => {
    const page = await markup({ menino: "3" });

    expect(page).toContain("Saldo de Kid1");
    expect(page).not.toContain("Saldo de Kid2");
  });

  it("says each category's total in its chart's label", async () => {
    const page = await markup({});
    const dashboard = readDashboard(connection, {
      kidIds: [3, 4],
      from: "2026-08-24",
      to: TODAY,
    });

    for (const category of dashboard.categories) {
      expect(page).toContain(
        `aria-label="${category.name}: ${formatHours(category.earned)} ganhas no período"`,
      );
    }
  });

  it("breaks each boy's balance into lançadas, dadas and tiradas (#87)", async () => {
    const page = await markup({});

    expect(page).toContain("Lançadas");
    expect(page).toContain("Dadas");
    expect(page).toContain("Tiradas");
  });

  it("gives every filter the 48 px minimum", async () => {
    const page = await markup({});
    const links = page.match(/<a [^>]*>/g) ?? [];

    expect(links.length).toBeGreaterThanOrEqual(5);
    for (const link of links) {
      for (const utility of TOUCH_TARGET_CLASS.split(" ")) {
        expect(link).toContain(utility);
      }
    }
  });
});

describe("bars by week past eight weeks (#9)", () => {
  it("keeps 56 days as days", () => {
    const days = Array.from({ length: 56 }, (_, index) => index);

    expect(bucketed(days)).toEqual(days);
  });

  it("sums 60 days into 9 weeks, the last one partial", () => {
    const weeks = bucketed(Array.from({ length: 60 }, () => 1));

    expect(weeks).toHaveLength(9);
    expect(weeks.slice(0, 8)).toEqual(Array(8).fill(7));
    expect(weeks[8]).toBe(4);
  });
});
