import type { Activity, ActivityLog, Category } from "../db/schema";
import { daysBetween, parseDate, shiftDate } from "./day";
import {
  add,
  bandIndex,
  compare,
  decayedHours,
  divide,
  type Fraction,
  fraction,
  fromNumber,
  isPositive,
  multiply,
  ONE,
  subtract,
  toCents,
} from "./exact";

/**
 * Re-exported so existing callers keep working; they live in `./day` so the
 * stopwatch skips the engine.
 */
export { daysBetween, saoPauloDay, shiftDate } from "./day";

/**
 * The calculation engine: pure, one copy shared by the boy's calculator and the
 * admin's entry, applying D7's order over what was frozen before this entry
 * (D34).
 */

/*
 * Safe to import from a `"use client"` component: the schema import is
 * `import type`, and `./day` and `./exact` are pure arithmetic.
 */

const MINUTES_PER_HOUR = 60;

/**
 * Same ceiling as `activity_logs_computed_hours_check`, refused here so the
 * queue shows a reason instead of a failing approval.
 */
const MAX_ENTRY_HOURS = 1_000_000;

/** The five grades the spec allows, and the same five the schema's CHECK holds. */
const QUALITY_GRADES = [0, 0.3, 0.5, 0.7, 1];

const COOLDOWN_MULTIPLIER: Fraction = { n: 1n, d: 2n };

/**
 * Past this, the rest of the decay folds into one line: a tiny step would
 * otherwise print thousands.
 */
const MAX_DECAY_LINES = 8;

/** Never "nada": the decay has no floor to announce (D2). */
const DEEP_DECAY_TEXT = "cada vez menos";

export type CalcMode = Activity["calcMode"];

/**
 * `Pick` on the schema row so a column that changes shape breaks this file at
 * compile time.
 */
export type EngineActivity = Pick<
  Activity,
  | "id"
  | "categoryId"
  | "name"
  | "calcMode"
  | "value"
  | "qualityGraded"
  | "repeatCooldownDays"
>;

export type EngineCategory = Pick<
  Category,
  "id" | "name" | "decayStepHours" | "returnBonusPct" | "returnBonusAfterDays"
>;

/**
 * `userId` and `status` are required so a query missing either filter fails to
 * compile. `categoryId` is frozen on the log (D37). No `calcMode`: the hours
 * are the row's `duration_minutes` (D5); a live mode could change under it.
 */
export type ApprovedLog = Pick<
  ActivityLog,
  | "id"
  | "userId"
  | "occurredOn"
  | "activityId"
  | "durationMinutes"
  | "createdAt"
> & {
  status: Extract<ActivityLog["status"], "approved">;
  categoryId: number;
};

/**
 * The only place D19's status rule is written; every boundary that builds an
 * `ApprovedLog[]` goes through it. Throws rather than filters, so a query
 * missing its `where` fails loudly instead of matching a correct one.
 */
export function approvedOnly<
  T extends { id: number; status: string; categoryId: number | null },
>(rows: readonly T[]): (T & { status: "approved"; categoryId: number })[] {
  for (const row of rows) {
    if (row.status !== "approved") {
      throw new Error(
        `log ${row.id} has status ${row.status}; only approved logs may reach a calculation (D19)`,
      );
    }

    // D37: asserted, not defaulted — a null would silently empty a bucket.
    if (row.categoryId === null) {
      throw new Error(
        `log ${row.id} is approved with no category; its bucket was never frozen (D37)`,
      );
    }
  }

  return rows as (T & { status: "approved"; categoryId: number })[];
}

/**
 * D8's canonical position. No longer used by the arithmetic (D34); only D32
 * reads it.
 */
export type CanonicalPosition = { createdAt: Date; id: number } | "new";

export type CalculationInput = {
  userId: number;
  activity: EngineActivity;
  category: EngineCategory;
  /** D13: `YYYY-MM-DD` in `America/Sao_Paulo`. Never a timestamp. */
  occurredOn: string;
  /** Required by `duration`; ignored by every other mode. */
  durationMinutes?: number | null;
  /** Required when the activity is `quality_graded`: 0 · 0,3 · 0,5 · 0,7 · 1,0. */
  quality?: number | null;
  /** Required by `free`: the value the admin typed. */
  freeValue?: number | null;
  /**
   * The approved logs frozen **before this entry** (D34), covering at least
   * `[historyFrom, historyTo]`. All of them count; excluding later-frozen ones
   * is the caller's job.
   */
  history: ApprovedLog[];
  /**
   * Declared, not assumed: a short window silently over-credits, so the engine
   * refuses it.
   */
  historyFrom: string;
  /**
   * Declared for the same reason: under D34 a retroactive entry reads later
   * days too.
   */
  historyTo: string;
  /**
   * The earliest `occurred_on` among this user's logs of this category frozen
   * before this entry (D34), over all time, or null. D47: no earlier entry, no
   * return.
   */
  categoryFirstDay: string | null;
};

