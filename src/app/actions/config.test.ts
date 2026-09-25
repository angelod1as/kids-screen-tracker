import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listActivities } from "../../db/activities";
import type { CategoryRow } from "../../db/categories";
import { listCategories } from "../../db/categories";
import type { Connection } from "../../db/client";
import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import type { World } from "../../db/queue.rules";
import { BOOK, makeWorld, THAT_DAY } from "../../db/queue.rules";
import { seedWithTestUsers } from "../../db/test-users";
import {
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
        ...before,
        value: 10,
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
      updateCategoryAction(category.id, { ...category, decayStepHours: 3 }),
    ).resolves.toEqual({ refused: waitingSentence("Mente", waiting) });

    await expect(setCategoryActiveAction(category.id, false)).resolves.toEqual({
      refused: waitingSentence("Mente", waiting),
    });

    expect(mente()).toMatchObject({ decayStepHours: 1, active: true });
  });

  it("still throws any other failure, which the browser sees only as a digest", async () => {
    const category = mente();

    await expect(
      updateCategoryAction(category.id, { ...category, name: " " }),
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
