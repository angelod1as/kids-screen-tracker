import { eq } from "drizzle-orm";

import type { Connection } from "./client";
import { openDatabase } from "./client";
import {
  activities,
  activityLogs,
  categories,
  timers as timersTable,
  users,
} from "./schema";
import type { TimedActivity, TimerRead, TimerWrite } from "./timers";

/**
 * The settlement rules of #18 and #19, one case at a time, run by
 * `timers.test.ts` and the sabotage matrix, each on its own migrated database.
 */

export type TimersModule = {
  readTimer: (connection: Connection, userId: number, now: Date) => TimerRead;
  startTimer: (
    connection: Connection,
    userId: number,
    activityId: number,
    now: Date,
  ) => TimerWrite;
  pauseTimer: (connection: Connection, userId: number, now: Date) => TimerWrite;
  resumeTimer: (
    connection: Connection,
    userId: number,
    now: Date,
  ) => TimerWrite;
  stopTimer: (
    connection: Connection,
    userId: number,
    note: string | null,
    now: Date,
  ) => TimerWrite;
  listTimedActivities: (connection: Connection) => TimedActivity[];
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** A Tuesday, 14:00 in São Paulo: ten hours before the day turns. */
export const START = new Date("2026-09-01T17:00:00.000Z");

/** 08:00, so a twelve-hour pause fits inside the day. */
export const MORNING = new Date("2026-09-01T11:00:00.000Z");

/** "Ler livro": Mente, two hours a session. */
export const BOOK = "Ler livro";
/** "Sair com os amigos": `fixed`, nothing to time. */
export const FRIENDS = "Sair com os amigos";

export type World = {
  connection: Connection;
  kidId: number;
  activityId: (name: string) => number;
  /** For the two-tabs cases. */
  open: () => Connection;
  /** The extra connections included. */
  closeAll: () => void;
  /** Something happens between `readTimer`'s unlocked read and its transaction. */
  racing: (interleave: () => void) => Connection;
  timerRow: () => { status: string; accumulatedSeconds: number } | undefined;
  logs: () => {
    occurredOn: string;
    startedAt: Date | null;
    endedAt: Date | null;
    durationMinutes: number | null;
    status: string;
    source: string;
    autoStopped: boolean;
    note: string | null;
  }[];
};

/** Keeps the path so a case can open a second connection. */
export function makeWorld(connection: Connection, databasePath: string): World {
  const kid = connection.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, "kid1"))
    .get();

  if (kid === undefined) throw new Error("the seed has no kid1");

  const opened: Connection[] = [];

  return {
    connection,
    kidId: kid.id,
    activityId: (name) => {
      const row = connection.db
        .select({ id: activities.id })
        .from(activities)
        .where(eq(activities.name, name))
        .get();

      if (row === undefined) throw new Error(`no activity named ${name}`);

      return row.id;
    },
    open: () => {
      const second = openDatabase(databasePath);
      opened.push(second);

      return second;
    },
    racing: (interleave) => racingConnection(connection, interleave),
    closeAll: () => {
      for (const second of opened.splice(0)) second.sqlite.close();
      connection.sqlite.close();
    },
    timerRow: () =>
      connection.db
        .select({
          status: timersTable.status,
          accumulatedSeconds: timersTable.accumulatedSeconds,
        })
        .from(timersTable)
        .where(eq(timersTable.userId, kid.id))
        .get(),
    logs: () =>
      connection.db
        .select({
          occurredOn: activityLogs.occurredOn,
          startedAt: activityLogs.startedAt,
          endedAt: activityLogs.endedAt,
          durationMinutes: activityLogs.durationMinutes,
          status: activityLogs.status,
          source: activityLogs.source,
          autoStopped: activityLogs.autoStopped,
          note: activityLogs.note,
        })
        .from(activityLogs)
        .where(eq(activityLogs.userId, kid.id))
        .all(),
  };
}

