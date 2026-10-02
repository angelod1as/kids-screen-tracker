import type { ComponentProps } from "react";

import type { TypedTime } from "./hours";
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

/**
 * Hours and minutes, never a fraction (#48). Side by side, so the minutes are
 * one tap from the hours; numeric keypads both, because neither takes a comma.
 */
export function TimeFields({
  id,
  legend,
  onChange,
  value,
}: {
  id: string;
  legend: string;
  onChange: (value: TypedTime) => void;
  value: TypedTime;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-bold uppercase tracking-[0.08em] text-black">
        {legend}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        <Field
          id={`${id}-horas`}
          inputMode="numeric"
          label="Horas"
          onChange={(event) =>
            onChange({ ...value, hours: event.target.value })
          }
          type="text"
          value={value.hours}
        />
        <Field
          id={`${id}-minutos`}
          inputMode="numeric"
          label="Minutos"
          onChange={(event) =>
            onChange({ ...value, minutes: event.target.value })
          }
          type="text"
          value={value.minutes}
        />
      </div>
    </fieldset>
  );
}

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
