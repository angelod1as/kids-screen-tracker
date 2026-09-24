import { HEADING_CLASS } from "../../../../ui/style";
import {
  fetchCategoriesAction,
  fetchLocksAction,
} from "../../../actions/config";
import { CategoryList } from "./category-list";

/**
 * Configuration (#26, #27).
 *
 * "Requisito central, não secundário: a tabela vai mudar muito nos primeiros
 * meses e não pode exigir deploy." So this is a screen meant to be used often,
 * by an adult who is calibrating rather than administering — which is why the
 * asymptote is on it, live, and why the two values the engine cannot take are
 * explained here before they are refused by the endpoint.
 *
 * Nothing on this screen recalculates anything already credited (D15), and
 * nothing on it deletes anything (D14).
 */
export default async function AdminConfigurationPage() {
  // Both in one round trip: the list, and what is under way right now (D37).
  // The second is what lets the screen say *why* a field will not move before
  // the adult taps, instead of after.
  const [categories, locks] = await Promise.all([
    fetchCategoriesAction(),
    fetchLocksAction(),
  ]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className={HEADING_CLASS}>Configuração</h1>

      <p className="text-base text-black">
        Mudar a tabela vale daqui pra frente. Nada que já foi creditado muda, e
        desativar não apaga nada do histórico.
      </p>

      <CategoryList initial={categories} initialLocks={locks} />
    </section>
  );
}
