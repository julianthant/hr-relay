import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { createTaskProvenanceCollector } from "../../src/core/task-provenance.js";
import { manualClock } from "../../src/domain/clock.js";
import { ContractFieldPathSchema } from "../../src/domain/contracts/base.js";
import { JsonValueSchema } from "../../src/domain/canonical-json.js";
import type { JsonValue } from "../../src/domain/canonical-json.js";
import {
  FactProvenanceSchema,
  RunCheckpointRecordSchema,
} from "../../src/domain/workflow/checkpoint.js";
import type {
  FactProvenance,
  RunCheckpointRecord,
} from "../../src/domain/workflow/checkpoint.js";

const NOW = "2026-08-02T18:00:00.000Z";
const EARLIER = "2026-08-02T16:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const EMPTY_UPSTREAM = Object.freeze({ declaredDependencyNodeIds: [], checkpoints: [] });
const execution = {
  runId: "aaaaaaaa-0001-4000-8000-000100000000",
  traceId: "pl-180000-aaaa",
  attempt: 1,
  workflowId: "person-lookup",
  nodeId: "searching",
  taskId: "ucpath/search-person-org",
};
const OutputSchema = z.strictObject({
  person: z.strictObject({ eid: z.string(), name: z.string() }),
  state: z.enum(["found", "absent"]),
});

function fact(path: string, observedAt: string): FactProvenance {
  return FactProvenanceSchema.parse({
    path: ContractFieldPathSchema.parse(path),
    source: "live",
    observedAt,
    originalObservedAt: observedAt,
  });
}

function checkpoint(
  nodeId: string,
  value: JsonValue,
  provenance: readonly FactProvenance[],
): RunCheckpointRecord {
  return RunCheckpointRecordSchema.parse({
    workflowId: execution.workflowId,
    itemId: "33333333-3333-4333-8333-333333333333",
    nodeId,
    attempt: 1,
    runId: execution.runId,
    output: { schemaHash: HASH_A, value: JsonValueSchema.parse(value) },
    descriptorVersion: 1,
    contractFingerprint: HASH_A,
    implFingerprint: HASH_B,
    provenance,
    writtenAt: NOW,
  });
}

