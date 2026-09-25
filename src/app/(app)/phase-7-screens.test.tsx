import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TOUCH_TARGET_CLASS } from "../../ui/style";
import type { HistoryEntry } from "../actions/history";

/**
 * The screen half (#73): the balance is the tap target, it leads to the right
 * boy, and a non-kid id is a 404. The guards have their own suites.
 */

const mocked = vi.hoisted(() => ({
  kids: [
    { id: 3, displayName: "Kid1" },
    { id: 4, displayName: "Kid2" },
  ],
  historyFor: [] as { userId: number; limit: number }[],
  entries: [] as HistoryEntry[],
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
  fetchHistoryAction: async (userId: number, limit: number) => {
    mocked.historyFor.push({ userId, limit });

    return mocked.entries;
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

const AdminHomePage = (await import("./admin/page")).default;
const AdminKidHistoryPage = (await import("./admin/historico/[userId]/page"))
  .default;

async function historyMarkup(userId: string): Promise<string> {
  mocked.historyFor = [];

  return renderToStaticMarkup(
    await AdminKidHistoryPage({ params: Promise.resolve({ userId }) }),
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
  it("asks for the boy named in the address, at the screen's limit", async () => {
    await historyMarkup("4");

    expect(mocked.historyFor).toEqual([{ userId: 4, limit: 200 }]);
  });

  it("says whose history it is", async () => {
    expect(await historyMarkup("4")).toContain("Histórico de Kid2");
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
        label: "Ler livro",
        durationMinutes: 90,
        reason: "Você estava no celular",
      },
    ];

    const markup = await historyMarkup("3");

    expect(markup).toContain("Recusado");
    expect(markup).toContain("Você estava no celular");
    expect(markup).toContain("0 min");

    mocked.entries = [];
  });
});

describe("voiding from the boy's history (D52)", () => {
  const counting: HistoryEntry = {
    id: 8,
    kind: "earn",
    hours: 3,
    occurredOn: "2026-09-25",
    label: "Ler livro",
    override: null,
    voided: null,
  };

  it("offers the control under each entry that still counts, and under no refusal", async () => {
    mocked.entries = [
      counting,
      {
        id: 7,
        kind: "rejected",
        occurredOn: "2026-09-02",
        label: "Ler livro",
        durationMinutes: 90,
        reason: null,
      },
    ];

    const markup = await historyMarkup("3");

    expect(markup.match(/>Anular</g)).toHaveLength(1);

    mocked.entries = [];
  });

  it("draws a voided entry struck through, with who and when, and no control", async () => {
    mocked.entries = [
      { ...counting, voided: { on: "2026-09-25", by: "Admin1" } },
    ];

    const markup = await historyMarkup("3");

    expect(markup).toContain("Anulado por Admin1 em 25/09/2026");
    expect(markup).toContain("line-through");
    expect(markup).not.toContain(">Anular<");

    mocked.entries = [];
  });
});
