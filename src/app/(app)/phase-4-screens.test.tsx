import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Session } from "../../auth/access";
import type { QueueEntry } from "../../db/queue";
import { PENDING_BG_CLASS } from "../../ui/style";
import type { TimerScreenData } from "../actions/timer";

/**
 * The two screens of Phase 4: what they ask for, what they draw, and the one
 * rule of #18 that is a property of the *source* rather than of the markup.
 *
 * The actions are replaced because their own guards have their own suites
 * (`timer.test.ts`, `queue.test.ts`); what is under test here is the id the
 * page hands over, which is a different bug — the sabotage matrix of Phase 3
 * changed `session.userId` to `session.userId + 1` in a page and 674 tests
 * stayed green.
 */

const mocked = vi.hoisted(() => ({
  session: null as Session | null,
  timerFor: [] as number[],
  timer: null as TimerScreenData | null,
  queue: { entries: [] as QueueEntry[], activities: [] },
}));

vi.mock("../../auth/guard", () => ({
  requireSession: async () => mocked.session,
}));

vi.mock("../actions/timer", () => ({
  fetchTimerScreenAction: async (userId: number) => {
    mocked.timerFor.push(userId);

    return mocked.timer;
  },
  startTimerAction: async () => mocked.timer,
  pauseTimerAction: async () => mocked.timer,
  resumeTimerAction: async () => mocked.timer,
  stopTimerAction: async () => mocked.timer,
}));

vi.mock("../actions/queue", () => ({
  fetchQueueAction: async () => mocked.queue,
  approveLogAction: async () => mocked.queue,
  rejectLogAction: async () => mocked.queue,
}));

const KidTimerPage = (await import("./menino/cronometro/page")).default;
const AdminQueuePage = (await import("./admin/fila/page")).default;

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

function screen(open: TimerScreenData["open"]): TimerScreenData {
  return {
    userId: KID1.userId,
    activities: [
      {
        id: 5,
        name: "Ler livro",
        categoryId: 2,
        categoryName: "Mente",
        maxSessionMinutes: 120,
      },
    ],
    open,
    settlement: null,
    proposed: null,
    pending: [],
  };
}

function entry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: 1,
    userId: KID1.userId,
    kidName: "Kid1",
    activityId: 5,
    activityName: "Ler livro",
    categoryName: "Mente",
    occurredOn: "2026-09-10",
    durationMinutes: 60,
    durationSeconds: 60 * 60,
    note: null,
    autoStopped: false,
    preview: { hours: 3, lines: [] },
    unpriceable: null,
    qualityGraded: false,
    quality: null,
    blockedBy: null,
    ...overrides,
  };
}

async function timerMarkup(data: TimerScreenData): Promise<string> {
  mocked.session = KID1;
  mocked.timer = data;

  return renderToStaticMarkup(await KidTimerPage());
}

async function queueMarkup(entries: QueueEntry[]): Promise<string> {
  mocked.queue = { entries, activities: [] };

  return renderToStaticMarkup(await AdminQueuePage());
}

describe("the timer asks about the boy who is logged in (#13)", () => {
  it("uses the session's own id, and nobody else's", async () => {
    for (const session of [KID1, KID2]) {
      mocked.session = session;
      mocked.timer = screen(null);
      mocked.timerFor = [];

      await KidTimerPage();

      expect(mocked.timerFor).toStrictEqual([session.userId]);
    }
  });
});

/**
 * "**Nada interrompe o menino durante a sessão** — sem confirmação periódica,
 * sem alerta, sem notificação."
 *
 * A rule about what the screen does *not* do, which no rendered markup can
 * show: an `alert` fired from a `setTimeout` is invisible to every assertion
 * about HTML. So it is checked where it can be seen, in the source, and the one
 * interval the file is allowed is named.
 */
