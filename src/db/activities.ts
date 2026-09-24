import { asc, desc, eq } from "drizzle-orm";

import { DEFAULT_MIN_SESSION_MINUTES } from "../engine/timer";
import type { Connection, Transaction } from "./client";
import { writeTransaction } from "./client";
import { requireCount, requireNonNegativeHours, requireText } from "./input";
import { refuseWhileWaiting } from "./pending";
import { activities, categories } from "./schema";

/**
 * The activities, configured by hand (#27).
 *
 * The same three properties `src/db/categories.ts` opens with — used often, no
 * deploy, every number reaching the engine — and two of its own.
 *
 * **The value is always explicit, and it is what governs the calculation
 * (D11).** `base_rate` is a suggestion the Configuration screen offers when an
 * adult creates a `duration` activity, and it is nothing else: it is nullable,
 * three categories declare none at all, and the engine reads `activities.value`.
 * So this module never copies a category's rate into an activity and never
 * falls back to one — the screen fills the field in, an adult can change it,
 * and what is stored is what he left there. A default applied here instead of
 * on the screen would be a number nobody typed governing a boy's afternoon.
 *
 * **Changing the rate does not rewrite the past (D15).** As with the
 * categories, there is no recalculation in this file and there can be none:
 * `computed_hours` is frozen at approval and the ledger row was written beside
 * it. `activities.test.ts` proves it with a balance held across every edit the
 * form allows, and by reading this file's own source.
 *
 * **Renaming rewrites the label of every past extract line, and that is the
 * intended behaviour.** `history.ts` joins `activities.name` live, so an
 * activity renamed today changes what the boy's statement called it in March.
 * No number moves and D14 asks for exactly this — "item inativo … continua
 * legível no histórico" is a statement about reading the *current* row through
 * the foreign key. The alternative, stamping the name onto every log, is a
 * second copy of a label that then rots: a typo corrected today would leave
 * every old line spelling it wrong for ever, which is worse and is the thing
 * an adult would actually complain about. Declared here because it is the
 * boy's own past changing wording without warning, and that should be a
 * decision rather than an accident.
 *
 * **The guard is here and not in the picker (D33).** An activity is created and
 * moved only under a category that is switched on, and switching an activity
 * back on requires the same. The `<select>` on the screen offers only live
 * categories; the endpoint is a POST that takes a number, and this project has
 * measured twice what the difference is worth.
 */

/** An activity as the Configuration screen draws it (#27). */
export type ActivityRow = {
  id: number;
  categoryId: number;
  name: string;
  calcMode: "duration" | "fixed" | "delivery" | "free";
  /** Null only for `free`, where the adult types the value at launch time. */
  value: number | null;
  /** D16: where the boy's stopwatch stops itself. Only for `duration`. */
  maxSessionMinutes: number | null;
  /** D44: a shorter timed session is not filed. */
  minSessionMinutes: number;
  qualityGraded: boolean;
  repeatCooldownDays: number;
  sortOrder: number;
  active: boolean;
};

/** What an adult typed into the activity form (#27). */
export type ActivityInput = {
  categoryId: number;
  name: string;
  calcMode: ActivityRow["calcMode"];
  /** D11: explicit, always, and null only for `free`. */
  value: number | null;
  maxSessionMinutes: number | null;
  minSessionMinutes: number;
  qualityGraded: boolean;
  repeatCooldownDays: number;
  sortOrder: number;
};

type Db = Connection["db"] | Transaction;

/** The four modes, so a raw POST cannot invent a fifth. */
const CALC_MODES: readonly ActivityRow["calcMode"][] = [
  "duration",
  "fixed",
  "delivery",
  "free",
];

/**
 * One category's activities, switched on first, then in the picker's order.
 *
 * Switched-off ones stay in the list (D14) for the reason `listCategories`
 * gives: an activity is deactivated and never deleted, and an adult who wants
 * last month's activity back has to be able to read it and switch it on.
 */
export function listActivities(
  connection: Connection,
  categoryId: number,
): ActivityRow[] {
  return connection.db
    .select({
      id: activities.id,
      categoryId: activities.categoryId,
      name: activities.name,
      calcMode: activities.calcMode,
      value: activities.value,
      maxSessionMinutes: activities.maxSessionMinutes,
      minSessionMinutes: activities.minSessionMinutes,
      qualityGraded: activities.qualityGraded,
      repeatCooldownDays: activities.repeatCooldownDays,
      sortOrder: activities.sortOrder,
      active: activities.active,
    })
    .from(activities)
    .where(eq(activities.categoryId, categoryId))
    .orderBy(
      desc(activities.active),
      asc(activities.sortOrder),
      asc(activities.id),
    )
    .all();
}

/**
 * The whole of an activity, checked before anything is stored.
 *
 * Each rule is also a CHECK on its column, and the CHECK is the backstop; this
 * is the same rule said where it can name the field and an acceptable value.
 * `activities.test.ts` asserts the sentences and not merely the refusals,
 * because a case that only asked "was it refused" passes with every guard here
 * deleted — the constraints refuse it too, with a name that helps nobody.
 */
