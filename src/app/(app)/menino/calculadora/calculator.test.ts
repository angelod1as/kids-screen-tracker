import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SEED_CATEGORIES } from "../../../../db/seed";
import type {
  ApprovedLog,
  Calculation,
  EngineActivity,
  EngineCategory,
} from "../../../../engine/calculate";
import {
  calculateEarnedHours,
  historyWindowStart,
  shiftDate,
} from "../../../../engine/calculate";
import { lineMinutes, Result } from "../../../../ui/explanation";
import { formatHours } from "../../../../ui/hours";
import type { CalculatorData } from "../../../actions/calculator";
import { Calculator } from "./calculator";

/**
 * The calculator's two promises (#17): the explanation is on the screen, and
 * the lines add up to the number above them.
 *
 * The screen itself uses hooks, so it is not called here — `Result` is, with
 * calculations produced by the real engine over the real seed. That is the
 * split that matters: what the boy reads has to be what
 * `calculateEarnedHours` said, digit for digit, and the way to check it is to
 * ask the engine and then read the tree.
 *
 * `TODAY` is a fixed date rather than the real one, because a case that reads
 * "faz 4 dias" has to mean the same thing in March.
 */

const TODAY = "2026-09-02";

/** Every string the tree renders, in document order. */
function texts(node: ReactNode): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (!isValidElement(node)) return [];

  return texts((node.props as { children?: ReactNode }).children);
}

/** The seed's rows, in the shape the engine takes. */
function seedActivity(id: number): {
  activity: EngineActivity;
  category: EngineCategory;
} {
  for (const category of SEED_CATEGORIES) {
    for (const activity of category.activities) {
      if (activity.id !== id) continue;

      return {
        activity: {
          id: activity.id,
          categoryId: category.id,
          name: activity.name,
          calcMode: activity.calcMode,
          value: activity.value ?? null,
          qualityGraded: activity.qualityGraded ?? false,
          repeatCooldownDays: activity.repeatCooldownDays ?? 0,
        },
        category: {
          id: category.id,
          name: category.name,
          decayStepHours: category.decayStepHours ?? null,
          returnBonusPct: category.returnBonusPct ?? 0,
          returnBonusAfterDays: category.returnBonusAfterDays ?? 0,
        },
      };
    }
  }

  throw new Error(`the seed has no activity ${id}`);
}

let nextLogId = 1;

function approvedLog(options: {
  activityId: number;
  daysAgo: number;
  durationMinutes?: number;
}): ApprovedLog {
  const { activity } = seedActivity(options.activityId);
  const occurredOn = shiftDate(TODAY, -options.daysAgo);

  return {
    id: nextLogId++,
    userId: 3,
    occurredOn,
    activityId: activity.id,
    durationMinutes: options.durationMinutes ?? null,
    createdAt: new Date(`${occurredOn}T15:00:00Z`),
    status: "approved",
    categoryId: activity.categoryId,
  };
}

/**
 * What `fetchCalculatorDataAction` hands the screen, rebuilt from the seed.
 *
 * The one rule of the action that the screen can see is reproduced here and
 * nowhere else: `free` activities are left out (D12), and every active category
 * is passed along whether or not anything survived that filter — which is how
 * Curinga reached the picker as an empty heading.
 */
function calculatorData(): CalculatorData {
  const activities: EngineActivity[] = [];
  const categories: EngineCategory[] = [];

  for (const category of SEED_CATEGORIES) {
    categories.push({
      id: category.id,
      name: category.name,
      decayStepHours: category.decayStepHours ?? null,
      returnBonusPct: category.returnBonusPct ?? 0,
      returnBonusAfterDays: category.returnBonusAfterDays ?? 0,
    });

    for (const activity of category.activities) {
      if (activity.calcMode === "free") continue;

      activities.push(seedActivity(activity.id).activity);
    }
  }

  return {
    userId: 3,
    occurredOn: TODAY,
    historyFrom: shiftDate(TODAY, -30),
    historyTo: shiftDate(TODAY, 30),
    categories,
    activities,
    history: [],
    categoryFirstDays: {},
  };
}

