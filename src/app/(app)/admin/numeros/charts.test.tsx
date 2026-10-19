import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NEGATIVE_CLASS } from "../../../../ui/style";
import { BalanceLine } from "./charts";

describe("the balance chart paints a negative axis label red (#105, D42)", () => {
  it("reds the floor label when the balance dips below zero", () => {
    const markup = renderToStaticMarkup(
      BalanceLine({
        label: "Saldo",
        points: [
          { day: "2026-09-01", balance: 2 },
          { day: "2026-09-02", balance: -1.5 },
        ],
      }),
    );

    expect(markup).toContain(NEGATIVE_CLASS);
  });

  it("keeps both labels black when the balance never dips", () => {
    const markup = renderToStaticMarkup(
      BalanceLine({
        label: "Saldo",
        points: [
          { day: "2026-09-01", balance: 1 },
          { day: "2026-09-02", balance: 3 },
        ],
      }),
    );

    expect(markup).not.toContain(NEGATIVE_CLASS);
  });
});
