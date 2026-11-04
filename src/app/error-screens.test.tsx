import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "../ui/button";
import { LinkButton } from "../ui/link-button";
import AppError from "./error";
import GlobalError from "./global-error";
import NotFound from "./not-found";

/**
 * Without these, Next answers in English (#14), and `design.test.ts` cannot see
 * it: it reads `lang` from the root layout. Elements are walked as plain objects.
 */

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(textOf).join(" ");
  }

  if (isValidElement(node)) {
    return textOf((node.props as { children?: ReactNode }).children);
  }

  return "";
}

function find(node: ReactNode, type: unknown): ReactNode | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, type);
      if (found !== undefined) {
        return found;
      }
    }

    return undefined;
  }

  if (!isValidElement(node)) {
    return undefined;
  }

  if (node.type === type) {
    return node;
  }

  return find((node.props as { children?: ReactNode }).children, type);
}

function homeHref(node: ReactNode): string | undefined {
  return (find(node, LinkButton) as { props: { href: string } } | undefined)
    ?.props.href;
}

const ENGLISH = /this page could not be found|something went wrong|try again/i;

describe("the page a wrong address gets (#14)", () => {
  const screen = NotFound();

  it("is in Brazilian Portuguese", () => {
    expect(textOf(screen)).toContain("Página não encontrada");
  });

  it("links to the home screen, since the installed app has no back button (D46)", () => {
    expect(homeHref(screen)).toBe("/");
  });

  it("is not Next's English default", () => {
    expect(textOf(screen)).not.toMatch(ENGLISH);
  });
});

describe("the page a crash gets (#14)", () => {
  const screen = AppError({ reset: () => undefined });

  it("is in Brazilian Portuguese", () => {
    expect(textOf(screen)).toContain("Algo deu errado");
  });

  it("is not Next's English default", () => {
    expect(textOf(screen)).not.toMatch(ENGLISH);
  });

  it("offers a way out that runs the reset Next hands it", () => {
    let reset = 0;
    const withCounter = AppError({
      reset: () => {
        reset += 1;
      },
    });
    const button = find(withCounter, Button);
    const onClick = (button as { props: { onClick: () => void } } | undefined)
      ?.props.onClick;

    expect(onClick).toBeTypeOf("function");
    onClick?.();
    expect(reset).toBe(1);
  });

  it("links to the home screen", () => {
    expect(homeHref(screen)).toBe("/");
  });
});

describe("the page a crash in the root layout gets (#14)", () => {
  const screen = GlobalError({ reset: () => undefined });

  it("declares the language itself, because it replaces the root layout", () => {
    expect((screen as { props: { lang?: string } }).props.lang).toBe("pt-BR");
  });

  it("is in Brazilian Portuguese", () => {
    expect(textOf(screen)).toContain("Algo deu errado");
  });

  it("loads the home screen in full, since a client navigation keeps it up", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    const body = (screen as { props: { children: ReactNode } }).props.children;
    const panel = (body as { props: { children: ReactNode } }).props.children;
    const buttons = (panel as { props: { children: ReactNode[] } }).props
      .children;
    const home = buttons.find(
      (child) =>
        isValidElement(child) && textOf(child) === "Ir para a tela inicial",
    ) as { props: { onClick: () => void } } | undefined;

    home?.props.onClick();
    vi.unstubAllGlobals();

    expect(assign).toHaveBeenCalledWith("/");
  });
});

describe("what an error screen tells the person looking at it", () => {
  it("prints no message from the error itself", () => {
    // A refusal is thrown, so it reaches the browser here; other messages name internals.
    const shown = textOf(AppError({ reset: () => undefined }));

    expect(shown).not.toContain("Acesso negado");
    expect(shown).not.toContain("Error");
  });
});
