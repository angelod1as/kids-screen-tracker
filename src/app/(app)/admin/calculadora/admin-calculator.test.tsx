// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// D57: exercise with the bonus ON, like the kid calculator's own test.
vi.mock("../../../../engine/flags", () => ({ BONUS_ENABLED: true }));

import { SEED_CATEGORIES } from "../../../../db/seed";
import type {
  EngineActivity,
  EngineCategory,
} from "../../../../engine/calculate";
import { shiftDate } from "../../../../engine/calculate";
import type { CalculatorData } from "../../../actions/calculator";
import type { Kid } from "../../../actions/people";
import { AdminCalculator } from "./admin-calculator";

const TODAY = "2026-09-02";
const BOOK = 5;
const FOOTBALL = 1;

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
          alternationBonusPct: category.alternationBonusPct ?? 0,
        },
      };
    }
  }

  throw new Error(`the seed has no activity ${id}`);
}

/** One activity per boy, so a switch is visible without leaning on the engine's arithmetic. */
function dataFor(userId: number, activityId: number): CalculatorData {
  const { activity, category } = seedActivity(activityId);

  return {
    userId,
    occurredOn: TODAY,
    historyFrom: shiftDate(TODAY, -30),
    historyTo: shiftDate(TODAY, 30),
    categories: [category],
    activities: [activity],
    history: [],
    participatingCategoryIds: [],
  };
}

const KIDS: Kid[] = [
  { id: 3, displayName: "Kid1" },
  { id: 4, displayName: "Kid2" },
];

const DATA: Record<number, CalculatorData> = {
  3: dataFor(3, BOOK),
  4: dataFor(4, FOOTBALL),
};

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root.render(<AdminCalculator dataByUserId={DATA} kids={KIDS} />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function clickButton(label: string): void {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (button === undefined) {
    throw new Error(`no button labelled ${label}`);
  }

  act(() => button.click());
}

describe("the admin calculator picks a boy (#76)", () => {
  it("offers both boys", () => {
    const labels = [...container.querySelectorAll("button")].map(
      (button) => button.textContent,
    );

    expect(labels).toContain("Kid1");
    expect(labels).toContain("Kid2");
  });

  it("simulates against the first boy's day until another is chosen", () => {
    const options = [...container.querySelectorAll("option")].map(
      (option) => option.textContent,
    );

    expect(options).toContain(seedActivity(BOOK).activity.name);
    expect(options).not.toContain(seedActivity(FOOTBALL).activity.name);
  });

  it("switches to the chosen boy's real day", () => {
    clickButton("Kid2");

    const options = [...container.querySelectorAll("option")].map(
      (option) => option.textContent,
    );

    expect(options).toContain(seedActivity(FOOTBALL).activity.name);
    expect(options).not.toContain(seedActivity(BOOK).activity.name);
  });

  it("says so when no boy is registered", async () => {
    const emptyContainer = document.createElement("div");
    document.body.append(emptyContainer);
    const emptyRoot = createRoot(emptyContainer);
    await act(async () => {
      emptyRoot.render(<AdminCalculator dataByUserId={{}} kids={[]} />);
    });

    expect(emptyContainer.textContent).toContain("Nenhum menino cadastrado.");

    act(() => emptyRoot.unmount());
    emptyContainer.remove();
  });
});
