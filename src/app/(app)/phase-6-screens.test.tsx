import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ActivityRow } from "../../db/activities";
import type { CategoryRow } from "../../db/categories";

/**
 * The Configuration screen (#26): what it asks for, and what it draws.
 *
 * The actions are replaced because their own guards have their own suites
 * (`config.test.ts`, `config.sabotage.test.ts`); what is under test here is
 * what the screen does with what they answer — above all the asymptote, which
 * is the one number on the page that no endpoint computes and that the whole
 * acceptance criterion is about.
 *
 * The pure helpers are exercised directly rather than through the markup. They
 * are decisions rather than layout — a percentage that has to become a
 * fraction, an empty field that has to become "no decay" rather than zero — and
 * an assertion on rendered HTML would pin the sentence instead of the rule.
 */

const mocked = vi.hoisted(() => ({
  categories: [] as CategoryRow[],
  activities: [] as ActivityRow[],
  locks: {
    activityIds: [] as number[],
    categoryIds: [] as number[],
    queued: 0,
    running: 0,
  },
}));

vi.mock("../actions/config", () => ({
  fetchCategoriesAction: async () => mocked.categories,
  createCategoryAction: async () => mocked.categories,
  updateCategoryAction: async () => mocked.categories,
  setCategoryActiveAction: async () => mocked.categories,
  fetchActivitiesAction: async () => mocked.activities,
  fetchLocksAction: async () => mocked.locks,
  createActivityAction: async () => mocked.activities,
  updateActivityAction: async () => mocked.activities,
  setActivityActiveAction: async () => mocked.activities,
}));

const {
  asymptoteText,
  categoryInputOf,
  categorySummary,
  decayStepWarning,
  EMPTY_CATEGORY,
  returnBonusWarning,
} = await import("./admin/configuracao/category-list");

const ConfigurationPage = (await import("./admin/configuracao/page")).default;

/** Mente, as the seed has it. */
/**
 * Mente, as the seed has it — except for `activityCount`.
 *
 * The seed's Mente has four activities and an asymptote of `2 × 1 × 2 = 4`, and
 * those are the only two numbers the card prints. Measured: with both at 4, the
 * asymptote could be replaced by `category.activityCount` and all 51 cases
 * stayed green — the card would have printed a count where the acceptance
 * criterion asks for hours per day. Seven is a number nothing else here is.
 */
const MENTE: CategoryRow = {
  id: 2,
  name: "Mente",
  baseRate: 2,
  decayStepHours: 1,
  returnBonusPct: 0.5,
  returnBonusAfterDays: 3,
  sortOrder: 2,
  active: true,
  activityCount: 7,
};

/** Casa, which declares no rate and never decays (D5, D11). */
const CASA: CategoryRow = {
  id: 6,
  name: "Casa",
  baseRate: null,
  decayStepHours: null,
  returnBonusPct: 0,
  returnBonusAfterDays: 0,
  sortOrder: 6,
  active: true,
  activityCount: 6,
};

/** A form, filled in the way the seed's Mente is. */
const DRAFT = {
  ...EMPTY_CATEGORY,
  name: "Mente",
  baseRate: "2",
  decayStepHours: "1",
  returnBonusPct: "50",
  returnBonusAfterDays: "3",
};

describe("the asymptote, while the category is being edited (#26)", () => {
  it("says what the category would pay in a day", () => {
    // `taxa × passo × 2`, which is the number an adult is actually calibrating
    // and the reason the field beside it exists.
    expect(asymptoteText(DRAFT)).toBe(
      "Rende no máximo 4,00 h por dia (taxa × passo × 2).",
    );
  });

  it("follows the step as it is typed, without a round trip", () => {
    expect(asymptoteText({ ...DRAFT, decayStepHours: "2" })).toBe(
      "Rende no máximo 8,00 h por dia (taxa × passo × 2).",
    );
  });

  it("says there is no asymptote when there is no decay (D2)", () => {
    expect(asymptoteText({ ...DRAFT, decayStepHours: "" })).toBe(
      "Sem desgaste: cada hora vale o mesmo o dia inteiro.",
    );
  });

  it("asks for the rate rather than guessing one (D11)", () => {
    expect(asymptoteText({ ...DRAFT, baseRate: "" })).toBe(
      "Preencha a taxa sugerida para ver quanto a categoria rende por dia.",
    );
  });

  it("shows the absurdity of a step under the floor in the same breath", () => {
    // 0,1 at a rate of 3,0 is the configuration the comment on #26 names, and
    // this is the half an adult can check without knowing what a double is:
    // the whole category would pay 36 minutes a day.
    expect(
      asymptoteText({ ...DRAFT, baseRate: "3", decayStepHours: "0,1" }),
    ).toBe("Rende no máximo 0,60 h por dia (taxa × passo × 2).");
  });
});

