import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { LedgerEntry } from "../app/actions/history";
import { EntryList, signedHours } from "./entries";
import { parseTypedHours } from "./hours";
import { failingScreenCases } from "./screens.rules";

/**
 * The two screens of Phase 4 import their own server actions, and a
 * `"use server"` module reaches `varlock/env` and the database the moment it is
 * imported. Only the pure decisions of those screens are used here.
 */
vi.mock("../app/actions/timer", () => ({
  fetchTimerScreenAction: async () => null,
  startTimerAction: async () => null,
  pauseTimerAction: async () => null,
  resumeTimerAction: async () => null,
  stopTimerAction: async () => null,
}));

vi.mock("../app/actions/queue", () => ({
  fetchQueueAction: async () => null,
  approveLogAction: async () => null,
  rejectLogAction: async () => null,
}));

vi.mock("../app/actions/admin", () => ({
  fetchLaunchDataAction: async () => null,
  previewEntryAction: async () => null,
  launchEntryAction: async () => null,
}));

vi.mock("../app/actions/ledger", () => ({
  releaseHoursAction: async () => null,
  refundHoursAction: async () => null,
}));

const { displayedSeconds, settlementText } = await import(
  "../app/(app)/menino/cronometro/timer-screen"
);
const { canApprove } = await import("../app/(app)/admin/fila/queue-list");
const { canConfirm, entryOf } = await import(
  "../app/(app)/admin/lancar/launch-form"
);
const { canRefund } = await import("../app/(app)/admin/estornar/refund-form");

/**
 * What the two lists of Phase 3 actually draw, walked as plain objects.
 *
 * No DOM and no renderer, the same as `components.test.tsx`: a component is a
 * function, so it is called as one, and the React elements it returns are
 * walked as the plain objects they are.
 * `screens.sabotage.test.ts` covers the decisions these components make;
 * this file covers what reaches the screen, which is the half a mutation of a
 * pure function cannot reach — a list that computes the right sign and never
 * renders it passes the matrix and fails the boy.
 */

type Element = { type: unknown; props: Record<string, unknown> };

function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) {
    return node.flatMap(elements);
  }

  if (!isValidElement(node)) {
    return [];
  }

  const props = node.props as Record<string, unknown>;

  return [{ type: node.type, props }, ...elements(props.children as ReactNode)];
}

/** Every string the tree renders, in document order. */
function texts(node: ReactNode): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (!isValidElement(node)) return [];

  return texts((node.props as { children?: ReactNode }).children);
}

/** The whole tree as one string, for "does this sentence appear at all". */
function textOf(node: ReactNode): string {
  return texts(node).join("");
}

const ENTRIES: LedgerEntry[] = [
  {
    id: 30,
    kind: "spend",
    hours: 1.5,
    occurredOn: "2026-09-02",
    label: "Xbox",
  },
  {
    id: 20,
    kind: "earn",
    hours: 2,
    occurredOn: "2026-09-01",
    label: "Ler livro",
  },
  {
    id: 10,
    kind: "refund",
    hours: 0.25,
    occurredOn: "2026-08-31",
    label: "Estorno da tarde",
  },
];

describe("the rules the two screens decide (#15, #16)", () => {
  it("agree with every case of the table", () => {
    // The same table `screens.sabotage.test.ts` runs against the mutants. Here
    // it runs against the real thing, so a red mutant means the rule moved and
    // not that the table is wrong.
    expect(
      failingScreenCases({
        signedHours,
        displayedSeconds,
        settlementText,
        canApprove,
        parseTypedHours,
        entryOf,
        canConfirm,
        canRefund,
      }),
    ).toEqual([]);
  });
});

describe("the extract (#16)", () => {
  it("shows the date, the label and the hours on every line", () => {
    const rendered = textOf(
      EntryList({ emptyText: "vazio", entries: ENTRIES }),
    );

    for (const fragment of [
      "Xbox",
      "Gasto",
      "02/09/2026",
      "−1h30",
      "Ler livro",
      "Ganho",
      "01/09/2026",
      "+2h",
      "Estorno da tarde",
      "Estorno",
      "31/08/2026",
      "+15 min",
    ]) {
      expect(rendered, fragment).toContain(fragment);
    }
  });

  it("keeps the order it was given, most recent first", () => {
    // The action orders by `(occurred_on, created_at, id)` descending; the
    // component must not reorder or reverse it on the way out.
    const rendered = texts(EntryList({ emptyText: "vazio", entries: ENTRIES }));

    expect(rendered.indexOf("Xbox")).toBeLessThan(
      rendered.indexOf("Ler livro"),
    );
    expect(rendered.indexOf("Ler livro")).toBeLessThan(
      rendered.indexOf("Estorno da tarde"),
    );
  });

  it("draws a spend and an earn apart by sign and word, never by colour", () => {
    // CLAUDE.md spends colour in exactly two places and this is not one of
    // them, so nothing in the tree may carry a colour that is not black or
    // white.
    const classes = elements(
      EntryList({ emptyText: "vazio", entries: ENTRIES }),
    )
      .map((element) => String(element.props.className ?? ""))
      .join(" ");

    expect(classes).not.toMatch(/-(?:red|green|amber|yellow|blue)-\d/);
  });

  it("writes a sentence when there is nothing to show", () => {
    // #16: "estado vazio tratado com texto escrito". Nothing writes to the
    // ledger before Phase 4 and Phase 5, so this is the state the screen is in
    // today, on a seeded database.
    const rendered = textOf(
      EntryList({ emptyText: "Você ainda não tem lançamentos.", entries: [] }),
    );

    expect(rendered).toBe("Você ainda não tem lançamentos.");
  });

  it("renders no list at all when it is empty", () => {
    // An empty `<ul>` with a sentence beside it reads as a list that failed to
    // load. There is one element or the other, never both.
    const empty = elements(EntryList({ emptyText: "vazio", entries: [] }));

    expect(empty.filter((element) => element.type === "li")).toEqual([]);
  });
});
