"use client";

import type { ReactNode } from "react";

import {
  BORDER_CLASS,
  CONTROL_RADIUS_CLASS,
  TOUCH_TARGET_CLASS,
} from "./style";

/**
 * A labelled `<select>`, at the same 48 px minimum as every other target.
 *
 * The calculator has thirty-one activities to choose from (#17), and a native
 * select is the one control that turns that into a single tap on Android: the
 * system opens a full-screen list of its own, sized by the OS, in the OS's own
 * typeface. A custom list of thirty-one buttons is a scroll and a hunt, and
 * "mais de dois toques" is the design rule it would break.
 *
 * As with `Button` and `Field`, `className` is not a prop, and the label is a
 * real `<label htmlFor>` rather than a first option reading "Escolha uma
 * atividade" — a disabled first option is grey by construction in every
 * browser's default sheet.
 *
 * `onChange` hands over the raw string: an option's value is a string in the
 * DOM whatever was written in JSX, and a component that pretends otherwise
 * moves the parse somewhere it is easier to get wrong.
 */
export function Select({
  children,
  id,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-xs font-bold uppercase tracking-[0.08em] text-black"
        htmlFor={id}
      >
        {label}
      </label>
      <select
        className={`${TOUCH_TARGET_CLASS} ${BORDER_CLASS} ${CONTROL_RADIUS_CLASS} w-full bg-white px-3 py-2 text-base text-black`}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </div>
  );
}
