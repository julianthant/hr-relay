
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { StorageDoctorWireSchema } from "../../../../../src/models/dashboard/storage.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { RUN_ID } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../../../../support/helpers/phase1f-executor-harness.js";

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  it("serves the read-only storage doctor on demand (2i-D)", async () => {
    const h = await harness();
    const response = await h.app.request("/api/v1/storage/doctor");
    assert.equal(response.status, 200);
    const report = StorageDoctorWireSchema.parse(await response.json());
    assert.equal(report.mode, "read-only");
    assert.equal(report.authority.state, "healthy");
    if (report.authority.state === "healthy") {
      assert.equal(report.authority.authorityGeneration, h.database.getMeta().authorityGeneration);
    }
    assert.equal(report.counts.state, "available");
    // The harness runs no backup lane: the on-disk truth is missing, and the
    // service arm says why in its own words rather than an inferred blank.
    assert.equal(report.backup.state, "missing");
    assert.deepEqual(report.spanAuthority, {
      state: "reconciled",
      liveRunCount: 0,
      streamRunCount: 0,
      archived: [],
      deleted: [],
    });
    assert.deepEqual(report.restoreCandidates, []);
    assert.deepEqual(report.service, {
      state: "never-run",
      reason: "the test harness runs no backup lane",
    });

    // The same summary reaches bootstrap: authority probed, backup indicator real.
    const boot = await json(await h.app.request("/api/v1/bootstrap"));
    const storage = boot.storage as { authority: string; backup: string };
    assert.equal(storage.authority, "healthy");
    assert.equal(storage.backup, "missing");
    const sections = boot.settingsSections as { id: string; label: string }[];

    assert.deepEqual(sections, [
      { id: "storage", label: "Storage checks", revision: 1 },
      { id: "workflow-capabilities", label: "Workflow capabilities", revision: 1 },
    ]);
  });

  it("serves a sanitized span-stream structural diagnosis through the real storage doctor", async () => {
    const h = await harness();
    const run = RunRecordSchema.parse(personLookupQueuedRun({ runId: RUN_ID }));
    h.database.authority.runs.enqueue(run);
    createTimelineEmitter({ repository: h.database.authority.timelineEvents, clock: h.clock, pid: 4242 }).emit({
      t: "run.queued",
      kind: "run",
      ts: run.envelope.enqueuedAt,
      workflow: run.envelope.workflow,
      runId: run.envelope.runId,
      attempt: run.envelope.attempt,
      traceId: run.envelope.traceId,
      spanPath: `${run.envelope.traceId}/foreign-root`,
      itemId: run.envelope.itemId,
      shape: run.envelope.shape,
      priority: run.envelope.priority,
      dryRun: run.envelope.dryRun,
      actorId: "local-operator",
      title: "malformed root path fixture",
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
      resolvedInstance: run.envelope.resolvedInstance,
      configFingerprint: run.envelope.configFingerprint,
      configSnapshotId: run.envelope.configSnapshotId,
    });

    const response = await h.app.request("/api/v1/storage/doctor");

    assert.equal(response.status, 200);
    const report = StorageDoctorWireSchema.parse(await response.json());
    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("span structural corruption must degrade the doctor wire");
    assert.deepEqual(report.spanAuthority.problems, [{
      state: "malformed",
      runId: run.envelope.runId,
      table: "span_stream",
      summary: "run.queued root spanPath does not equal traceId",
    }]);
  });


});

import { disposeHttpRouteHarness, harness, json } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);
