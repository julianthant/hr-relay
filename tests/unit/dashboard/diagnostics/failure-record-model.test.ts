/**
 * D273 item 8 — the failure record's three pure folds (ledger 2 §R-E E6/E9/E30).
 *
 * The sheet is `docs/plans/2026-08-21-03a-fidelity-2-run-detail.md` §R-E; the
 * ruling is `ref dashboard-surfaces` §"D273 — run detail" item 8. This file pins
 * what the folds DECIDE; `failure-record-render.test.ts` pins that the record
 * actually consumes them, which no fold can see.
 *
 * The claims worth the file are the ones an eye cannot catch: that the tone map
 * is TOTAL over the wire's enum (a seventh arm must break a build, never take a
 * silent default), that `prepared` is deliberately NOT the settled tone, that
 * permanence states BOTH readings, and that a count of one is a sentence rather
 * than a blank.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { WriteStateSchema } from "../../../../src/domain/trust/failure.js";
import {
  FAILURE_WRITE_STATE,
  failureFingerprintHistory,
  failurePermanence,
} from "../../../../src/dashboard/surfaces/trust-model.js";

describe("FAILURE_WRITE_STATE — the write-state sentence and its tone (E8/E9)", () => {
  it("covers every arm the wire can serve, in both directions", () => {
    // The negative control for the whole map: a `writeState` arm added to the
    // kernel and forgotten here would otherwise render `undefined` in the one
    // sentence that decides whether a retry duplicates a termination.
    const served = [...WriteStateSchema.options].sort();
    const drawn = Object.keys(FAILURE_WRITE_STATE).sort();
    assert.deepEqual(drawn, served);
    for (const state of served) {
      const arm = FAILURE_WRITE_STATE[state];
      assert.equal(typeof arm.sentence, "string");
      assert.ok(arm.sentence.length > 0, `${state} has no sentence`);
    }
  });

  it("gives the settled tone to `not-attempted` ALONE", () => {
    const settled = WriteStateSchema.options.filter(
      (state) => FAILURE_WRITE_STATE[state].tone === "nothing-written",
    );
    assert.deepEqual(settled, ["not-attempted"]);
  });

  it("does not call a staged-but-uncommitted write 'nothing written'", () => {
    // `prepared` reaches no target system and is still not settled: a staged
    // intent is a durable row and a fence somebody may have to clear, and a
    // tone that is wrong in the REASSURING direction is the only one that can
    // put a duplicate termination into UCPath.
    assert.equal(FAILURE_WRITE_STATE.prepared.tone, "left-behind");
    assert.equal(FAILURE_WRITE_STATE.verified.tone, "left-behind");
    assert.equal(FAILURE_WRITE_STATE.committed.tone, "left-behind");
    assert.equal(FAILURE_WRITE_STATE.attempting.tone, "left-behind");
  });

  it("parks the unknown outcome rather than colouring it as a wait", () => {
    assert.equal(FAILURE_WRITE_STATE.unknown.tone, "unknown");
  });
});

describe("failurePermanence — the head's permanence chip (E6)", () => {
  it("states the transient reading", () => {
    const permanence = failurePermanence(true);
    assert.equal(permanence.text, "transient — a later attempt may differ");
    assert.equal(permanence.tone, "warning");
  });

  it("states the PERMANENT reading, which is the one that says do not retry", () => {
    // The arm that did not exist before this port: `transient: false` drew
    // nothing at all, so the fact that decides whether the operator presses
    // retry read exactly like a record nobody had classified.
    const permanence = failurePermanence(false);
    assert.equal(permanence.text, "permanent — the same input will fail again");
    assert.equal(permanence.tone, "neutral");
  });

  it("never lets the two arms read the same", () => {
    assert.notEqual(failurePermanence(true).text, failurePermanence(false).text);
    assert.notEqual(failurePermanence(true).tone, failurePermanence(false).tone);
  });
});

describe("failureFingerprintHistory — the fingerprint's history (E30)", () => {
  it("says so on a first sighting instead of drawing a blank", () => {
    const history = failureFingerprintHistory(1);
    assert.equal(history.text, "First time this fingerprint has been seen.");
    assert.equal(history.tone, "first");
  });

  it("states the count, and only the count, on a repeat", () => {
    const history = failureFingerprintHistory(4);
    assert.equal(history.text, "Seen 4 times, this one included.");
    assert.equal(history.tone, "seen-before");
  });

  it("names no other run — D141's refusal survives the port", () => {
    // The demo's own sentence appends `last {trace} at {clock}` in a `{window}`.
    // None of the four is served, and D141 rules the LIST out even if they were.
    const history = failureFingerprintHistory(9);
    for (const banned of ["last", "window", "trace", "at "]) {
      assert.ok(
        !history.text.includes(banned),
        `the repeat sentence leaked "${banned}": ${history.text}`,
      );
    }
  });

  it("throws on a count the projection cannot produce", () => {
    // `sameFingerprintSeen` counts THIS occurrence, so zero is a broken
    // projection rather than "never seen" — the two must never render alike.
    assert.throws(() => failureFingerprintHistory(0), /positive integer/);
    assert.throws(() => failureFingerprintHistory(-3), /positive integer/);
    assert.throws(() => failureFingerprintHistory(2.5), /positive integer/);
    assert.throws(() => failureFingerprintHistory(Number.NaN), /positive integer/);
  });
});

import { acceptFailureResolutionReadback } from "../../../../src/dashboard/surfaces/trust-model.js";
import { FIXTURE_IDS, FIXTURE_SECTIONS } from "../../../parity/helpers/fixture-day.js";
it("accepts only the exact selected failure and nested annotation identity", () => {
  const section = FIXTURE_SECTIONS[FIXTURE_IDS.failedRun]?.failure;
  assert.ok(section?.section === "failure" && section.payload.state === "available");
  const detail = section.payload.value;
  const response = { section: "failure", payload: { state: "available", value: { ...detail,
    resolution: { capability: { state: "available" }, capture: { runId: detail.runId, failureId: detail.failureId, resolution: { status: "unresolved", version: 1 } } },
  } } };
  assert.equal(acceptFailureResolutionReadback(detail.runId, detail.failureId, response).capture.resolution.version, 1);
  for (const capture of [
    { ...response.payload.value.resolution.capture, runId: "11111111-1111-4111-8111-111111111111" },
    { ...response.payload.value.resolution.capture, failureId: "11111111-1111-4111-8111-111111111111" },
  ]) assert.throws(() => acceptFailureResolutionReadback(detail.runId, detail.failureId, { ...response, payload: { ...response.payload, value: {
    ...response.payload.value, resolution: { ...response.payload.value.resolution, capture },
  } } }), /did not match/u);
  assert.throws(() => acceptFailureResolutionReadback(detail.runId, detail.failureId, { section: "failure", payload: { state: "missing", reason: "moved source" } }), /unavailable/u);
});
