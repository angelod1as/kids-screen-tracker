import Link from "next/link";
import type { ReactNode } from "react";

import {
  ACCENT_BG_CLASS,
  BORDER_CLASS,
  CONTROL_RADIUS_CLASS,
  DISABLED_SURFACE_CLASS,
  TOUCH_TARGET_CLASS,
} from "./style";

/**
 * A link styled as `Button`: #15's big button navigates, and a `<button>` inside a
 * `<Link>` is a button to a screen reader and a link to the browser. No
 * `className`, so no call site overrides the 48 px minimum.
 */
export function LinkButton({
  children,
  href,
  scroll,
  variant = "primary",
}: {
  children: ReactNode;
  href: string;
  /** False keeps the reader where they were, as "Ver mais" (#64) needs. */
  scroll?: boolean;
  variant?: "primary" | "secondary";
}) {
  const colors =
    variant === "primary"
      ? `${ACCENT_BG_CLASS} text-white`
      : "bg-white text-black";

  return (
    <Link
      className={`${TOUCH_TARGET_CLASS} ${BORDER_CLASS} ${CONTROL_RADIUS_CLASS} ${colors} flex w-full items-center justify-center gap-3 px-3 py-5 text-center text-lg font-bold uppercase tracking-[0.08em]`}
      href={href}
      scroll={scroll}
    >
      {children}
    </Link>
  );
}

/**
 * A link that is a block of content (#73), so a screen never writes a bare
 * `<Link>`. `flush` drops the frame for a cell inside a panel (#74), never the 48 px.
 * `disabled` recedes the row to the #86 look; its dashed edge needs the frame back.
 */
export function CardLink({
  children,
  disabled = false,
  flush = false,
  href,
}: {
  children: ReactNode;
  disabled?: boolean;
  flush?: boolean;
  href: string;
}) {
  const frame =
    flush && !disabled ? "" : `${BORDER_CLASS} ${CONTROL_RADIUS_CLASS}`;
  const surface = disabled ? DISABLED_SURFACE_CLASS : "bg-white text-black";

  return (
    <Link
      className={`${TOUCH_TARGET_CLASS} ${frame} ${surface} flex h-full w-full flex-col gap-1 p-3`}
      href={href}
    >
      {children}
    </Link>
  );
}
