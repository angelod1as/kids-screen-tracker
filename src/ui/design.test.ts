import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCENT_BG_CLASS,
  ACCENT_HEX,
  BORDER_PX,
  CONTENT_BOTTOM_CLASS,
  CONTROL_RADIUS_CLASS,
  NAV_BAR_PX,
  NAV_SAFE_BOTTOM_CLASS,
  NEGATIVE_CLASS,
  PANEL_RADIUS_CLASS,
  PENDING_BG_CLASS,
  SHELL_CLASS,
  SURFACE_BG_CLASS,
  SURFACE_HEX,
  TOUCH_TARGET_CLASS,
  TOUCH_TARGET_PX,
} from "./style";

/**
 * The design rules (#14, D42) as checks over the source. The source only:
 * Tailwind reads comments too, so the built stylesheet is checked separately by
 * `scripts/check-served-css.sh`.
 */

const SRC = join(import.meta.dirname, "..");

/** Everything under `src/`, minus the tests, which describe rather than render. */
function sourceFiles(extensions: RegExp): { path: string; source: string }[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        extensions.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name),
    )
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);

      return { path, source: readFileSync(path, "utf8") };
    });
}

/** Comments are prose. A comment that says "no fade" is not a fade. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function relative(path: string): string {
  return path.slice(SRC.length + 1);
}

describe("no decorative animation (#14)", () => {
  /**
   * No allowlist: the app animates nothing. A spinner "onde há espera real" is
   * added here, named, in a diff.
   */
  const FORBIDDEN = [
    /\btransition\b/,
    /\banimate-[a-z]/,
    /\banimation\b/,
    /@keyframes/,
    /\bduration-\d/,
    /\bease-(in|out|linear)/,
    /\bmotion-safe:/,
  ];

  it.each(FORBIDDEN.map((pattern) => ({ label: pattern.source, pattern })))(
    "nothing under src/ matches $label",
    ({ pattern }) => {
      const offenders = sourceFiles(/\.(tsx?|css)$/)
        .filter(({ source }) => pattern.test(stripComments(source)))
        .map(({ path }) => relative(path));

      expect(offenders).toEqual([]);
    },
  );

  it("scans a tree that actually has files in it", () => {
    // A scan of nothing passes every case above.
    expect(sourceFiles(/\.(tsx?|css)$/).length).toBeGreaterThan(15);
  });
});

/**
 * Every shaded colour the app may serve, and the file allowed to write it (D42).
 * `meaning` is CLAUDE.md's two; `chrome` is furniture and says nothing.
 */
const PALETTE = [
  {
    utility: NEGATIVE_CLASS,
    file: join("ui", "style.ts"),
    kind: "meaning",
    rule: "a negative balance",
  },
  {
    utility: PENDING_BG_CLASS,
    file: join("ui", "style.ts"),
    kind: "meaning",
    rule: "a pendency",
  },
  {
    utility: ACCENT_BG_CLASS,
    file: join("ui", "style.ts"),
    kind: "chrome",
    rule: "a panel band, a primary control, the current menu item",
  },
  {
    utility: SURFACE_BG_CLASS,
    file: join("ui", "style.ts"),
    kind: "chrome",
    rule: "the ground a panel sits on",
  },
];

/** Removes the palette a file is allowed to write, and only from that file. */
function withoutPalette(source: string, file: string): string {
  return PALETTE.filter((entry) => entry.file === file).reduce(
    (text, entry) => text.replaceAll(entry.utility, ""),
    source,
  );
}

