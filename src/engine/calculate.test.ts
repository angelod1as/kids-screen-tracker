import { describe, expect, it } from "vitest";

import {
  type ApprovedLog,
  type CalculationInput,
  calculateEarnedHours,
  type EngineActivity,
  type EngineCategory,
  historyLookbackDays,
  historyWindowEnd,
  historyWindowStart,
  saoPauloDay,
  shiftDate,
} from "./calculate";

/**
 * The proof that what this module ships does what D1–D10 say, and nothing more:
 * the exhaustive table of cases is issue #11, written by someone who did not
 * write the engine on purpose.
 *
 * Two fixtures for Mente, one with the return bonus and one without: the decay
 * table in `decisions.md` is about decay alone, and a bonus firing on the first
 * entry of the day would quietly turn 2h into 3h and hide what is being
 * measured.
 */

const menteNoBonus: EngineCategory = {
  id: 1,
  name: "Mente",
  decayStepHours: 1,
  returnBonusPct: 0,
  returnBonusAfterDays: 0,
};

/** `return_bonus_pct` is a fraction, the way the seed (#9) stores it: 0,5 = +50%. */
const corpo: EngineCategory = {
  id: 2,
  name: "Corpo",
  decayStepHours: 2,
  returnBonusPct: 0.5,
  returnBonusAfterDays: 3,
};

const casa: EngineCategory = {
  id: 3,
  name: "Casa",
  decayStepHours: null,
  returnBonusPct: 0,
  returnBonusAfterDays: 0,
};

const lerLivro: EngineActivity = {
  id: 10,
  categoryId: 1,
  name: "Ler livro",
  calcMode: "duration",
  value: 2,
  qualityGraded: false,
  repeatCooldownDays: 0,
};

const xadrez: EngineActivity = { ...lerLivro, id: 11, name: "Xadrez" };

const futebol: EngineActivity = {
  id: 20,
  categoryId: 2,
  name: "Futebol",
  calcMode: "duration",
  value: 2,
  qualityGraded: false,
  repeatCooldownDays: 0,
};

const lavarOCarro: EngineActivity = {
  id: 30,
  categoryId: 3,
  name: "Lavar o carro",
  calcMode: "delivery",
  value: 3,
  qualityGraded: true,
  repeatCooldownDays: 7,
};

const sairComAmigos: EngineActivity = {
  id: 31,
  categoryId: 3,
  name: "Sair com os amigos",
  calcMode: "fixed",
  value: 3,
  qualityGraded: false,
  repeatCooldownDays: 0,
};

/**
 * A duration activity that is graded and carries a cooldown, so that one entry
 * runs base → nota → cooldown and the rounding has three lines to spread over.
 */
const estudo: EngineActivity = {
  id: 40,
  categoryId: 1,
  name: "Estudo para prova",
  calcMode: "duration",
  value: 1,
  qualityGraded: true,
  repeatCooldownDays: 7,
};

const DAY = "2026-09-01";
/**
 * The widest window any fixture here needs: Casa's seven-day cooldown. Handing
 * over more history than the rules ask for is allowed; less is refused.
 */
const WINDOW = shiftDate(DAY, -7);
/**
 * The far end of the same window (D34).
 *
 * An entry counts what was frozen before it, and that can sit on a later day
 * than its own — so the window has two ends and the engine refuses a history
 * that stops short of either.
 */
const WINDOW_END = shiftDate(DAY, 7);
/** A category done long before any window here: every entry can be a return (D47). */
const LONG_AGO = "2000-01-01";
const KID1 = 1;
const KID2 = 2;

let nextId = 100;

function log(
  activity: EngineActivity,
  overrides: Partial<ApprovedLog> = {},
): ApprovedLog {
  nextId += 1;

  return {
    id: nextId,
    userId: KID1,
    status: "approved",
    occurredOn: DAY,
    activityId: activity.id,
    categoryId: activity.categoryId,
    durationMinutes: activity.calcMode === "duration" ? 60 : null,
    createdAt: new Date(nextId),
    ...overrides,
  };
}

/**
 * Every result has to satisfy D9, so every result in this file is checked.
 *
 * Added in whole cents, which is how the boy adds them up on the screen.
 * Rounding the sum before comparing — which this used to do — forgives a line
 * that is a cent off, and a line that is a cent off is the whole failure mode
 * D9 is about.
 */
function earn(input: CalculationInput) {
  const result = calculateEarnedHours(input);
  const cents = result.lines.reduce(
    (total, line) => total + Math.round(line.hours * 100),
    0,
  );

  expect(cents).toBe(Math.round(result.hours * 100));

  return result;
}

