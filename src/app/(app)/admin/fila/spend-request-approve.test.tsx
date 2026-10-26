// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PendingSpendRequest } from "../../../../db/spend-requests";

const actions = vi.hoisted(() => ({
  previewSpendApprovalAction: vi.fn(),
  approveSpendRequestAction: vi.fn(),
  rejectSpendRequestAction: vi.fn(),
}));

vi.mock("../../../actions/spend-requests", () => actions);

const { SpendRequestList } = await import("./spend-request-list");
const { UNCERTAIN_TEXT } = await import("../../../../ui/failure");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const REQUEST: PendingSpendRequest = {
  id: 1,
  userId: 3,
  userName: "Kid1",
  hours: 2,
  destination: "Xbox",
  note: null,
  createdAt: new Date("2026-10-18T12:00:00Z"),
};

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  actions.approveSpendRequestAction.mockResolvedValue({
    hours: 2,
    balance: -1,
  });
  actions.rejectSpendRequestAction.mockResolvedValue(undefined);

  await act(async () => root.render(<SpendRequestList initial={[REQUEST]} />));
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

async function type(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(id);

  if (input === null) throw new Error(`no input ${id}`);

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("approving a spend request in one tap (#107, D58)", () => {
  it("writes on the first tap, with no confirmation and no preview", async () => {
    await act(async () => button("Aprovar").click());

    expect(actions.approveSpendRequestAction).toHaveBeenCalledWith(1, {});
    expect(actions.previewSpendApprovalAction).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("Pedido aprovado");
    expect(container.textContent).not.toContain("Usar Xbox");
  });

  it("approves a corrected amount in the same single tap", async () => {
    await type("#corrigir-1-horas", "1");
    await type("#corrigir-1-minutos", "30");
    await act(async () => button("Aprovar").click());

    expect(actions.approveSpendRequestAction).toHaveBeenCalledWith(1, {
      time: { hours: 1, minutes: 30 },
    });
  });

  it("keeps the request on the list when the write's answer is lost", async () => {
    actions.approveSpendRequestAction.mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    await act(async () => button("Aprovar").click());

    expect(container.textContent).toContain(UNCERTAIN_TEXT);
    expect(container.textContent).toContain("Usar Xbox");
    expect(container.textContent).not.toContain("Pedido aprovado");
  });

  it("keeps Aprovar off for an unparseable correction", async () => {
    await type("#corrigir-1-minutos", "75");

    expect(button("Aprovar").disabled).toBe(true);
  });

  it("rejects in one tap, moving nothing", async () => {
    await act(async () => button("Recusar").click());

    expect(actions.rejectSpendRequestAction).toHaveBeenCalledWith(1, "");
    expect(actions.approveSpendRequestAction).not.toHaveBeenCalled();
  });
});