/**
 * Addends, not a running total: signed, and they sum to `Calculation.hours`
 * exactly (D9).
 */
export type ExplanationLine = {
  step: "base" | "quality" | "cooldown" | "decay" | "bonus";
  /** pt-BR, written to be read by a teenager. */
  text: string;
  /** Signed hours, already rounded to 2 decimals. */
  hours: number;
};

export type Calculation = {
  /**
   * D9: rounded once. Can be 0 on an approved log, which then gets no ledger
   * row: `ledger_hours_check` is `> 0` (D10).
   */
  hours: number;
  lines: ExplanationLine[];
};

/**
 * Zero still means "fetch the day itself": the daily bucket (D3) lives there.
 */
export function historyLookbackDays(
  activity: Pick<EngineActivity, "repeatCooldownDays">,
  category: Pick<EngineCategory, "returnBonusPct" | "returnBonusAfterDays">,
): number {
  const cooldown =
    activity.repeatCooldownDays > 0 ? activity.repeatCooldownDays : 0;
  const bonus = category.returnBonusPct > 0 ? category.returnBonusAfterDays : 0;

  return Math.max(cooldown, bonus);
}

export function historyWindowStart(
  occurredOn: string,
  activity: Pick<EngineActivity, "repeatCooldownDays">,
  category: Pick<EngineCategory, "returnBonusPct" | "returnBonusAfterDays">,
): string {
  return shiftDate(occurredOn, -historyLookbackDays(activity, category));
}

/**
 * The first day of the return bonus's window (D6). An entry of the category
 * before it is what makes this one a return (D47).
 */
export function returnBonusWindowStart(
  occurredOn: string,
  category: Pick<EngineCategory, "returnBonusAfterDays">,
): string {
  return shiftDate(occurredOn, -category.returnBonusAfterDays);
}

/**
 * Not zero because of D34: a retroactive entry reads what later days already
 * spent.
 */
export function historyWindowEnd(
  occurredOn: string,
  activity: Pick<EngineActivity, "repeatCooldownDays">,
  category: Pick<EngineCategory, "returnBonusPct" | "returnBonusAfterDays">,
): string {
  return shiftDate(occurredOn, historyLookbackDays(activity, category));
}

