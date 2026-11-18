import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { QueueEntry } from "../../db/queue";
import type { TimerScreenData } from "../actions/timer";

/** #137: every pending request says when the boy sent it, apart from its day (D13). */

vi.mock("../actions/queue", () => ({
  approveLogAction: vi.fn(),
  fetchQueueAction: vi.fn(),
  rejectLogAction: vi.fn(),
}));

vi.mock("../actions/spend-requests", () => ({
  approveSpendRequestAction: vi.fn(),
  rejectSpendRequestAction: vi.fn(),
}));

vi.mock("../actions/timer", () => ({
  fetchTimerScreenAction: vi.fn(),
  startTimerAction: vi.fn(),
  pauseTimerAction: vi.fn(),
  resumeTimerAction: vi.fn(),
  stopTimerAction: vi.fn(),
}));

const { QueueList } = await import("./admin/fila/queue-list");
const { SpendRequestList } = await import("./admin/fila/spend-request-list");
const { TimerScreen } = await import("./menino/cronometro/timer-screen");

// 23:30 on the 17th in São Paulo, already the 18th in UTC.
const SENT = new Date("2026-11-18T02:30:00Z");

const ENTRY: QueueEntry = {
  id: 7,
  userId: 3,
  kidName: "Kid1",
  activityId: 32,
  activityName: "Culto",
  categoryName: "Comunidade",
  occurredOn: "2026-11-16",
  durationMinutes: null,
  durationSeconds: null,
  note: null,
  autoStopped: false,
  source: "request",
  calcMode: "fixed",
  qualityGraded: false,
  quality: null,
  activityValue: 1,
  createdAt: SENT,
  preview: null,
  unpriceable: [],
  blockedBy: null,
};

const SCREEN: TimerScreenData = {
  userId: 3,
  activities: [],
  open: null,
  settlement: null,
  proposed: null,
  pending: [
    {
      id: 7,
      activityName: "Culto",
      occurredOn: "2026-11-16",
      durationMinutes: null,
      durationSeconds: null,
      autoStopped: false,
      createdAt: SENT,
    },
  ],
  requestable: [],
  today: "2026-11-18",
  requested: null,
};

describe("the instant a request was sent (#137)", () => {
  it("is on the adult's earn queue, beside the activity's own day", () => {
    const markup = renderToStaticMarkup(
      <QueueList initial={{ entries: [ENTRY], activities: [] }} />,
    );

    expect(markup).toContain("16/11/2026");
    expect(markup).toContain("Enviado em 17/11/2026 às 23:30");
  });

  it("is on the adult's spend requests", () => {
    const markup = renderToStaticMarkup(
      <SpendRequestList
        initial={[
          {
            id: 1,
            userId: 3,
            userName: "Kid1",
            hours: 2,
            destination: "Xbox",
            note: null,
            createdAt: SENT,
          },
        ]}
      />,
    );

    expect(markup).toContain("Enviado em 17/11/2026 às 23:30");
  });

  it("is on the boy's own waiting list", () => {
    const markup = renderToStaticMarkup(<TimerScreen initial={SCREEN} />);

    expect(markup).toContain("16/11/2026");
    expect(markup).toContain("Enviado em 17/11/2026 às 23:30");
  });
});
