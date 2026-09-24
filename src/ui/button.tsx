import type { ComponentProps } from "react";

import {
  ACCENT_BG_CLASS,
  BORDER_CLASS,
  CONTROL_RADIUS_CLASS,
  TOUCH_TARGET_CLASS,
} from "./style";

/**
 * The only button in the app.
 *
 * `className` is not in the prop type on purpose. The 48 px minimum of #14 is
 * not a default a caller gets to override, and a component that accepts a
 * class list is a component whose guarantees end at the call site. A screen
 * that needs a different button gets a new variant here, next to the rule it
 * has to keep.
 *
 * `variant` is the only knob: `primary` is white on the accent, `secondary` is
 * black on white with a black rule. Disabled inverts rather than fading — a
 * greyed-out control is exactly the grey-on-grey the design rules forbid, and
 * it is the state a boy is most likely to be squinting at. Inverting also keeps
 * the disabled state readable now that the enabled one is coloured: the colour
 * draining away *is* the signal, and nothing has to go pale to say it.
 *
 * The label is set in caps with wide letter-spacing (#74): a control on an
 * instrument is engraved, and caps are also what keeps a one-word button from
 * looking like a sentence that happens to be inside a rectangle. The corner is
 * `CONTROL_RADIUS_CLASS`, the smaller of the two radii (D42).
 *
 * Nothing here moves: no timing utility, no fade, no hover state.
 */
type ButtonProps = Omit<ComponentProps<"button">, "className"> & {
  variant?: "primary" | "secondary";
};

export function Button({ variant = "primary", ...props }: ButtonProps) {
  const colors =
    variant === "primary"
      ? `${ACCENT_BG_CLASS} text-white disabled:bg-white disabled:text-black`
      : "bg-white text-black";

  return (
    <button
      {...props}
      className={`${TOUCH_TARGET_CLASS} ${BORDER_CLASS} ${CONTROL_RADIUS_CLASS} ${colors} w-full px-3 py-3 text-center text-base font-bold uppercase tracking-[0.08em]`}
    />
  );
}
