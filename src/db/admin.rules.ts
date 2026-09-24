import { asc, eq } from "drizzle-orm";
import type { EntryPreview, LaunchResult, NewEntry } from "./admin";
import type { Connection } from "./client";
import type { World } from "./queue.rules";
import { BOOK, CAR, COMIC, FRIENDS, makeWorld, THAT_DAY } from "./queue.rules";
import { activities, activityLogs, categories, ledger, users } from "./schema";

/**
 * The rules of #22, written out one case at a time.
 *
 * Same shape and same reason as `queue.rules.ts`, and built on that file's own
 * `World` on purpose: the launch and the approval are the two ways an entry
 * gets frozen, they are governed by the same decisions, and a matrix whose
 * fixtures differ from the neighbouring matrix's fixtures is a matrix about a
 * different program.
 *
 * Two files run this table. `admin.test.ts` asserts the real module answers
 * every case, and `admin.sabotage.test.ts` rewrites one clause of
 * `src/db/admin.ts`, `src/db/input.ts` or `src/db/people.ts` at a time and
 * asserts each mutant gets at least one case wrong.
 */

/** The part of the launch a case may call. */
export type AdminModule = {
  previewEntry: (
    connection: Connection,
    entry: NewEntry,
    now: Date,
  ) => EntryPreview;
  launchEntry: (
    connection: Connection,
    entry: NewEntry,
    adminId: number,
    now: Date,
  ) => LaunchResult;
};

/**
 * The moment every case launches at, and the day it falls on in São Paulo.
 *
 * Deliberately a different day from `THAT_DAY`, which is the day the entries
 * happen on: the rule under test is that the value comes from the day the
 * activity happened (D8), and a table that launched everything on the day it
 * happened could not tell the two apart.
 */
export const LAUNCHED_AT = new Date("2026-09-13T15:00:00.000Z");

/** The São Paulo day `LAUNCHED_AT` falls on. */
export const TODAY = "2026-09-13";

/** Curinga's one activity: `free`, and the value is typed at launch (D11, D12). */
export const FREE = "Atividade avulsa";

/**
 * Escola's one timed activity: a daily bucket, and neither a cooldown nor a
 * return bonus.
 *
 * Which makes it the one activity whose entries read nothing outside their own
 * day — the case that separates "the bucket is the day it happened" from every
 * rule that looks across days.
 */
export const STUDY = "Estudo para prova";

export type AdminWorld = World & {
  /** Kid2, for the case that launches onto the other boy. */
  otherKidId: number;
  balance: (userId: number) => number;
  pendingCount: () => number;
  /** Every log of every status, for the assertions about what a refusal left. */
  logCount: () => number;
  reject: (logId: number) => void;
  setActivityActive: (name: string, active: boolean) => void;
  setCategoryActive: (name: string, active: boolean) => void;
  setUserActive: (userId: number, active: boolean) => void;
  /** One log as a comparable line, including the columns #22 is about. */
  entryText: (logId: number) => string;
  ledgerText: () => string;
};