describe("the two floors, explained before they are hit (#26)", () => {
  it("says nothing while the step is fine", () => {
    expect(decayStepWarning(DRAFT)).toBeNull();
    expect(decayStepWarning({ ...DRAFT, decayStepHours: "0,25" })).toBeNull();
  });

  it("says nothing about a category that has no decay at all", () => {
    expect(decayStepWarning({ ...DRAFT, decayStepHours: "" })).toBeNull();
  });

  it("does not call an unreadable step a category without decay", () => {
    // Four states, not three. Saying "sem desgaste" over a field with garbage
    // in it is the app asserting something false in its own voice — and
    // contradicting the warning printed directly underneath it.
    expect(asymptoteText({ ...DRAFT, decayStepHours: "abc" })).toBe(
      "Passo do desgaste ainda não é um número.",
    );
  });

  it("says something when the bonus fields are unreadable, as the step does", () => {
    // A dead Save button with no sentence beside it is the screen refusing
    // without saying why.
    expect(returnBonusWarning({ ...DRAFT, returnBonusPct: "abc" })).toBe(
      "Digite o bônus em porcentagem. Ex.: 50 para metade a mais.",
    );
    expect(returnBonusWarning({ ...DRAFT, returnBonusAfterDays: "x" })).toBe(
      "Digite os dias em número inteiro. Ex.: 3",
    );
  });

  it("names the floor and what to do instead", () => {
    const warning = decayStepWarning({ ...DRAFT, decayStepHours: "0,1" });

    expect(warning).toContain("0,25 h");
    // Not "a conta perde precisão": that stopped being true when the engine
    // went exact (D39), and it was the app asserting something false in the
    // only voice the adult hears. The floor is about the shape of the table
    // now, and this sentence is exact at any rate.
    expect(warning).toContain("menos da metade da taxa dela por dia");
    expect(warning).not.toContain("precisão");
    expect(warning).toContain("deixe o campo vazio");
  });

  it("says nothing while the bonus and its threshold agree", () => {
    expect(returnBonusWarning(DRAFT)).toBeNull();
    expect(
      returnBonusWarning({
        ...DRAFT,
        returnBonusPct: "0",
        returnBonusAfterDays: "0",
      }),
    ).toBeNull();
  });

  it("says when a bonus is too small to be stored at all", () => {
    // Screen and endpoint agree that 0,004 points is zero — that is the
    // rounding. Agreeing *silently* is still the adult's bonus vanishing, which
    // is the bug this screen already fixed once two orders of magnitude higher.
    expect(returnBonusWarning({ ...DRAFT, returnBonusPct: "0,004" })).toBe(
      "Menor que 0,01% é guardado como sem bônus. Digite 0,01 ou mais.",
    );

    // And the boundary: a hundredth of a point is held.
    expect(returnBonusWarning({ ...DRAFT, returnBonusPct: "0,01" })).toBeNull();
    expect(
      categoryInputOf({ ...DRAFT, returnBonusPct: "0,01" })?.returnBonusPct,
    ).toBe(0.0001);
  });

  it("explains why a bonus at zero days is a permanent bonus", () => {
    const warning = returnBonusWarning({ ...DRAFT, returnBonusAfterDays: "0" });

    expect(warning).toContain("o próprio dia");
    expect(warning).toContain("permanente");
    expect(warning).toContain("use 0%");
  });
});

