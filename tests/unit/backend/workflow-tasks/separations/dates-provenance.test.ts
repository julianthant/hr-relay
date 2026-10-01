import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AnyTaskContract } from "../../../../../src/domain/contracts/base.js";
import { redactObservedDataPoints } from "../../../../../src/core/observed-data.js";
import { createTaskProvenanceCollector, jsonLeafPaths } from "../../../../../src/backend/runs/task-provenance.js";
import type { ObservedDataPoint } from "../../../../../src/core/span-emitter.js";
import { JsonValueSchema } from "../../../../../src/domain/canonical-json.js";
import { manualClock } from "../../../../../src/domain/clock.js";
import { NewKronosReadSeparationTimecard } from "../../../../../src/domain/contracts/new-kronos/read-separation-timecard.js";
import { SeparationsReadSeparationDates } from "../../../../../src/domain/contracts/separations/read-separation-dates.js";
import { SeparationsReadSeparationPlan } from "../../../../../src/domain/contracts/separations/read-separation-plan.js";
import { deriveSchemaHash } from "../../../../../src/domain/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../../src/domain/workflow/checkpoint.js";
import { readSeparationDatesTask } from "../../../../../src/backend/workflow-tasks/separations/tasks/read-separation-dates.js";
import { separationsDescriptor } from "../../../../helpers/registered-workflows.js";

const NOW = "2026-08-14T19:00:00.000Z";
const RUN_ID = "aaaaaaaa-0001-4000-8000-000100000000";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const FINGERPRINT = "a".repeat(64);
const log = Object.freeze({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
});

function checkpoint(nodeId: string, contract: AnyTaskContract, outputInput: unknown) {
  const output = JsonValueSchema.parse(contract.output.parse(outputInput));
  return RunCheckpointRecordSchema.parse({
    workflowId: separationsDescriptor.id,
    itemId: ITEM_ID,
    nodeId,
    attempt: 1,
    claimGeneration: 1,
    runId: RUN_ID,
    output: { schemaHash: deriveSchemaHash(contract.output, "output"), value: output },
    descriptorVersion: separationsDescriptor.version,
    contractFingerprint: FINGERPRINT,
    implFingerprint: FINGERPRINT,
    provenance: jsonLeafPaths(output).map((path) => ({
      path,
      source: "live" as const,
      observedAt: NOW,
      originalObservedAt: NOW,
    })),
    writtenAt: NOW,
  });
}

describe("separations dates task provenance", () => {
  it("records every reconciled output leaf before executor finalization", async () => {
    const plan = SeparationsReadSeparationPlan.example;
    const timecard = NewKronosReadSeparationTimecard.example;
    const observed: ObservedDataPoint[] = [];
    const collector = createTaskProvenanceCollector({
      descriptor: separationsDescriptor,
      execution: {
        runId: RUN_ID,
        traceId: "sp-190000-aaaa",
        attempt: 1,
        workflowId: separationsDescriptor.id,
        nodeId: "dates",
        taskId: SeparationsReadSeparationDates.id,
      },
      upstreamEvidence: {
        checkpoints: [
          checkpoint("plan", SeparationsReadSeparationPlan, plan),
          checkpoint("timecard", NewKronosReadSeparationTimecard, timecard),
        ],
      },
      clock: manualClock(new Date(NOW)),
      onRecord: ({ points }) => {
        observed.push(...redactObservedDataPoints(SeparationsReadSeparationDates.id, points));
      },
    });

    const output = await readSeparationDatesTask.impl.run({
      input: {
        plan,
        timekeeperName: "Julian Zaw",
        lastPunchDate: timecard.grid.lastPunchDate,
        sickDates: timecard.grid.sickDates,
        holidayDates: timecard.grid.holidayDates,
        unclassifiedPayCodes: timecard.grid.unclassifiedPayCodes,
        observedWindow: {
          start: timecard.range.observedStart,
          end: timecard.range.observedEnd,
        },
      },
      ctx: {
        signal: new AbortController().signal,
        log,
        fail: (_code: string, message: string): never => { throw new Error(message); },
        recordData: collector.recordData,
      },
    });

    const finalized = collector.finalizeRead(output);
    assert.deepEqual(
      finalized.provenance.find((fact) => fact.path === "source"),
      {
        path: "source",
        source: "derived",
        observedAt: NOW,
        originalObservedAt: NOW,
      },
    );
    assert.deepEqual(observed.filter((point) => point.field === "source"), [{
      direction: "read",
      field: "source",
      values: [{
        key: "source",
        classification: "safe-diagnostic",
        transform: "allow",
        state: "allowed",
        value: "kronos-timesheet",
      }],
    }]);
  });
});
