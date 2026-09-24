"use client";

import { Button } from "../ui/button";
import { BORDER_CLASS, SHELL_CLASS } from "../ui/style";

/** Next replaces the root layout here, so `lang="pt-BR"` must be repeated (#14). */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh bg-white text-black antialiased">
        <div
          className={`${SHELL_CLASS} ${BORDER_CLASS} flex min-h-dvh flex-col justify-center gap-6 border-b-0 border-t-0 bg-white p-6 text-black`}
        >
          <h1 className="text-3xl font-bold">Algo deu errado</h1>
          <p className={`${BORDER_CLASS} bg-white p-4 text-lg`}>
            O app não conseguiu carregar. Tente de novo; se continuar assim,
            avise um adulto.
          </p>
          <Button onClick={reset} type="button">
            Tentar de novo
          </Button>
        </div>
      </body>
    </html>
  );
}
