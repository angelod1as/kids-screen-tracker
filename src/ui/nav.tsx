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
 * Takes items, not a role, so it never imports the guard. No `ENV` here: a
 * `"use client"` file that reads it builds, then kills the server on the first
 * request (see `src/db/index.ts`). Tracks follow their labels: equal cells split
 * "Calculadora" on every phone while "Usar" sat half empty.
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

    return (
      <Link
        aria-current={current ? "page" : undefined}
        aria-label={label}
        className={`${TOUCH_TARGET_CLASS} flex min-w-0 flex-col items-center justify-center gap-1 px-0.5 py-2 lg:flex-row lg:justify-start lg:gap-3 lg:px-4 lg:py-4 ${
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
        gridTemplateColumns: `repeat(${items.length + 1}, minmax(${TOUCH_TARGET_PX}px, auto))`,
      }}
    >
      {cell(account, `Conta de ${account.label}`)}
      {items.map((item) => cell(item))}
    </nav>
  );
}