/** A calculation, exactly as the screen would ask for one. */
function simulate(options: {
  activityId: number;
  durationMinutes?: number;
  quality?: number;
  history?: readonly ApprovedLog[];
  lookbackDays?: number;
}): Calculation {
  const { activity, category } = seedActivity(options.activityId);
  const lookback = options.lookbackDays ?? 30;
  const historyFrom = shiftDate(TODAY, -lookback);

  // The action promises a window at least this wide; a case that asked for a
  // narrower one would be testing something the screen never sees.
  expect(historyFrom <= historyWindowStart(TODAY, activity, category)).toBe(
    true,
  );

  return calculateEarnedHours({
    userId: 3,
    activity,
    category,
    occurredOn: TODAY,
    durationMinutes: options.durationMinutes,
    quality: options.quality,
    history: [...(options.history ?? [])],
    historyFrom,
    historyTo: shiftDate(TODAY, lookback),
    categoryFirstDay:
      (options.history ?? [])
        .filter((log) => log.categoryId === category.id)
        .map((log) => log.occurredOn)
        .sort()[0] ?? null,
  });
}

/**
 * The cases the calculator has to get right, chosen to cover every kind of
 * line the engine can write.
 *
 * `hours` is not asserted against a number typed here: it is asserted against
 * the sum of the lines, which is the criterion #17 states. Pinning the numbers
 * as well would be `calculate.cases.test.ts`'s job, and it already does it.
 */
const CASES = [
  {
    name: "an hour of reading on an empty day — cheio",
    input: { activityId: 5, durationMinutes: 60 },
    contains: ["Ler livro, 1h × 1,5 — cheio"],
  },
  {
    name: "a second hour of Mente — metade",
    input: {
      activityId: 5,
      durationMinutes: 60,
      history: [
        approvedLog({ activityId: 5, daysAgo: 0, durationMinutes: 60 }),
      ],
    },
    contains: [
      "Ler livro, 1h × 1,5 — você já fez 1h de Mente hoje",
      "metade, de 1h a 2h de Mente no dia",
    ],
  },
  {
    name: "a third hour of Mente — um quarto",
    input: {
      activityId: 5,
      durationMinutes: 60,
      history: [
        approvedLog({ activityId: 5, daysAgo: 0, durationMinutes: 120 }),
      ],
    },
    contains: [
      "Ler livro, 1h × 1,5 — você já fez 2h de Mente hoje",
      "um quarto, de 2h a 3h de Mente no dia",
    ],
  },
  {
    name: "an entry that crosses a band is split, not dropped into one",
    input: {
      activityId: 5,
      durationMinutes: 120,
      history: [],
    },
    contains: ["cheio", "metade, de 1h a 2h de Mente no dia"],
  },
  {
    name: "the return bonus names the day, which is what #17 asks for",
    input: {
      activityId: 1,
      durationMinutes: 120,
      history: [
        approvedLog({ activityId: 1, daysAgo: 4, durationMinutes: 90 }),
      ],
    },
    contains: ["+50%, faz 4 dias que você não faz Corpo"],
  },
  {
    name: "the repeat cooldown of Casa",
    input: {
      activityId: 26,
      quality: 1,
      history: [approvedLog({ activityId: 26, daysAgo: 3 })],
    },
    contains: ["metade, você fez isso outra vez em 7 dias"],
  },
  {
    name: "a quality grade",
    input: { activityId: 23, quality: 0.7 },
    contains: ["nota 0,7"],
  },
  {
    name: "a fixed activity, which takes neither a duration nor a grade",
    input: { activityId: 15 },
    contains: ["Sair com os amigos"],
  },
] as const;

