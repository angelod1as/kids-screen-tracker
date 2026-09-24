import type { Role } from "../auth/accounts";

/**
 * The menu per role (#14), as data a test can hold. The menu is not the guard:
 * the admin layout and `requireAccess` in each action are.
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
 * No Liberar or Estornar: they are home-screen shortcuts, and six cells are too
 * narrow. Configuração moved to the account page in #70, still two taps away.
 */
const ADMIN_NAVIGATION: readonly NavItem[] = [
  { href: "/admin", label: "Início" },
  { href: "/admin/fila", label: "Fila" },
  { href: "/admin/lancar", label: "Lançar" },
];

/** One route for both roles; what it offers is the page's decision (#70). */
export const ACCOUNT_PATH = "/conta";

export function accountItemFor(displayName: string): NavItem {
  return { href: ACCOUNT_PATH, label: displayName };
}

export function navigationFor(role: Role): readonly NavItem[] {
  return role === "admin" ? ADMIN_NAVIGATION : KID_NAVIGATION;
}

export function homePathFor(role: Role): string {
  return role === "admin" ? "/admin" : "/menino";
}

/** Exact match: `/menino` is a prefix of `/menino/historico`, and no route has children. */
export function isCurrent(item: NavItem, pathname: string): boolean {
  return item.href === pathname;
}
