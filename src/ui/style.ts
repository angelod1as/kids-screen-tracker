/**
 * The design rules of #14 that are the same on every screen, plus the shapes
 * and the palette the instrument-panel direction of #74 is built from, written
 * once so `design.test.ts` has something to check and every component has one
 * place to take them from.
 *
 * **The palette is declared here and nowhere else.** Every colour the app is
 * allowed to serve is a constant below, and `design.test.ts` fails on any
 * shaded colour written in any other file. That check used to say "black and
 * white, and three exceptions"; it now says "these four shaded utilities, and
 * nothing else", which is the same guarantee against a colour arriving by habit.
 *
 * The palette has two halves and they must not be confused:
 *
 * - **the chrome** — `ACCENT_BG_CLASS` and `SURFACE_BG_CLASS` — is the app's
 *   own furniture. It says *this is a band*, *this is the ground a panel sits
 *   on*. It never says anything about the data. There were three: a deeper
 *   tone existed for the strip at the top of every screen, and #70 removed that
 *   strip, so the tone went with it.
 * - **the two meanings** — `PENDING_BG_CLASS` and `NEGATIVE_CLASS` — is
 *   CLAUDE.md's rule: a pendency and a negative balance. Nothing else in the
 *   app is ever allowed to be red or yellow.
 *
 * The two halves are far apart on the wheel on purpose. The chrome is blue and
 * the meanings are red and yellow, so a screen full of chrome still has exactly
 * one thing on it that is warm, and that thing is always something the reader
 * has to do something about.
 *
 * **Contrast is not relaxed anywhere.** White on `blue-800` is 8.82:1, black on
 * `slate-100` is 19.17:1, and the two meanings keep the numbers they had. The rule the old palette served — nothing grey on
 * grey, nothing dimmed — is still enforced by `design.test.ts`, which forbids
 * `opacity-*` and any colour not on this list.
 *
 * **What #74 changes about shape.** Instead of a stack of separate boxes each
 * floating in its own margin, a screen is a set of panels on a tinted ground:
 * a rounded white surface, a solid coloured band naming it, and rows inside
 * divided by a 1 px rule. Structure is drawn, not implied by empty space, and
 * that is the whole difference between this and a generic card layout.
 */

/**
 * The minimum touch target, in CSS pixels, and the classes that produce it.
 *
 * Written as `[48px]` rather than Tailwind's `min-h-12` deliberately: the `12`
 * is 48 px only while the spacing scale is 0.25 rem and the root font size is
 * 16 px, and neither of those is a promise anybody in this repository made. The
 * requirement is 48 px.
 */
export const TOUCH_TARGET_PX = 48;
export const TOUCH_TARGET_CLASS = "min-h-[48px] min-w-[48px]";

/**
 * One column the width of a phone, which grows into one panel on a desk.
 *
 * The spec's old line was "desktop pode ser só a versão mobile centralizada",
 * and #74 replaces it: the owner wants a real wide layout, from one base, with
 * no second set of screens. So this cap is the only thing that changes with the
 * viewport — the column stops at a phone's width until `lg`, and above it opens
 * to a panel the screens fill with two columns of their own.
 *
 * `max-w-4xl` and not wider: past about 900 px a line of text is harder to read,
 * not easier, and the content here is two columns of short rows. A page that
 * ran the full width of a 27-inch monitor would put the balance and the button
 * that earns it half a metre apart.
 */
export const SHELL_CLASS = "mx-auto w-full max-w-md lg:max-w-4xl";

/** A heavy black rule. The frame of every panel, and of every control. */
export const BORDER_CLASS = "border-2 border-black";
export const BORDER_PX = 2;

/**
 * The narrowest phone still in use, which is what every width in this file is
 * measured against. 320 CSS px is an iPhone SE (1st gen) and the floor of every
 * Android device chart worth reading.
 */
export const NARROWEST_PHONE_PX = 320;