describe("the form the endpoint is handed (#26)", () => {
  it("turns the percentage on screen into the fraction the column holds", () => {
    // The engine multiplies by `1 + pct`, so 50% is 0,5. A field labelled "%"
    // that took 0,5 would be read as half a percent by every adult alive.
    expect(categoryInputOf(DRAFT)?.returnBonusPct).toBe(0.5);
  });

  it("keeps a bonus to a hundredth of a percentage point, both ways", () => {
    // The field is in percentage points and the column in a fraction, so the
    // two round on the same lattice or a typed 12,5 comes back as 13. Every
    // value here is one the endpoint stores unchanged (`requireBonusFraction`).
    for (const [typed, fraction] of [
      ["50", 0.5],
      ["12,5", 0.125],
      ["0,1", 0.001],
      ["7,25", 0.0725],
      ["0", 0],
      // Off the lattice, which is what makes this a test of the rounding rather
      // than of division: every value above divides exactly by 100, so dropping
      // the rounding altogether left all 51 cases green.
      ["12,555", 0.1256],
    ] as const) {
      expect(
        categoryInputOf({
          ...DRAFT,
          returnBonusPct: typed,
          returnBonusAfterDays: typed === "0" ? "0" : "3",
        })?.returnBonusPct,
        typed,
      ).toBe(fraction);
    }
  });

  it("hands over every field the form has", () => {
    expect(categoryInputOf(DRAFT)).toEqual({
      name: "Mente",
      baseRate: 2,
      decayStepHours: 1,
      returnBonusPct: 0.5,
      returnBonusAfterDays: 3,
      sortOrder: 0,
    });
  });

  it("reads an empty decay field as no decay, and not as zero (D2)", () => {
    expect(
      categoryInputOf({ ...DRAFT, decayStepHours: "" })?.decayStepHours,
    ).toBeNull();
  });

  it("reads an empty rate as a category that declares none (D11)", () => {
    expect(categoryInputOf({ ...DRAFT, baseRate: "" })?.baseRate).toBeNull();
  });

  it("takes the comma a Brazilian keyboard produces", () => {
    expect(
      categoryInputOf({ ...DRAFT, decayStepHours: "1,5" })?.decayStepHours,
    ).toBe(1.5);
  });

  it("answers nothing for a form that is not a category yet", () => {
    expect(categoryInputOf({ ...DRAFT, name: "   " })).toBeNull();
    expect(categoryInputOf({ ...DRAFT, decayStepHours: "abc" })).toBeNull();
    expect(categoryInputOf({ ...DRAFT, returnBonusPct: "" })).toBeNull();
    expect(categoryInputOf({ ...DRAFT, returnBonusAfterDays: "" })).toBeNull();
    expect(categoryInputOf({ ...DRAFT, sortOrder: "" })).toBeNull();
  });

  it("refuses a whole day of cooldown written as a decimal", () => {
    // Not rounded into shape: the column is an integer, and "1,5 dias" is a
    // field that has not been filled in correctly rather than a value.
    expect(
      categoryInputOf({ ...DRAFT, returnBonusAfterDays: "1,5" }),
    ).toBeNull();
  });

  it("answers nothing for a draft the endpoint would refuse", () => {
    // The same two predicates the server applies, so the button is dead before
    // the tap rather than the refusal arriving after it.
    expect(categoryInputOf({ ...DRAFT, decayStepHours: "0,1" })).toBeNull();
    expect(categoryInputOf({ ...DRAFT, returnBonusAfterDays: "0" })).toBeNull();
  });
});

describe("what a category says about itself in the list (#26)", () => {
  it("names the ceiling it converges on and the bonus", () => {
    expect(categorySummary(MENTE)).toBe(
      "até 4,00 h por dia · +50% após 3 dias",
    );
  });

  it("says a category with no decay and no bonus has neither", () => {
    expect(categorySummary(CASA)).toBe("sem desgaste · sem bônus");
  });

  it("says the step alone when there is no rate to build an asymptote from", () => {
    expect(categorySummary({ ...CASA, decayStepHours: 2 })).toBe(
      "passo de 2,00 h · sem bônus",
    );
  });

  it("says one day in the singular", () => {
    expect(
      categorySummary({
        ...MENTE,
        returnBonusPct: 0.25,
        returnBonusAfterDays: 1,
      }),
    ).toBe("até 4,00 h por dia · +25% após 1 dia");
  });

  it("writes a fractional percentage the way the form does, with a comma", () => {
    // The card sits directly above the field. Rounding the two differently —
    // "+13%" over "12,5" — is two numbers for one bonus with nothing to say
    // which is real, and a full stop where the rest of the interface uses a
    // comma is the other half of the same slip.
    expect(categorySummary({ ...MENTE, returnBonusPct: 0.125 })).toBe(
      "até 4,00 h por dia · +12,5% após 3 dias",
    );
  });
});

