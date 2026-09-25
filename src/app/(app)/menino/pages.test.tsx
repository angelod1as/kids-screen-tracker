import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Session } from "../../../auth/access";
import { HISTORY_LIMIT } from "../../../ui/entries";
import { NEGATIVE_CLASS, PENDING_BG_CLASS } from "../../../ui/style";
import type { AdultValue, HistoryEntry } from "../../actions/history";

/**
 * The id each page hands its action. For a kid a wrong id is refused, but an
 * admin would simulate against the wrong person in silence. Actions and
 * `requireSession` are replaced: a page cannot read a cookie without a request.
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
    override: null,
    voided: null,
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
    // A list that silently stops claims to be everything.
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

    // Not `+0 min`: a refusal is not a movement of the balance.
    expect(markup).toContain("0 min");
    expect(markup).not.toContain("+0 min");
  });

  it("is told apart from an approved row without a third colour", async () => {
    // A refusal is inverted, not coloured: colour means pendency or a negative
    // balance only. `design.test.ts` holds the palette itself.
    const markup = await markupOf([entry(1), rejected("Não foi isso")]);

    expect(markup).toContain("bg-black");
    expect(markup).not.toContain(NEGATIVE_CLASS);
    expect(markup).not.toContain(PENDING_BG_CLASS);
  });
});

describe("a value an adult decided says so on the boy's history (D50)", () => {
  async function markupOf(entries: HistoryEntry[]): Promise<string> {
    mocked.session = KID1;
    mocked.entries = entries;

    return renderToStaticMarkup(await KidHistoryPage());
  }

  function earn(override: AdultValue | null): HistoryEntry {
    return {
      id: 1,
      kind: "earn",
      hours: 1,
      occurredOn: "2026-09-02",
      label: "Sair com os amigos",
      override,
      voided: null,
    };
  }

  it("marks an overridden earn, and only that one", async () => {
    const markup = await markupOf([
      earn({ ruleHours: null, reason: null }),
      entry(2),
    ]);

    expect(markup.match(/valor decidido por um adulto/g)).toHaveLength(1);
  });

  it("says what the rule would have paid, and the reason", async () => {
    const markup = await markupOf([
      earn({ ruleHours: 3, reason: "Ficou só uma hora" }),
    ]);

    expect(markup).toContain("Pela regra: 3h");
    expect(markup).toContain("Motivo: Ficou só uma hora");
  });

  it("invents neither when there is none", async () => {
    const markup = await markupOf([earn({ ruleHours: null, reason: null })]);

    expect(markup).not.toContain("Pela regra");
    expect(markup).not.toContain("Motivo");
  });

  it("shows an approved zero, which has no ledger line (D10)", async () => {
    const markup = await markupOf([
      {
        id: 9,
        kind: "zero",
        occurredOn: "2026-09-02",
        label: "Lavar o carro",
        override: null,
        voided: null,
      },
    ]);

    expect(markup).toContain("Lavar o carro");
    expect(markup).toContain("0 min");
    expect(markup).not.toContain("+0 min");
    expect(markup).not.toContain("valor decidido por um adulto");
  });

  it("marks a zero an adult decided", async () => {
    const markup = await markupOf([
      {
        id: 9,
        kind: "zero",
        occurredOn: "2026-09-02",
        label: "Sair com os amigos",
        override: { ruleHours: 3, reason: null },
        voided: null,
      },
    ]);

    expect(markup).toContain("valor decidido por um adulto");
    expect(markup).toContain("Pela regra: 3h");
  });
});
