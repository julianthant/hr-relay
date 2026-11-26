import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { planCopySeed } from "../../../../scripts/profiles/seed-copy.js";
import { composeWorkerRuntime } from "../../../../src/backend/app/composition/worker-compose.js";
import { WORKFLOW_MODULES, workflowQueueCapabilities } from "../../../../src/backend/app/registries/workflow-registry.js";
import { COPY_HISTORY_SEED_BUILD, historyArchivePath, writeCopyHistorySeed } from "../../../../src/backend/storage/sqlite/isolated-history-store.js";
import { runRecordFromRow } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { SAMPLE_WORKER_ORDINAL_FLOOR } from "../../../../src/models/run/worker-slot.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { createWorkerCompositionTestWorld } from "../../../support/helpers/backend/worker-composition-world.js";
import { happySessionHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const { NOW, POOL_INDEX_1, repoRootWithState, reopen, composeInput, cleanup } = createWorkerCompositionTestWorld();
afterEach(cleanup);

it("polls an admitted worker beside a seeded copy's live sample runs and claims none and opens no browser", async () => {
  const { repoRoot, stateRoot, fixture } = await repoRootWithState();
  const clock = manualClock(new Date(NOW));
  mkdirSync(join(stateRoot, "files"), { recursive: true, mode: 0o700 });
  const archive = historyArchivePath(stateRoot);
  const local = new DatabaseSync(fixture.path, { readOnly: true });
  try {
    writeCopyHistorySeed(local, archive, fixture.admission.profileBinding, false, { fromDay: "2026-05-06", build: existing => planCopySeed({ now: clock.now(),
      existing, modules: WORKFLOW_MODULES, capabilities: workflowQueueCapabilities, profileId: fixture.admission.profileBinding.profileId, buildId: COPY_HISTORY_SEED_BUILD }) });
  } finally { local.close(); }
  const readSamples = () => {
    const database = new DatabaseSync(archive, { readOnly: true });
    try { return database.prepare("SELECT * FROM runs WHERE id IN (SELECT id FROM copy_seed_members WHERE kind='run') ORDER BY id").all().map(runRecordFromRow); }
    finally { database.close(); }
  };
  const before = readSamples();
  assert.ok(before.some(run => run.envelope.workflow === WORKFLOW_ID && run.lifecycle.state === "queued"), "the archive holds a claimable-looking sample");

  const sessions = happySessionHarness();
  const report = await composeWorkerRuntime(composeInput({ repoRoot, clock, sessions, poolIndex: POOL_INDEX_1 }));
  assert.equal(report.stopped, "idle");
  assert.deepEqual(report.outcomes, []);
  assert.equal(sessions.opens(), 0);
  assert.deepEqual(readSamples(), before);
  const operational = reopen(stateRoot, clock);
  assert.deepEqual(before.filter(run => operational.authority.runs.get(run.envelope.runId) !== undefined), []);

  // Real slot allocation stops at the sample floor, so a sample card never shares a real worker's identity.
  operational.withAuthorityTransaction(repositories => {
    const slot = repositories.workerSlots.active(WORKFLOW_ID)[0];
    assert.ok(slot !== undefined && slot.ordinal <= SAMPLE_WORKER_ORDINAL_FLOOR);
  });
}, 60_000);
