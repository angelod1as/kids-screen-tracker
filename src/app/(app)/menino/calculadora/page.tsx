import { requireSession } from "../../../../auth/guard";
import { HEADING_CLASS } from "../../../../ui/style";
import { fetchCalculatorDataAction } from "../../../actions/calculator";
import { Calculator } from "./calculator";

/**
 * The calculator (#17), and the one screen of this phase that is complete.
 *
 * The engine is a pure function of what it is handed, so nothing here waits on
 * a row that Phase 4 or Phase 5 has to write first: on a freshly seeded
 * database this screen already answers, correctly, what an hour of reading is
 * worth today. The empty history is not a missing input — it is the input, and
 * it says the bucket is empty and no cooldown applies, which is the truth about
 * a boy who has not logged anything yet.
 *
 * The server fetches; the browser calculates. See `calculator.tsx` for why, and
 * `fetchCalculatorDataAction` for what it hands over.
 */
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
