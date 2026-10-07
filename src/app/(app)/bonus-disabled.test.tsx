import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// D57: no flag mock here — the shipped default is off, and this file proves the
// bonus is invisible across the boy screens and the admin Configuração.

import type { HowItWorksData } from "../actions/how-it-works";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
}));

vi.mock("./actions/config", () => ({
  fetchCategoriesAction: async () => [],
  createCategoryAction: async () => [],
  updateCategoryAction: async () => [],
  setCategoryActiveAction: async () => [],
  fetchActivitiesAction: async () => [],
  fetchLocksAction: async () => ({
    activityIds: [],
    categoryIds: [],
    queued: 0,
    running: 0,
  }),
}));

const { KidGuide } = await import("./conta/como-funciona/kid-guide");
const { AdultGuide } = await import("./conta/como-funciona/adult-guide");
const { NewCategoryForm, draftOf, categoryInputOf } = await import(
  "./admin/configuracao/category-list"
);

/** Two participating categories with timed activities: enough that the bonus
 * copy would appear if the switch were on. */
const DATA: HowItWorksData = {
  occurredOn: "2026-09-01",
  categories: [
    {
      id: 1,
      name: "Corpo",
      baseRate: 1.5,
      decayStepHours: 2,
      alternationBonusPct: 0.5,
    },
    {
      id: 2,
      name: "Mente",
      baseRate: 1.5,
      decayStepHours: 1,
      alternationBonusPct: 0.5,
    },
  ],
  activities: [
    {
      id: 1,
      categoryId: 1,
      name: "Futebol",
      calcMode: "duration",
      value: 1.5,
      qualityGraded: false,
      repeatCooldownDays: 0,
      maxSessionMinutes: 180,
      minSessionMinutes: 1,
    },
    {
      id: 5,
      categoryId: 2,
      name: "Ler livro",
      calcMode: "duration",
      value: 1.5,
      qualityGraded: false,
      repeatCooldownDays: 0,
      maxSessionMinutes: 120,
      minSessionMinutes: 1,
    },
  ],
};

const BONUS_WORDS = [
  "alternância",
  "variou de atividade",
  "ao alternar",
  "+50%",
];

describe("the bonus is invisible while it is off (D57)", () => {
  it("shows no bonus copy on the boy's guide", () => {
    const markup = renderToStaticMarkup(<KidGuide data={DATA} />);

    for (const word of BONUS_WORDS) {
      expect(markup).not.toContain(word);
    }
  });

  it("shows no bonus copy on the adult's guide", () => {
    const markup = renderToStaticMarkup(<AdultGuide data={DATA} />);

    for (const word of BONUS_WORDS) {
      expect(markup).not.toContain(word);
    }
    // The other columns stay.
    expect(markup).toContain("Assíntota");
  });

  it("hides the bonus field on the Configuração form", () => {
    const markup = renderToStaticMarkup(<NewCategoryForm />);

    expect(markup).not.toContain("Bônus de alternância");
    // The rest of the form is still there.
    expect(markup).toContain("Passo do desgaste");
  });

  it("keeps the saved bonus through an edit, though the field is hidden (D57)", () => {
    // Editing a category off-switch does not zero its pct: `draftOf` carries it
    // and `categoryInputOf` sends it back, so a later re-enable finds it intact.
    const category = {
      id: 2,
      name: "Mente",
      baseRate: 1.5,
      decayStepHours: 1,
      alternationBonusPct: 0.5,
      sortOrder: 2,
      active: true,
      activityCount: 4,
    };

    const roundTripped = categoryInputOf(draftOf(category));

    expect(roundTripped?.alternationBonusPct).toBe(0.5);
  });
});