/** Lets another tab in once, just before the first `transaction` call. */
function racingConnection(
  connection: Connection,
  interleave: () => void,
): Connection {
  let raced = false;
  const db = new Proxy(connection.db, {
    get(target, property) {
      if (property === "transaction") {
        return (...args: unknown[]) => {
          if (!raced) {
            raced = true;
            interleave();
          }

          return (
            target.transaction as unknown as (...rest: unknown[]) => unknown
          )(...args);
        };
      }

      const value = Reflect.get(target, property) as unknown;

      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { sqlite: connection.sqlite, db: db as Connection["db"] };
}

export type TimersCase = {
  rule: string;
  name: string;
  run: (timers: TimersModule, world: World) => unknown;
  expected: unknown;
};

function logsText(world: World): string {
  const rows = world.logs();

  return rows.length === 0
    ? "no record"
    : rows
        .map(
          (row) =>
            `${row.status}/${row.source} · ${row.occurredOn} · ${row.durationMinutes} min · ended ${row.endedAt?.toISOString() ?? "never"} · ${row.autoStopped ? "auto" : "by hand"} · ${row.note ?? "no note"}`,
        )
        .join(" | ");
}

function refused(body: () => void): string {
  try {
    body();
  } catch (thrown) {
    return `refused: ${(thrown as Error).message}`;
  }

  return "not refused";
}

function startBook(timers: TimersModule, world: World, at: Date = START): void {
  timers.startTimer(world.connection, world.kidId, world.activityId(BOOK), at);
}

export const TIMERS_CASES: readonly TimersCase[] = [
  {
    rule: "the record is written from the stamps",
    name: "a stop writes one pending record, from the timer, with the note",
    run: (timers, world) => {
      startBook(timers, world);
      timers.stopTimer(
        world.connection,
        world.kidId,
        "Capítulo 4",
        new Date(START.getTime() + 6 * MINUTE),
      );

      return logsText(world);
    },
    expected: `pending/timer · 2026-09-01 · 6 min · ended ${new Date(START.getTime() + 6 * MINUTE).toISOString()} · by hand · Capítulo 4`,
  },
  {
    rule: "the record is written from the stamps",
    name: "time spent paused is nowhere in the duration",
    run: (timers, world) => {
      startBook(timers, world);
      timers.pauseTimer(
        world.connection,
        world.kidId,
        new Date(START.getTime() + 20 * MINUTE),
      );
      timers.resumeTimer(
        world.connection,
        world.kidId,
        new Date(START.getTime() + 3 * HOUR),
      );
      timers.stopTimer(
        world.connection,
        world.kidId,
        null,
        new Date(START.getTime() + 3 * HOUR + 10 * MINUTE),
      );

      return world.logs()[0]?.durationMinutes;
    },
    expected: 30,
  },
  {
    rule: "the record is written from the stamps",
    name: "a stop is dated at the pause it froze, not at the confirmation",
    run: (timers, world) => {
      // *Parar* pauses first; the typing afterwards must not lengthen the record.
      startBook(timers, world);
      timers.pauseTimer(
        world.connection,
        world.kidId,
        new Date(START.getTime() + 10 * MINUTE),
      );
      timers.stopTimer(
        world.connection,
        world.kidId,
        null,
        new Date(START.getTime() + 2 * HOUR),
      );

      return world.logs()[0]?.endedAt?.toISOString();
    },
    expected: new Date(START.getTime() + 10 * MINUTE).toISOString(),
  },
  {
    rule: "the record is written from the stamps",
    name: "the day is the day the session began, not the day it ended",
    run: (timers, world) => {
      // 23:50 in São Paulo, stopped twenty minutes into the next day.
      const late = new Date("2026-09-02T02:50:00.000Z");
      startBook(timers, world, late);
      timers.stopTimer(
        world.connection,
        world.kidId,
        null,
        new Date(late.getTime() + 5 * MINUTE),
      );

      return world.logs()[0]?.occurredOn;
    },
    expected: "2026-09-01",
  },
  {
    rule: "the record is written from the stamps",
    name: "two hundred taps of Pausar do not round a hundred seconds up",
    run: (timers, world) => {
      startBook(timers, world);
      // Five minutes first, so the record clears the floor (D44).
      let now = START.getTime() + 5 * MINUTE;

      for (let cycle = 0; cycle < 200; cycle += 1) {
        now += 500;
        timers.pauseTimer(world.connection, world.kidId, new Date(now));
        timers.resumeTimer(world.connection, world.kidId, new Date(now));
      }

      timers.stopTimer(world.connection, world.kidId, null, new Date(now));

      // 100 s of reading is 1 min 40, and no tapping may make it three.
      return (world.logs()[0]?.durationMinutes ?? 0) <= 7;
    },
    expected: true,
  },

  {
    rule: "one session at a time, and only what a stopwatch can measure",
    name: "a second session is refused while one is open",
    run: (timers, world) => {
      startBook(timers, world);

      return refused(() => startBook(timers, world)).replace(
        /user \d+/,
        "user N",
      );
    },
    expected:
      "refused: user N already has an open timer; stop it before starting another",
  },
  {
    rule: "one session at a time, and only what a stopwatch can measure",
    name: "an activity that is not measured by duration is refused",
    run: (timers, world) =>
      refused(() =>
        timers.startTimer(
          world.connection,
          world.kidId,
          world.activityId(FRIENDS),
          START,
        ),
      ).replace(/activity \d+/, "activity N"),
    expected:
      "refused: activity N cannot be timed: it must be active and measured by duration",
  },
  {
    rule: "one session at a time, and only what a stopwatch can measure",
    name: "an activity whose category was switched off is refused (D14)",
    run: (timers, world) => {
      const book = world.activityId(BOOK);
      world.connection.db
        .update(categories)
        .set({ active: false })
        .where(
          eq(
            categories.id,
            world.connection.db
              .select({ categoryId: activities.categoryId })
              .from(activities)
              .where(eq(activities.id, book))
              .get()?.categoryId ?? 0,
          ),
        )
        .run();

      const offered = timers
        .listTimedActivities(world.connection)
        .some((activity) => activity.name === BOOK);

      return `${offered} — ${refused(() =>
        timers.startTimer(world.connection, world.kidId, book, START),
      ).replace(/activity \d+/, "activity N")}`;
    },
    expected:
      "false — refused: activity N cannot be timed: it must be active and measured by duration",
  },

  {
    rule: "a settlement is written once, however many tabs are looking",
    name: "reading the same finished session twice writes one record",
    run: (timers, world) => {
      startBook(timers, world);
      const late = new Date(START.getTime() + 5 * HOUR);
      timers.readTimer(world.connection, world.kidId, late);
      timers.readTimer(world.connection, world.kidId, late);

      return `${world.logs().length} · ${logsText(world)}`;
    },
    expected: `1 · pending/timer · 2026-09-01 · 120 min · ended ${new Date(START.getTime() + 2 * HOUR).toISOString()} · auto · no note`,
  },
  {
    rule: "a settlement is written once, however many tabs are looking",
    name: "a tab that settles it between the two reads does not get a second record",
    run: (timers, world) => {
      // Another connection settles the session inside the gap.
      startBook(timers, world);
      const late = new Date(START.getTime() + 5 * HOUR);
      const racing = world.racing(() => {
        timers.readTimer(world.open(), world.kidId, late);
      });

      const read = timers.readTimer(racing, world.kidId, late);

      return `${world.logs().length} · ${read.settlement === null ? "no notice" : read.settlement.kind}`;
    },
    expected: "1 · no notice",
  },
  {
    rule: "a settlement is written once, however many tabs are looking",
    name: "a session settled by a tab cannot be stopped again",
    run: (timers, world) => {
      startBook(timers, world);
      const late = new Date(START.getTime() + 5 * HOUR);
      timers.readTimer(world.connection, world.kidId, late);

      const answer = refused(() =>
        timers.stopTimer(world.connection, world.kidId, null, late),
      ).replace(/user \d+/, "user N");

      return `${answer} · ${world.logs().length}`;
    },
    expected: "refused: user N has no open timer · 1",
  },

  {
    rule: "a settlement is written once, however many tabs are looking",
    name: "a limit lengthened between the two reads leaves the session running",
    run: (timers, world) => {
      // Decided on what the transaction sees. Raced on the timer's own limit: the
      // activity's no longer reaches an open session (D38).
      startBook(timers, world);
      const late = new Date(START.getTime() + 5 * HOUR);
      const racing = world.racing(() => {
        world.connection.db
          .update(timersTable)
          .set({ maxSessionMinutes: 600 })
          .where(eq(timersTable.userId, world.kidId))
          .run();
      });

      const read = timers.readTimer(racing, world.kidId, late);

      return `${read.open === null ? "closed" : "open"} · ${logsText(world)}`;
    },
    expected: "open · no record",
  },

  {
    rule: "the limit, the abandonment and the turn of the day",
    name: "a stop that arrives after the limit settles it instead of ending it by hand",
    run: (timers, world) => {
      startBook(timers, world);
      const write = timers.stopTimer(
        world.connection,
        world.kidId,
        "li a tarde toda",
        new Date(START.getTime() + 5 * HOUR),
      );

      return `${write.proposed === null ? "nothing proposed" : "proposed"} · ${write.read.settlement?.kind} · ${logsText(world)}`;
    },
    expected: `nothing proposed · autoStopped · pending/timer · 2026-09-01 · 120 min · ended ${new Date(START.getTime() + 2 * HOUR).toISOString()} · auto · no note`,
  },
  {
    rule: "the limit, the abandonment and the turn of the day",
    name: "the limit writes a record marked as ended by itself",
    run: (timers, world) => {
      startBook(timers, world);
      const read = timers.readTimer(
        world.connection,
        world.kidId,
        new Date(START.getTime() + 5 * HOUR),
      );

      return `${read.settlement?.kind} · ${read.settlement?.durationMinutes} · ${logsText(world)}`;
    },
    expected: `autoStopped · 120 · pending/timer · 2026-09-01 · 120 min · ended ${new Date(START.getTime() + 2 * HOUR).toISOString()} · auto · no note`,
  },
  {
    rule: "the limit, the abandonment and the turn of the day",
    name: "a pause of twelve hours leaves nothing behind (D16)",
    run: (timers, world) => {
      startBook(timers, world, MORNING);
      timers.pauseTimer(
        world.connection,
        world.kidId,
        new Date(MORNING.getTime() + 10 * MINUTE),
      );
      const read = timers.readTimer(
        world.connection,
        world.kidId,
        new Date(MORNING.getTime() + 13 * HOUR),
      );

      return `${read.settlement?.kind} · ${world.timerRow()?.status} · ${logsText(world)}`;
    },
    expected: "abandoned · abandoned · no record",
  },
  {
    rule: "the limit, the abandonment and the turn of the day",
    name: "the turn of the day closes the session on the day it began",
    run: (timers, world) => {
      // 23:30 in São Paulo, read an hour later.
      const late = new Date("2026-09-02T02:30:00.000Z");
      startBook(timers, world, late);
      const read = timers.readTimer(
        world.connection,
        world.kidId,
        new Date(late.getTime() + HOUR),
      );

      return `${read.settlement?.kind} · ${logsText(world)}`;
    },
    expected:
      "dayEnded · pending/timer · 2026-09-01 · 30 min · ended 2026-09-02T03:00:00.000Z · auto · no note",
  },
  {
    rule: "the limit, the abandonment and the turn of the day",
    name: "a session parked by pausing is closed by the day, not kept alive",
    run: (timers, world) => {
      const late = new Date("2026-09-02T02:50:00.000Z");
      startBook(timers, world, late);
      timers.pauseTimer(
        world.connection,
        world.kidId,
        new Date(late.getTime() + 5 * MINUTE),
      );
      const read = timers.readTimer(
        world.connection,
        world.kidId,
        new Date(late.getTime() + 11 * HOUR),
      );

      return `${read.open === null ? "closed" : "open"} · ${read.settlement?.kind} · ${world.logs()[0]?.occurredOn}`;
    },
    expected: "closed · dayEnded · 2026-09-01",
  },

  {
    rule: "a session under its floor is not filed",
    name: "a stop one second under the floor files nothing, and names the floor",
    run: (timers, world) => {
      startBook(timers, world);
      const written = timers.stopTimer(
        world.connection,
        world.kidId,
        null,
        new Date(START.getTime() + 5 * MINUTE - 1000),
      );

      return `${written.read.settlement?.kind} · ${written.read.settlement?.minSessionMinutes} · ${logsText(world)}`;
    },
    expected: "tooShort · 5 · no record",
  },
  {
    rule: "a session under its floor is not filed",
    name: "the turn of the day under the floor files nothing",
    run: (timers, world) => {
      // 23:57 in São Paulo: three minutes when the day ends.
      const late = new Date("2026-09-02T02:57:00.000Z");
      startBook(timers, world, late);
      const read = timers.readTimer(
        world.connection,
        world.kidId,
        new Date(late.getTime() + HOUR),
      );

      return `${read.settlement?.kind} · ${world.timerRow()?.status} · ${logsText(world)}`;
    },
    expected: "tooShort · stopped · no record",
  },
  {
    rule: "a session under its floor is not filed",
    name: "the floor is the one stamped when the session opened (D38)",
    run: (timers, world) => {
      startBook(timers, world);
      world.connection.db
        .update(activities)
        .set({ minSessionMinutes: 30 })
        .where(eq(activities.id, world.activityId(BOOK)))
        .run();
      timers.stopTimer(
        world.connection,
        world.kidId,
        null,
        new Date(START.getTime() + 6 * MINUTE),
      );

      return world.logs()[0]?.durationMinutes;
    },
    expected: 6,
  },
];

/** A fresh database per case, since every one writes. */
export function failingTimersCases(
  timers: TimersModule,
  worlds: () => World,
): TimersCase[] {
  return TIMERS_CASES.filter((timersCase) => {
    const world = worlds();

    try {
      return timersCase.run(timers, world) !== timersCase.expected;
    } catch (thrown) {
      return `threw: ${(thrown as Error).message}` !== timersCase.expected;
    } finally {
      world.closeAll();
    }
  });
}
