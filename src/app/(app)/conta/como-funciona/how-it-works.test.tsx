import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../../../../db/client";
import { migrateDatabase } from "../../../../db/migrate";
import { activities, categories } from "../../../../db/schema";
import { seedWithTestUsers } from "../../../../db/test-users";
import {
  calculateEarnedHours,
  historyWindowEnd,
  historyWindowStart,
  saoPauloDay,
} from "../../../../engine/calculate";
import { formatDuration, formatHours } from "../../../../ui/hours";
import { fetchHowItWorksAction } from "../../../actions/how-it-works";
import { SHORT_SESSION_MINUTES } from "./explainer";

/**
 * "Como funciona" (#107) against a real seeded database: every number on it
 * has to move when the configuration does. Only the cookie is mocked.
 */

const mocked = vi.hoisted(() => ({
  username: null as string | null,
  db: null as unknown,
}));

vi.mock("../../../../auth/session", () => ({
  SESSION_COOKIE_NAME: "kst_session",
  readSessionUsername: async () => mocked.username,
  startSession: async () => undefined,
  endSession: async () => undefined,
}));

vi.mock("../../../../db", () => ({
  getDb: () => mocked.db,
}));

const HowItWorksPage = (await import("./page")).default;

let root: string;
let connection: ReturnType<typeof openDatabase>;

const FOOTBALL = 1;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-how-it-works-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
  seedWithTestUsers(connection);

  mocked.db = connection.db;
  mocked.username = null;
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

async function markupFor(username: string): Promise<string> {
  mocked.username = username;

  return renderToStaticMarkup(await HowItWorksPage());
}

function football() {
  const activity = connection.db
    .select()
    .from(activities)
    .where(eq(activities.id, FOOTBALL))
    .get();
  if (activity === undefined) throw new Error("no football in the seed");

  const category = connection.db
    .select()
    .from(categories)
    .where(eq(categories.id, activity.categoryId))
    .get();
  if (category === undefined) throw new Error("no Corpo in the seed");

  return { activity, category };
}

function engineHours(minutes: number, returnBonusPct?: number): number {
  const { activity, category } = football();
  const occurredOn = saoPauloDay(new Date());
  const priced = {
    ...category,
    returnBonusPct: returnBonusPct ?? category.returnBonusPct,
  };

  return calculateEarnedHours({
    userId: 0,
    activity,
    category: priced,
    occurredOn,
    durationMinutes: minutes,
    history: [],
    historyFrom: historyWindowStart(occurredOn, activity, priced),
    historyTo: historyWindowEnd(occurredOn, activity, priced),
    categoryFirstDay: "2000-01-01",
  }).hours;
}

function changeCorpo(values: {
  decayStepHours: number;
  returnBonusPct: number;
  returnBonusAfterDays: number;
  value: number;
}) {
  const { category } = football();

  connection.db
    .update(categories)
    .set({
      decayStepHours: values.decayStepHours,
      returnBonusPct: values.returnBonusPct,
      returnBonusAfterDays: values.returnBonusAfterDays,
    })
    .where(eq(categories.id, category.id))
    .run();
  connection.db
    .update(activities)
    .set({ value: values.value })
    .where(eq(activities.id, FOOTBALL))
    .run();
}

describe("the guard (#107, D33)", () => {
  it("refuses a caller with no session", async () => {
    await expect(fetchHowItWorksAction()).rejects.toThrow();
  });

  it("hands a boy the configuration and nobody's data", async () => {
    mocked.username = "kid2";
    const data = await fetchHowItWorksAction();

    expect(Object.keys(data).sort()).toEqual([
      "activities",
      "categories",
      "occurredOn",
    ]);
    expect(JSON.stringify(data)).not.toMatch(/Kid1|kid1|userId/);
  });

  it("leaves switched-off activities out", async () => {
    connection.db
      .update(activities)
      .set({ active: false })
      .where(eq(activities.id, FOOTBALL))
      .run();
    mocked.username = "kid2";

    const data = await fetchHowItWorksAction();

    expect(data.activities.map((row) => row.id)).not.toContain(FOOTBALL);
  });
});

