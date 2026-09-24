import { and, asc, eq, inArray } from "drizzle-orm";

import type { Connection, Transaction } from "./client";
import { activities, activityLogs, timers } from "./schema";

/**
 * The rule that keeps a waiting entry priced by the table it was written under
 * (D37).
 *
 * **Why this exists rather than a copy of the configuration on every log.** An
 * entry is frozen at approval, and until then its value is computed from the
 * live configuration. So an edit made while an entry waits changes what that
 * entry will be worth — measured on the seeded database, with nothing forged
 * and nothing about the entry touched:
 *
 * | edit made with a pending entry in the queue | it paid |
 * |---|---|
 * | nothing (baseline, one hour of "Ler livro") | 3,00 h |
 * | `value` 2 → 10 | **15,00 h** |
 * | `return_bonus_pct` 0,5 → 5 | **12,00 h** |
 * | `value` 2 → 180, on a one-minute session | **4,50 h** |
 * | four ordinary 1h sessions parked, then `value` 2 → 3 | 9,00 h → **13,50 h** |
 *
 * The boy holds both ends of the last one without touching anything: he does
 * not ask for approval, and he asks for a raise.
 *
 * **The alternative was to stamp the price onto the entry when it is created**,
 * and it was rejected for two measured reasons. The first is that the recovery
 * path it assumes does not exist: `LogEdits` is `{activityId, durationMinutes,
 * note}`, so there is **no way to correct a value at approval**. An adult who
 * typed 20 instead of 2 with ten sessions waiting could then only reject all
 * ten or move them onto some other activity that happens to be priced right —
 * the boy losing ten real afternoons to the adult's typo. The second is that
 * stamping needs eight columns of configuration copied onto `activity_logs`
 * (`value`, `calc_mode`, `quality_graded`, `repeat_cooldown_days`,
 * `category_id`, `decay_step_hours`, `return_bonus_pct`,
 * `return_bonus_after_days`) — a second copy of the table that this project has
 * repeatedly watched rot.
 *
 * Refusing the edit reaches the same guarantee by making its premise true: if
 * the configuration cannot change while an entry waits, then the entry *is*
 * priced by the configuration it was written under. One query, no duplication.
 *
 * **And it is this project's own answer to this exact failure.** D32 measured
 * "2×1h de Ler livro no mesmo dia pagavam 6h em vez de 4h" and chose to refuse
 * the operation and name the entry in the way, rather than to declare the
 * consequence. Same shape, same answer, same sentence.
 *
 * What is *not* refused is everything that cannot change a price: a name, a
 * sort order, a `base_rate` (D11 keeps it out of the calculation), and a
 * session limit — a waiting entry's minutes are already on the row.
 *
 * **The line is `startTimer`, not `stopTimer`.** An earlier version of this
 * module looked only at rows with `status = 'pending'`, which meant the rule
 * began when the boy stopped the clock. Everything above was still reachable
 * one step earlier, with the session merely *open*, and the numbers were worse
 * than the ones this file was written about — measured on 120 minutes of "Ler
 * livro" in a category whose calibrated asymptote is 4,00 h:
 *
 * | done with the stopwatch running | the session paid |
 * |---|---|
 * | nothing | 4,50 h |
 * | `value` 2 → 3 | **6,75 h** |
 * | `value` 10, step 8, bonus 500% — three fields, one screen | **120,00 h** |
 * | `value` 1e6, on a **30-minute** session | **750.000,00 h** |
 *
 * And there is no proration: raising the rate in minute 119 of 120 pays all two
 * hours at the new rate, so it is not "from now on", it is retroactive to
 * `started_at`. A whole day of ordinary sessions with one "double the rate" per
 * session went from 24,15 h to **48,29 h**.
 *
 * Worse, it made the price depend on **when somebody opened the app**. The
 * reconciliation is lazy (D16), so a session that hit its limit at 11:00 has no
 * row until someone reads it: the same session, same stamps, same edit at
 * 15:00, paid 4,50 h if anybody opened the app at 11:30 and **6,75 h** if
 * nobody did. That is the sentence D16 forbids in so many words, and the one
 * D38 quoted two decisions ago to justify stamping the session limit. D38
 * already knew the answer.
 *
 * So the honest line is not "a row exists" but "there is activity time already
 * committed to a stamp", and that begins at `startTimer`: `started_at` and
 * `accumulated_seconds` are stamps, and the boy has already done the reading.
 * One clause in the `where` below, and the same sentence.
 */

type Db = Connection["db"] | Transaction;

/**
 * Something already under way that the edit would reprice, named the way a
 * refusal has to name it.
 *
 * Either a filed entry waiting in the queue or a stopwatch session still open
 * on the activity. The two are the same fact — time the boy has already spent,
 * priced by a table that has not finished being read — and the screen says so
 * in the same sentence.
 */
export type WaitingEntry = {
  /** The log id, or null while the session is still open. */
  id: number | null;
  activityName: string;
  /** D13: `YYYY-MM-DD`, or null for a session that has not been filed. */
  occurredOn: string | null;
  kind: "queued" | "running";
};

