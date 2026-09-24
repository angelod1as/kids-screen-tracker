import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Session } from "../../auth/access";

/**
 * `../../auth/guard` is replaced to say who is logged in, `../actions/session`
 * because it reads Varlock (D23). The form's action is compared by identity.
 */

const mocked = vi.hoisted(() => ({ session: null as Session | null }));

const logoutAction = vi.hoisted(() => async () => undefined);

vi.mock("../../auth/guard", () => ({
  requireSession: async () => mocked.session,
}));

vi.mock("../actions/session", () => ({ logoutAction }));

const AccountPage = (await import("./conta/page")).default;

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
