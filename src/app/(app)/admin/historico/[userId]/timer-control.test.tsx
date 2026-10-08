// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunningTimer } from "../../../../actions/admin-timers";

/** #84: the admin's two taps over a boy's open session, gated client-side. */

const mocked = vi.hoisted(() => ({
  stop: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../../../../actions/admin-timers", () => ({
  adminStopTimerAction: mocked.stop,
  adminCancelTimerAction: mocked.cancel,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocked.refresh }),
}));

const { TimerControl } = await import("./timer-control");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BOOK: RunningTimer = {
  userId: 3,
  kidName: "Kid1",
  activityId: 7,
  activityName: "Ler livro",
  categoryName: "Leitura",
  activeSeconds: 6 * 60,
  status: "running",
  noteRequired: false,
};

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

function buttons(): string[] {
  return [...container.querySelectorAll("button")].map(
    (button) => button.textContent?.trim() ?? "",
  );
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );

  if (found === undefined) throw new Error(`no button ${label}`);

  return found as HTMLButtonElement;
}

async function tap(label: string) {
  await act(async () => button(label).click());
}

function typeNote(value: string) {
  const input = container.querySelector("input");
  if (input === null) throw new Error("no note field");

  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function draw(timer: RunningTimer = BOOK) {
  await act(async () => root.render(<TimerControl timer={timer} />));
}

describe("Parar (#84)", () => {
  it("ends the session and redraws when a record was filed", async () => {
    mocked.stop.mockResolvedValue(null);
    await draw();

    await tap("Parar");

    expect(mocked.stop).toHaveBeenCalledWith(3, "");
    expect(mocked.refresh).toHaveBeenCalledOnce();
  });

  it("says why nothing was filed under the floor, without redrawing (D44)", async () => {
    mocked.stop.mockResolvedValue({
      kind: "tooShort",
      activityName: "Ler livro",
      durationMinutes: null,
      durationSeconds: 10,
      minSessionMinutes: 5,
    });
    await draw();

    await tap("Parar");

    expect(container.textContent).toContain("sessão mínima");
    expect(container.textContent).toContain("não virou registro");
    expect(mocked.refresh).not.toHaveBeenCalled();
    expect(buttons()).toEqual(["Voltar"]);
  });

  it("holds the tap until a required note is typed (#44/D55)", async () => {
    await draw({ ...BOOK, noteRequired: true });

    expect(button("Parar").disabled).toBe(true);

    await act(async () => typeNote("terminei o capítulo"));

    expect(button("Parar").disabled).toBe(false);
  });
});

describe("Cancelar (#84)", () => {
  it("asks before discarding, then discards and redraws", async () => {
    mocked.cancel.mockResolvedValue(null);
    await draw();
    expect(buttons()).toEqual(["Parar", "Cancelar"]);

    await tap("Cancelar");
    expect(mocked.cancel).not.toHaveBeenCalled();
    expect(buttons()).toEqual(["Confirmar descarte", "Voltar"]);

    await tap("Confirmar descarte");
    expect(mocked.cancel).toHaveBeenCalledWith(3);
    expect(mocked.refresh).toHaveBeenCalledOnce();
  });

  it("does not claim the queue stayed empty when the day filed a record (D16)", async () => {
    mocked.cancel.mockResolvedValue({
      kind: "dayEnded",
      activityName: "Ler livro",
      durationMinutes: 30,
      durationSeconds: 30 * 60,
    });
    await draw();

    await tap("Cancelar");
    await tap("Confirmar descarte");

    expect(container.textContent).toContain("enviado para aprovação");
    expect(mocked.refresh).not.toHaveBeenCalled();
  });

  it("goes back without discarding", async () => {
    await draw();

    await tap("Cancelar");
    await tap("Voltar");

    expect(mocked.cancel).not.toHaveBeenCalled();
    expect(buttons()).toEqual(["Parar", "Cancelar"]);
  });
});
