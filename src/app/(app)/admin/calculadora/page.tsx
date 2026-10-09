import { HEADING_CLASS } from "../../../../ui/style";
import type { CalculatorData } from "../../../actions/calculator";
import { fetchCalculatorDataAction } from "../../../actions/calculator";
import { listKidsAction } from "../../../actions/people";
import { AdminCalculator } from "./admin-calculator";

/** The admin's estimate has to match the boy's screen, so each day is the boy's real one (#17). */
export default async function AdminCalculatorPage() {
  const kids = await listKidsAction();
  const data = await Promise.all(
    kids.map((kid) => fetchCalculatorDataAction(kid.id)),
  );

  const dataByUserId: Record<number, CalculatorData> = {};
  for (const entry of data) {
    dataByUserId[entry.userId] = entry;
  }

  return (
    <section className="flex flex-col gap-4 lg:max-w-2xl">
      <h1 className={HEADING_CLASS}>Calculadora</h1>
      <p className="text-lg">
        Escolha o menino e uma atividade e veja quanto ela renderia agora, com a
        conta aberta, no dia real dele.
      </p>

      <AdminCalculator dataByUserId={dataByUserId} kids={kids} />
    </section>
  );
}
