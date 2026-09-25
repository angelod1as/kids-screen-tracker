import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase } from "../db/client";
import { migrateDatabase } from "../db/migrate";
import { users } from "../db/schema";
import { seedWithTestUsers } from "../db/test-users";
import { ACCESS_CASES } from "./access.rules";
import {
  AccessDeniedError,
  currentSession,
  findLoginAccount,
  requireAccess,
  requireAdmin,
  requireSession,
} from "./guard";

/**
 * Only the cookie reader (`./session`, which also keeps Varlock out) and the
 * connection (`../db`, swapped for a migrated, seeded SQLite) are mocked; the
 * guard runs for real. The signature check has its own suite in `token.test.ts`.
 */

const mocked = vi.hoisted(() => ({
  username: null as string | null,
  db: null as unknown,
}));

vi.mock("./session", () => ({
  SESSION_COOKIE_NAME: "kst_session",
  readSessionUsername: async () => mocked.username,
  startSession: async () => undefined,
  endSession: async () => undefined,
}));

vi.mock("../db", () => ({
  getDb: () => mocked.db,
}));

let root: string;
let connection: ReturnType<typeof openDatabase>;
/** username -> the id the seed actually gave that person. */
let ids: Map<string, number>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-guard-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);
  connection = openDatabase(databasePath);
  seedWithTestUsers(connection);

  mocked.db = connection.db;
  mocked.username = null;

  ids = new Map(
    connection.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .all()
      .map((row) => [row.username, row.id] as const),
  );
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(root, { recursive: true, force: true });
});

/** The id the seed gave someone, read rather than assumed. */
function idOf(username: string): number {
  const id = ids.get(username);
  if (id === undefined) {
    throw new Error(`the seed has no user named ${username}`);
  }

  return id;
}

describe("who the cookie says you are", () => {
  it("resolves the row, the role and the display name from the database", () => {
    mocked.username = "kid1";

    return expect(currentSession()).resolves.toEqual({
      userId: idOf("kid1"),
      username: "kid1",
      displayName: "Kid1",
      role: "kid",
    });
  });

  it("is nobody when there is no cookie", async () => {
    mocked.username = null;

    await expect(currentSession()).resolves.toBeNull();
  });

  it("is nobody when the cookie names someone who is not one of the four", async () => {
    // A validly signed cookie can still carry a name the app does not know:
    // after a rename, say.
    mocked.username = "mallory";

    await expect(currentSession()).resolves.toBeNull();
  });

  it("is nobody once the user is deactivated", async () => {
    // D14. Role and id are read per request, not carried in the cookie, so
    // this bites on the next click and not in 30 days.
    connection.db
      .update(users)
      .set({ active: false })
      .where(eq(users.username, "kid2"))
      .run();
    mocked.username = "kid2";

    await expect(currentSession()).resolves.toBeNull();
  });
});

describe("findLoginAccount, the login's only read of users (D45)", () => {
  it("returns the username, role and hash of an active row", () => {
    connection.db
      .update(users)
      .set({ passwordHash: "scrypt$16384$8$5$c2FsdA$aGFzaA" })
      .where(eq(users.username, "kid1"))
      .run();

    expect(findLoginAccount("kid1")).toEqual({
      username: "kid1",
      role: "kid",
      passwordHash: "scrypt$16384$8$5$c2FsdA$aGFzaA",
    });
    expect(findLoginAccount("admin1")).toEqual({
      username: "admin1",
      role: "admin",
      passwordHash: null,
    });
  });

  it("finds no one for an unknown or a deactivated name (D14)", () => {
    connection.db
      .update(users)
      .set({ active: false })
      .where(eq(users.username, "kid2"))
      .run();

    expect(findLoginAccount("mallory")).toBeUndefined();
    expect(findLoginAccount("kid2")).toBeUndefined();
  });
});

describe("requireSession", () => {
  it("refuses when there is no session, and says only that", async () => {
    mocked.username = null;

    await expect(requireSession()).rejects.toThrow(AccessDeniedError);
    await expect(requireSession()).rejects.toThrow("Acesso negado.");
  });

  it("marks the refusal as unauthenticated", async () => {
    mocked.username = null;

    await expect(requireSession()).rejects.toMatchObject({
      reason: "unauthenticated",
    });
  });
});

describe("requireAccess enforces the whole rule table (#13)", () => {
  // Through the call every server action makes. The ids come from the seeded
  // rows, so "Kid1 forges Kid2's id" forges the number the real Kid2 has.
  it.each(
    ACCESS_CASES.map((accessCase) => ({
      ...accessCase,
      label: `${accessCase.name} (${accessCase.allowed ? "allowed" : "denied"})`,
    })),
  )("$label", async ({ session, request, allowed }) => {
    mocked.username = session.username;

    const target = {
      ...request,
      targetUserId:
        request.targetUserId > 100
          ? request.targetUserId
          : idOf(usernameOfSeededId(request.targetUserId)),
    };

    if (allowed) {
      await expect(requireAccess(target)).resolves.toMatchObject({
        username: session.username,
      });
    } else {
      await expect(requireAccess(target)).rejects.toMatchObject({
        name: "AccessDeniedError",
        reason: "forbidden",
      });
    }
  });
});

/**
 * Maps an `access.rules.ts` id back to a username, so the case uses whatever id
 * the seed handed out instead of assuming insertion order.
 */
function usernameOfSeededId(id: number): string {
  const byId = ["admin1", "admin2", "kid1", "kid2"];
  const username = byId[id - 1];
  if (username === undefined) {
    throw new Error(`no seeded person at position ${id}`);
  }

  return username;
}

describe("requireAdmin", () => {
  it("lets both admins through", async () => {
    for (const username of ["admin1", "admin2"]) {
      mocked.username = username;

      await expect(requireAdmin()).resolves.toMatchObject({ role: "admin" });
    }
  });

  it("refuses both kids", async () => {
    for (const username of ["kid1", "kid2"]) {
      mocked.username = username;

      await expect(requireAdmin()).rejects.toMatchObject({
        reason: "forbidden",
      });
    }
  });

  it("refuses an anonymous caller as unauthenticated, not as forbidden", async () => {
    mocked.username = null;

    await expect(requireAdmin()).rejects.toMatchObject({
      reason: "unauthenticated",
    });
  });
});

/**
 * The error a call was refused with. Fails loudly if it was not refused at all
 * — a `.catch()` that returns the resolved value instead would let a guard that
 * stopped guarding pass the assertions below.
 */
async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (thrown) {
    return thrown as Error;
  }

  throw new Error("expected the call to be refused, and it was not");
}

describe("what a refusal tells the person refused", () => {
  it("names neither the caller nor the target", async () => {
    mocked.username = "kid1";

    const error = await refusal(
      requireAccess({ kind: "view", targetUserId: idOf("kid2") }),
    );

    // The message can reach a browser through Next's error boundary. "Kid1
    // cannot read user 4" would answer, for free, the question the forged
    // request was asking.
    expect(error.message).toBe("Acesso negado.");
    expect(error.message).not.toContain("kid1");
    expect(error.message).not.toContain("kid2");
    expect(error.message).not.toContain(String(idOf("kid2")));
  });
});
