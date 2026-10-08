import type { ReactNode } from "react";

import { BORDER_CLASS, CONTROL_RADIUS_CLASS } from "./style";

/**
 * A server failure or a missing field, marked ERRO so it reads as an error and
 * not a stray sentence (#86). The label is ink, not colour: red already means a
 * negative balance and a way out (D42, #35), so a fourth meaning would blur it.
 */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${BORDER_CLASS} ${CONTROL_RADIUS_CLASS} bg-white p-4 text-black`}
      role="alert"
    >
      <span className="inline-block bg-black px-2 py-1 text-xs font-bold uppercase tracking-[0.12em] text-white">
        Erro
      </span>
      <p className="mt-2 break-words text-base">{children}</p>
    </div>
  );
}