export function calculateEarnedHours(input: CalculationInput): Calculation {
  const { activity, category, occurredOn } = input;

  assertOwnHistory(input);
  requireHistoryWindow(input);

  // D34: the caller handed over exactly what was frozen before this entry.
  const counted = input.history;

  const drafts: DraftLine[] = [];

  const durationMinutes =
    activity.calcMode === "duration" ? requireDurationMinutes(input) : 0;
  const exactActivityHours = exactHours(durationMinutes);

  let value: Fraction;
  let baseText: string;

  switch (activity.calcMode) {
    case "duration": {
      const rate = requireValue(activity);
      value = multiply(exactActivityHours, fromNumber(rate));
      baseText = `${activity.name}, ${durationText(durationMinutes)} × ${formatRate(rate)}`;
      break;
    }
    case "fixed":
    // `delivery`'s grade is step 2; applying it here too would square it.
    case "delivery": {
      value = fromNumber(requireValue(activity));
      baseText = activity.name;
      break;
    }
    case "free": {
      value = fromNumber(requireFreeValue(input));
      baseText = activity.name;
      break;
    }
  }

  // D3 bucket, D5 membership. Summed in whole minutes: six 20-minute logs
  // summed as hours give 1,9999…, and the base line would say "cheio" two
  // halvings deep.
  const bucketMinutes = counted
    .filter(
      (log) =>
        log.occurredOn === occurredOn &&
        log.categoryId === category.id &&
        log.durationMinutes !== null,
    )
    .reduce((sum, log) => sum + (log.durationMinutes ?? 0), 0);
  const bucketHours = bucketMinutes / MINUTES_PER_HOUR;
  const exactBucketHours = exactHours(bucketMinutes);

  const step = requireDecayStep(category);
  const exactStep = step === null ? null : fromNumber(step);
  // D2/D5/D12: a null step or a mode without duration means no decay.
  const decays =
    exactStep !== null &&
    activity.calcMode === "duration" &&
    isPositive(exactActivityHours);

  // Base line: where this entry starts. Decay lines: the rule.
  const startsFull =
    exactStep !== null && bandIndex(exactBucketHours, exactStep) === 0n;
  const bucketNote = !decays
    ? ""
    : startsFull
      ? " — cheio"
      : ` — você já fez ${formatHours(bucketHours)} de ${category.name} hoje`;

  drafts.push({ step: "base", text: `${baseText}${bucketNote}`, total: value });

  if (activity.qualityGraded) {
    const quality = requireQuality(input);
    const next = multiply(value, fromNumber(quality));
    drafts.push({
      step: "quality",
      text: `nota ${formatGrade(quality)}`,
      total: next,
    });
    value = next;
  }

  const cooldownDays = activity.repeatCooldownDays;
  // Zero is "no cooldown", not "a window of today" (D6, Fase 1 amendment).
  const cooldownApplies =
    cooldownDays > 0 &&
    counted.some(
      (log) =>
        log.activityId === activity.id &&
        // D6 window, made two-sided by D34.
        log.occurredOn >= shiftDate(occurredOn, -cooldownDays) &&
        log.occurredOn <= shiftDate(occurredOn, cooldownDays),
    );

  if (cooldownApplies) {
    const next = multiply(value, COOLDOWN_MULTIPLIER);
    drafts.push({
      step: "cooldown",
      // Direction-neutral: under D34 the other one can be on a later day.
      text: `metade, você fez isso outra vez em ${plural(cooldownDays)}`,
      total: next,
    });
    value = next;
  }

  // `exactStep !== null` is implied by `decays`; written out for the narrowing.
  if (exactStep !== null && step !== null && decays) {
    // The decay factor depends only on the bucket, so a session crossing a band
    // is split by its hours.
    const perActivityHour = divide(value, exactActivityHours);
    const end = add(exactBucketHours, exactActivityHours);
    // Walked, not listed: exact `2^-i` never underflows, so only the fold
    // bounds the loop.
    let emitted = 0;
    let foldedFrom: number | null = null;
    let index = bandIndex(exactBucketHours, exactStep);
    let bandStart = exactBucketHours;

    while (compare(bandStart, end) < 0) {
      const boundary = multiply(exactStep, fraction(index + 1n, 1n));
      const bandEnd = compare(boundary, end) < 0 ? boundary : end;
      const hasNext = compare(bandEnd, end) < 0;

      if (index !== 0n) {
        const reached = subtract(bandEnd, exactBucketHours);
        const pending = subtract(end, bandEnd);

        value = multiply(
          add(decayedHours(exactBucketHours, reached, exactStep), pending),
          perActivityHour,
        );

        emitted += 1;

        if (emitted === MAX_DECAY_LINES && hasNext) {
          // The band's own bound, as the lines above print it; the fold never
          // lands on the first band.
          foldedFrom = bandBound(index, step);
          break;
        }

        drafts.push({
          step: "decay",
          text: `${fractionText(index)}, ${bandText(index, step)} de ${category.name} no dia`,
          total: value,
        });
      }

      bandStart = bandEnd;
      index += 1n;
    }

    // The closed form, so the bands past the fold cost nothing.
    value = multiply(
      decayedHours(exactBucketHours, exactActivityHours, exactStep),
      perActivityHour,
    );

    if (foldedFrom !== null) {
      drafts.push({
        step: "decay",
        text: `${DEEP_DECAY_TEXT}, depois de ${formatHours(foldedFrom)} de ${category.name} no dia`,
        total: value,
      });
    }
  }

  const bonusPct = category.returnBonusPct;
  // Any calc mode counts as doing the category, even one that books no hours.
  const categoryLogs = counted.filter((log) => log.categoryId === category.id);
  const bonusWindowStart = returnBonusWindowStart(occurredOn, category);
  // Two-sided (D34): a later entry frozen first has already spent the gap.
  const bonusWindowEnd = shiftDate(occurredOn, category.returnBonusAfterDays);
  const bonusApplies =
    bonusPct > 0 &&
    input.categoryFirstDay !== null &&
    input.categoryFirstDay < bonusWindowStart &&
    !categoryLogs.some(
      (log) =>
        log.occurredOn >= bonusWindowStart && log.occurredOn <= bonusWindowEnd,
    );

  if (bonusApplies) {
    const next = multiply(value, returnBonusMultiplier(bonusPct));
    drafts.push({
      step: "bonus",
      text: `+${formatNumber(bonusPct * 100)}%, ${awayText(categoryLogs, occurredOn, category.returnBonusAfterDays, input.historyFrom)} que você não faz ${category.name}`,
      total: next,
    });
    value = next;
  }

  return roundOnce(drafts);
}

