import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PendingSpendRequest } from "../../../../db/spend-requests";
import { NEGATIVE_CLASS, PENDING_BG_CLASS } from "../../../../ui/style";

const pendingSpend = vi.hoisted(() => ({ requests: [] as unknown[] }));

vi.mock("../../../actions/queue", () => ({
  approveLogAction: async () => undefined,
  fetchQueueAction: async () => ({ activities: [], entries: [] }),
  rejectLogAction: async () => undefined,
}));

vi.mock("../../../actions/spend-requests", () => ({
  approveSpendRequestAction: async () => undefined,
  fetchSpendRequestsAction: async () => pendingSpend.requests,
  previewSpendApprovalAction: async () => undefined,
  rejectSpendRequestAction: async () => undefined,
}));

const { SpendRequestList, correctionInvalid } = await import(
  "./spend-request-list"
);
const { default: AdminQueuePage } = await import("./page");

function request(
  overrides: Partial<PendingSpendRequest> = {},
): PendingSpendRequest {
  return {
    id: 1,
    userId: 3,
    userName: "Kid1",
    hours: 2,
    destination: "Xbox",
    note: "quero jogar",
    createdAt: new Date("2026-10-18T12:00:00Z"),
    ...overrides,
  };
}

describe("the spend-request list on the queue (D58)", () => {
  it("shows the boy, the destination, the comment and the hours", () => {
    const markup = renderToStaticMarkup(
      <SpendRequestList initial={[request()]} />,
    );

    expect(markup).toContain("Kid1");
    expect(markup).toContain("Usar Xbox");
    expect(markup).toContain("quero jogar");
    expect(markup).toContain("−2h");
    expect(markup).toContain("Aprovar");
    expect(markup).toContain("Recusar");
  });

  it("renders nothing when there are no requests", () => {
    expect(renderToStaticMarkup(<SpendRequestList initial={[]} />)).toBe("");
  });

  it("paints the taken hours red, since they are negative (#105)", () => {
    const markup = renderToStaticMarkup(
      <SpendRequestList initial={[request()]} />,
    );

    expect(markup).toContain(NEGATIVE_CLASS);
  });
});

describe("a spend request reads as a pendency of the queue (#115, D58)", () => {
  it("counts in the queue's own yellow mark", () => {
    const markup = renderToStaticMarkup(
      <SpendRequestList initial={[request(), request({ id: 2 })]} />,
    );

    expect(markup).toContain("2 esperando");
    expect(markup).toContain(PENDING_BG_CLASS);
  });

  it("comes before the earn queue, with the screen's one h1", async () => {
    pendingSpend.requests = [request()];

    const markup = renderToStaticMarkup(await AdminQueuePage());

    expect(markup.indexOf("Pedidos de uso")).toBeLessThan(
      markup.indexOf("Fila de aprovação"),
    );
    expect(markup.match(/<h1/g)).toHaveLength(1);
  });

  it("leaves the h1 on the earn queue when no one is asking", async () => {
    pendingSpend.requests = [];

    const page = (await AdminQueuePage()) as ReactElement;

    expect(renderToStaticMarkup(page)).toMatch(/<h1[^>]*>Fila de aprovação/);
  });
});

describe("correctionInvalid", () => {
  it("is false for nothing typed or a zero, true for an unparseable time", () => {
    expect(correctionInvalid(undefined)).toBe(false);
    expect(correctionInvalid({ hours: "", minutes: "" })).toBe(false);
    expect(correctionInvalid({ hours: "1", minutes: "30" })).toBe(false);
    expect(correctionInvalid({ hours: "1", minutes: "75" })).toBe(true);
  });
});
