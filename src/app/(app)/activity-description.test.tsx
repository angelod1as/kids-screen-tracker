// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ActivityRow, MAX_DESCRIPTION_LENGTH } from "../../db/activities";
import type { CategoryRow } from "../../db/categories";
import type { TimerScreenData } from "../actions/timer";

/** #40: the chosen activity's description, under the picker, and nothing when it has none. */

vi.mock("../actions/timer", () => ({
  fetchTimerScreenAction: vi.fn(),
  startTimerAction: vi.fn(),
  pauseTimerAction: vi.fn(),
  resumeTimerAction: vi.fn(),
  stopTimerAction: vi.fn(),
  requestLogAction: vi.fn(),
}));

vi.mock("../actions/config", () => ({
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

const { TimerScreen } = await import("./menino/cronometro/timer-screen");
const { ActivityList, activityInputOf, emptyActivity } = await import(
  "./admin/configuracao/activity-list"
);

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
  vi.clearAllMocks();
});

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
}

async function choose(selectId: string, value: number) {
  const select = container.querySelector<HTMLSelectElement>(`#${selectId}`);

  if (select === null) throw new Error(`no select ${selectId}`);

  await act(async () => {
    select.value = String(value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** The node right after the picker's wrapper: the description, or the next control. */
function afterPicker(selectId: string): Element | null {
  return (
    container.querySelector(`#${selectId}`)?.parentElement
      ?.nextElementSibling ?? null
  );
}

function expectNoEmptyText() {
  for (const node of container.querySelectorAll("p, span")) {
    expect(node.textContent?.trim()).not.toBe("");
  }
}

const OUTSIDE = "Sair de casa desde a manhã até a noite, em grupo.";
const FRIEND = "Algumas horas na casa de um amigo.";
const BOOK = "Livro, não apostila.";

const DATA: TimerScreenData = {
  userId: 3,
  activities: [
    {
      id: 5,
      name: "Ler livro",
      description: BOOK,
      categoryId: 2,
      categoryName: "Mente",
      maxSessionMinutes: 120,
    },
    {
      id: 6,
      name: "Ler quadrinhos ou HQ",
      description: null,
      categoryId: 2,
      categoryName: "Mente",
      maxSessionMinutes: 120,
    },
  ],
  open: null,
  settlement: null,
  proposed: null,
  pending: [],
  requestable: [
    {
      id: 16,
      categoryId: 4,
      categoryName: "Convívio",
      name: "Passar o dia inteiro fora",
      description: OUTSIDE,
      calcMode: "fixed",
      presumedMinutes: null,
    },
    {
      id: 17,
      categoryId: 4,
      categoryName: "Convívio",
      name: "Ir na casa de um amigo",
      description: FRIEND,
      calcMode: "fixed",
      presumedMinutes: null,
    },
    {
      id: 20,
      categoryId: 4,
      categoryName: "Convívio",
      name: "Igreja, culto",
      description: null,
      calcMode: "fixed",
      presumedMinutes: null,
    },
  ],
  today: "2026-09-30",
  requested: null,
};

describe("the stopwatch picker (#40)", () => {
  it("shows the chosen activity's description right under it", async () => {
    await render(<TimerScreen initial={DATA} />);

    expect(afterPicker("atividade")?.textContent).toBe(BOOK);
  });

  it("shows nothing, not an empty box, for one without a description", async () => {
    await render(<TimerScreen initial={DATA} />);
    await choose("atividade", 6);

    expect(container.textContent).not.toContain(BOOK);
    expect(afterPicker("atividade")?.tagName).toBe("BUTTON");
    expectNoEmptyText();
  });
});

describe("the request picker (#40)", () => {
  it("follows the choice, so two neighbouring names can be told apart", async () => {
    await render(<TimerScreen initial={DATA} />);

    expect(afterPicker("pedido-atividade")?.textContent).toBe(OUTSIDE);

    await choose("pedido-atividade", 17);

    expect(afterPicker("pedido-atividade")?.textContent).toBe(FRIEND);
    expect(container.textContent).not.toContain(OUTSIDE);
  });

  it("shows nothing, not an empty box, for one without a description", async () => {
    await render(<TimerScreen initial={DATA} />);
    await choose("pedido-atividade", 20);

    expect(
      afterPicker("pedido-atividade")?.querySelector("#pedido-dia"),
    ).not.toBeNull();
    expectNoEmptyText();
  });
});

describe("Configuration (#40)", () => {
  const CONVIVIO: CategoryRow = {
    id: 4,
    name: "Convívio",
    baseRate: null,
    decayStepHours: null,
    returnBonusPct: 0,
    returnBonusAfterDays: 0,
    sortOrder: 4,
    active: true,
    activityCount: 2,
  };

  function row(id: number, description: string | null): ActivityRow {
    return {
      id,
      categoryId: 4,
      name: `Atividade ${id}`,
      description,
      calcMode: "fixed",
      value: 2,
      maxSessionMinutes: null,
      minSessionMinutes: 5,
      qualityGraded: false,
      repeatCooldownDays: 0,
      sortOrder: id,
      active: true,
    };
  }

  const LOCKS = { activityIds: [], categoryIds: [], queued: 0, running: 0 };

  async function editing(activity: ActivityRow) {
    await render(
      <ActivityList
        categories={[CONVIVIO]}
        category={CONVIVIO}
        initial={[activity]}
        locks={LOCKS}
        onChanged={vi.fn()}
      />,
    );

    const edit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Editar",
    );
    await act(async () => edit?.click());

    return container.querySelector<HTMLInputElement>(
      `#atividade-${activity.id}-descricao`,
    );
  }

  it("opens the edit form with the description written in", async () => {
    const field = await editing(row(17, FRIEND));

    expect(field?.value).toBe(FRIEND);
    expect(field?.maxLength).toBe(MAX_DESCRIPTION_LENGTH);
  });

  it("opens it empty for one without a description, and leaves no hole", async () => {
    const field = await editing(row(20, null));

    expect(field?.value).toBe("");
    expectNoEmptyText();
  });

  it("hands the endpoint the description trimmed, and a blank one as null", () => {
    const draft = { ...emptyActivity(null), name: "X", value: "2" };

    expect(
      activityInputOf({ ...draft, description: "  Só a tarde.  " }, 4)
        ?.description,
    ).toBe("Só a tarde.");
    expect(
      activityInputOf({ ...draft, description: "   " }, 4)?.description,
    ).toBeNull();
  });
});
