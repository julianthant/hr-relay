import { CLOCK, testRoot, admissionFor, openDatabase, backupDirectory, emitQueuedSpan, createBackup } from "./storage-recovery-fixtures.js";
import { rmSync } from "node:fs";
import { boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { MonotonicDeadlineScheduler } from "../../../../src/backend/runtime/scheduling/deadline-scheduler.js";
import { executePreflightRunner } from "../../../../src/models/preflight/preflight.js";
import { AuthorityHealthPreflightRunner } from "../../../../src/backend/storage/sqlite/index.js";

const PASSIVE_DEADLINE_SCHEDULER: MonotonicDeadlineScheduler = Object.freeze({
  schedule: () => Object.freeze({ cancel: () => undefined }),
});

describe("authority.health preflight and static recovery boundary", () => {
  it("fails authority.health when a span-known run has no exact authority", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    await createBackup(database, directory);
    emitQueuedSpan(root);
    const runner = new AuthorityHealthPreflightRunner(admissionFor(authorityPath), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      busyTimeoutMs: 100,
    }, CLOCK);

    const observation = await executePreflightRunner(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);

    assert.equal(observation.state, "unhealthy");
    assert.match(observation.summary, /span authority is degraded/);
  });

  it("projects doctor health through the registered authority.health runner", async () => {
    const root = await testRoot();
    const authorityPath = join(root, "state.db");
    const directory = backupDirectory(root);
    const database = openDatabase(authorityPath);
    await createBackup(database, directory);
    const runner = new AuthorityHealthPreflightRunner(admissionFor(authorityPath), {
      stateRootTrustAnchor: root,
      stateRoot: root,
      authorityPath,
      backupDirectory: directory,
      busyTimeoutMs: 100,
    }, CLOCK, boundProfileCredentials(admissionFor(authorityPath)));
    const healthy = await executePreflightRunner(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);
    assert.equal(healthy.state, "healthy");

    rmSync(directory, { recursive: true });
    const withoutBackup = await executePreflightRunner(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);

    assert.equal(withoutBackup.state, "healthy");
    assert.doesNotMatch(withoutBackup.summary, /backup/i);
  });
});
