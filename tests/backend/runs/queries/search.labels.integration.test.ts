import assert from "node:assert/strict";
import { it } from "vitest";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { measuredSearchService } from "../../../support/helpers/backend/cross-date-search-harness.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

it("serves only a recorded display name and keeps it separate from indexed subject facts", async () => {
  const profile = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-09-21T12:00:00Z"));
  const database = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 500, migrationOwner: "search-display-name" }, clock);
  try {
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    const named = runRecordOf({ seed: 4121, displayName: "Intake packet" });
    const unnamed = runRecordOf({ seed: 4122 });
    database.authority.runs.enqueue(named);
    database.authority.runs.enqueue(unnamed);
    const search = measuredSearchService(database, { clock, sourceIdentity: database.getSourceDatabaseIdentity(),
      cursorSigningKey: new Uint8Array(32).fill(9), descriptors: { resolve: () => undefined } });
    const page = search.search({ q: "" });
    assert.equal(page.results.find(row => row.runId === named.envelope.runId)?.displayTitle, "Intake packet");
    assert.equal(page.results.find(row => row.runId === unnamed.envelope.runId)?.displayTitle, undefined);
    assert.ok(page.results.every(row => row.metadata.subject.state === "unavailable"));
    assert.equal(page.coverage.subjectUnavailable, 2);
    assert.equal(search.search({ q: "Intake packet" }).totalMatches, 0);
    assert.deepEqual(search.searchSelected({ q: "" }, page.snapshot.token), page);
  } finally { database.close(); await profile.close(); }
});