describe("decay", () => {
  it("reproduces the table in decisions.md: 2h, 1h, 0,5h, 0,25h", () => {
    const history: ApprovedLog[] = [];
    const earned: number[] = [];

    for (let hour = 0; hour < 4; hour += 1) {
      earned.push(
        earn({
          userId: KID1,
          activity: lerLivro,
          category: menteNoBonus,
          occurredOn: DAY,
          durationMinutes: 60,
          historyFrom: WINDOW,
          historyTo: WINDOW_END,
          categoryFirstDay: LONG_AGO,
          history,
        }).hours,
      );
      history.push(log(lerLivro));
    }

    expect(earned).toEqual([2, 1, 0.5, 0.25]);
  });

  it("prorates an entry that crosses a band: 2h reads 3h, not 4h nor 2h", () => {
    const result = earn({
      userId: KID1,
      activity: lerLivro,
      category: menteNoBonus,
      occurredOn: DAY,
      durationMinutes: 120,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [],
    });

    expect(result.hours).toBe(3);
    expect(result.lines).toEqual([
      { step: "base", text: "Ler livro, 2h × 2,0 — cheio", hours: 4 },
      {
        step: "decay",
        text: "metade, de 1h a 2h de Mente no dia",
        hours: -1,
      },
    ]);
  });

  it("converges on the asymptote instead of stopping: 6h reads 3,94h", () => {
    const single = earn({
      userId: KID1,
      activity: lerLivro,
      category: menteNoBonus,
      occurredOn: DAY,
      durationMinutes: 360,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [],
    });

    expect(single.hours).toBe(3.94);
    // rate × step × 2 = 4, approached and never reached (D2).
    expect(single.hours).toBeLessThan(4);

    const history: ApprovedLog[] = [];
    let split = 0;

    for (let hour = 0; hour < 6; hour += 1) {
      split += earn({
        userId: KID1,
        activity: lerLivro,
        category: menteNoBonus,
        occurredOn: DAY,
        durationMinutes: 60,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history,
      }).hours;
      history.push(log(lerLivro));
    }

    // D3: sessions add up — six separate hours land where one six-hour one does.
    expect(Math.round(split * 100) / 100).toBe(3.94);
  });

  it("never pays less for more activity, however small the step (D2)", () => {
    // `decay_step_hours` is only `> 0` in the schema, and the Configuração
    // screen (#26) reaches it: 0,1h puts fifty-odd bands under one session.
    // Taking each band's loss off a running value drifted ~1e-15 upwards along
    // that chain, and 292 minutes paid less than 291 — the exact answer is 0,27
    // for all three. Adding up what survives is what keeps this true.
    const fineStep: EngineCategory = { ...menteNoBonus, decayStepHours: 0.1 };
    const slowRate: EngineActivity = { ...lerLivro, value: 1.5 };
    const history = [log(slowRate, { durationMinutes: 1 })];
    const at = (durationMinutes: number) =>
      earn({
        userId: KID1,
        activity: slowRate,
        category: fineStep,
        occurredOn: DAY,
        durationMinutes,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history,
      }).hours;

    expect([at(291), at(292), at(293)]).toEqual([0.27, 0.27, 0.27]);

    let previous = 0;

    for (let minutes = 1; minutes <= 600; minutes += 1) {
      const hours = at(minutes);

      expect(hours).toBeGreaterThanOrEqual(previous);
      previous = hours;
    }
  });

  it("measures the bucket in hours of activity, not in logs (D1)", () => {
    // Every fixture used to be exactly one hour, which makes "hours of
    // activity" and "number of logs" the same rule. Half an hour already read,
    // then a full hour: the first half hour of the session is still in the
    // undecayed band, so it is 1,5h. Counting logs would say the bucket holds
    // one step and pay 1h.
    expect(
      earn({
        userId: KID1,
        activity: lerLivro,
        category: menteNoBonus,
        occurredOn: DAY,
        durationMinutes: 60,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [log(lerLivro, { durationMinutes: 30 })],
      }).lines,
    ).toEqual([
      { step: "base", text: "Ler livro, 1h × 2,0 — cheio", hours: 2 },
      {
        step: "decay",
        text: "metade, de 1h a 2h de Mente no dia",
        hours: -0.5,
      },
    ]);

    // Three ten-minute logs are half an hour whatever their number, and one
    // fifty-minute log is more bucket than three ten-minute ones.
    const half = [10, 10, 10].map((durationMinutes) =>
      log(lerLivro, { durationMinutes }),
    );
    const fifty = [log(lerLivro, { durationMinutes: 50 })];
    const readAfter = (history: ApprovedLog[]) =>
      earn({
        userId: KID1,
        activity: lerLivro,
        category: menteNoBonus,
        occurredOn: DAY,
        durationMinutes: 60,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history,
      }).hours;

    expect(readAfter(half)).toBe(1.5);
    expect(readAfter(fifty)).toBe(1.17);
    // Which is the whole point of D1: three short logs cost less bucket than
    // one long one. Counting logs inverts it — 0,25h against 1h.
    expect(readAfter(half)).toBeGreaterThan(readAfter(fifty));
  });

  it("buckets by category, not by activity (D3)", () => {
    const result = earn({
      userId: KID1,
      activity: lerLivro,
      category: menteNoBonus,
      occurredOn: DAY,
      durationMinutes: 60,
      // A different activity, the same category: the bucket is shared.
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [log(xadrez)],
    });

    expect(result.hours).toBe(1);

    const otherCategory = earn({
      userId: KID1,
      activity: lerLivro,
      category: menteNoBonus,
      occurredOn: DAY,
      durationMinutes: 60,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [log(futebol)],
    });

    expect(otherCategory.hours).toBe(2);
  });

  it("shows a duration the base line's own multiplication closes on", () => {
    // A duration rounded to hours does not survive being multiplied: one minute
    // read "Ler livro, 0,02h × 2,0" beside a result of 0,03h, and the boy who
    // checks that line gets 0,04. It was 480 of the 720 whole-minute durations
    // of a day, and no fixture here was ever anything but a whole hour.
    const noDecay: EngineCategory = { ...menteNoBonus, decayStepHours: null };
    const base = (durationMinutes: number, value: number) =>
      earn({
        userId: KID1,
        activity: { ...lerLivro, value },
        category: noDecay,
        occurredOn: DAY,
        durationMinutes,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [],
      }).lines[0];

    expect(base(1, 2)).toEqual({
      step: "base",
      text: "Ler livro, 1min × 2,0",
      hours: 0.03,
    });
    expect(base(23, 2)?.text).toBe("Ler livro, 23min × 2,0");
    // A duration that is an exact number of hours still reads in hours.
    expect(base(60, 2)?.text).toBe("Ler livro, 1h × 2,0");
    expect(base(90, 2)?.text).toBe("Ler livro, 1,5h × 2,0");
    expect(base(45, 2)?.text).toBe("Ler livro, 0,75h × 2,0");

    // And then every whole-minute duration of a day, at both rates the seed
    // uses: the two numbers printed on the line have to produce the third.
    for (const value of [1, 2]) {
      for (let minutes = 1; minutes <= 720; minutes += 1) {
        const line = base(minutes, value);
        const parts = line?.text.match(/, ([\d,]+)(h|min) × ([\d,]+)$/);
        const [, shown, unit, rate] = parts ?? [];

        if (line === undefined || shown === undefined || rate === undefined) {
          throw new Error(`unreadable base line: ${line?.text}`);
        }

        const quantity = Number(shown.replace(",", "."));
        const product = quantity * Number(rate.replace(",", "."));

        expect(
          Math.round((unit === "min" ? product / 60 : product) * 100) / 100,
        ).toBe(line.hours);
      }
    }
  });

  it("counts the bucket in whole minutes, so the base line cannot lie", () => {
    // Six twenty-minute sessions are exactly 2h, but summed as sixths of an
    // hour they came to 1,9999999999999998: `Math.floor` saw an empty bucket,
    // the base line claimed "cheio" and the very next line said the bucket
    // already held 2h. Both lines are read by the boy, on the same screen.
    const sixTwenties = Array.from({ length: 6 }, () =>
      log(futebol, { durationMinutes: 20 }),
    );
    const fourThirties = Array.from({ length: 4 }, () =>
      log(futebol, { durationMinutes: 30 }),
    );
    const corpoNoBonus: EngineCategory = { ...corpo, returnBonusPct: 0 };
    const expected = [
      {
        step: "base",
        text: "Futebol, 1h × 2,0 — você já fez 2h de Corpo hoje",
        hours: 2,
      },
      {
        step: "decay",
        text: "metade, de 2h a 4h de Corpo no dia",
        hours: -1,
      },
    ];

    for (const history of [sixTwenties, fourThirties]) {
      expect(
        earn({
          userId: KID1,
          activity: futebol,
          category: corpoNoBonus,
          occurredOn: DAY,
          durationMinutes: 60,
          historyFrom: WINDOW,
          historyTo: WINDOW_END,
          categoryFirstDay: LONG_AGO,
          history,
        }).lines,
      ).toEqual(expected);
    }

    // The same drift the other way: sixty one-minute logs came to
    // 1,0000000000000013 and grew a third band worth 0h.
    expect(
      earn({
        userId: KID1,
        activity: lerLivro,
        category: menteNoBonus,
        occurredOn: DAY,
        durationMinutes: 60,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: Array.from({ length: 60 }, () =>
          log(lerLivro, { durationMinutes: 1 }),
        ),
      }).lines,
    ).toEqual([
      {
        step: "base",
        text: "Ler livro, 1h × 2,0 — você já fez 1h de Mente hoje",
        hours: 2,
      },
      {
        step: "decay",
        text: "metade, de 1h a 2h de Mente no dia",
        hours: -1,
      },
    ]);
  });

  it("empties the bucket at midnight (D3)", () => {
    const result = earn({
      userId: KID1,
      activity: lerLivro,
      category: menteNoBonus,
      occurredOn: DAY,
      durationMinutes: 60,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [log(lerLivro, { occurredOn: "2026-08-31" })],
    });

    expect(result.hours).toBe(2);
  });

  it("never says the decay is worth nothing, and never fills the screen", () => {
    // D2's justification is that the boy never hears "não vale mais nada", and
    // the underflow band said exactly that. A `decay_step_hours` the schema
    // allows also turned 90 minutes into 1.076 lines, with denominators printed
    // as "1/5.35e+300".
    const marathon = earn({
      userId: KID1,
      activity: lerLivro,
      category: menteNoBonus,
      occurredOn: DAY,
      durationMinutes: 2000 * 60,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [],
    });

    // The base line, seven named bands, and one line for everything after.
    expect(marathon.lines).toHaveLength(9);
    expect(marathon.lines.at(-1)).toEqual({
      step: "decay",
      text: "cada vez menos, depois de 8h de Mente no dia",
      hours: -3983.98,
    });
    expect(marathon.hours).toBe(4);

    // A bucket already deeper than any readable fraction is named, not counted.
    const tiny: EngineCategory = { ...menteNoBonus, decayStepHours: 0.001 };

    expect(
      earn({
        userId: KID1,
        activity: lerLivro,
        category: tiny,
        occurredOn: DAY,
        durationMinutes: 60,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [log(lerLivro, { durationMinutes: 2000 * 60 })],
      }).lines.at(-1)?.text,
      // 2000,01h and not 2000h, and the hundredth is the arithmetic being right
      // rather than the sentence changing. A 2000h bucket at a step of 0,001h
      // sits exactly on band 2.000.000, and one hour of activity crosses the
      // thousand bands after it — so the eighth named band, where the tail is
      // folded, is 2.000.007, and that band opens at 2.000,007h, which is
      // 2000,01h to two decimals. What used to print 2000h was the *first*
      // band's own collapsed range: `2 ** -2000000` underflows to exactly zero
      // in a double, so the old band splitter stopped dead at band 2.000.000
      // and called the whole remaining hour one band worth precisely nothing —
      // the "vale nada" D2 forbids, arrived at by an underflow rather than by a
      // decision. Exact arithmetic has no underflow to stop at, so the bands
      // after it exist now and the fold names the one it really starts from.
    ).toBe("cada vez menos, depois de 2000,01h de Mente no dia");

    for (const durationMinutes of [90, 1440, 120_000]) {
      for (const decayStepHours of [0.001, 0.01, 1]) {
        const result = earn({
          userId: KID1,
          activity: lerLivro,
          category: { ...menteNoBonus, decayStepHours },
          occurredOn: DAY,
          durationMinutes,
          historyFrom: WINDOW,
          historyTo: WINDOW_END,
          categoryFirstDay: LONG_AGO,
          history: [],
        });

        expect(result.lines.length).toBeLessThanOrEqual(9);

        for (const line of result.lines) {
          expect(line.text).not.toMatch(/nada/);
          expect(line.text).not.toMatch(/e[+-]\d/);
        }
      }
    }
  });

  it("is off when decay_step_hours is null (D2/D5/D12)", () => {
    const noDecay: EngineCategory = { ...menteNoBonus, decayStepHours: null };
    const result = earn({
      userId: KID1,
      activity: lerLivro,
      category: noDecay,
      occurredOn: DAY,
      durationMinutes: 360,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [],
    });

    expect(result.hours).toBe(12);
    expect(result.lines.map((line) => line.step)).toEqual(["base"]);
  });

  it("leaves fixed and delivery alone: no duration, no bucket (D5)", () => {
    // A category with a step, a bucket already full, and an entry with no hours
    // of activity to index it by.
    const bucketed = [log(futebol), log(futebol)];

    const fixed = earn({
      userId: KID1,
      activity: { ...sairComAmigos, categoryId: 2 },
      category: corpo,
      occurredOn: DAY,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: bucketed,
    });

    expect(fixed.hours).toBe(3);
    expect(fixed.lines.map((line) => line.step)).toEqual(["base"]);

    // And they put nothing into it either: the reading below still starts full.
    const afterFixed = earn({
      userId: KID1,
      activity: futebol,
      category: { ...corpo, returnBonusPct: 0 },
      occurredOn: DAY,
      durationMinutes: 60,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [log({ ...sairComAmigos, categoryId: 2 })],
    });

    expect(afterFixed.hours).toBe(2);
  });
});

