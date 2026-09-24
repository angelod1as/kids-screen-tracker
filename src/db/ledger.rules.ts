import { asc } from "drizzle-orm";

import type { AdminWorld } from "./admin.rules";
import { LAUNCHED_AT, TODAY } from "./admin.rules";
import type { Connection } from "./client";
import type { Refund, Release } from "./ledger";
import { THAT_DAY } from "./queue.rules";
import { ledger } from "./schema";

/**
 * The rules of #23 and #24, on the launch's world, run by `ledger.test.ts`
 * and the sabotage matrix.
 */

export type LedgerModule = {
  releaseHours: (
    connection: Connection,
    release: Release,
    adminId: number,
    now: Date,
  ) => { hours: number; occurredOn: string };
  refundHours: (
    connection: Connection,
    refund: Refund,
    adminId: number,
    now: Date,
  ) => { hours: number };
};

export type LedgerCase = {
  rule: string;
  name: string;
  run: (movements: LedgerModule, world: AdminWorld) => unknown;
  expected: unknown;
};

function refused(body: () => void): string {
  try {
    body();
  } catch (thrown) {
    return `refused: ${(thrown as Error).message}`;
  }

  return "not refused";
}

/** With destination and note: a column no case reads is one a mutation can empty. */
function movementsText(world: AdminWorld): string {
  const rows = world.connection.db
    .select({
      userId: ledger.userId,
      kind: ledger.kind,
      hours: ledger.hours,
      occurredOn: ledger.occurredOn,
      destination: ledger.destination,
      note: ledger.note,
      createdBy: ledger.createdBy,
    })
    .from(ledger)
    .orderBy(asc(ledger.id))
    .all();

  return rows.length === 0
    ? "no ledger"
    : rows
        .map(
          (row) =>
            `${row.kind} ${row.hours} on ${row.occurredOn} to ${row.userId} by ${row.createdBy} · ${row.destination ?? "nowhere"} · ${row.note ?? "no reason"}`,
        )
        .join(" | ");
}

/** Two hours earned, so a refund has something to sit beside. */
function earn(world: AdminWorld, hours: number): void {
  world.connection.db
    .insert(ledger)
    .values({
      userId: world.kidId,
      kind: "earn",
      hours,
      occurredOn: THAT_DAY,
      createdBy: world.adminId,
    })
    .run();
}

