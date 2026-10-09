import type { Activity, ActivityLog, Category } from "../db/schema";
import { parseDate, shiftDate } from "./day";
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
  ZERO,
} from "./exact";
import { BONUS_ENABLED } from "./flags";

/** Re-exported for existing callers; they live in `./day` so the stopwatch skips the engine. */
export { daysBetween, saoPauloDay, shiftDate } from "./day";

// One copy for the boy's calculator and the admin's entry; client-safe: schema is `import type`.

const MINUTES_PER_HOUR = 60;

/** `activity_logs_computed_hours_check`'s ceiling, refused here so the queue shows a reason. */
const MAX_ENTRY_HOURS = 1_000_000;

/** The five grades the spec allows, and the same five the schema's CHECK holds. */
const QUALITY_GRADES = [0, 0.3, 0.5, 0.7, 1];

const COOLDOWN_MULTIPLIER: Fraction = { n: 1n, d: 2n };

/** Past this the decay folds into one line: a tiny step would print thousands. */
const MAX_DECAY_LINES = 8;

/** Never "nada": the decay has no floor to announce (D2). */
const DEEP_DECAY_TEXT = "cada vez menos";

export type CalcMode = Activity["calcMode"];

/** `Pick`, so a schema column that changes shape breaks this at compile time. */
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
  "id" | "name" | "decayStepHours" | "alternationBonusPct"
>;

// `userId` and `status` required, so a query missing either filter fails to compile.
// `categoryId` frozen (D37). No `calcMode`: the hours are the row's `duration_minutes` (D5).
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

// D19's status rule, written once. Throws rather than filters, so a query missing its
// `where` fails loudly instead of matching a correct one.
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

/** D8's canonical position. Not used by the arithmetic (D34); only D32 reads it. */
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
  /** Frozen before this entry (D34), over `[historyFrom, historyTo]`; filtering is the caller's job. */
  history: ApprovedLog[];
  /** Declared, not assumed: a short window silently over-credits. */
  historyFrom: string;
  /** Declared too: under D34 a retroactive entry reads later days. */
  historyTo: string;
  /** Category ids that take the bonus (pct > 0); a same-day entry of one unlocks another (D56). */
  participatingCategoryIds: readonly number[];
};

/** Signed addends, not a running total: they sum to `Calculation.hours` exactly (D9). */
export type ExplanationLine = {
  step: "base" | "quality" | "cooldown" | "decay" | "bonus";
  text: string;
  /** Signed hours, already rounded to 2 decimals. */
  hours: number;
};

export type Calculation = {
  /** D9: rounded once. Can be 0, which books no ledger row (D10). */
  hours: number;
  lines: ExplanationLine[];
};

/** Zero still means "fetch the day itself": the daily bucket (D3) lives there. */
export function historyLookbackDays(
  activity: Pick<EngineActivity, "repeatCooldownDays">,
): number {
  return activity.repeatCooldownDays > 0 ? activity.repeatCooldownDays : 0;
}

export function historyWindowStart(
  occurredOn: string,
  activity: Pick<EngineActivity, "repeatCooldownDays">,
): string {
  return shiftDate(occurredOn, -historyLookbackDays(activity));
}

/** Not zero because of D34: a retroactive entry reads what later days spent. */
export function historyWindowEnd(
  occurredOn: string,
  activity: Pick<EngineActivity, "repeatCooldownDays">,
): string {
  return shiftDate(occurredOn, historyLookbackDays(activity));
}

