// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ledger = vi.hoisted(() => ({
  releaseHoursAction: vi.fn(),
  refundHoursAction: vi.fn(),
}));

vi.mock("../../../actions/ledger", () => ledger);

const { DEFAULT_REFUND_REASON, RefundForm } = await import("./refund-form");

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

function refundButton(): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === "Estornar",
  );

  if (found === undefined) throw new Error("no Estornar button");

  return found;
}

/** Types into a controlled input the way React listens for it. */
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
    await act(async () => refundButton().click());

    expect(ledger.refundHoursAction).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, hours: 1, reason: "Não usou" }),
    );
  });

  it("sends what the adult typed instead of the default", async () => {
    await type("#horas", "1");
    await type("#motivo", "o Xbox ficou fora do ar");
    await act(async () => refundButton().click());

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
