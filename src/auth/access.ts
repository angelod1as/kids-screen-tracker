import type { Role } from "./accounts";

/*
 * The CLAUDE.md access rule, pure and apart from `guard.ts` so a table of cases
 * can check it and `access.sabotage.test.ts` can mutate this source by text.
 */

/** `userId` is read from `users` per request, never carried in the cookie. */
export type Session = {
  userId: number;
  username: string;
  displayName: string;
  role: Role;
};

/**
 * `targetUserId` is required and names the subject, not the caller: a forged
 * request is one whose target is not the caller's, so every call site must name
 * it. `proposeTimerLog` is the kid's only write; `write` is admin only.
 */
export type AccessRequest =
  | { kind: "view"; targetUserId: number }
  | { kind: "simulate"; targetUserId: number }
  | { kind: "proposeTimerLog"; targetUserId: number }
  | { kind: "write"; targetUserId: number };

export type AccessKind = AccessRequest["kind"];

/*
 * An admin passes whatever the target, the other admin included: wider than
 * CLAUDE.md's "tudo dos dois", argued in `access.rules.ts`.
 */

/** A kid's own data only; `write` is deliberately absent. */
const KID_ALLOWED_KINDS: readonly AccessKind[] = [
  "view",
  "simulate",
  "proposeTimerLog",
];

export function isAllowed(session: Session, request: AccessRequest): boolean {
  if (session.role === "admin") {
    return true;
  }

  if (request.targetUserId !== session.userId) {
    return false;
  }

  return KID_ALLOWED_KINDS.includes(request.kind);
}
