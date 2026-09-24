import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EntryPreview } from "../../db/admin";
import { NEGATIVE_CLASS, PENDING_BG_CLASS } from "../../ui/style";
import type { LaunchData } from "../actions/admin";

/** Actions are replaced; what is under test is what the screens draw and the ids they hand over. */

const mocked = vi.hoisted(() => ({
  kids: [
    { id: 3, displayName: "Kid1" },
    { id: 4, displayName: "Kid2" },
  ],
  balances: new Map<number, number>([
    [3, 12.5],
    [4, -2.25],
  ]),
  pending: 0,
  launch: {
    activities: [
      {
        id: 5,
        categoryId: 2,
        name: "Ler livro",
        calcMode: "duration",
        value: 2,
        qualityGraded: false,
        repeatCooldownDays: 0,
        categoryName: "Mente",
      },
      {
        id: 26,
        categoryId: 6,
        name: "Lavar o carro",
        calcMode: "delivery",
        value: 3,
        qualityGraded: true,
        repeatCooldownDays: 7,
        categoryName: "Casa",
      },
    ],
    today: "2026-09-13",
  } as LaunchData,
  preview: null as EntryPreview | null,
}));

vi.mock("../actions/balance", () => ({
  fetchBalanceAction: async (id: number) => mocked.balances.get(id) ?? 0,
}));

vi.mock("../actions/people", () => ({
  listKidsAction: async () => mocked.kids,
}));

vi.mock("../actions/queue", () => ({
  fetchQueueAction: async () => ({ entries: [], activities: [] }),
  countPendingLogsAction: async () => mocked.pending,
  approveLogAction: async () => null,
  rejectLogAction: async () => null,
}));

vi.mock("../actions/admin", () => ({
  fetchLaunchDataAction: async () => mocked.launch,
  previewEntryAction: async () => mocked.preview,
  launchEntryAction: async () => null,
}));

vi.mock("../actions/ledger", () => ({
  releaseHoursAction: async () => null,
  refundHoursAction: async () => null,
}));

/** Fixed, so a date field's ceiling (D13) does not move with the machine's calendar. */
const LAUNCHED_AT = new Date("2026-09-13T15:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(LAUNCHED_AT);
});

afterEach(() => {
  vi.useRealTimers();
});

const AdminHomePage = (await import("./admin/page")).default;
const AdminLaunchPage = (await import("./admin/lancar/page")).default;
const AdminReleasePage = (await import("./admin/liberar/page")).default;
const AdminRefundPage = (await import("./admin/estornar/page")).default;

async function markup(page: () => Promise<React.ReactElement>) {
  return renderToStaticMarkup(await page());
}

describe("the admin's home screen (#21)", () => {
  it("puts both boys side by side, each in his own ink", async () => {
    const drawn = await markup(AdminHomePage);

    expect(drawn).toContain("Kid1");
    expect(drawn).toContain("12h30");
    expect(drawn).toContain("Kid2");
    expect(drawn).toContain("−2h15");
    expect(drawn).toContain(NEGATIVE_CLASS);
    expect(drawn).toContain("grid-cols-2");
  });

  it("counts what is waiting, in the pendency colour", async () => {
    mocked.pending = 3;

    const drawn = await markup(AdminHomePage);

    expect(drawn).toContain("3 esperando");
    expect(drawn).toContain(PENDING_BG_CLASS);
  });

  it("says one, in the singular", async () => {
    mocked.pending = 1;

    expect(await markup(AdminHomePage)).toContain("1 esperando");
  });

  it("spends no colour when there is no pendency", async () => {
    mocked.pending = 0;

    const drawn = await markup(AdminHomePage);

    expect(drawn).toContain("nada esperando");
    expect(drawn).not.toContain(PENDING_BG_CLASS);
  });

  it("carries the three shortcuts of the day", async () => {
    const drawn = await markup(AdminHomePage);

    expect(drawn).toContain('href="/admin/lancar"');
    expect(drawn).toContain("Lançar atividade");
    expect(drawn).toContain('href="/admin/liberar"');
    expect(drawn).toContain("Liberar horas");
    expect(drawn).toContain('href="/admin/estornar"');
    expect(drawn).toContain("Estornar horas");
    expect(drawn).toContain('href="/admin/fila"');
  });
});

describe("launching an activity (#22)", () => {
  it("offers the boys, the activities under their categories, and the day", async () => {
    const drawn = await markup(AdminLaunchPage);

    expect(drawn).toContain("Kid1");
    expect(drawn).toContain("Kid2");
    expect(drawn).toContain("Ler livro");
    expect(drawn).toContain('label="Mente"');
    expect(drawn).toContain('label="Casa"');
    // D13.
    expect(drawn).toContain('value="2026-09-13"');
    expect(drawn).toContain('max="2026-09-13"');
  });

  it("asks for the value before it offers to write anything", async () => {
    const drawn = await markup(AdminLaunchPage);

    expect(drawn).toContain("Ver quanto vale");
    expect(drawn).not.toContain("Confirmar lançamento");
  });

  it("offers the durations of a timed activity and no grade", async () => {
    const drawn = await markup(AdminLaunchPage);

    expect(drawn).toContain("Por quanto tempo");
    expect(drawn).toContain("1h30");
    expect(drawn).not.toContain("Nota");
  });
});

describe("releasing hours (#23)", () => {
  it("asks for a boy, an amount and where it went", async () => {
    const drawn = await markup(AdminReleasePage);

    expect(drawn).toContain("Liberar horas");
    expect(drawn).toContain("Quanto");
    expect(drawn).toContain("Destino (opcional)");
    expect(drawn).toContain(">Liberar<");
  });

  it("says nothing about the devices until something has been released", async () => {
    expect(await markup(AdminReleasePage)).not.toContain(
      "nos aparelhos: ligue",
    );
  });
});

describe("refunding hours (#24)", () => {
  it("asks for a boy, an amount, a day and a reason", async () => {
    const drawn = await markup(AdminRefundPage);

    expect(drawn).toContain("Estornar horas");
    expect(drawn).toContain("Horas");
    expect(drawn).toContain("Motivo");
    expect(drawn).toContain('type="date"');
    expect(drawn).toContain(">Estornar<");
  });
});
