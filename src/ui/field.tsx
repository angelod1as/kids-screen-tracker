import type { ComponentProps } from "react";

import {
  BORDER_CLASS,
  CONTROL_RADIUS_CLASS,
  TOUCH_TARGET_CLASS,
} from "./style";

/**
 * A labelled text input, at the same 48 px minimum as every other target.
 *
 * The label is a real `<label htmlFor>`, not a placeholder. A placeholder
 * disappears the moment someone starts typing, is grey by definition — the
 * preflight paints it at half opacity — and is the single most common way a
 * high-contrast rule gets broken by accident. So `placeholder` is not a prop
 * either: the type is what closes the door, because a docstring arguing
 * against something the type still accepts is a docstring, not a rule.
 *
 * As with `Button`, `className` is not a prop.
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
