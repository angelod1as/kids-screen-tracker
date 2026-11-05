// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TimerScreenData } from "../../../actions/timer";

vi.mock("../../../actions/timer", () => ({
  fetchTimerScreenAction: vi.fn(),
  startTimerAction: vi.fn(),
  pauseTimerAction: vi.fn(),
  resumeTimerAction: vi.fn(),
  stopTimerAction: vi.fn(),
  requestLogAction: vi.fn(),
}));

const { TimerScreen } = await import("./timer-screen");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const READ = {
  id: 5,
  categoryId: 1,
  categoryName: "Mente",
  name: "Ler livro",
  description: null,
  noteRequired: false,
};

const SCREEN: TimerScreenData = {
  userId: 3,
  activities: [
    { ...READ, id: 4, name: "Futebol", categoryName: "Corpo" },
    READ,
  ] as TimerScreenData["activities"],
  open: null,
  settlement: null,
  proposed: null,
  pending: [],
  requestable: [
    { ...READ, calcMode: "duration", presumedMinutes: null },
    {
      ...READ,
      id: 9,
      name: "Arrumar o quarto",
      calcMode: "fixed",
      presumedMinutes: null,
    },
  ] as TimerScreenData["requestable"],
  today: "2026-09-10",
  requested: null,
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(initialActivityId?: number) {
  await act(async () =>
    root.render(
      <TimerScreen initial={SCREEN} initialActivityId={initialActivityId} />,
    ),
  );
}

function picked(id: string): string | undefined {
  return container.querySelector<HTMLSelectElement>(id)?.value;
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

describe("counting without the stopwatch waits behind a button (C4)", () => {
  it("starts closed under Começar, and one tap opens it", async () => {
    await render();

    expect(container.querySelector("#pedido-atividade")).toBeNull();

    await act(async () => button("Contar sem cronômetro")?.click());

    expect(picked("#pedido-atividade")).toBe("5");
  });
});

describe("arriving from the calculator (CA1)", () => {
  it("chooses a timed activity on Começar", async () => {
    await render(5);

    expect(picked("#atividade")).toBe("5");
    expect(container.querySelector("#pedido-atividade")).toBeNull();
  });

  it("opens the request on an activity with no stopwatch", async () => {
    await render(9);

    expect(picked("#atividade")).toBe("4");
    expect(picked("#pedido-atividade")).toBe("9");
  });

  it("ignores an id the screen does not offer", async () => {
    await render(99);

    expect(picked("#atividade")).toBe("4");
    expect(container.querySelector("#pedido-atividade")).toBeNull();
  });
});
