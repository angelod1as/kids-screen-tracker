"use client";

import { useState } from "react";
import { KidSelect } from "../../../../ui/kid-select";
import { BORDER_CLASS } from "../../../../ui/style";
import type { CalculatorData } from "../../../actions/calculator";
import type { Kid } from "../../../actions/people";
import { Calculator } from "../../menino/calculadora/calculator";

/**
 * The same kid calculator, behind a kid picker: each boy's day is prefetched on
 * the server (#17), so switching boys runs the engine in the browser with no
 * round trip.
 */
export function AdminCalculator({
  kids,
  dataByUserId,
}: {
  kids: Kid[];
  dataByUserId: Record<number, CalculatorData>;
}) {
  const [userId, setUserId] = useState(kids[0]?.id ?? 0);
  const data = dataByUserId[userId];

  if (data === undefined) {
    return (
      <p className={`${BORDER_CLASS} bg-white p-4 text-lg text-black`}>
        Nenhum menino cadastrado.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <KidSelect kids={kids} onChange={setUserId} value={userId} />
      <Calculator data={data} />
    </div>
  );
}