describe("the explanation is the product (#17)", () => {
  it.each(CASES.map((entry) => ({ ...entry })))(
    "$name",
    ({ contains, input }) => {
      const calculation = simulate(input);
      const rendered = texts(Result({ calculation })).join(" ");

      for (const line of contains) {
        expect(rendered, line).toContain(line);
      }
    },
  );

  it("draws one line per line the engine wrote, and no more", async () => {
    for (const entry of CASES) {
      const calculation = simulate(entry.input);
      const rendered = texts(Result({ calculation }));

      for (const line of calculation.lines) {
        expect(rendered, `${entry.name}: ${line.text}`).toContain(line.text);
      }
    }
  });

  it("has cases that actually produce lines", async () => {
    // A matrix where every calculation came back with an empty explanation
    // would pass every assertion above.
    const total = CASES.map((entry) => simulate(entry.input).lines.length);

    expect(Math.min(...total)).toBeGreaterThan(0);
    expect(total.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(12);
  });
});

describe("the lines add up to the total shown (#17, D9)", () => {
  it.each(CASES.map((entry) => ({ ...entry })))("$name", ({ input }) => {
    const calculation = simulate(input);

    // The engine's own guarantee, restated where the screen depends on it.
    const summed = calculation.lines.reduce(
      (total, line) => total + line.hours,
      0,
    );
    expect(Math.round(summed * 100) / 100).toBe(calculation.hours);

    // And what is drawn: the headline and the closing total are the same
    // string, and it is the engine's number.
    const rendered = texts(Result({ calculation }));
    const shown = rendered.filter(
      (text) => text === formatHours(calculation.hours),
    );

    expect(shown).toHaveLength(2);

    // The column in minutes closes on the headline in minutes (#105).
    const minutes = lineMinutes(calculation.lines);
    expect(minutes.reduce((total, line) => total + line, 0)).toBe(
      Math.round(calculation.hours * 60),
    );
  });

  it("gives a line the minute its neighbours rounded away (#105)", () => {
    // Rounded one by one, three 0,01h lines read 1 + 1 + 1 against a 2 min total.
    expect(
      lineMinutes([{ hours: 0.01 }, { hours: 0.01 }, { hours: 0.01 }]),
    ).toEqual([1, 0, 1]);
    expect(
      lineMinutes([{ hours: 4 }, { hours: -1.5 }, { hours: 0.25 }]),
    ).toEqual([240, -90, 15]);
  });

  it("closes on a total the boy can check by adding the column", () => {
    // The 2h of football that pay 4h30: 3h base, +1h30 bonus. Adding the two
    // visible numbers has to reach the visible total, or the screen is asking
    // to be trusted rather than read.
    const calculation = simulate({
      activityId: 1,
      durationMinutes: 120,
      history: [
        approvedLog({ activityId: 1, daysAgo: 4, durationMinutes: 90 }),
      ],
    });

    expect(calculation.lines.map((line) => line.hours)).toEqual([3, 1.5]);
    expect(calculation.hours).toBe(4.5);
    expect(texts(Result({ calculation }))).toContain("+3h");
    expect(texts(Result({ calculation }))).toContain("+1h30");
    expect(texts(Result({ calculation }))).toContain("4h30");
  });

  it("shows no bonus line on the category's debut, and one on a return (D47)", () => {
    const debut = simulate({ activityId: 5, durationMinutes: 60 });
    const back = simulate({
      activityId: 5,
      durationMinutes: 60,
      history: [
        approvedLog({ activityId: 5, daysAgo: 4, durationMinutes: 60 }),
      ],
    });

    expect(texts(Result({ calculation: debut })).join(" ")).not.toContain("%");
    expect(debut.hours).toBe(1.5);
    expect(texts(Result({ calculation: back })).join(" ")).toContain(
      "+50%, faz 4 dias que você não faz Mente",
    );
  });

  it("shows a step that takes hours away as a negative number", () => {
    const calculation = simulate({
      activityId: 5,
      durationMinutes: 60,
      history: [
        approvedLog({ activityId: 5, daysAgo: 0, durationMinutes: 60 }),
      ],
    });

    expect(
      texts(Result({ calculation })).some((text) => text.startsWith("−")),
    ).toBe(true);
  });
});

describe("the controls the boy actually touches", () => {
  /**
   * The screen as HTML, hooks and all.
   *
   * `Result` is called as a function everywhere above, which is enough for a
   * component that has no state. `Calculator` has three `useState`s and a
   * `useMemo`, so it is rendered instead — `renderToStaticMarkup` runs hooks
   * at their initial values, which is exactly the screen a boy is handed
   * before he touches anything.
   */
  function markup(): string {
    return renderToStaticMarkup(
      createElement(Calculator, { data: calculatorData() }),
    );
  }

  it("offers the six hours of reading decisions.md opens with", () => {
    // "Ler 6 horas é permitido — só rende quase nada a mais do que ler 4" is
    // the first thing the normative document says about the model, and until
    // now the screen that exists to teach the model stopped at three hours.
    const rendered = markup();

    for (const label of ["15 min", "1h", "1h30", "3h", "4h", "6h"]) {
      expect(rendered, label).toContain(`>${label}</button>`);
    }

    // And what it is worth, read through the engine the screen runs, against
    // the table decisions.md prints: 2,81h for four hours read and 2,95h for
    // six. Yesterday's reading is in the history so the return bonus does not
    // fire, which is the row of that table and not a case of its own.
    const yesterday = [
      approvedLog({ activityId: 5, daysAgo: 1, durationMinutes: 60 }),
    ];
    const four = simulate({
      activityId: 5,
      durationMinutes: 240,
      history: yesterday,
    });
    const six = simulate({
      activityId: 5,
      durationMinutes: 360,
      history: yesterday,
    });

    expect(four.hours).toBe(2.81);
    expect(six.hours).toBe(2.95);
    expect(six.hours - four.hours).toBeLessThan(0.2);
  });

  it("gives every option of a group the same width", () => {
    // Measured in a browser at 320 px, the seven duration buttons came out
    // 89,3 px each except `3h`, which was alone on the last row of a
    // `flex-wrap` with `grow` and stretched to 284. On a screen with no colour
    // size is the only hierarchy there is, and it was pointing at an arbitrary
    // option. A grid makes the width a property of the group, not of how many
    // options happened to land on the last row.
    const rendered = markup();
    const classes = [
      ...rendered.matchAll(/<button[^>]*class="([^"]*)"[^>]*>/g),
    ].map((match) => match[1]);

    expect(classes.length).toBeGreaterThanOrEqual(9);

    for (const className of classes) {
      expect(className).not.toMatch(/\bgrow\b/);
      expect(className).not.toMatch(/\bbasis-/);
    }

    expect(rendered).toContain("grid grid-cols-3");
    expect(rendered).not.toContain("flex flex-wrap");
  });

  it("draws no category heading with nothing under it", () => {
    // Curinga's only activity is `free`, which the action leaves out (D12), so
    // its `<optgroup>` arrived with a label and no options at all — a heading
    // the boy scrolls to and finds empty.
    const rendered = markup();
    const groups = [
      ...rendered.matchAll(/<optgroup label="([^"]+)"><\/optgroup>/g),
    ];

    expect(groups.map((match) => match[1])).toStrictEqual([]);
    expect(rendered).not.toContain("Curinga");
    // The groups that do have activities are still there.
    expect(rendered).toContain('<optgroup label="Mente">');
  });
});