/**
 * `return_bonus_pct` is a fraction — 0,5 is +50% — matching the seed and the
 * spec's `× (1 + pct)`. `decisions.md` does not settle it; a test pins it.
 */
function returnBonusMultiplier(pct: number): Fraction {
  return add(ONE, fromNumber(pct));
}

/** `total` is the exact running total after this step, never a delta. */
type DraftLine = {
  step: ExplanationLine["step"];
  text: string;
  total: Fraction;
};

/**
 * D9: round once, and hand each line the difference from what is already shown,
 * so the lines sum to the total by construction. Kept in whole cents, which a
 * `double` holds exactly.
 */
function roundOnce(drafts: DraftLine[]): Calculation {
  let shown = 0n;

  const lines = drafts.flatMap(({ step, text, total }) => {
    const cents = toCents(total);
    const hours = Number(cents - shown) / 100;
    shown = cents;

    // A 0h step is noise (D10); the base line stays: it names the activity.
    return hours === 0 && step !== "base" ? [] : [{ step, text, hours }];
  });

  const hours = Number(shown) / 100;

  if (hours > MAX_ENTRY_HOURS) {
    throw new Error(
      `esta entrada daria ${hours} h, e o máximo que uma entrada pode valer é ${MAX_ENTRY_HOURS} h: baixe o valor da atividade`,
    );
  }

  return { hours, lines };
}

/** D8's "strictly earlier", written once; the queue asks it too (D32). */
export function isEarlier(
  log: Pick<ApprovedLog, "occurredOn" | "createdAt" | "id">,
  occurredOn: string,
  position: CanonicalPosition,
): boolean {
  if (log.occurredOn !== occurredOn) return log.occurredOn < occurredOn;
  if (position === "new") return true;

  const byCreatedAt = log.createdAt.getTime() - position.createdAt.getTime();

  return byCreatedAt === 0 ? log.id < position.id : byCreatedAt < 0;
}

function plural(days: number): string {
  return days === 1 ? "1 dia" : `${days} dias`;
}

/**
 * The exact count when the history shows the last entry, "mais de N dias"
 * bounded by `historyFrom` otherwise: never a number that is not in the input.
 */
function awayText(
  categoryLogs: ApprovedLog[],
  occurredOn: string,
  afterDays: number,
  historyFrom: string,
): string {
  let last: string | undefined;

  for (const log of categoryLogs) {
    // D34 history can hold a later day, which would read "faz −4 dias".
    if (log.occurredOn > occurredOn) continue;
    if (last === undefined || log.occurredOn > last) last = log.occurredOn;
  }

  if (last !== undefined) return `faz ${plural(daysBetween(last, occurredOn))}`;

  const covered = Math.max(afterDays, daysBetween(historyFrom, occurredOn));

  return `faz mais de ${plural(covered)}`;
}

/**
 * `index * step` in floating point drifts ("2000,01h" for 2000h). `step` has
 * two decimals on every path that sets it, so rounding recovers the exact
 * bound.
 */
function bandBound(index: bigint, step: number): number {
  return Math.round(Number(index) * step * 100) / 100;
}

/**
 * States the rule ("de 1h a 2h"), not the boy's history; collapses when both
 * bounds round alike.
 */
function bandText(index: bigint, step: number): string {
  const from = formatHours(bandBound(index, step));
  const to = formatHours(bandBound(index + 1n, step));

  return from === to ? `depois de ${from}` : `de ${from} a ${to}`;
}

/** Cut at the third halving: Portuguese has no everyday word for 1/16. */
function fractionText(index: bigint): string {
  switch (index) {
    case 1n:
      return "metade";
    case 2n:
      return "um quarto";
    case 3n:
      return "um oitavo";
    default:
      return DEEP_DECAY_TEXT;
  }
}

/**
 * `minutes / 60` exactly: 20 minutes is 1/3 of an hour, which no `double`
 * holds.
 */
