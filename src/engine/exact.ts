/**
 * Exact rational arithmetic for the decay (D39): in `double` a longer session
 * could pay less than a shorter one. `fromNumber` reads the decimal that was
 * typed, which keeps denominators small. No Node built-ins: it ships to
 * the client.
 */

/*
 * Cost (D39): the loop re-evaluates the closed form once per emitted band. If
 * it ever matters, accumulate `survived += width · 2^-index` across the walk
 * instead; the closed form is still needed for the total after a fold.
 */

/**
 * `n / d`, always with `d > 0` and `gcd(|n|, d) = 1`: normalised on
 * construction, so equal fractions have equal fields and small denominators.
 */
export type Fraction = {
  readonly n: bigint;
  readonly d: bigint;
};

export const ZERO: Fraction = { n: 0n, d: 1n };
export const ONE: Fraction = { n: 1n, d: 1n };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;

  while (y !== 0n) {
    const rest = x % y;
    x = y;
    y = rest;
  }

  return x;
}

/** Euclidean floor division. `d` must be positive; `n` may be negative. */
function floorDiv(n: bigint, d: bigint): bigint {
  const quotient = n / d;

  return n >= 0n || quotient * d === n ? quotient : quotient - 1n;
}

/** `n / d`, normalised. Throws on a zero denominator rather than inventing one. */
export function fraction(n: bigint, d: bigint): Fraction {
  if (d === 0n) {
    throw new Error("a fraction cannot have a denominator of zero");
  }

  const sign = d < 0n ? -1n : 1n;
  const numerator = n * sign;
  const denominator = d * sign;

  if (numerator === 0n) return ZERO;

  const divisor = gcd(numerator, denominator);

  return { n: numerator / divisor, d: denominator / divisor };
}

/**
 * `String(value)` is the shortest decimal that round-trips, i.e. what the adult
 * typed: 0,1 becomes 1/10, not its binary expansion.
 */
export function fromNumber(value: number): Fraction {
  if (!Number.isFinite(value)) {
    throw new Error(`cannot make an exact fraction of ${value}`);
  }

  if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
    return value === 0 ? ZERO : { n: BigInt(value), d: 1n };
  }

  // "1.25", "-0.001", "1e-7", "1.5e+30" — the only shapes `String` produces.
  const text = String(value);
  const e = text.indexOf("e");
  const mantissa = e === -1 ? text : text.slice(0, e);
  const exponent = e === -1 ? 0 : Number(text.slice(e + 1));
  const dot = mantissa.indexOf(".");
  const digits =
    dot === -1 ? mantissa : mantissa.slice(0, dot) + mantissa.slice(dot + 1);
  const decimals = dot === -1 ? 0 : mantissa.length - dot - 1;
  const power = decimals - exponent;

  return power >= 0
    ? fraction(BigInt(digits), 10n ** BigInt(power))
    : fraction(BigInt(digits) * 10n ** BigInt(-power), 1n);
}

export function add(a: Fraction, b: Fraction): Fraction {
  return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function subtract(a: Fraction, b: Fraction): Fraction {
  return fraction(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function multiply(a: Fraction, b: Fraction): Fraction {
  return fraction(a.n * b.n, a.d * b.d);
}

export function divide(a: Fraction, b: Fraction): Fraction {
  if (b.n === 0n) {
    throw new Error("division by an exact zero");
  }

  return fraction(a.n * b.d, a.d * b.n);
}

export function isPositive(value: Fraction): boolean {
  return value.n > 0n;
}

/** −1, 0 or 1, the way a comparator wants it. */
export function compare(a: Fraction, b: Fraction): number {
  const left = a.n * b.d;
  const right = b.n * a.d;

  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * D9's only rounding: `floor(100·x + ½)`, `Math.round`'s rule, −0,5 → 0 included.
 * Cents, because they are exact in a `double` and hundredths of an hour are not.
 */
export function toCents(value: Fraction): bigint {
  return floorDiv(200n * value.n + value.d, 2n * value.d);
}

/**
 * Past this the entry is worth under `2^-3071` h, which no `double` rate lifts
 * to half a cent; zero saves building a `2^(10^13)` for a 1e-9 step.
 */
const MAX_START_HALVINGS = 4096n;

/**
 * Tail bound, reached only past 8192 bands (the 0,25h floor crosses 96 a day).
 * That it moves no cent is measured against the unbounded sum in
 * `exact.test.ts`, not proved in prose. D39: whoever touches it redoes both.
 */
const EXACT_TAIL_HALVINGS = 8192n;

/** `2^-k` as an exact fraction. `k` may not be negative. */
function halving(k: bigint): Fraction {
  return { n: 1n, d: 1n << k };
}

/** `floor(value / divisor)`, for a positive `divisor`. */
function floorQuotient(value: Fraction, divisor: Fraction): bigint {
  return floorDiv(value.n * divisor.d, value.d * divisor.n);
}

/** The band the next hour of activity is charged at; 0 is "cheio". */
export function bandIndex(bucketHours: Fraction, step: Fraction): bigint {
  return floorQuotient(bucketHours, step);
}

/**
 * `F(bucket + activity) − F(bucket)`, where
 * `F(x) = 2·passo − (2·passo − r)·2^-n`, `n = floor(x / passo)`, `r = x − n·passo`.
 * Closed form, not a loop: exact `2^-i` never underflows, so a tiny step would
 * loop 10^13 times.
 */
export function decayedHours(
  bucketHours: Fraction,
  activityHours: Fraction,
  step: Fraction,
): Fraction {
  if (!isPositive(step)) {
    throw new Error("a decay step must be above zero");
  }

  if (!isPositive(activityHours)) return ZERO;

  const startHalvings = bandIndex(bucketHours, step);

  if (startHalvings > MAX_START_HALVINGS) return ZERO;

  const twoStep = multiply(step, { n: 2n, d: 1n });

  // A: what the day still has to give from the band this entry starts in.
  const startRest = subtract(
    bucketHours,
    multiply(step, fraction(startHalvings, 1n)),
  );
  const reachable = multiply(
    subtract(twoStep, startRest),
    halving(startHalvings),
  );

  // Clamp the *end*, never the exponent: a true remainder with a frozen
  // exponent sawtooths, and the result stops being monotone (D39).
  const limit = startHalvings + EXACT_TAIL_HALVINGS;
  const ceiling = multiply(step, fraction(limit, 1n));
  // A `min` on the value, not a step on the band index: the step let the end
  // climb past the ceiling inside band `limit` and then drop back (D39).
  const trueEnd = add(bucketHours, activityHours);
  const end = compare(trueEnd, ceiling) > 0 ? ceiling : trueEnd;
  const endHalvings = bandIndex(end, step);

  // B: the same quantity where the entry stops, which is what it does not take.
  const endRest = subtract(end, multiply(step, fraction(endHalvings, 1n)));
  const unreached = multiply(subtract(twoStep, endRest), halving(endHalvings));

  return subtract(reachable, unreached);
}
