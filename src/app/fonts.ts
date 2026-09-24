import localFont from "next/font/local";

/**
 * The two typefaces of the instrument-panel direction (#74), self-hosted.
 *
 * **Self-hosted and not `next/font/google`.** A Google font is downloaded at
 * build time, so a build host that cannot reach `fonts.googleapis.com` fails
 * the build outright — and the build this project cares about runs inside the
 * Docker image, on somebody else's machine. The files below are the `latin`
 * subsets Google itself serves, committed next to the code: 55 kB for all four,
 * no network at build, no third-party request at runtime, and the same bytes
 * every time.
 *
 * `LICENSE.txt` beside them is the SIL Open Font License 1.1, which is what
 * allows the files to be redistributed this way.
 *
 * **Two families, because the app has two kinds of text.** IBM Plex Sans sets
 * the words; IBM Plex Mono sets every number. The split is the whole point of
 * the direction: on an instrument the readings line up in a column and the
 * labels do not, and a monospaced digit is the only way a balance that changes
 * from `9h30` to `17h13` stays in the same place on the screen.
 *
 * **Two weights each, 400 and 700.** The design has exactly two voices — a
 * thing and its label — and a third weight is a shade of emphasis, which is
 * the same argument `style.ts` makes against a third grey.
 *
 * The `latin` subset covers Portuguese (`ã`, `õ`, `ç`, `é`) and, deliberately,
 * `U+2212` — the true minus sign `formatHours` writes in front of a negative
 * balance. A subset without it would fall back to the system font for that one
 * glyph, on the one number the rule about colour exists to protect.
 */

export const plexSans = localFont({
  src: [
    { path: "./fonts/plex-sans-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/plex-sans-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex-sans",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const plexMono = localFont({
  src: [
    { path: "./fonts/plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/plex-mono-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
});
