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
 * `Result` is called with the real engine over the real seed, so what the boy
 * reads is `calculateEarnedHours` digit for digit. `TODAY` is fixed so "faz 4
 * dias" means the same thing in March.
 */

const TODAY = "2026-09-02";

function texts(node: ReactNode): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (!isValidElement(node)) return [];

  return texts((node.props as { children?: ReactNode }).children);
}

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

/** Reproduces the action's `free` filter (D12), which is how Curinga became an empty heading. */
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

  // The action promises at least this window; narrower would test what the screen never sees.
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

/** `hours` is asserted against the sum of the lines (#17); pinning numbers is the engine cases' job. */
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
    // Empty explanations would pass every assertion above.
    const total = CASES.map((entry) => simulate(entry.input).lines.length);

    expect(Math.min(...total)).toBeGreaterThan(0);
    expect(total.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(12);
  });
});

describe("the lines add up to the total shown (#17, D9)", () => {
  it.each(CASES.map((entry) => ({ ...entry })))("$name", ({ input }) => {
    const calculation = simulate(input);

    const summed = calculation.lines.reduce(
      (total, line) => total + line.hours,
      0,
    );
    expect(Math.round(summed * 100) / 100).toBe(calculation.hours);

    const rendered = texts(Result({ calculation }));
    const shown = rendered.filter(
      (text) => text === formatHours(calculation.hours),
    );

    expect(shown).toHaveLength(2);

    // #105.
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
    // 3h base + 1h30 bonus: the visible numbers must add to the visible total.
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
  /** Rendered, not called: `Calculator` has hooks, and their initial values are the untouched screen. */
  function markup(): string {
    return renderToStaticMarkup(
      createElement(Calculator, { data: calculatorData() }),
    );
  }

  it("offers the six hours of reading decisions.md opens with", () => {
    const rendered = markup();

    for (const label of ["15 min", "1h", "1h30", "3h", "4h", "6h"]) {
      expect(rendered, label).toContain(`>${label}</button>`);
    }

    // 2,81h for four hours and 2,95h for six, as decisions.md prints; yesterday's
    // reading keeps the return bonus out.
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
    // In a browser at 320 px, a lone `3h` on the last `flex-wrap` row stretched
    // to 284 px; on a screen with no colour, size is the only hierarchy.
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
    // Curinga's only activity is `free`, which the action leaves out (D12).
    const rendered = markup();
    const groups = [
      ...rendered.matchAll(/<optgroup label="([^"]+)"><\/optgroup>/g),
    ];

    expect(groups.map((match) => match[1])).toStrictEqual([]);
    expect(rendered).not.toContain("Curinga");
    expect(rendered).toContain('<optgroup label="Mente">');
  });
});

/** Textual and coarse: the second lock. The cases above are the first. */
const CALCULATOR_DIR = import.meta.dirname;

function sourceOf(file: string): string {
  return readFileSync(join(CALCULATOR_DIR, file), "utf8");
}

/** A comment saying "no insert" is not an insert. */
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
    // The three numbers a reimplementation would have to write down.
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
      expect(source, file).not.toMatch(/<form\b/);
    }
  });

  it("hands the engine the whole window it was given (D34)", () => {
    // Both ends of the window travel with it: the far end is declared (D34).
    const source = stripComments(sourceOf("calculator.tsx"));

    expect(source).toContain("historyFrom: data.historyFrom");
    expect(source).toContain("historyTo: data.historyTo");
  });
});
