/**
 * The gate age in the queue row's ACCESSIBLE NAME (ledger 1 B31).
 *
 * `statusAccessibleName(status, age?)` has taken the argument since D124, and
 * the row never gave it one: the age reached the screen only through the D12
 * pill, which is a visual chip no assistive technology reaches. So an operator
 * driving the queue by ear heard `waiting on you` on a gate opened two minutes
 * ago and on one opened four hours ago — the same sentence for the two rows the
 * whole band exists to separate.
 *
 * Both halves are pinned here: `queueGateAge` is the one fold the pill and the
 * name share (so they cannot disagree about one gate), and QueueRow consumes
 * `queueRowAccessibleName` rather than reconstructing it in the test.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { QueueSurfaceWireSchema } from "../../../src/domain/dashboard/projection.js";
import { QueueRow } from "../../../src/dashboard/surfaces/queue.js";
import {
  queueGateAge,
  queueRowAccessibleName,
} from "../../../src/dashboard/surfaces/queue-model.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-08-14T17:00:00.000Z";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

function surface(input: Record<string, unknown>) {
  return QueueSurfaceWireSchema.parse({
    runId: RUN_ID,
    itemId: "99999999-9999-4999-8999-999999999999",
    workflowId: "person-lookup",
    traceId: "pl-120000-1111",
    attempt: 1,
    lineage: { state: "root" },
    actorId: "local-operator",
    appVersion: { state: "present", value: "1.0.0" },
    descriptorVersion: 1,
    descriptorHash: HASH_A,
    configFingerprint: HASH_B,
    resolvedInstances: [],
    dryRun: false,
    priority: "interactive",
    runNumber: { state: "present", value: 1 },
    containment: "root",
    linkedRuns: [],
    facts: { state: "absent", reason: "run is running and has not produced a terminal result" },
    startedAt: NOW,
    updatedAt: NOW,
    endedAt: { state: "absent", reason: "run has not ended" },
    gateOpenedAt: { state: "absent", reason: "no gate has opened on this run" },
    displayName: { state: "absent", reason: "the operator has not renamed this run" },
    title: "Jordan Reyes",
    subtitle: { state: "absent", reason: "no second identifier" },
    liveMessage: { state: "absent", reason: "no message" },
    warnings: { state: "absent", reason: "no warning set has been derived" },
    pipeline: [],
    panelKind: "run",
    availableSections: ["logs"],
    actions: [],
    rowRevision: 1,
    surfaceKind: "single",
    status: "awaiting-approval",
    ...input,
  });
}

describe("queueGateAge (ledger 1 B31)", () => {
  it("measures the SERVED gate instant against the panel's calibrated now", () => {
    const row = surface({
      gateOpenedAt: { state: "present", value: "2026-08-14T16:42:00.000Z" },
    });
    assert.equal(queueGateAge(row, NOW), "18m 0s");
  });

  it("answers nothing for a row the server dated no gate on", () => {
    // The negative arm is the load-bearing one: an absent gate must speak no
    // age at all, never a `0s` nobody measured.
    assert.equal(queueGateAge(surface({ status: "running" }), NOW), undefined);
  });
});

describe("the row's accessible name carries the age", () => {
  // The STATUS WORD is this tree's own (`review` where the demo says `waiting
  // on you`) and is not what B31 is about — only the ` · {age}` suffix is.
  it("reads `{title} — {status} · {age}` (DemoQueue.tsx:818)", () => {
    const row = surface({
      gateOpenedAt: { state: "present", value: "2026-08-14T16:42:00.000Z" },
    });
    assert.equal(queueRowAccessibleName(row, NOW), "Jordan Reyes — review · 18m 0s");
  });

  it("leaves an ungated row's name exactly as it was", () => {
    const row = surface({ status: "running" });
    assert.equal(queueRowAccessibleName(row, NOW), "Jordan Reyes — running");
  });

  it("renders the production QueueRow press target with the composed gate age", () => {
    const row = surface({
      gateOpenedAt: { state: "present", value: "2026-08-14T16:42:00.000Z" },
    });
    const markup = renderToStaticMarkup(createElement(QueueRow, {
      surface: row,
      state: {
        openWells: new Set<string>(),
        panelWorkflowId: "person-lookup",
        nowIso: NOW,
      },
      handlers: { onSelect: () => undefined },
      workflowLabelOf: () => "Person Lookup",
    }));

    assert.ok(markup.includes('aria-label="Jordan Reyes — review · 18m 0s"'));
  });
});