describe("one version per role (#107)", () => {
  it("gives a boy his version, with no adult route and no jargon", async () => {
    const markup = await markupFor("kid2");

    expect(markup).toContain("Quanto mais, menos vale");
    expect(markup).toContain('href="/menino/calculadora"');
    expect(markup).not.toContain('href="/admin');
    expect(markup).not.toMatch(/assíntota|franquia/i);
    expect(markup).not.toContain("Kid1");
  });

  it("gives an adult the model, where to change it, and what the app does not do", async () => {
    const markup = await markupFor("admin1");

    expect(markup).toContain("Assíntota");
    expect(markup).toContain("Onde mudar cada número");
    expect(markup).toContain('href="/admin/configuracao"');
    expect(markup).toContain("Não liga nem desliga aparelho");
    expect(markup).toContain("O saldo pode ficar negativo");
  });
});

describe("the numbers come from the configuration (#107)", () => {
  it("explains the owner's case with the engine's own answer", async () => {
    const markup = await markupFor("kid2");
    const { activity } = football();

    expect(markup).toContain(
      `Exemplo: ${formatDuration(SHORT_SESSION_MINUTES)} de ${activity.name}`,
    );
    expect(markup).toContain(formatHours(engineHours(SHORT_SESSION_MINUTES)));
    expect(markup).toContain("+50%, faz mais de 3 dias que você não faz Corpo");
  });

  it("shows the seed's Corpo: 2h step, +50% after 3 days, 6h asymptote", async () => {
    const markup = await markupFor("kid2");

    expect(markup).toContain(`a cada ${formatDuration(120)} no`);
    expect(markup).toContain("faz mais de 3 dias sem nada de");
    expect(markup).toContain(`perto de ${formatHours(6)}`);
    expect(markup).toContain(`cada hora vale ${formatHours(1.5)} de tela`);
  });

  it("says the debut of a category earns no bonus, on both versions (D47)", async () => {
    expect(await markupFor("kid2")).toContain("só volta quem já esteve");
    expect(await markupFor("admin1")).toContain("A estreia da");
  });

  it("follows an edited configuration on both versions", async () => {
    changeCorpo({
      decayStepHours: 1,
      returnBonusPct: 1,
      returnBonusAfterDays: 5,
      value: 3,
    });

    for (const username of ["kid2", "admin1"]) {
      const markup = await markupFor(username);

      expect(markup).toContain(formatHours(engineHours(SHORT_SESSION_MINUTES)));
      expect(markup).toContain(
        "+100%, faz mais de 5 dias que você não faz Corpo",
      );
      expect(markup).toContain(`cada hora vale ${formatHours(3)} de tela`);
      expect(markup).toContain(formatHours(engineHours(60, 0)));
    }

    const kid = await markupFor("kid2");
    expect(kid).toContain(`perto de ${formatHours(6)}`);
    expect(kid).toContain("faz mais de 5 dias sem nada de");
    expect(kid).not.toContain(`perto de ${formatHours(8)}`);
  });

  it("walks the decay table on the engine, band by band", async () => {
    const markup = await markupFor("kid2");

    // Corpo's seed step is 2h: the table's rows end at 2h, 4h, 6h and 8h.
    for (const minutes of [120, 240, 360, 480]) {
      expect(markup).toContain(formatHours(engineHours(minutes, 0)));
    }
  });

  it("lists only timed activities as filling the day (D5)", async () => {
    const markup = await markupFor("kid2");

    expect(markup).toMatch(/Soma junto o tempo de: Estudo para prova/);
    expect(markup).not.toMatch(/Soma junto o tempo de: [^.<]*Lição de casa/);
  });

  it("leaves the list out for a decaying category with no timed activity", async () => {
    // The D5 amendment lets Configuração give Convívio, all `fixed`, a step.
    connection.db
      .update(categories)
      .set({ decayStepHours: 1 })
      .where(eq(categories.name, "Convívio"))
      .run();

    const markup = await markupFor("kid2");

    expect(markup).toContain("<strong>Convívio</strong>: a cada");
    expect(markup).not.toMatch(/Soma junto o tempo de: ?\./);
  });

  it("shows each activity's own minimum session, and follows an edit (D44)", async () => {
    const seed = football().activity.minSessionMinutes;
    expect(await markupFor("kid2")).toContain(
      `mínimo de ${formatDuration(seed)}`,
    );

    connection.db
      .update(activities)
      .set({ minSessionMinutes: 17 })
      .where(eq(activities.id, FOOTBALL))
      .run();

    for (const username of ["kid2", "admin1"]) {
      expect(await markupFor(username)).toContain(
        `mínimo de ${formatDuration(17)}`,
      );
    }
  });
});
