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
 * The bottom bar at 320 px, which is the width this app is actually designed
 * for.
 *
 * What was here instead was `navigationFor(role).length <= 4`, justified in a
 * comment as "four are 80, which leaves room for the longest label". Measured
 * in a browser at 320 x 568, it did not: each cell was 79 px, `Cronômetro` and
 * `Calculadora` came to `scrollWidth` 81, and the two words sat against each
 * other with no gap. A length check is a proxy for width and passes for a
 * label of any size.
 *
 * There is no layout engine in this test runner, so the width of a word is not
 * a thing this file can measure. What it can do is hold the two properties that
 * make the width stop mattering, and both of them were measured in a browser
 * before being written down:
 *
 * - the track cannot be widened by its contents (`minmax(0, 1fr)`), so the bar
 *   is always exactly the width of the screen;
 * - the label sits in a `w-full` span, so a word too long for the cell wraps.
 *   This is the one that was quietly false: as the link's own text the label is
 *   an anonymous flex item with no width to break against, and `break-words` on
 *   the link did nothing — a 17-character label still reached `scrollWidth` 96
 *   in a 79 px cell. Inside the span, the same label fits and a 34-character
 *   one makes the bar taller (61 px) instead of spilling out of it.
 *
 * After the fix, at 320 x 568: every cell 79 px with `scrollWidth` 79, every
 * label on one line, the longest at 72.2 px, 48 px tall, and no horizontal
 * overflow anywhere on the page.
 *
 * The account cell of #70 takes its own width off the top of that, and it is
 * content-sized: the name plus a rem either side, which is 71.4 px for `Kid1`
 * and 74.3 px for `Admin1`, the widest of the four. The boy's four menu cells
 * share what is left.
 *
 * Measured with it in place, and with the bar carrying the column's own side
 * rules so the two are exactly as wide as each other: at 390 x 844 every menu
 * cell is 78.6 px and every label is on one line; at 360 x 740 they are 71.1
 * and at 320 x 568 they are 61.1, and at both of those `Cronômetro` and
 * `Calculadora` wrap onto a second line. That is the guarantee below doing its
 * job rather than a fault — the bar stays 50 px, every cell stays 48 px tall,
 * and nothing spills sideways at any of the three widths. The menu labels are
 * to become icons on another branch, which gives the width back.
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

/** Every cell of the bar: the account one first, then the menu (#70). */
const cells = childrenOf(bar.props.children as ReactNode);

/** The menu cells alone, which is what the label cases are about. */
const links = cells.slice(1);

describe("the bar is exactly as wide as the screen (#14)", () => {
  it("gives every cell a track that its contents cannot widen", () => {
    // `1fr` alone has an implicit minimum of `auto`, which is the content's
    // own width: one long label would push the bar past the viewport and put
    // a horizontal scrollbar on every screen in the app.
    expect(
      (bar.props.style as { gridTemplateColumns: string }).gridTemplateColumns,
    ).toBe(
      `minmax(${TOUCH_TARGET_PX}px, auto) repeat(${items.length}, minmax(0, 1fr))`,
    );
  });

  it("leaves every cell wider than the touch target at 320 px", () => {
    // The shell draws a 2 px rule down each side, so the cells share 316, and
    // the account cell takes its own width off the top of that (#70). That cell
    // is content-sized: the widest of the four names is `Admin1` at 42.3 px,
    // measured in a browser at 12 px, and it carries a rem of padding either
    // side. The menu shares what is left.
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
    // The cell is a glyph and then the name (#74), so the name is found by
    // being the span rather than by being first.
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
      // The cell is a glyph and then the label (#74), so the label is found by
      // being the span rather than by being first. Taking `[0]` here used to
      // pass by accident and would now read the `<svg>`.
      const label = childrenOf(link.props.children as ReactNode).find(
        (child) => child.type === "span",
      );

      expect(label, `item ${index}`).toBeDefined();
      expect(label?.props.className, `item ${index}`).toBe(NAV_LABEL_CLASS);
      expect(label?.props.children, `item ${index}`).toBe(items[index]?.label);
    }
  });

  it("gives every cell a glyph, drawn in the cell's own ink", () => {
    // `currentColor` is what makes the current item work: the glyph and the
    // label invert together because neither of them names a colour. A glyph
    // with a colour of its own would survive the inversion and disappear.
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
    // `py-2` is 8 px on each side. A label that wraps has to stay inside the
    // target, or the bar grows and the screen above it shrinks.
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
