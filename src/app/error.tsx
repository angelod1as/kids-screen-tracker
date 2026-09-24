"use client";

import { Button } from "../ui/button";
import { BORDER_CLASS, SHELL_CLASS } from "../ui/style";

/**
 * Without it Next answers in English (#14). Never prints `error.message`: a
 * server message can name a table, a path or an id.
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
