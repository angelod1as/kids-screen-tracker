// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// D57: the page is read with the bonus ON; the shipped default is off.
vi.mock("../../engine/flags", () => ({ BONUS_ENABLED: true }));

import type { ActivityRow } from "../../db/activities";
import type { CategoryRow } from "../../db/categories";

/** #41: three levels, each with a way back, and the activity's form open on arrival. */

const NOT_FOUND = new Error("not found");

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  notFound: () => {
    throw NOT_FOUND;
  },
}));

const config = vi.hoisted(() => ({
  fetchCategoriesAction: vi.fn(),
  createCategoryAction: vi.fn(),
  updateCategoryAction: vi.fn(),
  setCategoryActiveAction: vi.fn(),
  fetchActivitiesAction: vi.fn(),
  fetchLocksAction: vi.fn(),
  createActivityAction: vi.fn(),
  updateActivityAction: vi.fn(),
  setActivityActiveAction: vi.fn(),
}));

vi.mock("../actions/config", () => config);

const CategoryPage = (await import("./admin/configuracao/[categoria]/page"))
  .default;
const ActivityPage = (
  await import("./admin/configuracao/[categoria]/[atividade]/page")
).default;
const NewCategoryPage = (await import("./admin/configuracao/nova/page"))
  .default;
const NewActivityPage = (
  await import("./admin/configuracao/[categoria]/nova/page")
).default;
const { CategoryDetail, NewCategoryForm } = await import(
  "./admin/configuracao/category-list"
);
const { ActivityEditor } = await import("./admin/configuracao/activity-list");

const MENTE: CategoryRow = {
  id: 2,
  name: "Mente",
  baseRate: 2,
  decayStepHours: 1,
  alternationBonusPct: 0.5,
  sortOrder: 2,
  active: true,
  activityCount: 1,
};

const CASA: CategoryRow = {
  id: 6,
  name: "Casa",
  baseRate: null,
  decayStepHours: null,
  alternationBonusPct: 0,
  sortOrder: 6,
  active: false,
  activityCount: 0,
};

const BOOK: ActivityRow = {
  id: 5,
  categoryId: 2,
  name: "Ler livro",
  description: null,
  calcMode: "duration",
  value: 2,
  maxSessionMinutes: 120,
  minSessionMinutes: 5,
  presumedMinutes: null,
  qualityGraded: false,
  repeatCooldownDays: 0,
  sortOrder: 1,
  active: true,
};

const LOCKS = { activityIds: [], categoryIds: [], queued: 0, running: 0 };

function params<T>(value: T) {
  return { params: Promise.resolve(value) };
}

