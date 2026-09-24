import { describe, expect, it } from "vitest";

import {
  ACCOUNT_PATH,
  accountItemFor,
  homePathFor,
  isCurrent,
  navigationFor,
} from "./navigation";

describe("the navigation is different per role (#14)", () => {
  it("gives the boy his four screens", () => {
    expect(navigationFor("kid")).toEqual([
      { href: "/menino", label: "Início" },
      { href: "/menino/cronometro", label: "Cronômetro" },
      { href: "/menino/calculadora", label: "Calculadora" },
      { href: "/menino/historico", label: "Histórico" },
    ]);
  });

  it("gives the admin his three, without Configuração (#70)", () => {
    expect(navigationFor("admin")).toEqual([
      { href: "/admin", label: "Início" },
      { href: "/admin/fila", label: "Fila" },
      { href: "/admin/lancar", label: "Lançar" },
    ]);

    expect(navigationFor("admin").map((item) => item.href)).not.toContain(
      "/admin/configuracao",
    );
  });

  it("never offers a kid an admin route", () => {
    for (const item of navigationFor("kid")) {
      expect(item.href.startsWith("/menino")).toBe(true);
    }
  });

  it("never offers an admin a kid route", () => {
    // `/menino/*` reads `session.userId`, and an admin has no balance of his own.
    for (const item of navigationFor("admin")) {
      expect(item.href.startsWith("/admin")).toBe(true);
    }
  });

  it("shares no route between the two menus", () => {
    const kid = new Set(navigationFor("kid").map((item) => item.href));
    const admin = navigationFor("admin").map((item) => item.href);

    expect(admin.filter((href) => kid.has(href))).toEqual([]);
  });

  it("is in Brazilian Portuguese", () => {
    const labels = [...navigationFor("kid"), ...navigationFor("admin")].map(
      (item) => item.label,
    );

    expect(labels).toEqual([
      "Início",
      "Cronômetro",
      "Calculadora",
      "Histórico",
      "Início",
      "Fila",
      "Lançar",
    ]);
  });
});

describe("the account item on the left of the bar (#70)", () => {
  it("carries the name of whoever is logged in, pointing at his account", () => {
    expect(accountItemFor("Kid1")).toEqual({
      href: ACCOUNT_PATH,
      label: "Kid1",
    });
    expect(ACCOUNT_PATH).toBe("/conta");
  });

  it("is one route for both roles, and in neither menu", () => {
    for (const role of ["kid", "admin"] as const) {
      expect(navigationFor(role).map((item) => item.href)).not.toContain(
        ACCOUNT_PATH,
      );
    }
  });

  it("marks itself as the current page when it is open", () => {
    expect(isCurrent(accountItemFor("Kid2"), "/conta")).toBe(true);
    expect(isCurrent(accountItemFor("Kid2"), "/menino")).toBe(false);
  });
});

describe("where each role lands", () => {
  it("sends a kid to /menino and an admin to /admin", () => {
    expect(homePathFor("kid")).toBe("/menino");
    expect(homePathFor("admin")).toBe("/admin");
  });

  it("matches the first item of that role's menu", () => {
    for (const role of ["kid", "admin"] as const) {
      expect(navigationFor(role)[0]?.href).toBe(homePathFor(role));
    }
  });
});

describe("which item is marked as the current page", () => {
  const [home, timer] = navigationFor("kid");
  if (home === undefined || timer === undefined) {
    throw new Error("the kid menu lost its first two items");
  }

  it("marks the exact route and nothing else", () => {
    expect(isCurrent(home, "/menino")).toBe(true);
    expect(isCurrent(timer, "/menino/cronometro")).toBe(true);
  });

  it("does not light up the home item on a child route", () => {
    expect(isCurrent(home, "/menino/historico")).toBe(false);
    expect(isCurrent(home, "/menino/cronometro")).toBe(false);
  });
});