/**
 * The source of the screen, for the two criteria that are about what is *not*
 * in it.
 *
 * Textual and therefore coarse, and it is the second lock rather than the
 * first: the cases above are what would actually go red if a second copy of the
 * formula started answering, because a copy that agrees with the engine on
 * eight cases including a band split, a cooldown and a bonus is not a copy.
 */
const CALCULATOR_DIR = import.meta.dirname;

function sourceOf(file: string): string {
  return readFileSync(join(CALCULATOR_DIR, file), "utf8");
}

/** Comments are prose. A comment saying "no insert" is not an insert. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe("no calculation logic is reimplemented here (#17)", () => {
  it("calls the engine", () => {
    expect(stripComments(sourceOf("calculator.tsx"))).toContain(
      "calculateEarnedHours(",
    );
  });

  it("holds none of the engine's constants", () => {
    // The decay's halving, the cooldown's 0,5 and the bonus's `1 +` are the
    // three numbers a reimplementation would have to write down.
    const source = stripComments(sourceOf("calculator.tsx"));

    expect(source).not.toMatch(/2\s*\*\*\s*-/);
    expect(source).not.toMatch(/Math\.pow/);
    expect(source).not.toMatch(/\bdecayStep/);
    expect(source).not.toMatch(/returnBonus/);
    expect(source).not.toMatch(/repeatCooldown/);
  });
});

describe("the calculator writes nothing (#17)", () => {
  it("has no server action and no write in either file", () => {
    for (const file of ["calculator.tsx", "page.tsx"]) {
      const source = stripComments(sourceOf(file));

      expect(source, file).not.toContain("use server");
      expect(source, file).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
      expect(source, file).not.toContain("getDb");
      // A form would post somewhere. There is nothing to post.
      expect(source, file).not.toMatch(/<form\b/);
    }
  });

  it("hands the engine the whole window it was given (D34)", () => {
    // The screen simulates an entry that will never be frozen, so everything
    // the action fetched counts — and both ends of the window travel with it.
    // A screen that dropped `historyTo` would be refused by the engine, which
    // is the point: the far end is declared, not assumed.
    const source = stripComments(sourceOf("calculator.tsx"));

    expect(source).toContain("historyFrom: data.historyFrom");
    expect(source).toContain("historyTo: data.historyTo");
  });
});
