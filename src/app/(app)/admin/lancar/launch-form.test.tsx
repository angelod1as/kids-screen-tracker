// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const admin = vi.hoisted(() => ({
  fetchLaunchDataAction: vi.fn(),
  previewEntryAction: vi.fn(),
  launchEntryAction: vi.fn(),
}));

vi.mock("../../../actions/admin", () => admin);

const { LaunchForm } = await import("./launch-form");
const { ZERO_TIME_TEXT } = await import("../../../../ui/hours");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () =>
    root.render(
      <LaunchForm
        data={{
          activities: [
            {
              id: 9,
              categoryId: 4,
              name: "Ajudar em casa",
              calcMode: "free",
              value: null,
              qualityGraded: false,
              repeatCooldownDays: 0,
              categoryName: "Casa",
            },
          ],
          today: "2026-09-22",
        }}
        kids={[{ id: 7, displayName: "Kid2" }]}
      />,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function previewButton(): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === "Ver quanto vale",
  );

  if (found === undefined) throw new Error("no preview button");

  return found;
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

describe("a free value typed as zero, said before the tap (#56)", () => {
  it("keeps the preview off at 0h0 and says why", async () => {
    await type("#valor-horas", "0");
    await type("#valor-minutos", "0");

    expect(previewButton().disabled).toBe(true);
    expect(container.textContent).toContain(ZERO_TIME_TEXT);

    await act(async () => previewButton().click());

    expect(admin.previewEntryAction).not.toHaveBeenCalled();
  });

  it("lets 0h01 through, with nothing to say", async () => {
    await type("#valor-horas", "0");
    await type("#valor-minutos", "1");

    expect(previewButton().disabled).toBe(false);
    expect(container.textContent).not.toContain(ZERO_TIME_TEXT);
  });

  it("keeps the preview off on blank fields without calling them zero", () => {
    expect(previewButton().disabled).toBe(true);
    expect(container.textContent).not.toContain(ZERO_TIME_TEXT);
  });
});
