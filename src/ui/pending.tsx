import type { ReactNode } from "react";

import { BORDER_CLASS, PENDING_BG_CLASS } from "./style";

/** The only place `PENDING_BG_CLASS` is written, so a pendency looks the same on both ends (#18, #20). */
export function PendingMark({ children }: { children: ReactNode }) {
  return (
    <span
      className={`${PENDING_BG_CLASS} ${BORDER_CLASS} inline-block rounded px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] text-black`}
    >
      {children}
    </span>
  );
}