describe("rounding", () => {
  it("rounds the chain once, never the lines (D9)", () => {
    // Rounding each line on its own passes every other test in this file,
    // because every other fixture's parcels are already exact two-decimal
    // numbers. This one is not: 23 minutes at 1,0 with a 0,5 grade and the
    // cooldown gives 0,383333 → 0,191666 → 0,095833.
    const noDecay: EngineCategory = { ...menteNoBonus, decayStepHours: null };
    const result = earn({
      userId: KID1,
      activity: estudo,
      category: noDecay,
      occurredOn: DAY,
      durationMinutes: 23,
      quality: 0.5,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [log(estudo, { occurredOn: "2026-08-28", durationMinutes: 60 })],
    });

    expect(result.hours).toBe(0.1);
    // Rounding line by line gives −0,10 on the last line and a sum of 0,09,
    // one cent short of the 0,10 on the screen above it.
    expect(result.lines).toEqual([
      { step: "base", text: "Estudo para prova, 23min × 1,0", hours: 0.38 },
      { step: "quality", text: "nota 0,5", hours: -0.19 },
      {
        step: "cooldown",
        text: "metade, você fez isso outra vez em 7 dias",
        hours: -0.09,
      },
    ]);
  });

  it("closes the sum over every duration of a day, at every step", () => {
    const noBonusCorpo: EngineCategory = { ...corpo, returnBonusPct: 0 };

    for (const category of [menteNoBonus, noBonusCorpo]) {
      for (const value of [0.5, 1, 2, 3]) {
        for (
          let durationMinutes = 1;
          durationMinutes <= 1440;
          durationMinutes += 7
        ) {
          // `earn` is the assertion: it adds the lines up in whole cents.
          earn({
            userId: KID1,
            activity: { ...lerLivro, value },
            category,
            occurredOn: DAY,
            durationMinutes,
            historyFrom: WINDOW,
            historyTo: WINDOW_END,
            categoryFirstDay: LONG_AGO,
            history: [log(lerLivro, { durationMinutes: 37 })],
          });
        }
      }
    }
  });
});

