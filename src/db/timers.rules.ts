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
 * The rules of the settlement — the part of #18 and #19 that writes — one case
 * at a time.
 *
 * Same shape and same reason as `queue.rules.ts`: `timers.test.ts` asserts the
 * real module answers every case and `timers.sabotage.test.ts` rewrites
 * `src/db/timers.ts` one clause at a time and asserts each mutant gets at least
 * one case wrong.
 *
 * It exists because round 1 measured what nothing here could see: three
 * mutations of this module survived the whole suite. The rounding of the banked
 * seconds, the instant a stop is dated at, and — worst of the three — the
 * re-read inside `readTimer`'s transaction, which is the only thing standing
 * between two tabs and two records for one session, and which could be deleted
 * whole with 799 tests still green.
 *
 * The cases touch a database, like the queue's, because these rules are rules
 * *of* the writing. Each is handed a freshly migrated and seeded database of
 * its own and answers with one string.
 */

/** The part of `src/db/timers.ts` a case may call. */
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

/** A Tuesday, 14:00 in São Paulo. Ten hours short of the turn of the day. */
export const START = new Date("2026-09-01T17:00:00.000Z");

/** 08:00 in São Paulo, so a pause has its twelve hours inside the day. */
export const MORNING = new Date("2026-09-01T11:00:00.000Z");

/** "Ler livro": Mente, two hours a session. */
export const BOOK = "Ler livro";
/** "Sair com os amigos": Convívio, `fixed`, nothing to time. */
export const FRIENDS = "Sair com os amigos";

export type World = {
  connection: Connection;
  /** Kid1. */
  kidId: number;
  activityId: (name: string) => number;
  /** A second connection to the same file, for the two-tabs cases. */
  open: () => Connection;
  /** Closes this world's connections, the extra ones included. */
  closeAll: () => void;
  /**
   * The same connection, with one thing happening between the read that decides
   * a settlement is due and the transaction that writes it.
   *
   * That gap is the whole reason `readTimer` reads the row again inside its own
   * transaction, and nothing else in the suite can stand in it.
   */
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

/**
 * A world around an already migrated and seeded connection, plus the path it
 * was opened from so a case can open a second one.
 */
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

/**
 * A connection that lets somebody else in once, just before the first
 * transaction it is asked for begins.
 *
 * The proxy is on `transaction` alone and every other member is handed back
 * bound to the real handle, so what the module under test does with it is what
 * it would do with any connection. `writeTransaction` is what calls
 * `transaction`, so this is exactly the gap between `readTimer`'s first,
 * unlocked read and the write lock it then takes.
 */
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
  /** Which acceptance criterion of #18 or #19 this case belongs to. */
  rule: string;
  name: string;
  run: (timers: TimersModule, world: World) => unknown;
  expected: unknown;
};

/** Every record the boy has, as one comparable line each. */
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

/** Runs `body` and names the refusal instead of letting it escape. */
function refused(body: () => void): string {
  try {
    body();
  } catch (thrown) {
    return `refused: ${(thrown as Error).message}`;
  }

  return "not refused";
}

/** Starts a session of `activity` at `START` and hands back nothing. */
function startBook(timers: TimersModule, world: World, at: Date = START): void {
  timers.startTimer(world.connection, world.kidId, world.activityId(BOOK), at);
}

export const TIMERS_CASES: readonly TimersCase[] = [
  // --- o registro sai dos carimbos, e só deles ------------------------------
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
      // *Parar* pauses first and the boy then types a note. The record has to
      // end where he stopped reading, however long the typing took.
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

      // A hundred seconds of reading is one minute forty, and nothing the boy
      // taps may make it three.
      return (world.logs()[0]?.durationMinutes ?? 0) <= 7;
    },
    expected: true,
  },

  // --- uma sessão por menino, e só o que dá para cronometrar ----------------
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

  // --- a liquidação acontece uma vez, por mais que se leia -------------------
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
      // The gap `readTimer` re-reads to close: this connection settles the
      // session on another one after the first, unlocked read has already
      // decided a settlement is due.
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
      // The settlement is decided on what the transaction sees, not on what the
      // unlocked read saw: a limit lengthened in that gap must not have a
      // record written for a session that is still going.
      //
      // The race is run against the *timer's own* limit, because that is the
      // number the transaction reads now (D38). Lengthening the activity's
      // limit no longer reaches an open session at all — that is the whole of
      // D38 — so racing it would be racing something inert, and the case would
      // pass without exercising anything.
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

  // --- o limite, o abandono e a virada do dia -------------------------------
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

  // --- D44: a sessão mínima -------------------------------------------------
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

/**
 * The cases `timers` gets wrong, each run against a world of its own.
 *
 * A fresh database per case, because every one of these writes.
 */
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
