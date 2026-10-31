import type { ReactNode } from "react";

/** What a disabled button still needs (D55's pattern): nothing went wrong, so not an `ErrorNote`. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-base text-black">{children}</p>;
}
