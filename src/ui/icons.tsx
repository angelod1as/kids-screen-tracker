/**
 * The bar's glyphs (D42; docs/design.md, Ícones). Keyed by route, not carried on
 * the nav item: `navigation.ts` is data whose exact shape is asserted.
 */

type GlyphProps = { d: string; extra?: string };

/** `shrink-0`: in a 79 px flex cell, a glyph that shrinks stops being recognisable. */
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

function HomeIcon() {
  return (
    <Glyph
      d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"
      extra="M9.5 21v-6h5v6"
    />
  );
}

function StopwatchIcon() {
  return (
    <Glyph
      d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"
      extra="M12 9v4M9.5 2h5M19 5.5l1.5-1.5"
    />
  );
}

function CalculatorIcon() {
  return (
    <Glyph
      d="M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
      extra="M8 7h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"
    />
  );
}

/** The marks on the left keep it a list, not the toolbar's "align text" glyph. */
function LedgerIcon() {
  return (
    <Glyph
      d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"
      extra="M9 6h11M9 12h11M9 18h7"
    />
  );
}

function QueueIcon() {
  return (
    <Glyph
      d="M3 13h5l1.5 3h5l1.5-3h5"
      extra="M5.5 4h13l2.5 9v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"
    />
  );
}

/** Inset: drawn edge to edge, the plus read as a four-pane window. */
function AddIcon() {
  return (
    <Glyph
      d="M12 8.5v7M8.5 12h7"
      extra="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
    />
  );
}

function SettingsIcon() {
  return <Glyph d="M4 7h16M4 17h16" extra="M9 4.5v5M15 14.5v5" />;
}

function AccountIcon() {
  return (
    <Glyph
      d="M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5z"
      extra="M4.5 20.5a7.5 7.5 0 0 1 15 0"
    />
  );
}

/** `null` for a route with no glyph: the label renders alone rather than breaking. */
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
