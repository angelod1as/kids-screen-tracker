import type { Locks } from "../db/pending";

/**
 * What a server action that failed says on screen (#29).
 *
 * Every screen used to answer a failure with the same sentence, "Não deu para
 * fazer isso agora. Tente de novo.", which says neither what happened nor
 * whether trying again can help. There are two different failures behind it,
 * and the browser can only be sure of one of them:
 *
 * - **The server refused.** A refusal (D32, D33, D37), a session that expired,
 *   or something unexpected, thrown inside the action. In a production build
 *   Next replaces the message and sends a `digest` instead, and that `digest`
 *   is the one positive sign that the server itself answered. The refusal
 *   texts are written for the server log, and `AccessDeniedError` is
 *   deliberately silent about who asked for what, so the screen says only that
 *   the server refused and that reloading shows the screen as it stands now —
 *   where D32's "aprove antes" and D37's lock notes are written.
 * - **Anything else is uncertain.** A `TypeError` from `fetch` (offline, or the
 *   network dropped mid-flight), an `AbortError` (Safari giving up on a request
 *   when the app goes to the background), a 502 page from the proxy during a
 *   redeploy, which Next's client turns into a plain `Error`. In every one of
 *   these the write may already be committed: a launch, a release or a refund
 *   writes first and reads the balance after. So the sentence never says
 *   nothing was saved, and asks to check before repeating — repeating a launch
 *   that did go through credits the hours twice.
 *
 * The default is the uncertain side on purpose. A failure the browser cannot
 * recognise is treated as one that may have been written.
 *
 * Nothing here is coloured: a failure is not one of the three things CLAUDE.md
 * spends colour on.
 */

export type FailureKind = "uncertain" | "refused";

/** Whether the phone believes it is online; true outside a browser. */
function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

/**
 * Which of the two failures an error thrown by a server action call is.
 *
 * Only an error that carries a `digest` — the mark Next puts on an error thrown
 * inside the action — counts as a refusal, and only while the phone is online.
 */
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

/** The sentence for a failed request: what happened, and what to do. */
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
 * The same failure, said on the Configuration screen (D37).
 *
 * There the refusal an adult actually meets is D37's: D35 and D36 switch
 * *Salvar* off before the tap, and a lock is the one refusal that lasts until
 * somebody decides the queue or the boy stops his session. So when the server
 * refused and a fresh read of the locks finds something under way, the
 * sentence says that, and what ends it — the same thing `lockNote` says before
 * the tap, rather than a reload that would be refused again.
 */
export function configFailureText(
  error: unknown,
  locks: Locks | null,
  online: boolean = isOnline(),
): string {
  if (
    failureKind(error, online) !== "refused" ||
    locks === null ||
    locks.queued + locks.running === 0
  ) {
    return failureText(error, online);
  }

  const why =
    locks.queued > 0 && locks.running > 0
      ? "há entrada esperando na fila e cronômetro aberto"
      : locks.queued > 0
        ? "há entrada esperando na fila"
        : "há cronômetro aberto";

  const what =
    locks.queued > 0 && locks.running > 0
      ? "Decida a fila e espere o cronômetro ser parado"
      : locks.queued > 0
        ? "Decida a fila primeiro"
        : "Espere o cronômetro ser parado";

  return `O servidor recusou o pedido: ${why}, e o que define o valor do que já foi feito não muda agora. ${what}, e então tente de novo.`;
}

/**
 * The same failure, said on the stopwatch (#29: "falha de rede no cronômetro
 * não perde a sessão em andamento").
 *
 * The boy's first worry is the afternoon he has on the clock, so the sentence
 * starts there. It is true for both failures: the session lives in the
 * database, stamped (D16, D17), and nothing in the browser holds it — a failed
 * pause, resume or stop leaves it open exactly where it was, or, if the request
 * did arrive and only the answer was lost, already done.
 *
 * It does not promise that nothing is ever lost: D16 still abandons a session
 * left paused for more than twelve hours, with or without a connection. What it
 * says is the narrower true thing — a failed connection does not erase it.
 */
export function timerFailureText(
  error: unknown,
  online: boolean = isOnline(),
): string {
  return failureKind(error, online) === "refused"
    ? "O servidor recusou o pedido. O cronômetro fica guardado lá: recarregue a página para ver como ele está agora."
    : "A resposta do servidor não chegou. O cronômetro fica guardado lá, e uma falha de conexão não apaga a sessão: confira a internet e toque de novo.";
}

/**
 * What the screen says after a failure it has already recovered from.
 *
 * When the request failed but a fresh read of the screen then succeeded, the
 * connection flickered or the screen was stale. What is on screen is now the
 * server's, and it may already show the thing the adult or the boy was trying
 * to do.
 */
export const RESYNCED_TEXT =
  "O pedido falhou, e a tela foi atualizada com o que está salvo agora. Confira e, se ainda precisar, toque de novo.";
