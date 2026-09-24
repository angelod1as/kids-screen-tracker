import Link from "next/link";
import type { ReactNode } from "react";

import {
  ACCENT_BG_CLASS,
  BORDER_CLASS,
  CONTROL_RADIUS_CLASS,
  TOUCH_TARGET_CLASS,
} from "./style";

/**
 * A link that reads and behaves as the big black button of `Button`.
 *
 * It exists because `Button` is a `<button>` and #15's "botão grande para
 * iniciar cronômetro" navigates — it does not submit anything. Wrapping a
 * `<button>` in a `<Link>` gives a control that is a button to a screen reader
 * and a link to the browser, and wrapping the navigation in a form would post
 * to start a screen that has nothing to start yet.
 *
 * As with `Button`, `className` is not a prop: the 48 px minimum of #14 is not
 * something a call site gets to override. Nothing here moves and nothing fades;
 * there is no hover state.
 *
 * Set in caps like `Button`, and one step larger: these are the controls a
 * screen is built around — "Começar atividade" on the boy's home, the three
 * actions on the admin's — and the size is the difference between the control
 * you came for and the ones that were there anyway.
 *
 * `variant` is the same knob `Button` has and means the same thing — white on
 * the accent, or black on white with the same rule. The admin's home screen (#21)
 * needs both: the three actions of the day are the loudest things on it, and
 * the two links that are not actions must not compete with them. Without the
 * variant a screen would reach for a bare `<Link>` and lose the 48 px with it,
 * which `design.test.ts` refuses outright — the rule is that a screen cannot
 * write an interactive element of its own.
 */
export function LinkButton({
  children,
  href,
  variant = "primary",
}: {
  children: ReactNode;
  href: string;
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
    >
      {children}
    </Link>
  );
}

/**
 * A card that is a link: a block of its own content, with the 48 px minimum
 * and the same black rule (#73).
 *
 * `LinkButton` centres one line of big bold text, which is right for an action
 * and wrong for the admin's balances — those are a name above a number, read
 * against each other in a two-column grid. The alternative was a bare `<Link>`
 * on the screen itself, and `design.test.ts` refuses that outright: a screen
 * that writes its own interactive element is a screen that can forget the
 * minimum, and this one is a card a thumb has to hit on a phone.
 *
 * Content and nothing else, so the call site decides what a card says. What it
 * does not decide is the target, the rule or the palette.
 *
 * `flush` drops the card's own frame and radius, for a card that is a *cell of
 * a panel* rather than a card on the page (#74). The admin's two balances are
 * the case: they are read against each other, so they belong inside one panel
 * divided down the middle, and a bordered card inside a bordered panel is two
 * frames saying one thing. The 48 px minimum is not part of what `flush` drops
 * — it never is.
 */
export function CardLink({
  children,
  flush = false,
  href,
}: {
  children: ReactNode;
  flush?: boolean;
  href: string;
}) {
  const frame = flush ? "" : `${BORDER_CLASS} ${CONTROL_RADIUS_CLASS}`;

  return (
    <Link
      className={`${TOUCH_TARGET_CLASS} ${frame} flex h-full w-full flex-col gap-1 bg-white p-3 text-black`}
      href={href}
    >
      {children}
    </Link>
  );
}
