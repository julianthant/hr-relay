import { createJsonlWriterTestWorld } from "../../../support/helpers/backend/jsonl-writer-world.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { ObservedDataPointSchema } from "../../../../src/backend/logs/span-emitter.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { SpanEventWireSchema } from "../../../../src/models/events/types.js";
import { RedactedFieldSchema } from "../../../../src/rules/redaction/redaction.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const { roots, repositories, repositoryOf, nativeLines, stateRoot, RUN_ID, TRACE, AT } = createJsonlWriterTestWorld();


afterEach(() => {
  repositories.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const CLASSIFICATIONS = [
  "secret", "credential-file", "direct-identifier", "sensitive-hr", "safe-diagnostic",
] as const;
const TRANSFORMS = ["drop", "digest", "last4", "basename", "count", "allow"] as const;
type Classification = typeof CLASSIFICATIONS[number];
type Transform = typeof TRANSFORMS[number];

/** Independent expected table — never derived from the production policy it verifies. */
const EXPECTED_ALLOWED_TRANSFORMS = {
  secret: new Set<Transform>(["drop", "digest", "allow"]),
  "credential-file": new Set<Transform>(["drop", "digest", "allow"]),
  "direct-identifier": new Set<Transform>(["drop", "digest", "last4", "allow"]),
  "sensitive-hr": new Set<Transform>(["drop", "digest", "count", "allow"]),
  "safe-diagnostic": new Set<Transform>(["allow", "count", "basename"]),
} satisfies Record<Classification, ReadonlySet<Transform>>;

function redactedPairValue(classification: Classification, transform: Transform): Record<string, unknown> {
  const base = { key: "selection.value", classification, transform };
  switch (transform) {
    case "drop": return { ...base, state: "redacted" };
    case "digest": return { ...base, state: "transformed", value: "a".repeat(64) };
    case "last4": return { ...base, state: "transformed", value: "cret" };
    case "basename": return {
      ...base,
      state: "transformed",
      value: classification === "safe-diagnostic" ? "report.txt" : "RAW_SECRET_CANARY.txt",
    };
    case "count": return { ...base, state: "transformed", value: 7 };
    case "allow": return {
      ...base,
      state: "allowed",
      value: classification === "safe-diagnostic" ? "healthy" : "RAW_SECRET_CANARY",
    };
  }
}

function observedPairEvent(value: Record<string, unknown>): Record<string, unknown> {
  return {
    t: "data.observed", ts: AT.toISOString(), workflow: "person-lookup",
    runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1.1`, parentSpanPath: TRACE,
    nodeId: "searching", taskId: "ucpath/search-person-org", observedAt: AT.toISOString(),
    points: [{ direction: "read", field: "selection.value", values: [value] }],
  };
}

function queuedEvent(clock: { now(): Date }): Record<string, unknown> {
  return {
    t: "run.queued",
    kind: "run",
    ts: clock.now().toISOString(),
    workflow: "person-lookup",
    runId: RUN_ID,
    attempt: 1,
    traceId: TRACE,
    spanPath: TRACE,
    itemId: "9c8b7a6d-5e4f-43a2-9b8c-7d6e5f4a3b2c",
    shape: "single",
    priority: "interactive",
    dryRun: false,
    actorId: "local-operator",
    title: "Ada Lovelace",
    descriptorVersion: 1,
    contractFingerprint: "a".repeat(64),
    resolvedInstance: { ucpath: "prod" },
    configFingerprint: "b".repeat(64),
    configSnapshotId: "1a2b3c4d-5e6f-47a8-89ab-cdef01234567",
  };
}

describe("native span writer", () => {
  it("appends one strict pid-stamped line per event and feeds NO projector — the fold reads disk", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createTimelineEmitter({ repository: repositoryOf(root), clock, pid: 4242 });
    writer.emit(queuedEvent(clock));
    writer.emit({
      t: "run.claimed", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: TRACE, workerId: "person-lookup-worker-1",
    });
    const lines = nativeLines(root, "spans");
    assert.equal(lines.length, 2);
    assert.equal(lines[0].file.workflow, "person-lookup");
    assert.equal(lines[0].file.date, "2026-08-03");
    const first: unknown = JSON.parse(lines[0].text);
    assert.equal((first as { pid: number }).pid, 4242);
  });

  it("records append-at-now retention dates across midnight", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createTimelineEmitter({ repository: repositoryOf(root), clock, pid: 1 });
    writer.emit(queuedEvent(clock));
    clock.advanceWall(24 * 60 * 60 * 1000);
    writer.emit({
      t: "run.claimed", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: TRACE, workerId: "person-lookup-worker-1",
    });
    assert.deepEqual([...new Set(nativeLines(root, "spans").map(line => line.file.date))], ["2026-08-03", "2026-08-04"]);
  });

  it("throws on a second run.queued, a re-open, and a re-end for the same identity", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createTimelineEmitter({ repository: repositoryOf(root), clock, pid: 1 });
    writer.emit(queuedEvent(clock));
    assert.throws(() => writer.emit(queuedEvent(clock)), /write-once/);
    const task = {
      t: "span.started", kind: "task", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1`, name: "searching",
    };
    writer.emit(task);
    assert.throws(() => writer.emit(task), /opens exactly once/);
    const ended = {
      t: "span.ended", kind: "task", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1`, outcome: "done",
    };
    writer.emit(ended);
    assert.throws(() => writer.emit(ended), /closes exactly once/);
    // A close for a span an earlier process opened is legal after a restart.
    writer.emit({
      t: "span.ended", kind: "worker", ts: clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1", outcome: "done",
    });
  });


  it("refuses a span.patched event outright and writes nothing", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createTimelineEmitter({ repository: repositoryOf(root), clock, pid: 1 });
    writer.emit(queuedEvent(clock));
    const patch = (key: string): Record<string, unknown> => ({
      t: "span.patched", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: TRACE, updates: [{ key, value: "x" }],
    });
    assert.throws(() => writer.emit(patch("resolvedName")));
    assert.throws(() => writer.emit(patch("traceId")));
    const patched = nativeLines(root, "spans").filter((line) => line.text.includes("span.patched"));
    assert.equal(patched.length, 0);
  });

  it("writes classified observations and refuses unclassified leaf shapes", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createTimelineEmitter({ repository: repositoryOf(root), clock, pid: 1 });
    writer.emit(queuedEvent(clock));
    const observed = (values: readonly unknown[]): Record<string, unknown> => ({
      t: "data.observed", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1.1`, parentSpanPath: TRACE,
      nodeId: "searching", taskId: "ucpath/search-person-org", observedAt: clock.now().toISOString(),
      points: [{ direction: "read", field: "selection", values }],
    });
    writer.emit(observed([
      { key: "selection.status", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "resolved" },
      { key: "selection.eid", state: "transformed", classification: "direct-identifier", transform: "last4", value: "6712" },
      { key: "selection.eidDigest", state: "transformed", classification: "direct-identifier", transform: "digest", value: "c".repeat(64) },
    ]));

    writer.emit(observed([
      { key: "selection.status", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "ambiguous" },
    ]));
    const lines = nativeLines(root, "spans").filter((line) => line.text.includes("data.observed"));
    assert.equal(lines.length, 2);
    assert.match(lines[0]?.text ?? "", /"pid":1/);
    assert.match(lines[0]?.text ?? "", /"6712"/);
    assert.match(lines[0]?.text ?? "", new RegExp(`"${"c".repeat(64)}"`));
    assert.doesNotMatch(lines[0]?.text ?? "", /10456712/);

    // An unclassified value is refused BEFORE any byte reaches disk: the wire
    // leaf has no arm for a bare `{key, value}` without a classification.
    assert.throws(() => writer.emit(observed([{ key: "selection.eid", value: "10456712" }])));
    const after = nativeLines(root, "spans").filter((line) => line.text.includes("data.observed"));
    assert.equal(after.length, 2);
  });

  it("refuses a raw EID disguised as a last4 value before appending it", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createTimelineEmitter({ repository: repositoryOf(root), clock, pid: 1 });
    const disguised = {
      t: "data.observed", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1.1`, parentSpanPath: TRACE,
      nodeId: "searching", taskId: "ucpath/search-person-org", observedAt: clock.now().toISOString(),
      points: [{ direction: "read", field: "selection.eid", values: [{
        key: "selection.eid",
        state: "transformed",
        classification: "direct-identifier",
        transform: "last4",
        value: "10456712",
      }] }],
    };

    assert.throws(() => writer.emit(disguised));
    assert.equal(nativeLines(root, "spans").length, 0);
  });

  it("refuses a non-SHA-256 string disguised as a digest before appending it", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createTimelineEmitter({ repository: repositoryOf(root), clock, pid: 1 });
    const disguised = {
      t: "data.observed", ts: clock.now().toISOString(), workflow: "person-lookup",
      runId: RUN_ID, attempt: 1, traceId: TRACE, spanPath: `${TRACE}/searching#1.1`, parentSpanPath: TRACE,
      nodeId: "searching", taskId: "ucpath/search-person-org", observedAt: clock.now().toISOString(),
      points: [{ direction: "read", field: "selection.eid", values: [{
        key: "selection.eid",
        state: "transformed",
        classification: "direct-identifier",
        transform: "digest",
        value: "10456712",
      }] }],
    };

    assert.throws(() => writer.emit(disguised));
    assert.equal(nativeLines(root, "spans").length, 0);
  });

  it("the durable redaction schema accepts exactly the canonical redaction pairs", () => {
    for (const classification of CLASSIFICATIONS) for (const transform of TRANSFORMS) {
      const pair = `${classification}/${transform}`;
      const value = redactedPairValue(classification, transform);
      const expectedAllowed = EXPECTED_ALLOWED_TRANSFORMS[classification].has(transform);

      assert.equal(RedactedFieldSchema.safeParse(value).success, expectedAllowed, pair);
      assert.equal(
        ObservedDataPointSchema.safeParse({ direction: "read", field: "selection.value", values: [value] }).success,
        expectedAllowed,
        `${pair} core schema`,
      );
    }
  });

  it("the native writer refuses every forbidden redaction pair before append", () => {
    const root = stateRoot();
    const clock = manualClock(AT);
    const writer = createTimelineEmitter({ repository: repositoryOf(root), clock, pid: 1 });
    let allowedCount = 0;
    let forbiddenCount = 0;

    for (const classification of CLASSIFICATIONS) for (const transform of TRANSFORMS) {
      const pair = `${classification}/${transform}`;
      const value = redactedPairValue(classification, transform);
      const expectedAllowed = EXPECTED_ALLOWED_TRANSFORMS[classification].has(transform);
      const event = observedPairEvent(value);

      const before = nativeLines(root, "spans").length;
      if (expectedAllowed) {
        assert.doesNotThrow(() => writer.emit(event), `${pair} writer`);
        allowedCount += 1;
      } else {
        assert.throws(() => writer.emit(event), /timeline-span-invalid/u, `${pair} writer`);
        assert.equal(nativeLines(root, "spans").length, before, `${pair} appended before refusal`);
        forbiddenCount += 1;
      }
    }

    const lines = nativeLines(root, "spans");
    assert.equal(allowedCount, 17);
    assert.equal(forbiddenCount, 13);
    assert.equal(lines.length, allowedCount);
    assert.equal(lines.some(({ text }) => text.includes("RAW_SECRET_CANARY")), true);
    for (const classification of CLASSIFICATIONS) {
      const expected = redactedPairValue(classification, "allow");
      const retained = lines.map(({ text }) => SpanEventWireSchema.parse(JSON.parse(text)))
        .find(event => event.t === "data.observed" && event.points.some(point => point.values.some(value => value.classification === classification && (classification === "secret" || classification === "credential-file" || value.transform === "allow"))));
      assert.ok(retained?.t === "data.observed", `${classification} complete allowed value missing`);
      assert.deepEqual(retained.points[0]?.values, classification === "secret" || classification === "credential-file" ? [{key:"selection.value",state:"redacted",classification,transform:"drop"}] : [expected]);
    }
    for (const invalid of [
      { key: "selection.value", state: "allowed", classification: "unknown", transform: "allow", value: "complete" },
      { key: "selection.value", state: "allowed", classification: "secret", transform: "unknown", value: "complete" },
      { key: "selection.value", state: "allowed", classification: "secret", transform: "allow", value: "complete", undeclared: true },
    ]) {
      assert.equal(RedactedFieldSchema.safeParse(invalid).success, false);
      assert.equal(SpanEventWireSchema.safeParse({ ...observedPairEvent(invalid), pid: 1 }).success, false);
      assert.throws(() => writer.emit(observedPairEvent(invalid)));
      assert.equal(nativeLines(root, "spans").length, allowedCount);
    }
  });
});