describe("nothing interrupts the boy during a session (#18)", () => {
  const SOURCE = readFileSync(
    join(import.meta.dirname, "menino", "cronometro", "timer-screen.tsx"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  const FORBIDDEN = [
    /\balert\s*\(/,
    /\bconfirm\s*\(/,
    /\bprompt\s*\(/,
    /\bNotification\b/,
    /\bnavigator\.vibrate/,
    /\bnew Audio\b/,
    /\bsetTimeout\b/,
    /\bbeforeunload\b/,
    /\brequestAnimationFrame\b/,
  ];

  it.each(FORBIDDEN.map((pattern) => ({ label: pattern.source, pattern })))(
    "does not reach for $label",
    ({ pattern }) => {
      expect(pattern.test(SOURCE)).toBe(false);
    },
  );

  it("keeps exactly one interval, and it only redraws the digits", () => {
    const intervals = SOURCE.match(/setInterval\(/g) ?? [];

    expect(intervals).toHaveLength(1);
    expect(SOURCE).toContain(
      "setInterval(() => setWatchedMs(Date.now() - from)",
    );
    expect(SOURCE).toContain("clearInterval(clock)");
  });

  it("scans a file that is actually there", () => {
    // A scan of an empty string passes every case above.
    expect(SOURCE.length).toBeGreaterThan(2000);
  });
});

describe("what the boy sees (#18)", () => {
  it("offers the activities and a way to begin when nothing is running", async () => {
    const markup = await timerMarkup(screen(null));

    expect(markup).toContain("Ler livro");
    expect(markup).toContain("Começar");
  });

  it("shows the clock, in minutes and seconds, from the server's number", async () => {
    const markup = await timerMarkup(
      screen({
        activityId: 5,
        activityName: "Ler livro",
        categoryName: "Mente",
        status: "running",
        activeSeconds: 125,
        maxSessionMinutes: 120,
        minSessionMinutes: 5,
      }),
    );

    // 02:05, and not the browser's idea of it: the first render adds nothing.
    expect(markup).toContain("02:05");
    expect(markup).toContain("Pausar");
    expect(markup).toContain("Parar");
  });

  it("says a paused clock is not counting", async () => {
    const markup = await timerMarkup(
      screen({
        activityId: 5,
        activityName: "Ler livro",
        categoryName: "Mente",
        status: "paused",
        activeSeconds: 600,
        maxSessionMinutes: 120,
        minSessionMinutes: 5,
      }),
    );

    expect(markup).toContain("10:00");
    expect(markup).toContain("Continuar");
    expect(markup).toContain("O tempo parado não conta");
  });

  it("tells him what happened when a session ended without him", async () => {
    const markup = await timerMarkup({
      ...screen(null),
      settlement: {
        kind: "autoStopped",
        activityName: "Ler livro",
        durationMinutes: 120,
        durationSeconds: 120 * 60,
      },
    });

    expect(markup).toContain("bateu o limite");
    expect(markup).toContain("2h");
  });

  it("tells him a session that crossed midnight closed on the day it began", async () => {
    const markup = await timerMarkup({
      ...screen(null),
      settlement: {
        kind: "dayEnded",
        activityName: "Ler livro",
        durationMinutes: 30,
        durationSeconds: 30 * 60,
      },
    });

    expect(markup).toContain("virada do dia");
    expect(markup).toContain("30 min");
    expect(markup).toContain("dia em que começou");
  });

  it("says an abandoned session produced nothing", async () => {
    const markup = await timerMarkup({
      ...screen(null),
      settlement: {
        kind: "abandoned",
        activityName: "Ler livro",
        durationMinutes: null,
        durationSeconds: null,
      },
    });

    expect(markup).toContain("Nenhum registro foi criado");
  });

  it("marks his waiting entries with the pendency colour", async () => {
    const markup = await timerMarkup({
      ...screen(null),
      pending: [
        {
          id: 1,
          activityName: "Ler livro",
          occurredOn: "2026-09-10",
          durationMinutes: 60,
          durationSeconds: 60 * 60,
          autoStopped: true,
        },
      ],
    });

    expect(markup).toContain(PENDING_BG_CLASS);
    expect(markup).toContain("Pendente");
    expect(markup).toContain("parou sozinha");
  });
});

describe("what the admin sees (#20)", () => {
  it("says so plainly when there is nothing waiting", async () => {
    expect(await queueMarkup([])).toContain("Nada esperando");
  });

  it("puts approving one tap away, with no field to fill first", async () => {
    const markup = await queueMarkup([entry()]);

    expect(markup).toContain(">Aprovar<");
    // The correction and the refusal are each behind their own tap, so their
    // controls are not on screen until one is asked for.
    expect(markup).not.toContain("Duração em minutos");
    expect(markup).not.toContain("Motivo (opcional)");
  });

  it("shows who, what, when, how long, and what it would pay", async () => {
    const markup = await queueMarkup([entry()]);

    expect(markup).toContain("Kid1");
    expect(markup).toContain("Ler livro");
    expect(markup).toContain("Mente");
    expect(markup).toContain("10/09/2026");
    expect(markup).toContain("1h");
    expect(markup).toContain(">3h<");
  });

  it("counts what is waiting, in the pendency colour", async () => {
    const markup = await queueMarkup([entry(), entry({ id: 2 })]);

    expect(markup).toContain(PENDING_BG_CLASS);
    expect(markup).toContain("2 esperando");
  });

  it("says when the boy did not end the session himself", async () => {
    expect(await queueMarkup([entry({ autoStopped: true })])).toContain(
      "parou sozinha",
    );
  });

  it("names the entry that has to be decided first, and takes the tap away", async () => {
    const markup = await queueMarkup([
      entry({
        id: 2,
        blockedBy: {
          id: 1,
          activityName: "Ler livro",
          occurredOn: "2026-09-10",
        },
      }),
    ]);

    expect(markup).toContain("Aprove antes");
    expect(markup).toContain("10/09/2026");
    // Refusing stays open: a refusal credits nothing (D19) and is one of the
    // two ways to clear the way.
    expect(markup).toContain(">Recusar<");
    expect(markup).toMatch(/disabled=""[^>]*>Aprovar</);
  });
});
