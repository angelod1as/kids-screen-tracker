/**
 * The design tokens of D42, and the only file allowed to name a shaded colour
 * (`design.test.ts`). Measurements and reasons live in `docs/design.md`.
 */

// `[48px]`, not `min-h-12`: the 12 is 48 px only at the default scale and font size.
export const TOUCH_TARGET_PX = 48;
export const TOUCH_TARGET_CLASS = "min-h-[48px] min-w-[48px]";

/** One phone-wide column that opens to one panel from `lg` (docs/design.md, Desktop). */
export const SHELL_CLASS = "mx-auto w-full max-w-md lg:max-w-4xl";

export const BORDER_CLASS = "border-2 border-black";
export const BORDER_PX = 2;

/** An iPhone SE (1st gen): every width in this file is measured against it. */
export const NARROWEST_PHONE_PX = 320;

/**
 * `break-words` sits on a `w-full` span because on the link itself the label is
 * an anonymous flex item with nothing to break against. Not in caps: see
 * docs/design.md, Tipografia.
 */
export const NAV_LABEL_PX = 12;
export const NAV_LABEL_LINE_HEIGHT = 1.25;
export const NAV_LABEL_CLASS =
  "w-full break-words text-center text-xs leading-tight font-bold lg:text-left lg:text-base";

export const SURFACE_BG_CLASS = "bg-slate-100";

export const ACCENT_BG_CLASS = "bg-blue-800";

/** `overflow-hidden` clips the band, whose square corners would poke through. */
export const PANEL_RADIUS_CLASS = "overflow-hidden rounded-xl";
export const CONTROL_RADIUS_CLASS = "rounded-lg";

/** Ink on white only: on black the same red measures 3.27:1. */
export const NEGATIVE_CLASS = "text-red-700";

export function balanceToneClass(hours: number): string {
  return hours < 0 ? NEGATIVE_CLASS : "text-black";
}

/**
 * Not `red-700` again: the checks watch utilities, so a second meaning wearing
 * the first one's utility would be invisible to them.
 */
export const PENDING_BG_CLASS = "bg-yellow-300";

/** Capped by the narrowest phone, not taste (docs/design.md, Tipografia). */
export const BALANCE_CLASS = "text-6xl";

export const HEADING_CLASS = "text-base font-bold uppercase tracking-[0.12em]";

export const PANEL_CLASS = `${PANEL_RADIUS_CLASS} border-2 border-black bg-white`;

export const PANEL_HEAD_CLASS = `flex items-baseline justify-between gap-3 border-b-2 border-black ${ACCENT_BG_CLASS} px-3 py-2 text-white`;

/**
 * The rule belongs to the row, not a divider on the parent: rows come from four
 * components, some conditional, so a parent's rule could double or go missing.
 */
export const ROW_CLASS =
  "flex items-baseline justify-between gap-3 border-t border-black px-3 py-3 first:border-t-0";

export const META_CLASS = "text-xs font-bold uppercase tracking-[0.08em]";

export const READOUT_CLASS = "font-mono text-lg font-bold tabular-nums";

/** Apart from `BALANCE_CLASS`, which is the size the home-screen test measures. */
export const BALANCE_FACE_CLASS =
  "block px-2 py-6 text-center font-mono font-bold leading-none tabular-nums";

/** The worst case, at 320 px (docs/design.md, Desktop). */
export const NAV_BAR_PX = 76;

/** On the bar, not the links, so the 48 px target is not shortened. */
export const NAV_SAFE_BOTTOM_CLASS = "pb-[env(safe-area-inset-bottom)]";

/**
 * `NAV_BAR_PX` plus the inset, as a literal: Tailwind reads source as text and
 * never sees a class built by a template string. Underscores escape `calc` spaces.
 */
export const CONTENT_BOTTOM_CLASS =
  "pb-[calc(76px_+_env(safe-area-inset-bottom))]";

/** For the web manifest, which takes no class; `design.test.ts` checks the shades. */
export const ACCENT_HEX = "#193cb8";
export const SURFACE_HEX = "#f1f5f9";
