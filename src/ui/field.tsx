import type { ComponentProps } from "react";

import {
  BORDER_CLASS,
  CONTROL_RADIUS_CLASS,
  TOUCH_TARGET_CLASS,
} from "./style";

/**
 * No `placeholder` prop: it vanishes on typing and is painted at half opacity,
 * so the type closes the door rather than a docstring. No `className` either.
 */
type FieldProps = Omit<
  ComponentProps<"input">,
  "className" | "id" | "placeholder"
> & {
  id: string;
  label: string;
};

export function Field({ id, label, ...props }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-xs font-bold uppercase tracking-[0.08em] text-black"
        htmlFor={id}
      >
        {label}
      </label>
      <input
        {...props}
        id={id}
        className={`${TOUCH_TARGET_CLASS} ${BORDER_CLASS} ${CONTROL_RADIUS_CLASS} w-full bg-white px-3 py-2 text-base text-black`}
      />
    </div>
  );
}
