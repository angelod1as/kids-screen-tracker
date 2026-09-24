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
 * One row of mutually exclusive options, each one tap wide.
 *
 * The calculator's duration and grade are both "pick one of a handful" (#17),
 * and a handful of buttons beats a second select: the whole set is on screen,
 * so changing 1h to 1h30 and watching the explanation change is one tap and no
 * dialog. That is the screen's entire purpose — trying combinations has to be
 * free — and it is what keeps the common operation at two taps.
 *
 * The chosen option is inverted, white on the accent, exactly as the current
 * page in the bottom bar is. It is the strongest signal the palette has, and
 * the alternative — a pale wash of the same button — is the grey on grey the
 * design rules forbid, whatever hue it wore.
 *
 * `aria-pressed` rather than a radio group: these are buttons that change what
 * the page shows, not a value being submitted anywhere. Nothing on this screen
 * is submitted (#17: "não grava nada no banco").
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
      {/*
        A three-column grid and not `flex-wrap` with `grow`. Wrapping left the
        last row short and its buttons stretched to fill it: with seven
        durations the `3h` button measured 284 px against 89,3 px for the other
        six. On a screen with no colour, size is the only hierarchy there is,
        and it was pointing at whichever option happened to land alone on the
        last row. Three columns give every option the same width whatever the
        count.
      */}
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
