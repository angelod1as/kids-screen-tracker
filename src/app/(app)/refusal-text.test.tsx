// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityRow } from "../../db/activities";
import type { CategoryRow } from "../../db/categories";
import type { QueueEntry } from "../../db/queue";
import { REFUSED_TEXT, RESYNCED_TEXT } from "../../ui/failure";
import type { QueueData } from "../actions/queue";

/**
 * #7: a D32 or D37 refusal arrives as `{ refused }`, because a thrown one reaches
 * a production browser only as a digest. The screen says it as written.
 */

const queue = vi.hoisted(() => ({
  fetchQueueAction: vi.fn(),
  countPendingLogsAction: vi.fn(),
  approveLogAction: vi.fn(),
  rejectLogAction: vi.fn(),
}));

const admin = vi.hoisted(() => ({
  fetchLaunchDataAction: vi.fn(),
  previewEntryAction: vi.fn(),
  launchEntryAction: vi.fn(),
}));

const config = vi.hoisted(() => ({
  fetchCategoriesAction: vi.fn(),
  createCategoryAction: vi.fn(),
  updateCategoryAction: vi.fn(),
  setCategoryActiveAction: vi.fn(),
  fetchActivitiesAction: vi.fn(),
  fetchLocksAction: vi.fn(),
  createActivityAction: vi.fn(),
  updateActivityAction: vi.fn(),
  setActivityActiveAction: vi.fn(),
}));

vi.mock("../actions/queue", () => queue);
vi.mock("../actions/admin", () => admin);
vi.mock("../actions/config", () => config);

const { QueueList } = await import("./admin/fila/queue-list");
const { LaunchForm } = await import("./admin/lancar/launch-form");
const { CategoryList } = await import("./admin/configuracao/category-list");
const { ActivityList } = await import("./admin/configuracao/activity-list");

const D32 =
  "Não dá para aprovar a entrada 2 ainda: a entrada 1 (Ler livro, 2026-09-01) vem antes dela e está esperando na fila. Decida essa primeiro.";

const D37 =
  "Mente: não dá para mudar taxa, modo, nota, cooldown ou categoria agora, porque a entrada 1 (Ler livro, 2026-09-01) está esperando na fila e seria paga pelo valor novo. Decida essa primeiro.";

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

async function render(node: React.ReactNode) {
  await act(async () => root.render(node));
}

async function click(name: string) {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );

  if (found === undefined) throw new Error(`no button named ${name}`);

  await act(async () => found.click());
}

function expectOnlyTheSentence(sentence: string) {
  expect(container.textContent).toContain(sentence);
  expect(container.textContent).not.toContain(REFUSED_TEXT);
  expect(container.textContent).not.toContain(RESYNCED_TEXT);
}

describe("the queue says D32's refusal as the server wrote it", () => {
  function entry(id: number): QueueEntry {
    return {
      id,
      userId: 3,
      kidName: "Kid1",
      activityId: 5,
      activityName: `Atividade ${id}`,
      categoryName: "Mente",
      occurredOn: "2026-09-01",
      durationMinutes: 60,
      note: null,
      autoStopped: false,
      qualityGraded: false,
      quality: null,
      preview: null,
      unpriceable: "teste",
      blockedBy: null,
    } as QueueEntry;
  }

  const DATA: QueueData = { entries: [entry(2)], activities: [] };

  it("shows the sentence and reads the queue again", async () => {
    await render(<QueueList initial={DATA} />);

    queue.approveLogAction.mockResolvedValueOnce({ refused: D32 });
    queue.fetchQueueAction.mockResolvedValueOnce(DATA);
    await click("Aprovar");

    expectOnlyTheSentence(D32);
    expect(queue.fetchQueueAction).toHaveBeenCalledTimes(1);
  });

  it("keeps the sentence when the re-read fails", async () => {
    await render(<QueueList initial={DATA} />);

    queue.approveLogAction.mockResolvedValueOnce({ refused: D32 });
    queue.fetchQueueAction.mockRejectedValueOnce(new TypeError("offline"));
    await click("Aprovar");

    expectOnlyTheSentence(D32);
  });
});

describe("the launch form says D32's refusal as the server wrote it", () => {
  it("shows the sentence when the queue moved between preview and tap", async () => {
    const launchD32 =
      "Não dá para lançar esta entrada ainda: a entrada 1 (Ler livro, 2026-09-01) vem antes dela e está esperando na fila. Decida essa primeiro.";

    await render(
      <LaunchForm
        data={{
          activities: [
            {
              id: 5,
              categoryId: 2,
              name: "Ler livro",
              calcMode: "duration",
              value: 2,
              qualityGraded: false,
              repeatCooldownDays: 0,
              categoryName: "Mente",
            },
          ],
          today: "2026-09-01",
        }}
        kids={[{ id: 3, displayName: "Kid1" }]}
      />,
    );

    admin.previewEntryAction.mockResolvedValueOnce({
      calculation: { hours: 1.5, lines: [] },
      blockedBy: null,
    });
    await click("Ver quanto vale");

    admin.launchEntryAction.mockResolvedValueOnce({ refused: launchD32 });
    await click("Confirmar lançamento");

    expectOnlyTheSentence(launchD32);
  });
});

describe("Configuration says D37's refusal as the server wrote it", () => {
  const MENTE: CategoryRow = {
    id: 2,
    name: "Mente",
    baseRate: 2,
    decayStepHours: 1,
    returnBonusPct: 0.5,
    returnBonusAfterDays: 3,
    sortOrder: 2,
    active: true,
    activityCount: 7,
  };

  const LOCKS = { activityIds: [5], categoryIds: [2], queued: 1, running: 0 };

  it("shows the sentence when switching off a category is refused", async () => {
    await render(<CategoryList initial={[MENTE]} initialLocks={LOCKS} />);

    config.setCategoryActiveAction.mockResolvedValueOnce({ refused: D37 });
    config.fetchLocksAction.mockResolvedValueOnce(LOCKS);
    await click("Desativar");

    expectOnlyTheSentence(D37);
    expect(container.textContent).toContain("Mente");
    expect(container.textContent).not.toContain("desativada");
  });

  it("shows the sentence when switching off an activity is refused", async () => {
    const book: ActivityRow = {
      id: 5,
      categoryId: 2,
      name: "Ler livro",
      calcMode: "duration",
      value: 2,
      maxSessionMinutes: 120,
      minSessionMinutes: 5,
      qualityGraded: false,
      repeatCooldownDays: 0,
      sortOrder: 1,
      active: true,
    };
    const onChanged = vi.fn();
    const activityD37 = D37.replace("Mente:", "Ler livro:");

    await render(
      <ActivityList
        categories={[MENTE]}
        category={MENTE}
        initial={[book]}
        locks={LOCKS}
        onChanged={onChanged}
      />,
    );

    config.setActivityActiveAction.mockResolvedValueOnce({
      refused: activityD37,
    });
    await click("Desativar");

    expectOnlyTheSentence(activityD37);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
