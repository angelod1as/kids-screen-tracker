import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { LedgerEntry } from "../app/actions/history";
import { EntryList, signedHours } from "./entries";
import { parseTypedHours } from "./hours";
import { failingScreenCases } from "./screens.rules";

/** A `"use server"` module reaches `varlock/env` and the database on import. */
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
 * What reaches the screen, which the sabotage matrix cannot see: a list that
 * computes the right sign and never renders it passes the matrix.
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

function texts(node: ReactNode): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (!isValidElement(node)) return [];

  return texts((node.props as { children?: ReactNode }).children);
}

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
    override: null,
  },
  {
    id: 20,
    kind: "earn",
    hours: 2,
    occurredOn: "2026-09-01",
    label: "Ler livro",
    override: null,
  },
  {
    id: 10,
    kind: "refund",
    hours: 0.25,
    occurredOn: "2026-08-31",
    label: "Estorno da tarde",
    override: null,
  },
];

describe("the rules the two screens decide (#15, #16)", () => {
  it("agree with every case of the table", () => {
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
    const rendered = texts(EntryList({ emptyText: "vazio", entries: ENTRIES }));

    expect(rendered.indexOf("Xbox")).toBeLessThan(
      rendered.indexOf("Ler livro"),
    );
    expect(rendered.indexOf("Ler livro")).toBeLessThan(
      rendered.indexOf("Estorno da tarde"),
    );
  });

  it("draws a spend and an earn apart by sign and word, never by colour", () => {
    const classes = elements(
      EntryList({ emptyText: "vazio", entries: ENTRIES }),
    )
      .map((element) => String(element.props.className ?? ""))
      .join(" ");

    expect(classes).not.toMatch(/-(?:red|green|amber|yellow|blue)-\d/);
  });

  it("writes a sentence when there is nothing to show", () => {
    const rendered = textOf(
      EntryList({ emptyText: "Você ainda não tem lançamentos.", entries: [] }),
    );

    expect(rendered).toBe("Você ainda não tem lançamentos.");
  });

  it("renders no list at all when it is empty", () => {
    // An empty `<ul>` beside a sentence reads as a list that failed to load.
    const empty = elements(EntryList({ emptyText: "vazio", entries: [] }));

    expect(empty.filter((element) => element.type === "li")).toEqual([]);
  });
});
