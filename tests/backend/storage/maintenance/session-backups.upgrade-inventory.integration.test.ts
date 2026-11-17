import { afterEach, describe, expect, it } from "vitest";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { createSessionBackups } from "../../../../src/backend/storage/maintenance/session-backups.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { join } from "node:path";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe("stopped upgrade admission with an in-session backup", () => {
  it("inventories a retained session backup", async () => {
    const bound = await createBoundProfileFixture();
    const clock = manualClock(new Date("2026-11-16T09:00:00.000Z"));
    const database = AuthorityDatabase.open(bound.admission, { path: bound.path, busyTimeoutMs: 250, migrationOwner: "upgrade-inventory" },
      clock, undefined, undefined, undefined, boundProfileCredentials(bound.admission));
    cleanups.push(async () => { database.close(); await bound.close(); });
    const sessionBackups = createSessionBackups({ admission: bound.admission, database, clock, directory: join(bound.stateRoot, "backups", "authority") });
    try { expect(await sessionBackups.check()).toBe("taken"); } finally { sessionBackups.requestCancellation(); await sessionBackups.awaitCancellation(); }
    database.close();
    const operation = bound.machine.acquireOfflineMaintenance();
    operation.consume();
    try {
      const owner = await bound.machine.forStartupProfileUpgrade(profileBrowserClosure, bound.admission.profileBinding.profileId, operation, clock, { primaryDisplay: null });
      owner.release();
    } finally { operation.release(); }
  });
});
