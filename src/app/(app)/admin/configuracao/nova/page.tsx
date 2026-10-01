import { LinkButton } from "../../../../../ui/link-button";
import { NewCategoryForm } from "../category-list";

export default function NewCategoryPage() {
  return (
    <div className="flex flex-col gap-4 lg:max-w-2xl lg:gap-6">
      <LinkButton href="/admin/configuracao" variant="secondary">
        Voltar: Configuração
      </LinkButton>

      <NewCategoryForm />
    </div>
  );
}
