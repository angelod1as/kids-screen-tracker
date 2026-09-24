import { describe, expect, it } from "vitest";

import { durationMinutes } from "../engine/timer";
import { formatSignedHours } from "./dates";
import {
  formatClock,
  formatDecimalHours,
  formatDuration,
  formatHours,
  formatRecordedDuration,
} from "./hours";

describe("an amount of screen time, in hours and minutes (#105)", () => {
  it("says zero as minutes", () => {
    expect(formatHours(0)).toBe("0 min");
  });

  it("says only minutes below the hour", () => {
    expect(formatHours(1 / 60)).toBe("1 min");
    expect(formatHours(0.3)).toBe("18 min");
    expect(formatHours(59 / 60)).toBe("59 min");
  });

  it("says whole hours without minutes, and pads the leftover", () => {
    expect(formatHours(1)).toBe("1h");
    expect(formatHours(61 / 60)).toBe("1h01");
    expect(formatHours(1.43)).toBe("1h26");
    expect(formatHours(2)).toBe("2h");
    expect(formatHours(3.75)).toBe("3h45");
  });

  it("rounds to the nearest minute, carrying into the hour", () => {
    expect(formatHours(0.99)).toBe("59 min");
    expect(formatHours(0.995)).toBe("1h");
    expect(formatHours(1.999)).toBe("2h");
    expect(formatHours(0.1 + 0.2)).toBe("18 min");
  });

  it("keeps the sign on a negative balance, as U+2212", () => {
    expect(formatHours(-1.5)).toBe("\u22121h30");
    expect(formatHours(-0.3)).toBe("\u221218 min");
    expect(formatHours(-3)).not.toContain("\u002D");
  });

  it("drops the sign when the minutes round to zero", () => {
    expect(formatHours(-0.001)).toBe("0 min");
  });

  it("writes the same minus the extract writes", () => {
    expect(formatHours(-3)).toBe(formatSignedHours(-3));
    expect(formatHours(3)).toBe(formatSignedHours(3).slice(1));
  });

  it("is the button format for a whole number of minutes", () => {
    for (let minutes = 0; minutes <= 600; minutes += 1) {
      expect(formatHours(minutes / 60)).toBe(formatDuration(minutes));
    }
  });
});

describe("a per-hour quantity of the Configuration (#105)", () => {
  it("keeps two decimals, a comma and the unit", () => {
    expect(formatDecimalHours(2.5)).toBe("2,50 h");
    expect(formatDecimalHours(0.25)).toBe("0,25 h");
    expect(formatDecimalHours(-3)).toBe("\u22123,00 h");
  });
});

describe("a duration on a button (#17)", () => {
  it("says minutes below the hour", () => {
    expect(formatDuration(15)).toBe("15 min");
    expect(formatDuration(45)).toBe("45 min");
  });

  it("says whole hours without a zero after them", () => {
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(180)).toBe("3h");
  });

  it("says the leftover minutes as a clock does", () => {
    expect(formatDuration(90)).toBe("1h30");
    expect(formatDuration(150)).toBe("2h30");
  });

  it("pads a leftover under ten, so 2h05 is not read as 2h50", () => {
    expect(formatDuration(125)).toBe("2h05");
  });
});

describe("a duration the stopwatch measured (#71)", () => {
  it("says the seconds while there is no minute to say", () => {
    expect(formatRecordedDuration(0)).toBe("0s");
    expect(formatRecordedDuration(9)).toBe("9s");
    expect(formatRecordedDuration(29)).toBe("29s");
  });

  it("switches units where the engine rounds, at half a minute", () => {
    expect(formatRecordedDuration(29)).toBe("29s");
    expect(formatRecordedDuration(30)).toBe("1 min");
  });

  it("says the minute that is charged, not the seconds that were measured", () => {
    expect(formatRecordedDuration(30)).toBe("1 min");
    expect(formatRecordedDuration(45)).toBe("1 min");
    expect(formatRecordedDuration(59)).toBe("1 min");
    expect(formatRecordedDuration(60)).toBe("1 min");
    expect(formatRecordedDuration(69)).toBe("1 min");
    expect(formatRecordedDuration(89)).toBe("1 min");
  });

  it("agrees with the engine at every second of the first five minutes", () => {
    // A property, not a list: a list is what let the two thresholds drift apart.
    for (let seconds = 0; seconds <= 300; seconds += 1) {
      const minutes = durationMinutes(seconds);

      expect(formatRecordedDuration(seconds)).toBe(
        minutes === 0 ? `${seconds}s` : formatDuration(minutes),
      );
    }
  });

  it("rounds to the nearest minute above, and reads as a clock does", () => {
    expect(formatRecordedDuration(90)).toBe("2 min");
    expect(formatRecordedDuration(3600)).toBe("1h");
    expect(formatRecordedDuration(5400)).toBe("1h30");
  });

  it("floors a fraction of a second and clamps a clock that ran backwards", () => {
    expect(formatRecordedDuration(29.999)).toBe("29s");
    expect(formatRecordedDuration(-90)).toBe("0s");
  });

  it("is not the running clock", () => {
    expect(formatRecordedDuration(69)).not.toBe(formatClock(69));
  });
});

describe("a running clock", () => {
  it("reads as minutes and seconds under an hour", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(5)).toBe("00:05");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(599)).toBe("09:59");
    expect(formatClock(3599)).toBe("59:59");
  });

  it("adds the hour once there is one", () => {
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3661)).toBe("1:01:01");
    expect(formatClock(7200)).toBe("2:00:00");
  });

  it("floors, so a minute is never shown before it has passed", () => {
    expect(formatClock(59.9)).toBe("00:59");
    expect(formatClock(3599.99)).toBe("59:59");
  });

  it("clamps a clock that ran backwards", () => {
    expect(formatClock(-30)).toBe("00:00");
  });

  it("is not `formatDuration`, which labels a button", () => {
    expect(formatClock(5400)).toBe("1:30:00");
    expect(formatDuration(90)).toBe("1h30");
  });
});
