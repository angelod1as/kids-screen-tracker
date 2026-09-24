import { describe, expect, it } from "vitest";

import { baseConfig } from "./next.config.base";

// The CI test step needs at least one real test to guard. This one pins the
// two build-output decisions the rest of the stack depends on, so removing
// either fails the pipeline instead of surfacing at deploy time.
describe("next.config.base", () => {
  it("builds a self-contained Node server (D22)", () => {
    expect(baseConfig.output).toBe("standalone");
  });

  it("does not advertise the framework in responses", () => {
    expect(baseConfig.poweredByHeader).toBe(false);
  });
});
