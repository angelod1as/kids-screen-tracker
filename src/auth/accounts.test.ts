import { describe, expect, it } from "vitest";

import { normalizeUsername } from "./accounts";

describe("normalizeUsername", () => {
  it("takes what a phone keyboard types to what `users` stores", () => {
    expect(normalizeUsername("Kid1")).toBe("kid1");
    expect(normalizeUsername("  KID2  ")).toBe("kid2");
    expect(normalizeUsername("kid1 ")).toBe("kid1");
  });

  it("changes nothing else", () => {
    expect(normalizeUsername("kid1x")).toBe("kid1x");
    expect(normalizeUsername("")).toBe("");
  });
});