export const LEDGER_CASES: readonly LedgerCase[] = [
  {
    rule: "releasing debits the boy it was released for",
    name: "two hours to the Xbox, today, by the adult who did it",
    run: (movements, world) => {
      movements.releaseHours(
        world.connection,
        { userId: world.kidId, hours: 2, destination: "Xbox" },
        world.adminId,
        LAUNCHED_AT,
      );

      return movementsText(world);
    },
    expected: `spend 2 on ${TODAY} to 3 by 1 · Xbox · no reason`,
  },
  {
    rule: "releasing debits the boy it was released for",
    name: "it comes off the balance",
    run: (movements, world) => {
      earn(world, 5);
      movements.releaseHours(
        world.connection,
        { userId: world.kidId, hours: 1.5 },
        world.adminId,
        LAUNCHED_AT,
      );

      return world.balance(world.kidId);
    },
    expected: 3.5,
  },
  {
    rule: "releasing debits the boy it was released for",
    name: "a destination is optional",
    run: (movements, world) => {
      movements.releaseHours(
        world.connection,
        { userId: world.kidId, hours: 1, destination: "   " },
        world.adminId,
        LAUNCHED_AT,
      );

      return movementsText(world);
    },
    expected: `spend 1 on ${TODAY} to 3 by 1 · nowhere · no reason`,
  },
  {
    rule: "releasing debits the boy it was released for",
    name: "it lands on the boy it names and on nobody else",
    run: (movements, world) => {
      movements.releaseHours(
        world.connection,
        { userId: world.otherKidId, hours: 1 },
        world.adminId,
        LAUNCHED_AT,
      );

      return `${world.balance(world.kidId)} · ${world.balance(world.otherKidId)}`;
    },
    expected: "0 · -1",
  },

  {
    rule: "the balance may go below zero, without limit",
    name: "five hours released against an empty balance",
    run: (movements, world) => {
      movements.releaseHours(
        world.connection,
        { userId: world.kidId, hours: 5 },
        world.adminId,
        LAUNCHED_AT,
      );

      return world.balance(world.kidId);
    },
    expected: -5,
  },
  {
    rule: "the balance may go below zero, without limit",
    name: "and again, on top of a balance that is already below zero",
    run: (movements, world) => {
      movements.releaseHours(
        world.connection,
        { userId: world.kidId, hours: 5 },
        world.adminId,
        LAUNCHED_AT,
      );
      movements.releaseHours(
        world.connection,
        { userId: world.kidId, hours: 4 },
        world.adminId,
        LAUNCHED_AT,
      );

      return world.balance(world.kidId);
    },
    expected: -9,
  },
  {
    rule: "the balance may go below zero, without limit",
    name: "more than a boy has is not a refusal",
    run: (movements, world) => {
      earn(world, 1);

      return refused(() =>
        movements.releaseHours(
          world.connection,
          { userId: world.kidId, hours: 3 },
          world.adminId,
          LAUNCHED_AT,
        ),
      );
    },
    expected: "not refused",
  },

  {
    rule: "a refund adds, like an entry does",
    name: "two hours back, on the day they are credited to, with the reason",
    run: (movements, world) => {
      movements.refundHours(
        world.connection,
        {
          userId: world.kidId,
          hours: 2,
          occurredOn: THAT_DAY,
          reason: "O Xbox ficou fora do ar",
        },
        world.adminId,
        LAUNCHED_AT,
      );

      return movementsText(world);
    },
    expected: `refund 2 on ${THAT_DAY} to 3 by 1 · nowhere · O Xbox ficou fora do ar`,
  },
  {
    rule: "a refund adds, like an entry does",
    name: "it moves the balance the same way an entry does",
    run: (movements, world) => {
      earn(world, 3);
      movements.refundHours(
        world.connection,
        {
          userId: world.kidId,
          hours: 2,
          occurredOn: THAT_DAY,
          reason: "cortou a luz",
        },
        world.adminId,
        LAUNCHED_AT,
      );

      return world.balance(world.kidId);
    },
    expected: 5,
  },
  {
    rule: "a refund adds, like an entry does",
    name: "it gives back what a release took",
    run: (movements, world) => {
      movements.releaseHours(
        world.connection,
        { userId: world.kidId, hours: 2, destination: "PlayStation" },
        world.adminId,
        LAUNCHED_AT,
      );
      movements.refundHours(
        world.connection,
        {
          userId: world.kidId,
          hours: 2,
          occurredOn: TODAY,
          reason: "não deu para jogar",
        },
        world.adminId,
        LAUNCHED_AT,
      );

      return world.balance(world.kidId);
    },
    expected: 0,
  },
  {
    rule: "a refund adds, like an entry does",
    name: "a refund with no reason is refused",
    run: (movements, world) =>
      refused(() =>
        movements.refundHours(
          world.connection,
          {
            userId: world.kidId,
            hours: 2,
            occurredOn: THAT_DAY,
            reason: "   ",
          },
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected: "refused: a refund needs a reason",
  },
  {
    rule: "a refund adds, like an entry does",
    name: "a refund dated tomorrow is refused",
    run: (movements, world) =>
      refused(() =>
        movements.refundHours(
          world.connection,
          {
            userId: world.kidId,
            hours: 2,
            occurredOn: "2026-09-14",
            reason: "adiantado",
          },
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected:
      "refused: 2026-09-14 has not happened yet: the date is today or earlier",
  },

  {
    rule: "what an adult types is checked before it reaches a column",
    name: "nothing is not an amount",
    run: (movements, world) =>
      refused(() =>
        movements.releaseHours(
          world.connection,
          { userId: world.kidId, hours: 0 },
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected:
      "refused: what is released is a number of hours of 0.01 or more, received 0",
  },
  {
    rule: "what an adult types is checked before it reaches a column",
    name: "neither is a negative amount",
    run: (movements, world) =>
      refused(() =>
        movements.refundHours(
          world.connection,
          {
            userId: world.kidId,
            hours: -2,
            occurredOn: THAT_DAY,
            reason: "erro",
          },
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected:
      "refused: what is refunded is a number of hours of 0.01 or more, received -2",
  },
  {
    rule: "what an adult types is checked before it reaches a column",
    name: "nor is infinity, which every one-sided check lets through",
    run: (movements, world) =>
      refused(() =>
        movements.releaseHours(
          world.connection,
          { userId: world.kidId, hours: Number.POSITIVE_INFINITY },
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected:
      "refused: what is released is a number of hours of 0.01 or more, received Infinity",
  },
  {
    rule: "what an adult types is checked before it reaches a column",
    name: "an amount is held to the two decimals D9 rounds to",
    run: (movements, world) => {
      movements.releaseHours(
        world.connection,
        { userId: world.kidId, hours: 1.239 },
        world.adminId,
        LAUNCHED_AT,
      );

      // Off the row: the balance is rounded on its way out (D9).
      return movementsText(world);
    },
    expected: `spend 1.24 on ${TODAY} to 3 by 1 · nowhere · no reason`,
  },
  {
    rule: "what an adult types is checked before it reaches a column",
    name: "an amount above the ceiling is refused in words",
    run: (movements, world) =>
      refused(() =>
        movements.releaseHours(
          world.connection,
          { userId: world.kidId, hours: 1_000_001 },
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    // The column CHECK would refuse it too, with a constraint name.
    expected:
      "refused: what is released is at most 1000000 hours, received 1000001",
  },
  {
    rule: "what an adult types is checked before it reaches a column",
    name: "and so is a refund above it",
    run: (movements, world) =>
      refused(() =>
        movements.refundHours(
          world.connection,
          {
            userId: world.kidId,
            hours: 1e9,
            occurredOn: THAT_DAY,
            reason: "zeros demais",
          },
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected:
      "refused: what is refunded is at most 1000000 hours, received 1000000000",
  },
  {
    rule: "what an adult types is checked before it reaches a column",
    name: "a destination longer than the field allows is refused",
    run: (movements, world) =>
      refused(() =>
        movements.releaseHours(
          world.connection,
          { userId: world.kidId, hours: 1, destination: "x".repeat(501) },
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected: "refused: a destination is at most 500 characters, received 501",
  },

  {
    rule: "only a boy who is switched on can be written for",
    name: "a deactivated boy cannot be released for",
    run: (movements, world) => {
      world.setUserActive(world.kidId, false);

      return `${refused(() =>
        movements.releaseHours(
          world.connection,
          { userId: world.kidId, hours: 1 },
          world.adminId,
          LAUNCHED_AT,
        ),
      ).replace(/user \d+/, "user N")} — ${movementsText(world)}`;
    },
    expected:
      "refused: user N is not a boy this can be written for (D14, D33) — no ledger",
  },
  {
    rule: "only a boy who is switched on can be written for",
    name: "an adult cannot be refunded",
    run: (movements, world) =>
      refused(() =>
        movements.refundHours(
          world.connection,
          {
            userId: world.adminId,
            hours: 1,
            occurredOn: THAT_DAY,
            reason: "para mim",
          },
          world.adminId,
          LAUNCHED_AT,
        ),
      ).replace(/user \d+/, "user N"),
    expected: "refused: user N is not a boy this can be written for (D14, D33)",
  },
  {
    rule: "only a boy who is switched on can be written for",
    name: "somebody who does not exist cannot be released for",
    run: (movements, world) =>
      refused(() =>
        movements.releaseHours(
          world.connection,
          { userId: 9999, hours: 1 },
          world.adminId,
          LAUNCHED_AT,
        ),
      ),
    expected: "refused: there is no user 9999",
  },
];

/** A fresh world per case. */
export function failingLedgerCases(
  movements: LedgerModule,
  worlds: () => AdminWorld,
): LedgerCase[] {
  return LEDGER_CASES.filter((ledgerCase) => {
    const world = worlds();

    try {
      return ledgerCase.run(movements, world) !== ledgerCase.expected;
    } catch (thrown) {
      return `threw: ${(thrown as Error).message}` !== ledgerCase.expected;
    } finally {
      world.connection.sqlite.close();
    }
  });
}
