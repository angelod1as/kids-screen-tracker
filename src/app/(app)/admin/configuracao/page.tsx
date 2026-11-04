import { HEADING_CLASS } from "../../../../ui/style";
import {
  fetchCategoriesAction,
  fetchLocksAction,
} from "../../../actions/config";
import { CategoryList } from "./category-list";

export default async function AdminConfigurationPage() {
  // Locks come with the list so the screen can say why a field will not move before the tap (D37).
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