/**
 * The oldest entry still waiting on any of `activityIds`, or undefined.
 *
 * Oldest first, in the canonical order of D8, so the sentence names the entry
 * an adult would decide first anyway — the same one the queue puts at the top.
 */
export function waitingOn(
  db: Db,
  activityIds: readonly number[],
): WaitingEntry | undefined {
  if (activityIds.length === 0) return undefined;

  const queued = db
    .select({
      id: activityLogs.id,
      activityName: activities.name,
      occurredOn: activityLogs.occurredOn,
    })
    .from(activityLogs)
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .where(
      and(
        eq(activityLogs.status, "pending"),
        inArray(activityLogs.activityId, [...activityIds]),
      ),
    )
    .orderBy(
      asc(activityLogs.occurredOn),
      asc(activityLogs.createdAt),
      asc(activityLogs.id),
    )
    .get();

  if (queued !== undefined) {
    return { ...queued, kind: "queued" };
  }

  // A session still on the clock. `running` and `paused` are the open states —
  // `stopped` has already produced its row and is covered above, and
  // `abandoned` produces none at all (D16), so neither can be repriced.
  //
  // A session that hit its limit hours ago is still `running` here, because
  // nothing settles it until somebody reads it. That is deliberate: it is
  // exactly the case where the price used to depend on who opened the app.
  const open = db
    .select({ id: timers.id, activityName: activities.name })
    .from(timers)
    .innerJoin(activities, eq(timers.activityId, activities.id))
    .where(
      and(
        inArray(timers.status, ["running", "paused"]),
        inArray(timers.activityId, [...activityIds]),
      ),
    )
    .orderBy(asc(timers.startedAt), asc(timers.id))
    .get();

  return open === undefined
    ? undefined
    : {
        id: null,
        activityName: open.activityName,
        occurredOn: null,
        kind: "running",
      };
}

/**
 * What is under way right now, per activity and per category (#26, #27).
 *
 * The screen half of this module, and the reason it exists at all: without it
 * the refusal reaches the adult as a failed save and a sentence about numbers
 * that are not wrong. The floors of D35 and D36 are pure predicates the screen
 * can evaluate itself; this one is a question about rows, so the answer has to
 * be fetched — and it is fetched once, with the list, rather than guessed.
 */
export type Locks = {
  /** Activity ids whose price-bearing fields cannot move right now. */
  activityIds: number[];
  /** Category ids whose decay and bonus cannot move right now. */
  categoryIds: number[];
  /** How many entries are waiting in the queue, for the sentence. */
  queued: number;
  /** How many stopwatch sessions are open, for the sentence. */
  running: number;
};

/** Everything currently under way, in one query pair. */
export function currentLocks(connection: Connection): Locks {
  const db = connection.db;

  const waiting = db
    .select({
      activityId: activityLogs.activityId,
      categoryId: activities.categoryId,
    })
    .from(activityLogs)
    .innerJoin(activities, eq(activityLogs.activityId, activities.id))
    .where(eq(activityLogs.status, "pending"))
    .all();

  const open = db
    .select({
      activityId: timers.activityId,
      categoryId: activities.categoryId,
    })
    .from(timers)
    .innerJoin(activities, eq(timers.activityId, activities.id))
    .where(inArray(timers.status, ["running", "paused"]))
    .all();

  return {
    activityIds: [
      ...new Set([...waiting, ...open].map((row) => row.activityId)),
    ],
    categoryIds: [
      ...new Set([...waiting, ...open].map((row) => row.categoryId)),
    ],
    queued: waiting.length,
    running: open.length,
  };
}

/** Every activity of a category, whether or not it is switched on. */
export function activityIdsOf(db: Db, categoryId: number): number[] {
  return db
    .select({ id: activities.id })
    .from(activities)
    .where(eq(activities.categoryId, categoryId))
    .all()
    .map((row) => row.id);
}

/**
 * Refuses an edit that would change what a waiting entry is worth (D37).
 *
 * The sentence names the entry and says what to do, exactly as D32's does —
 * because the thing to do is the same thing: decide it, then edit.
 */
export function refuseWhileWaiting(
  db: Db,
  activityIds: readonly number[],
  what: string,
): void {
  const waiting = waitingOn(db, activityIds);

  if (waiting === undefined) return;

  throw new Error(refusalText(what, waiting));
}

/**
 * The refusal, in the language the adult reads it in.
 *
 * pt-BR and not English, which is the exception this module makes to the rule
 * that identifiers and messages are in English: `CLAUDE.md` says the interface
 * is pt-BR, and this sentence **reaches the interface**. The screen shows it
 * before the tap, from the same data, and the endpoint throws it — so it is one
 * sentence and not two, and it cannot be one sentence in the guard and another
 * on the screen.
 */
export function refusalText(what: string, waiting: WaitingEntry): string {
  const about =
    waiting.kind === "running"
      ? `${waiting.activityName} está com o cronômetro aberto`
      : `a entrada ${waiting.id} (${waiting.activityName}, ${waiting.occurredOn}) está esperando na fila`;

  return `${what}: não dá para mudar taxa, modo, nota, cooldown ou categoria agora, porque ${about} e seria paga pelo valor novo. Decida essa primeiro.`;
}