describe("the screen itself (#26)", () => {
  it("says that editing changes nothing already credited, and deletes nothing", async () => {
    mocked.categories = [MENTE, CASA];

    const markup = renderToStaticMarkup(await ConfigurationPage());

    // The two decisions an adult has to trust before he will use this screen
    // as often as the first months need him to (D14, D15).
    expect(markup).toContain("Nada que já foi creditado muda");
    expect(markup).toContain("desativar não apaga");
  });

  it("draws every category with what it pays and how many activities go with it", async () => {
    mocked.categories = [MENTE, CASA];

    const markup = renderToStaticMarkup(await ConfigurationPage());

    expect(markup).toContain("Mente");
    expect(markup).toContain("até 4,00 h por dia · +50% após 3 dias");
    expect(markup).toContain("7 atividades");
    expect(markup).toContain("Casa");
    expect(markup).toContain("sem desgaste · sem bônus");
  });

  it("says which categories are switched off rather than hiding them (D14)", async () => {
    mocked.categories = [MENTE, { ...CASA, active: false }];

    const markup = renderToStaticMarkup(await ConfigurationPage());

    expect(markup).toContain("desativada");
    expect(markup).toContain("Ativar de novo");
    expect(markup).toContain("Desativar");
  });

  it("says one activity in the singular", async () => {
    mocked.categories = [{ ...CASA, activityCount: 1 }];

    const markup = renderToStaticMarkup(await ConfigurationPage());

    expect(markup).toContain("1 atividade");
    expect(markup).not.toContain("1 atividades");
  });

  it("offers a form for a category that does not exist yet", async () => {
    mocked.categories = [MENTE];

    const markup = renderToStaticMarkup(await ConfigurationPage());

    expect(markup).toContain("Nova categoria");
    expect(markup).toContain("Passo do desgaste");
    expect(markup).toContain("Bônus de retorno");
  });

  it("puts the asymptote on the page, under the fields it comes from", async () => {
    mocked.categories = [MENTE];

    const markup = renderToStaticMarkup(await ConfigurationPage());

    // The empty form has no step yet, so the readout is in its no-decay state
    // — the criterion here is that it is on the page, between the step field
    // and the bonus field. Its four states are asserted above.
    expect(markup).toContain(
      "Sem desgaste: cada hora vale o mesmo o dia inteiro.",
    );
    expect(markup.indexOf("nova-passo")).toBeLessThan(
      markup.indexOf("Sem desgaste: cada hora"),
    );
    expect(markup.indexOf("Sem desgaste: cada hora")).toBeLessThan(
      markup.indexOf("nova-bonus"),
    );
  });
});

const {
  activityInputOf,
  activitySummary,
  emptyActivity,
  minSessionWarning,
  suggestedValue,
  withCalcMode,
} = await import("./admin/configuracao/activity-list");

/** "Ler livro", as the seed has it. */
const BOOK: ActivityRow = {
  id: 5,
  categoryId: 2,
  name: "Ler livro",
  calcMode: "duration",
  value: 2,
  maxSessionMinutes: 120,
  minSessionMinutes: 5,
  qualityGraded: false,
  repeatCooldownDays: 0,
  sortOrder: 1,
  active: true,
};

describe("the category's rate as a suggestion (#27, D11)", () => {
  it("arrives in the value field of a new duration activity, filled in", () => {
    // The acceptance criterion in so many words. Mente's `base_rate` is 2,0.
    expect(emptyActivity(2).value).toBe("2");
    expect(emptyActivity(2).calcMode).toBe("duration");
  });

  it("is empty for a category that declares no rate at all", () => {
    // Convívio, Casa and Curinga. Inventing 2,0 here would put a number in
    // front of an adult that nothing in the data supports.
    expect(emptyActivity(null).value).toBe("");
    expect(suggestedValue(null)).toBe("");
  });

  it("is written with the comma the rest of the screen uses", () => {
    expect(suggestedValue(1.5)).toBe("1,5");
  });

  it("fills an empty field when the mode is switched to duration", () => {
    const draft = { ...emptyActivity(2), value: "" };

    expect(withCalcMode(draft, "duration", 2).value).toBe("2");
  });

  it("never overwrites a value an adult has already typed", () => {
    // The suggestion is an offer. Overwriting a typed number would make it a
    // rule, and D11 is explicit that the activity's own value is what governs.
    const draft = { ...emptyActivity(2), value: "1,5" };

    expect(withCalcMode(draft, "duration", 2).value).toBe("1,5");
  });

  it("clears the value for a free activity, which has none of its own (D12)", () => {
    const draft = { ...emptyActivity(2), value: "2" };

    expect(withCalcMode(draft, "free", 2).value).toBe("");
  });

  it("leaves the value alone for fixed and delivery", () => {
    const draft = { ...emptyActivity(2), value: "3" };

    expect(withCalcMode(draft, "fixed", 2).value).toBe("3");
    expect(withCalcMode(draft, "delivery", 2).value).toBe("3");
  });
});

