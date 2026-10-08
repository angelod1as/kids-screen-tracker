import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MAX_HISTORY_DAYS } from "../../ui/entries";
import { TOUCH_TARGET_CLASS } from "../../ui/style";
import type { RunningTimer } from "../actions/admin-timers";
import type { HistoryEntry, LedgerEntry } from "../actions/history";

/**
 * The screen half (#73): the balance is the tap target, it leads to the right
 * boy, and a non-kid id is a 404. The guards have their own suites.
 */

const mocked = vi.hoisted(() => ({
  kids: [
    { id: 3, displayName: "Kid1" },
    { id: 4, displayName: "Kid2" },
  ],
  historyFor: [] as { userId: number; days: number }[],
  entries: [] as HistoryEntry[],
  more: false,
  running: [] as RunningTimer[],
}));

vi.mock("../actions/people", () => ({
  listKidsAction: async () => mocked.kids,
}));

vi.mock("../actions/balance", () => ({
  fetchBalanceAction: async (userId: number) => (userId === 3 ? 17.21 : -2),
}));

vi.mock("../actions/queue", () => ({
  countPendingLogsAction: async () => 0,
}));

vi.mock("../actions/history", () => ({
  fetchHistoryDaysAction: async (userId: number, days: number) => {
    mocked.historyFor.push({ userId, days });

    return { entries: mocked.entries, more: mocked.more };
  },
}));

/** Keeps `notFound`'s shape: it throws, so nothing below it runs. */
class NotFound extends Error {}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("not found");
  },
  useRouter: () => ({ refresh: () => undefined }),
}));

vi.mock("../actions/void", () => ({
  voidEntryAction: async () => ({ balance: 0 }),
}));

vi.mock("../actions/admin-timers", () => ({
  fetchRunningTimersAction: async () => mocked.running,
}));

const AdminHomePage = (await import("./admin/page")).default;
const AdminKidHistoryPage = (await import("./admin/historico/[userId]/page"))
  .default;

async function historyMarkup(userId: string, dias?: string): Promise<string> {
  mocked.historyFor = [];

  return renderToStaticMarkup(
    await AdminKidHistoryPage({
      params: Promise.resolve({ userId }),
      searchParams: Promise.resolve({ dias }),
    }),
  );
}

describe("the balance an adult reads is the thing he taps (#73)", () => {
  it("points each balance at that boy's history", async () => {
    const markup = renderToStaticMarkup(await AdminHomePage());

    expect(markup).toContain('href="/admin/historico/3"');
    expect(markup).toContain('href="/admin/historico/4"');
  });

  it("keeps the number and the name inside the target", async () => {
    const markup = renderToStaticMarkup(await AdminHomePage());
    const card = markup.slice(markup.indexOf('href="/admin/historico/3"'));

    expect(card.slice(0, card.indexOf("</a>"))).toContain("17h13");
    expect(card.slice(0, card.indexOf("</a>"))).toContain("Kid1");
  });

  it("gives the card the 48 px minimum, like every other target", async () => {
    const markup = renderToStaticMarkup(await AdminHomePage());

    for (const utility of TOUCH_TARGET_CLASS.split(" ")) {
      expect(markup).toContain(utility);
    }
  });

  it("is one tap: the home screen links straight there", async () => {
    // One tap from where the adult lands, not two.
    const markup = renderToStaticMarkup(await AdminHomePage());

    expect(markup).not.toContain('href="/admin/historico"');
  });
});

