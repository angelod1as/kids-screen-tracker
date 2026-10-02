// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Missing, QueueEntry } from "../../../../db/queue";
import type { QueueData } from "../../../actions/queue";

/** #37: the card says what unlocks an unpriceable entry, and asks for it in place. */

const queue = vi.hoisted(() => ({
  fetchQueueAction: vi.fn(),
  countPendingLogsAction: vi.fn(),
  approveLogAction: vi.fn(),
  rejectLogAction: vi.fn(),
}));

vi.mock("../../../actions/queue", () => queue);

const { QueueList, unpriceableText } = await import("./queue-list");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function entry(overrides: Partial<QueueEntry>): QueueEntry {
  return {
    id: 7,
    userId: 3,
    kidName: "Kid1",
    activityId: 32,
    activityName: "Atividade avulsa",
    categoryName: "Curinga",
    occurredOn: "2026-09-13",
    durationMinutes: null,
    durationSeconds: null,
    note: null,
    autoStopped: false,
    source: "request",
    calcMode: "free",
    qualityGraded: false,
    quality: null,
    preview: null,
    unpriceable: ["value"],
    blockedBy: null,
    ...overrides,
  };
}

async function render(one: QueueEntry) {
  const data: QueueData = { entries: [one], activities: [] };
  await act(async () => root.render(<QueueList initial={data} />));
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );

  if (found === undefined) throw new Error(`no button named ${name}`);

  return found;
}

async function click(name: string) {
  await act(async () => button(name).click());
}

async function type(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector);

  if (input === null) throw new Error(`no input ${selector}`);

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const CASES: readonly (readonly Missing[])[] = [
  ["value"],
  ["grade"],
  ["value", "grade"],
  ["duration"],
  ["duration", "grade"],
  [],
];

describe("each unpriceable case has its own sentence (#37)", () => {
  it.each(CASES.map((missing) => ({ missing })))(
    "$missing is said in Portuguese, with what to do",
    async ({ missing }) => {
      await render(entry({ unpriceable: [...missing] }));

      const text = container.textContent ?? "";

      expect(text).toContain(unpriceableText(missing));
      expect(text).not.toMatch(/needs|freeValue|activity|Corrija a atividade/);
    },
  );

  it("gives the distinct causes distinct sentences", () => {
    const sentences = [
      ["value"],
      ["grade"],
      ["value", "grade"],
      ["duration"],
      [],
    ].map((missing) => unpriceableText(missing as Missing[]));

    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it("says the missing duration over the missing grade", () => {
    expect(unpriceableText(["duration", "grade"])).toBe(
      unpriceableText(["duration"]),
    );
  });

  it("never sends the adult to the Configuration screen", () => {
    for (const missing of CASES) {
      expect(unpriceableText(missing)).not.toMatch(/Configura/);
    }
  });
});

describe("a `free` entry is priced on the card, in two taps (D49)", () => {
  it("asks for the value without opening the correction", async () => {
    await render(entry({}));

    expect(container.querySelector("#valor-7-horas")).not.toBeNull();
    expect(button("Aprovar").disabled).toBe(true);
  });

  it("approves with the typed value", async () => {
    queue.approveLogAction.mockResolvedValueOnce({
      entries: [],
      activities: [],
    });
    await render(entry({}));

    await type("#valor-7-horas", "2");
    await type("#valor-7-minutos", "30");
    expect(button("Aprovar").disabled).toBe(false);
    await click("Aprovar");

    expect(queue.approveLogAction).toHaveBeenCalledWith(7, {
      freeValue: { hours: 2, minutes: 30 },
    });
  });

  it("keeps one value field when the correction is open", async () => {
    await render(entry({}));
    await click("Corrigir");

    expect(container.querySelectorAll("#valor-7-horas")).toHaveLength(1);
  });
});

describe("a missing grade is chosen on the card (D37)", () => {
  const GRADED = entry({
    activityName: "Lição de casa do dia",
    calcMode: "delivery",
    qualityGraded: true,
    unpriceable: ["grade"],
  });

  it("approves with the chosen grade", async () => {
    queue.approveLogAction.mockResolvedValueOnce({
      entries: [],
      activities: [],
    });
    await render(GRADED);

    expect(button("Aprovar").disabled).toBe(true);
    await click("0,7");
    await click("Aprovar");

    expect(queue.approveLogAction).toHaveBeenCalledWith(7, { quality: 0.7 });
  });

  it("keeps one grade chooser when the correction is open", async () => {
    await render(GRADED);
    await click("Corrigir");

    expect(
      [...container.querySelectorAll("legend")].filter(
        (legend) => legend.textContent === "Nota",
      ),
    ).toHaveLength(1);
  });
});

describe("a priced entry is unchanged", () => {
  it("shows no sentence and approves with no edits", async () => {
    queue.approveLogAction.mockResolvedValueOnce({
      entries: [],
      activities: [],
    });
    await render(
      entry({
        activityName: "Ler livro",
        calcMode: "duration",
        durationMinutes: 60,
        durationSeconds: 3600,
        preview: { hours: 1.5, lines: [] },
        unpriceable: null,
      }),
    );

    expect(container.querySelector("#valor-7-horas")).toBeNull();
    await click("Aprovar");

    expect(queue.approveLogAction).toHaveBeenCalledWith(7, {});
  });
});

describe("a correction typed as hours and minutes (#48)", () => {
  const TIMED = entry({
    activityName: "Ler livro",
    calcMode: "duration",
    source: "timer",
    durationMinutes: 85,
    durationSeconds: 85 * 60,
    preview: { hours: 2, lines: [] },
    unpriceable: null,
  });

  beforeEach(() => {
    queue.approveLogAction.mockResolvedValue({ entries: [], activities: [] });
  });

  it("opens the duration as the hours and minutes it was", async () => {
    await render(TIMED);
    await click("Corrigir");

    expect(
      container.querySelector<HTMLInputElement>("#duracao-7-horas")?.value,
    ).toBe("1");
    expect(
      container.querySelector<HTMLInputElement>("#duracao-7-minutos")?.value,
    ).toBe("25");
  });

  it("sends a corrected 2h59 as typed", async () => {
    await render(TIMED);
    await click("Corrigir");
    await type("#duracao-7-horas", "2");
    await type("#duracao-7-minutos", "59");
    await click("Aprovar com as correções");

    expect(queue.approveLogAction).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ duration: { hours: 2, minutes: 59 } }),
    );
  });

  it("sends a final value of 0h25 as typed (D50)", async () => {
    await render(TIMED);
    await click("Corrigir");
    await type("#valor-final-7-minutos", "25");
    await click("Aprovar com as correções");

    expect(queue.approveLogAction).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ override: { hours: 0, minutes: 25 } }),
    );
  });

  it("does not offer sixty minutes in either field", async () => {
    await render(TIMED);
    await click("Corrigir");
    await type("#duracao-7-minutos", "60");

    expect(button("Aprovar com as correções").disabled).toBe(true);

    await type("#duracao-7-minutos", "25");
    await type("#valor-final-7-minutos", "60");

    expect(button("Aprovar com as correções").disabled).toBe(true);
  });
});
