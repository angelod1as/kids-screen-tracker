import { requireSession } from "../../../../auth/guard";
import { HEADING_CLASS } from "../../../../ui/style";
import { fetchCalculatorDataAction } from "../../../actions/calculator";
import { Calculator } from "./calculator";

/** The server fetches, the browser calculates (see `calculator.tsx`). An empty history is a real input. */
export default async function KidCalculatorPage() {
  const session = await requireSession();
  const data = await fetchCalculatorDataAction(session.userId);

  return (
    <section className="flex flex-col gap-4">
      <h1 className={HEADING_CLASS}>Calculadora</h1>
      <p className="text-lg">
        Escolha uma atividade e veja quanto ela renderia agora, com a conta
        aberta.
      </p>

      <Calculator data={data} />
    </section>
  );
}
