import { notFound } from "next/navigation";

import { LinkButton } from "../../../../../../ui/link-button";
import {
  fetchActivitiesAction,
  fetchCategoriesAction,
  fetchLocksAction,
} from "../../../../../actions/config";
import { ActivityEditor } from "../../activity-list";

/** An activity under another category's URL is a 404, not a page (D33). */
export default async function ActivityPage({
  params,
}: {
  params: Promise<{ categoria: string; atividade: string }>;
}) {
  const [{ categoria, atividade }, categories, locks] = await Promise.all([
    params,
    fetchCategoriesAction(),
    fetchLocksAction(),
  ]);
  const category = categories.find((one) => String(one.id) === categoria);

  if (category === undefined) {
    notFound();
  }

  const activity = (await fetchActivitiesAction(category.id)).find(
    (one) => String(one.id) === atividade,
  );

  if (activity === undefined) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <LinkButton
        href={`/admin/configuracao/${category.id}`}
        variant="secondary"
      >
        Voltar: {category.name}
      </LinkButton>

      <ActivityEditor
        activity={activity}
        categories={categories.filter((one) => one.active)}
        category={category}
        key={activity.id}
        locks={locks}
      />
    </div>
  );
}
