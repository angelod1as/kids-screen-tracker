/**
 * The eight glyphs the bottom bar draws, and the only pictures in the app.
 *
 * **Drawn here, not imported, and never an emoji.** CLAUDE.md rules emoji out
 * as icons, and it is right to: an emoji is a font the OS picks, so it arrives
 * coloured, differently shaped on Android and iOS, and at a size nobody
 * controls. These are eight inline paths on a 24-unit grid — same weight, same
 * terminals, same optical size, and `currentColor` so a glyph is whatever ink
 * the cell it sits in already uses. That is what makes the current tab work:
 * the label and the glyph invert together, because neither names a colour.
 *
 * There is no icon package. Eight paths do not justify a dependency, a build
 * step or 40 kB of tree-shaken sprite, and a set drawn to one brief is more
 * consistent than a set assembled from one.
 *
 * **Keyed by route, not carried on the nav item.** `navigation.ts` is pure data
 * that `navigation.test.ts` asserts the exact shape of, and a route's picture
 * is a rendering concern rather than part of what the menu *is*. A route with
 * no glyph here renders its label alone rather than breaking, which is the
 * right failure for a menu.
 *
 * Every glyph is `aria-hidden`: the link already says "Histórico" in words, and
 * a screen reader that also announced "picture of a list" would be reading the
 * decoration twice.
 */

type GlyphProps = { d: string; extra?: string };

/**
 * One glyph, at 24 px, stroked.
 *
 * `strokeWidth 2` against the 700-weight label beside it: a hairline glyph next
 * to bold text reads as an afterthought at 24 px, and this is the one place in
 * the app where a picture has to hold its own against a word.
 *
 * `shrink-0` because the cell is a flex column at 79 px on the narrowest phone,
 * and a glyph that shrinks to fit is a glyph that stops being recognisable.
 */
function Glyph({ d, extra }: GlyphProps) {
  return (
    <svg
      aria-hidden="true"
      className="h-6 w-6 shrink-0"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d={d} />
      {extra === undefined ? null : <path d={extra} />}
    </svg>
  );
}

/** A house: where you land. Both roles use it, for the same reason. */
function HomeIcon() {
  return (
    <Glyph
      d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"
      extra="M9.5 21v-6h5v6"
    />
  );
}

/** A stopwatch: the crown and the button on top, the hand pointing up. */
function StopwatchIcon() {
  return (
    <Glyph
      d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"
      extra="M12 9v4M9.5 2h5M19 5.5l1.5-1.5"
    />
  );
}

/** A calculator: the readout at the top, the keys under it. */
function CalculatorIcon() {
  return (
    <Glyph
      d="M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
      extra="M8 7h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"
    />
  );
}

/**
 * An extract: three entries, each a mark and the line it names.
 *
 * Not three plain rules — that is the "align text" glyph every toolbar has, and
 * it was the first thing this drew. The marks on the left are what make it a
 * list of things rather than a paragraph.
 */
function LedgerIcon() {
  return (
    <Glyph
      d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"
      extra="M9 6h11M9 12h11M9 18h7"
    />
  );
}

/** A tray: what has arrived and is waiting to be decided. */
function QueueIcon() {
  return (
    <Glyph
      d="M3 13h5l1.5 3h5l1.5-3h5"
      extra="M5.5 4h13l2.5 9v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"
    />
  );
}

/**
 * A plus: add something that never went through the stopwatch.
 *
 * The plus is inset rather than full-bleed. Drawn edge to edge inside the
 * square it stopped being a plus and became a window divided into four panes,
 * which is what it read as on the first pass.
 */
function AddIcon() {
  return (
    <Glyph
      d="M12 8.5v7M8.5 12h7"
      extra="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
    />
  );
}

/** Sliders: the settings that decide what everything is worth. */
function SettingsIcon() {
  return <Glyph d="M4 7h16M4 17h16" extra="M9 4.5v5M15 14.5v5" />;
}

/**
 * A person: whoever is logged in, and the way to the account page (#70).
 *
 * The one cell whose label is a name rather than a word, so the glyph is the
 * only part of it that is the same for all four accounts — which is what makes
 * the cell findable before the name is read.
 */
function AccountIcon() {
  return (
    <Glyph
      d="M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5z"
      extra="M4.5 20.5a7.5 7.5 0 0 1 15 0"
    />
  );
}

/** The glyph a route wears, or `null` for a route nobody drew one for. */
export function iconFor(href: string) {
  switch (href) {
    case "/menino":
    case "/admin":
      return <HomeIcon />;
    case "/menino/cronometro":
      return <StopwatchIcon />;
    case "/menino/calculadora":
      return <CalculatorIcon />;
    case "/menino/historico":
      return <LedgerIcon />;
    case "/admin/fila":
      return <QueueIcon />;
    case "/admin/lancar":
      return <AddIcon />;
    case "/admin/configuracao":
      return <SettingsIcon />;
    case "/conta":
      return <AccountIcon />;
    default:
      return null;
  }
}
