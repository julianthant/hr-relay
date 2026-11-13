import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { upgradeRegisteredPersonStores } from "../../../../src/backend/app/composition/storage-compose.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { createBrowserRoots } from "../../../../src/backend/storage/browser-roots.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { readProfileDatabaseBinding } from "../../../../src/backend/storage/sqlite/profile-local-databases.js";
import { DuoReenrolOperationSchema } from "../../../../src/models/profiles/profile.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { restoreSchema18WorkbookReferenceFixture, removeEmptySchema18WorkbookCatalog, removeEmptySchema17OcrReview, removeSchema15RunPause,
  removeEmptyExclusiveSessionLeaseFixture } from "../../../support/fixtures/storage/historical-run-schema.js";
import { removeSchema16PersonPreferences } from "../../../support/fixtures/storage/person-preferences-predecessor.js";
import { restorePreReadingArtifactRetention } from "../../../support/fixtures/storage/pre-reading-artifact-retention.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { restoreEmptyPreMasterWorkbookFixture } from "../../../support/helpers/workbooks/pre-master-schema.js";

const hostFacts = { primaryDisplay: null };

/** Rewinds a current authority database to schema 10, so the next boot runs the stopped startup upgrade. */
function historicalTen(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec("BEGIN EXCLUSIVE");
    restoreSchema18WorkbookReferenceFixture(database);
    removeEmptySchema18WorkbookCatalog(database);
    removeEmptySchema17OcrReview(database);
    removeSchema16PersonPreferences(database);
    removeSchema15RunPause(database);
    removeEmptyExclusiveSessionLeaseFixture(database);
    restoreEmptyPreMasterWorkbookFixture(database);
    restorePreReadingArtifactRetention(database);
    database.exec("UPDATE database_states SET schema_version=10 WHERE id=1; PRAGMA user_version=10; COMMIT");
  }
  finally { database.close(); }
}

/** A ready person whose open Duo re-enrolment registered its setup browser root, then quit with the database at schema 10. */
async function registeredReenrolRoot(lifetime: RuntimeLifetimeLock) {
  const f = await createBoundProfileFixture({ lifetime });
  const profileId = f.admission.profileBinding.profileId;
  const operation = DuoReenrolOperationSchema.parse({ schemaVersion: 1, kind: "duo-reenrol", operationId: randomUUID(), profileId,
    createdAt: systemClock.now().toISOString(), draft: { accountId: randomUUID(), generation: 1, attempts: [] } });
  f.machine.publishProfileOperation(operation);
  const launch = createBrowserRoots(f.machine).beginSignupLaunch({ profileId, profileRoot: join(f.machine.stateRoot, "browsers", "onboarding"),
    credentialFingerprint: null, owner: { kind: "signup", operationId: operation.operationId, accountId: operation.draft.accountId, providerGeneration: operation.draft.generation } });
  mkdirSync(launch.input.profileDirectory, { recursive: true, mode: 0o700 }); launch.opened();
  const operationPath = join(f.machine.stateRoot, "machine", "operations", `${operation.operationId}.json`);
  await f.closeController(); historicalTen(f.path);
  return { f, operationPath, profileDirectory: launch.input.profileDirectory };
}

it("upgrades a person at boot whose registered setup browser root belongs to their open Duo re-enrolment draft", async () => {
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  const { f, operationPath, profileDirectory } = await registeredReenrolRoot(lifetime);
  try {
    const operation = readFileSync(operationPath);
    await upgradeRegisteredPersonStores(f.workspace, lifetime, hostFacts);
    // A held person keeps their schema; only an inventory that bound the root to its draft lets the upgrade run.
    assert.equal(readProfileDatabaseBinding(f.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.deepEqual(readFileSync(operationPath), operation);
    assert.equal(existsSync(profileDirectory), true);
  } finally { await f.close(); await lifetime.close(); }
});
