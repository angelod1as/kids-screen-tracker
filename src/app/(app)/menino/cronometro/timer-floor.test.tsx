// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenSessionView, TimerScreenData } from "../../../actions/timer";

/** #86: the confirmation says a session under its floor will not be sent (D44). */

const timer = vi.hoisted(() => ({
  fetchTimerScreenAction: vi.fn(),
  startTimerAction: vi.fn(),
  pauseTimerAction: vi.fn(),
  resumeTimerAction: vi.fn(),
  stopTimerAction: vi.fn(),
}));

vi.mock("../../../actions/timer", () => timer);

const { TimerScreen } = await import("./timer-screen");

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

function session(
  status: OpenSessionView["status"],
  activeSeconds: number,
  minSessionMinutes = 5,
): OpenSessionView {
  return {
    activityId: 5,
    activityName: "Ler livro",
    categoryName: "Mente",
    status,
    activeSeconds,
    maxSessionMinutes: 120,
    minSessionMinutes,
  };
}

function screen(open: OpenSessionView | null): TimerScreenData {
  return {
    userId: 3,
    activities: [],
    open,
    settlement: null,
    proposed: null,
    pending: [],
  };
}

function buttons(): string[] {
  return [...container.querySelectorAll("button")].map(
    (button) => button.textContent?.trim() ?? "",
  );
}

async function confirm(seconds: number, minSessionMinutes?: number) {
  await act(async () =>
    root.render(
      <TimerScreen
        initial={screen(session("running", seconds, minSessionMinutes))}
      />,
    ),
  );

  timer.pauseTimerAction.mockResolvedValueOnce(
    screen(session("paused", seconds, minSessionMinutes)),
  );

  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Parar")
      ?.click();
  });
}

describe("the confirmation of a session under its floor (#86, D44)", () => {
  it("says so before the tap, at 4min59s", async () => {
    await confirm(299);

    expect(container.textContent).toContain("04:59");
    expect(container.textContent).toContain(
      "A sessão mínima desta atividade é de 5 min. Se encerrar agora, nada vai para aprovação.",
    );
    expect(buttons()).toContain("Encerrar sem enviar");
    expect(buttons()).not.toContain("Enviar para aprovação");
    expect(buttons()).toContain("Voltar");
  });

  it("offers to send at 5min exactly, with no warning", async () => {
    await confirm(300);

    expect(buttons()).toContain("Enviar para aprovação");
    expect(container.textContent).not.toContain("sessão mínima");
  });

  it("names the activity's own floor", async () => {
    await confirm(9 * 60, 10);

    expect(container.textContent).toContain("é de 10 min");
  });
});
