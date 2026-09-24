// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueueEntry } from "../../db/queue";
import {
  RESYNCED_TEXT,
  timerFailureText,
  UNCERTAIN_TEXT,
} from "../../ui/failure";
import type { QueueData } from "../actions/queue";
import type { OpenSessionView, TimerScreenData } from "../actions/timer";

/**
 * The component half of #29 (`timer-failure.test.ts` has the server half): a
 * failure reads again, and what was typed survives. Actions throw `fetch`'s
 * `TypeError`.
 */

const timer = vi.hoisted(() => ({
  fetchTimerScreenAction: vi.fn(),
  startTimerAction: vi.fn(),
  pauseTimerAction: vi.fn(),
  resumeTimerAction: vi.fn(),
  stopTimerAction: vi.fn(),
}));

const queue = vi.hoisted(() => ({
  fetchQueueAction: vi.fn(),
  countPendingLogsAction: vi.fn(),
  approveLogAction: vi.fn(),
  rejectLogAction: vi.fn(),
}));

vi.mock("../actions/timer", () => timer);
vi.mock("../actions/queue", () => queue);

const { TimerScreen } = await import("./menino/cronometro/timer-screen");
const { QueueList } = await import("./admin/fila/queue-list");

const NETWORK = new TypeError("Failed to fetch");

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

function hasButton(name: string): boolean {
  return [...container.querySelectorAll("button")].some(
    (candidate) => candidate.textContent?.trim() === name,
  );
}

