/**
 * 2i-C: the context-data edit projection (doc 06 §6, doc 03 D19).
 *
 * The Data section serves, per entry, exactly what a checkpoint correction
 * needs — the patch identity and the raw recorded scalar off the latest
 * compatible checkpoint — or the reason it is not editable. Run-level policy
 * (`editing`) is computed from RAW authority lifecycle, never the coarse
 * queue status; a staged `envelope.injected` correction renders beside the
 * recorded value it will supersede, because until the resume replays it both
 * values are true.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { RunCheckpointRecordSchema } from "../../../src/domain/workflow/checkpoint.js";
import { buildRunSection } from "../../../src/server/dashboard/queries/run-detail.js";
import { HASH_A, HASH_B, NOW } from "../fixtures/phase1c-contract-fixtures.js";
import {
  claimEventOf,
  makeWorld,
  queuedEventOf,
  runRecordOf,
  traceOf,
  uuidOf,
  type DashboardWorld,
} from "./helpers/dashboard-harness.js";

const worlds: DashboardWorld[] = [];
function world(): DashboardWorld {
  const created = makeWorld();
  worlds.push(created);
  return created;
}
afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

const CLAIM = {
  workerId: "person-lookup-worker-1",
  claimedAt: "2026-08-03T17:00:05.000Z",
  heartbeatAt: "2026-08-03T17:00:05.000Z",
} as const;

const DATE_FIELDS_VIEW = {
  details: [],
  capabilities: {
    editData: {
      fields: [
        { nodeId: "crm-dates", fieldPath: "invitedOn.value", label: "Invited on" },
        { nodeId: "crm-dates", fieldPath: "startsOn.value", label: "Starts on" },
        { nodeId: "crm-dates", fieldPath: "completedOn.value", label: "Completed on" },
      ],
    },
  },
} as const;

function depsOf(w: DashboardWorld, view: unknown = DATE_FIELDS_VIEW) {
  return {
    stateRoot: w.stateRoot,
    projection: w.projection,
    authority: w.authority,
    descriptors: { resolve: () => view as never },
  };
}

function crmDatesCheckpoint(seed: number) {
  return RunCheckpointRecordSchema.parse({
    workflowId: "person-lookup",
    itemId: uuidOf(seed + 5000),
    nodeId: "crm-dates",
    attempt: 1,
    runId: uuidOf(seed),
    output: {
      schemaHash: HASH_A,
      value: {
        emplId: "10873698",
        invitedOn: { state: "present", value: "2026-06-01" },
        startsOn: { state: "present", value: "2026-07-15" },
        completedOn: { state: "absent", reason: "CRM history has no Completed transition" },
      },
    },
    descriptorVersion: 1,
    contractFingerprint: HASH_A,
    implFingerprint: HASH_B,
    provenance: [],
    writtenAt: NOW,
  });
}

function contextData(w: DashboardWorld, view: unknown = DATE_FIELDS_VIEW) {
  const response = buildRunSection(depsOf(w, view), uuidOf(1), "context-data");
  if (response.section !== "context-data") throw new Error("wrong section");
  return response.payload;
}

describe("context-data edit projection (2i-C)", () => {
  it("serves each recorded correctable field with its patch identity and the run's CAS basis", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({ seed: 1, version: 4 }));
    w.authority.putCheckpoint(crmDatesCheckpoint(1));

    const payload = contextData(w);
    assert.deepEqual(payload.editing, { state: "editable", expectedVersion: 4 });
    assert.equal(payload.entries.length, 3);

    const invited = payload.entries.find((entry) => entry.label === "Invited on");
    assert.ok(invited);
    assert.equal(invited.valueRedacted, "2026-06-01");
    assert.deepEqual(invited.edit, {
      state: "editable",
      nodeId: "crm-dates",
      fieldPath: "invitedOn.value",
      value: "2026-06-01",
      pendingCorrection: { state: "none" },
    });

    // The absent arm is a REAL recorded outcome: the row renders, says why it
    // cannot be corrected, and never fabricates a value to edit.
    const completed = payload.entries.find((entry) => entry.label === "Completed on");
    assert.ok(completed);
    assert.equal(completed.edit.state, "locked");
    if (completed.edit.state === "locked") {
      assert.match(completed.edit.reason, /carries no completedOn\.value/u);
    }
  });

  it("folds a detail and its editData declaration into ONE row — display from the fold, identity from the spec", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.writer.emit({
      t: "span.patched",
      ts: w.clock.now().toISOString(),
      workflow: "person-lookup",
      runId: uuidOf(1),
      attempt: 1,
      traceId: traceOf(1),
      spanPath: traceOf(1),
      updates: [{ key: "selection-status", value: "resolved" }],
    });
    w.authority.put(runRecordOf({ seed: 1, version: 2 }));
    w.authority.putCheckpoint(RunCheckpointRecordSchema.parse({
      workflowId: "person-lookup",
      itemId: uuidOf(5001),
      nodeId: "searching",
      attempt: 1,
      runId: uuidOf(1),
      output: { schemaHash: HASH_A, value: { selection: { status: "resolved" } } },
      descriptorVersion: 1,
      contractFingerprint: HASH_A,
      implFingerprint: HASH_B,
      provenance: [],
      writtenAt: NOW,
    }));

    const covering = {
      details: [{
        key: "selection-status",
        label: "Selection",
        source: { nodeId: "searching", fieldPath: "selection.status" },
      }],
      capabilities: {
        editData: {
          fields: [{ nodeId: "searching", fieldPath: "selection.status", label: "Selection" }],
        },
      },
    };
    const payload = contextData(w, covering);
    assert.equal(payload.entries.length, 1, "the detail and the editData field are the same leaf — one row");
    const selection = payload.entries[0];
    assert.ok(selection);
    assert.equal(selection.label, "Selection");
    assert.equal(selection.valueRedacted, "resolved");
    assert.equal(selection.edit.state, "editable");

    // Same world, a view that does NOT declare the field: locked with the reason.
    const notDeclared = contextData(w, { ...covering, capabilities: { editData: true } });
    const locked = notDeclared.entries[0];
    assert.ok(locked);
    assert.equal(locked.edit.state, "locked");
    if (locked.edit.state === "locked") {
      assert.match(locked.edit.reason, /not declared correctable/u);
    }
  });

  it("locks the run-level policy while a worker holds the claim — field identity stays served", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    w.authority.put(runRecordOf({
      seed: 1,
      lifecycle: { state: "running", ...CLAIM },
      claimGeneration: 1,
      version: 2,
    }));
    w.authority.putCheckpoint(crmDatesCheckpoint(1));

    const payload = contextData(w);
    assert.equal(payload.editing.state, "locked");
    if (payload.editing.state === "locked") {
      assert.match(payload.editing.reason, /claimed by a worker/u);
    }
    // The per-entry policy is the FIELD's own; run state is the section's.
    // The client composes the two — a wire that erased the identity here
    // would force a refetch the moment the claim releases.
    const invited = payload.entries.find((entry) => entry.label === "Invited on");
    assert.equal(invited?.edit.state, "editable");
  });

  it("names the terminal state when corrections no longer apply", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({
      seed: 1,
      lifecycle: { state: "terminal", outcome: "done", endedAt: "2026-08-03T17:10:00.000Z" },
      version: 3,
    }));
    w.authority.putCheckpoint(crmDatesCheckpoint(1));

    const payload = contextData(w);
    assert.equal(payload.editing.state, "locked");
    if (payload.editing.state === "locked") {
      assert.match(payload.editing.reason, /run is terminal/u);
    }
  });

  it("serves a staged correction beside the recorded value it will supersede", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({
      seed: 1,
      version: 5,
      injected: [{
        nodeId: "crm-dates",
        fieldPath: "invitedOn.value",
        value: "2026-06-02",
        correctedAt: "2026-08-03T17:30:00.000Z",
        reason: "CRM shows June 2; the read mis-parsed the date",
      }],
    }));
    w.authority.putCheckpoint(crmDatesCheckpoint(1));

    const invited = contextData(w).entries.find((entry) => entry.label === "Invited on");
    assert.ok(invited);
    // The RECORDED value stays the display truth; the staged value rides beside it.
    assert.equal(invited.valueRedacted, "2026-06-01");
    assert.deepEqual(invited.edit, {
      state: "editable",
      nodeId: "crm-dates",
      fieldPath: "invitedOn.value",
      value: "2026-06-01",
      pendingCorrection: {
        state: "pending",
        value: "2026-06-02",
        correctedAt: "2026-08-03T17:30:00.000Z",
      },
    });
  });

  it("omits a declared field whose step never recorded — the Data section lists what the run touched", () => {
    const w = world();
    queuedEventOf(w, { seed: 1 });
    w.authority.put(runRecordOf({ seed: 1 }));

    assert.deepEqual(contextData(w).entries, []);
  });
});
