import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityRow } from "../../db/activities";
import { listActivities } from "../../db/activities";
import type { CategoryRow } from "../../db/categories";
import { listCategories } from "../../db/categories";
import type { Connection } from "../../db/client";
import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import type { World } from "../../db/queue.rules";
import { BOOK, makeWorld, THAT_DAY } from "../../db/queue.rules";
import { seedWithTestUsers } from "../../db/test-users";
import type { ActivityRequest, CategoryRequest } from "./config";
import {
  createActivityAction,
  setActivityActiveAction,
  setCategoryActiveAction,
  updateActivityAction,
  updateCategoryAction,
} from "./config";

/** #7: D37's refusal is returned word for word; nothing else is. Only the cookie is replaced. */

const mocked = vi.hoisted(() => ({
  username: null as string | null,
  connection: null as unknown,
}));

vi.mock("../../auth/session", () => ({
  SESSION_COOKIE_NAME: "kst_session",
  readSessionUsername: async () => mocked.username,
  startSession: async () => undefined,
  endSession: async () => undefined,
}));

vi.mock("../../db", () => ({
  getConnection: () => mocked.connection,
  getDb: () => (mocked.connection as { db: unknown }).db,
}));

const roots: string[] = [];
const opened: Connection[] = [];

function freshConnection(): Connection {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-config-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const connection = openDatabase(databasePath);
  seedWithTestUsers(connection);

  roots.push(root);
  opened.push(connection);

  return connection;
}

let world: World;

beforeEach(() => {
  world = makeWorld(freshConnection());
  mocked.connection = world.connection;
  mocked.username = "admin1";
});

