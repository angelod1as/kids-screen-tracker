import type { ReactNode } from "react";

import { HEADING_CLASS, PANEL_CLASS, PANEL_HEAD_CLASS } from "./style";

/**
 * A named region (#74): a component, not class constants, so the band and the
 * frame cannot come apart. `top` is the one `h1` per screen, for screen readers.
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

export function PanelText({ children }: { children: ReactNode }) {
  return <p className="px-3 py-4 text-base text-black">{children}</p>;
}
