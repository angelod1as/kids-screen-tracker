import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("../../../actions/spend-requests", () => ({
  cancelSpendRequestAction: async () => undefined,
}));

const { MyRequests } = await import("./my-requests");

const AT = new Date("2026-10-25T15:00:00Z");

describe("the boy's own spend requests (D59)", () => {
  it("shows time, destination and status, with a cancel only on the pending one", () => {
    const markup = renderToStaticMarkup(
      <MyRequests
        requests={[
          {
            id: 1,
            hours: 2,
            approvedHours: null,
            destination: "Xbox",
            status: "pending",
            createdAt: AT,
          },
          {
            id: 2,
            hours: 2,
            approvedHours: 1.5,
            destination: "TV",
            status: "approved",
            createdAt: AT,
          },
          {
            id: 3,
            hours: 1,
            approvedHours: null,
            destination: "Celular",
            status: "rejected",
            createdAt: AT,
          },
        ]}
      />,
    );

    expect(markup).toContain("Xbox");
    expect(markup).toContain("Esperando");
    expect(markup).toContain("Aprovado · 1h30");
    expect(markup).toContain("Recusado");
    expect(markup.match(/Cancelar pedido/g)).toHaveLength(1);
  });

  it("says so when there is no request yet", () => {
    expect(renderToStaticMarkup(<MyRequests requests={[]} />)).toContain(
      "Nenhum pedido ainda.",
    );
  });
});
