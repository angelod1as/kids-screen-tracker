// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ZERO_TIME_TEXT } from "../../../../ui/hours";
import type { TimerScreenData } from "../../../actions/timer";

/** #115: a disabled Pedir says what it still needs (D55's pattern). */

vi.mock("../../../actions/timer", () => ({
  fetchTimerScreenAction: vi.fn(),
  startTimerAction: vi.fn(),
  pauseTimerAction: vi.fn(),
  resumeTimerAction: vi.fn(),
  stopTimerAction: vi.fn(),
}));

const { TimerScreen } = await import("./timer-screen");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const SCREEN: TimerScreenData = {
  userId: 3,
  activities: [],
  open: null,
  settlement: null,
  proposed: null,
  pending: [],
  requestable: [
    {
      id: 5,
      categoryId: 1,
      categoryName: "Mente",
      name: "Ler livro",
      description: null,
      calcMode: "duration",
      presumedMinutes: null,
    },
  ],
  today: "2026-09-10",
  requested: null,
};

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<TimerScreen initial={SCREEN} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function type(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector);
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;

  await act(async () => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pedir() {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Pedir",
  );
}

describe("what a disabled Pedir still needs", () => {
  it("asks how long while the time is blank", () => {
    expect(pedir()?.disabled).toBe(true);
    expect(container.textContent).toContain("Falta dizer por quanto tempo.");
    expect(container.textContent).not.toContain(ZERO_TIME_TEXT);
  });

  it("says a typed zero is not a time, instead of going quiet", async () => {
    await type("#pedido-duracao-horas", "0");

    expect(pedir()?.disabled).toBe(true);
    expect(container.textContent).toContain(ZERO_TIME_TEXT);
    expect(container.textContent).not.toContain(
      "Falta dizer por quanto tempo.",
    );
  });

  it("asks when, once the date is cleared", async () => {
    await type("#pedido-duracao-horas", "1");
    await type("#pedido-dia", "");

    expect(pedir()?.disabled).toBe(true);
    expect(container.textContent).toContain("Falta dizer quando.");
  });

  it("has nothing to say once it is ready", async () => {
    await type("#pedido-duracao-horas", "1");

    expect(pedir()?.disabled).toBe(false);
    expect(container.textContent).not.toContain("Falta");
  });
});
