import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Session } from "../../auth/access";
import { BALANCE_CLASS, NEGATIVE_CLASS } from "../../ui/style";
import type { LedgerEntry } from "../actions/history";

/**
 * The two screens that render a balance, and everything #15 adds to the boy's.
 *
 * > Cor carrega significado em exatamente dois lugares: pendência e saldo
 * > negativo.
 *
 * One of the two is here: the ink of a negative balance.
 *
 * The pages are async server components; they are called as the functions they
 * are, and the React elements they return are walked as the plain objects they
 * are. The actions are replaced because their own guards have their own suites
 * (`balance.test.ts`, `history.test.ts`) — what is under test here is what the
 * screen does with what they answer.
 */

const mocked = vi.hoisted(() => ({
  session: null as Session | null,
  balances: new Map<number, number>(),
  kids: [] as { id: number; displayName: string }[],
  pending: 0,
  entries: [] as LedgerEntry[],
  entryLimits: [] as number[],
}));

vi.mock("../../auth/guard", () => ({
  requireSession: async () => mocked.session,
}));

vi.mock("../actions/balance", () => ({
  fetchBalanceAction: async (id: number) => mocked.balances.get(id) ?? 0,
}));

vi.mock("../actions/people", () => ({
  listKidsAction: async () => mocked.kids,
}));

vi.mock("../actions/queue", () => ({
  countPendingLogsAction: async () => mocked.pending,
}));

vi.mock("../actions/history", () => ({
  fetchLedgerEntriesAction: async (_id: number, limit: number) => {
    mocked.entryLimits.push(limit);

    return mocked.entries.slice(0, limit);
  },
}));

const KidHomePage = (await import("./menino/page")).default;
const AdminHomePage = (await import("./admin/page")).default;

const KID1: Session = {
  userId: 3,
  username: "kid1",
  displayName: "Kid1",
  role: "kid",
};

type Element = { type: unknown; props: Record<string, unknown> };

/**
 * Every element in the tree, flattened, with the app's own components expanded.
 *
 * `components.test.tsx` walks a tree of host elements and stops at a component
 * boundary, which is enough there. It is not enough here: the entry list is a
 * component, so a walk that stops at its boundary sees an `<EntryList />` and
 * no class list at all — every assertion about what the boy actually sees would
 * pass against a component that renders nothing.
 *
 * So a function component is called, and what it returns is walked too. A
 * component that needs a runtime this suite does not provide — `next/link`
 * wants a router — throws, and is left unexpanded; its own props are still in
 * the list, which is where `href` is read from.
 */
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) {
    return node.flatMap(elements);
  }

  if (!isValidElement(node)) {
    return [];
  }

  const props = node.props as Record<string, unknown>;
  const self = { type: node.type, props };

  if (typeof node.type === "function") {
    try {
      const rendered = (node.type as (props: unknown) => ReactNode)(props);

      return [self, ...elements(rendered)];
    } catch {
      // Not one of ours, or not renderable without a runtime. Fall through.
    }
  }

  return [self, ...elements(props.children as ReactNode)];
}

/** The className of the element whose text is `text`, or undefined. */
function classOfText(node: ReactNode, text: string): string | undefined {
  const match = elements(node).find(
    (element) => element.props.children === text,
  );

  return match?.props.className as string | undefined;
}

/** Every class list in the tree, in one string. */
function allClasses(node: ReactNode): string {
  return elements(node)
    .map((element) => String(element.props.className ?? ""))
    .join(" ");
}

/** The boy's home screen, with the state set up first. */
async function kidHome(state: { balance: number; entries?: LedgerEntry[] }) {
  mocked.session = KID1;
  mocked.balances = new Map([[KID1.userId, state.balance]]);
  mocked.entries = state.entries ?? [];
  mocked.entryLimits = [];

  return KidHomePage();
}

describe("the boy's balance (#14, #15, CLAUDE.md: cor carrega significado)", () => {
  it("is red when it is negative", async () => {
    const screen = await kidHome({ balance: -2.25 });

    expect(classOfText(screen, "−2h15")).toContain(NEGATIVE_CLASS);
  });

  it("is black when it is not", async () => {
    const screen = await kidHome({ balance: 11.5 });

    expect(classOfText(screen, "11h30")).toContain("text-black");
    expect(classOfText(screen, "11h30")).not.toContain(NEGATIVE_CLASS);
  });

  it("treats zero as not negative", async () => {
    // Zero is "spent exactly what he earned", not "owes". The rule is about a
    // balance below the line.
    const screen = await kidHome({ balance: 0 });

    expect(classOfText(screen, "0 min")).not.toContain(NEGATIVE_CLASS);
  });

  it("shows a negative balance in the same place and the same size", async () => {
    // #15: "saldo negativo é exibido normalmente e não trava nada". Nothing is
    // hidden, clamped or moved — only the ink changes.
    const negative = await kidHome({ balance: -2.25 });
    const positive = await kidHome({ balance: 2.25 });

    expect(classOfText(negative, "−2h15")).toContain(BALANCE_CLASS);
    expect(classOfText(positive, "2h15")).toContain(BALANCE_CLASS);
    expect(classOfText(negative, "−2h15")?.replace(NEGATIVE_CLASS, "")).toBe(
      classOfText(positive, "2h15")?.replace("text-black", ""),
    );
  });
});