describe("the palette is declared, and nothing else is served (#14, #74, D42)", () => {
  it("keeps every colour named, and used", () => {
    // A colour nobody uses is a colour nobody removed.
    for (const entry of PALETTE) {
      const source = readFileSync(join(SRC, entry.file), "utf8");

      expect(source, entry.rule).toContain(entry.utility);
    }
  });

  it("still lets colour mean exactly two things", () => {
    // A third meaning is a third thing a reader has to learn to see.
    expect(
      PALETTE.filter((entry) => entry.kind === "meaning")
        .map((entry) => entry.rule)
        .sort(),
    ).toEqual(["a negative balance", "a pendency"]);
  });

  it("gives each job a utility of its own", () => {
    // Both colour guards match utilities, so a rule wearing another's utility
    // would carry colour where neither can name it.
    const utilities = PALETTE.map((entry) => entry.utility);

    expect(new Set(utilities).size).toBe(utilities.length);
  });

  it("keeps the two halves apart on the wheel", () => {
    // Warm chrome would make the two meanings compete to be the warm thing.
    const hue = (utility: string) => utility.replace(/^[a-z]+-|-\d+$/g, "");

    for (const entry of PALETTE.filter((item) => item.kind === "chrome")) {
      expect(
        ["red", "yellow", "orange", "amber", "rose"],
        entry.rule,
      ).not.toContain(hue(entry.utility));
    }
  });

  it("serves no colour that is not on the list", () => {
    // Every Tailwind palette colour carries a numeric shade; black and white do not.
    const shaded =
      /\b(?:text|bg|border|ring|outline|decoration|divide|from|via|to|fill|stroke|accent|caret|shadow)-[a-z]+-\d{2,3}\b/;

    const offenders = sourceFiles(/\.(tsx?|css)$/)
      .filter(({ path, source }) =>
        shaded.test(withoutPalette(stripComments(source), relative(path))),
      )
      .map(({ path }) => relative(path));

    expect(offenders).toEqual([]);
  });

  it("dims nothing with opacity", () => {
    // The other way to arrive at grey on white without ever typing "gray".
    const dimmed =
      /\b(?:opacity-\d|text-black\/\d|text-white\/\d|bg-black\/\d|bg-white\/\d)/;

    const offenders = sourceFiles(/\.(tsx?|css)$/)
      .filter(({ source }) => dimmed.test(stripComments(source)))
      .map(({ path }) => relative(path));

    expect(offenders).toEqual([]);
  });
});

/**
 * Computed from the installed `theme.css`, not copied, so an upgrade that moves a
 * shade fails here instead of making `docs/design.md` false.
 */
const TEXT_PAIRS = [
  { ink: "white", ground: ACCENT_BG_CLASS, ratio: 8.82 },
  { ink: "black", ground: SURFACE_BG_CLASS, ratio: 19.17 },
  { ink: "black", ground: PENDING_BG_CLASS, ratio: 15.83 },
  { ink: NEGATIVE_CLASS, ground: "white", ratio: 6.42 },
];

/** The sRGB channels, 0 to 1, of a palette utility or of black and white. */
function srgb(utility: string): number[] {
  const name = utility.replace(/^(?:text|bg)-/, "");

  if (name === "black") return [0, 0, 0];
  if (name === "white") return [1, 1, 1];

  const theme = readFileSync(
    join(SRC, "..", "node_modules", "tailwindcss", "theme.css"),
    "utf8",
  );
  const match = theme.match(
    new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`),
  );

  if (match === null) throw new Error(`no oklch() for ${name} in theme.css`);

  const L = Number(match[1]) / 100;
  const chroma = Number(match[2]);
  const hue = Number(match[3]);
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  // Clipped to the gamut and rounded to a byte, which is what gets painted.
  return linear.map((channel) => {
    const clipped = Math.min(1, Math.max(0, channel));
    const encoded =
      clipped <= 0.0031308
        ? 12.92 * clipped
        : 1.055 * clipped ** (1 / 2.4) - 0.055;

    return Math.round(encoded * 255) / 255;
  });
}

function luminance(utility: string): number {
  const weights = [0.2126, 0.7152, 0.0722];

  return srgb(utility).reduce(
    (sum, channel, index) =>
      sum +
      (weights[index] ?? 0) *
        (channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4),
    0,
  );
}

function contrast(ink: string, ground: string): number {
  const ours = [luminance(ink), luminance(ground)];

  return (Math.max(...ours) + 0.05) / (Math.min(...ours) + 0.05);
}

describe("every text pair is high contrast, and measured (D42)", () => {
  it.each(TEXT_PAIRS)(
    "$ink on $ground measures $ratio:1",
    ({ ink, ground, ratio }) => {
      const measured = contrast(ink, ground);

      expect(measured).toBeGreaterThanOrEqual(4.5);
      expect(measured.toFixed(2)).toBe(ratio.toFixed(2));
    },
  );

  it("measures every colour on the palette in at least one pair", () => {
    // A colour with no pair here is a colour whose contrast nobody measured.
    const measured = TEXT_PAIRS.flatMap(({ ink, ground }) => [ink, ground]);

    for (const entry of PALETTE) {
      expect(measured, entry.rule).toContain(entry.utility);
    }
  });

  it("writes each ratio down in the design document", () => {
    const doc = readFileSync(join(SRC, "..", "docs", "design.md"), "utf8");

    for (const { ratio } of TEXT_PAIRS) {
      expect(doc).toContain(`${ratio.toFixed(2).replace(".", ",")}:1`);
    }
  });

  it("keeps the negative red off black, where it would fail", () => {
    expect(contrast(NEGATIVE_CLASS, "black")).toBeLessThan(4.5);
  });

  it.each([
    { utility: ACCENT_BG_CLASS, hex: ACCENT_HEX },
    { utility: SURFACE_BG_CLASS, hex: SURFACE_HEX },
  ])("writes $utility as $hex for the manifest (#95)", ({ utility, hex }) => {
    const bytes = srgb(utility).map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    );

    expect(`#${bytes.join("")}`).toBe(hex);
  });
});