/**
 * How a label inside the bottom bar is set, and the numbers behind it.
 *
 * The narrowest phone still in use is 320 CSS px. The shell draws a 2 px rule
 * down each side, so four cells share 316 and each one is 79 px wide, with 2 px
 * of padding each side leaving 75 px for the word. `Cronômetro` and
 * `Calculadora` at 14 px measured 81 px in a browser and ran out of their 79 px
 * cells, touching each other with no gap at all; the test that was supposed to
 * cover this asserted `length <= 4`, which is a proxy for width and does not
 * measure one.
 *
 * Since #70 the account cell takes the name plus a rem either side — 71.4 px
 * for `Kid1`, 74.3 for `Admin1` — off those 316, so the boy's four menu cells
 * are 61.1 px at 320, 71.1 at 360 and 78.6 at 390. His two longest labels wrap
 * onto a second line at the first two widths and sit on one line at 390. The
 * labels are to become icons on another branch, which gives that width back.
 *
 * Two things fix it, and only the second is a guarantee:
 *
 * - `text-xs` is 12 px, which is what Material puts on an Android bottom bar
 *   and takes the longest label this app has to 72 px, inside the 75;
 * - `break-words`, on a `w-full` span, breaks a word that still does not fit
 *   instead of letting it spill — so a label nobody has written yet cannot
 *   overflow whatever it ends up being called. The span matters: as the link's
 *   own text the label is an anonymous flex item with no width to break
 *   against, and `break-words` on the link did nothing at all.
 *
 * `leading-tight` is 1.25, so a label that does wrap takes 2 x 15 px = 30 px,
 * and with `py-2` on both sides that is 46 px — still inside the 48 px target.
 *
 * From `lg` the bar is the rail down the left of the shell, where a cell is
 * 208 px instead of 79 and the constraint above simply stops applying: the
 * label goes up to 1 rem and to the left, which is where a list of destinations
 * is read from. The `lg:` half of this constant is the only part of the
 * two-colour design that the viewport changes at all.
 *
 * **These labels are not set in caps**, and they are the one set of labels in
 * the app that are not. Capitals are about 15% wider, and 15% of 72 px is over
 * the 75 px a cell has: `CALCULADORA` is a single word, so it would not wrap —
 * it would break mid-word. The rest of the interface can afford the caps
 * because nothing else is pinned to a 79 px cell.
 */
export const NAV_LABEL_PX = 12;
export const NAV_LABEL_LINE_HEIGHT = 1.25;
export const NAV_LABEL_CLASS =
  "w-full break-words text-center text-xs leading-tight font-bold lg:text-left lg:text-base";

/**
 * The ground the whole app sits on, and the reason a panel reads as a panel.
 *
 * `slate-100` is 19.17:1 under black text, so it is a tint and not a grey in the
 * sense the rules forbid — nothing is dimmed, nothing loses contrast. What it
 * buys is the edge: a white panel on a white page is only a panel because of
 * its border, and a white panel on a tinted page is one before the border is
 * read at all. It is also what lets the rules inside a panel drop to 1 px
 * without the panel dissolving.
 *
 * Slate and not a neutral grey, because it carries a trace of the same blue as
 * the chrome. A page of pure-grey ground under blue bands reads as two systems.
 */
export const SURFACE_BG_CLASS = "bg-slate-100";

/**
 * The app's own colour: every panel band, every primary control, the current
 * item in the menu.
 *
 * `blue-800` and not a lighter blue: it measures 8.82:1 under white, so a band
 * carries white caps at 12 px as safely as the black one did, and a boy reading
 * it outdoors on an Android phone loses nothing. Anything lighter buys
 * friendliness with the one thing this app cannot spend.
 *
 * It replaces black as the *ground* of a band, and black stays as the *rule*
 * around a panel and between its rows. That division is what keeps the
 * instrument: the colour is paint on a structure that is still drawn in ink.
 */
export const ACCENT_BG_CLASS = "bg-blue-800";

/**
 * How round a corner is, and there are two radii for the same reason there are
 * two rule weights.
 *
 * 12 px on a panel, 8 px on a control. A panel is a region and a control is a
 * thing you press, and a reader who never notices the difference still feels
 * the control sitting inside the region rather than beside it.
 *
 * The square corner was a deliberate choice of the first draft and the owner
 * asked for it to go: "queria que parecesse mais um app". `overflow-hidden` on
 * the panel is what makes it real — the band is a full-bleed rectangle, and
 * without the clip its own square corners would poke through the rounded ones.
 */
export const PANEL_RADIUS_CLASS = "overflow-hidden rounded-xl";
export const CONTROL_RADIUS_CLASS = "rounded-lg";

/**
 * The colour of a balance that has gone below zero.
 *
 * One of the two places CLAUDE.md lets colour mean something. A negative
 * balance rendered in the same black as a positive one is the number a boy is
 * most likely to misread, and it is the number that decides whether he can turn
 * the console on.
 *
 * `red-700` rather than `red-500`: it measures 6.42:1 against white, so the
 * "alto contraste" rule survives the exception it is making. It stays ink on a
 * white ground for the same reason — the same red on black would measure
 * 3.27:1 and be the one exception that broke the rule.
 */
