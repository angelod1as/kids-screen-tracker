import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Connection } from "../../db/client";
import { openDatabase } from "../../db/client";
import { migrateDatabase } from "../../db/migrate";
import { listPendingLogs } from "../../db/queue";
import { activityLogs, pushSubscriptions } from "../../db/schema";
import { seedWithTestUsers } from "../../db/test-users";
import { saveSubscription } from "../../push/subscriptions";
import { launchEntryAction } from "./admin";
import { refundHoursAction, releaseHoursAction } from "./ledger";
import { savePushSubscriptionAction } from "./push";
import { approveLogAction, rejectLogAction } from "./queue";
import {
  fetchTimerScreenAction,
  requestLogAction,
  startTimerAction,
  stopTimerAction,
} from "./timer";

/**
 * D51 end to end: the real actions, schema and queue; only the cookie and the
 * push sender are replaced, so what is asserted is who would have been sent what.
 */

type Sent = {
  endpoint: string;
  message: { title: string; body: string; url: string };
};

const mocked = vi.hoisted(() => ({
  username: null as string | null,
  connection: null as unknown,
  send: null as
    | null
    | ((keys: { endpoint: string }, payload: string) => Promise<unknown>),
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

vi.mock("../../push/vapid", () => ({
  pushSender: () => mocked.send,
  vapidPublicKey: () => null,
}));

const ADMIN1 = 1;
const ADMIN2 = 2;
const KID1 = 3;
const KID2 = 4;

const READING = 5;
const WORSHIP = 20;

const START = new Date("2026-09-24T09:00:00-03:00");
const TODAY = "2026-09-24";

const roots: string[] = [];
const opened: Connection[] = [];
let connection: Connection;
let sent: Sent[];

function freshConnection(): Connection {
  const root = mkdtempSync(join(tmpdir(), "kids-screen-tracker-push-"));
  const databasePath = join(root, "data", "kids.db");

  migrateDatabase(databasePath);

  const opening = openDatabase(databasePath);
  seedWithTestUsers(opening);

  roots.push(root);
  opened.push(opening);

  return opening;
}

const ENDPOINT: Record<number, string> = {
  [ADMIN1]: "https://push.test/admin1",
  [ADMIN2]: "https://push.test/admin2",
  [KID1]: "https://push.test/kid1",
  [KID2]: "https://push.test/kid2",
};

function subscribeEveryone() {
  for (const [userId, endpoint] of Object.entries(ENDPOINT)) {
    saveSubscription(
      connection,
      Number(userId),
      { endpoint, p256dh: "p256dh", auth: "auth" },
      START,
    );
  }
}

/** The actions do not wait for the push, so the test does. */
async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

function recipients(): string[] {
  return sent.map((item) => item.endpoint).sort();
}

function endpoints(): string[] {
  return connection.db
    .select({ endpoint: pushSubscriptions.endpoint })
    .from(pushSubscriptions)
    .all()
    .map((row) => row.endpoint)
    .sort();
}

async function kidRequests(): Promise<number> {
  mocked.username = "kid1";
  await requestLogAction(KID1, { activityId: WORSHIP, occurredOn: TODAY });
  await settle();
  sent = [];

  const [pending] = listPendingLogs(connection);

  if (pending === undefined) throw new Error("nothing pending");

  mocked.username = "admin1";

  return pending.id;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  connection = freshConnection();
  mocked.connection = connection;
  sent = [];
  mocked.send = async (keys, payload) => {
    sent.push({ endpoint: keys.endpoint, message: JSON.parse(payload) });
  };
  subscribeEveryone();
});

afterEach(() => {
  vi.useRealTimers();
  for (const opening of opened.splice(0)) {
    if (opening.sqlite.open) opening.sqlite.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("trigger 1: a boy's entry born pending goes to both admins", () => {
  it("a request without the stopwatch (D49)", async () => {
    mocked.username = "kid1";
    await requestLogAction(KID1, { activityId: WORSHIP, occurredOn: TODAY });
    await settle();

    expect(recipients()).toEqual([ENDPOINT[ADMIN1], ENDPOINT[ADMIN2]]);
    expect(sent[0]?.message).toEqual({
      title: "Para aprovar",
      body: "Kid1: Igreja, culto",
      url: "/admin/fila",
    });
  });

  it("a stopwatch session the boy sends", async () => {
    mocked.username = "kid1";
    await startTimerAction(KID1, READING);
    vi.setSystemTime(new Date(START.getTime() + 30 * 60_000));
    await stopTimerAction(KID1, "");
    await settle();

    expect(recipients()).toEqual([ENDPOINT[ADMIN1], ENDPOINT[ADMIN2]]);
    expect(sent[0]?.message.body).toBe("Kid1: Ler livro");
  });

  it("a session that stopped by itself, when the next read files it (D16)", async () => {
    mocked.username = "kid1";
    await startTimerAction(KID1, READING);
    vi.setSystemTime(new Date(START.getTime() + 5 * 60 * 60_000));
    const screen = await fetchTimerScreenAction(KID1);
    await settle();

    expect(screen.settlement?.kind).toBe("autoStopped");
    expect(recipients()).toEqual([ENDPOINT[ADMIN1], ENDPOINT[ADMIN2]]);
  });

  it("not a session too short to become an entry (D44)", async () => {
    mocked.username = "kid1";
    await startTimerAction(KID1, READING);
    vi.setSystemTime(new Date(START.getTime() + 60_000));
    const screen = await stopTimerAction(KID1, "");
    await settle();

    expect(screen.settlement?.kind).toBe("tooShort");
    expect(sent).toEqual([]);
  });

  it("not a start, a pause or a plain read", async () => {
    mocked.username = "kid1";
    await startTimerAction(KID1, READING);
    await fetchTimerScreenAction(KID1);
    await settle();

    expect(sent).toEqual([]);
  });
});

describe("trigger 2: a decision goes to the boy who owns the entry, and only him", () => {
  it("an approval", async () => {
    const logId = await kidRequests();

    await approveLogAction(logId);
    await settle();

    expect(recipients()).toEqual([ENDPOINT[KID1]]);
    expect(sent[0]?.message).toEqual({
      title: "Aprovado",
      body: "Igreja, culto: 1h",
      url: "/menino",
    });
  });

  it("an approval at a value the adult decided (D50)", async () => {
    const logId = await kidRequests();

    await approveLogAction(logId, { overrideHours: 0.5 });
    await settle();

    expect(recipients()).toEqual([ENDPOINT[KID1]]);
    expect(sent[0]?.message.body).toBe("Igreja, culto: 30 min");
  });

  it("a refusal, without the reason or any balance", async () => {
    const logId = await kidRequests();

    await rejectLogAction(logId, "não foi");
    await settle();

    expect(recipients()).toEqual([ENDPOINT[KID1]]);
    expect(sent[0]?.message).toEqual({
      title: "Recusado",
      body: "Igreja, culto",
      url: "/menino",
    });
  });

  it("nothing when the approval is refused (D32)", async () => {
    const logId = await kidRequests();

    await expect(
      approveLogAction(logId, { activityId: 999 }),
    ).rejects.toThrow();
    await settle();

    expect(sent).toEqual([]);
  });
});

describe("nothing else sends a push", () => {
  it("an adult's own launch, a release and a refund", async () => {
    mocked.username = "admin1";

    await launchEntryAction({
      userId: KID1,
      activityId: WORSHIP,
      occurredOn: TODAY,
    });
    await releaseHoursAction({ userId: KID1, hours: 1 });
    await refundHoursAction({
      userId: KID1,
      hours: 1,
      occurredOn: TODAY,
      reason: "Não usou",
    });
    await settle();

    expect(sent).toEqual([]);
  });
});

describe("a push that fails never undoes the action (D51)", () => {
  it("a rejected send leaves the approval in place", async () => {
    const logId = await kidRequests();
    mocked.send = async () => {
      throw new Error("push service down");
    };

    await expect(approveLogAction(logId)).resolves.toBeDefined();
    await settle();

    const row = connection.db.select().from(activityLogs).all();
    expect(row.find((log) => log.id === logId)?.status).toBe("approved");
  });

  it("a sender that throws before its promise leaves the request in place", async () => {
    mocked.username = "kid1";
    mocked.send = () => {
      throw new Error("bad key");
    };

    await expect(
      requestLogAction(KID1, { activityId: WORSHIP, occurredOn: TODAY }),
    ).resolves.toBeDefined();
    await settle();

    expect(listPendingLogs(connection)).toHaveLength(1);
  });

  it("a send that never answers does not hold the action", async () => {
    const logId = await kidRequests();
    mocked.send = () => new Promise(() => undefined);

    await expect(rejectLogAction(logId)).resolves.toBeDefined();
  });

  it("no keys configured is no push, and no error", async () => {
    mocked.send = null;
    mocked.username = "kid1";

    await expect(
      requestLogAction(KID1, { activityId: WORSHIP, occurredOn: TODAY }),
    ).resolves.toBeDefined();
  });
});

describe("a dead subscription (D51)", () => {
  it.each([404, 410])(
    "is deleted when the push service answers %i",
    async (status) => {
      const logId = await kidRequests();
      mocked.send = async () => {
        throw Object.assign(new Error("gone"), { statusCode: status });
      };

      await approveLogAction(logId);
      await settle();

      expect(endpoints()).not.toContain(ENDPOINT[KID1]);
      expect(endpoints()).toHaveLength(3);
    },
  );

  it("is kept on any other failure", async () => {
    const logId = await kidRequests();
    mocked.send = async () => {
      throw Object.assign(new Error("busy"), { statusCode: 429 });
    };

    await approveLogAction(logId);
    await settle();

    expect(endpoints()).toContain(ENDPOINT[KID1]);
  });
});

describe("saving a subscription (D33, D51)", () => {
  const body = {
    endpoint: "https://push.test/new-phone",
    keys: { p256dh: "key", auth: "secret" },
    userId: KID2,
  };

  function ownerOf(endpoint: string): number | undefined {
    return connection.db
      .select()
      .from(pushSubscriptions)
      .all()
      .find((row) => row.endpoint === endpoint)?.userId;
  }

  it("saves it for the session's user, whatever id the body carries", async () => {
    mocked.username = "kid1";

    await savePushSubscriptionAction(body);

    expect(ownerOf(body.endpoint)).toBe(KID1);
  });

  it("moves the same phone to whoever logged in and saved it last", async () => {
    mocked.username = "admin1";
    await savePushSubscriptionAction(body);
    mocked.username = "kid1";
    await savePushSubscriptionAction(body);

    expect(ownerOf(body.endpoint)).toBe(KID1);
  });

  it("refuses without a session", async () => {
    mocked.username = null;

    await expect(savePushSubscriptionAction(body)).rejects.toMatchObject({
      reason: "unauthenticated",
    });
  });

  it.each([
    ["no endpoint", { keys: body.keys }],
    ["a plain-http endpoint", { ...body, endpoint: "http://push.test/x" }],
    ["no keys", { endpoint: body.endpoint }],
    ["a key that is not text", { ...body, keys: { p256dh: 1, auth: "a" } }],
    ["nothing", null],
  ])("refuses %s", async (_name, input) => {
    mocked.username = "kid1";

    await expect(savePushSubscriptionAction(input)).rejects.toThrow();
  });
});
