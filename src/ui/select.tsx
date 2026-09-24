"use client";

import type { ReactNode } from "react";

import {
  BORDER_CLASS,
  CONTROL_RADIUS_CLASS,
  TOUCH_TARGET_CLASS,
} from "./style";

/**
 * Native, for thirty-one activities (#17): Android opens its own full-screen list
 * in one tap. A real `<label>`, not a disabled first option, which is grey by
 * default. `onChange` hands over the raw string, as the DOM has it.
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