function requireActivity(input: ActivityInput): ActivityInput {
  const name = input.name.trim();

  requireText(name, "an activity name");

  if (name === "") {
    throw new Error("an activity needs a name: it is what the pickers show");
  }

  if (!CALC_MODES.includes(input.calcMode)) {
    throw new Error(
      `${input.calcMode} is not a way of counting: it is one of ${CALC_MODES.join(", ")}`,
    );
  }

  // D11: `free` is the one mode with no stored value, because the adult types
  // it at launch time (D12's Curinga). Every other mode reads `value`, and a
  // missing one there is a silent zero in a boy's balance.
  if (input.calcMode === "free") {
    if (input.value !== null) {
      throw new Error(
        "a free activity has no value of its own: the adult types it when he launches it (D11, D12)",
      );
    }
  } else if (input.value === null) {
    throw new Error(
      `a ${input.calcMode} activity needs a value: it is what the engine reads, and it is never taken from the category (D11)`,
    );
  }

  // D16: the limit is only meaningful where there is a session to limit, and
  // the stopwatch reads it live. Stored as null for every other mode rather
  // than refused — the same discipline `launchEntry` keeps with a duration a
  // `fixed` activity was sent — so a mode changed from `duration` to `fixed`
  // does not leave a limit behind for nothing to read.
  const maxSessionMinutes =
    input.calcMode === "duration" && input.maxSessionMinutes !== null
      ? requireCount(input.maxSessionMinutes, "a session limit", { min: 1 })
      : null;
  // D44: only a timed session has a floor; every other mode keeps the default.
  const minSessionMinutes =
    input.calcMode === "duration"
      ? requireCount(input.minSessionMinutes, "a minimum session", { min: 1 })
      : DEFAULT_MIN_SESSION_MINUTES;

  // A limit under the floor would file nothing the limit ever cuts.
  if (maxSessionMinutes !== null && minSessionMinutes > maxSessionMinutes) {
    throw new Error(
      `a minimum session of ${minSessionMinutes} minutes is longer than the session limit of ${maxSessionMinutes} (D44)`,
    );
  }

  return {
    categoryId: input.categoryId,
    name,
    calcMode: input.calcMode,
    value:
      input.value === null
        ? null
        : requireNonNegativeHours(input.value, "an activity value"),
    maxSessionMinutes,
    minSessionMinutes,
    qualityGraded: input.qualityGraded,
    repeatCooldownDays: requireCount(
      input.repeatCooldownDays,
      "a repeat cooldown",
    ),
    sortOrder: requireCount(input.sortOrder, "a sort order"),
  };
}

/**
 * The category an activity is being put under, which has to be switched on
 * (D33).
 *
 * An activity under a switched-off category is invisible everywhere — every
 * picker joins through `categories.active` and D33 makes the endpoints refuse
 * it — so creating one there, or moving one there, produces a row that can
 * never be used and that no screen explains. Switching a category off is how an
 * adult retires everything under it, and it is reversible; this is not that.
 */
