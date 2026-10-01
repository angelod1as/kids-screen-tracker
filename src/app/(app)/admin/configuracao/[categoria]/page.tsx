import { notFound } from "next/navigation";

import { LinkButton } from "../../../../../ui/link-button";
import {
  fetchActivitiesAction,
  fetchCategoriesAction,
  fetchLocksAction,
} from "../../../../actions/config";
import { CategoryDetail } from "../category-list";

/** The URL id is not a permission (D33): every action checks the admin again. */
export default async function CategoryPage({
  params,
}: {
  params: Promise<{ categoria: string }>;
}) {
  const [{ categoria }, categories, locks] = await Promise.all([
    params,
    fetchCategoriesAction(),
    fetchLocksAction(),
  ]);
  const category = categories.find((one) => String(one.id) === categoria);

  if (category === undefined) {
    notFound();
  }

  const activities = await fetchActivitiesAction(category.id);

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <LinkButton href="/admin/configuracao" variant="secondary">
        Voltar: Configuração
      </LinkButton>

      <CategoryDetail
        activities={activities}
        initial={category}
        initialLocks={locks}
        key={category.id}
      />
    </div>
  );
}
