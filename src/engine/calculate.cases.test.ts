import { describe, expect, it } from "vitest";

import {
  type Calculation,
  calculateEarnedHours,
  type EngineActivity,
  type EngineCategory,
  type ExplanationLine,
} from "./calculate";
import {
  approved,
  day,
  FULL_MARKS,
  input,
  KID1,
  KID2,
  modeInputs,
  ONE_HOUR_MINUTES,
  present,
  SEED_ROWS,
  seedRow,
  TYPED_FREE_VALUE,
} from "./cases";

/**
 * The exhaustive case table of issue #11.
 *
 * Written against `docs/decisions.md` — D1 to D10 and D21, plus the paragraph
 * "O desgaste, em uma frase" that opens the document — and never against
 * `src/engine/calculate.ts`. The engine came from issue #10 and carries its own
 * tests; #11 is a separate issue on purpose, because whoever implements a rule
 * tests the rule he pictured, and the rule the document asks for is a different
 * object.
 *
 * The four things this table looks at that the engine's own suite does not:
 *
 * - **Rules composed.** Every rule was pinned alone. Here the grade, the
 *   cooldown, the decay and the return bonus meet on one entry, in all sixteen
 *   combinations of on and off, and the explanation is read as the ordered
 *   chain D7 describes rather than as a bag of lines.
 * - **The seed as it actually is.** Not invented fixtures: the seven categories
 *   and thirty-two activities `src/db/seed.ts` writes, every one of them, twice.
 * - **A whole plausible day.** Kid1's Saturday, five entries deep, read end to
 *   end.
 * - **The text.** The lines are product, not log — the boy reads them and checks
 *   the arithmetic himself. So every line of every case in this file goes
 *   through `expectReadable`.
 */

const SATURDAY = "2026-03-14";

// ---------------------------------------------------------------------------
// invariants every case in this file has to satisfy
// ---------------------------------------------------------------------------

/**
 * D9, as an invariant instead of a case: the lines are addends and their sum is
 * the total, exactly, with no third number anywhere.
 */
function expectLinesToClose(calculation: Calculation): void {
  const sum = calculation.lines.reduce(
    (total, line) => Math.round((total + line.hours) * 100) / 100,
    0,
  );

  expect(sum).toBe(calculation.hours);

  for (const line of calculation.lines) {
    expect(Math.round(line.hours * 100) / 100).toBe(line.hours);
  }
}

/**
 * What a line may never say, and what it may never leave out.
 *
 * "nada" is named because D2's whole justification is that the boy never hears
 * that an hour is worth nothing; the rest are the shapes a number takes when a
 * formula has gone wrong and nobody looked at the string.
 */
function expectReadable(calculation: Calculation, name: string): void {
  expectLinesToClose(calculation);
  expect(Number.isFinite(calculation.hours)).toBe(true);
  expect(calculation.hours).toBeGreaterThanOrEqual(0);
  expect(calculation.lines.length).toBeGreaterThan(0);
  expect(calculation.lines[0]?.step).toBe("base");
  expect(calculation.lines[0]?.text).toContain(name);

  const seen: ExplanationLine["step"][] = [];
  const order = ["base", "quality", "cooldown", "decay", "bonus"] as const;

  for (const line of calculation.lines) {
    expect(line.text.trim()).toBe(line.text);
    expect(line.text.length).toBeGreaterThan(0);
    expect(line.text).not.toMatch(/NaN|Infinity|undefined|null/);
    expect(line.text).not.toMatch(/\bnada\b/);
    // No band is ever described by a numeral: see the fraction case below.
    expect(line.text).not.toMatch(/\d\/\d/);
    expect(line.text).not.toMatch(/e[+-]\d/);
    expect(line.text).not.toMatch(/ {2}/);
    expect(Number.isFinite(line.hours)).toBe(true);
    seen.push(line.step);
  }

  // D7's order, read off the screen: the steps appear in the order the decision
  // lists them, with the ones that did nothing left out.
  const positions = seen.map((step) => order.indexOf(step));
  expect(positions).toStrictEqual([...positions].sort((a, b) => a - b));
}

/**
 * The running totals the boy computes as he reads down the screen.
 *
 * D9 says the lines show numbers already rounded and that the sum has to close,
 * so the partial sum after each line is what that step arrived at — which is
 * the only place D7's order is observable at all (see the note on
 * `composition`).
 */
function runningTotals(calculation: Calculation): number[] {
  const totals: number[] = [];
  let sum = 0;

  for (const line of calculation.lines) {
    sum = Math.round((sum + line.hours) * 100) / 100;
    totals.push(sum);
  }

  return totals;
}

function run(overrides: Parameters<typeof input>[0]): Calculation {
  const calculation = calculateEarnedHours(input(overrides));

  expectReadable(calculation, overrides.activity.name);

  return calculation;
}

function texts(calculation: Calculation): string[] {
  return calculation.lines.map((line) => line.text);
}

function steps(calculation: Calculation): ExplanationLine["step"][] {
  return calculation.lines.map((line) => line.step);
}

// ---------------------------------------------------------------------------
// 1. the acceptance criteria of issue #11
// ---------------------------------------------------------------------------

