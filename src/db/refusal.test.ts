import { describe, expect, it } from "vitest";

import { RefusalError, refusedOr } from "./refusal";

describe("refusedOr (#7)", () => {
  it("passes an answer through", () => {
    expect(refusedOr(() => [1, 2])).toEqual([1, 2]);
  });

  it("returns a RefusalError's sentence", () => {
    expect(
      refusedOr(() => {
        throw new RefusalError("Decida essa primeiro.");
      }),
    ).toEqual({ refused: "Decida essa primeiro." });
  });

  it("rethrows anything else, so its message never reaches the browser", () => {
    const other = new Error("there is no log 7");

    expect(() =>
      refusedOr(() => {
        throw other;
      }),
    ).toThrow(other);
  });
});
