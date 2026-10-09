import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type {
  HistoryEntry,
  LedgerEntry,
  RejectedEntry,
  ZeroEntry,
} from "../app/actions/history";
import {
  EntryList,
  entriesForTab,
  HistoryStatement,
  historyTab,
  signedHours,
  tabTotal,
} from "./entries";
import { parseTypedHours, parseTypedTime } from "./hours";
import { failingScreenCases } from "./screens.rules";
import { NEGATIVE_CLASS } from "./style";

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
const { canRefund } = await import("../app/(app)/admin/dar/refund-form");

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
    at: Date.parse("2026-09-02T20:00:00Z"),
    label: "Xbox",
    override: null,
    voided: null,
    decidedBy: "Admin1",
  },
  {
    id: 20,
    kind: "earn",
    hours: 2,
    occurredOn: "2026-09-01",
    at: Date.parse("2026-09-01T15:00:00Z"),
    label: "Ler livro",
    override: null,
    voided: null,
    decidedBy: "Admin1",
  },
  {
    id: 10,
    kind: "refund",
    hours: 0.25,
    occurredOn: "2026-08-31",
    at: Date.parse("2026-08-31T12:30:00Z"),
    label: "Não usou",
    override: null,
    voided: null,
    decidedBy: "Admin1",
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
        parseTypedTime,
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
      "Tirado",
      "02/09/2026",
      "−1h30",
      "Ler livro",
      "Ganho",
      "01/09/2026",
      "+2h",
      "Não usou",
      "Dado",
      "31/08/2026",
      "+15 min",
    ]) {
      expect(rendered, fragment).toContain(fragment);
    }
  });

  it("shows the time of the action beside the date (#77)", () => {
    const rendered = textOf(
      EntryList({ emptyText: "vazio", entries: ENTRIES }),
    );

    // São Paulo is three hours behind the fixtures' UTC stamps.
    for (const fragment of ["às 17:00", "às 12:00", "às 09:30"]) {
      expect(rendered, fragment).toContain(fragment);
    }
  });

  it("keeps the order it was given, most recent first", () => {
    const rendered = texts(EntryList({ emptyText: "vazio", entries: ENTRIES }));

    expect(rendered.indexOf("Xbox")).toBeLessThan(
      rendered.indexOf("Ler livro"),
    );
    expect(rendered.indexOf("Ler livro")).toBeLessThan(
      rendered.indexOf("Não usou"),
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

const ZERO: ZeroEntry = {
  id: 40,
  kind: "zero",
  occurredOn: "2026-09-03",
  at: Date.parse("2026-09-03T13:00:00Z"),
  label: "Nota zero",
  override: null,
  voided: null,
  decidedBy: "Admin1",
};

const REJECTED: RejectedEntry = {
  id: 50,
  kind: "rejected",
  occurredOn: "2026-09-04",
  at: Date.parse("2026-09-04T13:00:00Z"),
  label: "Tarefa recusada",
  durationMinutes: 30,
  reason: null,
  decidedBy: "Admin1",
};

const MIXED: HistoryEntry[] = [REJECTED, ZERO, ...ENTRIES];

describe("the extract tabs (#78)", () => {
  it("defaults an unknown tab to the whole extract", () => {
    expect(historyTab(undefined)).toBe("geral");
    expect(historyTab("lixo")).toBe("geral");
    expect(historyTab(["geral", "ganhos"])).toBe("geral");
    expect(historyTab("perdas")).toBe("perdas");
  });

  it("keeps earns, refunds and refusals in Ganhos, and spends out", () => {
    const kinds = entriesForTab(MIXED, "ganhos").map((entry) => entry.kind);

    expect(kinds).toEqual(["rejected", "earn", "refund"]);
  });

  it("keeps only spends in Perdas", () => {
    const kinds = entriesForTab(MIXED, "perdas").map((entry) => entry.kind);

    expect(kinds).toEqual(["spend"]);
  });

  it("shows a zero only in Geral", () => {
    const hasZero = (tab: Parameters<typeof entriesForTab>[1]) =>
      entriesForTab(MIXED, tab).some((entry) => entry.kind === "zero");

    expect(hasZero("geral")).toBe(true);
    expect(hasZero("ganhos")).toBe(false);
    expect(hasZero("perdas")).toBe(false);
  });

  it("shows a refusal in Ganhos as 0h, marked refused", () => {
    const markup = renderToStaticMarkup(
      HistoryStatement({
        basePath: "/menino/historico",
        days: 2,
        emptyText: "vazio",
        entries: entriesForTab(MIXED, "ganhos"),
        tab: "ganhos",
      }),
    );

    expect(markup).toContain("Tarefa recusada");
    expect(markup).toContain("Recusado");
    expect(markup).toContain("0 min");
    expect(markup).not.toContain("+0 min");
  });

  it("totals each tab by the kind's sign, rounded once (D9)", () => {
    expect(tabTotal(entriesForTab(MIXED, "geral"))).toBe(0.75);
    expect(tabTotal(entriesForTab(MIXED, "ganhos"))).toBe(2.25);
    expect(tabTotal(entriesForTab(MIXED, "perdas"))).toBe(-1.5);
  });

  it("rounds the sum once at the end, never each row", () => {
    const earns: LedgerEntry[] = [0.1, 0.2].map((hours, index) => ({
      id: index,
      kind: "earn",
      hours,
      occurredOn: "2026-09-01",
      at: 0,
      label: "x",
      override: null,
      voided: null,
      decidedBy: null,
    }));

    expect(tabTotal(earns)).toBe(0.3);
  });

  it("leaves a voided entry in the list but out of the total (D52)", () => {
    const voided: LedgerEntry = {
      id: 20,
      kind: "earn",
      hours: 2,
      occurredOn: "2026-09-01",
      at: 0,
      label: "Ler livro",
      override: null,
      voided: { on: "2026-09-05", at: 0, by: "Admin1" },
      decidedBy: "Admin1",
    };

    expect(tabTotal([voided])).toBe(0);
    expect(entriesForTab([voided], "ganhos")).toHaveLength(1);
  });

  it("paints a negative total red and a positive one black (no new colour)", () => {
    const classesFor = (tab: "ganhos" | "perdas") =>
      elements(
        HistoryStatement({
          basePath: "/menino/historico",
          days: 2,
          emptyText: "vazio",
          entries: entriesForTab(MIXED, tab),
          tab,
        }),
      )
        .map((element) => String(element.props.className ?? ""))
        .join(" ");

    expect(classesFor("perdas")).toContain(NEGATIVE_CLASS);
    expect(classesFor("ganhos")).not.toContain(NEGATIVE_CLASS);
  });

  it("carries the chosen tab and the day window in each tab link", () => {
    const markup = renderToStaticMarkup(
      HistoryStatement({
        basePath: "/menino/historico",
        days: 3,
        emptyText: "vazio",
        entries: entriesForTab(MIXED, "perdas"),
        tab: "perdas",
      }),
    );

    expect(markup).toContain('href="/menino/historico?dias=3&amp;aba=geral"');
    expect(markup).toContain('href="/menino/historico?dias=3&amp;aba=perdas"');
    expect(markup).toContain('aria-current="page"');
  });
});
