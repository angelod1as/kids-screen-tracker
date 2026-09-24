import { describe, expect, it } from "vitest";

import { formatDay, formatSignedHours } from "./dates";

describe("a calendar date on screen (D13)", () => {
  it("is written the way a Brazilian reader writes it", () => {
    expect(formatDay("2026-09-02")).toBe("02/09/2026");
  });

  it("keeps the day the column holds, whatever the machine's time zone", () => {
    // The bug this function exists to avoid: `new Date("2026-01-01")` is
    // midnight UTC, and formatting it in São Paulo is 21:00 on 31 December —
    // every entry in the history reading as the day before. Nothing here parses
    // a date, so the boundary cases are just string slices.
    expect(formatDay("2026-01-01")).toBe("01/01/2026");
    expect(formatDay("2025-12-31")).toBe("31/12/2025");
  });

  it("refuses anything that is not YYYY-MM-DD", () => {
    // A malformed date reaching the screen as "undefined/undefined" is a bug
    // that looks like a styling problem.
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
    // U+2212, not a hyphen: at this size a hyphen beside a digit disappears,
    // and the direction is the whole point of the line.
    expect(formatSignedHours(-1.5)).toBe("−1h30");
    expect(formatSignedHours(-1.5).charCodeAt(0)).toBe(0x2212);
  });

  it("writes hours and minutes, like every other duration in the app", () => {
    expect(formatSignedHours(3)).toBe("+3h");
    expect(formatSignedHours(-0.1)).toBe("−6 min");
  });

  it("treats zero as a plus rather than as a minus", () => {
    // D10 keeps a zero out of the ledger, so this is a case nothing produces
    // today. "−0 min" would still be the wrong thing to draw the day
    // something does.
    expect(formatSignedHours(0)).toBe("+0 min");
    expect(formatSignedHours(-0.001)).toBe("+0 min");
  });
});
