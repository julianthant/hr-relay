/**
 * 2i-C: `editPolicyFor` — doc 03 D19's unlock rule with the reason always
 * shown. A row is editable only when its own field policy, the run-level
 * policy served with the section, and the LIVE queue status all agree, and
 * whichever one disagrees supplies the exact sentence on the lock.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  editPolicyFor,
  liveLockReasonOf,
  type ContextDataEntry,
  type ContextDataPayload,
} from "../../../src/dashboard/surfaces/context-rail.js";

const EDITABLE_ENTRY = {
  label: "Invited on",
  valueRedacted: "2026-06-01",
  edit: {
    state: "editable",
    nodeId: "crm-dates",
    fieldPath: "invitedOn.value",
    value: "2026-06-01",
    pendingCorrection: { state: "none" },
  },
} as ContextDataEntry;

const EDITABLE_RUN = { state: "editable", expectedVersion: 4 } as ContextDataPayload["editing"];

describe("editPolicyFor", () => {
  it("is editable only when field, run, and live status all agree", () => {
    const policy = editPolicyFor(EDITABLE_ENTRY, EDITABLE_RUN, undefined);
    assert.deepEqual(policy, {
      kind: "editable",
      nodeId: "crm-dates",
      fieldPath: "invitedOn.value",
      recorded: "2026-06-01",
      pending: undefined,
    });
  });

  it("the field's own lock wins with its own reason — it is the most specific", () => {
    const entry = {
      ...EDITABLE_ENTRY,
      edit: { state: "locked", reason: "not declared correctable by this workflow" },
    } as ContextDataEntry;
    const locked = editPolicyFor(entry, { state: "locked", reason: "run is running" }, "live lock");
    assert.deepEqual(locked, { kind: "locked", reason: "not declared correctable by this workflow" });
  });

  it("the run-level lock covers every row alike", () => {
    const locked = editPolicyFor(
      EDITABLE_ENTRY,
      { state: "locked", reason: "run is terminal" },
      undefined,
    );
    assert.deepEqual(locked, { kind: "locked", reason: "run is terminal" });
  });

  it("the live signal locks a section the server served editable", () => {
    const reason = liveLockReasonOf("running");
    assert.ok(reason !== undefined);
    const locked = editPolicyFor(EDITABLE_ENTRY, EDITABLE_RUN, reason);
    assert.equal(locked.kind, "locked");
    if (locked.kind === "locked") assert.match(locked.reason, /now running/u);
  });

  it("carries a staged correction through to the policy", () => {
    const entry = {
      ...EDITABLE_ENTRY,
      edit: {
        ...EDITABLE_ENTRY.edit,
        pendingCorrection: {
          state: "pending",
          value: "2026-06-02",
          correctedAt: "2026-08-03T17:30:00.000Z",
        },
      },
    } as ContextDataEntry;
    const policy = editPolicyFor(entry, EDITABLE_RUN, undefined);
    assert.equal(policy.kind, "editable");
    if (policy.kind === "editable") {
      assert.deepEqual(policy.pending, { value: "2026-06-02", correctedAt: "2026-08-03T17:30:00.000Z" });
    }
  });
});

describe("liveLockReasonOf", () => {
  it("stays quiet exactly while the run remains resumable", () => {
    assert.equal(liveLockReasonOf(undefined), undefined);
    assert.equal(liveLockReasonOf("queued"), undefined);
    assert.equal(liveLockReasonOf("awaiting-approval"), undefined);
  });

  it("names the moved state for everything else", () => {
    for (const status of ["running", "done", "failed", "cancelled", "blocked", "partial"]) {
      const reason = liveLockReasonOf(status);
      assert.ok(reason !== undefined, status);
      assert.match(reason, new RegExp(`now ${status}`, "u"));
    }
  });
});
