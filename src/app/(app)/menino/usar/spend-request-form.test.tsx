import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("../../../actions/spend-requests", () => ({
  requestSpendAction: async () => undefined,
}));

const { SpendRequestForm } = await import("./spend-request-form");

describe("the boy's spend-request form (D58)", () => {
  it("asks how much, what for (required) and an optional comment", () => {
    const markup = renderToStaticMarkup(<SpendRequestForm userId={3} />);

    expect(markup).toContain("Quanto você quer usar");
    expect(markup).toContain("Para quê");
    expect(markup).toContain("Comentário (opcional)");
    expect(markup).toContain("Pedir pra usar");
  });
});
