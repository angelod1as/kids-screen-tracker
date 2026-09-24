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
 * The design rules of #14, as checks over the source.
 *
 * Three of the four criteria are properties of the whole tree rather than of
 * any one component — "nenhuma animação", "todo alvo de toque com no mínimo
 * 48px", "nada de cinza sobre cinza" — and a rule of that shape is kept by
 * being enforced, not by being remembered. What follows is what stops the
 * fifth screen, written in three months, from being the one with the grey
 * placeholder text and the 32 px icon button.
 *
 * There is no DOM here and nothing is rendered: that needs a renderer and a
 * jsdom environment this project does not have, and adding both to assert a
 * class name would be a lot of machinery for a weaker check. Scanning the
 * source catches the mistakes that are actually made — a shaded grey typed
 * by habit, a raw `<button>` that skipped the primitive.
 *
 * What it checks is the *source*, and the distinction cost a review round.
 * Tailwind's extractor reads every file it scans as plain text, comments
 * included: three sentences of prose that each named the utility they forbade
 * — one here, one in `style.ts`, one in `button.tsx` — put those exact rules
 * into the production stylesheet. Nothing referenced them and nothing was grey
 * on screen, but "the stylesheet has no such rule" was a claim no check had
 * made. `scripts/check-served-css.sh` makes it, against the built CSS, after
 * `pnpm build` — the only moment that question can be answered.
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
   * Every way an animation can be asked for from this codebase: the Tailwind
   * utilities, and raw CSS.
   *
   * The list has no allowlist behind it, because the app currently animates
   * nothing at all — the login button's pending state is a word and a disabled
   * control, not a spinner. The design rules do permit a spinner "onde há
   * espera real"; when one is genuinely needed, the exception is added here,
   * named, in a diff.
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
 * The palette, declared: every shaded colour the app is allowed to serve, the
 * one file allowed to write it, and the job it does.
 *
 * This list replaces the "black and white, plus three exceptions" rule of #14,
 * by the owner's decision on #74 ("falta cor", "queria que parecesse mais um
 * app"). **What it does not replace is the guard.** The check below still fails
 * on any shaded colour written anywhere in `src/` that is not on this list, and
 * still fails on anything dimmed with opacity. Adding a colour is still a diff
 * a reviewer reads.
 *
 * `meaning` is the half CLAUDE.md governs, and #83 took it from three to two —
 * a pendency and a negative balance. The alert of a regime with no balance went
 * with the screen that recorded the regimes (D41). The test below asserts the
 * count, so the freedom to paint the chrome cannot be used to smuggle a third
 * thing that colour is allowed to *mean*.
 *
 * `chrome` is the app's own furniture: a band, the top of the app, the ground a
 * panel sits on. It says nothing about the data, which is exactly why it is
 * blue and the meanings are red and yellow — far apart on the wheel, so the one
 * warm thing on a screen is always something to act on.
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
    // CLAUDE.md's rule, as #83 left it. The chrome may grow with the design;
    // this may not, because a third *meaning* is a third thing a reader has to
    // learn to see.
    expect(
      PALETTE.filter((entry) => entry.kind === "meaning")
        .map((entry) => entry.rule)
        .sort(),
    ).toEqual(["a negative balance", "a pendency"]);
  });

  it("gives each job a utility of its own", () => {
    // The check nobody can perform by reading the stylesheet, and the reason
    // the pendency is yellow rather than the red of a negative balance. Both
    // colour guards — this file and `scripts/check-served-css.sh` — match
    // *utilities*. A rule wearing another rule's utility passes both while
    // carrying colour in a place neither of them can name.
    const utilities = PALETTE.map((entry) => entry.utility);

    expect(new Set(utilities).size).toBe(utilities.length);
  });

  it("keeps the two halves apart on the wheel", () => {
    // Not a taste check. If the chrome were warm, a screen of chrome would be a
    // screen where the pendency and the negative balance have to compete to be
    // the warm thing, and the whole argument for spending colour on exactly
    // two meanings collapses.
    const hue = (utility: string) => utility.replace(/^[a-z]+-|-\d+$/g, "");

    for (const entry of PALETTE.filter((item) => item.kind === "chrome")) {
      expect(
        ["red", "yellow", "orange", "amber", "rose"],
        entry.rule,
      ).not.toContain(hue(entry.utility));
    }
  });

  it("serves no colour that is not on the list", () => {
    // Tailwind's palette colours all carry a numeric shade — `gray-500`,
    // `slate-700`, `red-600`. `black` and `white` do not. So one pattern finds
    // every colour in the tree, and whatever is left after the declared ones
    // are struck out is a colour that arrived without being declared.
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
 * Every pair of ink and ground the app sets text in, and the ratio
 * `docs/design.md` writes down for it (D42).
 *
 * The ratio is computed, not copied: Tailwind 4 declares its palette in
 * `oklch()` in the `theme.css` it ships, and the test converts the installed
 * value to sRGB and applies the WCAG 2 formula. An upgrade that moves a shade
 * fails here instead of quietly making the number in the document false.
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
    // Why the red is ink on white and never on a band or a black ground.
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
    // The compile-time half of this lives in `components.test.tsx`; this is
    // the one that says which prop and why, next to the other design rules.
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

  /**
   * Anything a finger is meant to hit. `<form>` and `<div>` are not on the
   * list; `<a>` and `<Link>` are, and so is every form control.
   */
  const INTERACTIVE = /<(?:button|input|select|textarea|a|Link)\b[^>]*>/g;

  it("has no raw interactive element outside the primitives", () => {
    // The rule that makes the check above worth anything: a screen cannot
    // reach for a bare `<button>`, so it cannot forget the minimum. The four
    // primitives that do use one are in `src/ui/`, and the case below holds
    // each of them to the class.
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

    // The button, the input, and the nav link.
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
    // The authenticated frame and the login screen, which sits outside it.
    for (const file of ["ui/app-shell.tsx", "app/entrar/page.tsx"]) {
      const source = readFileSync(join(SRC, file), "utf8");

      expect(source).toContain("SHELL_CLASS");
    }
  });
});

