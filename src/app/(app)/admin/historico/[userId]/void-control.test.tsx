// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** D52: two taps, the second one taken with the balance before and after on screen. */

const mocked = vi.hoisted(() => ({
  voidEntryAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../../../../actions/void", () => ({
  voidEntryAction: mocked.voidEntryAction,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocked.refresh }),
}));

const { VoidControl } = await import("./void-control");

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

function buttons(): string[] {
  return [...container.querySelectorAll("button")].map(
    (button) => button.textContent?.trim() ?? "",
  );
}

async function tap(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );

  if (button === undefined) throw new Error(`no button ${label}`);

  await act(async () => button.click());
}

async function draw() {
  await act(async () =>
    root.render(
      <VoidControl
        after={0.5}
        before={3.5}
        target={{ kind: "ledger", id: 12 }}
      />,
    ),
  );
}

describe("voiding an entry (D52)", () => {
  it("asks before it writes, and says what the balance becomes", async () => {
    await draw();
    expect(buttons()).toEqual(["Anular"]);

    await tap("Anular");

    expect(mocked.voidEntryAction).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Saldo: 3h30 → 30 min");
    expect(buttons()).toEqual(["Confirmar anulação", "Voltar"]);
  });

  it("writes on the second tap and redraws the screen", async () => {
    mocked.voidEntryAction.mockResolvedValue({ balance: 0.5 });
    await draw();

    await tap("Anular");
    await tap("Confirmar anulação");

    expect(mocked.voidEntryAction).toHaveBeenCalledWith({
      kind: "ledger",
      id: 12,
    });
    expect(mocked.refresh).toHaveBeenCalledOnce();
  });

  it("goes back without writing", async () => {
    await draw();

    await tap("Anular");
    await tap("Voltar");

    expect(mocked.voidEntryAction).not.toHaveBeenCalled();
    expect(buttons()).toEqual(["Anular"]);
  });

  it("shows a refusal word for word", async () => {
    mocked.voidEntryAction.mockResolvedValue({
      refused: "Esta movimentação já foi anulada.",
    });
    await draw();

    await tap("Anular");
    await tap("Confirmar anulação");

    expect(container.textContent).toContain(
      "Esta movimentação já foi anulada.",
    );
    expect(mocked.refresh).not.toHaveBeenCalled();
  });
});