async function click(name: string) {
  await act(async () => {
    button(name).click();
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

function inputValue(selector: string): string | undefined {
  return container.querySelector<HTMLInputElement>(selector)?.value;
}

describe("the stopwatch after a failed request (#29)", () => {
  const BOOK = {
    id: 5,
    name: "Ler livro",
    categoryId: 2,
    categoryName: "Mente",
    maxSessionMinutes: 120,
  };

  function session(status: OpenSessionView["status"]): OpenSessionView {
    return {
      activityId: 5,
      activityName: "Ler livro",
      categoryName: "Mente",
      status,
      activeSeconds: 1800,
      maxSessionMinutes: 120,
      minSessionMinutes: 5,
    };
  }

  function screen(
    open: OpenSessionView | null,
    pending: TimerScreenData["pending"] = [],
  ): TimerScreenData {
    return {
      userId: 3,
      activities: [BOOK],
      open,
      settlement: null,
      proposed: null,
      pending,
    };
  }

  async function confirming() {
    await render(<TimerScreen initial={screen(session("running"))} />);

    timer.pauseTimerAction.mockResolvedValueOnce(screen(session("paused")));
    await click("Parar");
    await type("#nota", "li o capítulo 3");

    expect(hasButton("Enviar para aprovação")).toBe(true);
  }

  it("keeps the confirmation and the note when the stop and the re-read both fail", async () => {
    await confirming();

    timer.stopTimerAction.mockRejectedValueOnce(NETWORK);
    timer.fetchTimerScreenAction.mockRejectedValueOnce(NETWORK);
    await click("Enviar para aprovação");

    expect(timer.fetchTimerScreenAction).toHaveBeenCalledWith(3);
    expect(container.textContent).toContain(timerFailureText(NETWORK, true));
    expect(hasButton("Enviar para aprovação")).toBe(true);
    expect(inputValue("#nota")).toBe("li o capítulo 3");

    timer.stopTimerAction.mockResolvedValueOnce(screen(null));
    await click("Enviar para aprovação");

    expect(timer.stopTimerAction).toHaveBeenLastCalledWith(
      3,
      "li o capítulo 3",
    );
  });

  it("keeps the session on screen when the pause and the re-read both fail", async () => {
    await render(<TimerScreen initial={screen(session("running"))} />);

    timer.pauseTimerAction.mockRejectedValueOnce(NETWORK);
    timer.fetchTimerScreenAction.mockRejectedValueOnce(NETWORK);
    await click("Parar");

    expect(container.textContent).toContain(timerFailureText(NETWORK, true));
    expect(hasButton("Pausar")).toBe(true);
    expect(hasButton("Parar")).toBe(true);
  });

  it("closes the confirmation when the re-read says the stop already went through", async () => {
    await confirming();

    timer.stopTimerAction.mockRejectedValueOnce(NETWORK);
    timer.fetchTimerScreenAction.mockResolvedValueOnce(
      screen(null, [
        {
          id: 1,
          activityName: "Ler livro",
          occurredOn: "2026-09-01",
          durationMinutes: 30,
          durationSeconds: 30 * 60,
          autoStopped: false,
        },
      ]),
    );
    await click("Enviar para aprovação");

    expect(container.textContent).toContain(RESYNCED_TEXT);
    expect(hasButton("Começar")).toBe(true);
    expect(container.textContent).toContain("Pendente");

    // A fresh session, not a leftover confirmation.
    timer.startTimerAction.mockResolvedValueOnce(screen(session("running")));
    await click("Começar");

    expect(hasButton("Pausar")).toBe(true);
    expect(hasButton("Enviar para aprovação")).toBe(false);
  });

  it("keeps the confirmation when the re-read says the session is still open", async () => {
    await confirming();

    timer.stopTimerAction.mockRejectedValueOnce(NETWORK);
    timer.fetchTimerScreenAction.mockResolvedValueOnce(
      screen(session("paused")),
    );
    await click("Enviar para aprovação");

    expect(container.textContent).toContain(RESYNCED_TEXT);
    expect(hasButton("Enviar para aprovação")).toBe(true);
    expect(inputValue("#nota")).toBe("li o capítulo 3");
  });
});

describe("the queue after a failed request (#29)", () => {
  function entry(id: number, activityName: string): QueueEntry {
    return {
      id,
      userId: 3,
      kidName: "Kid1",
      activityId: 5,
      activityName,
      categoryName: "Mente",
      occurredOn: "2026-09-01",
      durationMinutes: 60,
      note: null,
      autoStopped: false,
      qualityGraded: false,
      quality: null,
      preview: null,
      unpriceable: "teste",
      blockedBy: null,
    } as QueueEntry;
  }

  const ACTIVITIES = [
    {
      id: 5,
      name: "Ler livro",
      categoryId: 2,
      categoryName: "Mente",
      maxSessionMinutes: 120,
    },
  ];

  const BOTH: QueueData = {
    entries: [entry(1, "Ler livro"), entry(2, "Desenhar")],
    activities: ACTIVITIES,
  };

  function card(activityName: string): HTMLElement {
    const found = [...container.querySelectorAll("li")].find((li) =>
      li.textContent?.includes(activityName),
    );

    if (found === undefined) throw new Error(`no card for ${activityName}`);

    return found;
  }

  async function clickIn(activityName: string, name: string) {
    const target = [...card(activityName).querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === name,
    );

    if (target === undefined) throw new Error(`no button ${name}`);

    await act(async () => target.click());
  }

  it("reads the queue again and redraws it when the approval failed", async () => {
    await render(<QueueList initial={BOTH} />);

    queue.approveLogAction.mockRejectedValueOnce(NETWORK);
    // The approval did go through.
    queue.fetchQueueAction.mockResolvedValueOnce({
      entries: [entry(2, "Desenhar")],
      activities: ACTIVITIES,
    });
    await clickIn("Ler livro", "Aprovar");

    expect(queue.fetchQueueAction).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(RESYNCED_TEXT);
    expect(container.textContent).not.toContain("Ler livro");
    expect(container.textContent).toContain("Desenhar");
  });

  it("says the request may have been saved when the re-read fails too", async () => {
    await render(<QueueList initial={BOTH} />);

    queue.approveLogAction.mockRejectedValueOnce(NETWORK);
    queue.fetchQueueAction.mockRejectedValueOnce(NETWORK);
    await clickIn("Ler livro", "Aprovar");

    expect(container.textContent).toContain(UNCERTAIN_TEXT);
    expect(container.textContent).toContain("Ler livro");
    expect(container.textContent).toContain("Desenhar");
  });

  it("keeps a correction being typed on another card across the re-read", async () => {
    await render(<QueueList initial={BOTH} />);

    await clickIn("Desenhar", "Corrigir");
    await type("#duracao-2", "45");
    await type("#nota-2", "foram 45");

    queue.approveLogAction.mockRejectedValueOnce(NETWORK);
    queue.fetchQueueAction.mockResolvedValueOnce(BOTH);
    await clickIn("Ler livro", "Aprovar");

    expect(container.textContent).toContain(RESYNCED_TEXT);
    expect(inputValue("#duracao-2")).toBe("45");
    expect(inputValue("#nota-2")).toBe("foram 45");
    expect(
      container.querySelector<HTMLSelectElement>("#atividade-2")?.value,
    ).toBe("5");
  });
});