describe("quality, cooldown and the return bonus", () => {
  it("applies the grade once, and a zero grade earns zero (D10)", () => {
    const graded = earn({
      userId: KID1,
      activity: lavarOCarro,
      category: casa,
      occurredOn: DAY,
      quality: 0.7,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [],
    });

    expect(graded.hours).toBe(2.1);

    const zero = earn({
      userId: KID1,
      activity: lavarOCarro,
      category: casa,
      occurredOn: DAY,
      quality: 0,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [],
    });

    expect(zero.hours).toBe(0);
  });

  it("leaves out the steps that moved nothing", () => {
    // D10's reasoning is that a 0h line is noise on a statement meant to be
    // read at a glance. It applied to the ledger; the explanation had the same
    // problem — a zero grade still printed "+50% … 0h" under it.
    const bonusCasa: EngineCategory = {
      ...casa,
      returnBonusPct: 0.5,
      returnBonusAfterDays: 3,
    };
    const zero = earn({
      userId: KID1,
      activity: lavarOCarro,
      category: bonusCasa,
      occurredOn: DAY,
      quality: 0,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [],
    });

    expect(zero.hours).toBe(0);
    expect(zero.lines).toEqual([
      { step: "base", text: "Lavar o carro", hours: 3 },
      { step: "quality", text: "nota 0,0", hours: -3 },
    ]);
  });

  it("halves a repeat inside the window, the same day included (D6)", () => {
    const sameDay = earn({
      userId: KID1,
      activity: lavarOCarro,
      category: casa,
      occurredOn: DAY,
      quality: 1,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [log(lavarOCarro)],
    });

    expect(sameDay.hours).toBe(1.5);

    const threeDaysAgo = earn({
      userId: KID1,
      activity: lavarOCarro,
      category: casa,
      occurredOn: DAY,
      quality: 1,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [log(lavarOCarro, { occurredOn: "2026-08-29" })],
    });

    expect(threeDaysAgo.hours).toBe(1.5);

    // The edge of the window: `[occurredOn − 7, occurredOn]` is inclusive, and
    // the day before it is outside.
    expect(
      earn({
        userId: KID1,
        activity: lavarOCarro,
        category: casa,
        occurredOn: DAY,
        quality: 1,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [log(lavarOCarro, { occurredOn: "2026-08-25" })],
      }).hours,
    ).toBe(1.5);

    expect(
      earn({
        userId: KID1,
        activity: lavarOCarro,
        category: casa,
        occurredOn: DAY,
        quality: 1,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [log(lavarOCarro, { occurredOn: "2026-08-24" })],
      }).hours,
    ).toBe(3);
  });

  it("does not halve when repeat_cooldown_days is zero", () => {
    const result = earn({
      userId: KID1,
      activity: sairComAmigos,
      category: casa,
      occurredOn: DAY,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [log(sairComAmigos)],
    });

    expect(result.hours).toBe(3);
  });

  it("bonuses the already decayed value, not the base (D7)", () => {
    // Corpo, step 2h, 4h of football on an empty bucket: 2h at ×1 and 2h at
    // ×0,5, so 3h of activity are paid at 2,0 = 6h. The bonus is half of that
    // 6h, not half of the undecayed 8h.
    const result = earn({
      userId: KID1,
      activity: futebol,
      category: corpo,
      occurredOn: DAY,
      durationMinutes: 240,
      // Exactly the window the rules ask for, which is what a caller fetches.
      historyFrom: historyWindowStart(DAY, futebol, corpo),
      historyTo: historyWindowEnd(DAY, futebol, corpo),
      categoryFirstDay: LONG_AGO,
      history: [],
    });

    expect(result.hours).toBe(9);
    expect(result.lines).toEqual([
      { step: "base", text: "Futebol, 4h × 2,0 — cheio", hours: 8 },
      {
        step: "decay",
        text: "metade, de 2h a 4h de Corpo no dia",
        hours: -2,
      },
      {
        step: "bonus",
        text: "+50%, faz mais de 3 dias que você não faz Corpo",
        hours: 3,
      },
    ]);
  });

  it("pays 50% and not 5000% for a return_bonus_pct of 0,5", () => {
    // The convention is a convention: `return_bonus_pct` is the fraction the
    // seed (#9) stores, so 0,5 is `× 1,5`. Reading it as a percentage would
    // give `× 1,005` — small, plausible, and invisible. Reading a 50 stored as
    // a percentage with this formula would give `× 51`, which is the direction
    // that ruins an afternoon. Both are pinned here.
    const base: CalculationInput = {
      userId: KID1,
      activity: futebol,
      category: corpo,
      occurredOn: DAY,
      durationMinutes: 60,
      historyFrom: historyWindowStart(DAY, futebol, corpo),
      historyTo: historyWindowEnd(DAY, futebol, corpo),
      categoryFirstDay: LONG_AGO,
      history: [],
    };

    // 1h of football on an empty Corpo bucket is 2h before the bonus.
    expect(earn(base).hours).toBe(3);
    expect(earn(base).lines.at(-1)).toEqual({
      step: "bonus",
      text: "+50%, faz mais de 3 dias que você não faz Corpo",
      hours: 1,
    });

    // A different fraction, to show the 100 is not hidden anywhere.
    expect(
      earn({ ...base, category: { ...corpo, returnBonusPct: 0.25 } }).lines.at(
        -1,
      ),
    ).toEqual({
      step: "bonus",
      text: "+25%, faz mais de 3 dias que você não faz Corpo",
      hours: 0.5,
    });
  });

  it("pays the bonus only on the first entry of the return (D6)", () => {
    const returned = log(futebol, { occurredOn: "2026-08-30" });

    // Two days back is inside `[occurredOn − 3, occurredOn]`, so there was no
    // absence to reward.
    expect(
      earn({
        userId: KID1,
        activity: futebol,
        category: corpo,
        occurredOn: DAY,
        durationMinutes: 60,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [log(futebol, { occurredOn: "2026-08-30" })],
      }).hours,
    ).toBe(2);

    // Older than the window, and the history reaches far enough to name the day.
    const result = earn({
      userId: KID1,
      activity: futebol,
      category: corpo,
      occurredOn: DAY,
      durationMinutes: 60,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [{ ...returned, occurredOn: "2026-08-28" }],
    });

    expect(result.hours).toBe(3);
    expect(result.lines.at(-1)?.text).toBe(
      "+50%, faz 4 dias que você não faz Corpo",
    );
  });
});