function requireLiveCategory(db: Db, categoryId: number): void {
  const found = db
    .select({ active: categories.active, name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get();

  if (found === undefined) {
    throw new Error(`there is no category ${categoryId}`);
  }

  if (!found.active) {
    throw new Error(
      `${found.name} is switched off: an activity under it would be in no picker at all (D14, D33)`,
    );
  }
}

/** The activity being changed, which has to exist. */
function requireActivityRow(db: Db, activityId: number) {
  const found = db
    .select({
      id: activities.id,
      name: activities.name,
      categoryId: activities.categoryId,
      calcMode: activities.calcMode,
      value: activities.value,
      qualityGraded: activities.qualityGraded,
      repeatCooldownDays: activities.repeatCooldownDays,
    })
    .from(activities)
    .where(eq(activities.id, activityId))
    .get();

  if (found === undefined) {
    throw new Error(`there is no activity ${activityId}`);
  }

  return found;
}

/** Creates an activity under a live category (#27). It is born switched on. */
export function createActivity(
  connection: Connection,
  input: ActivityInput,
): number {
  const checked = requireActivity(input);

  return writeTransaction(connection, (tx) => {
    requireLiveCategory(tx, checked.categoryId);

    return tx
      .insert(activities)
      .values({
        categoryId: checked.categoryId,
        name: checked.name,
        calcMode: checked.calcMode,
        value: checked.value,
        maxSessionMinutes: checked.maxSessionMinutes,
        minSessionMinutes: checked.minSessionMinutes,
        qualityGraded: checked.qualityGraded,
        repeatCooldownDays: checked.repeatCooldownDays,
        sortOrder: checked.sortOrder,
        active: true,
      })
      .returning({ id: activities.id })
      .get().id;
  });
}

/**
 * Corrects what an activity says (#27).
 *
 * **Nothing already credited moves (D15).** No log is read and none is written:
 * a rate corrected today governs tomorrow's entries, and every `computed_hours`
 * in the table stays where it was frozen. That is what makes the field safe to
 * use as often as the first months need.
 *
 * The category is among the fields, so an activity can be moved — and the
 * destination has to be switched on, exactly as it does on a create. Every log
 * ever written against the activity keeps pointing at the activity, so its
 * history follows it.
 *
 * **What a move reaches, beyond the next entry.** The bucket a calculation
 * reads is resolved through a live join to this table (`calculationFor` in
 * `queue.ts`, `historyFor` in `admin.ts`), so moving an activity does not only
 * decide where its *future* entries land: every already-approved log of it is
 * read under the new category from then on, for the purposes of every entry
 * priced afterwards. Changing `calc_mode` away from `duration` takes its past
 * logs out of the daily bucket entirely, for the same reason.
 *
 * That is not D15 being broken — no credited number moves, and
 * `activities.test.ts` holds a balance and a frozen value across every edit
 * this form allows. It is the other half of D15's sentence, "vale só para
 * lançamentos futuros", being wider than it looks: the *history* those future
 * entries read is re-interpreted too. It is declared rather than prevented,
 * because the alternative is to freeze a category into an activity forever and
 * make a miscategorised one unfixable — and because pinning the join would be
 * a second copy of the bucket rule (D3) living in this table.
 */
export function updateActivity(
  connection: Connection,
  activityId: number,
  input: ActivityInput,
): void {
  const checked = requireActivity(input);

  writeTransaction(connection, (tx) => {
    const found = requireActivityRow(tx, activityId);
    requireLiveCategory(tx, checked.categoryId);

    // D37: an entry that is already waiting is priced from this table when it
    // is approved, so a field that changes its price cannot move underneath it.
    // Only those fields; a rename or a reordering is free.
    const repriced =
      checked.calcMode !== found.calcMode ||
      checked.value !== found.value ||
      checked.qualityGraded !== found.qualityGraded ||
      checked.repeatCooldownDays !== found.repeatCooldownDays ||
      checked.categoryId !== found.categoryId;

    if (repriced) {
      refuseWhileWaiting(tx, [activityId], `${found.name}`);
    }

    // There is deliberately **no** second refusal for the categories a move
    // travels between. There was one, and it protected nothing: it was written
    // when the bucket was resolved through a live join, and the frozen
    // `category_id` of D37's second half had already made it dead. Measured
    // with the guard bypassed, on a pending entry of Ler livro with an hour of
    // HQ approved the same day: moving another activity *into* Mente, and
    // moving Ler quadrinhos *out* of it, both left the pending entry at
    // 1,00 h → 1,00 h. It could not move, because a pending entry reads the
    // fields of its own activity (covered above), of its own category (covered
    // in `updateCategory`) and a history that is stamped.
    //
    // And it was the most expensive control on the screen: a census of every
    // legal (activity, destination) pair refused **96 of 192** moves with one
    // pending entry per boy. Recategorising a miscategorised activity is the
    // operation this phase exists to make possible without a deploy, and it was
    // half unavailable on any afternoon both boys had registered something —
    // to protect a number that cannot move.

    tx.update(activities)
      .set({
        categoryId: checked.categoryId,
        name: checked.name,
        calcMode: checked.calcMode,
        value: checked.value,
        maxSessionMinutes: checked.maxSessionMinutes,
        minSessionMinutes: checked.minSessionMinutes,
        qualityGraded: checked.qualityGraded,
        repeatCooldownDays: checked.repeatCooldownDays,
        sortOrder: checked.sortOrder,
      })
      .where(eq(activities.id, activityId))
      .run();
  });
}

/**
 * Switches an activity on or off (#27, D14).
 *
 * Off is a column and not a deletion. It leaves every picker and is refused by
 * the endpoints (D33); every entry ever written against it stays readable and
 * frozen.
 *
 * Switching one back on requires its category to be switched on, for the reason
 * `requireLiveCategory` gives — otherwise the tap reports success and the
 * activity is still in no picker, which is the one outcome worse than a
 * refusal.
 */
export function setActivityActive(
  connection: Connection,
  activityId: number,
  active: boolean,
): void {
  writeTransaction(connection, (tx) => {
    const found = requireActivityRow(tx, activityId);

    if (active) {
      requireLiveCategory(tx, found.categoryId);
    }

    // D33 refuses to approve an entry whose activity is switched off, so
    // switching one off with an entry waiting strands that entry: the adult can
    // only move it or refuse it, and the boy loses a session he really did. The
    // same sentence D37 uses everywhere else — decide it first.
    if (!active) {
      refuseWhileWaiting(tx, [activityId], `${found.name}`);
    }

    tx.update(activities)
      .set({ active })
      .where(eq(activities.id, activityId))
      .run();
  });
}
