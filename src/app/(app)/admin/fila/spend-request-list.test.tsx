import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PendingSpendRequest } from "../../../../db/spend-requests";

vi.mock("../../../actions/spend-requests", () => ({
  previewSpendApprovalAction: async () => undefined,
  approveSpendRequestAction: async () => undefined,
  rejectSpendRequestAction: async () => undefined,
}));

const { SpendRequestList, correctionInvalid } = await import(
  "./spend-request-list"
);

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
});

describe("correctionInvalid", () => {
  it("is false for nothing typed or a zero, true for an unparseable time", () => {
    expect(correctionInvalid(undefined)).toBe(false);
    expect(correctionInvalid({ hours: "", minutes: "" })).toBe(false);
    expect(correctionInvalid({ hours: "1", minutes: "30" })).toBe(false);
    expect(correctionInvalid({ hours: "1", minutes: "75" })).toBe(true);
  });
});