describe("the bar is pinned, and covers nothing (#70)", () => {
  it("reserves exactly the height the bar occupies, plus the iPhone inset", () => {
    // Two numbers that have to agree and live in different declarations: the
    // class is a literal because Tailwind's extractor reads source as text and
    // never sees a class name built by a template string.
    //
    // #70 could write the height as one touch target plus the rule, because
    // every cell was a label inside a 48 px minimum. #74 put a glyph above each
    // label, so the cell is taller than the minimum it guarantees and the sum
    // is spelled out instead: 24 for the glyph, 4 for the gap, 30 for two lines
    // of a wrapped label, 16 for `py-2`, 2 for the rule. It has to stay at or
    // above the target, which is the half of the old assertion that still
    // means something.
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
    // The strip that wrote the name and a large "Sair" on every screen.
    const shell = readFileSync(join(SRC, "ui", "app-shell.tsx"), "utf8");

    expect(stripComments(shell)).not.toContain("<header");
  });
});

describe("the interface is in Brazilian Portuguese (#14)", () => {
  it("declares the language on every document, not just the root layout", () => {
    // `global-error.tsx` replaces the root layout outright, so the attribute
    // set there does not reach it. Reading only `app/layout.tsx` was how the
    // English 404 went unnoticed.
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
    // Without these files Next serves its own, in English, and #14 asks for
    // the whole interface in pt-BR. What they say is checked in
    // `app/error-screens.test.tsx`; that they exist at all is checked here,
    // next to the rest of the design rules.
    for (const file of ["not-found.tsx", "error.tsx", "global-error.tsx"]) {
      expect(existsSync(join(SRC, "app", file)), `src/app/${file}`).toBe(true);
    }
  });

  it("pins the light colour scheme, so native controls stay black on white", () => {
    // A dark-mode phone paints password inputs, autofill and scrollbars from
    // the OS palette otherwise — grey on white, on the one screen everybody
    // sees first.
    const layout = readFileSync(join(SRC, "app", "layout.tsx"), "utf8");

    expect(layout).toContain('colorScheme: "light"');
  });
});