export function makeAdminWorld(connection: Connection): AdminWorld {
  const world = makeWorld(connection);
  const otherKidId =
    connection.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, "kid2"))
      .get()?.id ?? 0;

  return {
    ...world,
    otherKidId,
    balance: (userId) =>
      Math.round(
        connection.db
          .select({ kind: ledger.kind, hours: ledger.hours })
          .from(ledger)
          .where(eq(ledger.userId, userId))
          .all()
          .reduce(
            (sum, row) => sum + (row.kind === "spend" ? -row.hours : row.hours),
            0,
          ) * 100,
      ) / 100,
    pendingCount: () =>
      connection.db
        .select({ id: activityLogs.id })
        .from(activityLogs)
        .where(eq(activityLogs.status, "pending"))
        .all().length,
    logCount: () =>
      connection.db.select({ id: activityLogs.id }).from(activityLogs).all()
        .length,
    reject: (logId) => {
      connection.db
        .update(activityLogs)
        .set({
          status: "rejected",
          reviewedBy: world.adminId,
          reviewedAt: LAUNCHED_AT,
        })
        .where(eq(activityLogs.id, logId))
        .run();
    },
    setActivityActive: (name, active) => {
      connection.db
        .update(activities)
        .set({ active })
        .where(eq(activities.name, name))
        .run();
    },
    setCategoryActive: (name, active) => {
      connection.db
        .update(categories)
        .set({ active })
        .where(eq(categories.name, name))
        .run();
    },
    setUserActive: (userId, active) => {
      connection.db
        .update(users)
        .set({ active })
        .where(eq(users.id, userId))
        .run();
    },
    entryText: (logId) => {
      const row = connection.db
        .select({
          status: activityLogs.status,
          source: activityLogs.source,
          occurredOn: activityLogs.occurredOn,
          computedHours: activityLogs.computedHours,
          durationMinutes: activityLogs.durationMinutes,
          quality: activityLogs.quality,
          freeValue: activityLogs.freeValue,
          activityName: activities.name,
          reviewedBy: activityLogs.reviewedBy,
          createdBy: activityLogs.createdBy,
          note: activityLogs.note,
        })
        .from(activityLogs)
        .innerJoin(activities, eq(activityLogs.activityId, activities.id))
        .where(eq(activityLogs.id, logId))
        .get();

      if (row === undefined) throw new Error(`no log ${logId}`);

      return `${row.status} ${row.source} · ${row.computedHours} h · ${row.durationMinutes} min · nota ${row.quality} · avulso ${row.freeValue} · ${row.activityName} · ${row.occurredOn} · by ${row.createdBy}/${row.reviewedBy} · ${row.note ?? "no note"}`;
    },
    ledgerText: () => {
      const rows = connection.db
        .select({
          userId: ledger.userId,
          kind: ledger.kind,
          hours: ledger.hours,
          occurredOn: ledger.occurredOn,
          activityLogId: ledger.activityLogId,
          createdBy: ledger.createdBy,
        })
        .from(ledger)
        .orderBy(asc(ledger.id))
        .all();

      return rows.length === 0
        ? "no ledger"
        : rows
            .map(
              (row) =>
                `${row.kind} ${row.hours} on ${row.occurredOn} for log ${row.activityLogId} by ${row.createdBy} to ${row.userId}`,
            )
            .join(" | ");
    },
  };
}

export type AdminCase = {
  /** Which acceptance criterion of #22 this case belongs to. */
  rule: string;
  name: string;
  run: (admin: AdminModule, world: AdminWorld) => unknown;
  expected: unknown;
};

/** Runs `body` and names the refusal instead of letting it escape. */
function refused(body: () => void): string {
  try {
    body();
  } catch (thrown) {
    return `refused: ${(thrown as Error).message}`;
  }

  return "not refused";
}

/** One hour of an activity, for the boy of the world, on the day it happened. */
function entry(world: AdminWorld, overrides: Partial<NewEntry> = {}): NewEntry {
  return {
    userId: world.kidId,
    activityId: world.activityId(BOOK),
    occurredOn: THAT_DAY,
    durationMinutes: 60,
    ...overrides,
  };
}

