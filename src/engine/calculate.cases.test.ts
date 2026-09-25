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
 * The case table of #11, written against `decisions.md` and never against the
 * engine. Every line goes through `expectReadable`: the boy reads them.
 */

const SATURDAY = "2026-03-14";

/** D9 as an invariant: the lines are addends, and their sum is the total exactly. */
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

/** "nada" by name: D2's whole point is that the boy never hears it. */
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

/** The partial sums the boy computes reading down: the only place D7's order shows. */
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

describe("the acceptance criteria of #11", () => {
  const { category: mente, activity: lerLivro } = seedRow(5);
  const { activity: hq } = seedRow(6);
  const { activity: xadrez } = seedRow(7);

  /**
   * Mente done yesterday, so the seed's 50% return bonus stays out of the way of
   * the decay table being measured.
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
    // The bucket walks 0h · 1h · 2h · 3h: 1,5 · 0,75 · 0,375 · 0,1875, rounded once.
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
    // The asymptote is taxa × passo × 2 = 3h.
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
    // Per activity each would pay full; per category the third is two halvings deep.
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
    // Read off the row's minutes, not the live `calc_mode` (D37): flipping "Ler
    // livro" to `fixed` once paid the same afternoon twice. Every non-duration log
    // carries null minutes, so the two readings agree on every row this app writes.
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
    // Exactly zero, which `ledger_hours_check` (> 0) cannot hold: no ledger line.
    expect(calculation.hours > 0).toBe(false);
    expect(steps(calculation)).toStrictEqual(["base", "quality"]);
    expect(runningTotals(calculation)).toStrictEqual([1, 0]);
  });

  it("pays each of a day's sittings out of what the ones before it spent (D34)", () => {
    // Three Mente sittings, each frozen after the one before it (D34).
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

    // Same set, same number (D8).
    expect(frozenAfter(1)).toBe(0.75);

    // And nothing already frozen is a function of what is calculated later:
    // the second sitting's 0,75 h stands whatever the third one reads (D15).
    expect(frozenAfter(2)).toBe(0.38);
  });

  it("closes the sum of the lines against the total, over every row of the seed", () => {
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

describe("the seed of src/db/seed.ts, every row", () => {
  it("seeds seven categories and thirty-two activities", () => {
    expect(SEED_ROWS).toHaveLength(32);
    expect(new Set(SEED_ROWS.map(({ category }) => category.id)).size).toBe(7);
  });

  it("pays the first entry of the day the value the table promises", () => {
    // Every category last done a month ago: only the return bonus fires.
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
    // Done again yesterday. Zero is the cooldown's off switch (D6, Fase 1).
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
    // `<=`, not `<`, because of D9: Corpo's 24h is 5,9985, just under its
    // asymptote of 6, and rounds to it.
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

/**
 * D7's order is invisible in the total, since every step is a scalar: only
 * `runningTotals` would catch the bonus applied to the base value.
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
   * Five days ago: inside the seven-day cooldown, outside the three-day bonus
   * window, and in another day's bucket.
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
    // A quarter-hour step crosses twelve bands in three hours; the rules still compose.
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
    // Pinned so a refactor that makes one step read another's output announces itself.
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

/** Kid1's Saturday, read end to end: nothing here is a corner case. */
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

    // Each line names only its own category's bucket: the match says "cheio" on
    // the day the comics say "um quarto".
    expect(texts(match).join(" ")).not.toContain("Mente");
    expect(texts(comics).join(" ")).not.toContain("Corpo");

    // The boy's own day is quoted once per entry, on the base line, and only goes
    // up; the decay lines state the rule, so he is never told he read what he simulates.
    const quoted = [...texts(match), ...texts(book), ...texts(comics)]
      .map((text) => /você já fez ([\d,]+)h de Mente hoje/.exec(text)?.[1])
      .filter((figure): figure is string => figure !== undefined)
      .map((figure) => Number(figure.replace(",", ".")));

    expect(quoted).toStrictEqual([1.5]);
    expect(texts(book).join(" ")).not.toContain("já fez");

    // The base line names the bucket he arrived with; every other figure is a
    // bound of the rule.
    for (const calculation of [match, book, comics]) {
      for (const line of calculation.lines) {
        if (line.step !== "decay") continue;

        expect(line.text).toMatch(/^[^,]+, (de [\d,]+h a|depois de) /);
        expect(line.text).not.toContain("já fez");
      }
    }
  });

  it("says 'cheio' exactly when the entry starts in the undecayed band", () => {
    // "cheio" is about where the session starts; the line under it corrects it.
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

    // Otherwise the base line is the only figure about the boy's own day.
    expect(midBucket.lines[0]?.text).toBe(
      "Ler livro, 1h × 1,5 — você já fez 1,5h de Mente hoje",
    );
  });

  it("never tells the boy he did hours he is only simulating", () => {
    // "Já fez" is a claim about his history, so it appears only on the base line,
    // and only when the bucket he arrived with is not empty.
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
    // The boy checks the first line himself, so it may never show a factor it had
    // to round: "0,38h × 1,5" is not 0,58h.
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

      // In integer hundredths, so 0,15h × 1,5 is 22,5 cents and not the double under it.
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

      // Forty hours in, an hour is worth 2 / 2^40 and rounds to 0,00h: a legal log,
      // and still not "nada".
      expect(calculation.hours).toBeGreaterThanOrEqual(0);
      expect(texts(calculation).join(" ")).not.toMatch(/\bnada\b/);
      expect(steps(calculation)).toContain("decay");
    }
  });

  it("names the halving only while Portuguese has a word for it (D2)", () => {
    // Named while Portuguese has a word: "1/256" said less than "cada vez menos".
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
    expect(bandAt(40)).toBe("cada vez menos, de 40h a 41h de Mente no dia");
  });

  it("describes one depth of decay one way, however the entry reached it", () => {
    // The fold and the deep bands share their words, so one depth reads one way.
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

    // Named alike because the depth is the same; only the bound differs, truthfully.
    expect(marathon.hours).toBe(3);
  });

  it("folds the tail into one line instead of filling the screen", () => {
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