describe("the acceptance criteria of #11", () => {
  const { category: mente, activity: lerLivro } = seedRow(5);
  const { activity: hq } = seedRow(6);
  const { activity: xadrez } = seedRow(7);

  /**
   * Mente is the row the decision log writes the table on, and the seed gives it
   * a 50% return bonus after 3 days — which would fire on an empty history and
   * turn 1,5h into 2,25h. The table in `decisions.md` is about the decay alone, so
   * the history carries a Mente entry the day before and the bonus stays out of
   * the way. That is itself the composition the issue asks about: the bonus and
   * the decay are two different rules and only one of them is being measured.
   */
  const yesterdayMente = [
    approved({
      id: 1,
      occurredOn: day(SATURDAY, -1),
      activity: lerLivro,
      durationMinutes: 30,
    }),
  ];

  it("reproduces the table of decisions.md: 1,5h · 0,75h · 0,38h · 0,19h", () => {
    // "A cada `decay_step_hours` horas de atividade acumuladas na categoria no
    // dia, a hora seguinte vale metade da anterior." Read as four one-hour
    // sessions, the bucket walks 0h · 1h · 2h · 3h and the hours read
    // 1,5 · 0,75 · 0,375 · 0,1875, rounded once by D9.
    const expected = [1.5, 0.75, 0.38, 0.19];

    for (const [index, hours] of expected.entries()) {
      const history = [
        ...yesterdayMente,
        ...Array.from({ length: index }, (_, previous) =>
          approved({
            id: 10 + previous,
            occurredOn: SATURDAY,
            activity: lerLivro,
            durationMinutes: ONE_HOUR_MINUTES,
          }),
        ),
      ];

      const calculation = run({
        activity: lerLivro,
        category: mente,
        occurredOn: SATURDAY,
        durationMinutes: ONE_HOUR_MINUTES,
        history,
      });

      expect(calculation.hours).toBe(hours);
    }
  });

  it("carries the same table on to the asymptote: 5h reads 2,91h, 6h reads 2,95h", () => {
    // The last two rows of the same table, as one sitting. "Ler 6 horas é
    // permitido — só rende quase nada a mais do que ler 4", and the asymptote is
    // taxa × decay_step_hours × 2 = 3h.
    const five = run({
      activity: lerLivro,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: 5 * ONE_HOUR_MINUTES,
      history: yesterdayMente,
    });
    const six = run({
      activity: lerLivro,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: 6 * ONE_HOUR_MINUTES,
      history: yesterdayMente,
    });

    expect(five.hours).toBe(2.91);
    expect(six.hours).toBe(2.95);
    expect(six.hours).toBeLessThan(1.5 * 2 * 1);
  });

  it("prorates a 2h session that crosses a band: 2,25h, not 3h nor 1,5h", () => {
    const calculation = run({
      activity: lerLivro,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: 2 * ONE_HOUR_MINUTES,
      history: yesterdayMente,
    });

    expect(calculation.hours).toBe(2.25);
    // The two numbers the decision rules out by name: 3h is the whole session in
    // the undecayed band, 1,5h is the whole session in the halved one.
    expect(calculation.hours).not.toBe(3);
    expect(calculation.hours).not.toBe(1.5);
  });

  it("buckets by category: livro, HQ and xadrez share one Mente accumulator (D3)", () => {
    // One hour of each, in that order. If the bucket were per activity every one
    // of them would pay full; it is per category, so the third one is two
    // halvings deep.
    const history = [
      ...yesterdayMente,
      approved({
        id: 20,
        occurredOn: SATURDAY,
        activity: lerLivro,
        durationMinutes: ONE_HOUR_MINUTES,
      }),
      approved({
        id: 21,
        occurredOn: SATURDAY,
        activity: hq,
        durationMinutes: ONE_HOUR_MINUTES,
      }),
    ];

    const calculation = run({
      activity: xadrez,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: ONE_HOUR_MINUTES,
      history,
    });

    // Xadrez is 1,5 a hour and the bucket already holds 2h of Mente, so a
    // quarter: 0,375h, rounded to 0,38h.
    expect(calculation.hours).toBe(0.38);
    expect(texts(calculation).join(" ")).toContain("2h de Mente hoje");
  });

  it("empties the bucket at midnight (D3)", () => {
    // Four hours of Mente yesterday, and today's first hour is worth full.
    const history = [
      approved({
        id: 30,
        occurredOn: day(SATURDAY, -1),
        activity: lerLivro,
        durationMinutes: 4 * ONE_HOUR_MINUTES,
      }),
    ];

    const calculation = run({
      activity: lerLivro,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: ONE_HOUR_MINUTES,
      history,
    });

    expect(calculation.hours).toBe(1.5);
    expect(steps(calculation)).toStrictEqual(["base"]);
  });

  it("continues two separate sessions of one day from where the tap was (D3)", () => {
    // Morning and afternoon, two hours apart. The second session does not start
    // over: it starts at the 1h mark the first one left behind.
    const morning = run({
      activity: lerLivro,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: ONE_HOUR_MINUTES,
      history: yesterdayMente,
    });

    const afternoon = run({
      activity: lerLivro,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: ONE_HOUR_MINUTES,
      history: [
        ...yesterdayMente,
        approved({
          id: 40,
          occurredOn: SATURDAY,
          activity: lerLivro,
          durationMinutes: ONE_HOUR_MINUTES,
        }),
      ],
    });

    expect(morning.hours).toBe(1.5);
    expect(afternoon.hours).toBe(0.75);
    // Two sessions of one hour each pay what one two-hour sitting pays: the tap
    // does not reset between them.
    expect(morning.hours + afternoon.hours).toBe(2.25);
  });

  it("halves a repeat inside the cooldown window, the same day included (D6)", () => {
    const { category: casa, activity: lavarOCarro } = seedRow(26);

    for (const offset of [0, -1, -7]) {
      const calculation = run({
        activity: lavarOCarro,
        category: casa,
        occurredOn: SATURDAY,
        quality: FULL_MARKS,
        history: [
          approved({
            id: 50,
            occurredOn: day(SATURDAY, offset),
            activity: lavarOCarro,
          }),
        ],
      });

      expect(calculation.hours).toBe(1.5);
      expect(steps(calculation)).toContain("cooldown");
    }

    // One day past the window and the car pays in full again.
    const outside = run({
      activity: lavarOCarro,
      category: casa,
      occurredOn: SATURDAY,
      quality: FULL_MARKS,
      history: [
        approved({
          id: 51,
          occurredOn: day(SATURDAY, -8),
          activity: lavarOCarro,
        }),
      ],
    });

    expect(outside.hours).toBe(3);
    expect(steps(outside)).not.toContain("cooldown");
  });

  it("pays the return bonus once, on the already decayed value (D7)", () => {
    const { category: corpo, activity: futebol } = seedRow(1);

    // Corpo's step is 2h, so a three-hour match crosses one band: 2h at full and
    // 1h at half, on a rate of 1,5 — 3h + 0,75h = 3,75h before the bonus,
    // 5,63h after. The bonus multiplies the decayed 3,75h and not the undecayed
    // 4,5h, which would have come to 6,75h. Corpo was last done a month ago,
    // outside the history: a return, not a debut (D47).
    const first = run({
      activity: futebol,
      category: corpo,
      occurredOn: SATURDAY,
      durationMinutes: 3 * ONE_HOUR_MINUTES,
      history: [],
      categoryFirstDay: day(SATURDAY, -30),
    });

    expect(first.hours).toBe(5.63);
    expect(steps(first)).toStrictEqual(["base", "decay", "bonus"]);
    // The bonus line is the last one and it is the only positive one after the
    // base: it adds 1,88h, half of the decayed 3,75h, not half of the base 4,5h.
    expect(first.lines.at(-1)?.hours).toBe(1.88);

    // Second entry of the same return: the bonus is gone.
    const second = run({
      activity: futebol,
      category: corpo,
      occurredOn: SATURDAY,
      durationMinutes: ONE_HOUR_MINUTES,
      history: [
        approved({
          id: 60,
          occurredOn: SATURDAY,
          activity: futebol,
          durationMinutes: 3 * ONE_HOUR_MINUTES,
        }),
      ],
    });

    expect(steps(second)).not.toContain("bonus");
    // 3h of Corpo already in: the fourth hour is one halving deep. 1,5 × 0,5.
    expect(second.hours).toBe(0.75);
  });

  it("leaves fixed and delivery undecayed inside a category that does decay (D5)", () => {
    // Escola is the row that makes this a real case and not a tautology: it
    // carries `decay_step_hours = 2` *and* a delivery and a fixed activity. D5
    // says the decay there is for "Estudo para prova" alone.
    const { category: escola, activity: licaoDeCasa } = seedRow(23);
    const { activity: trabalho } = seedRow(24);
    const { activity: estudo } = seedRow(25);

    const fourHoursOfStudy = [
      approved({
        id: 70,
        occurredOn: SATURDAY,
        activity: estudo,
        durationMinutes: 4 * ONE_HOUR_MINUTES,
      }),
    ];

    const delivery = run({
      activity: licaoDeCasa,
      category: escola,
      occurredOn: SATURDAY,
      quality: FULL_MARKS,
      history: fourHoursOfStudy,
    });
    const fixed = run({
      activity: trabalho,
      category: escola,
      occurredOn: SATURDAY,
      history: fourHoursOfStudy,
    });

    expect(delivery.hours).toBe(1);
    expect(fixed.hours).toBe(2);
    expect(steps(delivery)).not.toContain("decay");
    expect(steps(fixed)).not.toContain("decay");

    // And the bucket those two did not read is real: the same history halves a
    // duration entry twice over.
    const duration = run({
      activity: estudo,
      category: escola,
      occurredOn: SATURDAY,
      durationMinutes: ONE_HOUR_MINUTES,
      history: fourHoursOfStudy,
    });

    expect(duration.hours).toBe(0.25);
  });

  it("keeps fixed and delivery out of the bucket as well (D5)", () => {
    const { category: escola, activity: licaoDeCasa } = seedRow(23);
    const { activity: trabalho } = seedRow(24);
    const { activity: estudo } = seedRow(25);

    // Two entries that pay 3h between them and put nothing in the bucket: the
    // hour of study that follows is still worth its full 1,0.
    const calculation = run({
      activity: estudo,
      category: escola,
      occurredOn: SATURDAY,
      durationMinutes: ONE_HOUR_MINUTES,
      history: [
        approved({ id: 80, occurredOn: SATURDAY, activity: licaoDeCasa }),
        approved({ id: 81, occurredOn: SATURDAY, activity: trabalho }),
      ],
    });

    expect(calculation.hours).toBe(1);
    expect(steps(calculation)).toStrictEqual(["base"]);
  });

  it("fills the bucket from the minutes a log carries, not from its mode (D5, D37)", () => {
    // This case used to assert the opposite, and the reversal is deliberate.
    //
    // D5's rule — "sem duração, não há hora de atividade para acumular" — was
    // read off the activity's `calc_mode`, through a live join. That made the
    // bucket depend on a field an adult can rewrite while an entry is frozen:
    // flipping "Ler livro" to `fixed` took its own already-paid hours out of
    // the bucket they had been paid from, and the same afternoon was paid twice
    // (measured, 4,50 h + 2,25 h against an asymptote of 4,00 h). So the bucket
    // is now read off the one thing the row itself states: its minutes.
    //
    // Nothing legitimate changes. Every non-`duration` log carries a null
    // duration — `launchEntry` writes it that way and the stopwatch files
    // nothing else — so the two readings agree on every row this system can
    // produce. And the one row that could disagree, a `duration` session whose
    // activity became `fixed` underneath it, can no longer be approved at all:
    // `requireEditableActivity` refuses to freeze an entry carrying minutes
    // onto something not measured by duration.
    //
    // What the case asserts now is the reachable half of D5, which is also the
    // half that pays the boy honestly: hours he really sat down for count.
    const { category: escola } = seedRow(23);
    const { activity: trabalho } = seedRow(24);
    const { activity: estudo } = seedRow(25);

    const calculation = run({
      activity: estudo,
      category: escola,
      occurredOn: SATURDAY,
      durationMinutes: ONE_HOUR_MINUTES,
      history: [
        approved({
          id: 82,
          occurredOn: SATURDAY,
          activity: trabalho,
          durationMinutes: 4 * ONE_HOUR_MINUTES,
        }),
      ],
    });

    // Four hours of Escola already in the day at a 2h step: the fifth hour is
    // two halvings deep, so 1,0 becomes 0,25.
    expect(calculation.hours).toBe(0.25);
    expect(steps(calculation)).toStrictEqual(["base", "decay"]);

    // And the half of D5 that is actually reachable: a log with no minutes puts
    // nothing in the bucket, whatever its activity is.
    const noMinutes = run({
      activity: estudo,
      category: escola,
      occurredOn: SATURDAY,
      durationMinutes: ONE_HOUR_MINUTES,
      history: [
        approved({
          id: 83,
          occurredOn: SATURDAY,
          activity: trabalho,
          durationMinutes: null,
        }),
      ],
    });

    expect(noMinutes.hours).toBe(1);
    expect(steps(noMinutes)).toStrictEqual(["base"]);
  });

  it("turns a zero grade on a delivery into an approved 0h with no ledger line (D10)", () => {
    const { category: escola, activity: licaoDeCasa } = seedRow(23);

    const calculation = run({
      activity: licaoDeCasa,
      category: escola,
      occurredOn: SATURDAY,
      quality: 0,
      history: [],
    });

    expect(calculation.hours).toBe(0);
    // "Uma linha de 0h no ledger seria ruído": the engine's contribution to that
    // is a total of exactly zero, which `ledger_hours_check` (> 0, exclusive)
    // cannot be written as. The explanation still exists and still closes.
    expect(calculation.hours > 0).toBe(false);
    expect(steps(calculation)).toStrictEqual(["base", "quality"]);
    expect(runningTotals(calculation)).toStrictEqual([1, 0]);
  });

  it("pays each of a day's sittings out of what the ones before it spent (D34)", () => {
    // A Saturday of three Mente sittings, each frozen after the one before it.
    // The numbers are D1's table and have not moved; what changed with D34 is
    // *how* the engine is told which of them count — the caller hands over the
    // set frozen before this one, instead of naming a place in the canonical
    // order and letting the engine filter.
    const sittings = [60, 60, 60].map((minutes, index) =>
      approved({
        id: 90 + index,
        occurredOn: SATURDAY,
        activity: lerLivro,
        durationMinutes: minutes,
      }),
    );

    const frozenAfter = (count: number) =>
      run({
        activity: lerLivro,
        category: mente,
        occurredOn: SATURDAY,
        durationMinutes: 60,
        history: [...yesterdayMente, ...sittings.slice(0, count)],
      }).hours;

    expect([frozenAfter(0), frozenAfter(1), frozenAfter(2)]).toStrictEqual([
      1.5, 0.75, 0.38,
    ]);

    // The same set twice is the same number, which is the determinism D8 asks
    // for — and under D34 it is a stronger promise than it was: the set of
    // entries frozen before this one is fixed the moment this one freezes,
    // while a place in the canonical order moves if anybody edits an
    // `occurred_on`.
    expect(frozenAfter(1)).toBe(0.75);

    // And nothing already frozen is a function of what is calculated later:
    // the second sitting's 0,75 h stands whatever the third one reads (D15).
    expect(frozenAfter(2)).toBe(0.38);
  });

  it("closes the sum of the lines against the total, over every row of the seed", () => {
    // The criterion is a property, not a case, so it is asserted over the whole
    // table — `expectReadable` runs it on every calculation this file makes.
    for (const { category, activity } of SEED_ROWS) {
      const calculation = run({
        activity,
        category,
        occurredOn: SATURDAY,
        ...modeInputs(activity),
      });

      expectLinesToClose(calculation);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. the seed, as it is actually written
// ---------------------------------------------------------------------------

describe("the seed of src/db/seed.ts, every row", () => {
  it("seeds seven categories and thirty-two activities", () => {
    expect(SEED_ROWS).toHaveLength(32);
    expect(new Set(SEED_ROWS.map(({ category }) => category.id)).size).toBe(7);
  });

  it("pays the first entry of the day the value the table promises", () => {
    // One hour for a duration, full marks for a delivery, the typed value for
    // the free one. With every category last done a month ago the return
    // bonus of Corpo, Mente and Criativo fires, and nothing else does: the
    // bucket is empty so no decay, and there is no earlier log so no cooldown.
    let bonused = 0;

    for (const { category, activity } of SEED_ROWS) {
      const calculation = run({
        activity,
        category,
        occurredOn: SATURDAY,
        ...modeInputs(activity),
        categoryFirstDay: day(SATURDAY, -30),
      });

      const base =
        activity.calcMode === "free"
          ? TYPED_FREE_VALUE
          : present(activity.value, `a value on ${activity.name}`);
      const bonus = 1 + category.returnBonusPct;

      expect(calculation.hours).toBe(Math.round(base * bonus * 100) / 100);
      expect(steps(calculation)).not.toContain("cooldown");
      expect(steps(calculation)).not.toContain("decay");

      if (category.returnBonusPct > 0) {
        bonused += 1;
        expect(steps(calculation)).toContain("bonus");
      } else {
        expect(steps(calculation)).not.toContain("bonus");
      }
    }

    // Corpo's four, Mente's four and Criativo's six: the fourteen rows that
    // carry a return bonus at all.
    expect(bonused).toBe(14);
  });

  it("halves exactly the six rows that carry a cooldown, and no others (D6)", () => {
    // The same entry, done again yesterday. D6's Fase 1 amendment says
    // `repeat_cooldown_days = 0` is the off switch, and the seed uses 0 in
    // twenty-six of the thirty-two rows with exactly that meaning.
    let halved = 0;

    for (const { category, activity } of SEED_ROWS) {
      const calculation = run({
        activity,
        category,
        occurredOn: SATURDAY,
        ...modeInputs(activity),
        history: [
          approved({
            id: 100 + activity.id,
            occurredOn: day(SATURDAY, -1),
            activity,
            // A duration log of another day: it can fill no bucket of today.
            durationMinutes:
              activity.calcMode === "duration" ? ONE_HOUR_MINUTES : null,
          }),
        ],
      });

      const base =
        activity.calcMode === "free"
          ? TYPED_FREE_VALUE
          : present(activity.value, `a value on ${activity.name}`);
      const hasCooldown = activity.repeatCooldownDays > 0;

      if (hasCooldown) halved += 1;

      // The entry of yesterday is a log of the category, so the return bonus is
      // out of the window for all fourteen rows that have one.
      expect(steps(calculation)).not.toContain("bonus");
      expect(steps(calculation)).not.toContain("decay");
      expect(calculation.hours).toBe(hasCooldown ? base / 2 : base);
      expect(steps(calculation).includes("cooldown")).toBe(hasCooldown);
    }

    expect(halved).toBe(6);
  });

  it("holds the asymptote of every duration row of the seed", () => {
    // "assíntota = taxa × decay_step_hours × 2". Twenty-four hours of one
    // activity in one day has to come within a hair of it and may never pass it.
    //
    // The bound is `<=` and not `<` on purpose, and the reason is D9 rather than
    // D2: Corpo's exact sum over 24h is 7,998, which is below the asymptote of 8
    // and rounds to it. The sum converges without reaching the limit, and the
    // two decimals the boy is shown cannot always say so.
    for (const { category, activity } of SEED_ROWS) {
      if (activity.calcMode !== "duration") continue;

      const asymptote =
        present(activity.value, `a value on ${activity.name}`) *
        present(category.decayStepHours, `a step on ${category.name}`) *
        2;
      const calculation = run({
        activity,
        category,
        occurredOn: SATURDAY,
        durationMinutes: 24 * ONE_HOUR_MINUTES,
        // Blocks the bonus, which is not what is being measured here.
        history: [
          approved({
            id: 200 + activity.id,
            occurredOn: day(SATURDAY, -1),
            activity,
            durationMinutes: ONE_HOUR_MINUTES,
          }),
        ],
      });

      expect(calculation.hours).toBeLessThanOrEqual(asymptote);
      expect(calculation.hours).toBeGreaterThan(asymptote - 0.01);
    }
  });

  it("never pays less for a longer sitting, on every step the seed uses", () => {
    // The steps and rates of the seed, over a whole day in five-minute
    // increments. The known floating-point violations of issue #26 live at
    // `decay_step_hours = 0,1` with a rate of 3,0, which the seed does not use;
    // these four configurations are clean and this is what says so.
    for (const { category, activity } of SEED_ROWS) {
      if (activity.calcMode !== "duration") continue;

      let previous = -1;

      for (let minutes = 5; minutes <= 12 * 60; minutes += 5) {
        const { hours } = calculateEarnedHours(
          input({
            activity,
            category,
            occurredOn: SATURDAY,
            durationMinutes: minutes,
            history: [
              approved({
                id: 300 + activity.id,
                occurredOn: day(SATURDAY, -1),
                activity,
                durationMinutes: ONE_HOUR_MINUTES,
              }),
            ],
          }),
        );

        expect(hours).toBeGreaterThanOrEqual(previous);
        previous = hours;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. the four rules, composed
// ---------------------------------------------------------------------------

/**
 * All sixteen combinations of grade, cooldown, decay and return bonus on one
 * entry.
 *
 * The finding this section exists to pin down: **D7's order is invisible in the
 * total.** Every step is a multiplication by a scalar that does not depend on
 * the running value — the decay factor is a function of the bucket and of the
 * hours, never of the hours already earned — so the product is the same in any
 * of the twenty-four orders. What D7 actually decides is the order of the
 * lines, and the number each line arrives at. So the assertions below are on
 * `runningTotals`, not only on `hours`: a table that checked the total alone
 * would pass with the bonus applied to the base value, which is the one thing
 * D7 was written to forbid.
 *
 * The activity is not from the seed, and cannot be: no seeded row is graded and
 * on a duration at once. The Configuração screen (#26) can create one, and the
 * engine has no business behaving differently when it does.
 */
describe("the four rules composed, all sixteen ways", () => {
  const composed: EngineCategory = {
    id: 90,
    name: "Composto",
    decayStepHours: 1,
    returnBonusPct: 0.5,
    returnBonusAfterDays: 3,
  };

  const composedActivity: EngineActivity = {
    id: 90,
    categoryId: 90,
    name: "Atividade composta",
    calcMode: "duration",
    value: 2,
    qualityGraded: true,
    repeatCooldownDays: 7,
  };

  /**
   * The same entry of five days ago in every one of the sixteen runs, so the
   * only thing that changes between them is which rules are switched on.
   *
   * Five days is the one distance that lets the cooldown and the bonus both be
   * observed: inside the seven-day cooldown window, outside the three-day bonus
   * window. And it is another day, so it fills no bucket.
   */
  const fiveDaysAgo = [
    approved({
      id: 91,
      occurredOn: day(SATURDAY, -5),
      activity: composedActivity,
      durationMinutes: ONE_HOUR_MINUTES,
    }),
  ];

  const cases = [
    { quality: 1, cooldown: false, decay: false, bonus: false, hours: 4 },
    { quality: 1, cooldown: false, decay: false, bonus: true, hours: 6 },
    { quality: 1, cooldown: false, decay: true, bonus: false, hours: 3 },
    { quality: 1, cooldown: false, decay: true, bonus: true, hours: 4.5 },
    { quality: 1, cooldown: true, decay: false, bonus: false, hours: 2 },
    { quality: 1, cooldown: true, decay: false, bonus: true, hours: 3 },
    { quality: 1, cooldown: true, decay: true, bonus: false, hours: 1.5 },
    { quality: 1, cooldown: true, decay: true, bonus: true, hours: 2.25 },
    { quality: 0.5, cooldown: false, decay: false, bonus: false, hours: 2 },
    { quality: 0.5, cooldown: false, decay: false, bonus: true, hours: 3 },
    { quality: 0.5, cooldown: false, decay: true, bonus: false, hours: 1.5 },
    { quality: 0.5, cooldown: false, decay: true, bonus: true, hours: 2.25 },
    { quality: 0.5, cooldown: true, decay: false, bonus: false, hours: 1 },
    { quality: 0.5, cooldown: true, decay: false, bonus: true, hours: 1.5 },
    { quality: 0.5, cooldown: true, decay: true, bonus: false, hours: 0.75 },
    // 1,125 exactly: the one combination that lands on a half cent, and the
    // one that says D9 rounds the chain once instead of rounding the lines.
    { quality: 0.5, cooldown: true, decay: true, bonus: true, hours: 1.13 },
  ] as const;

  for (const testCase of cases) {
    const label = [
      `nota ${testCase.quality}`,
      testCase.cooldown ? "cooldown" : "sem cooldown",
      testCase.decay ? "desgaste" : "sem desgaste",
      testCase.bonus ? "bônus" : "sem bônus",
    ].join(" · ");

    it(`pays ${testCase.hours}h for ${label}`, () => {
      const category: EngineCategory = {
        ...composed,
        decayStepHours: testCase.decay ? 1 : null,
        returnBonusPct: testCase.bonus ? 0.5 : 0,
        returnBonusAfterDays: testCase.bonus ? 3 : 0,
      };
      const activity: EngineActivity = {
        ...composedActivity,
        repeatCooldownDays: testCase.cooldown ? 7 : 0,
      };

      const calculation = run({
        activity,
        category,
        occurredOn: SATURDAY,
        durationMinutes: 2 * ONE_HOUR_MINUTES,
        quality: testCase.quality,
        history: fiveDaysAgo,
      });

      expect(calculation.hours).toBe(testCase.hours);

      // D7's chain, written out: base → grade → cooldown → decay → bonus, with
      // the steps that moved nothing left off the screen.
      const chain: { step: ExplanationLine["step"]; total: number }[] = [];
      let value = 4;
      chain.push({ step: "base", total: value });
      value *= testCase.quality;
      if (testCase.quality !== 1) chain.push({ step: "quality", total: value });
      if (testCase.cooldown) {
        value *= 0.5;
        chain.push({ step: "cooldown", total: value });
      }
      if (testCase.decay) {
        // Two hours from an empty bucket on a one-hour step: one hour at full
        // and one at half, so three quarters of the value survive.
        value *= 0.75;
        chain.push({ step: "decay", total: value });
      }
      if (testCase.bonus) {
        value *= 1.5;
        chain.push({ step: "bonus", total: value });
      }

      expect(steps(calculation)).toStrictEqual(chain.map((step) => step.step));
      expect(runningTotals(calculation)).toStrictEqual(
        chain.map((step) => Math.round(step.total * 100) / 100),
      );
    });
  }

  it("keeps the explanation readable when the decay folds its tail", () => {
    // A quarter-hour step is a configuration the Configuração screen can type,
    // and three hours of it crosses twelve bands. The rules still compose: the
    // grade, the cooldown and the bonus are all on, and the sum still closes.
    const calculation = run({
      activity: composedActivity,
      category: { ...composed, decayStepHours: 0.25 },
      occurredOn: SATURDAY,
      durationMinutes: 3 * ONE_HOUR_MINUTES,
      quality: 0.7,
      history: fiveDaysAgo,
    });

    expect(steps(calculation).filter((step) => step === "decay").length).toBe(
      8,
    );
    expect(steps(calculation)[0]).toBe("base");
    expect(steps(calculation)[1]).toBe("quality");
    expect(steps(calculation)[2]).toBe("cooldown");
    expect(steps(calculation).at(-1)).toBe("bonus");
    // No line of the eight may claim the hour is worth nothing (D2).
    expect(texts(calculation).join(" ")).not.toMatch(/\bnada\b/);
  });

  it("reads the same total whichever rule is switched on first", () => {
    // The mathematical fact behind the note on this describe, asserted so that
    // a future refactor that makes one step depend on another's output has to
    // announce itself: turning the four rules on in any order gives one number.
    const base = {
      activity: composedActivity,
      occurredOn: SATURDAY,
      durationMinutes: 2 * ONE_HOUR_MINUTES,
      quality: 0.5,
      history: fiveDaysAgo,
    };

    const all = run({ ...base, category: composed }).hours;

    expect(all).toBe(1.13);
    expect(all).toBe(Math.round(4 * 0.5 * 0.5 * 0.75 * 1.5 * 100) / 100);
  });
});

// ---------------------------------------------------------------------------
// 4. a whole plausible day
// ---------------------------------------------------------------------------

/**
 * Kid1's Saturday, read end to end.
 *
 * Football in the morning, a book in the afternoon, comics in the evening and
 * the homework in between. Nothing here is a corner case; the point is that the
 * five numbers add up to a day a fourteen-year-old would recognise, and that the
 * explanations, read in the order they were written, tell one story instead of
 * five.
 */
describe("Kid1's Saturday", () => {
  const { category: corpo, activity: futebol } = seedRow(1);
  const { category: mente, activity: lerLivro } = seedRow(5);
  const { activity: hq } = seedRow(6);
  const { category: escola, activity: licaoDeCasa } = seedRow(23);

  // The week behind the Saturday: football on Thursday and a book on Wednesday,
  // so neither category is coming back from a three-day absence.
  const theWeek = [
    approved({
      id: 1,
      occurredOn: day(SATURDAY, -3),
      activity: lerLivro,
      durationMinutes: 60,
    }),
    approved({
      id: 2,
      occurredOn: day(SATURDAY, -2),
      activity: futebol,
      durationMinutes: 60,
    }),
  ];

  it("adds up to a day that makes sense", () => {
    const history = [...theWeek];
    const results: Calculation[] = [];

    const entry = (
      overrides: Parameters<typeof input>[0],
      logged: { id: number; durationMinutes?: number | null },
    ) => {
      const calculation = run({ ...overrides, history: [...history] });

      results.push(calculation);
      history.push(
        approved({
          id: logged.id,
          occurredOn: overrides.occurredOn,
          activity: overrides.activity,
          durationMinutes: logged.durationMinutes ?? null,
        }),
      );

      return calculation;
    };

    // 09:00 — a two-hour match. Corpo's step is two hours on purpose, so the
    // whole match pays full: 3h.
    const match = entry(
      {
        activity: futebol,
        category: corpo,
        occurredOn: SATURDAY,
        durationMinutes: 120,
      },
      { id: 10, durationMinutes: 120 },
    );

    // 15:00 — an hour and a half of reading. The first hour is full, the last
    // half hour is halved: 2,25h − 0,375h = 1,88h.
    const book = entry(
      {
        activity: lerLivro,
        category: mente,
        occurredOn: SATURDAY,
        durationMinutes: 90,
      },
      { id: 11, durationMinutes: 90 },
    );

    // 17:00 — the homework. A delivery in a category that decays, graded 0,7,
    // and none of the afternoon's Mente hours touch it.
    const homework = entry(
      {
        activity: licaoDeCasa,
        category: escola,
        occurredOn: SATURDAY,
        quality: 0.7,
      },
      { id: 12 },
    );

    // 20:00 — an hour of comics, on a Mente bucket that already holds 1,5h.
    // 1,5 an hour, half of it for the first half hour and a quarter for the
    // second: 0,56h.
    const comics = entry(
      {
        activity: hq,
        category: mente,
        occurredOn: SATURDAY,
        durationMinutes: 60,
      },
      { id: 13, durationMinutes: 60 },
    );

    expect([
      match.hours,
      book.hours,
      homework.hours,
      comics.hours,
    ]).toStrictEqual([3, 1.88, 0.7, 0.56]);

    const total = results.reduce((sum, entry) => sum + entry.hours, 0);

    expect(Math.round(total * 100) / 100).toBe(6.14);
    // A big Saturday, and still under a day's worth of screen: the model is a
    // tap that closes, not a door.
    expect(total).toBeLessThan(12);
  });

  it("tells one story when the lines are read in order", () => {
    const history = [...theWeek];

    const match = run({
      activity: futebol,
      category: corpo,
      occurredOn: SATURDAY,
      durationMinutes: 120,
      history: [...history],
    });

    history.push(
      approved({
        id: 10,
        occurredOn: SATURDAY,
        activity: futebol,
        durationMinutes: 120,
      }),
    );

    const book = run({
      activity: lerLivro,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: 90,
      history: [...history],
    });

    history.push(
      approved({
        id: 11,
        occurredOn: SATURDAY,
        activity: lerLivro,
        durationMinutes: 90,
      }),
    );

    const comics = run({
      activity: hq,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: 60,
      history: [...history],
    });

    expect(texts(match)).toStrictEqual([
      "Futebol ou outro esporte coletivo, 2h × 1,5 — cheio",
    ]);
    expect(texts(book)).toStrictEqual([
      "Ler livro, 1,5h × 1,5 — cheio",
      "metade, de 1h a 2h de Mente no dia",
    ]);
    expect(texts(comics)).toStrictEqual([
      "Ler quadrinhos ou HQ, 1h × 1,5 — você já fez 1,5h de Mente hoje",
      "metade, de 1h a 2h de Mente no dia",
      "um quarto, de 2h a 3h de Mente no dia",
    ]);

    // The two categories keep separate accounts and the screen says so: the
    // match says "cheio" on the same day the comics say "um quarto", and the
    // only bucket either line ever names is its own category's.
    expect(texts(match).join(" ")).not.toContain("Mente");
    expect(texts(comics).join(" ")).not.toContain("Corpo");

    // The day the boy has actually had is quoted once per entry, on the base
    // line, and it only ever goes up: nothing on Mente when the match is
    // simulated, "cheio" for the book, 1,5h by the time the comics are. The
    // lines under it describe the rule and are the same sentence whichever
    // entry crosses the band — which is what stops the screen from telling him
    // he already read hours that are, in fact, the ones he is simulating.
    const quoted = [...texts(match), ...texts(book), ...texts(comics)]
      .map((text) => /você já fez ([\d,]+)h de Mente hoje/.exec(text)?.[1])
      .filter((figure): figure is string => figure !== undefined)
      .map((figure) => Number(figure.replace(",", ".")));

    expect(quoted).toStrictEqual([1.5]);
    expect(texts(book).join(" ")).not.toContain("já fez");

    // No line ever claims an hour the boy has not had. The bucket the base line
    // names is the one he arrived with; every other figure on the screen is a
    // boundary of the rule, and is introduced as one.
    for (const calculation of [match, book, comics]) {
      for (const line of calculation.lines) {
        if (line.step !== "decay") continue;

        expect(line.text).toMatch(/^[^,]+, (de [\d,]+h a|depois de) /);
        expect(line.text).not.toContain("já fez");
      }
    }
  });

  it("says 'cheio' exactly when the entry starts in the undecayed band", () => {
    // The one word on the screen that is a claim about the whole entry rather
    // than about its first hour. It is true of where the session starts, and the
    // line under it is what corrects it — so the rule has to be pinned, or the
    // next reader will read it as "this entry was not decayed".
    const fresh = run({
      activity: lerLivro,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: 120,
      history: [...theWeek],
    });

    const midBucket = run({
      activity: lerLivro,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: 60,
      history: [
        ...theWeek,
        approved({
          id: 20,
          occurredOn: SATURDAY,
          activity: lerLivro,
          durationMinutes: 90,
        }),
      ],
    });

    expect(fresh.lines[0]?.text).toContain("cheio");
    expect(fresh.hours).toBe(2.25);
    expect(midBucket.lines[0]?.text).not.toContain("cheio");

    // And when it is not "cheio" the base line says what it is instead. This
    // is the only figure on the screen about the boy's own day, so a base line
    // that just names the activity leaves the 1h30 he already read nowhere.
    expect(midBucket.lines[0]?.text).toBe(
      "Ler livro, 1h × 1,5 — você já fez 1,5h de Mente hoje",
    );
  });

  it("never tells the boy he did hours he is only simulating", () => {
    // The contradiction the round-2 review measured, and the reason this file
    // has a case of its own for it: on an empty bucket the base line said
    // "cheio" and the line directly under it said "você já fez 2h de Escola
    // hoje". Both were about the same entry, one of them was false at the
    // instant it was read, and the boy it was written for had done nothing at
    // all that day.
    //
    // "Já fez" is a claim about his history, so it may appear only where his
    // history is: on the base line, and only when the bucket he arrived with is
    // not empty. Every decay line is a statement about the rule and is bounded
    // like one.
    const { category: escola, activity: estudo } = seedRow(25);

    for (const [activity, category, durationMinutes] of [
      [estudo, escola, 180],
      [lerLivro, mente, 60],
      [lerLivro, mente, 180],
      [lerLivro, mente, 360],
      [lerLivro, mente, 20 * ONE_HOUR_MINUTES],
    ] as const) {
      const calculation = run({
        activity,
        category,
        occurredOn: SATURDAY,
        durationMinutes,
        // Nothing today, and nothing this week: whatever the lines say he has
        // already done, he has not.
        history: [],
      });

      const [base, ...rest] = calculation.lines;

      expect(base?.text, `${activity.name}, ${durationMinutes}min`).toContain(
        "cheio",
      );

      for (const line of rest) {
        expect(
          line.text,
          `${activity.name}, ${durationMinutes}min`,
        ).not.toMatch(/já fez \d/);
      }
    }

    // The same run, from a bucket that is real: now "já fez" is the truth, it
    // is on the base line, and it appears exactly once.
    const afterTwoHours = run({
      activity: lerLivro,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: 180,
      history: [
        approved({
          id: 70,
          occurredOn: SATURDAY,
          activity: lerLivro,
          durationMinutes: 2 * ONE_HOUR_MINUTES,
        }),
      ],
    });

    expect(texts(afterTwoHours)).toStrictEqual([
      "Ler livro, 3h × 1,5 — você já fez 2h de Mente hoje",
      "um quarto, de 2h a 3h de Mente no dia",
      "um oitavo, de 3h a 4h de Mente no dia",
      "cada vez menos, de 4h a 5h de Mente no dia",
    ]);
  });

  it("keeps Kid2's Saturday out of Kid1's (D19, and the access rule)", () => {
    expect(() =>
      calculateEarnedHours(
        input({
          activity: lerLivro,
          category: mente,
          occurredOn: SATURDAY,
          durationMinutes: 60,
          userId: KID1,
          history: [
            approved({
              id: 30,
              occurredOn: SATURDAY,
              activity: lerLivro,
              durationMinutes: 240,
              userId: KID2,
            }),
          ],
        }),
      ),
    ).toThrow(/user/);
  });
});

// ---------------------------------------------------------------------------
// 5. the text, as product
// ---------------------------------------------------------------------------

describe("the explanation, read as product", () => {
  it("names the activity on the first line of every seeded row", () => {
    for (const { category, activity } of SEED_ROWS) {
      const calculation = run({
        activity,
        category,
        occurredOn: SATURDAY,
        ...modeInputs(activity),
      });

      expect(calculation.lines[0]?.step).toBe("base");
      expect(calculation.lines[0]?.text.startsWith(activity.name)).toBe(true);
    }
  });

  it("shows a base line whose own multiplication closes, minute by minute", () => {
    // The boy checks the first line with his own arithmetic. "23min × 1,5" has
    // to be readable as 34,5min, and "0,38h × 1,5" is not 0,58h — so the line
    // may never show a factor it had to round.
    const { category: mente, activity: lerLivro } = seedRow(5);

    for (let minutes = 1; minutes <= 180; minutes += 1) {
      const calculation = run({
        activity: lerLivro,
        category: mente,
        occurredOn: SATURDAY,
        durationMinutes: minutes,
        history: [
          approved({
            id: 40,
            occurredOn: day(SATURDAY, -1),
            activity: lerLivro,
            durationMinutes: 60,
          }),
        ],
      });

      const baseLine = present(calculation.lines[0], "a base line");
      const match = present(
        /, ([\d,]+)(h|min) × ([\d,]+)/.exec(baseLine.text),
        `a "duração × taxa" in ${baseLine.text}`,
      );

      const duration = Number(
        present(match[1], "a duration").replace(",", "."),
      );
      const rate = Number(present(match[3], "a rate").replace(",", "."));
      const minutesPerUnit = match[2] === "h" ? 1 : 60;

      // The product the boy computes from the line is the number the line is
      // worth, to the cent. In integer hundredths, so 0,15h × 1,5 is 22,5
      // cents and not the double just under it.
      const product =
        (Math.round(duration * 100) * Math.round(rate * 100)) /
        (100 * minutesPerUnit);

      expect(Math.round(product) / 100).toBe(baseLine.hours);
    }
  });

  it("never says an hour is worth nothing, however deep the bucket (D2)", () => {
    const { category: mente, activity: lerLivro } = seedRow(5);

    for (const bucketHours of [4, 8, 12, 20, 40]) {
      const calculation = run({
        activity: lerLivro,
        category: mente,
        occurredOn: SATURDAY,
        durationMinutes: 60,
        history: [
          approved({
            id: 50,
            occurredOn: SATURDAY,
            activity: lerLivro,
            durationMinutes: bucketHours * 60,
          }),
        ],
      });

      // "sem piso e sem teto": the hour keeps its own line, the total is never
      // negative, and no line calls it worthless. Forty hours in, an hour is
      // worth 2 / 2^40 and rounds to 0,00h — which is a legal approved log and
      // still not the word "nada".
      expect(calculation.hours).toBeGreaterThanOrEqual(0);
      expect(texts(calculation).join(" ")).not.toMatch(/\bnada\b/);
      expect(steps(calculation)).toContain("decay");
    }
  });

  it("names the halving only while Portuguese has a word for it (D2)", () => {
    // The line is read at a glance by a fourteen-year-old, so the fraction is
    // named while there is a name — "metade", "um quarto", "um oitavo" — and
    // described after that. There is no everyday word for 1/16, and the numeral
    // that used to stand in for one carried nothing the boy could act on: he
    // read "1/256" after eight hours of Mente and "1/1099511627776" after
    // forty, both of which say less than "cada vez menos" does.
    const { category: mente, activity: lerLivro } = seedRow(5);

    const bandAt = (bucketHours: number): string => {
      const calculation = run({
        activity: lerLivro,
        category: mente,
        occurredOn: SATURDAY,
        durationMinutes: ONE_HOUR_MINUTES,
        history: [
          approved({
            id: 60,
            occurredOn: day(SATURDAY, -1),
            activity: lerLivro,
            durationMinutes: ONE_HOUR_MINUTES,
          }),
          approved({
            id: 61,
            occurredOn: SATURDAY,
            activity: lerLivro,
            durationMinutes: bucketHours * ONE_HOUR_MINUTES,
          }),
        ],
      });

      return present(
        calculation.lines.find((line) => line.step === "decay"),
        `a decay line on a bucket of ${bucketHours}h`,
      ).text;
    };

    expect(bandAt(1)).toBe("metade, de 1h a 2h de Mente no dia");
    expect(bandAt(2)).toBe("um quarto, de 2h a 3h de Mente no dia");
    expect(bandAt(3)).toBe("um oitavo, de 3h a 4h de Mente no dia");

    // The fourth halving is where the words run out. Four hours of Mente in a
    // day is the rainy Sunday D2 argues from, not a corner case.
    expect(bandAt(4)).toBe("cada vez menos, de 4h a 5h de Mente no dia");
    expect(bandAt(8)).toBe("cada vez menos, de 8h a 9h de Mente no dia");
    // The bucket that used to print "1/1099511627776".
    expect(bandAt(40)).toBe("cada vez menos, de 40h a 41h de Mente no dia");
  });

  it("describes one depth of decay one way, however the entry reached it", () => {
    // The contradiction the numeral left on the screen: `MAX_DECAY_LINES` folds
    // the tail with the same words the deep bands are named with, so a single
    // explanation used to print "1/128, você já fez 7h" directly above "cada
    // vez menos, você já fez 8h". Nothing separated them but the line budget.
    const { category: mente, activity: lerLivro } = seedRow(5);

    const marathon = run({
      activity: lerLivro,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: 20 * ONE_HOUR_MINUTES,
      history: [
        approved({
          id: 62,
          occurredOn: day(SATURDAY, -1),
          activity: lerLivro,
          durationMinutes: ONE_HOUR_MINUTES,
        }),
      ],
    });

    const decayLines = marathon.lines
      .filter((line) => line.step === "decay")
      .map((line) => line.text);

    expect(decayLines).toStrictEqual([
      "metade, de 1h a 2h de Mente no dia",
      "um quarto, de 2h a 3h de Mente no dia",
      "um oitavo, de 3h a 4h de Mente no dia",
      "cada vez menos, de 4h a 5h de Mente no dia",
      "cada vez menos, de 5h a 6h de Mente no dia",
      "cada vez menos, de 6h a 7h de Mente no dia",
      "cada vez menos, de 7h a 8h de Mente no dia",
      "cada vez menos, depois de 8h de Mente no dia",
    ]);

    // The last line is the folded tail and the one above it is a band of its
    // own, and they are named alike because the depth of decay is the same
    // thing. Only the bound differs, and it differs truthfully: the band above
    // covers one hour, the fold covers everything after eight.
    expect(marathon.hours).toBe(3);
  });

  it("folds the tail into one line instead of filling the screen", () => {
    // A session that crosses more bands than a phone can show: the deep tail
    // gets one line, and that line says the value keeps falling rather than that
    // it stopped being worth anything (D2).
    const { category: mente, activity: lerLivro } = seedRow(5);

    const calculation = run({
      activity: lerLivro,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: 20 * 60,
      history: [
        approved({
          id: 51,
          occurredOn: day(SATURDAY, -1),
          activity: lerLivro,
          durationMinutes: 60,
        }),
      ],
    });

    expect(steps(calculation).filter((step) => step === "decay").length).toBe(
      8,
    );
    expect(texts(calculation).at(-1)).toContain("cada vez menos");
    expect(texts(calculation).join(" ")).not.toMatch(/\bnada\b/);
  });

  it("leaves out the steps that changed nothing", () => {
    // A grade of 1,0 is not a step the boy needs read to him, and a "+50%" line
    // worth 0h reads like a bonus that was taken away.
    const { category: casa, activity: lavarOCarro } = seedRow(26);

    const fullMarks = run({
      activity: lavarOCarro,
      category: casa,
      occurredOn: SATURDAY,
      quality: FULL_MARKS,
      history: [],
    });

    expect(steps(fullMarks)).toStrictEqual(["base"]);
    expect(fullMarks.hours).toBe(3);
  });

  it("writes the window in words a boy reads, not in the column's units", () => {
    const { category: casa, activity: lavarOCarro } = seedRow(26);

    const sameDay = run({
      activity: lavarOCarro,
      category: casa,
      occurredOn: SATURDAY,
      quality: FULL_MARKS,
      history: [
        approved({ id: 60, occurredOn: SATURDAY, activity: lavarOCarro }),
      ],
    });

    expect(texts(sameDay)).toContain(
      "metade, você fez isso outra vez em 7 dias",
    );
  });

  it("says how long the boy has been away, and never invents the number", () => {
    const { category: corpo, activity: futebol } = seedRow(1);

    const known = run({
      activity: futebol,
      category: corpo,
      occurredOn: SATURDAY,
      durationMinutes: 60,
      history: [
        approved({
          id: 70,
          occurredOn: day(SATURDAY, -5),
          activity: futebol,
          durationMinutes: 60,
        }),
      ],
    });

    expect(texts(known).at(-1)).toBe("+50%, faz 5 dias que você não faz Corpo");

    const unknown = run({
      activity: futebol,
      category: corpo,
      occurredOn: SATURDAY,
      durationMinutes: 60,
      history: [],
      historyFrom: day(SATURDAY, -10),
      categoryFirstDay: day(SATURDAY, -40),
    });

    // Nothing in the input says when the last Corpo entry was, so the line says
    // what the input does say and not a day it would have had to invent.
    expect(texts(unknown).at(-1)).toBe(
      "+50%, faz mais de 10 dias que você não faz Corpo",
    );
  });
});

describe("the return bonus needs a return (#113, D47)", () => {
  const { category: mente, activity: lerLivro } = seedRow(5);
  const { activity: futebol } = seedRow(1);

  const mente1h = (history: ReturnType<typeof approved>[]) =>
    run({
      activity: lerLivro,
      category: mente,
      occurredOn: SATURDAY,
      durationMinutes: ONE_HOUR_MINUTES,
      history,
    });

  it("pays no bonus on the category's debut", () => {
    const debut = mente1h([]);

    expect(debut.hours).toBe(1.5);
    expect(steps(debut)).toStrictEqual(["base"]);
  });

  it("pays no bonus on a debut, whatever other categories were done before", () => {
    const debut = mente1h([
      approved({
        id: 1,
        occurredOn: day(SATURDAY, -20),
        activity: futebol,
        durationMinutes: 60,
      }),
    ]);

    expect(steps(debut)).toStrictEqual(["base"]);
  });

  it("pays no bonus on the second entry of the debut day", () => {
    const second = mente1h([
      approved({
        id: 1,
        occurredOn: SATURDAY,
        activity: lerLivro,
        durationMinutes: 60,
      }),
    ]);

    expect(second.hours).toBe(0.75);
    expect(steps(second)).toStrictEqual(["base", "decay"]);
  });

  it("pays no bonus exactly the window after the debut: the window's first day counts (D6)", () => {
    const back = mente1h([
      approved({
        id: 1,
        occurredOn: day(SATURDAY, -mente.returnBonusAfterDays),
        activity: lerLivro,
        durationMinutes: 60,
      }),
    ]);

    expect(back.hours).toBe(1.5);
    expect(steps(back)).toStrictEqual(["base"]);
  });

  it("pays the bonus one day past the window", () => {
    const back = mente1h([
      approved({
        id: 1,
        occurredOn: day(SATURDAY, -mente.returnBonusAfterDays - 1),
        activity: lerLivro,
        durationMinutes: 60,
      }),
    ]);

    expect(back.hours).toBe(2.25);
    expect(texts(back).at(-1)).toBe("+50%, faz 4 dias que você não faz Mente");
  });

  it("pays no bonus on a past day whose only earlier-frozen entry is on a later day (D34)", () => {
    // Launched onto Saturday after Thursday-week was approved: frozen after it,
    // but nothing of Mente happened before Saturday, so it is still the debut.
    const later = approved({
      id: 1,
      occurredOn: day(SATURDAY, 5),
      activity: lerLivro,
      durationMinutes: 60,
    });

    const launched = mente1h([later]);

    expect(launched.hours).toBe(1.5);
    expect(steps(launched)).toStrictEqual(["base"]);
  });
});