afterEach(() => {
  for (const connection of opened.splice(0)) {
    if (connection.sqlite.open) connection.sqlite.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function mente(): CategoryRow {
  const found = listCategories(world.connection).find(
    (row) => row.name === "Mente",
  );

  if (found === undefined) throw new Error("no category named Mente");

  return found;
}

/** A stored time back as the two fields send it (#48). */
function timeOf(minutes: number) {
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

function categoryRequest(row: CategoryRow): CategoryRequest {
  return {
    ...row,
    decayStep:
      row.decayStepHours === null
        ? null
        : timeOf(Math.round(row.decayStepHours * 60)),
  };
}

function activityRequest(row: ActivityRow): ActivityRequest {
  return {
    ...row,
    rate: row.calcMode === "duration" ? row.value : null,
    amount:
      row.calcMode === "duration" || row.value === null
        ? null
        : timeOf(Math.round(row.value * 60)),
    maxSession:
      row.maxSessionMinutes === null ? null : timeOf(row.maxSessionMinutes),
    minSession: timeOf(row.minSessionMinutes),
    presumed: row.presumedMinutes == null ? null : timeOf(row.presumedMinutes),
  };
}

function book() {
  const found = listActivities(world.connection, mente().id).find(
    (row) => row.id === world.activityId(BOOK),
  );

  if (found === undefined) throw new Error(`no activity named ${BOOK}`);

  return found;
}

function waitingSentence(what: string, id: number): string {
  return `${what}: não dá para mudar taxa, modo, nota, cooldown ou categoria agora, porque a entrada ${id} (${BOOK}, ${THAT_DAY}) está esperando na fila e seria paga pelo valor novo. Decida essa primeiro.`;
}

describe("D37's refusal reaches the browser word for word (#7)", () => {
  it("answers a repricing edit with the sentence, and changes nothing", async () => {
    const waiting = world.addPending({ activity: BOOK });
    const before = book();

    await expect(
      updateActivityAction(mente().id, before.id, {
        ...activityRequest(before),
        rate: 10,
      }),
    ).resolves.toEqual({ refused: waitingSentence(BOOK, waiting) });

    expect(book().value).toBe(before.value);
  });

  it("answers switching off the activity with the sentence", async () => {
    const waiting = world.addPending({ activity: BOOK });

    await expect(
      setActivityActiveAction(mente().id, book().id, false),
    ).resolves.toEqual({ refused: waitingSentence(BOOK, waiting) });

    expect(book().active).toBe(true);
  });

  it("answers a category edit and switching it off with the sentence", async () => {
    const waiting = world.addPending({ activity: BOOK });
    const category = mente();

    await expect(
      updateCategoryAction(category.id, {
        ...categoryRequest(category),
        decayStep: { hours: 3, minutes: 0 },
      }),
    ).resolves.toEqual({ refused: waitingSentence("Mente", waiting) });

    await expect(setCategoryActiveAction(category.id, false)).resolves.toEqual({
      refused: waitingSentence("Mente", waiting),
    });

    expect(mente()).toMatchObject({ decayStepHours: 1, active: true });
  });

  it("still throws any other failure, which the browser sees only as a digest", async () => {
    const category = mente();

    await expect(
      updateCategoryAction(category.id, {
        ...categoryRequest(category),
        name: " ",
      }),
    ).rejects.toThrow(/a category needs a name/);
  });

  it("throws a kid's forged edit as a bare denial, never the sentence", async () => {
    world.addPending({ activity: BOOK });
    mocked.username = "kid1";

    await expect(
      setCategoryActiveAction(mente().id, false),
    ).rejects.toMatchObject({ reason: "forbidden", message: "Acesso negado." });
  });
});

describe("times typed as hours and minutes (#48)", () => {
  it("stores a fixed value of 1h25 in D9's two decimals", async () => {
    const rows = await createActivityAction({
      categoryId: mente().id,
      name: "Visita",
      calcMode: "fixed",
      rate: null,
      amount: { hours: 1, minutes: 25 },
      maxSession: null,
      minSession: { hours: 0, minutes: 5 },
      qualityGraded: false,
      repeatCooldownDays: 0,
      sortOrder: 0,
    });

    expect(rows.find((row) => row.name === "Visita")?.value).toBe(1.42);
  });

  it("stores a session limit and a minimum as whole minutes", async () => {
    await updateActivityAction(mente().id, book().id, {
      ...activityRequest(book()),
      maxSession: { hours: 2, minutes: 59 },
      minSession: { hours: 0, minutes: 25 },
      presumed: { hours: 1, minutes: 0 },
    });

    expect(book()).toMatchObject({
      maxSessionMinutes: 179,
      minSessionMinutes: 25,
      presumedMinutes: 60,
    });
  });

  it("keeps the rate a decimal: it is not a time", async () => {
    await updateActivityAction(mente().id, book().id, {
      ...activityRequest(book()),
      rate: 1.5,
    });

    expect(book().value).toBe(1.5);
  });

  it("stores a decay step of 0h15, the floor (D35), and refuses 0h14", async () => {
    await updateCategoryAction(mente().id, {
      ...categoryRequest(mente()),
      decayStep: { hours: 0, minutes: 15 },
    });

    expect(mente().decayStepHours).toBe(0.25);

    await expect(
      updateCategoryAction(mente().id, {
        ...categoryRequest(mente()),
        decayStep: { hours: 0, minutes: 14 },
      }),
    ).rejects.toThrow(/below the floor/);
  });

  it("refuses sixty minutes on the server, not just on the screen (D33)", async () => {
    const before = book();

    await expect(
      updateActivityAction(mente().id, before.id, {
        ...activityRequest(before),
        maxSession: { hours: 1, minutes: 60 },
      }),
    ).rejects.toThrow(/between 0 and 59/);
    await expect(
      updateCategoryAction(mente().id, {
        ...categoryRequest(mente()),
        decayStep: { hours: 1, minutes: 60 },
      }),
    ).rejects.toThrow(/between 0 and 59/);
    await expect(
      createActivityAction({
        ...activityRequest(before),
        name: "Visita",
        calcMode: "fixed",
        amount: { hours: 1, minutes: 60 },
      }),
    ).rejects.toThrow(/between 0 and 59/);

    expect(book()).toEqual(before);
  });

  it("refuses a fraction of an hour sent as hours", async () => {
    await expect(
      updateCategoryAction(mente().id, {
        ...categoryRequest(mente()),
        decayStep: { hours: 1.5, minutes: 0 },
      }),
    ).rejects.toThrow(/the hours of a decay step/);
  });
});

describe("a forged field of the wrong type is refused by name (#58)", () => {
  const WRONG_TYPES: unknown[] = [5, true, {}, []];

  const FIELDS: { field: string; sentence: RegExp; wrong: unknown[] }[] = [
    {
      field: "description",
      sentence: /an activity description is text/,
      wrong: WRONG_TYPES,
    },
    {
      field: "name",
      sentence: /an activity name is text/,
      wrong: [...WRONG_TYPES, null, undefined],
    },
    {
      field: "categoryId",
      sentence: /a category is a number/,
      wrong: [true, {}, []],
    },
    {
      field: "qualityGraded",
      sentence: /quality graded or not, received null/,
      wrong: [null],
    },
  ];

  const CASES = FIELDS.flatMap(({ field, sentence, wrong }) =>
    wrong.map((value) => ({ field, value, sentence })),
  );

  function activityCount(): number {
    return world.connection.sqlite
      .prepare("SELECT count(*) AS n FROM activities")
      .pluck()
      .get() as number;
  }

  it.each(CASES)(
    "create: $field = $value",
    async ({ field, value, sentence }) => {
      const before = activityCount();

      await expect(
        createActivityAction({
          ...activityRequest(book()),
          name: "Visita",
          [field]: value,
        } as ActivityRequest),
      ).rejects.toThrow(sentence);

      expect(activityCount()).toBe(before);
    },
  );

  it.each(CASES)(
    "update: $field = $value",
    async ({ field, value, sentence }) => {
      const before = book();

      await expect(
        updateActivityAction(mente().id, before.id, {
          ...activityRequest(before),
          [field]: value,
        } as ActivityRequest),
      ).rejects.toThrow(sentence);

      expect(book()).toEqual(before);
    },
  );

  it.each([true, {}, []])("update: activityId = %j", async (value) => {
    const before = book();

    await expect(
      updateActivityAction(mente().id, value as number, {
        ...activityRequest(before),
        name: "Visita",
      }),
    ).rejects.toThrow(/an activity is a number/);

    expect(book()).toEqual(before);
  });

  it.each([true, {}, []])(
    "update: the list's categoryId = %j, before the write",
    async (value) => {
      const before = book();

      await expect(
        updateActivityAction(value as number, before.id, {
          ...activityRequest(before),
          name: "Visita",
        }),
      ).rejects.toThrow(/a category is a number/);

      expect(book()).toEqual(before);
    },
  );

  it("still takes a missing description and a string category id as before", async () => {
    const before = book();

    await updateActivityAction(
      String(mente().id) as unknown as number,
      before.id,
      {
        ...activityRequest(before),
        description: undefined,
        categoryId: String(mente().id) as unknown as number,
      },
    );

    expect(book()).toMatchObject({
      categoryId: before.categoryId,
      description: null,
    });
  });
});
