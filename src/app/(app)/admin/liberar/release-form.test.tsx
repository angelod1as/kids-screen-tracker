// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ledger = vi.hoisted(() => ({
  releaseHoursAction: vi.fn(),
  refundHoursAction: vi.fn(),
  previewReleaseAction: vi.fn(),
  previewRefundAction: vi.fn(),
}));

vi.mock("../../../actions/ledger", () => ledger);

const { ReleaseForm } = await import("./release-form");
const { UNCERTAIN_TEXT } = await import("../../../../ui/failure");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  ledger.releaseHoursAction.mockResolvedValue({ hours: 1, balance: -1 });
  ledger.previewReleaseAction.mockResolvedValue({
    displayName: "Kid2",
    hours: 1,
    before: 0,
    after: -1,
  });

  await act(async () =>
    root.render(<ReleaseForm kids={[{ id: 7, displayName: "Kid2" }]} />),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );

  if (found === undefined) throw new Error(`no ${label} button`);

  return found;
}

async function releaseAndConfirm() {
  await act(async () => button("Liberar").click());
  await act(async () => button("Confirmar liberação").click());
}

function dialog(): HTMLElement | null {
  return container.querySelector('[role="dialog"]');
}

describe("the confirmation (D52)", () => {
  it("shows the boy, the action, the hours and the server's two balances before writing", async () => {
    await act(async () => button("Liberar").click());

    expect(ledger.previewReleaseAction).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, hours: 1 }),
    );
    expect(ledger.releaseHoursAction).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("MeninoKid2");
    expect(dialog()?.textContent).toContain("AçãoLiberar");
    expect(dialog()?.textContent).toContain("Horas1h");
    expect(dialog()?.textContent).toContain("Saldo0 min → −1h");
  });

  it("writes once confirmed, closes, and says the balance the write left", async () => {
    await releaseAndConfirm();

    expect(ledger.releaseHoursAction).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(container.textContent).toContain("Liberado 1h para Kid2.");
  });

  it("writes nothing when cancelled", async () => {
    await act(async () => button("Liberar").click());
    await act(async () => button("Cancelar").click());

    expect(dialog()).toBeNull();
    expect(ledger.releaseHoursAction).not.toHaveBeenCalled();
  });

  it("offers no cancel while the write is out", async () => {
    let answer: (movement: unknown) => void = () => {};
    ledger.releaseHoursAction.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    await releaseAndConfirm();

    expect(dialog()).not.toBeNull();
    expect(
      [...container.querySelectorAll("button")].map((b) => b.textContent),
    ).not.toContain("Cancelar");

    await act(async () => answer({ hours: 1, balance: -1 }));
  });

  it("does not claim nothing was saved when the write's answer is lost", async () => {
    ledger.releaseHoursAction.mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    await releaseAndConfirm();

    expect(dialog()).toBeNull();
    expect(container.textContent).toContain(UNCERTAIN_TEXT);
    expect(container.textContent).not.toContain("nada foi lançado");
  });

  it("says nothing was written when the preview's answer is lost", async () => {
    ledger.previewReleaseAction.mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    await act(async () => button("Liberar").click());

    expect(dialog()).toBeNull();
    expect(container.textContent).toContain("nada foi lançado");
    expect(ledger.releaseHoursAction).not.toHaveBeenCalled();
  });
});