export const NEGATIVE_CLASS = "text-red-700";

/** The ink a balance of `hours` is written in. */
export function balanceToneClass(hours: number): string {
  return hours < 0 ? NEGATIVE_CLASS : "text-black";
}

/**
 * The ground a pendency is drawn on, black ink over it.
 *
 * The second of CLAUDE.md's two places. It marks the count on the approval
 * queue (#20) and the boy's own entries that are still waiting (#18), which are
 * the same fact seen from the two ends.
 *
 * **A different colour from the other one, deliberately.** Reusing `red-700`
 * would have cost nothing on screen and everything in the checks:
 * `check-served-css.sh` and `design.test.ts` both watch *utilities*, so a
 * second rule wearing the first rule's utility is a rule they cannot see, and a
 * third place would arrive without either of them saying a word. Two rules, two
 * utilities, and `design.test.ts` asserts they are distinct.
 *
 * `yellow-300` is a ground and not ink: against white it is far too pale to
 * read as text, and under black it measures 15.83:1 — the higher contrast of
 * the two exceptions, on the marker that has to be seen from across a kitchen.
 */
export const PENDING_BG_CLASS = "bg-yellow-300";

/**
 * The balance on the boy's home screen: "o maior elemento da tela, por larga
 * margem".
 *
 * 3.75 rem against the 1 rem of every label beside it — a factor of nearly
 * four, not a step on a scale. `home-screens.test.tsx` measures the relation
 * rather than pinning the name, because a screen that grows a bigger heading
 * tomorrow breaks the rule without touching this line.
 *
 * It is not larger than this, and the limit is the narrowest phone rather than
 * taste. Set in the monospace face, every glyph is 0.6 em wide, so the widest
 * balance the app can draw — `−102h30`, seven characters — is 252 px at this
 * size. At 320 CSS px the panel leaves it 304. Measured in a browser at 360 and
 * at 390.
 */
export const BALANCE_CLASS = "text-6xl";

/**
 * A heading, wherever a screen writes one outside a panel band.
 *
 * Caps at 1 rem with wide letter-spacing, which is how a panel is labelled and
 * not how a document is titled — and that is the intent. Nothing in this app is
 * an article; every screen is a face with named regions on it. Setting the
 * heading small and wide rather than large and bold is also what buys the
 * balance its margin: the largest competing text on the boy's home screen is
 * now 1 rem, so the balance is 3.75 times it.
 *
 * Letter-spacing and capitals cost legibility in running text and buy it in a
 * three-word label, which is the only thing this is ever applied to.
 */
export const HEADING_CLASS = "text-base font-bold uppercase tracking-[0.12em]";

/**
 * A panel: the unit the whole interface is assembled from.
 *
 * One heavy rule around a region, a solid blue band naming it, and rows inside
 * divided by a lighter rule. There is no margin inside a panel, because the thing being imitated is a face with regions milled
 * into it, not a sheet of paper lying on a desk.
 *
 * Two rule weights, and they mean two different things: 2 px is the edge of a
 * region, 1 px is a division inside one. A reader never has to be told this —
 * it is how every instrument, table and form has worked for two centuries — but
 * it stops working the moment a third weight appears, so there are two.
 */
export const PANEL_CLASS = `${PANEL_RADIUS_CLASS} border-2 border-black bg-white`;

/**
 * The band across the top of a panel: white on the accent, caps, wide.
 *
 * It gives every screen a horizon line every 200 px or so, which is what makes
 * a dense page scannable on a phone — the eye lands on a band, not on a
 * paragraph. Solid and not tinted: a pale band would be the grey-on-grey the
 * rules forbid, whatever hue it wore.
 *
 * `items-baseline` so the name of the panel and whatever it carries on the
 * right sit on one line even when they are different sizes.
 */
export const PANEL_HEAD_CLASS = `flex items-baseline justify-between gap-3 border-b-2 border-black ${ACCENT_BG_CLASS} px-3 py-2 text-white`;