describe("the activity form the endpoint is handed (#27)", () => {
  /**
   * The activity form, with every number distinct.
   *
   * Measured with the previous fixture, which took `emptyActivity(2)` into
   * category 2 with cooldown and sort order both `"0"`: `categoryId` could be
   * replaced by `Math.round(value)` and the two counters swapped with each
   * other, and all 51 cases stayed green. An activity would have been filed in
   * the category whose id happened to equal its rate.
   */
  const DRAFT = {
    ...emptyActivity(1.5),
    name: "Podcast",
    maxSessionMinutes: "90",
    repeatCooldownDays: "4",
    sortOrder: "6",
  };

  it("hands over every field #27 lists", () => {
    expect(activityInputOf(DRAFT, 3)).toEqual({
      categoryId: 3,
      name: "Podcast",
      calcMode: "duration",
      value: 1.5,
      maxSessionMinutes: 90,
      minSessionMinutes: 5,
      qualityGraded: false,
      repeatCooldownDays: 4,
      sortOrder: 6,
    });
  });

  it("sends no value at all for a free activity", () => {
    expect(
      activityInputOf({ ...DRAFT, calcMode: "free", value: "" }, 2)?.value,
    ).toBeNull();
  });

  it("reads an empty session limit as no limit", () => {
    expect(
      activityInputOf({ ...DRAFT, maxSessionMinutes: "" }, 2)
        ?.maxSessionMinutes,
    ).toBeNull();
  });

  it("answers nothing for a form that is not an activity yet", () => {
    expect(activityInputOf({ ...DRAFT, name: "  " }, 2)).toBeNull();
    expect(activityInputOf({ ...DRAFT, value: "" }, 2)).toBeNull();
    expect(activityInputOf({ ...DRAFT, value: "abc" }, 2)).toBeNull();
    expect(activityInputOf({ ...DRAFT, repeatCooldownDays: "" }, 2)).toBeNull();
    expect(activityInputOf({ ...DRAFT, sortOrder: "" }, 2)).toBeNull();
  });

  it("refuses a session limit written as a decimal rather than rounding it", () => {
    expect(
      activityInputOf({ ...DRAFT, maxSessionMinutes: "90,5" }, 2),
    ).toBeNull();
  });

  it("keeps a value priced away from the category's rate", () => {
    expect(activityInputOf({ ...DRAFT, value: "1,5" }, 2)?.value).toBe(1.5);
  });
});

describe("what an activity says about itself in the list (#27)", () => {
  it("says the rate, the session limit and the cooldown", () => {
    expect(activitySummary(BOOK)).toBe(
      "2,00 h por hora · mínimo de 5 min · até 2h por sessão",
    );
  });

  it("says a fixed value is fixed", () => {
    expect(
      activitySummary({
        ...BOOK,
        calcMode: "fixed",
        value: 3,
        maxSessionMinutes: null,
      }),
    ).toBe("3,00 h fixas");
  });

  it("says a delivery is multiplied by the grade", () => {
    expect(
      activitySummary({
        ...BOOK,
        calcMode: "delivery",
        value: 3,
        maxSessionMinutes: null,
        qualityGraded: true,
        repeatCooldownDays: 7,
      }),
    ).toBe("3,00 h × nota · repete a cada 7 dias");
  });

  it("says a free activity has its value typed at launch (D11, D12)", () => {
    expect(
      activitySummary({
        ...BOOK,
        calcMode: "free",
        value: null,
        maxSessionMinutes: null,
      }),
    ).toBe("valor digitado no lançamento");
  });

  it("says one day of cooldown in the singular", () => {
    expect(
      activitySummary({
        ...BOOK,
        maxSessionMinutes: null,
        repeatCooldownDays: 1,
      }),
    ).toBe("2,00 h por hora · mínimo de 5 min · repete a cada 1 dia");
  });
});

describe("the activities are reachable from the category (#27)", () => {
  it("offers a way into them from each category card", async () => {
    mocked.categories = [MENTE, CASA];
    mocked.activities = [BOOK];

    const markup = renderToStaticMarkup(await ConfigurationPage());

    expect(markup).toContain("Atividades");
  });
});

describe("the floor an adult types (D44)", () => {
  const TIMED = {
    ...emptyActivity(2),
    name: "Ler livro",
    maxSessionMinutes: "120",
  };

  it("keeps Save dead, and says why, when the floor passes the limit", () => {
    const draft = { ...TIMED, minSessionMinutes: "150" };

    expect(activityInputOf(draft, 3)).toBeNull();
    expect(minSessionWarning(draft)).toContain("não pode passar do limite");
  });

  it("keeps Save dead on a floor of zero", () => {
    const draft = { ...TIMED, minSessionMinutes: "0" };

    expect(activityInputOf(draft, 3)).toBeNull();
    expect(minSessionWarning(draft)).toContain("de 1 para cima");
  });

  it("starts a new activity at five minutes, with nothing to warn about", () => {
    expect(activityInputOf(TIMED, 3)?.minSessionMinutes).toBe(5);
    expect(minSessionWarning(TIMED)).toBeNull();
  });
});
