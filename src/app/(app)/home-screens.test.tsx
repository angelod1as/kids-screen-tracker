import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Session } from "../../auth/access";
import { BALANCE_CLASS, NEGATIVE_CLASS } from "../../ui/style";
import type { LedgerEntry } from "../actions/history";

/**
 * One of the two places colour means something: a negative balance's ink. Pages
 * are called as functions; actions are replaced, their guards have own suites.
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
 * Expands the app's function components too: stopping at a boundary would see
 * `<EntryList />` and no classes. One needing a runtime (`next/link`) throws
 * and stays unexpanded, props intact.
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
      // Not ours, or needs a runtime this suite lacks.
    }
  }

  return [self, ...elements(props.children as ReactNode)];
}

function classOfText(node: ReactNode, text: string): string | undefined {
  const match = elements(node).find(
    (element) => element.props.children === text,
  );

  return match?.props.className as string | undefined;
}

function allClasses(node: ReactNode): string {
  return elements(node)
    .map((element) => String(element.props.className ?? ""))
    .join(" ");
}

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
    const screen = await kidHome({ balance: 0 });

    expect(classOfText(screen, "0 min")).not.toContain(NEGATIVE_CLASS);
  });

  it("shows a negative balance in the same place and the same size", async () => {
    // #15: nothing hidden, clamped or moved; only the ink changes.
    const negative = await kidHome({ balance: -2.25 });
    const positive = await kidHome({ balance: 2.25 });

    expect(classOfText(negative, "−2h15")).toContain(BALANCE_CLASS);
    expect(classOfText(positive, "2h15")).toContain(BALANCE_CLASS);
    expect(classOfText(negative, "−2h15")?.replace(NEGATIVE_CLASS, "")).toBe(
      classOfText(positive, "2h15")?.replace("text-black", ""),
    );
  });
});

/** Here, not in `style.ts`: Tailwind scans that file and would ship every size named in it. */
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
          override: null,
          voided: null,
        },
      ],
    });

    const balance = TEXT_REM[BALANCE_CLASS] ?? 0;
    expect(balance).toBeGreaterThan(0);

    const others = sizesIn(allClasses(screen)).filter(
      (size) => size.name !== BALANCE_CLASS,
    );

    // Or a screen with one size would pass.
    expect(others.length).toBeGreaterThan(2);

    const largestOther = Math.max(...others.map((size) => size.rem));
    expect(largestOther).toBeGreaterThan(0);
    expect(balance / largestOther).toBeGreaterThanOrEqual(3);
  });

  it("is larger than anything the frame around it draws", async () => {
    // The shell and bar are outside the page's tree but on the same screen.
    const shell = readFileSync(
      join(import.meta.dirname, "..", "..", "ui", "app-shell.tsx"),
      "utf8",
    );
    const nav = readFileSync(
      join(import.meta.dirname, "..", "..", "ui", "style.ts"),
      "utf8",
    );

    // `style.ts` declares `BALANCE_CLASS` itself.
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
      override: null,
      voided: null,
    }));

    const screen = await kidHome({ balance: 1, entries });
    const rendered = JSON.stringify(elements(screen).map((e) => e.props));

    for (const index of [0, 1, 2, 3, 4]) {
      expect(rendered, `Entrada ${index}`).toContain(`Entrada ${index}`);
    }
    expect(rendered).not.toContain("Entrada 5");
  });

  it("has one big control that goes to the timer", async () => {
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
