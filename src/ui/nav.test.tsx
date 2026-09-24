import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { accountItemFor, navigationFor } from "./navigation";
import {
  BORDER_PX,
  NARROWEST_PHONE_PX,
  NAV_LABEL_CLASS,
  NAV_LABEL_LINE_HEIGHT,
  NAV_LABEL_PX,
  NAV_SAFE_BOTTOM_CLASS,
  TOUCH_TARGET_CLASS,
  TOUCH_TARGET_PX,
} from "./style";

/**
 * The bar at 320 px. No layout engine here, so these hold the two properties
 * that make a word's width stop mattering: a track its contents cannot widen,
 * and a label in a `w-full` span that wraps (see `NAV_LABEL_CLASS`).
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/menino",
}));

const { Nav } = await import("./nav");

type Element = { type: unknown; props: Record<string, unknown> };

function childrenOf(node: ReactNode): Element[] {
  if (Array.isArray(node)) {
    return node.flatMap(childrenOf);
  }

  return isValidElement(node)
    ? [{ type: node.type, props: node.props as Record<string, unknown> }]
    : [];
}

const items = navigationFor("kid");
const account = accountItemFor("Kid1");
const bar = Nav({ account, items }) as unknown as Element;

const cells = childrenOf(bar.props.children as ReactNode);

const links = cells.slice(1);

describe("the bar is exactly as wide as the screen (#14)", () => {
  it("gives every cell a track that its contents cannot widen", () => {
    // `1fr` alone has an implicit `auto` minimum: one long label would push the
    // bar past the viewport.
    expect(
      (bar.props.style as { gridTemplateColumns: string }).gridTemplateColumns,
    ).toBe(
      `minmax(${TOUCH_TARGET_PX}px, auto) repeat(${items.length}, minmax(0, 1fr))`,
    );
  });

  it("leaves every cell wider than the touch target at 320 px", () => {
    // 42.3 px: the widest display name, measured in a browser at 12 px.
    const widestAccountCell = 42.3 + 2 * 16;
    const cell =
      (NARROWEST_PHONE_PX - 2 * BORDER_PX - widestAccountCell) / items.length;

    expect(Math.round(cell * 10) / 10).toBe(60.4);
    expect(cell).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
  });
});

describe("who is logged in, on the left of the bar (#70)", () => {
  it("puts the account cell first, before the menu", () => {
    expect(cells).toHaveLength(items.length + 1);

    const identity = cells[0];

    expect(identity?.props.href).toBe(account.href);
    expect(
      childrenOf(identity?.props.children as ReactNode).find(
        (child) => child.type === "span",
      )?.props.children,
    ).toBe("Kid1");
  });

  it("says what it is to a screen reader, which a first name does not", () => {
    expect(cells[0]?.props["aria-label"]).toBe("Conta de Kid1");
  });

  it("keeps the iPhone home indicator out of the bar", () => {
    expect(String(bar.props.className)).toContain(NAV_SAFE_BOTTOM_CLASS);
  });
});

describe("a label that does not fit wraps instead of spilling (#14)", () => {
  it("puts every label in a span with a width to break against", () => {
    expect(links).toHaveLength(items.length);

    for (const [index, link] of links.entries()) {
      // The span, not `[0]`, which is now the `<svg>` (#74).
      const label = childrenOf(link.props.children as ReactNode).find(
        (child) => child.type === "span",
      );

      expect(label, `item ${index}`).toBeDefined();
      expect(label?.props.className, `item ${index}`).toBe(NAV_LABEL_CLASS);
      expect(label?.props.children, `item ${index}`).toBe(items[index]?.label);
    }
  });

  it("gives every cell a glyph, drawn in the cell's own ink", () => {
    // A glyph with its own colour would survive the inversion and vanish.
    for (const [index, link] of links.entries()) {
      const glyph = childrenOf(link.props.children as ReactNode).find(
        (child) => child.type !== "span",
      );

      expect(glyph, `item ${index}`).toBeDefined();
    }
  });

  it("wraps rather than truncates, and breaks a word with nowhere to wrap", () => {
    expect(NAV_LABEL_CLASS).toContain("w-full");
    expect(NAV_LABEL_CLASS).toContain("break-words");
    expect(NAV_LABEL_CLASS).not.toContain("truncate");
  });

  it("fits two wrapped lines inside the 48 px target", () => {
    const twoLines = 2 * NAV_LABEL_PX * NAV_LABEL_LINE_HEIGHT;

    expect(twoLines + 2 * 8).toBeLessThanOrEqual(TOUCH_TARGET_PX);
  });
});

describe("every cell is still a 48 px target", () => {
  it("carries the class on the link itself, not on the label", () => {
    for (const link of cells) {
      expect(link.props.className).toContain(TOUCH_TARGET_CLASS);
      expect(link.props.className).toContain("min-w-0");
    }
  });
});
