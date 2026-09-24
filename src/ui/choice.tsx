"use client";

import {
  ACCENT_BG_CLASS,
  BORDER_CLASS,
  CONTROL_RADIUS_CLASS,
  TOUCH_TARGET_CLASS,
} from "./style";

export type Choice = {
  value: number;
  label: string;
};

/**
 * Buttons, not a select: trying combinations on the calculator must be one tap
 * (#17). `aria-pressed`, not radios: nothing here is submitted.
 */
export function ChoiceGroup({
  legend,
  onSelect,
  options,
  value,
}: {
  legend: string;
  onSelect: (value: number) => void;
  options: readonly Choice[];
  value: number;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-bold uppercase tracking-[0.08em] text-black">
        {legend}
      </legend>
      {/* A grid, not `flex-wrap` with `grow`, which stretched a lone last option to full width. */}
      <div className="grid grid-cols-3 gap-2">
        {options.map((option) => {
          const chosen = option.value === value;

          return (
            <button
              aria-pressed={chosen}
              className={`${TOUCH_TARGET_CLASS} ${BORDER_CLASS} ${CONTROL_RADIUS_CLASS} px-3 py-2 text-center text-base font-bold ${
                chosen ? `${ACCENT_BG_CLASS} text-white` : "bg-white text-black"
              }`}
              key={option.value}
              onClick={() => onSelect(option.value)}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
