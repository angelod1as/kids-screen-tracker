import { describe, expect, it } from "vitest";

import { qualityChoices } from "./grade";

const labels = (...args: Parameters<typeof qualityChoices>) =>
  qualityChoices(...args).map((choice) => choice.label);

describe("the grade buttons (D60)", () => {
  it("are the five quarters, as percentages, before an activity is known", () => {
    expect(qualityChoices().map((choice) => choice.value)).toEqual([
      0, 0.25, 0.5, 0.75, 1,
    ]);
    expect(labels()).toEqual(["0%", "25%", "50%", "75%", "100%"]);
  });

  it("put beside each grade the grade times the activity's full value", () => {
    expect(labels({ calcMode: "delivery", value: 2 })).toEqual([
      "0% (0 min)",
      "25% (30 min)",
      "50% (1h)",
      "75% (1h30)",
      "100% (2h)",
    ]);
  });

  it("count a timed activity's full value over the chosen duration", () => {
    expect(labels({ calcMode: "duration", value: 1.5 }, 120)).toEqual([
      "0% (0 min)",
      "25% (45 min)",
      "50% (1h30)",
      "75% (2h15)",
      "100% (3h)",
    ]);
  });
});
