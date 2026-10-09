import { describe, expect, it } from "vitest";

import {
  type ApprovedLog,
  calculateEarnedHours,
  type EngineActivity,
  type EngineCategory,
} from "./calculate";
import { BONUS_ENABLED } from "./flags";

/**
 * D57: the alternation bonus ships off behind `BONUS_ENABLED`. With the switch
 * at its default, the step vanishes from the calculation — no multiplier, no
 * "bonus" line — while decay and cooldown stay exactly as they are.
 */

const mente: EngineCategory = {
  id: 1,
  name: "Mente",
  decayStepHours: 1,
  alternationBonusPct: 0.5,
};

const corpo: EngineCategory = {
  id: 2,
  name: "Corpo",
  decayStepHours: 2,
  alternationBonusPct: 0.5,
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

const futebol: EngineActivity = {
  id: 20,
  categoryId: 2,
  name: "Futebol",
  calcMode: "duration",
  value: 2,
  qualityGraded: false,
  repeatCooldownDays: 0,
};

const DAY = "2026-09-01";

it("ships with the switch off", () => {
  expect(BONUS_ENABLED).toBe(false);
});

describe("the alternation bonus while it is off (D57)", () => {
  it("earns no bonus even when it would otherwise unlock", () => {
    // Football (Corpo) earlier today would unlock the reading's bonus (D56);
    // with the switch off it is a plain 1h × 2 = 2h, no "bonus" line.
    const result = calculateEarnedHours({
      userId: 1,
      activity: lerLivro,
      category: mente,
      occurredOn: DAY,
      durationMinutes: 60,
      historyFrom: DAY,
      historyTo: DAY,
      participatingCategoryIds: [mente.id, corpo.id],
      history: [
        {
          id: 1,
          userId: 1,
          status: "approved",
          occurredOn: DAY,
          activityId: futebol.id,
          durationMinutes: null,
          createdAt: new Date(1),
          categoryId: corpo.id,
        } satisfies ApprovedLog,
      ],
    });

    expect(result.hours).toBe(2);
    expect(result.lines.map((line) => line.step)).toStrictEqual(["base"]);
  });

  it("still decays within the category (D3 is untouched)", () => {
    // A second hour of Mente is halved whether or not the bonus is on.
    const result = calculateEarnedHours({
      userId: 1,
      activity: lerLivro,
      category: mente,
      occurredOn: DAY,
      durationMinutes: 60,
      historyFrom: DAY,
      historyTo: DAY,
      participatingCategoryIds: [mente.id, corpo.id],
      history: [
        {
          id: 1,
          userId: 1,
          status: "approved",
          occurredOn: DAY,
          activityId: lerLivro.id,
          durationMinutes: 60,
          createdAt: new Date(1),
          categoryId: mente.id,
        } satisfies ApprovedLog,
      ],
    });

    expect(result.hours).toBe(1);
    // The second hour sits in one band, so it is the single base line (#80).
    expect(result.lines.map((line) => line.step)).toStrictEqual(["base"]);
  });
});
