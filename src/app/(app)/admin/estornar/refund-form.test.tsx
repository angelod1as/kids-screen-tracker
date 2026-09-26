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

const { DEFAULT_REFUND_REASON, RefundForm } = await import("./refund-form");
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
  ledger.refundHoursAction.mockResolvedValue({ hours: 1, balance: 3 });
  ledger.previewRefundAction.mockResolvedValue({
    displayName: "Kid2",
    hours: 1,
    before: 2,
    after: 3,
  });

  await act(async () =>
    root.render(
      <RefundForm kids={[{ id: 7, displayName: "Kid2" }]} today="2026-09-22" />,
    ),
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

function refundButton(): HTMLButtonElement {
  return button("Estornar");
}

async function refundAndConfirm() {
  await act(async () => refundButton().click());
  await act(async () => button("Confirmar estorno").click());
}

function dialog(): HTMLElement | null {
  return container.querySelector('[role="dialog"]');
}

async function type(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector);

  if (input === null) throw new Error(`no input ${selector}`);

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function reasonField(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>("#motivo");
}

describe("the refund reason (#106)", () => {
  it("starts filled in with the usual reason", () => {
    expect(DEFAULT_REFUND_REASON).toBe("Não usou");
    expect(reasonField()?.value).toBe("Não usou");
  });

  it("sends the default when the adult confirms it", async () => {
    await type("#horas", "1");
    await refundAndConfirm();

    expect(ledger.refundHoursAction).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, hours: 1, reason: "Não usou" }),
    );
  });

  it("sends what the adult typed instead of the default", async () => {
    await type("#horas", "1");
    await type("#motivo", "o Xbox ficou fora do ar");
    await refundAndConfirm();

    expect(ledger.refundHoursAction).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "o Xbox ficou fora do ar" }),
    );
  });

  it("still requires a reason once the default is erased", async () => {
    await type("#horas", "1");
    await type("#motivo", "");

    expect(reasonField()?.value).toBe("");
    expect(refundButton().disabled).toBe(true);

    await act(async () => refundButton().click());

    expect(ledger.refundHoursAction).not.toHaveBeenCalled();
  });
});

describe("the confirmation (D53)", () => {
  it("shows the boy, the action, the hours and the server's two balances before writing", async () => {
    await type("#horas", "1");
    await act(async () => refundButton().click());

    expect(ledger.previewRefundAction).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, hours: 1, reason: "Não usou" }),
    );
    expect(ledger.refundHoursAction).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("MeninoKid2");
    expect(dialog()?.textContent).toContain("AçãoEstornar");
    expect(dialog()?.textContent).toContain("Horas1h");
    expect(dialog()?.textContent).toContain("Saldo2h → 3h");
  });

  it("writes once confirmed, closes, and says the balance the write left", async () => {
    await type("#horas", "1");
    await refundAndConfirm();

    expect(ledger.refundHoursAction).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(container.textContent).toContain("Estornado 1h para Kid2.");
  });

  it("closes when the form behind it changes, so nothing stale is confirmed", async () => {
    await type("#horas", "1");
    await act(async () => refundButton().click());
    await type("#horas", "2");

    expect(dialog()).toBeNull();
    expect(ledger.refundHoursAction).not.toHaveBeenCalled();
  });

  it("writes the request it previewed, not the form as it is when confirmed", async () => {
    let answer: (preview: unknown) => void = () => {};
    ledger.previewRefundAction.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    await type("#horas", "1");
    await act(async () => refundButton().click());
    await type("#horas", "2");
    await act(async () =>
      answer({ displayName: "Kid2", hours: 1, before: 2, after: 3 }),
    );
    await act(async () => button("Confirmar estorno").click());

    expect(ledger.refundHoursAction).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, hours: 1 }),
    );
  });

  it("puts the form behind it out of reach while open", async () => {
    const form = () => container.querySelector("#horas")?.closest("[inert]");

    await type("#horas", "1");

    expect(form()).toBeNull();

    await act(async () => refundButton().click());

    expect(form()).not.toBeNull();
  });

  it("writes nothing when cancelled", async () => {
    await type("#horas", "1");
    await act(async () => refundButton().click());
    await act(async () => button("Cancelar").click());

    expect(dialog()).toBeNull();
    expect(ledger.refundHoursAction).not.toHaveBeenCalled();
  });

  it("does not claim nothing was saved when the write's answer is lost", async () => {
    ledger.refundHoursAction.mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    await type("#horas", "1");
    await refundAndConfirm();

    expect(dialog()).toBeNull();
    expect(container.textContent).toContain(UNCERTAIN_TEXT);
    expect(container.textContent).not.toContain("nada foi lançado");
  });

  it("says nothing was written when the preview's answer is lost", async () => {
    ledger.previewRefundAction.mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    await type("#horas", "1");
    await act(async () => refundButton().click());

    expect(dialog()).toBeNull();
    expect(container.textContent).toContain("nada foi lançado");
    expect(ledger.refundHoursAction).not.toHaveBeenCalled();
  });
});
