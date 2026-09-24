import type { Role } from "../auth/accounts";

/**
 * The navigation, per role (#14), as pure data.
 *
 * Two roles, two disjoint sets of routes, and the boy's set never names an
 * admin route. That is a property a test can hold, which is why the menus are
 * a function of the role rather than a pile of `session.role === "admin" &&`
 * inside a component.
 *
 * It is the *menu*, not the guard. A kid who types `/admin` by hand is stopped
 * by `src/app/(app)/admin/layout.tsx`, and a kid who forges a POST is stopped
 * by `requireAccess` inside the action. Hiding a link stops nobody.
 *
 * Labels are pt-BR, like the rest of the interface, and short on purpose:
 * four of them share the width of a phone and each has to keep a 48 px target.
 */

export type NavItem = {
  href: string;
  label: string;
};

const KID_NAVIGATION: readonly NavItem[] = [
  { href: "/menino", label: "Início" },
  { href: "/menino/cronometro", label: "Cronômetro" },
  { href: "/menino/calculadora", label: "Calculadora" },
  { href: "/menino/historico", label: "Histórico" },
];

/**
 * Liberar and Estornar are missing on purpose: the spec puts "atalhos para as
 * três ações do dia a dia" on the admin's home screen, and a six-item bar on a
 * phone is six targets too narrow to hit.
 *
 * Configuração left the bar in #70 and is now reached from the account page,
 * which is where the two things an adult does rarely — change the rules, log
 * out — sit together. It is two taps from any screen, which is the limit
 * CLAUDE.md sets.
 */
const ADMIN_NAVIGATION: readonly NavItem[] = [
  { href: "/admin", label: "Início" },
  { href: "/admin/fila", label: "Fila" },
  { href: "/admin/lancar", label: "Lançar" },
];

/**
 * The account page, which the identity cell on the left of the bar leads to
 * (#70). One route for both roles — what it offers differs, and that is the
 * page's decision, not the menu's.
 */
export const ACCOUNT_PATH = "/conta";

/** The identity cell: whoever is logged in, pointing at his own account. */
export function accountItemFor(displayName: string): NavItem {
  return { href: ACCOUNT_PATH, label: displayName };
}

export function navigationFor(role: Role): readonly NavItem[] {
  return role === "admin" ? ADMIN_NAVIGATION : KID_NAVIGATION;
}

/** Where a person lands after logging in, and where `/` sends them. */
export function homePathFor(role: Role): string {
  return role === "admin" ? "/admin" : "/menino";
}

/**
 * Whether `item` is the page currently open.
 *
 * `/menino` is a prefix of `/menino/historico`, so a plain `startsWith` would
 * light up two items at once. Only the exact path counts, which is right for
 * every route in both menus — none of them has children of its own.
 */
export function isCurrent(item: NavItem, pathname: string): boolean {
  return item.href === pathname;
}