/**
 * A row inside a panel, and the 1 px rule that separates it from the one above.
 *
 * `first:border-t-0` rather than a divider on the parent: the rows of this app
 * are drawn by four different components and some of them are conditional, so a
 * rule that belongs to the row itself cannot end up doubled or missing.
 *
 * `py-3` with a 1 rem line is 48 px of height, which is the touch target these
 * rows would need if any of them were tappable. None is today. Keeping the
 * height anyway means a row that becomes a link later does not have to be
 * redrawn to be legal.
 */
export const ROW_CLASS =
  "flex items-baseline justify-between gap-3 border-t border-black px-3 py-3 first:border-t-0";

/**
 * The second line of a row: what kind of movement, and when.
 *
 * Caps at 0.75 rem with a little tracking. Small *and* in caps is deliberate —
 * caps have no descenders and a flat top line, so a 12 px caps label stays
 * legible where 12 px of running text would not, and it reads as a machine's
 * annotation rather than as something to stop and read.
 */
export const META_CLASS = "text-xs font-bold uppercase tracking-[0.08em]";

/**
 * Any number that is not the balance: hours on a row, a preview, a count.
 *
 * Monospaced and tabular, always, and this is the rule the direction is built
 * on. Numbers in this app are read *down* a column — five entries, two boys,
 * a queue of proposals — and proportional digits put the decimal comma in a
 * different place on every line, which is the difference between a table and a
 * list of facts that happen to be numbers.
 *
 * 1.125 rem and bold, which is one step above the label beside it. On a row
 * the number is the reading and the words are the caption, and the type sizes
 * have to say so or the row has to be read twice.
 */
export const READOUT_CLASS = "font-mono text-lg font-bold tabular-nums";

/**
 * The balance itself, and the only other place the monospace face is set this
 * large.
 *
 * Kept apart from `BALANCE_CLASS` because that constant is the *size*, which
 * `home-screens.test.tsx` measures against every other size on the screen. This
 * is the rest of how the number is drawn, and the two are applied together.
 */
export const BALANCE_FACE_CLASS =
  "block px-2 py-6 text-center font-mono font-bold leading-none tabular-nums";

/**
 * The height the fixed bottom bar occupies, at its tallest.
 *
 * #70 could write this as one touch target plus the rule on top, because every
 * link carried `TOUCH_TARGET_CLASS` and a wrapped label still came to 46 px
 * inside it. #74 put a glyph above each label, so the cell is taller than the
 * target it guarantees and the sum has to be spelled out:
 *
 *     24  the glyph (`h-6`)
 *    + 4  the gap under it (`gap-1`)
 *   + 30  two lines of label (12 px at 1.25, because `Cronômetro` wraps in a
 *         61 px cell at 320 — the account cell takes its width off the top)
 *   + 16  `py-2`, top and bottom
 *   +  2  the rule the bar draws on itself
 *   ----
 *     76
 *
 * It is the *worst* case on purpose. A screen at 390, where nothing wraps,
 * reserves 15 px it does not need and ends with a little blank; a screen that
 * reserved the 390 number would hide the last line of the history at 320, with
 * no scroll left to bring it back. Measured in a browser at 320, 360 and 390.
 */
export const NAV_BAR_PX = 76;

/**
 * The white strip the bar keeps below itself for the iPhone home indicator.
 *
 * `env(safe-area-inset-bottom)` is 0 on everything else, so this costs nothing
 * on Android and on the desktop. It sits on the bar rather than on the links:
 * the target stays 48 px and the inset is padding under it, not a shorter
 * button.
 */
export const NAV_SAFE_BOTTOM_CLASS = "pb-[env(safe-area-inset-bottom)]";

/**
 * What the frame reserves at the bottom so the fixed bar never covers the end
 * of a page.
 *
 * The bar is `fixed`, so it is out of the flow and the last line of a screen
 * would otherwise sit under it — the scroll ends and the content is still
 * hidden. The number is `NAV_BAR_PX` plus the same safe-area inset the bar
 * pads itself with, and `design.test.ts` holds it to that sum: written as a
 * literal because Tailwind's extractor reads source as text and never sees a
 * class name built by a template string.
 *
 * The underscores are Tailwind's escape for the spaces `calc` requires.
 */
export const CONTENT_BOTTOM_CLASS =
  "pb-[calc(76px_+_env(safe-area-inset-bottom))]";

/**
 * `ACCENT_BG_CLASS` and `SURFACE_BG_CLASS` as hex, for the web manifest, which
 * takes no Tailwind class. `design.test.ts` holds them to the installed shades.
 */
export const ACCENT_HEX = "#193cb8";
export const SURFACE_HEX = "#f1f5f9";
