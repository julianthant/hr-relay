import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { createTaskProvenanceCollector } from "../../src/core/task-provenance.js";
import { manualClock } from "../../src/domain/clock.js";
import { ContractFieldPathSchema } from "../../src/domain/contracts/base.js";
import { FactProvenanceSchema } from "../../src/domain/workflow/checkpoint.js";

const NOW = "2026-08-02T18:00:00.000Z";
const EARLIER = "2026-08-02T16:00:00.000Z";
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

describe("task provenance collector", () => {
  it("attributes strict points to one execution and covers nested live output fields", () => {
    const collector = createTaskProvenanceCollector({
      execution,
      policy: { default: "live" },
      outputSchema: OutputSchema,
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
      clock: manualClock(new Date(NOW)),
    });
    wrongDirection.recordData({ direction: "write", field: "state", value: "found" });
    assert.throws(() => wrongDirection.finalizeRead({ state: "found" }), /covered by a write point/);
  });

  it("retains the oldest complete upstream observation for derived fields", () => {
    const upstream = [
      FactProvenanceSchema.parse({
        path: ContractFieldPathSchema.parse("person"),
        source: "live",
        observedAt: EARLIER,
        originalObservedAt: EARLIER,
      }),
      FactProvenanceSchema.parse({
        path: ContractFieldPathSchema.parse("crm"),
        source: "live",
        observedAt: NOW,
        originalObservedAt: NOW,
      }),
    ];
    const collector = createTaskProvenanceCollector({
      execution: { ...execution, nodeId: "active-status", taskId: "workflow:person-lookup/read-active-status" },
      policy: { default: "derived" },
      outputSchema: z.strictObject({ state: z.string(), reason: z.string() }),
      upstreamProvenance: upstream,
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
      clock: manualClock(new Date(NOW)),
    });
    absentUpstream.recordData({ direction: "read", field: "state", value: "active" });
    assert.throws(() => absentUpstream.finalizeRead({ state: "active" }), /has no upstream provenance/);
  });

  it("resolves field-specific live and derived policies independently", () => {
    const upstream = [FactProvenanceSchema.parse({
      path: ContractFieldPathSchema.parse("person"),
      source: "live",
      observedAt: EARLIER,
      originalObservedAt: EARLIER,
    })];
    const collector = createTaskProvenanceCollector({
      execution,
      policy: {
        default: "derived",
        byField: [{ path: "state", source: "live" }],
      },
      outputSchema: z.strictObject({ state: z.string(), reason: z.string() }),
      upstreamProvenance: upstream,
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
});
