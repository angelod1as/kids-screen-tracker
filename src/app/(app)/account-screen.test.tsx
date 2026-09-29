import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Session } from "../../auth/access";

/**
 * `../../auth/guard` is replaced to say who is logged in, `../actions/session`
 * and `../../push/vapid` because they read Varlock (D23). The form's action is
 * compared by identity.
 */

const mocked = vi.hoisted(() => ({
  session: null as Session | null,
  publicKey: null as string | null,
}));

const logoutAction = vi.hoisted(() => async () => undefined);

vi.mock("../../auth/guard", () => ({
  requireSession: async () => mocked.session,
}));

vi.mock("../actions/session", () => ({ logoutAction }));

vi.mock("../../push/vapid", () => ({
  vapidPublicKey: () => mocked.publicKey,
}));

const AccountPage = (await import("./conta/page")).default;
const { PushToggle } = await import("./conta/push-toggle");
const { Button } = await import("../../ui/button");
const { LinkButton } = await import("../../ui/link-button");

type Element = { type: unknown; props: Record<string, unknown> };

function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) {
    return node.flatMap(elements);
  }

  if (!isValidElement(node)) {
    return [];
  }

  const props = node.props as Record<string, unknown>;

  return [{ type: node.type, props }, ...elements(props.children as ReactNode)];
}

const KID1: Session = {
  userId: 3,
  username: "kid1",
  displayName: "Kid1",
  role: "kid",
};

const ADMIN1: Session = {
  userId: 1,
  username: "admin1",
  displayName: "Admin1",
  role: "admin",
};

async function screen(session: Session): Promise<Element[]> {
  mocked.session = session;

  return elements(await AccountPage());
}

function links(page: Element[]): string[] {
  return page
    .map((element) => element.props.href)
    .filter((href): href is string => typeof href === "string");
}

describe("the account page, per role (#70)", () => {
  it("gives a boy Como funciona and the way out", async () => {
    const page = await screen(KID1);

    expect(page.map((element) => element.props.children)).toContain("Sair");
    expect(links(page)).toEqual(["/conta/como-funciona"]);
  });

  it("gives an admin Configuração as well", async () => {
    // It left the bottom bar (#70); this is the only way to reach it.
    const page = await screen(ADMIN1);

    expect(links(page)).toEqual([
      "/conta/como-funciona",
      "/admin/configuracao",
    ]);
  });

  it("never offers a boy an admin route", async () => {
    for (const href of links(await screen(KID1))) {
      expect(href.startsWith("/admin")).toBe(false);
    }
  });

  it("writes whose account it is", async () => {
    // The name reaches the page as `Panel`'s title and as heading children; either counts.
    const page = await screen(KID1);
    const written = page.flatMap((element) => [
      element.props.children,
      element.props.title,
    ]);

    expect(written).toContain("Kid1");
  });
});

describe("logging out", () => {
  it("submits to the logout action, visibly", async () => {
    // `hidden` here once kept logout working and unreachable.
    const form = (await screen(KID1)).find(
      (element) => element.type === "form",
    );

    expect(form?.props.action).toBe(logoutAction);
    expect(form?.props.hidden).toBeUndefined();
    expect(String(form?.props.className ?? "")).not.toContain("hidden");
  });

  it("is a submit button labelled in Portuguese", async () => {
    const button = (await screen(KID1)).find(
      (element) => element.props.children === "Sair",
    );

    expect(button?.props.type).toBe("submit");
  });
});

describe("what stands out, and what waits at the foot (#35)", () => {
  function linkVariant(page: Element[], href: string): unknown {
    return page.find(
      (element) => element.type === LinkButton && element.props.href === href,
    )?.props.variant;
  }

  it("makes Como funciona the primary control, for both roles", async () => {
    for (const session of [KID1, ADMIN1]) {
      expect(linkVariant(await screen(session), "/conta/como-funciona")).toBe(
        undefined,
      );
    }
  });

  it("keeps an admin's Configuração secondary", async () => {
    expect(linkVariant(await screen(ADMIN1), "/admin/configuracao")).toBe(
      "secondary",
    );
  });

  it("puts Sair last, red, and in no panel, for both roles", async () => {
    for (const session of [KID1, ADMIN1]) {
      mocked.session = session;
      const top = (await AccountPage()).props.children as ReactNode[];
      const last = elements(top.filter(Boolean).at(-1));
      const button = last.find((element) => element.type === Button);

      expect(last[0]?.type).toBe("form");
      expect(button?.props.children).toBe("Sair");
      expect(button?.props.variant).toBe("destructive");
    }
  });
});

describe("the push control (D51)", () => {
  it("is offered to both roles, with the server's public key", async () => {
    mocked.publicKey = "test-public-key";

    for (const session of [KID1, ADMIN1]) {
      const toggle = (await screen(session)).find(
        (element) => element.type === PushToggle,
      );

      expect(toggle?.props.publicKey).toBe("test-public-key");
    }
  });

  it("says push is off on the server when no key is configured", async () => {
    mocked.publicKey = null;

    const toggle = (await screen(KID1)).find(
      (element) => element.type === PushToggle,
    );

    expect(toggle?.props.publicKey).toBeNull();
  });
});
