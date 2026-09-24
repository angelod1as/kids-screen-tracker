import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Session } from "../../auth/access";

/**
 * The account page (#70), which is where the top bar's two jobs went.
 *
 * The old bar wrote the name and offered "Sair" above every screen. The name is
 * now the first cell of the bottom bar and the way out is here, one tap behind
 * it — so this file holds what `components.test.tsx` used to hold about the
 * logout form, plus the half that is new: what an admin gets here and a boy
 * does not.
 *
 * `../../auth/guard` is replaced so a case can say who is logged in, and
 * `../actions/session` because it reads Varlock (D23). The identity of the
 * logout mock is what the form's action is compared against, so "the button
 * logs out" is an assertion and not a shape check.
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

/** Every `href` the page offers, whatever component drew it. */
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
    // It left the bottom bar with this issue, so this is the only place it is
    // reachable from — a page that dropped it would strand the screen.
    const page = await screen(ADMIN1);

    expect(links(page)).toEqual([
      "/conta/como-funciona",
      "/admin/configuracao",
    ]);
  });

  it("never offers a boy an admin route", async () => {
    // The menu half of the access rule. The half that holds is the admin
    // layout and the guard inside every action behind that link.
    for (const href of links(await screen(KID1))) {
      expect(href.startsWith("/admin")).toBe(false);
    }
  });

  it("writes whose account it is", async () => {
    // Since #74 the name is the title of the panel the page is built from, so
    // it arrives as a prop of `Panel` and as the children of the heading that
    // panel renders. Either satisfies the rule this is checking — the screen
    // says whose account it is — so both are looked at rather than pinning the
    // one the markup happens to use today.
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
    // `hidden` on this form was a mutation nothing caught when it lived in the
    // shell: logout kept working and stopped being reachable.
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
