/**
 * A refusal the adult must read word for word (D32, D37). Only this class is
 * returned to the browser; anything else thrown stays a digest there.
 */
export class RefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefusalError";
  }
}

export type Refused = { refused: string };

/** Call after the access guard, whose denial stays thrown and says nothing. */
export function refusedOr<T>(write: () => T): T | Refused {
  try {
    return write();
  } catch (error) {
    if (error instanceof RefusalError) {
      return { refused: error.message };
    }

    throw error;
  }
}