describe("two radii, and icons only in the bar (D42)", () => {
  it("rounds a panel at 12 px and a control at 8 px", () => {
    expect(PANEL_RADIUS_CLASS).toContain("rounded-xl");
    expect(CONTROL_RADIUS_CLASS).toBe("rounded-lg");
  });

  it("draws glyphs only in the navigation", () => {
    const importers = sourceFiles(/\.tsx?$/)
      .filter(({ source }) =>
        /from\s+"[./]*(?:ui\/)?icons"/.test(stripComments(source)),
      )
      .map(({ path }) => relative(path));

    expect(importers).toEqual([join("ui", "nav.tsx")]);
  });

  it("uses no emoji anywhere in the interface", () => {
    const offenders = sourceFiles(/\.tsx$/)
      .filter(({ source }) => /\p{Extended_Pictographic}/u.test(source))
      .map(({ path }) => relative(path));

    expect(offenders).toEqual([]);
  });
});

describe("labels, not placeholders (#14)", () => {
  it("keeps `placeholder` out of the Field type", () => {
    const field = readFileSync(join(SRC, "ui", "field.tsx"), "utf8");

    expect(field).toContain('"placeholder"');
    expect(field).toMatch(/Omit<[\s\S]*?"placeholder"[\s\S]*?>/);
  });

  it("overrides the half-opacity placeholder the preflight serves", () => {
    // Tailwind's reset paints `::placeholder` with `color-mix(... 50%,
    // transparent)`, which is grey on white however black the page is.
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");

    expect(css).toMatch(/::placeholder\s*\{[^}]*color:\s*black/);
    expect(css).toMatch(/::placeholder\s*\{[^}]*opacity:\s*1/);
  });
});

describe("every touch target is at least 48 px (#14)", () => {
  it("says 48 px in so many characters", () => {
    expect(TOUCH_TARGET_PX).toBe(48);
    expect(TOUCH_TARGET_CLASS).toContain("min-h-[48px]");
    expect(TOUCH_TARGET_CLASS).toContain("min-w-[48px]");
  });

  const INTERACTIVE = /<(?:button|input|select|textarea|a|Link)\b[^>]*>/g;

  it("has no raw interactive element outside the primitives", () => {
    // A screen cannot reach for a bare `<button>`, so it cannot forget the minimum.
    const offenders = sourceFiles(/\.tsx$/)
      .filter(({ path }) => !relative(path).startsWith("ui/"))
      .flatMap(({ path, source }) =>
        (stripComments(source).match(INTERACTIVE) ?? []).map(
          (tag) => `${relative(path)}: ${tag}`,
        ),
      );

    expect(offenders).toEqual([]);
  });

  it("gives the class to every interactive element in the primitives", () => {
    const offenders = sourceFiles(/\.tsx$/)
      .filter(({ path }) => relative(path).startsWith("ui/"))
      .flatMap(({ path, source }) =>
        (stripComments(source).match(INTERACTIVE) ?? [])
          .filter((tag) => !tag.includes("TOUCH_TARGET_CLASS"))
          .map((tag) => `${relative(path)}: ${tag}`),
      );

    expect(offenders).toEqual([]);
  });

  it("finds interactive elements to check, so the two cases above mean something", () => {
    const found = sourceFiles(/\.tsx$/).flatMap(
      ({ source }) => stripComments(source).match(INTERACTIVE) ?? [],
    );

    expect(found.length).toBeGreaterThanOrEqual(3);
  });
});

