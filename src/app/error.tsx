"use client";

import { Button } from "../ui/button";
import { BORDER_CLASS, SHELL_CLASS } from "../ui/style";

/**
 * What a crash inside the app shows (#14: "toda a interface em pt-BR").
 *
 * Without this file Next serves its own screen, in English. That screen is
 * reachable today only in theory — the layouts redirect before any guard can
 * throw — but `AccessDeniedError` is thrown rather than returned, so the day a
 * refusal reaches a browser it arrives here.
 *
 * It does not print `error.message`. A message written for a server log is a
 * message that names a table, a path or an id, and the one message this app
 * throws on purpose ("Acesso negado.") was written to say nothing about who
 * asked for what. Both arguments point the same way: one fixed sentence.
 */
export default function AppError({ reset }: { reset: () => void }) {
  return (
    <div
      className={`${SHELL_CLASS} ${BORDER_CLASS} flex min-h-dvh flex-col justify-center gap-6 border-b-0 border-t-0 bg-white p-6 text-black`}
    >
      <h1 className="text-3xl font-bold">Algo deu errado</h1>
      <p className={`${BORDER_CLASS} bg-white p-4 text-lg`}>
        Não foi possível abrir esta tela. Tente de novo; se continuar assim,
        avise um adulto.
      </p>
      <Button onClick={reset} type="button">
        Tentar de novo
      </Button>
    </div>
  );
}
