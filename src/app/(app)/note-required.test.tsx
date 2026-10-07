// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityRow } from "../../db/activities";
import type { CategoryRow } from "../../db/categories";
import type { OpenSessionView, TimerScreenData } from "../actions/timer";

/** #44: the boy knows before the tap, and the tap waits for the note. */

vi.mock("../actions/timer", () => ({
  fetchTimerScreenAction: vi.fn(),
  startTimerAction: vi.fn(),
  pauseTimerAction: vi.fn(),
  resumeTimerAction: vi.fn(),
  stopTimerAction: vi.fn(),
  requestLogAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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

const timer = await import("../actions/timer");
const config = await import("../actions/config");
const { NOTE_REQUIRED_TEXT, TimerScreen } = await import(
  "./menino/cronometro/timer-screen"
);
const { ActivityEditor, activitySummary } = await import(
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

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );

  if (found === undefined) throw new Error(`no button named ${name}`);

  return found;
}

async function click(name: string) {
  const found = button(name);

  await act(async () => found.click());
}

async function choose(selectId: string, value: number) {
  const select = container.querySelector<HTMLSelectElement>(`#${selectId}`);

  if (select === null) throw new Error(`no select ${selectId}`);

  await act(async () => {
    select.value = String(value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function type(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector);

  if (input === null) throw new Error(`no input ${selector}`);

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const REQUIRED_LABEL = "O que aconteceu? (obrigatório nesta atividade)";
const OPTIONAL_LABEL = "Quer contar alguma coisa? (opcional)";

const IDLE: TimerScreenData = {
  userId: 3,
  activities: [
    {
      id: 5,
      name: "Ler livro",
      noteRequired: true,
      categoryId: 2,
      categoryName: "Mente",
      maxSessionMinutes: 120,
    },
    {
      id: 6,
      name: "Ler quadrinhos ou HQ",
      noteRequired: false,
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
      id: 15,
      categoryId: 4,
      categoryName: "Convívio",
      name: "Sair com os amigos",
      description: null,
      noteRequired: true,
      calcMode: "fixed",
      presumedMinutes: null,
    },
    {
      id: 20,
      categoryId: 4,
      categoryName: "Convívio",
      name: "Igreja, culto",
      description: null,
      noteRequired: false,
      calcMode: "fixed",
      presumedMinutes: null,
    },
  ],
  today: "2026-09-30",
  requested: null,
};

function session(
  noteRequired: boolean,
  activeSeconds = 20 * 60,
): OpenSessionView {
  return {
    activityId: 5,
    activityName: "Ler livro",
    categoryName: "Mente",
    status: "running",
    activeSeconds,
    maxSessionMinutes: 120,
    minSessionMinutes: 5,
    noteRequired,
  };
}

/** Running, then *Parar*: the pause answers, and the confirmation opens. */
async function confirming(open: OpenSessionView) {
  vi.mocked(timer.pauseTimerAction).mockResolvedValue({
    ...IDLE,
    open: { ...open, status: "paused" },
  });

  await render(<TimerScreen initial={{ ...IDLE, open }} />);
  await click("Parar");
}

describe("the request without a stopwatch (#44)", () => {
  it("says before the tap that the chosen activity needs a note, and holds Pedir until it has one", async () => {
    await render(<TimerScreen initial={IDLE} />);

    expect(container.textContent).toContain(REQUIRED_LABEL);
    expect(container.textContent).toContain(NOTE_REQUIRED_TEXT);
    expect(button("Pedir").disabled).toBe(true);

    await type("#pedido-nota", "   ");
    expect(button("Pedir").disabled).toBe(true);

    await type("#pedido-nota", "\u200b\u2060");
    expect(container.textContent).toContain(NOTE_REQUIRED_TEXT);
    expect(button("Pedir").disabled).toBe(true);

    await type("#pedido-nota", "cinema com a turma");
    expect(container.textContent).not.toContain(NOTE_REQUIRED_TEXT);
    expect(button("Pedir").disabled).toBe(false);

    vi.mocked(timer.requestLogAction).mockResolvedValue(IDLE);
    await click("Pedir");
    expect(timer.requestLogAction).toHaveBeenCalledWith(3, {
      activityId: 15,
      occurredOn: "2026-09-30",
      duration: null,
      note: "cinema com a turma",
    });
  });

  it("lets an activity that does not need one go without", async () => {
    await render(<TimerScreen initial={IDLE} />);
    await choose("pedido-atividade", 20);

    expect(container.textContent).toContain(OPTIONAL_LABEL);
    expect(container.textContent).not.toContain(REQUIRED_LABEL);
    expect(container.textContent).not.toContain(NOTE_REQUIRED_TEXT);
    expect(button("Pedir").disabled).toBe(false);
  });
});

describe("the stopwatch (#44)", () => {
  it("says it on the picker, before Começar", async () => {
    await render(<TimerScreen initial={IDLE} />);

    expect(container.textContent).toContain(
      "Ao enviar, esta atividade pede uma observação.",
    );

    await choose("atividade", 6);

    expect(container.textContent).not.toContain(
      "Ao enviar, esta atividade pede uma observação.",
    );
  });

  it("holds Enviar until the note is written, and says why above it", async () => {
    await confirming(session(true));

    expect(container.textContent).toContain(REQUIRED_LABEL);
    expect(container.textContent).toContain(NOTE_REQUIRED_TEXT);
    expect(button("Enviar para aprovação").disabled).toBe(true);
    expect(button("Voltar").disabled).toBe(false);

    await type("#nota", "\u200b\u2060");
    expect(container.textContent).toContain(NOTE_REQUIRED_TEXT);
    expect(button("Enviar para aprovação").disabled).toBe(true);

    await type("#nota", "li o capítulo três");

    expect(container.textContent).not.toContain(NOTE_REQUIRED_TEXT);
    expect(button("Enviar para aprovação").disabled).toBe(false);

    vi.mocked(timer.stopTimerAction).mockResolvedValue(IDLE);
    await click("Enviar para aprovação");
    expect(timer.stopTimerAction).toHaveBeenCalledWith(3, "li o capítulo três");
  });

  it("sends with no note when the activity does not need one", async () => {
    await confirming(session(false));

    expect(container.textContent).toContain(OPTIONAL_LABEL);
    expect(container.textContent).not.toContain(NOTE_REQUIRED_TEXT);
    expect(button("Enviar para aprovação").disabled).toBe(false);
  });

  it("asks nothing under the floor, where nothing is filed (D44)", async () => {
    await confirming(session(true, 2 * 60));

    expect(container.textContent).not.toContain(REQUIRED_LABEL);
    expect(container.textContent).toContain(OPTIONAL_LABEL);
    expect(container.textContent).not.toContain(NOTE_REQUIRED_TEXT);
    expect(button("Encerrar sem enviar").disabled).toBe(false);
  });
});

describe("Configuração (#44)", () => {
  const CONVIVIO: CategoryRow = {
    id: 4,
    name: "Convívio",
    baseRate: null,
    decayStepHours: null,
    alternationBonusPct: 0,
    sortOrder: 4,
    active: true,
    activityCount: 1,
  };

  const FRIENDS: ActivityRow = {
    id: 15,
    categoryId: 4,
    name: "Sair com os amigos",
    description: null,
    noteRequired: false,
    calcMode: "fixed",
    value: 3,
    maxSessionMinutes: null,
    minSessionMinutes: 5,
    qualityGraded: false,
    repeatCooldownDays: 0,
    sortOrder: 1,
    active: true,
  };

  const LOCKS = { activityIds: [], categoryIds: [], queued: 0, running: 0 };

  it("is a two-option key on the activity's page, and Salvar sends it", async () => {
    vi.mocked(config.updateActivityAction).mockResolvedValue([]);

    await render(
      <ActivityEditor
        activity={FRIENDS}
        categories={[CONVIVIO]}
        category={CONVIVIO}
        locks={LOCKS}
      />,
    );

    expect(container.textContent).toContain("Observação do menino");
    expect(button("Opcional").getAttribute("aria-pressed")).toBe("true");

    await click("Obrigatória");
    expect(button("Obrigatória").getAttribute("aria-pressed")).toBe("true");

    await click("Salvar atividade");
    expect(config.updateActivityAction).toHaveBeenCalledWith(
      4,
      15,
      expect.objectContaining({ noteRequired: true }),
    );
  });

  it("says it in the activity's summary line", () => {
    expect(activitySummary({ ...FRIENDS, noteRequired: true })).toBe(
      "3h fixas · pede observação",
    );
    expect(activitySummary(FRIENDS)).not.toContain("observação");
  });
});
