/**
 * What a failed server action says on screen (#29). Only a `digest` proves the
 * server answered; anything else may already be written, so the default is
 * "uncertain": a repeated launch that did go through credits the hours twice.
 */

export type FailureKind = "uncertain" | "refused";

/** True outside a browser, so there a `digest` alone decides the kind. */
function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

/** A `digest` is Next's mark on an error thrown inside the action. */
export function failureKind(
  error: unknown,
  online: boolean = isOnline(),
): FailureKind {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? (error as { digest: unknown }).digest
      : undefined;

  return online && typeof digest === "string" && digest !== ""
    ? "refused"
    : "uncertain";
}

export function failureText(
  error: unknown,
  online: boolean = isOnline(),
): string {
  return failureKind(error, online) === "refused"
    ? REFUSED_TEXT
    : UNCERTAIN_TEXT;
}

export const UNCERTAIN_TEXT =
  "A resposta do servidor não chegou, e não dá para saber se o pedido foi salvo. Confira a internet, recarregue a página para ver o que ficou salvo e só então tente de novo.";

export const REFUSED_TEXT =
  "O servidor recusou o pedido. A tela pode estar desatualizada ou a sua entrada no app pode ter expirado: recarregue a página, confira o que está salvo e só então tente de novo.";

/**
 * The session lives in the database (D16, D17), so a failed connection does not
 * erase it. Not "nothing is lost": D16 still abandons a session paused over 12 h.
 */
export function timerFailureText(
  error: unknown,
  online: boolean = isOnline(),
): string {
  return failureKind(error, online) === "refused"
    ? "O servidor recusou o pedido. O cronômetro fica guardado lá: recarregue a página para ver como ele está agora."
    : "A resposta do servidor não chegou. O cronômetro fica guardado lá, e uma falha de conexão não apaga a sessão: confira a internet e toque de novo.";
}

/** The request failed but a fresh read succeeded: the screen is now the server's. */
export const RESYNCED_TEXT =
  "O pedido falhou, e a tela foi atualizada com o que está salvo agora. Confira e, se ainda precisar, toque de novo.";