export function calculateEarnedHours(input: CalculationInput): Calculation {
  const { activity, category, occurredOn } = input;

  assertOwnHistory(input);
  requireHistoryWindow(input);

  const counted = input.history;

  const drafts: DraftLine[] = [];

  const durationMinutes =
    activity.calcMode === "duration" ? requireDurationMinutes(input) : 0;
  const exactActivityHours = exactHours(durationMinutes);

  let value: Fraction;
  let baseText: string;
  // Hoisted: the decay split narrates each band at the base rate (× 2^-i).
  let rate = 0;
  let baseRate: Fraction | null = null;

  switch (activity.calcMode) {
    case "duration": {
      rate = requireValue(activity);
      baseRate = fromNumber(rate);
      value = multiply(exactActivityHours, baseRate);
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

  // D3 bucket, D5 membership. Whole minutes: six 20-minute logs as hours give 1,9999…,
  // and the base line would say "cheio" two halvings deep.
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

  // D1 as the boy hears it: each band of activity hours is its own positive
  // addend at that band's rate (base × 2^-i), so the column adds up instead of
  // reading "cheio menos X" (#80). Quality, cooldown and bonus multiply after —
  // the order is free, the product is not (D9).
  if (exactStep !== null && step !== null && decays && baseRate !== null) {
    const end = add(exactBucketHours, exactActivityHours);
    let emitted = 0;
    let foldedFrom: number | null = null;
    let index = bandIndex(exactBucketHours, exactStep);
    let bandStart = exactBucketHours;
    let running = ZERO;

    while (compare(bandStart, end) < 0) {
      const boundary = multiply(exactStep, fraction(index + 1n, 1n));
      const bandEnd = compare(boundary, end) < 0 ? boundary : end;
      const hasNext = compare(bandEnd, end) < 0;

      if (emitted === MAX_DECAY_LINES && hasNext) {
        // The fold never lands on the first band, so a base line is always drawn.
        foldedFrom = bandBound(index, step);
        break;
      }

      // Within a band the rate is constant (D39), so width × rate is exact.
      const width = subtract(bandEnd, bandStart);
      running = add(
        running,
        multiply(width, multiply(baseRate, fraction(1n, 1n << index))),
      );

      drafts.push({
        step: emitted === 0 ? "base" : "decay",
        text: bandLineText({
          first: emitted === 0,
          index,
          step,
          widthMinutes: fractionMinutes(width),
          rate,
          activityName: activity.name,
          categoryName: category.name,
          bucketHours,
        }),
        total: running,
      });

      emitted += 1;
      bandStart = bandEnd;
      index += 1n;
    }

    // The closed form, so the bands past the fold cost nothing (D39).
    value = multiply(
      decayedHours(exactBucketHours, exactActivityHours, exactStep),
      baseRate,
    );

    if (foldedFrom !== null) {
      drafts.push({
        step: "decay",
        text: `${DEEP_DECAY_TEXT}, depois de ${formatHours(foldedFrom)} de ${category.name} no dia`,
        total: value,
      });
    }
  } else {
    drafts.push({ step: "base", text: baseText, total: value });
  }

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

  const bonusPct = category.alternationBonusPct;
  // D56: the bonus needs an earlier same-day entry of a *different* category
  // that also takes the bonus (pct > 0); each category earns it once a day.
  const participating = new Set(input.participatingCategoryIds);
  const sameDay = counted.filter((log) => log.occurredOn === occurredOn);
  const unlockedBy = earliestParticipatingOther(
    sameDay,
    category.id,
    participating,
  );
  const bonusApplies =
    // D57: off behind one constant for a testing period; the step vanishes.
    BONUS_ENABLED &&
    bonusPct > 0 &&
    participating.has(category.id) &&
    unlockedBy !== null &&
    // Already earned if an earlier entry of C came after the unlocking one.
    !sameDay.some(
      (log) => log.categoryId === category.id && isLaterInDay(log, unlockedBy),
    );

  if (bonusApplies) {
    const next = multiply(value, alternationBonusMultiplier(bonusPct));
    drafts.push({
      step: "bonus",
      text: `+${formatNumber(bonusPct * 100)}%, você variou de atividade hoje`,
      total: next,
    });
    value = next;
  }

  return roundOnce(drafts);
}

// `alternation_bonus_pct` is a fraction (0,5 is +50%), like the seed and the
// spec's `× (1 + pct)`. `decisions.md` does not settle it; a test pins it.
function alternationBonusMultiplier(pct: number): Fraction {
  return add(ONE, fromNumber(pct));
}

/** D8 order within the day: the earliest participating entry of another category, or null. */
function earliestParticipatingOther(
  sameDay: readonly ApprovedLog[],
  categoryId: number,
  participating: ReadonlySet<number>,
): ApprovedLog | null {
  let earliest: ApprovedLog | null = null;

  for (const log of sameDay) {
    if (log.categoryId === categoryId || !participating.has(log.categoryId)) {
      continue;
    }
    if (earliest === null || isLaterInDay(earliest, log)) earliest = log;
  }

  return earliest;
}

/** D8's tiebreak, within one day: `a` was frozen strictly after `b`. */
function isLaterInDay(
  a: Pick<ApprovedLog, "createdAt" | "id">,
  b: Pick<ApprovedLog, "createdAt" | "id">,
): boolean {
  const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime();

  return byCreatedAt === 0 ? a.id > b.id : byCreatedAt > 0;
}

/** `total` is the exact running total after this step, never a delta. */
type DraftLine = {
  step: ExplanationLine["step"];
  text: string;
  total: Fraction;
};

// D9: round once; each line gets the difference from what is shown, so the lines sum
// to the total by construction. Whole cents, which a `double` holds exactly.
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

// `index * step` in float drifts ("2000,01h" for 2000h); `step` has two decimals on
// every path that sets it, so rounding recovers the exact bound.
function bandBound(index: bigint, step: number): number {
  return Math.round(Number(index) * step * 100) / 100;
}

/** States the rule ("de 1h a 2h"), not the boy's history. */
function bandText(index: bigint, step: number): string {
  const from = formatHours(bandBound(index, step));
  const to = formatHours(bandBound(index + 1n, step));

  return from === to ? `depois de ${from}` : `de ${from} a ${to}`;
}

/** Minutes of activity in a band, for the per-band line's own "duração × taxa". */
function fractionMinutes(hours: Fraction): number {
  return Number(hours.n * 60n) / Number(hours.d);
}

/**
 * One band as a positive addend: its reason and its own rate (base × 2^-index),
 * so "metade" shows the halved rate the boy multiplies, never a bare subtraction (#80).
 * Past the named bands the rate is a vanishing decimal, so only the word is shown.
 */
function bandLineText(args: {
  first: boolean;
  index: bigint;
  step: number;
  widthMinutes: number;
  rate: number;
  activityName: string;
  categoryName: string;
  bucketHours: number;
}): string {
  // 0..3 are cheio/metade/um quarto/um oitavo: a word and a rate of two decimals.
  const product =
    args.index <= 3n
      ? `${durationText(args.widthMinutes)} × ${formatRate(args.rate / 2 ** Number(args.index))}`
      : null;

  if (args.first) {
    const head = product
      ? `${args.activityName}, ${product}`
      : args.activityName;

    return args.index === 0n
      ? `${head} — cheio`
      : `${head} — ${fractionText(args.index)}, você já fez ${formatHours(args.bucketHours)} de ${args.categoryName} hoje`;
  }

  const rule = `${fractionText(args.index)}, ${bandText(args.index, args.step)} de ${args.categoryName} no dia`;

  return product ? `${rule} — ${product}` : rule;
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

/** Exact: 20 minutes is 1/3 of an hour, which no `double` holds. */
function exactHours(minutes: number): Fraction {
  return divide(fromNumber(minutes), fromNumber(MINUTES_PER_HOUR));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

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

// Hours only when exact at two decimals, so the line's own product closes: a rounded
// factor made "0,02h × 2,0" read 0,03h.
function durationText(minutes: number): string {
  const hours = minutes / MINUTES_PER_HOUR;

  return round2(hours) === hours
    ? formatHours(hours)
    : `${formatNumber(minutes)}min`;
}

/** One decimal like the table ("2,0"); a more precise rate in full, so the line closes. */
function formatRate(value: number): string {
  if (round2(value) !== value) return String(value).replace(".", ",");

  return value
    .toFixed(2)
    .replace(/(\.\d)0$/, "$1")
    .replace(".", ",");
}

// The `require*` guards refuse to guess: a missing value read as zero is the silent wrong number.

/** A short window is invisible and generous: a cooldown that never fires, a bonus that does. */
function requireHistoryWindow(input: CalculationInput): void {
  const from = historyWindowStart(input.occurredOn, input.activity);
  const to = historyWindowEnd(input.occurredOn, input.activity);

  // `YYYY-MM-DD`, so the lexical order is the calendar order (D13).
  parseDate(input.historyFrom);
  parseDate(input.historyTo);

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

/** A `where` missing `user_id = ?` still type-checks: every row carries *a* user id. */
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

  // `stopTimer` refuses a session that rounds to zero; `Infinity > 0` is true, hence isFinite.
  if (minutes == null || !(minutes > 0) || !Number.isFinite(minutes)) {
    throw new Error(
      `${input.activity.name}: a duration activity needs a finite durationMinutes > 0, received ${minutes}`,
    );
  }

  return minutes;
}

/** Null is the off switch (D2). Zero would make every band `Infinity`, before any CHECK. */
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