describe("task provenance collector", () => {
  it("attributes strict points to one execution and covers nested live output fields", () => {
    const collector = createTaskProvenanceCollector({
      execution,
      policy: { default: "live" },
      outputSchema: OutputSchema,
      upstream: EMPTY_UPSTREAM,
      clock: manualClock(new Date(NOW)),
    });
    collector.recordData([
      { direction: "read", field: "person", value: { eid: "10873698", name: "Fixture, Person" } },
      { direction: "read", field: "state", value: "found" },
    ]);
    const result = collector.finalizeRead({
      person: { eid: "10873698", name: "Fixture, Person" },
      state: "found",
    });
    assert.deepEqual(result.provenance.map(({ path }) => path), ["person.eid", "person.name", "state"]);
    assert.equal(result.provenance.every(({ source }) => source === "live"), true);
    assert.equal(result.provenance.every(({ originalObservedAt }) => originalObservedAt === NOW), true);
    assert.deepEqual(result.points[0]?.execution, execution);
  });

  it("refuses missing, duplicate, write-direction, and contradictory points", () => {
    const collector = createTaskProvenanceCollector({
      execution,
      policy: { default: "live" },
      outputSchema: OutputSchema,
      upstream: EMPTY_UPSTREAM,
      clock: manualClock(new Date(NOW)),
    });
    collector.recordData({ direction: "read", field: "person", value: { eid: "10873698", name: "Wrong" } });
    assert.throws(
      () => collector.recordData({ direction: "read", field: "person", value: { eid: "10873698", name: "Wrong" } }),
      /recorded field person twice/,
    );
    assert.throws(
      () => collector.finalizeRead({ person: { eid: "10873698", name: "Fixture" }, state: "found" }),
      /contradicts its parsed output/,
    );

    const missing = createTaskProvenanceCollector({
      execution,
      policy: { default: "live" },
      outputSchema: OutputSchema,
      upstream: EMPTY_UPSTREAM,
      clock: manualClock(new Date(NOW)),
    });
    missing.recordData({ direction: "read", field: "person", value: { eid: "10873698", name: "Fixture" } });
    assert.throws(
      () => missing.finalizeRead({ person: { eid: "10873698", name: "Fixture" }, state: "found" }),
      /no recorded provenance for output field state/,
    );

    const undeclared = createTaskProvenanceCollector({
      execution,
      policy: { default: "live" },
      outputSchema: OutputSchema,
      upstream: EMPTY_UPSTREAM,
      clock: manualClock(new Date(NOW)),
    });
    undeclared.recordData([
      { direction: "read", field: "person", value: { eid: "10873698", name: "Fixture" } },
      { direction: "read", field: "state", value: "found" },
      { direction: "read", field: "secret", value: "must-not-be-retained" },
    ]);
    assert.throws(
      () => undeclared.finalizeRead({ person: { eid: "10873698", name: "Fixture" }, state: "found" }),
      /provenance path secret does not exist in the output/,
    );

    const wrongDirection = createTaskProvenanceCollector({
      execution,
      policy: { default: "live" },
      outputSchema: z.strictObject({ state: z.string() }),
      upstream: EMPTY_UPSTREAM,
      clock: manualClock(new Date(NOW)),
    });
    wrongDirection.recordData({ direction: "write", field: "state", value: "found" });
    assert.throws(() => wrongDirection.finalizeRead({ state: "found" }), /covered by a write point/);
  });

  it("retains the oldest complete upstream observation for derived fields", () => {
    const ucpath = checkpoint("searching", { person: "fresh" }, [fact("person", NOW)]);
    const crm = checkpoint("cross-verify", { crm: "older" }, [fact("crm", EARLIER)]);
    const collector = createTaskProvenanceCollector({
      execution: { ...execution, nodeId: "active-status", taskId: "workflow:person-lookup/read-active-status" },
      policy: { default: "derived" },
      outputSchema: z.strictObject({ state: z.string(), reason: z.string() }),
      upstream: {
        declaredDependencyNodeIds: ["searching", "cross-verify"],
        checkpoints: [ucpath, crm],
      },
      clock: manualClock(new Date(NOW)),
    });
    collector.recordData([
      { direction: "read", field: "state", value: "active" },
      { direction: "read", field: "reason", value: "matched" },
    ]);
    const result = collector.finalizeRead({ state: "active", reason: "matched" });
    assert.equal(result.provenance.every(({ source }) => source === "derived"), true);
    assert.equal(result.provenance.every(({ originalObservedAt }) => originalObservedAt === EARLIER), true);

    const absentUpstream = createTaskProvenanceCollector({
      execution,
      policy: { default: "derived" },
      outputSchema: z.strictObject({ state: z.string() }),
      upstream: EMPTY_UPSTREAM,
      clock: manualClock(new Date(NOW)),
    });
    absentUpstream.recordData({ direction: "read", field: "state", value: "active" });
    assert.throws(() => absentUpstream.finalizeRead({ state: "active" }), /has no declared upstream dependencies/);

    assert.throws(() => createTaskProvenanceCollector({
      execution,
      policy: { default: "derived" },
      outputSchema: z.strictObject({ state: z.string() }),
      upstream: {
        declaredDependencyNodeIds: ["searching", "cross-verify"],
        checkpoints: [ucpath],
      },
      clock: manualClock(new Date(NOW)),
    }), /declared dependency cross-verify has no checkpoint provenance/);

    assert.throws(() => createTaskProvenanceCollector({
      execution,
      policy: { default: "derived" },
      outputSchema: z.strictObject({ state: z.string() }),
      upstream: {
        declaredDependencyNodeIds: ["searching"],
        checkpoints: [ucpath, crm],
      },
      clock: manualClock(new Date(NOW)),
    }), /undeclared upstream checkpoint cross-verify/);
  });

  it("resolves field-specific live and derived policies independently", () => {
    const upstream = checkpoint("searching", { person: "fixture" }, [fact("person", EARLIER)]);
    const collector = createTaskProvenanceCollector({
      execution,
      policy: {
        default: "derived",
        byField: [{ path: "state", source: "live" }],
      },
      outputSchema: z.strictObject({ state: z.string(), reason: z.string() }),
      upstream: { declaredDependencyNodeIds: ["searching"], checkpoints: [upstream] },
      clock: manualClock(new Date(NOW)),
    });
    collector.recordData([
      { direction: "read", field: "state", value: "active" },
      { direction: "read", field: "reason", value: "matched upstream facts" },
    ]);
    const result = collector.finalizeRead({ state: "active", reason: "matched upstream facts" });
    assert.deepEqual(
      result.provenance.map(({ path, source, originalObservedAt }) => ({ path, source, originalObservedAt })),
      [
        { path: "state", source: "live", originalObservedAt: NOW },
        { path: "reason", source: "derived", originalObservedAt: EARLIER },
      ],
    );
  });

  it("rejects duplicate policies, overlapping points, and pre-finalization point exposure", () => {
    assert.throws(() => createTaskProvenanceCollector({
      execution,
      policy: {
        default: "live",
        byField: [{ path: "state", source: "live" }, { path: "state", source: "live" }],
      },
      outputSchema: OutputSchema,
      upstream: EMPTY_UPSTREAM,
      clock: manualClock(new Date(NOW)),
    }), /duplicate provenance rule for state/);
    assert.throws(() => createTaskProvenanceCollector({
      execution,
      policy: {
        default: "live",
        byField: [{ path: "state", source: "live" }, { path: "state", source: "derived" }],
      },
      outputSchema: OutputSchema,
      upstream: EMPTY_UPSTREAM,
      clock: manualClock(new Date(NOW)),
    }), /conflicting provenance rules for state/);

    const ancestorFirst = createTaskProvenanceCollector({
      execution,
      policy: { default: "live" },
      outputSchema: OutputSchema,
      upstream: EMPTY_UPSTREAM,
      clock: manualClock(new Date(NOW)),
    });
    assert.equal(Object.hasOwn(ancestorFirst, "recordedPoints"), false);
    ancestorFirst.recordData({
      direction: "read",
      field: "person",
      value: { eid: "10873698", name: "Fixture" },
    });
    assert.throws(
      () => ancestorFirst.recordData({ direction: "read", field: "person.eid", value: "10873698" }),
      /recorded overlapping fields person and person\.eid/,
    );

    const descendantFirst = createTaskProvenanceCollector({
      execution,
      policy: { default: "live" },
      outputSchema: OutputSchema,
      upstream: EMPTY_UPSTREAM,
      clock: manualClock(new Date(NOW)),
    });
    descendantFirst.recordData({ direction: "read", field: "person.eid", value: "10873698" });
    assert.throws(
      () => descendantFirst.recordData({
        direction: "read",
        field: "person",
        value: { eid: "10873698", name: "Fixture" },
      }),
      /recorded overlapping fields person\.eid and person/,
    );
  });

  it("rejects incomplete or malformed upstream checkpoint fact sets", () => {
    const missingFact = checkpoint(
      "searching",
      { person: { eid: "10873698", name: "Fixture" } },
      [fact("person.eid", NOW)],
    );
    assert.throws(() => createTaskProvenanceCollector({
      execution,
      policy: { default: "derived" },
      outputSchema: z.strictObject({ state: z.string() }),
      upstream: { declaredDependencyNodeIds: ["searching"], checkpoints: [missingFact] },
      clock: manualClock(new Date(NOW)),
    }), /upstream checkpoint searching has no provenance for output field person\.name/);

    const extraFact = checkpoint("searching", { person: "Fixture" }, [
      fact("person", NOW),
      fact("unrelated", NOW),
    ]);
    assert.throws(() => createTaskProvenanceCollector({
      execution,
      policy: { default: "derived" },
      outputSchema: z.strictObject({ state: z.string() }),
      upstream: { declaredDependencyNodeIds: ["searching"], checkpoints: [extraFact] },
      clock: manualClock(new Date(NOW)),
    }), /upstream checkpoint searching has provenance for undeclared output field unrelated/);
  });
});
