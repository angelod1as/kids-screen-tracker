import type { ReactNode } from "react";

import { BORDER_CLASS, PENDING_BG_CLASS } from "./style";

/**
 * The marker a pendency wears, and the only place `PENDING_BG_CLASS` is
 * written.
 *
 * One component for the two ends of the same fact: the count of what an adult
 * still has to decide (#20) and the boy's own entries waiting for that decision
 * (#18). Drawing it twice would be two chances to draw it differently, and the
 * whole argument for spending one of CLAUDE.md's three colours on it is that a
 * pendency looks the same wherever it appears.
 *
 * Black on yellow, with the same black rule every box in this app has, set as
 * a small stamp in caps (#74) rather than as a line of text. It is a tag on a
 * row, not a sentence, and at 12 px on that yellow it measures 15.83:1
 * — the loudest thing on any screen it appears on. Nothing here moves.
 */
export function PendingMark({ children }: { children: ReactNode }) {
  return (
    <span
      className={`${PENDING_BG_CLASS} ${BORDER_CLASS} inline-block rounded px-2 py-1 text-xs font-bold uppercase tracking-[0.08em] text-black`}
    >
      {children}
    </span>
  );
}
