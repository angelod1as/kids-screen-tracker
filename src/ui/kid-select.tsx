"use client";

import type { Kid } from "../app/actions/people";
import { ChoiceGroup } from "./choice";

/**
 * Two buttons, not a `<select>`: a native picker put three taps before every
 * admin operation on the second boy, against the two-tap rule.
 */
export function KidSelect({
  kids,
  onChange,
  value,
}: {
  kids: readonly Kid[];
  onChange: (userId: number) => void;
  value: number;
}) {
  return (
    <ChoiceGroup
      legend="Menino"
      onSelect={onChange}
      options={kids.map((kid) => ({ value: kid.id, label: kid.displayName }))}
      value={value}
    />
  );
}
