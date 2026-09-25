import type { AccessRequest, Session } from "./access";

/**
 * The access rule of #13, one case at a time. Data, not tests, because
 * `access.sabotage.test.ts` also runs it against each mutant of `access.ts`.
 * The ids are the seeded ones: 1 Admin1, 2 Admin2, 3 Kid1, 4 Kid2.
 */

export const ADMIN1: Session = {
  userId: 1,
  username: "admin1",
  displayName: "Admin1",
  role: "admin",
};

export const ADMIN2: Session = {
  userId: 2,
  username: "admin2",
  displayName: "Admin2",
  role: "admin",
};

export const KID1: Session = {
  userId: 3,
  username: "kid1",
  displayName: "Kid1",
  role: "kid",
};

export const KID2: Session = {
  userId: 4,
  username: "kid2",
  displayName: "Kid2",
  role: "kid",
};

export type AccessCase = {
  /** Which acceptance criterion of #13 this case belongs to. */
  rule: string;
  name: string;
  session: Session;
  request: AccessRequest;
  allowed: boolean;
};

export const ACCESS_CASES: readonly AccessCase[] = [
  {
    rule: "kid reads only his own data",
    name: "Kid1 views his own balance",
    session: KID1,
    request: { kind: "view", targetUserId: KID1.userId },
    allowed: true,
  },
  {
    rule: "kid reads only his own data",
    name: "Kid2 views his own balance",
    session: KID2,
    request: { kind: "view", targetUserId: KID2.userId },
    allowed: true,
  },
  {
    rule: "kid simulates only his own data",
    name: "Kid1 simulates against his own day",
    session: KID1,
    request: { kind: "simulate", targetUserId: KID1.userId },
    allowed: true,
  },

  {
    rule: "kid never sees his brother's balance",
    name: "Kid1 forges Kid2's id on a read",
    session: KID1,
    request: { kind: "view", targetUserId: KID2.userId },
    allowed: false,
  },
  {
    rule: "kid never sees his brother's balance",
    name: "Kid2 forges Kid1's id on a read",
    session: KID2,
    request: { kind: "view", targetUserId: KID1.userId },
    allowed: false,
  },
  {
    rule: "kid never sees his brother's balance",
    name: "Kid1 forges Kid2's id on a simulation",
    session: KID1,
    request: { kind: "simulate", targetUserId: KID2.userId },
    allowed: false,
  },
  {
    rule: "kid never sees his brother's balance",
    name: "Kid1 forges an admin's id on a read",
    session: KID1,
    request: { kind: "view", targetUserId: ADMIN1.userId },
    allowed: false,
  },
  {
    rule: "kid never sees his brother's balance",
    name: "Kid1 forges an id nobody has",
    session: KID1,
    request: { kind: "view", targetUserId: 9999 },
    allowed: false,
  },

  {
    rule: "the timer and the request are the kid's only writes",
    name: "Kid1 proposes a timer log for himself",
    session: KID1,
    request: { kind: "proposeTimerLog", targetUserId: KID1.userId },
    allowed: true,
  },
  {
    rule: "the timer and the request are the kid's only writes",
    name: "Kid1 proposes a timer log in Kid2's name",
    session: KID1,
    request: { kind: "proposeTimerLog", targetUserId: KID2.userId },
    allowed: false,
  },
  {
    rule: "the timer and the request are the kid's only writes",
    name: "Kid1 writes something else to his own data",
    session: KID1,
    request: { kind: "write", targetUserId: KID1.userId },
    allowed: false,
  },
  {
    rule: "the timer and the request are the kid's only writes",
    name: "Kid2 writes something else to Kid1's data",
    session: KID2,
    request: { kind: "write", targetUserId: KID1.userId },
    allowed: false,
  },

  {
    rule: "the untimed request is the kid's second write",
    name: "Kid1 requests an untimed log for himself",
    session: KID1,
    request: { kind: "requestLog", targetUserId: KID1.userId },
    allowed: true,
  },
  {
    rule: "the untimed request is the kid's second write",
    name: "Kid2 requests an untimed log for himself",
    session: KID2,
    request: { kind: "requestLog", targetUserId: KID2.userId },
    allowed: true,
  },
  {
    rule: "the untimed request is the kid's second write",
    name: "Kid1 requests an untimed log in Kid2's name",
    session: KID1,
    request: { kind: "requestLog", targetUserId: KID2.userId },
    allowed: false,
  },
  {
    rule: "the untimed request is the kid's second write",
    name: "Kid2 requests an untimed log in an admin's name",
    session: KID2,
    request: { kind: "requestLog", targetUserId: ADMIN1.userId },
    allowed: false,
  },

  {
    rule: "admin reads and changes everything of both",
    name: "Admin1 views Kid1",
    session: ADMIN1,
    request: { kind: "view", targetUserId: KID1.userId },
    allowed: true,
  },
  {
    rule: "admin reads and changes everything of both",
    name: "Admin1 views Kid2",
    session: ADMIN1,
    request: { kind: "view", targetUserId: KID2.userId },
    allowed: true,
  },
  {
    rule: "admin reads and changes everything of both",
    name: "Admin1 writes to Kid1",
    session: ADMIN1,
    request: { kind: "write", targetUserId: KID1.userId },
    allowed: true,
  },
  {
    rule: "admin reads and changes everything of both",
    name: "Admin1 writes to Kid2",
    session: ADMIN1,
    request: { kind: "write", targetUserId: KID2.userId },
    allowed: true,
  },
  {
    rule: "admin reads and changes everything of both",
    name: "Admin2 writes to Kid2",
    session: ADMIN2,
    request: { kind: "write", targetUserId: KID2.userId },
    allowed: true,
  },

  // Wider than CLAUDE.md's "tudo dos dois", on purpose: forbidding it needs the
  // target's role, a database read that would make `isAllowed` impure, to guard
  // an admin who has no balance, history or timer.
  {
    rule: "an admin is not restricted from the other admin",
    name: "Admin2 reads the other admin",
    session: ADMIN2,
    request: { kind: "view", targetUserId: ADMIN1.userId },
    allowed: true,
  },
  {
    rule: "an admin is not restricted from the other admin",
    name: "Admin1 writes to the other admin",
    session: ADMIN1,
    request: { kind: "write", targetUserId: ADMIN2.userId },
    allowed: true,
  },
  {
    rule: "an admin is not restricted from the other admin",
    name: "Admin1 reads his own row",
    session: ADMIN1,
    request: { kind: "view", targetUserId: ADMIN1.userId },
    allowed: true,
  },
  {
    rule: "admin reads and changes everything of both",
    name: "Admin1 simulates against Kid1's day",
    session: ADMIN1,
    request: { kind: "simulate", targetUserId: KID1.userId },
    allowed: true,
  },
];

/** The shape a mutant of `access.ts` has to keep for the table to run at all. */
export type IsAllowed = (session: Session, request: AccessRequest) => boolean;

export function failingCases(isAllowed: IsAllowed): AccessCase[] {
  return ACCESS_CASES.filter(
    (accessCase) =>
      isAllowed(accessCase.session, accessCase.request) !== accessCase.allowed,
  );
}