describe("the contract with the caller", () => {
  it("counts every log the caller hands over (D34)", () => {
    // D34 moved the question from "is this earlier in the canonical order" to
    // "was this frozen before me", and only the caller can answer the second —
    // so the caller hands over the set and the engine counts all of it. The
    // engine used to filter, and that filter is what made an entry launched
    // onto a past day blind to the allowance a later day had already spent.
    const sittings = [1, 2, 3].map((id) =>
      log(lerLivro, { id, createdAt: new Date(id) }),
    );
    // Not called `after`: Biome reads a bare `after(...)` as the test hook of
    // that name and refuses the file.
    const withFrozen = (history: ApprovedLog[]) =>
      earn({
        userId: KID1,
        activity: lerLivro,
        category: menteNoBonus,
        occurredOn: DAY,
        durationMinutes: 60,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history,
      }).hours;

    expect([
      withFrozen([]),
      withFrozen(sittings.slice(0, 1)),
      withFrozen(sittings.slice(0, 2)),
      withFrozen(sittings),
    ]).toStrictEqual([2, 1, 0.5, 0.25]);

    // And the same set twice is the same number: the answer depends on what is
    // in the history and on nothing else, which is the determinism D8 asks for
    // stated in the only terms that survive an `occurred_on` being edited.
    expect(withFrozen(sittings)).toBe(0.25);
  });

  it("reads a later day that was frozen first (D34)", () => {
    // The case D34 was written for. A wash on the 8th, frozen first; a wash
    // launched onto the 1st afterwards. The second one is inside the first
    // one's seven-day cooldown *and the first one is inside its* — the window
    // is measured in days from `occurred_on`, in both directions, and what
    // decides which of the two pays full is the order they were frozen in.
    const later = log(lavarOCarro, {
      occurredOn: shiftDate(DAY, 7),
      durationMinutes: null,
    });

    const halved = earn({
      userId: KID1,
      activity: lavarOCarro,
      category: casa,
      occurredOn: DAY,
      quality: 1,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [later],
    });

    expect(halved.hours).toBe(1.5);
    expect(halved.lines.map((line) => line.text)).toContain(
      "metade, você fez isso outra vez em 7 dias",
    );

    // One day further out and the two have nothing to do with each other.
    expect(
      earn({
        userId: KID1,
        activity: lavarOCarro,
        category: casa,
        occurredOn: DAY,
        quality: 1,
        historyFrom: WINDOW,
        historyTo: shiftDate(DAY, 8),
        categoryFirstDay: LONG_AGO,
        history: [{ ...later, occurredOn: shiftDate(DAY, 8) }],
      }).hours,
    ).toBe(3);
  });

  it("refuses a history window that stops short of the days ahead (D34)", () => {
    // The mirror of the case below, and it exists because D34 created the far
    // end: a caller that fetched only up to the entry's own day would find no
    // cooldown and pay 3h where it owes 1,5h — silent, and in the boy's favour.
    expect(() =>
      earn({
        userId: KID1,
        activity: lavarOCarro,
        category: casa,
        occurredOn: DAY,
        quality: 1,
        historyFrom: WINDOW,
        historyTo: DAY,
        categoryFirstDay: LONG_AGO,
        history: [],
      }),
    ).toThrow(/reads forward to/);
  });

  it("refuses a history window shorter than the rules it applies", () => {
    // Casa's cooldown reaches 7 days back. A caller that fetched 3 paid 3h
    // where it owed 1,5h — no cooldown line, no warning, and always in the
    // boy's favour, which is the direction nobody reports.
    const washed = log(lavarOCarro, { occurredOn: "2026-08-27" });

    expect(
      earn({
        userId: KID1,
        activity: lavarOCarro,
        category: casa,
        occurredOn: DAY,
        quality: 1,
        historyFrom: historyWindowStart(DAY, lavarOCarro, casa),
        historyTo: historyWindowEnd(DAY, lavarOCarro, casa),
        categoryFirstDay: LONG_AGO,
        history: [washed],
      }).hours,
    ).toBe(1.5);

    expect(() =>
      calculateEarnedHours({
        userId: KID1,
        activity: lavarOCarro,
        category: casa,
        occurredOn: DAY,
        quality: 1,
        historyFrom: shiftDate(DAY, -3),
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [],
      }),
    ).toThrow(/reads back to 2026-08-25/);
  });

  it("counts the absence only as far as the history reaches", () => {
    const away = (historyFrom: string, history: ApprovedLog[]) =>
      earn({
        userId: KID1,
        activity: futebol,
        category: corpo,
        occurredOn: DAY,
        durationMinutes: 60,
        historyFrom,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history,
      }).lines.at(-1)?.text;

    // The minimum window can never name the day, by construction: a log of the
    // category inside it would have cancelled the bonus. Issue #17's
    // "faz 4 dias" is only reachable by fetching further back than the number
    // needs, and the wording now follows the window it was actually given.
    expect(away(historyWindowStart(DAY, futebol, corpo), [])).toBe(
      "+50%, faz mais de 3 dias que você não faz Corpo",
    );
    expect(away(shiftDate(DAY, -10), [])).toBe(
      "+50%, faz mais de 10 dias que você não faz Corpo",
    );
    expect(
      away(shiftDate(DAY, -10), [log(futebol, { occurredOn: "2026-08-28" })]),
    ).toBe("+50%, faz 4 dias que você não faz Corpo");
  });

  it("refuses history that is not this user's, or not approved", () => {
    // The two filters the caller owns and nothing could check. Measured before
    // they were: the same 1h of Mente read 0,5h with one pending log alongside
    // and 0,13h with the other boy's day in it.
    const own = {
      userId: KID1,
      activity: lerLivro,
      category: menteNoBonus,
      occurredOn: DAY,
      durationMinutes: 60,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
    };

    expect(earn({ ...own, history: [] }).hours).toBe(2);

    expect(() =>
      calculateEarnedHours({
        ...own,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [log(lerLivro, { userId: KID2 })],
      }),
    ).toThrow(/user 2/);

    // `status` is narrowed to "approved" in the type, so reaching this needs a
    // cast — which is exactly the path the type cannot close on its own.
    const pending = {
      ...log(lerLivro),
      status: "pending",
    } as unknown as ApprovedLog;

    expect(() => calculateEarnedHours({ ...own, history: [pending] })).toThrow(
      /pending/,
    );
  });

  it("says how far back the history has to reach", () => {
    expect(historyLookbackDays(lavarOCarro, casa)).toBe(7);
    expect(historyLookbackDays(lerLivro, corpo)).toBe(3);
    expect(historyLookbackDays(lerLivro, menteNoBonus)).toBe(0);
    // The bonus window is irrelevant while the bonus is off.
    expect(
      historyLookbackDays(lerLivro, {
        ...menteNoBonus,
        returnBonusAfterDays: 9,
      }),
    ).toBe(0);

    // And the same window as a date, so no caller writes the arithmetic again.
    expect(historyWindowStart(DAY, lavarOCarro, casa)).toBe("2026-08-25");
    expect(historyWindowStart(DAY, lerLivro, corpo)).toBe("2026-08-29");
    expect(historyWindowStart(DAY, lerLivro, menteNoBonus)).toBe(DAY);
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("names the day in São Paulo, not in UTC", () => {
    // 23:30 on the 1st in Brasília. `toISOString().slice(0, 10)` answers the
    // 2nd, which is an empty bucket and a full rate on the boy's fifth hour —
    // the bug D13 was written against, sitting inside the bucket.
    const lateNight = new Date("2026-09-02T02:30:00Z");

    expect(saoPauloDay(lateNight)).toBe("2026-09-01");
    expect(lateNight.toISOString().slice(0, 10)).toBe("2026-09-02");

    // Midnight in São Paulo is the moment the bucket empties (D3).
    expect(saoPauloDay(new Date("2026-09-02T02:59:59Z"))).toBe("2026-09-01");
    expect(saoPauloDay(new Date("2026-09-02T03:00:00Z"))).toBe("2026-09-02");
  });

  it("refuses to guess at a missing input instead of earning zero", () => {
    expect(() =>
      calculateEarnedHours({
        userId: KID1,
        activity: lerLivro,
        category: menteNoBonus,
        occurredOn: DAY,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [],
      }),
    ).toThrow(/durationMinutes/);

    expect(() =>
      calculateEarnedHours({
        userId: KID1,
        activity: lavarOCarro,
        category: casa,
        occurredOn: DAY,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [],
      }),
    ).toThrow(/quality/);

    expect(() =>
      calculateEarnedHours({
        userId: KID1,
        activity: {
          ...sairComAmigos,
          calcMode: "free",
          value: null,
        },
        category: casa,
        occurredOn: DAY,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [],
      }),
    ).toThrow(/freeValue/);
  });

  it("throws on the inputs that used to come back as NaN", () => {
    // The only invalid inputs the engine did not refuse. Both returned
    // `hours: NaN` in silence, one of them under 1.076 explanation lines.
    expect(() =>
      calculateEarnedHours({
        userId: KID1,
        activity: lerLivro,
        category: { ...menteNoBonus, decayStepHours: 0 },
        occurredOn: DAY,
        durationMinutes: 60,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [],
      }),
    ).toThrow(/decay_step_hours/);

    expect(() =>
      calculateEarnedHours({
        userId: KID1,
        activity: lerLivro,
        category: menteNoBonus,
        occurredOn: DAY,
        durationMinutes: Number.POSITIVE_INFINITY,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [],
      }),
    ).toThrow(/durationMinutes/);
  });

  it("takes only the five grades the spec allows", () => {
    const graded = (quality: number) =>
      calculateEarnedHours({
        userId: KID1,
        activity: lavarOCarro,
        category: casa,
        occurredOn: DAY,
        quality,
        historyFrom: WINDOW,
        historyTo: WINDOW_END,
        categoryFirstDay: LONG_AGO,
        history: [],
      });

    for (const quality of [0, 0.3, 0.5, 0.7, 1]) {
      expect(graded(quality).hours).toBe(Math.round(3 * quality * 100) / 100);
    }

    // A 3 used to read 9h and a -1 read -3h, on the boy's screen, where the
    // schema's CHECK never gets a say.
    for (const quality of [3, -1, 0.4]) {
      expect(() => graded(quality)).toThrow(/quality must be one of/);
    }
  });

  it("takes the value the admin typed for a free activity", () => {
    const result = earn({
      userId: KID1,
      activity: { ...sairComAmigos, calcMode: "free", value: null },
      category: casa,
      occurredOn: DAY,
      freeValue: 1.25,
      historyFrom: WINDOW,
      historyTo: WINDOW_END,
      categoryFirstDay: LONG_AGO,
      history: [],
    });

    expect(result.hours).toBe(1.25);
  });
});
