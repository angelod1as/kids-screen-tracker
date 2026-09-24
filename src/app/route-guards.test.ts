import { describe, expect, it, vi } from "vitest";

import type { Session } from "../auth/access";

/**
 * The navigation half: every one of these redirects could be deleted with the
 * suite green. `../auth/guard` and `next/navigation` are replaced; `../auth/env`
 * too, since the login screen reaches Varlock through its action (D23).
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

/** Anything thrown that is not a redirect is re-thrown: a crash has not "not redirected". */
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
