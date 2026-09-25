import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { ACCENT_HEX, SURFACE_HEX } from "../ui/style";
import manifest from "./manifest";

const PUBLIC = join(__dirname, "..", "..", "public");

/** Width, height and colour type from a PNG's IHDR chunk. */
function png(file: string) {
  const bytes = readFileSync(join(PUBLIC, file));

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    hasAlpha: bytes[25] === 4 || bytes[25] === 6,
  };
}

describe("the web manifest (#95, D46)", () => {
  const served = manifest();

  it("installs as the app, standalone, from the root", () => {
    expect(served).toMatchObject({
      name: "Quanto Tempo Vale?",
      short_name: "Quanto Tempo Vale?",
      display: "standalone",
      start_url: "/",
    });
  });

  it("takes its colours from style.ts (D42)", () => {
    expect(served.theme_color).toBe(ACCENT_HEX);
    expect(served.background_color).toBe(SURFACE_HEX);
  });

  it("declares each icon at the size its file has", () => {
    for (const icon of served.icons ?? []) {
      const { width, height } = png(icon.src.replace(/^\//, ""));

      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
    }
  });

  it("offers 192 and 512 for any use, and one maskable", () => {
    const any = (served.icons ?? []).filter((icon) => icon.purpose === "any");
    const maskable = (served.icons ?? []).filter(
      (icon) => icon.purpose === "maskable",
    );

    expect(any.map((icon) => icon.sizes).sort()).toEqual([
      "192x192",
      "512x512",
    ]);
    expect(maskable.map((icon) => icon.src)).toEqual([
      "/icon-maskable-512.png",
    ]);
  });

  it("paints the maskable and the iPhone icon on a solid ground", () => {
    // iOS fills transparency with black, and Android's mask would show it.
    expect(png("icon-maskable-512.png").hasAlpha).toBe(false);
    expect(png("apple-touch-icon.png")).toEqual({
      width: 180,
      height: 180,
      hasAlpha: false,
    });
  });
});

describe("the service worker caches nothing (#95, D46)", () => {
  const source = readFileSync(join(PUBLIC, "sw.js"), "utf8");

  it("listens to no fetch, so no navigation or POST passes through it", () => {
    const listened: string[] = [];
    const self = {
      addEventListener: (type: string) => listened.push(type),
      skipWaiting: () => undefined,
      clients: { claim: () => undefined },
    };

    runInNewContext(source, { self });

    expect(listened.sort()).toEqual([
      "activate",
      "install",
      "notificationclick",
      "push",
    ]);
  });

  it("never opens the Cache API", () => {
    expect(source).not.toMatch(/\bcaches\b|\bCache\b/);
  });
});

describe("the service worker shows a push and opens its screen (D51)", () => {
  const source = readFileSync(join(PUBLIC, "sw.js"), "utf8");

  type Listener = (event: unknown) => void;

  function load(windows: unknown[]) {
    const listeners: Record<string, Listener> = {};
    const shown: { title: string; options: unknown }[] = [];
    const opened: string[] = [];
    const self = {
      addEventListener: (type: string, listener: Listener) => {
        listeners[type] = listener;
      },
      skipWaiting: () => undefined,
      location: { origin: "https://app.test" },
      registration: {
        showNotification: async (title: string, options: unknown) => {
          shown.push({ title, options });
        },
      },
      clients: {
        claim: () => undefined,
        matchAll: async () => windows,
        openWindow: async (url: string) => {
          opened.push(url);
        },
      },
    };

    runInNewContext(source, { self, URL });

    return { listeners, shown, opened };
  }

  async function dispatch(listener: Listener | undefined, event: object) {
    let waited: Promise<unknown> = Promise.resolve();
    listener?.({
      ...event,
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise;
      },
    });
    await waited;
  }

  it("shows the message with the installation icon, which is art (D46)", async () => {
    const { listeners, shown } = load([]);

    await dispatch(listeners.push, {
      data: {
        json: () => ({
          title: "Aprovado",
          body: "Ler livro: 1h",
          url: "/menino",
        }),
      },
    });

    expect(shown).toEqual([
      {
        title: "Aprovado",
        options: {
          body: "Ler livro: 1h",
          icon: "/icon-192.png",
          data: { url: "/menino" },
        },
      },
    ]);
  });

  it("still shows something for a push it cannot read", async () => {
    const { listeners, shown } = load([]);

    await dispatch(listeners.push, { data: null });

    expect(shown).toHaveLength(1);
  });

  it("opens the screen when the app is closed", async () => {
    const { listeners, opened } = load([]);

    await dispatch(listeners.notificationclick, {
      notification: { close: () => undefined, data: { url: "/admin/fila" } },
    });

    expect(opened).toEqual(["https://app.test/admin/fila"]);
  });

  it("focuses the open app and takes it to the screen", async () => {
    const navigated: string[] = [];
    const open = {
      focus: async () => open,
      navigate: async (url: string) => {
        navigated.push(url);
      },
    };
    const { listeners, opened } = load([open]);

    await dispatch(listeners.notificationclick, {
      notification: { close: () => undefined, data: { url: "/menino" } },
    });

    expect(navigated).toEqual(["https://app.test/menino"]);
    expect(opened).toEqual([]);
  });
});

describe("the root layout wires installation in (#95, D46)", () => {
  // No render test: the layout loads next/font, so its source is read instead.
  const layout = readFileSync(join(__dirname, "layout.tsx"), "utf8");
  const register = readFileSync(join(__dirname, "service-worker.tsx"), "utf8");

  it("mounts the service worker registration", () => {
    expect(layout).toContain("<ServiceWorker />");
    expect(register).toContain('register("/sw.js")');
  });

  it("points every icon it declares at a file in public/", () => {
    const icons = [...layout.matchAll(/"\/([\w-]+\.png)"/g)].map(
      (match) => match[1] ?? "",
    );

    expect(icons.sort()).toEqual(["apple-touch-icon.png", "icon-192.png"]);
    for (const icon of icons) {
      expect(existsSync(join(PUBLIC, icon)), icon).toBe(true);
    }
  });
});
