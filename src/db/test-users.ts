import type { Connection } from "./client";
import { writeTransaction } from "./client";
import type { NewUser } from "./schema";
import { users } from "./schema";
import { seedDatabase } from "./seed";

/**
 * Tests only. The app never writes `users` (D45), so a test database gets its
 * people here, in the order that gives ids 1 to 4.
 */
export const TEST_USERS: readonly NewUser[] = [
  { username: "admin1", displayName: "Admin1", role: "admin" },
  { username: "admin2", displayName: "Admin2", role: "admin" },
  { username: "kid1", displayName: "Kid1", role: "kid" },
  { username: "kid2", displayName: "Kid2", role: "kid" },
];

export function insertTestUsers(connection: Connection): void {
  writeTransaction(connection, (tx) => {
    tx.insert(users)
      .values([...TEST_USERS])
      .run();
  });
}

/** `seedDatabase` plus the test people, the state every screen test starts from. */
export function seedWithTestUsers(connection: Connection): void {
  seedDatabase(connection);
  insertTestUsers(connection);
}