describe("the history an adult opens is the boy's own (#73)", () => {
  it("asks for the boy named in the address, with the boy's own cut (#64)", async () => {
    await historyMarkup("4");

    expect(mocked.historyFor).toEqual([{ userId: 4, days: 2 }]);
  });

  it("reveals one more day for the adult too, on the same boy (#64)", async () => {
    mocked.entries = [];
    mocked.more = true;

    const markup = await historyMarkup("4", "5");

    expect(mocked.historyFor).toEqual([{ userId: 4, days: 5 }]);
    expect(markup).toContain('href="/admin/historico/4?dias=6"');

    mocked.more = false;
  });

  it("says where it stops at the cap, instead of offering a page it refuses (#64)", async () => {
    mocked.entries = [];
    mocked.more = true;

    const markup = await historyMarkup("4", String(MAX_HISTORY_DAYS));

    expect(markup).not.toContain("Ver mais");
    expect(markup).toContain(
      `Mostrando os ${MAX_HISTORY_DAYS} dias mais recentes com lançamentos.`,
    );

    mocked.more = false;
  });

  it("says whose history it is", async () => {
    expect(await historyMarkup("4")).toContain("Histórico de Kid2");
  });

  it("offers a shortcut to take hours from the boy being read", async () => {
    const markup = await historyMarkup("4");

    expect(markup).toContain('href="/admin/tirar?menino=4"');
    expect(markup).toContain("Tirar horas");
  });

  it("is a 404 for an address that names nobody, and asks nothing", async () => {
    // An empty list would imply the app looked and found nothing.
    for (const userId of ["1", "99", "abc", ""]) {
      mocked.historyFor = [];

      await expect(historyMarkup(userId), userId).rejects.toBeInstanceOf(
        NotFound,
      );
      expect(mocked.historyFor, userId).toEqual([]);
    }
  });

  it("writes an empty state naming the boy, never a blank", async () => {
    mocked.entries = [];

    expect(await historyMarkup("3")).toContain(
      "Kid1 ainda não tem lançamentos",
    );
  });

  it("draws the refusals the boy sees, in the same words (#72)", async () => {
    mocked.entries = [
      {
        id: 7,
        kind: "rejected",
        occurredOn: "2026-09-02",
        at: Date.parse("2026-09-02T12:00:00Z"),
        label: "Ler livro",
        durationMinutes: 90,
        reason: "Você estava no celular",
        decidedBy: "Admin1",
      },
    ];

    const markup = await historyMarkup("3");

    expect(markup).toContain("Recusado");
    expect(markup).toContain("Você estava no celular");
    expect(markup).toContain("0 min");

    mocked.entries = [];
  });

  it("names who decided, including the adult who took hours (#71)", async () => {
    mocked.entries = [
      {
        id: 8,
        kind: "earn",
        hours: 2,
        occurredOn: "2026-09-02",
        at: Date.parse("2026-09-02T12:00:00Z"),
        label: "Ler livro",
        override: null,
        voided: null,
        decidedBy: "Admin1",
      },
      {
        id: 9,
        kind: "spend",
        hours: 1.5,
        occurredOn: "2026-09-02",
        at: Date.parse("2026-09-02T12:00:00Z"),
        label: "Xbox",
        override: null,
        voided: null,
        decidedBy: "Admin2",
      },
    ];

    const markup = await historyMarkup("3");

    expect(markup).toContain("Aprovado por Admin1");
    expect(markup).toContain("Tirado por Admin2");

    mocked.entries = [];
  });

  it("names who decided a value on the adult screen too (#71)", async () => {
    mocked.entries = [
      {
        id: 10,
        kind: "earn",
        hours: 1,
        occurredOn: "2026-09-02",
        at: Date.parse("2026-09-02T12:00:00Z"),
        label: "Sair com os amigos",
        override: { ruleHours: 3, reason: null },
        voided: null,
        decidedBy: "Admin1",
      },
    ];

    expect(await historyMarkup("3")).toContain("valor decidido por Admin1");

    mocked.entries = [];
  });
});

describe("voiding from the boy's history (D52)", () => {
  const counting: LedgerEntry = {
    id: 8,
    kind: "earn",
    hours: 3,
    occurredOn: "2026-09-25",
    at: Date.parse("2026-09-25T12:00:00Z"),
    label: "Ler livro",
    override: null,
    voided: null,
    decidedBy: "Admin1",
  };

  it("offers the control under each entry that still counts, and under no refusal", async () => {
    mocked.entries = [
      counting,
      {
        id: 7,
        kind: "rejected",
        occurredOn: "2026-09-02",
        at: Date.parse("2026-09-02T12:00:00Z"),
        label: "Ler livro",
        durationMinutes: 90,
        reason: null,
        decidedBy: "Admin1",
      },
    ];

    const markup = await historyMarkup("3");

    expect(markup.match(/>Anular</g)).toHaveLength(1);

    mocked.entries = [];
  });

  it("draws a voided entry struck through, with who and when, and no control", async () => {
    mocked.entries = [
      {
        ...counting,
        voided: {
          on: "2026-09-25",
          at: Date.parse("2026-09-25T12:00:00Z"),
          by: "Admin1",
        },
      },
    ];

    const markup = await historyMarkup("3");

    expect(markup).toContain("Anulado por Admin1 em 25/09/2026");
    expect(markup).toContain("line-through");
    expect(markup).not.toContain(">Anular<");

    mocked.entries = [];
  });
});

describe("the admin sees a running timer where it belongs (#84)", () => {
  const kid1Running: RunningTimer = {
    userId: 3,
    kidName: "Kid1",
    activityId: 7,
    activityName: "Ler livro",
    categoryName: "Leitura",
    activeSeconds: 6 * 60,
    status: "running",
    noteRequired: false,
  };

  it("labels only the boy whose timer is open, by its real status", async () => {
    mocked.running = [
      kid1Running,
      { ...kid1Running, userId: 4, status: "paused" },
    ];
    const markup = renderToStaticMarkup(await AdminHomePage());

    const kid1Card = markup.slice(markup.indexOf('href="/admin/historico/3"'));
    const kid2Card = markup.slice(markup.indexOf('href="/admin/historico/4"'));

    // A paused session must not read "rodando" (the detail page gets this right).
    expect(kid1Card.slice(0, kid1Card.indexOf("</a>"))).toContain(
      "Cronômetro rodando",
    );
    expect(kid2Card.slice(0, kid2Card.indexOf("</a>"))).toContain(
      "Cronômetro pausado",
    );

    mocked.running = [];
  });

  it("says 'Ver histórico' when no timer is open", async () => {
    const markup = renderToStaticMarkup(await AdminHomePage());

    expect(markup).toContain("Ver histórico");
    expect(markup).not.toContain("Cronômetro rodando");
  });

  it("mounts the control on that boy's history page, and nobody else's", async () => {
    mocked.running = [kid1Running];

    const kid1 = await historyMarkup("3");
    const kid2 = await historyMarkup("4");

    expect(kid1).toContain("Cronômetro");
    expect(kid1).toContain(">Parar<");
    expect(kid2).not.toContain(">Parar<");

    mocked.running = [];
  });
});
