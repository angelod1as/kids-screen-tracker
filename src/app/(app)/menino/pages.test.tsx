import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Session } from "../../../auth/access";
import { HISTORY_LIMIT } from "../../../ui/entries";
import { NEGATIVE_CLASS, PENDING_BG_CLASS } from "../../../ui/style";
import type { HistoryEntry } from "../../actions/history";

/**
 * Which boy the two screens of #16 and #17 ask about.
 *
 * The guard inside each action is what protects the data, and it has its own
 * suites (`history.test.ts`, `calculator.test.ts`). This file covers the id the
 * page hands it, which is a different bug and used to be unwatched: the
 * sabotage matrix changed `session.userId` to `session.userId + 1` in
 * `calculadora/page.tsx` and 674 tests stayed green. For a kid `requireAccess`
 * refuses, so it is not a leak — but an admin session would simulate against
 * the wrong person in silence, on the screen the boy is meant to learn the
 * system from, and the same mutation in `historico/page.tsx` was caught. A gap,
 * then, and not a decision.
 *
 * The actions are replaced because what is under test is the argument, not the
 * query. `requireSession` is replaced because a page cannot read a cookie
 * without a request.
 */

const mocked = vi.hoisted(() => ({
  session: null as Session | null,
  calculatorFor: [] as number[],
  ledgerFor: [] as { userId: number; limit: number }[],
  entries: [] as HistoryEntry[],
}));

vi.mock("../../../auth/guard", () => ({
  requireSession: async () => mocked.session,
}));

vi.mock("../../actions/calculator", () => ({
  fetchCalculatorDataAction: async (userId: number) => {
    mocked.calculatorFor.push(userId);

    return {
      userId,
      occurredOn: "2026-09-02",
      historyFrom: "2026-08-03",
      categories: [],
      activities: [],
      history: [],
    };
  },
}));

vi.mock("../../actions/history", () => ({
  fetchHistoryAction: async (userId: number, limit: number) => {
    mocked.ledgerFor.push({ userId, limit });

    return mocked.entries.slice(0, limit);
  },
}));

const KidCalculatorPage = (await import("./calculadora/page")).default;
const KidHistoryPage = (await import("./historico/page")).default;

const KID1: Session = {
  userId: 3,
  username: "kid1",
  displayName: "Kid1",
  role: "kid",
};

const KID2: Session = {
  userId: 4,
  username: "kid2",
  displayName: "Kid2",
  role: "kid",
};

function entry(id: number): HistoryEntry {
  return {
    id,
    kind: "earn",
    hours: 1,
    occurredOn: "2026-09-02",
    label: `Linha ${id}`,
  };
}

describe("the screens ask about the boy who is logged in", () => {
  it("simulates for the session's own id, and nobody else's", async () => {
    for (const session of [KID1, KID2]) {
      mocked.session = session;
      mocked.calculatorFor = [];

      await KidCalculatorPage();

      expect(mocked.calculatorFor).toStrictEqual([session.userId]);
    }
  });

  it("reads the ledger of the session's own id, at the screen's limit", async () => {
    for (const session of [KID1, KID2]) {
      mocked.session = session;
      mocked.ledgerFor = [];
      mocked.entries = [];

      await KidHistoryPage();

      expect(mocked.ledgerFor).toStrictEqual([
        { userId: session.userId, limit: HISTORY_LIMIT },
      ]);
    }
  });
});

describe("a history that stops says that it stopped (#16)", () => {
  async function markup(count: number): Promise<string> {
    mocked.session = KID1;
    mocked.entries = Array.from({ length: count }, (_, index) =>
      entry(index + 1),
    );

    return renderToStaticMarkup(await KidHistoryPage());
  }

  it("writes the line when the answer came back full", async () => {
    // The one choice of #16 that had no test at all: the line could be deleted
    // and nothing went red. A list that silently stops is a list that claims to
    // be everything, and this is the screen where a boy checks whether the
    // hours he remembers earning are there.
    expect(await markup(HISTORY_LIMIT)).toContain(
      `Mostrando os ${HISTORY_LIMIT} lançamentos mais recentes.`,
    );
  });

  it("does not write it when there is nothing being left out", async () => {
    expect(await markup(HISTORY_LIMIT - 1)).not.toContain("Mostrando os");
    expect(await markup(0)).not.toContain("Mostrando os");
  });

  it("still writes the empty state when there is nothing at all", async () => {
    expect(await markup(0)).toContain("Você ainda não tem lançamentos");
  });
});

describe("the refusal the boy used to watch vanish (#72)", () => {
  async function markupOf(entries: HistoryEntry[]): Promise<string> {
    mocked.session = KID1;
    mocked.entries = entries;

    return renderToStaticMarkup(await KidHistoryPage());
  }

  /** An entry an adult refused, as the action hands it to the screen. */
  function rejected(reason: string | null): HistoryEntry {
    return {
      id: 7,
      kind: "rejected",
      occurredOn: "2026-09-02",
      label: "Ler livro",
      durationMinutes: 90,
      reason,
    };
  }

  it("shows the day, the activity, the duration and the reason", async () => {
    const markup = await markupOf([rejected("Você estava no celular")]);

    expect(markup).toContain("Ler livro");
    expect(markup).toContain("Recusado");
    expect(markup).toContain("02/09/2026");
    expect(markup).toContain("1h30");
    expect(markup).toContain("Você estava no celular");
  });

  it("says it was refused, and invents nothing, when no reason was written", async () => {
    const markup = await markupOf([rejected(null)]);

    expect(markup).toContain("Recusado");
    expect(markup).not.toContain("Motivo");
  });

  it("credits nothing, and says so in the place the hours go (D19)", async () => {
    const markup = await markupOf([rejected(null)]);

    // Not `+0 min`: a signed zero would read as a movement of the balance, and
    // a refusal is not one.
    expect(markup).toContain("0 min");
    expect(markup).not.toContain("+0 min");
  });

  it("is told apart from an approved row without a third colour", async () => {
    // CLAUDE.md spends colour on a pendency and a negative balance, and on
    // nothing else. The refusal is inverted instead — white on black.
    //
    // This used to assert the markup carried *no* utility with a shade number,
    // which was the same statement while the whole app was black and white.
    // #74 gave the chrome a palette, so the screen now legitimately draws a
    // blue band; what may not appear is a *meaning* colour, because a refusal
    // is not a pendency or a negative balance. That is the
    // rule this case was really holding, and `design.test.ts` holds the other
    // half — nothing outside the declared palette, anywhere.
    const markup = await markupOf([entry(1), rejected("Não foi isso")]);

    expect(markup).toContain("bg-black");
    expect(markup).not.toContain(NEGATIVE_CLASS);
    expect(markup).not.toContain(PENDING_BG_CLASS);
  });
});
