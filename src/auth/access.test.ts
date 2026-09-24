import { describe, expect, it } from "vitest";

import { isAllowed } from "./access";
import { ACCESS_CASES, KID1, KID2 } from "./access.rules";

/**
 * One test per case of `ACCESS_CASES`, which is one or more per acceptance
 * criterion of #13. The table is grouped by rule so a failure names the rule
 * that broke rather than a line number.
 */

const RULES = [...new Set(ACCESS_CASES.map((accessCase) => accessCase.rule))];

describe.each(RULES)("%s", (rule) => {
  const cases = ACCESS_CASES.filter((accessCase) => accessCase.rule === rule);

  it.each(cases)("$name", ({ session, request, allowed }) => {
    expect(isAllowed(session, request)).toBe(allowed);
  });
});

describe("every case of the table is exercised", () => {
  it("covers all four kinds of request for a kid", () => {
    // A kind nobody wrote a case for is a kind whose rule nothing holds. The
    // sabotage matrix cannot catch a mutation in a branch the table never
    // reaches, so the table has to reach all of them.
    const kinds = new Set(
      ACCESS_CASES.filter(
        (accessCase) => accessCase.session.role === "kid",
      ).map((accessCase) => accessCase.request.kind),
    );

    expect([...kinds].sort()).toEqual([
      "proposeTimerLog",
      "simulate",
      "view",
      "write",
    ]);
  });

  it("contains both an allowed and a denied case for each role", () => {
    for (const role of ["admin", "kid"] as const) {
      const forRole = ACCESS_CASES.filter(
        (accessCase) => accessCase.session.role === role,
      );

      expect(forRole.some((accessCase) => accessCase.allowed)).toBe(true);
      expect(forRole.some((accessCase) => !accessCase.allowed)).toBe(
        role === "kid",
      );
    }
  });
});

describe("the rule does not depend on the name in the session", () => {
  it("compares ids, not usernames", () => {
    // A guard written against `session.username` breaks the day someone is
    // renamed, and it silently compares the wrong pair whenever a caller has an
    // id and no name — which is every server action, because an id is what a
    // forged request carries.
    const impostor = { ...KID1, username: "kid2", displayName: "Kid2" };

    expect(
      isAllowed(impostor, { kind: "view", targetUserId: KID2.userId }),
    ).toBe(false);
    expect(
      isAllowed(impostor, { kind: "view", targetUserId: KID1.userId }),
    ).toBe(true);
  });
});
