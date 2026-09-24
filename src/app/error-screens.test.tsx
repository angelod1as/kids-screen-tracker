import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { Button } from "../ui/button";
import AppError from "./error";
import GlobalError from "./global-error";
import NotFound from "./not-found";

/**
 * The two screens Next draws when nothing else does, and the criterion of #14
 * they were breaking: **toda a interface em pt-BR**.
 *
 * `GET /naoexiste` answered "This page could not be found." in English, and
 * nothing in the suite could have noticed: `design.test.ts` reads `lang` out of
 * the root layout, and the root layout is not what renders that screen.
 *
 * Nothing is mounted here. A React element is a plain object, so the tree a
 * component returns can be walked without a DOM, a renderer or a jsdom
 * environment — enough to answer what text it renders and with which props.
 */

/** Every string in the tree, in order. */
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

/** The first element in the tree with this tag or component type. */
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

const ENGLISH = /this page could not be found|something went wrong|try again/i;

describe("the page a wrong address gets (#14)", () => {
  const screen = NotFound();

  it("is in Brazilian Portuguese", () => {
    expect(textOf(screen)).toContain("Página não encontrada");
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
});

describe("the page a crash in the root layout gets (#14)", () => {
  const screen = GlobalError({ reset: () => undefined });

  it("declares the language itself, because it replaces the root layout", () => {
    // Next swaps the whole document out for this one, so `lang="pt-BR"` set in
    // `app/layout.tsx` does not reach it.
    expect((screen as { props: { lang?: string } }).props.lang).toBe("pt-BR");
  });

  it("is in Brazilian Portuguese", () => {
    expect(textOf(screen)).toContain("Algo deu errado");
  });
});

describe("what an error screen tells the person looking at it", () => {
  it("prints no message from the error itself", () => {
    // `AccessDeniedError` is thrown rather than returned, so a refusal reaches
    // a browser through this boundary. Its message was written to name neither
    // the caller nor the target; every other message in the tree was written
    // for a server log.
    const shown = textOf(AppError({ reset: () => undefined }));

    expect(shown).not.toContain("Acesso negado");
    expect(shown).not.toContain("Error");
  });
});