describe("desktop is the same base, opened wide (#74, D42)", () => {
  it("caps the column at a phone, and at a desk", () => {
    expect(SHELL_CLASS).toContain("mx-auto");
    expect(SHELL_CLASS).toContain("max-w-md");
    expect(SHELL_CLASS).toContain("lg:max-w-4xl");
  });

  it("is what both shells use", () => {
    for (const file of ["ui/app-shell.tsx", "app/entrar/page.tsx"]) {
      const source = readFileSync(join(SRC, file), "utf8");

      expect(source).toContain("SHELL_CLASS");
    }
  });
});

describe("the bar is pinned, and covers nothing (#70)", () => {
  it("reserves exactly the height the bar occupies, plus the iPhone inset", () => {
    // The class is a literal for Tailwind's extractor; the sum is in docs/design.md.
    expect(NAV_BAR_PX).toBe(24 + 4 + 30 + 16 + BORDER_PX);
    expect(NAV_BAR_PX).toBeGreaterThanOrEqual(TOUCH_TARGET_PX + BORDER_PX);
    expect(CONTENT_BOTTOM_CLASS).toBe(
      `pb-[calc(${NAV_BAR_PX}px_+_env(safe-area-inset-bottom))]`,
    );
    expect(NAV_SAFE_BOTTOM_CLASS).toBe("pb-[env(safe-area-inset-bottom)]");
  });

  it("pins the bar and pads the column with the same inset", () => {
    const shell = readFileSync(join(SRC, "ui", "app-shell.tsx"), "utf8");
    const nav = readFileSync(join(SRC, "ui", "nav.tsx"), "utf8");

    expect(shell).toContain("fixed");
    expect(shell).toContain("bottom-0");
    expect(shell).toContain("CONTENT_BOTTOM_CLASS");
    expect(nav).toContain("NAV_SAFE_BOTTOM_CLASS");
  });

  it("has no bar above the page any more", () => {
    const shell = readFileSync(join(SRC, "ui", "app-shell.tsx"), "utf8");

    expect(stripComments(shell)).not.toContain("<header");
  });
});

describe("the interface is in Brazilian Portuguese (#14)", () => {
  it("declares the language on every document, not just the root layout", () => {
    // `global-error.tsx` replaces the root layout, so its `lang` does not reach
    // it: reading only `app/layout.tsx` is how the English 404 went unnoticed.
    const documents = sourceFiles(/\.tsx$/).filter(({ source }) =>
      /<html\b/.test(stripComments(source)),
    );

    expect(documents.map(({ path }) => relative(path)).sort()).toEqual([
      join("app", "global-error.tsx"),
      join("app", "layout.tsx"),
    ]);

    for (const { source } of documents) {
      expect(source).toContain('lang="pt-BR"');
    }
  });

  it("has a Portuguese screen for a wrong address and for a crash", () => {
    // Without these, Next serves its own screens in English.
    for (const file of ["not-found.tsx", "error.tsx", "global-error.tsx"]) {
      expect(existsSync(join(SRC, "app", file)), `src/app/${file}`).toBe(true);
    }
  });

  it("pins the light colour scheme, so native controls stay black on white", () => {
    // Otherwise a dark-mode phone paints native controls grey on white.
    const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");

    expect(layout).toContain('colorScheme: "light"');
  });
});
