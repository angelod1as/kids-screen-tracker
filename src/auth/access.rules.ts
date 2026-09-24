import type { AccessRequest, Session } from "./access";

/**
 * The access rule of #13, written out one case at a time.
 *
 * This table is exported rather than living inside `access.test.ts` because
 * two files run it: the ordinary test, which asserts the real `isAllowed`
 * answers every case correctly, and `access.sabotage.test.ts`, which rewrites
 * the source of `access.ts` one clause at a time and asserts that each mutant
 * gets at least one of these wrong.
 *
 * That second use is the reason the cases are data. A rule with no case that
 * can distinguish it from its own absence is not being tested, and the only
 * way to find out which rules those are is to delete each rule and watch what
 * stays green.
 *
 * The ids below are the seeded ones: 1 Admin1, 2 Admin2, 3 Kid1, 4 Kid2.
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
  // --- Kid acessa e simula apenas os próprios dados ---
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

  // --- Kid nunca vê o saldo do outro: a requisição forjada ---
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

  // --- Kid não escreve nada além de propor um log via cronômetro ---
  {
    rule: "the timer proposal is the kid's only write",
    name: "Kid1 proposes a timer log for himself",
    session: KID1,
    request: { kind: "proposeTimerLog", targetUserId: KID1.userId },
    allowed: true,
  },
  {
    rule: "the timer proposal is the kid's only write",
    name: "Kid1 proposes a timer log in Kid2's name",
    session: KID1,
    request: { kind: "proposeTimerLog", targetUserId: KID2.userId },
    allowed: false,
  },
  {
    rule: "the timer proposal is the kid's only write",
    name: "Kid1 writes something else to his own data",
    session: KID1,
    request: { kind: "write", targetUserId: KID1.userId },
    allowed: false,
  },
  {
    rule: "the timer proposal is the kid's only write",
    name: "Kid2 writes something else to Kid1's data",
    session: KID2,
    request: { kind: "write", targetUserId: KID1.userId },
    allowed: false,
  },

  // --- Admin acessa e altera tudo dos dois ---
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

  // --- Admin acessa e altera tudo dos dois, e não para no outro admin ---
  //
  // Its own rule, because it is not the sentence CLAUDE.md writes. "Admin vê e
  // altera tudo dos dois" is about the two boys; an admin reading the other
  // admin is wider than that, and round 2 was right that it was decided by a
  // table row nobody had discussed. It is decided here instead, deliberately:
  //
  // - the two admins are the two parents of the same two boys, and every
  //   screen either of them opens is about a boy, not about the other parent;
  // - restricting it would mean `isAllowed` knowing the *target's* role, which
  //   it cannot: it is a pure function of the session and the request, and the
  //   only way to learn a target's role is a database read. Making the rule
  //   impure to forbid something with no data behind it — an admin has no
  //   balance, no history, no timer — buys nothing and costs the property that
  //   makes the sabotage matrix possible;
  // - and it is not silent any more. It is three cases, under a rule of its
  //   own, so the coverage computation names it.
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

/**
 * Runs the whole table against `isAllowed` and returns the cases it got wrong.
 *
 * Empty means the implementation agrees with #13 on every case; anything else
 * is what a mutant is expected to produce.
 */
export function failingCases(isAllowed: IsAllowed): AccessCase[] {
  return ACCESS_CASES.filter(
    (accessCase) =>
      isAllowed(accessCase.session, accessCase.request) !== accessCase.allowed,
  );
}
