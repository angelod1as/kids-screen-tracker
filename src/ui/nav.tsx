"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { iconFor } from "./icons";
import type { NavItem } from "./navigation";
import { isCurrent } from "./navigation";
import {
  ACCENT_BG_CLASS,
  BORDER_CLASS,
  NAV_LABEL_CLASS,
  NAV_SAFE_BOTTOM_CLASS,
  TOUCH_TARGET_CLASS,
  TOUCH_TARGET_PX,
} from "./style";

/**
 * The bar at the bottom of every authenticated screen.
 *
 * A client component for one reason — `usePathname`, to mark the current page —
 * and it takes its items as a prop rather than a role, so it neither imports
 * the guard nor knows what a session is. Nothing here reads `ENV`: a
 * `"use client"` file that does compiles, builds, and then kills the server
 * process on the first request (see `src/db/index.ts`).
 *
 * The current page is inverted, not tinted: white on the accent against black
 * on white. A pale wash of the accent would be the grey-on-grey the design
 * rules rule out, whatever hue it wore, and it would leave the bar with no
 * strong mark at all.
 *
 * Every cell carries a glyph above its label (#74, `icons.tsx`), the account
 * cell included — a person over the name. The glyph is drawn in `currentColor`,
 * so it inverts with the cell and neither half of the pair has to know what the
 * other is doing. It also buys the width back that #70's account cell took:
 * `style.ts` notes the boy's menu cells dropped to 61 px at 320, and a 24 px
 * glyph is recognisable in a cell where a 72 px word is not.
 *
 * The first cell is who is logged in (#70), and it is a cell like any other:
 * it leads to the account page, and it is inverted there like every other item
 * is on its own screen. It replaces the top bar that used to write the name and
 * a large "Sair" on every screen — the boy knows who he is, and logging out is
 * not something he does on a Tuesday. Its track is `minmax(48px, auto)`, so the
 * name is as wide as it needs and never narrower than a thumb, and the menu
 * items share what is left.
 *
 * `auto` is the one track here that its contents *can* widen, which is the
 * opposite of the guarantee `minmax(0, 1fr)` gives the menu cells. It is safe
 * because the display names are short first names, the widest measured at
 * 44 px at 320. A longer name would take width from the menu rather than overflow, and
 * that is the moment to give this cell a ceiling.
 *
 * The label is wrapped in a `<span>` rather than being the link's own text, and
 * that span is what makes the wrapping guarantee real. Measured at 320 x 568:
 * with the text as the link's direct content, it is an anonymous flex item that
 * is never width-constrained, so `break-words` did nothing and a 17-character
 * label still reached `scrollWidth` 96 in a 79 px cell. Inside a `w-full` span
 * it wraps instead, and a 34-character label makes the bar taller rather than
 * spilling out of it.
 */
export function Nav({
  account,
  items,
}: {
  account: NavItem;
  items: readonly NavItem[];
}) {
  const pathname = usePathname();

  function cell(item: NavItem, label?: string) {
    const current = isCurrent(item, pathname);

    // The account cell carries a full rem either side of the name; a menu cell
    // keeps the 2 px it has always had. The track is content-sized, so the name
    // and its padding are what set the cell's width.
    const sides = label === undefined ? "px-0.5" : "px-4";

    return (
      <Link
        aria-current={current ? "page" : undefined}
        aria-label={label}
        className={`${TOUCH_TARGET_CLASS} ${sides} flex min-w-0 flex-col items-center justify-center gap-1 py-2 lg:flex-row lg:justify-start lg:gap-3 lg:px-4 lg:py-4 ${
          current ? `${ACCENT_BG_CLASS} text-white` : "bg-white text-black"
        }`}
        href={item.href}
        key={item.href}
      >
        {iconFor(item.href)}
        <span className={NAV_LABEL_CLASS}>{item.label}</span>
      </Link>
    );
  }

  return (
    <nav
      aria-label="Navegação principal"
      className={`${BORDER_CLASS} ${NAV_SAFE_BOTTOM_CLASS} grid divide-x-2 divide-black border-b-0 border-l-0 border-r-0 bg-white lg:grid-cols-1! lg:divide-x-0 lg:divide-y-2 lg:border-t-0 lg:pb-0`}
      style={{
        gridTemplateColumns: `minmax(${TOUCH_TARGET_PX}px, auto) repeat(${items.length}, minmax(0, 1fr))`,
      }}
    >
      {cell(account, `Conta de ${account.label}`)}
      {items.map((item) => cell(item))}
    </nav>
  );
}
