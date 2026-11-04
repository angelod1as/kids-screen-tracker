import type { ComponentProps } from "react";

import {
  ACCENT_BG_CLASS,
  BORDER_CLASS,
  CONTROL_RADIUS_CLASS,
  DESTRUCTIVE_BG_CLASS,
  DISABLED_CONTROL_CLASS,
  TOUCH_TARGET_CLASS,
} from "./style";

/**
 * No `className`, so no caller overrides the 48 px minimum; a new need is a new
 * variant here. Disabled has a look of its own, over every variant (D42, #86).
 */
type ButtonProps = Omit<ComponentProps<"button">, "className"> & {
  variant?: "primary" | "secondary" | "destructive" | "quiet";
};

export function Button({ variant = "primary", ...props }: ButtonProps) {
  // A rare action under every row (#118): text weight, not a box, the 48 px kept.
  if (variant === "quiet") {
    return (
      <button
        {...props}
        className={`${TOUCH_TARGET_CLASS} border-2 border-transparent ${DISABLED_CONTROL_CLASS} disabled:border-black self-start text-left text-base text-black underline`}
      />
    );
  }

  const colors =
    variant === "primary"
      ? `${ACCENT_BG_CLASS} text-white`
      : variant === "destructive"
        ? `${DESTRUCTIVE_BG_CLASS} text-white`
        : "bg-white text-black";

  return (
    <button
      {...props}
      className={`${TOUCH_TARGET_CLASS} ${BORDER_CLASS} ${CONTROL_RADIUS_CLASS} ${colors} ${DISABLED_CONTROL_CLASS} w-full px-3 py-3 text-center text-base font-bold uppercase tracking-[0.08em]`}
    />
  );
}
