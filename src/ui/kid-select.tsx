"use client";

import type { Kid } from "../app/actions/people";
import { ChoiceGroup } from "./choice";

/**
 * Which boy an admin's screen is about (#22, #23, #24, #25).
 *
 * **Two buttons, not a `<select>`.** There are two boys, and every screen in
 * this phase begins by naming one — so on the boy who is not the first in the
 * list, a native picker put three taps in front of every operation: open the
 * sheet, spin the wheel, confirm. Liberar became five taps and *Desligar*
 * became five, against a design rule that says two. `Select`'s own argument is
 * about the calculator's thirty-one activities, where a full-screen OS list is
 * the one control that keeps the choice to a single tap; at two options it is
 * the opposite trade, and `ChoiceGroup` is the control this app already uses
 * for "pick one of a handful".
 *
 * Both names are on screen without opening anything, which is also what an
 * adult reads to check he is about to write for the right boy.
 *
 * The type comes from `listKidsAction`, which is admin-only: the pair of ids is
 * not something this app hands to a boy.
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
