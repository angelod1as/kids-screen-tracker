import { describe, expect, it, vi } from "vitest";

import type { Session } from "../auth/access";

/**
 * The five redirects that decide which screen a browser is allowed to render.
 *
 * The guard that matters is the one inside each server action, and
 * `balance.test.ts` sends the forged POST at it. This file covers the other
 * half — the navigation — for a reason the review round found by deleting it:
 * every one of these five `redirect` calls could be removed and the suite
 * stayed at 459 green. They work in the running app; nothing here noticed.
 *
 * Each layout and page is an async function, so it is called as one. Two
 * modules are replaced and neither is the thing under test:
 *
 * - `../auth/guard`, so a case can say "the browser presents Kid1's cookie"
 *   without a request context. What `currentSession` itself does — signature,
 *   database lookup, `active = false` — has its own suite in `guard.test.ts`.
 * - `next/navigation`, so the destination of a redirect is readable. `redirect`
 *   throws inside Next, and the replacement throws too: the code after it must
 *   not run, and a test that let it run would be testing a different function.
 *
 * `../auth/env` is replaced because the login screen reaches it through the
 * action it imports, and it is the module that reads Varlock (D23).
 */

const mocked = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("../auth/guard", () => ({
  currentSession: async () => mocked.session,
}));

vi.mock("../auth/env", () => ({
  sessionSecret: () => "test-session-secret-not-the-real-one",
}));

/** Keeps `redirect`'s shape: it throws, so nothing below it runs. */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  usePathname: () => "/",
}));

const ADMIN1: Session = {
  userId: 1,
  username: "admin1",
  displayName: "Admin1",
  role: "admin",
};

const KID1: Session = {
  userId: 3,
  username: "kid1",
  displayName: "Kid1",
  role: "kid",
};

type Segment = (props: { children: unknown }) => Promise<unknown>;

/**
 * Runs a segment and reports where it sent the browser, or `null` if it
 * rendered instead.
 *
 * Anything thrown that is not a redirect is re-thrown: a segment that blows up
 * has not "not redirected", and swallowing it here would turn a broken screen
 * into a passing case.
 */
async function destination(
  segment: Segment,
  session: Session | null,
): Promise<string | null> {
  mocked.session = session;

  try {
    await segment({ children: null });
  } catch (thrown) {
    if (thrown instanceof Redirected) {
      return thrown.to;
    }

    throw thrown;
  }

  return null;
}

const authenticated = (await import("./(app)/layout")).default as Segment;
const adminLayout = (await import("./(app)/admin/layout")).default as Segment;
const kidLayout = (await import("./(app)/menino/layout")).default as Segment;
const rootPage = (await import("./page")).default as Segment;
const loginPage = (await import("./entrar/page")).default as Segment;

describe("everything behind a login (src/app/(app)/layout.tsx)", () => {
  it("sends a visitor with no session to the login screen", async () => {
    await expect(destination(authenticated, null)).resolves.toBe("/entrar");
  });

  it("renders for someone who has one", async () => {
    await expect(destination(authenticated, KID1)).resolves.toBeNull();
    await expect(destination(authenticated, ADMIN1)).resolves.toBeNull();
  });
});

describe("the admin area (src/app/(app)/admin/layout.tsx)", () => {
  it("sends a kid back to his own home", async () => {
    await expect(destination(adminLayout, KID1)).resolves.toBe("/menino");
  });

  it("sends a visitor with no session to the login screen", async () => {
    await expect(destination(adminLayout, null)).resolves.toBe("/entrar");
  });

  it("lets an admin through", async () => {
    await expect(destination(adminLayout, ADMIN1)).resolves.toBeNull();
  });
});

describe("the boy's area (src/app/(app)/menino/layout.tsx)", () => {
  it("sends an admin to the admin home", async () => {
    // These screens read `session.userId`, and an admin has no balance of his
    // own; he sees both boys from `/admin`.
    await expect(destination(kidLayout, ADMIN1)).resolves.toBe("/admin");
  });

  it("sends a visitor with no session to the login screen", async () => {
    await expect(destination(kidLayout, null)).resolves.toBe("/entrar");
  });

  it("lets a kid through", async () => {
    await expect(destination(kidLayout, KID1)).resolves.toBeNull();
  });
});

describe("the signpost at / (src/app/page.tsx)", () => {
  it("sends each role to its own home", async () => {
    await expect(destination(rootPage, KID1)).resolves.toBe("/menino");
    await expect(destination(rootPage, ADMIN1)).resolves.toBe("/admin");
  });

  it("sends a visitor with no session to the login screen", async () => {
    await expect(destination(rootPage, null)).resolves.toBe("/entrar");
  });

  it("never renders anything of its own", async () => {
    // It is a redirect and nothing else, for all three cases above.
    for (const session of [KID1, ADMIN1, null]) {
      await expect(destination(rootPage, session)).resolves.not.toBeNull();
    }
  });
});

describe("the login screen (src/app/entrar/page.tsx)", () => {
  it("sends someone who already has a session to his own home", async () => {
    await expect(destination(loginPage, KID1)).resolves.toBe("/menino");
    await expect(destination(loginPage, ADMIN1)).resolves.toBe("/admin");
  });

  it("shows the form to a visitor with no session", async () => {
    await expect(destination(loginPage, null)).resolves.toBeNull();
  });
});
