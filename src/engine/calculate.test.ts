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
 * Mente with and without the return bonus: a bonus firing on the day's first
 * entry would turn 2h into 3h and hide the decay being measured.
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
/** Casa's seven-day cooldown, the widest window here; less history is refused. */
const WINDOW = shiftDate(DAY, -7);
/** The far end of the same window (D34). */
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

/** Added in whole cents, as the boy adds them: rounding the sum forgives a line a cent off (D9). */
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
    // 0,1h puts fifty-odd bands under one session; taking each band's loss off a
    // running value drifted upwards, and 292 minutes paid less than 291.
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
    // Half an hour read, then an hour: the first half hour is still undecayed, so
    // 1,5h. Counting logs would pay 1h.
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
    // Rounded to hours, one minute read "0,02h × 2,0" beside 0,03h, and the boy's
    // own check gives 0,04.
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
    // Six twenty-minute sessions summed as hours are 1,9999…: the base line said
    // "cheio" and the next line said the bucket already held 2h.
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
    // D2: never "nada". A step the schema allows once turned 90 minutes into 1.076
    // lines.
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
      // 2000,01h, not 2000h: the fold starts at band 2.000.007, which opens at
      // 2.000,007h. Float underflow used to stop at band 2.000.000 and call it zero.
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
    // Every other fixture's parcels are exact at two decimals; these are
    // 0,383333 → 0,191666 → 0,095833.
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
    // D10's "0h is noise" holds for the explanation too.
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
    // A fraction, the seed's convention. Read as a percentage it would be × 1,005,
    // small and invisible; a stored 50 would be × 51.
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
    // D34: only the caller knows what was frozen first, so the engine counts all of it.
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

    // Same set, same number: D8's determinism.
    expect(withFrozen(sittings)).toBe(0.25);
  });

  it("reads a later day that was frozen first (D34)", () => {
    // Each wash is inside the other's cooldown, since D34 made the window
    // two-sided; the freeze order decides which one pays full.
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
    // A caller fetching only up to the entry's own day would pay 3h where it owes
    // 1,5h, silently and in the boy's favour.
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
    // A caller that fetched 3 of Casa's 7 days paid 3h where it owed 1,5h, in the
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

    // The minimum window never names the day: a log inside it would cancel the bonus.
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
    // Unchecked, one pending log made 1h of Mente read 0,5h, and the other boy's
    // day made it 0,13h.
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
    // 23:30 in São Paulo is already the 2nd in UTC: the bug D13 was written against.
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
    // Both used to return `hours: NaN` in silence.
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

    // The schema's CHECK never sees the calculator: a 3 used to read 9h.
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
