import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { TimerScreenData } from "../actions/timer";

/** The lists #29's sweep found drawing nothing; the others are covered where they were written. */

const mocked = vi.hoisted(() => ({
  kids: [] as { id: number; displayName: string }[],
}));

vi.mock("../actions/people", () => ({
  listKidsAction: async () => mocked.kids,
}));

vi.mock("../actions/balance", () => ({
  fetchBalanceAction: async () => 0,
}));

vi.mock("../actions/queue", () => ({
  fetchQueueAction: async () => ({ entries: [], activities: [] }),
  countPendingLogsAction: async () => 0,
  approveLogAction: async () => null,
  rejectLogAction: async () => null,
}));

vi.mock("../actions/timer", () => ({
  fetchTimerScreenAction: async () => null,
  startTimerAction: async () => null,
  pauseTimerAction: async () => null,
  resumeTimerAction: async () => null,
  stopTimerAction: async () => null,
}));

vi.mock("../actions/config", () => ({
  fetchCategoriesAction: async () => [],
  fetchLocksAction: async () => null,
  fetchActivitiesAction: async () => [],
  createCategoryAction: async () => [],
  updateCategoryAction: async () => [],
  setCategoryActiveAction: async () => [],
  createActivityAction: async () => [],
  updateActivityAction: async () => [],
  setActivityActiveAction: async () => [],
}));

const AdminHomePage = (await import("./admin/page")).default;
const { TimerScreen } = await import("./menino/cronometro/timer-screen");
const { QueueList } = await import("./admin/fila/queue-list");
const { CategoryList } = await import("./admin/configuracao/category-list");

const NO_TIMER: TimerScreenData = {
  userId: 3,
  activities: [],
  open: null,
  settlement: null,
  proposed: null,
  pending: [],
};

describe("empty states (#29)", () => {
  it("says so when the boy has nothing waiting for approval", () => {
    const drawn = renderToStaticMarkup(<TimerScreen initial={NO_TIMER} />);

    expect(drawn).toContain("Esperando aprovação");
    expect(drawn).toContain("Nada esperando.");
  });

  it("says so when the admin home has no boy to show", async () => {
    mocked.kids = [];

    const drawn = renderToStaticMarkup(await AdminHomePage());

    expect(drawn).toContain("Nenhum menino cadastrado.");
  });

  it("says so when the queue is empty", () => {
    const drawn = renderToStaticMarkup(
      <QueueList initial={{ entries: [], activities: [] }} />,
    );

    expect(drawn).toContain("Nada esperando.");
  });

  it("says so when there is no category", () => {
    const drawn = renderToStaticMarkup(
      <CategoryList
        initial={[]}
        initialLocks={{
          activityIds: [],
          categoryIds: [],
          queued: 0,
          running: 0,
        }}
      />,
    );

    expect(drawn).toContain("Nenhuma categoria ainda.");
  });
});