beforeEach(() => {
  config.fetchCategoriesAction.mockResolvedValue([MENTE, CASA]);
  config.fetchLocksAction.mockResolvedValue(LOCKS);
  config.fetchActivitiesAction.mockImplementation(async (id: number) =>
    id === MENTE.id ? [BOOK] : [],
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("each level has a way back (#41)", () => {
  it("leads from a category back to the list", async () => {
    const markup = renderToStaticMarkup(
      await CategoryPage(params({ categoria: "2" })),
    );

    expect(markup).toContain('href="/admin/configuracao"');
    expect(markup).toContain("Voltar: Configuração");
  });

  it("leads from an activity back to its category", async () => {
    const markup = renderToStaticMarkup(
      await ActivityPage(params({ categoria: "2", atividade: "5" })),
    );

    expect(markup).toContain('href="/admin/configuracao/2"');
    expect(markup).toContain("Voltar: Mente");
  });

  it("leads from a new category back to the list", () => {
    const markup = renderToStaticMarkup(NewCategoryPage());

    expect(markup).toContain('href="/admin/configuracao"');
  });

  it("leads from a new activity back to its category", async () => {
    const markup = renderToStaticMarkup(
      await NewActivityPage(params({ categoria: "2" })),
    );

    expect(markup).toContain('href="/admin/configuracao/2"');
    expect(markup).toContain("Nova atividade em Mente");
  });
});

describe("a URL is not a permission (D33)", () => {
  it("answers 404 for a category that does not exist", async () => {
    await expect(CategoryPage(params({ categoria: "99" }))).rejects.toBe(
      NOT_FOUND,
    );
  });

  it("answers 404 for an activity under another category's URL", async () => {
    await expect(
      ActivityPage(params({ categoria: "6", atividade: "5" })),
    ).rejects.toBe(NOT_FOUND);
  });

  it("offers no new activity under a switched-off category", async () => {
    await expect(NewActivityPage(params({ categoria: "6" }))).rejects.toBe(
      NOT_FOUND,
    );
  });
});

describe("the category's page reads its numbers (#41)", () => {
  it("shows them without a form until one is asked for", () => {
    const markup = renderToStaticMarkup(
      <CategoryDetail
        activities={[BOOK]}
        initial={MENTE}
        initialLocks={LOCKS}
      />,
    );

    expect(markup).toContain("Rende no máximo 4,00 h por dia");
    expect(markup).toContain("+50% ao alternar");
    expect(markup).toContain("Editar números");
    expect(markup).not.toContain("<input");
  });

  it("explains each number, after the activities on a phone (#41)", () => {
    const markup = renderToStaticMarkup(
      <CategoryDetail activities={[]} initial={MENTE} initialLocks={LOCKS} />,
    );

    // Source order is the phone's order: numbers, activities, then the help.
    expect(markup.indexOf("Ordem na lista")).toBeLessThan(
      markup.indexOf("Atividades"),
    );
    expect(markup.indexOf("Atividades")).toBeLessThan(
      markup.indexOf("O que cada número faz"),
    );
    expect(markup).toContain("não entra na conta");
    expect(markup).toContain("O mínimo é 15 min.");
  });

  it("offers a new activity only where one can be created", () => {
    const on = renderToStaticMarkup(
      <CategoryDetail activities={[]} initial={MENTE} initialLocks={LOCKS} />,
    );
    const off = renderToStaticMarkup(
      <CategoryDetail activities={[]} initial={CASA} initialLocks={LOCKS} />,
    );

    expect(on).toContain('href="/admin/configuracao/2/nova"');
    expect(off).not.toContain("/nova");
    expect(off).toContain("Categoria desativada");
  });
});

describe("the activity's page, tapped into (#41)", () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(node: React.ReactNode) {
    await act(async () => root.render(node));
  }

  async function click(name: string) {
    const found = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === name,
    );

    if (found === undefined) throw new Error(`no button named ${name}`);

    await act(async () => found.click());
  }

  function buttons() {
    return [...container.querySelectorAll("button")].map((button) =>
      button.textContent?.trim(),
    );
  }

  it("arrives with the rate in an open field, so no Editar is needed", async () => {
    await render(
      <ActivityEditor
        activity={BOOK}
        categories={[MENTE]}
        category={MENTE}
        locks={LOCKS}
      />,
    );

    expect(
      container.querySelector<HTMLInputElement>("#atividade-5-valor")?.value,
    ).toBe("2");
    expect(buttons()).not.toContain("Editar");
  });

  it("saves what the old form saved, then goes back to the category", async () => {
    config.updateActivityAction.mockResolvedValueOnce([BOOK]);
    await render(
      <ActivityEditor
        activity={BOOK}
        categories={[MENTE]}
        category={MENTE}
        locks={LOCKS}
      />,
    );

    await click("Salvar atividade");

    expect(config.updateActivityAction).toHaveBeenCalledWith(2, 5, {
      categoryId: 2,
      name: "Ler livro",
      description: null,
      noteRequired: false,
      calcMode: "duration",
      rate: 2,
      amount: null,
      maxSession: { hours: 2, minutes: 0 },
      minSession: { hours: 0, minutes: 5 },
      presumed: null,
      qualityGraded: false,
      repeatCooldownDays: 0,
      sortOrder: 1,
    });
    expect(router.push).toHaveBeenCalledWith("/admin/configuracao/2");
  });

  it("says why a field will not move before the tap (D37)", async () => {
    await render(
      <ActivityEditor
        activity={BOOK}
        categories={[MENTE]}
        category={MENTE}
        locks={{ activityIds: [5], categoryIds: [], queued: 1, running: 0 }}
      />,
    );

    expect(container.textContent).toContain("não mudam agora");
  });

  it("opens the category's form in place, and closes it on save", async () => {
    config.updateCategoryAction.mockResolvedValueOnce([
      { ...MENTE, decayStepHours: 2 },
    ]);
    await render(
      <CategoryDetail activities={[]} initial={MENTE} initialLocks={LOCKS} />,
    );

    await click("Editar números");
    const step = container.querySelector<HTMLInputElement>(
      "#categoria-2-passo-horas",
    );
    expect(step?.value).toBe("1");

    await click("Salvar");

    expect(config.updateCategoryAction).toHaveBeenCalledWith(2, {
      name: "Mente",
      baseRate: 2,
      decayStep: { hours: 1, minutes: 0 },
      alternationBonusPct: 0.5,
      sortOrder: 2,
    });
    expect(container.querySelector("#categoria-2-passo-horas")).toBeNull();
    expect(container.textContent).toContain("Rende no máximo 8,00 h por dia");
  });

  it("creates a category and goes back to the list", async () => {
    config.createCategoryAction.mockResolvedValueOnce([MENTE]);
    await render(<NewCategoryForm />);

    const name = container.querySelector<HTMLInputElement>("#nova-nome");
    await act(async () => {
      if (name === null) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(name, "Mente");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await click("Criar categoria");

    expect(config.createCategoryAction).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/admin/configuracao");
  });
});
