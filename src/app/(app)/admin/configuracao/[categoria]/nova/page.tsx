import { notFound } from "next/navigation";

import { LinkButton } from "../../../../../../ui/link-button";
import { fetchCategoriesAction } from "../../../../../actions/config";
import { NewActivityForm } from "../../activity-list";

/** A switched-off category takes no new activity: the endpoint would refuse it (D33). */
export default async function NewActivityPage({
  params,
}: {
  params: Promise<{ categoria: string }>;
}) {
  const [{ categoria }, categories] = await Promise.all([
    params,
    fetchCategoriesAction(),
  ]);
  const category = categories.find((one) => String(one.id) === categoria);

  if (category === undefined || !category.active) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4 lg:max-w-2xl lg:gap-6">
      <LinkButton
        href={`/admin/configuracao/${category.id}`}
        variant="secondary"
      >
        Voltar: {category.name}
      </LinkButton>

      <NewActivityForm
        categories={categories.filter((one) => one.active)}
        category={category}
      />
    </div>
  );
}