function exactHours(minutes: number): Fraction {
  return divide(fromNumber(minutes), fromNumber(MINUTES_PER_HOUR));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** pt-BR decimals: "3,94", "2". */
function formatNumber(value: number): string {
  return String(round2(value)).replace(".", ",");
}

function formatHours(value: number): string {
  return `${formatNumber(value)}h`;
}

/** One decimal always, matching the grade buttons ("0,0", "1,0"). */
function formatGrade(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

/**
 * Hours only when they are exact at two decimals, minutes otherwise, so the
 * line's own multiplication closes: a rounded factor made "0,02h × 2,0" read
 * 0,03h.
 */
function durationText(minutes: number): string {
  const hours = minutes / MINUTES_PER_HOUR;

  return round2(hours) === hours
    ? formatHours(hours)
    : `${formatNumber(minutes)}min`;
}

/**
 * One decimal, like the table ("2,0"); a more precise rate is shown in full so
 * the line closes.
 */
function formatRate(value: number): string {
  if (round2(value) !== value) return String(value).replace(".", ",");

  return value
    .toFixed(2)
    .replace(/(\.\d)0$/, "$1")
    .replace(".", ",");
}

/*
 * The `require*` guards below refuse to guess: a missing duration read as zero
 * is the silent wrong number this module exists to prevent. Each is a call-site
 * bug.
 */

/**
 * A short window is invisible and generous: a cooldown that never fires, a
 * bonus that fires when it should not.
 */
function requireHistoryWindow(input: CalculationInput): void {
  const from = historyWindowStart(
    input.occurredOn,
    input.activity,
    input.category,
  );
  const to = historyWindowEnd(input.occurredOn, input.activity, input.category);

  // `YYYY-MM-DD`, so the lexical order is the calendar order (D13).
  parseDate(input.historyFrom);
  parseDate(input.historyTo);
  if (input.categoryFirstDay !== null) parseDate(input.categoryFirstDay);

  if (input.historyFrom > from) {
    throw new Error(
      `${input.activity.name}: history starts on ${input.historyFrom}, but this calculation reads back to ${from}`,
    );
  }

  if (input.historyTo < to) {
    throw new Error(
      `${input.activity.name}: history ends on ${input.historyTo}, but this calculation reads forward to ${to}`,
    );
  }
}

/**
 * A `where` missing `user_id = ?` still type-checks: every row carries *a* user
 * id.
 */
function assertOwnHistory(input: CalculationInput): void {
  for (const log of input.history) {
    if (log.userId !== input.userId) {
      throw new Error(
        `history holds log ${log.id} of user ${log.userId}, but this is user ${input.userId}'s calculation`,
      );
    }
  }

  approvedOnly(input.history);
}

function requireDurationMinutes(input: CalculationInput): number {
  const minutes = input.durationMinutes;

  // `stopTimer` refuses a session that rounds to zero; `Infinity > 0` is true,
  // hence the isFinite.
  if (minutes == null || !(minutes > 0) || !Number.isFinite(minutes)) {
    throw new Error(
      `${input.activity.name}: a duration activity needs a finite durationMinutes > 0, received ${minutes}`,
    );
  }

  return minutes;
}

/**
 * Null is the off switch (D2). Zero would make every band `Infinity`; the
 * calculator never reaches the CHECK.
 */
function requireDecayStep(category: EngineCategory): number | null {
  const step = category.decayStepHours;

  if (step === null) return null;

  if (!(step > 0) || !Number.isFinite(step)) {
    throw new Error(
      `${category.name}: decay_step_hours must be null or a finite number of hours above zero, received ${step}`,
    );
  }

  return step;
}

function requireValue(activity: EngineActivity): number {
  if (activity.value == null) {
    throw new Error(
      `${activity.name}: a ${activity.calcMode} activity needs a value`,
    );
  }

  return activity.value;
}

function requireFreeValue(input: CalculationInput): number {
  if (input.freeValue == null) {
    throw new Error(`${input.activity.name}: a free activity needs freeValue`);
  }

  return input.freeValue;
}

function requireQuality(input: CalculationInput): number {
  const quality = input.quality;

  if (quality == null) {
    throw new Error(
      `${input.activity.name}: a quality graded activity needs quality`,
    );
  }

  // The calculator never reaches the schema's CHECK.
  if (!QUALITY_GRADES.includes(quality)) {
    throw new Error(
      `${input.activity.name}: quality must be one of ${QUALITY_GRADES.join(" · ")}, received ${quality}`,
    );
  }

  return quality;
}
