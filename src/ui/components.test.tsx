import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Session } from "../auth/access";
import { Button } from "./button";
import { Field } from "./field";
import { accountItemFor, navigationFor } from "./navigation";
import { CONTENT_BOTTOM_CLASS, TOUCH_TARGET_CLASS } from "./style";

/**
 * Components that exist only as JSX, walked as plain objects without a DOM.
 * `next/navigation` is mocked so importing the client `Nav` needs no router.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/menino" }));

const { AppShell } = await import("./app-shell");
const { Nav } = await import("./nav");

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

function first(node: ReactNode, type: unknown): Element | undefined {
  return elements(node).find((element) => element.type === type);
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

describe("the frame every authenticated screen sits in (#14)", () => {
  it("renders the bar, with the menu for the session's role", () => {
    for (const session of [KID1, ADMIN1]) {
      const shell = AppShell({ children: null, session });
      const nav = first(shell, Nav);

      expect(nav, session.role).toBeDefined();
      expect(nav?.props.items).toEqual(navigationFor(session.role));
    }
  });

  it("gives the two roles different bars", () => {
    const kid = first(AppShell({ children: null, session: KID1 }), Nav);
    const admin = first(AppShell({ children: null, session: ADMIN1 }), Nav);

    expect(kid?.props.items).not.toEqual(admin?.props.items);
  });

  it("shows whose session it is, as the bar's account cell (#70)", () => {
    // Without it the bar has no way to the account page, or out.
    const nav = first(AppShell({ children: null, session: KID1 }), Nav);

    expect(nav?.props.account).toEqual(accountItemFor("Kid1"));
    expect((nav?.props.account as { label?: string })?.label).toBe("Kid1");
  });

  it("no longer draws a bar above the page (#70)", () => {
    const shell = AppShell({ children: null, session: KID1 });

    expect(first(shell, "header")).toBeUndefined();
    expect(first(shell, "form")).toBeUndefined();
  });

  it("pins the bar and keeps the end of the page out from under it (#70)", () => {
    const shell = AppShell({ children: null, session: KID1 });
    const fixed = elements(shell).find((element) =>
      String(element.props.className ?? "").includes("fixed"),
    );

    // The fixed box is out of the flow, so the column reserves its height.
    expect(fixed).toBeDefined();
    expect(String(fixed?.props.className)).toContain("bottom-0");
    expect(first(fixed?.props.children as ReactNode, Nav)).toBeDefined();

    const column = elements(shell)[0];
    expect(String(column?.props.className)).toContain(CONTENT_BOTTOM_CLASS);
  });

  it("renders the page it was given", () => {
    const shell = AppShell({ children: "conteúdo", session: KID1 });
    const main = first(shell, "main");

    expect(main?.props.children).toBe("conteúdo");
  });
});

describe("a labelled input (#14)", () => {
  const field = Field({ id: "username", label: "Usuário", name: "username" });

  it("renders a real label, tied to the input by id", () => {
    const label = first(field, "label");

    expect(label?.props.htmlFor).toBe("username");
    expect(label?.props.children).toBe("Usuário");
  });

  it("gives the input the same id, and the touch target", () => {
    const input = first(field, "input");

    expect(input?.props.id).toBe("username");
    expect(String(input?.props.className)).toContain(TOUCH_TARGET_CLASS);
  });

  it("does not accept a placeholder", () => {
    // An unused `@ts-expect-error` is itself an error, so typecheck holds both ways.
    // @ts-expect-error `placeholder` is not a prop of Field (#14)
    const rejected = <Field id="probe" label="Probe" placeholder="digite" />;

    expect(rejected.props.id).toBe("probe");
  });
});

describe("the only button in the app (#14)", () => {
  it("is a button carrying the 48 px target", () => {
    const button = Button({ children: "Entrar", type: "submit" });

    expect(button.type).toBe("button");
    expect(String(button.props.className)).toContain(TOUCH_TARGET_CLASS);
  });

  it("inverts when disabled rather than fading", () => {
    const button = Button({ children: "Entrando…", disabled: true });

    expect(String(button.props.className)).toContain("disabled:bg-white");
    expect(String(button.props.className)).toContain("disabled:text-black");
  });
});