export const ADMIN_CASES: readonly AdminCase[] = [
  // --- D18: nasce approved, com reviewed_by, e o ledger na mesma transação ---
  {
    rule: "an admin's entry is born approved and credited",
    name: "one hour of Ler livro is an hour and a half, and a debut has no return bonus",
    run: (admin, world) => {
      const { logId } = admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      return world.entryText(logId);
    },
    // 1h × 1,5, and no bonus: nothing of Mente before it (D47).
    expected: `approved admin · 1.5 h · 60 min · nota null · avulso null · ${BOOK} · ${THAT_DAY} · by 1/1 · no note`,
  },
  {
    rule: "an admin's entry is born approved and credited",
    name: "the ledger row is written with it, for the boy, by the adult",
    run: (admin, world) => {
      admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      return world.ledgerText();
    },
    expected: `earn 1.5 on ${THAT_DAY} for log 1 by 1 to 3`,
  },
  {
    rule: "an admin's entry is born approved and credited",
    name: "it does not join the queue",
    run: (admin, world) => {
      admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      return world.pendingCount();
    },
    expected: 0,
  },
  {
    rule: "an admin's entry is born approved and credited",
    name: "the note the adult wrote is kept",
    run: (admin, world) => {
      const { logId } = admin.launchEntry(
        world.connection,
        entry(world, { note: "Leu no carro" }),
        world.adminId,
        LAUNCHED_AT,
      );

      return world.entryText(logId);
    },
    expected: `approved admin · 1.5 h · 60 min · nota null · avulso null · ${BOOK} · ${THAT_DAY} · by 1/1 · Leu no carro`,
  },
  {
    rule: "an admin's entry is born approved and credited",
    name: "the balance moves by what was credited",
    run: (admin, world) => {
      admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      return world.balance(world.kidId);
    },
    expected: 1.5,
  },
  {
    rule: "an admin's entry is born approved and credited",
    name: "the other boy's entry lands on the other boy",
    run: (admin, world) => {
      admin.launchEntry(
        world.connection,
        entry(world, { userId: world.otherKidId }),
        world.adminId,
        LAUNCHED_AT,
      );

      return `${world.balance(world.kidId)} · ${world.balance(world.otherKidId)}`;
    },
    expected: "0 · 1.5",
  },

  // --- D8: o balde é o do dia em que ocorreu, não o de hoje -----------------
  {
    rule: "a retroactive entry reads the day it happened",
    name: "four hours of today do not touch an entry from three days ago",
    run: (admin, world) => {
      // Escola: a daily bucket, no cooldown and no return bonus, so today's
      // four hours cannot reach back to a day the launch is landing on. Four
      // hours read as this entry's bucket would pay 0,25 h instead of 1 h.
      world.addApproved({
        activity: STUDY,
        occurredOn: TODAY,
        durationMinutes: 240,
      });

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world, { activityId: world.activityId(STUDY) }),
        world.adminId,
        LAUNCHED_AT,
      );

      return hours;
    },
    expected: 1,
  },
  {
    rule: "a retroactive entry reads the day it happened",
    name: "an hour already in that day's bucket halves it",
    run: (admin, world) => {
      world.addApproved({ activity: BOOK, occurredOn: THAT_DAY });

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      // 1h × 1,5, halved by the hour of Mente already done that day, and the
      // return bonus is gone with it.
      return hours;
    },
    expected: 0.75,
  },
  {
    rule: "a retroactive entry reads the day it happened",
    name: "the ledger row carries the day it happened, not today",
    run: (admin, world) => {
      admin.launchEntry(
        world.connection,
        entry(world, { occurredOn: "2026-09-01" }),
        world.adminId,
        LAUNCHED_AT,
      );

      return world.ledgerText();
    },
    expected: "earn 1.5 on 2026-09-01 for log 1 by 1 to 3",
  },
  {
    rule: "a retroactive entry reads the day it happened",
    name: "the seven-day cooldown is read from that day too",
    run: (admin, world) => {
      // Washed four days before the day being launched: inside Casa's window.
      world.addApproved({
        activity: CAR,
        occurredOn: "2026-09-06",
        durationMinutes: null,
        quality: 1,
      });

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world, {
          activityId: world.activityId(CAR),
          durationMinutes: null,
          quality: 1,
        }),
        world.adminId,
        LAUNCHED_AT,
      );

      // 3h × 1,0 for the grade, halved by the cooldown.
      return hours;
    },
    expected: 1.5,
  },
  {
    rule: "a retroactive entry reads the day it happened",
    name: "a refused entry of the same day fills nothing (D19)",
    run: (admin, world) => {
      const stale = world.addPending({ activity: BOOK, occurredOn: THAT_DAY });
      world.reject(stale);

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      return hours;
    },
    expected: 1.5,
  },

  // --- D32: a ordem não é do adulto ----------------------------------------
  {
    rule: "an entry is not frozen out of the canonical order",
    name: "a pending entry of the same day has to be decided first",
    run: (admin, world) => {
      world.addPending({ activity: BOOK, occurredOn: THAT_DAY });

      return `${refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world),
          world.adminId,
          LAUNCHED_AT,
        ),
      )} — ${world.ledgerText()}`;
    },
    expected: `refused: this entry cannot be launched yet: log 1 (${BOOK}, ${THAT_DAY}) comes before it and is still waiting; decide that one first — no ledger`,
  },
  {
    rule: "an entry is not frozen out of the canonical order",
    name: "the cooldown's window blocks across days too",
    run: (admin, world) => {
      world.addPending({
        activity: CAR,
        occurredOn: "2026-09-06",
        durationMinutes: null,
        quality: 1,
      });

      return refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world, {
            activityId: world.activityId(CAR),
            durationMinutes: null,
            quality: 1,
          }),
          world.adminId,
          LAUNCHED_AT,
        ),
      );
    },
    expected: `refused: this entry cannot be launched yet: log 1 (${CAR}, 2026-09-06) comes before it and is still waiting; decide that one first`,
  },
  {
    rule: "an entry is not frozen out of the canonical order",
    name: "refusing the pending one clears the way, since a refusal counts for nothing",
    run: (admin, world) => {
      const waiting = world.addPending({
        activity: BOOK,
        occurredOn: THAT_DAY,
      });
      world.reject(waiting);

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      return hours;
    },
    expected: 1.5,
  },
  {
    rule: "an entry is not frozen out of the canonical order",
    name: "a pending entry one day outside the window does not block",
    run: (admin, world) => {
      // Mente reads three days back for the return bonus and no further, so
      // the window of an entry on the 10th opens on the 7th and this is the
      // day before it. A window one day wider would swallow this case. The
      // approved past keeps it from being Mente's debut (D47).
      world.addApproved({ activity: BOOK, occurredOn: "2026-08-01" });
      world.addPending({ activity: BOOK, occurredOn: "2026-09-06" });

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      return hours;
    },
    expected: 2.25,
  },
  {
    rule: "an entry is not frozen out of the canonical order",
    name: "a pending debut of the category blocks a launch however old it is (D47)",
    run: (admin, world) => {
      world.addPending({ activity: BOOK, occurredOn: "2026-09-06" });

      return refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world),
          world.adminId,
          LAUNCHED_AT,
        ),
      );
    },
    expected: `refused: this entry cannot be launched yet: log 1 (${BOOK}, 2026-09-06) comes before it and is still waiting; decide that one first`,
  },
  {
    rule: "an entry is not frozen out of the canonical order",
    name: "a launch after an approved past older than the window is a return (D47)",
    run: (admin, world) => {
      world.addApproved({ activity: BOOK, occurredOn: "2026-09-06" });

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      return hours;
    },
    expected: 2.25,
  },
  {
    rule: "a launch reads what its window has already spent",
    name: "a launch onto a past day before the category's first entry is its debut (D34, D47)",
    run: (admin, world) => {
      // Frozen first, but nine days later: nothing of Mente came before the 1st.
      world.addApproved({ activity: BOOK, occurredOn: THAT_DAY });

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world, { occurredOn: "2026-09-01" }),
        world.adminId,
        LAUNCHED_AT,
      );

      return hours;
    },
    expected: 1.5,
  },
  {
    rule: "an entry is not frozen out of the canonical order",
    name: "a pending entry on the first day of the window does block",
    run: (admin, world) => {
      // The other side of the same edge: the window of an entry on the 10th
      // opens on the 7th, so this one is inside it by a day.
      world.addPending({ activity: BOOK, occurredOn: "2026-09-07" });

      return refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world),
          world.adminId,
          LAUNCHED_AT,
        ),
      );
    },
    expected: `refused: this entry cannot be launched yet: log 1 (${BOOK}, 2026-09-07) comes before it and is still waiting; decide that one first`,
  },
  {
    rule: "an entry is not frozen out of the canonical order",
    name: "a pending entry of a later day does not block",
    run: (admin, world) => {
      // Nothing after this entry can be read by it, decided or not — and when
      // that one is approved it will read this one, which is D8 working.
      world.addPending({ activity: BOOK, occurredOn: TODAY });

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      return hours;
    },
    expected: 1.5,
  },
  {
    rule: "an entry is not frozen out of the canonical order",
    name: "the preview names the entry that has to be decided first",
    run: (admin, world) => {
      world.addPending({ activity: BOOK, occurredOn: THAT_DAY });

      return admin.previewEntry(world.connection, entry(world), LAUNCHED_AT)
        .blockedBy?.activityName;
    },
    expected: BOOK,
  },

  // --- D34: a franquia é consumida na ordem de congelamento ----------------
  {
    rule: "a launch reads what its window has already spent",
    name: "the wash of Monday, launched after Tuesday's was frozen, pays half",
    run: (admin, world) => {
      // Tuesday was frozen first and paid in full: nothing washed in the seven
      // days before it. Monday is launched afterwards, so it is frozen second
      // and reads the allowance Tuesday already spent — which is D34, and
      // which is what closes the door D32 closed on the queue's side.
      world.addApproved({
        activity: CAR,
        occurredOn: "2026-09-08",
        durationMinutes: null,
        quality: 1,
        hours: 3,
      });

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world, {
          activityId: world.activityId(CAR),
          occurredOn: "2026-09-07",
          durationMinutes: null,
          quality: 1,
        }),
        world.adminId,
        LAUNCHED_AT,
      );

      return hours;
    },
    // 3 h × 1,0 for the grade, halved by the cooldown Tuesday already spent.
    expected: 1.5,
  },
  {
    rule: "a launch reads what its window has already spent",
    name: "so the pair costs four and a half hours, not six",
    run: (admin, world) => {
      const tuesday = world.addApproved({
        activity: CAR,
        occurredOn: "2026-09-08",
        durationMinutes: null,
        quality: 1,
        hours: 3,
      });

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world, {
          activityId: world.activityId(CAR),
          occurredOn: "2026-09-07",
          durationMinutes: null,
          quality: 1,
        }),
        world.adminId,
        LAUNCHED_AT,
      );

      // The two frozen values, and their sum. Tuesday is untouched beside it:
      // D15 says a frozen value is never recomputed, and the 6 h this pair used
      // to cost is the number D32 measured on the queue.
      const tuesdayHours = world.logRow(tuesday).computedHours ?? 0;

      return `${tuesdayHours} + ${hours} = ${tuesdayHours + hours}`;
    },
    expected: "3 + 1.5 = 4.5",
  },
  {
    rule: "a launch reads what its window has already spent",
    name: "the last day the window reaches forward to still counts",
    run: (admin, world) => {
      // Casa's cooldown is seven days, so a wash on the 8th is inside the
      // window of a wash on the 1st — by exactly one day of margin.
      world.addApproved({
        activity: CAR,
        occurredOn: "2026-09-08",
        durationMinutes: null,
        quality: 1,
        hours: 3,
      });

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world, {
          activityId: world.activityId(CAR),
          occurredOn: "2026-09-01",
          durationMinutes: null,
          quality: 1,
        }),
        world.adminId,
        LAUNCHED_AT,
      );

      return hours;
    },
    expected: 1.5,
  },
  {
    rule: "a launch reads what its window has already spent",
    name: "one day beyond it does not",
    run: (admin, world) => {
      world.addApproved({
        activity: CAR,
        occurredOn: "2026-09-08",
        durationMinutes: null,
        quality: 1,
        hours: 3,
      });

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world, {
          activityId: world.activityId(CAR),
          // Eight days earlier: outside the seven-day cooldown, so the two
          // washes have nothing to do with each other and both pay in full.
          occurredOn: "2026-08-31",
          durationMinutes: null,
          quality: 1,
        }),
        world.adminId,
        LAUNCHED_AT,
      );

      return hours;
    },
    expected: 3,
  },
  {
    rule: "a launch reads what its window has already spent",
    name: "inside its own day a launch is frozen last, so nothing there moves",
    run: (admin, world) => {
      const earlier = world.addApproved({
        activity: BOOK,
        occurredOn: THAT_DAY,
        hours: 3,
      });

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      return `${hours} · ${world.logRow(earlier).computedHours}`;
    },
    expected: "0.75 · 3",
  },
  {
    rule: "a launch reads what its window has already spent",
    name: "the preview says the reduced number before the tap",
    run: (admin, world) => {
      world.addApproved({
        activity: CAR,
        occurredOn: "2026-09-08",
        durationMinutes: null,
        quality: 1,
        hours: 3,
      });

      return admin.previewEntry(
        world.connection,
        entry(world, {
          activityId: world.activityId(CAR),
          occurredOn: "2026-09-07",
          durationMinutes: null,
          quality: 1,
        }),
        LAUNCHED_AT,
      ).calculation.hours;
    },
    expected: 1.5,
  },

  // --- D34: o resíduo aceito -----------------------------------------------
  {
    rule: "the residue D34 accepts: a frozen explanation ages, and stands",
    name: "the entry frozen first keeps its number",
    run: (admin, world) => {
      // Sunday took the return bonus because nothing of Mente had been done in
      // the three days before it. Thursday is launched afterwards and is
      // inside that window, so the sentence Sunday was frozen with — "faz mais
      // de 3 dias que você não faz Mente" — stops being true of the record.
      const sunday = world.addApproved({
        activity: BOOK,
        occurredOn: TODAY,
        durationMinutes: 240,
        hours: 5.63,
      });

      admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      // **Nothing about Sunday moves.** D15 forbids recomputing it, and this
      // case is here so that nobody "fixes" the stale sentence later by doing
      // exactly that: the number the boy was credited is the number he keeps.
      return world.logRow(sunday).computedHours;
    },
    expected: 5.63,
  },
  {
    rule: "the residue D34 accepts: a frozen explanation ages, and stands",
    name: "and the entry frozen second pays for the gap it closed",
    run: (admin, world) => {
      world.addApproved({
        activity: BOOK,
        occurredOn: TODAY,
        durationMinutes: 240,
        hours: 5.63,
      });

      const { hours } = admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      // 1h × 1,5, and no return bonus: Sunday spent the gap first. Under the
      // old rule this paid 2,25 h and the boy took the bonus twice for one gap.
      return hours;
    },
    expected: 1.5,
  },
  {
    rule: "the residue D34 accepts: a frozen explanation ages, and stands",
    name: "the ledger of the pair is what the two were frozen at",
    run: (admin, world) => {
      world.addApproved({
        activity: BOOK,
        occurredOn: TODAY,
        durationMinutes: 240,
        hours: 5.63,
      });

      admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );

      return world.ledgerText();
    },
    // `addApproved` writes no ledger row, so what is here is the launch's own.
    expected: `earn 1.5 on ${THAT_DAY} for log 2 by 1 to 3`,
  },

  // --- D10: um valor de zero não gera linha no ledger -----------------------
  {
    rule: "a value of zero is a record with no ledger line",
    name: "a delivery graded zero is launched and credits nothing",
    run: (admin, world) => {
      const result = admin.launchEntry(
        world.connection,
        entry(world, {
          activityId: world.activityId(CAR),
          durationMinutes: null,
          quality: 0,
        }),
        world.adminId,
        LAUNCHED_AT,
      );

      return `${result.hours} · ${result.creditedLedger} · ${world.ledgerText()}`;
    },
    expected: "0 · false · no ledger",
  },
  {
    rule: "a value of zero is a record with no ledger line",
    name: "six more minutes on a bucket twenty hours deep round to nothing",
    run: (admin, world) => {
      world.addApproved({
        activity: BOOK,
        occurredOn: THAT_DAY,
        durationMinutes: 1200,
      });

      const result = admin.launchEntry(
        world.connection,
        entry(world, { durationMinutes: 6 }),
        world.adminId,
        LAUNCHED_AT,
      );

      return `${result.hours} · ${result.creditedLedger} · ${world.ledgerText()}`;
    },
    expected: "0 · false · no ledger",
  },
  {
    rule: "a value of zero is a record with no ledger line",
    name: "the record itself exists, and says zero",
    run: (admin, world) => {
      const { logId } = admin.launchEntry(
        world.connection,
        entry(world, {
          activityId: world.activityId(CAR),
          durationMinutes: null,
          quality: 0,
        }),
        world.adminId,
        LAUNCHED_AT,
      );

      return world.entryText(logId);
    },
    expected: `approved admin · 0 h · null min · nota 0 · avulso null · ${CAR} · ${THAT_DAY} · by 1/1 · no note`,
  },

  // --- cada modo guarda o que é seu ----------------------------------------
  {
    rule: "each mode stores what belongs to it",
    name: "a fixed activity keeps no duration, whatever was sent",
    run: (admin, world) => {
      const { logId } = admin.launchEntry(
        world.connection,
        entry(world, {
          activityId: world.activityId(FRIENDS),
          durationMinutes: 60,
          quality: 1,
        }),
        world.adminId,
        LAUNCHED_AT,
      );

      return world.entryText(logId);
    },
    expected: `approved admin · 3 h · null min · nota null · avulso null · ${FRIENDS} · ${THAT_DAY} · by 1/1 · no note`,
  },
  {
    rule: "each mode stores what belongs to it",
    // D17 amended by #71: the row carries seconds as well as minutes, and an
    // adult typing an hour means an hour in both of them.
    name: "a typed duration is stored in seconds too, and only for duration",
    run: (admin, world) => {
      const timed = admin.launchEntry(
        world.connection,
        entry(world),
        world.adminId,
        LAUNCHED_AT,
      );
      const fixed = admin.launchEntry(
        world.connection,
        entry(world, {
          activityId: world.activityId(FRIENDS),
          durationMinutes: 60,
        }),
        world.adminId,
        LAUNCHED_AT,
      );

      return `${world.logRow(timed.logId).durationSeconds} · ${world.logRow(fixed.logId).durationSeconds}`;
    },
    expected: "3600 · null",
  },
  {
    rule: "each mode stores what belongs to it",
    name: "a free activity is worth what the adult typed (D11, D12)",
    run: (admin, world) => {
      const { logId } = admin.launchEntry(
        world.connection,
        entry(world, {
          activityId: world.activityId(FREE),
          durationMinutes: null,
          freeValue: 2.5,
        }),
        world.adminId,
        LAUNCHED_AT,
      );

      return world.entryText(logId);
    },
    // Curinga neither decays nor bonuses (D12), so the typed value is the value.
    expected: `approved admin · 2.5 h · null min · nota null · avulso 2.5 · ${FREE} · ${THAT_DAY} · by 1/1 · no note`,
  },
  {
    rule: "each mode stores what belongs to it",
    name: "a free activity with no value typed is refused",
    run: (admin, world) =>
      refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world, {
            activityId: world.activityId(FREE),
            durationMinutes: null,
          }),
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected:
      "refused: a free activity's value is a number of hours of 0.01 or more, received NaN",
  },
  {
    rule: "each mode stores what belongs to it",
    name: "a duration activity with no duration is refused",
    run: (admin, world) =>
      refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world, { durationMinutes: 0 }),
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected: `refused: ${BOOK} is measured by duration: a duration is a whole number of minutes, between 1 and 1000000; received 0`,
  },
  {
    rule: "each mode stores what belongs to it",
    // The refusal has to land on a *missing* duration too, and not only on a
    // number out of range. `launchEntry` writes `duration_seconds` under an
    // `entry.durationMinutes != null` guard (D17, #71), and that guard is only
    // unreachable for as long as this refusal happens first — weaken it and a
    // duration entry is filed with minutes and no seconds beside them.
    name: "a duration activity with the duration left out is refused too",
    run: (admin, world) =>
      refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world, { durationMinutes: null }),
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected: `refused: ${BOOK} is measured by duration: a duration is a whole number of minutes, between 1 and 1000000; received null`,
  },
  {
    rule: "each mode stores what belongs to it",
    name: "another activity is another rate",
    run: (admin, world) => {
      // Since #110 the seed prices comics at Mente's rate, so they are moved
      // off it here: the number has to say which activity paid.
      world.connection.sqlite
        .prepare("update activities set value = 1 where name = ?")
        .run(COMIC);
      const { hours } = admin.launchEntry(
        world.connection,
        entry(world, { activityId: world.activityId(COMIC) }),
        world.adminId,
        LAUNCHED_AT,
      );

      return hours;
    },
    expected: 1,
  },

  {
    rule: "each mode stores what belongs to it",
    name: "a free value is held to the two decimals an hour is held in",
    run: (admin, world) => {
      const { logId } = admin.launchEntry(
        world.connection,
        entry(world, {
          activityId: world.activityId(FREE),
          durationMinutes: null,
          freeValue: 2.567,
        }),
        world.adminId,
        LAUNCHED_AT,
      );

      return world.entryText(logId);
    },
    expected: `approved admin · 2.57 h · null min · nota null · avulso 2.57 · ${FREE} · ${THAT_DAY} · by 1/1 · no note`,
  },
  {
    rule: "each mode stores what belongs to it",
    name: "a grade the spec does not have is refused",
    run: (admin, world) =>
      refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world, {
            activityId: world.activityId(CAR),
            durationMinutes: null,
            quality: 3,
          }),
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected: `refused: ${CAR}: quality must be one of 0 · 0.3 · 0.5 · 0.7 · 1, received 3`,
  },

  // --- D33: item inativo é recusado pelo endpoint, não só escondido --------
  {
    rule: "an inactive item is refused by the endpoint",
    name: "a deactivated activity cannot be launched",
    run: (admin, world) => {
      world.setActivityActive(BOOK, false);

      return refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world),
          world.adminId,
          LAUNCHED_AT,
        ),
      ).replace(/activity \d+/, "activity N");
    },
    expected: "refused: activity N is not active and cannot be chosen (D14)",
  },
  {
    rule: "an inactive item is refused by the endpoint",
    name: "an activity under a deactivated category cannot be launched either",
    run: (admin, world) => {
      world.setCategoryActive("Mente", false);

      return refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world),
          world.adminId,
          LAUNCHED_AT,
        ),
      ).replace(/activity \d+/, "activity N");
    },
    expected: "refused: activity N is not active and cannot be chosen (D14)",
  },
  {
    rule: "an inactive item is refused by the endpoint",
    name: "an activity that does not exist is refused",
    run: (admin, world) =>
      refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world, { activityId: 9999 }),
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected: "refused: there is no activity 9999",
  },
  {
    rule: "an inactive item is refused by the endpoint",
    name: "a deactivated boy cannot be launched for",
    run: (admin, world) => {
      world.setUserActive(world.kidId, false);

      return refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world),
          world.adminId,
          LAUNCHED_AT,
        ),
      ).replace(/user \d+/, "user N");
    },
    expected: "refused: user N is not a boy this can be written for (D14, D33)",
  },
  {
    rule: "an inactive item is refused by the endpoint",
    name: "an adult is not somebody an entry can be launched for",
    run: (admin, world) =>
      refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world, { userId: world.adminId }),
          world.adminId,
          LAUNCHED_AT,
        ),
      ).replace(/user \d+/, "user N"),
    expected: "refused: user N is not a boy this can be written for (D14, D33)",
  },
  {
    rule: "an inactive item is refused by the endpoint",
    name: "the preview refuses a deactivated activity as well",
    run: (admin, world) => {
      world.setActivityActive(BOOK, false);

      return refused(() =>
        admin.previewEntry(world.connection, entry(world), LAUNCHED_AT),
      ).replace(/activity \d+/, "activity N");
    },
    expected: "refused: activity N is not active and cannot be chosen (D14)",
  },

  // --- a data que o adulto digitou -----------------------------------------
  {
    rule: "the date is a real day, and never after today",
    name: "tomorrow is refused",
    run: (admin, world) =>
      refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world, { occurredOn: "2026-09-14" }),
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected:
      "refused: 2026-09-14 has not happened yet: the date is today or earlier",
  },
  {
    rule: "the date is a real day, and never after today",
    name: "today is not",
    run: (admin, world) => {
      const { hours } = admin.launchEntry(
        world.connection,
        entry(world, { occurredOn: TODAY }),
        world.adminId,
        LAUNCHED_AT,
      );

      return hours;
    },
    expected: 1.5,
  },
  {
    rule: "the date is a real day, and never after today",
    name: "a day that is not on the calendar is refused",
    run: (admin, world) =>
      refused(() =>
        admin.launchEntry(
          world.connection,
          entry(world, { occurredOn: "2026-02-30" }),
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected:
      "refused: a date must be a real day in YYYY-MM-DD, received 2026-02-30",
  },

  // --- o preview mostra o valor e não escreve nada --------------------------
  {
    rule: "the preview says what it would pay and writes nothing",
    name: "it answers the same number the launch will",
    run: (admin, world) =>
      admin.previewEntry(world.connection, entry(world), LAUNCHED_AT)
        .calculation.hours,
    expected: 1.5,
  },
  {
    rule: "the preview says what it would pay and writes nothing",
    name: "and leaves no record and no ledger row behind",
    run: (admin, world) => {
      admin.previewEntry(world.connection, entry(world), LAUNCHED_AT);

      return `${world.pendingCount()} · ${world.ledgerText()} · ${world.balance(world.kidId)}`;
    },
    expected: "0 · no ledger · 0",
  },
  {
    rule: "the preview says what it would pay and writes nothing",
    name: "it carries the explanation, which is what makes the number checkable",
    run: (admin, world) =>
      admin
        .previewEntry(world.connection, entry(world), LAUNCHED_AT)
        .calculation.lines.map((line) => line.step)
        .join(" · "),
    expected: "base",
  },
];

/**
 * The cases `admin` gets wrong, each run against a world of its own.
 *
 * A fresh database per case, because these cases write: sharing one would make
 * the answer depend on the order the table happens to be in.
 */
export function failingAdminCases(
  admin: AdminModule,
  worlds: () => AdminWorld,
): AdminCase[] {
  return ADMIN_CASES.filter((adminCase) => {
    const world = worlds();

    try {
      return adminCase.run(admin, world) !== adminCase.expected;
    } catch (thrown) {
      return `threw: ${(thrown as Error).message}` !== adminCase.expected;
    } finally {
      world.connection.sqlite.close();
    }
  });
}