/**
 * Tailwind's type scale in rem, which is what "por larga margem" has to be
 * measured against.
 *
 * Here rather than in `style.ts` because `style.ts` is one of the three files
 * Tailwind's extractor reads: naming every size in it would put nine unused
 * rules into the served stylesheet. A test file is not scanned.
 */
const TEXT_REM: Record<string, number> = {
  "text-xs": 0.75,
  "text-sm": 0.875,
  "text-base": 1,
  "text-lg": 1.125,
  "text-xl": 1.25,
  "text-2xl": 1.5,
  "text-3xl": 1.875,
  "text-4xl": 2.25,
  "text-5xl": 3,
  "text-6xl": 3.75,
  "text-7xl": 4.5,
  "text-8xl": 6,
  "text-9xl": 8,
};

function sizesIn(text: string): { name: string; rem: number }[] {
  return [...text.matchAll(/\btext-(?:xs|sm|base|[2-9]?xl)\b/g)]
    .map((match) => match[0])
    .map((name) => ({ name, rem: TEXT_REM[name] ?? 0 }));
}

describe("the balance is the largest element on the screen, by a large margin (#15)", () => {
  it("is at least three times the next largest thing the screen draws", async () => {
    const screen = await kidHome({
      balance: 12.5,
      entries: [
        {
          id: 1,
          kind: "earn",
          hours: 2,
          occurredOn: "2026-09-01",
          label: "Ler livro",
        },
      ],
    });

    const balance = TEXT_REM[BALANCE_CLASS] ?? 0;
    expect(balance).toBeGreaterThan(0);

    const others = sizesIn(allClasses(screen)).filter(
      (size) => size.name !== BALANCE_CLASS,
    );

    // A screen that renders one size and nothing else would pass an
    // unconditional comparison.
    expect(others.length).toBeGreaterThan(2);

    const largestOther = Math.max(...others.map((size) => size.rem));
    expect(largestOther).toBeGreaterThan(0);
    expect(balance / largestOther).toBeGreaterThanOrEqual(3);
  });

  it("is larger than anything the frame around it draws", async () => {
    // The shell writes the boy's name and the bottom bar, and they are outside
    // the page's own tree. A heading in the frame taller than the balance would
    // break the rule just as effectively.
    const shell = readFileSync(
      join(import.meta.dirname, "..", "..", "ui", "app-shell.tsx"),
      "utf8",
    );
    const nav = readFileSync(
      join(import.meta.dirname, "..", "..", "ui", "style.ts"),
      "utf8",
    );

    // `style.ts` is where `BALANCE_CLASS` itself is declared, so it is the one
    // occurrence that is not competition.
    const others = sizesIn(`${shell} ${nav}`).filter(
      (size) => size.name !== BALANCE_CLASS,
    );

    expect(others.length).toBeGreaterThan(0);

    const largest = Math.max(...others.map((size) => size.rem));
    expect(largest).toBeGreaterThan(0);
    expect((TEXT_REM[BALANCE_CLASS] ?? 0) / largest).toBeGreaterThanOrEqual(3);
  });
});

describe("the rest of the boy's home screen (#15)", () => {
  it("asks for exactly five entries", async () => {
    await kidHome({ balance: 1 });

    expect(mocked.entryLimits).toEqual([5]);
  });

  it("shows the five most recent and not the sixth", async () => {
    const entries: LedgerEntry[] = Array.from({ length: 8 }, (_, index) => ({
      id: index,
      kind: "earn" as const,
      hours: 1,
      occurredOn: "2026-09-01",
      label: `Entrada ${index}`,
    }));

    const screen = await kidHome({ balance: 1, entries });
    const rendered = JSON.stringify(elements(screen).map((e) => e.props));

    for (const index of [0, 1, 2, 3, 4]) {
      expect(rendered, `Entrada ${index}`).toContain(`Entrada ${index}`);
    }
    expect(rendered).not.toContain("Entrada 5");
  });

  it("has one big control that goes to the timer", async () => {
    // The timer itself is #18, in Phase 4. The route exists and says so; a
    // dead href would be a 404 the boy reads as a broken app.
    const screen = await kidHome({ balance: 1 });
    const link = elements(screen).find(
      (element) => element.props.href === "/menino/cronometro",
    );

    expect(link).toBeDefined();
  });
});

describe("the two balances on the admin's screen", () => {
  it("colours each boy by his own sign", async () => {
    mocked.kids = [
      { id: 3, displayName: "Kid1" },
      { id: 4, displayName: "Kid2" },
    ];
    mocked.balances = new Map([
      [3, -2.25],
      [4, 9.5],
    ]);

    const screen = await AdminHomePage();

    expect(classOfText(screen, "−2h15")).toContain(NEGATIVE_CLASS);
    expect(classOfText(screen, "9h30")).not.toContain(NEGATIVE_CLASS);
  });
});
