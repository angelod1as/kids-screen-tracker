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
 * One base for both widths (#74; docs/design.md, Desktop). The bar is `fixed`, so
 * the column pads itself by `CONTENT_BOTTOM_CLASS`. `min-h-dvh`, not
 * `min-h-screen`: iOS Safari's `100vh` hides a bottom bar under its address bar.
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

        {/* The column's side rules on the bar keep it exactly as wide as the column's contents. */}
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
