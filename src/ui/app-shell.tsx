import type { ReactNode } from "react";
import type { Session } from "../auth/access";
import { Nav } from "./nav";
import { accountItemFor, navigationFor } from "./navigation";
import {
  BORDER_CLASS,
  CONTENT_BOTTOM_CLASS,
  SHELL_CLASS,
  SURFACE_BG_CLASS,
} from "./style";

/**
 * The frame every authenticated screen sits in: the page, and the menu for
 * your role pinned to the bottom of the screen (#14, #70).
 *
 * One column the width of a phone, and from `lg` a wide panel with the menu as
 * a rail down its left (#74). The spec's old line was "desktop pode ser só a
 * versão mobile centralizada"; #74 replaces it with a real wide layout from one
 * base. The rules on either side are what make the column read as a column
 * rather than as something floating.
 *
 * **One base, two widths, and only utilities between them.** Until `lg` this is
 * exactly what #70 built: no top bar, the page, and the bar fixed to the bottom
 * of the screen where a thumb is. From `lg` the inner row reverses, the bar
 * stops being fixed and becomes a 208 px rail, and the page takes the rest. No
 * screen is duplicated and no component is conditional.
 *
 * The rail is also what keeps the inverted current item readable on a desk: a
 * bar stretched across 896 px would give each cell 180 px of colour to say one
 * word.
 *
 * **There is no top bar.** It used to write the name and a large "Sair" above
 * every screen; #70 took it out and moved the identity into the first cell of
 * the bottom bar, where tapping it opens the account page. The name was costing
 * a strip of every screen to tell a boy something he knows.
 *
 * The bar is `fixed`, so it stays put while a long history scrolls under it.
 * Being fixed takes it out of the flow, which is why the column pads itself by
 * `CONTENT_BOTTOM_CLASS`: without that the last line of a page ends up beneath
 * the bar, with no scroll left to bring it out.
 *
 * `min-h-dvh` and not `min-h-screen`: on iOS Safari `100vh` is the height with
 * the address bar collapsed, so a bottom bar pinned to it sits under the bar
 * until you scroll. The admins are on iPhones.
 *
 * A server component. It takes the session as a prop rather than reading it, so
 * the layout is what fetches and this stays a rendering concern.
 */
export function AppShell({
  children,
  session,
}: {
  children: ReactNode;
  session: Session;
}) {
  return (
    <div
      className={`${SHELL_CLASS} ${BORDER_CLASS} ${SURFACE_BG_CLASS} ${CONTENT_BOTTOM_CLASS} flex min-h-dvh flex-col border-b-0 border-t-0 text-black lg:pb-0`}
    >
      <div className="flex flex-1 flex-col lg:flex-row-reverse lg:items-stretch">
        <main className="flex flex-1 flex-col gap-4 p-3 lg:gap-6 lg:p-6">
          {children}
        </main>

        {/*
          `inset-x-0` with the column's own `mx-auto` keeps the bar over the
          column on a wide screen instead of stretching it across the desktop,
          and the same side rules the column draws keep it exactly as wide as
          the column's contents. Without them the bar was 2 px wider on each
          side — measured at 320, cells of 68 px where `nav.test.tsx` computes
          67 — and the black rules down the column stopped 50 px short of the
          bottom.

          From `lg` none of that applies: the bar leaves the bottom edge, stops
          being fixed, and becomes the rail. `lg:w-52` is what it is wide, and
          the column above no longer has to reserve room underneath it, which is
          the `lg:pb-0` on the frame.
        */}
        <div
          className={`${SHELL_CLASS} ${BORDER_CLASS} fixed inset-x-0 bottom-0 border-b-0 border-t-0 lg:static lg:mx-0 lg:w-52 lg:max-w-none lg:shrink-0 lg:border-b-2 lg:border-l-0 lg:border-r-2`}
        >
          <Nav
            account={accountItemFor(session.displayName)}
            items={navigationFor(session.role)}
          />
        </div>
      </div>
    </div>
  );
}
