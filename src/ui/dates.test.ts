import { describe, expect, it } from "vitest";

import { formatDay, formatSignedHours } from "./dates";

describe("a calendar date on screen (D13)", () => {
  it("is written the way a Brazilian reader writes it", () => {
    expect(formatDay("2026-09-02")).toBe("02/09/2026");
  });

  it("keeps the day the column holds, whatever the machine's time zone", () => {
    // `new Date("2026-01-01")` formatted in São Paulo is 31 December (D13).
    expect(formatDay("2026-01-01")).toBe("01/01/2026");
    expect(formatDay("2025-12-31")).toBe("31/12/2025");
  });

  it("refuses anything that is not YYYY-MM-DD", () => {
    expect(() => formatDay("02/09/2026")).toThrow();
    expect(() => formatDay("2026-9-2")).toThrow();
    expect(() => formatDay("")).toThrow();
  });
});

describe("hours with their sign (#16)", () => {
  it("puts a plus in front of what was earned", () => {
    expect(formatSignedHours(2)).toBe("+2h");
    expect(formatSignedHours(0.25)).toBe("+15 min");
  });

  it("puts a real minus sign in front of what was spent", () => {
    expect(formatSignedHours(-1.5)).toBe("−1h30");
    expect(formatSignedHours(-1.5).charCodeAt(0)).toBe(0x2212);
  });

  it("writes hours and minutes, like every other duration in the app", () => {
    expect(formatSignedHours(3)).toBe("+3h");
    expect(formatSignedHours(-0.1)).toBe("−6 min");
  });

  it("treats zero as a plus rather than as a minus", () => {
    // Nothing produces a zero today (D10); "−0 min" would still be wrong.
    expect(formatSignedHours(0)).toBe("+0 min");
    expect(formatSignedHours(-0.001)).toBe("+0 min");
  });
});
