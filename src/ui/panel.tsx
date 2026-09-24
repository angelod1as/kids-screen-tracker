import type { ReactNode } from "react";

import { HEADING_CLASS, PANEL_CLASS, PANEL_HEAD_CLASS } from "./style";

/**
 * A named region of the instrument face (#74).
 *
 * Every block of content on every screen is one of these: a heavy rule around
 * it, a solid blue band across the top carrying its name, and whatever it
 * holds below. It exists as a component and not as a pair of class constants
 * because the band and the frame have to stay welded together — a screen that
 * drew the frame and forgot the band would be back to a floating card, which is
 * the one thing this direction is defined against.
 *
 * `note` is the right-hand side of the band: a count, a date, a unit. It is the
 * place a panel says *which* reading this is, and it is optional because most
 * panels have nothing to say there.
 *
 * `top` picks the heading level, and there is exactly one per screen. A panel is
 * a labelled region rather than a section of prose, so the level carries no
 * visual weight at all — every band is set the same — but a screen reader walks
 * headings, and a page whose only heading is an `h2` is a page with no title.
 */
export function Panel({
  children,
  note,
  title,
  top = false,
}: {
  children: ReactNode;
  note?: ReactNode;
  title: string;
  top?: boolean;
}) {
  const Heading = top ? "h1" : "h2";

  return (
    <section className={PANEL_CLASS}>
      <div className={PANEL_HEAD_CLASS}>
        <Heading className={HEADING_CLASS}>{title}</Heading>
        {note === undefined ? null : (
          <span className={HEADING_CLASS}>{note}</span>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * A sentence inside a panel, with the panel's own padding.
 *
 * The empty states, the failure messages and the explanations all used to carry
 * a rule of their own, which is what made a screen of them read as a pile of
 * boxes. Inside a panel the rule is already drawn, so this is padding and type
 * and nothing else.
 */
export function PanelText({ children }: { children: ReactNode }) {
  return <p className="px-3 py-4 text-base text-black">{children}</p>;
}
