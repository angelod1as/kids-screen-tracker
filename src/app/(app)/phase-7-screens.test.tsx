import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TOUCH_TARGET_CLASS } from "../../ui/style";
import type { HistoryEntry } from "../actions/history";

/**
 * The adult's way into a boy's history (#73).
 *
 * The screen is the half that can be got around — a kid who types
 * `/admin/historico/4` is redirected by the admin layout, and one who POSTs the
 * action directly is refused by `requireAccess`, which `history.test.ts` and
 * `route-guards.test.ts` cover between them. What is under test here is the
 * other half: that the balance an adult reads is the thing he taps, that it
 * leads to the right boy, and that an address naming somebody who is not a boy
 * is a 404 rather than an empty history.
 *
 * The actions are replaced because their guards have their own suites; what is
 * being watched is the id the page hands them.
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
    // The card is the target, not a word beside it: "Kid1 17h13" is what
    // an adult is looking at when he decides to ask where it came from.
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
    // "Se uma operação comum leva mais de dois toques, o desenho está errado."
    // The adult lands on `/admin`; the history is the next tap and not the one
    // after a picker.
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
    // `/admin/historico/1` is Admin1, who has no history of his own, and
    // `/admin/historico/99` is nobody at all. An empty list would imply the
    // app had looked and found nothing.
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
