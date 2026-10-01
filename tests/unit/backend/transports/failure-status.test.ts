/**
 * The BFF's throw → status mapping (Track D row D2, audit C3).
 *
 * The mapping used to be a substring table over the thrown MESSAGE, so the
 * status a caller saw was a property of an operator-facing sentence. The cases
 * below pin the two halves of the fix that matter: a declared refusal keeps its
 * status no matter how it is worded, and a plain `Error` wearing one of the
 * retired phrases is an unclassified defect — a 500 — rather than a 404 the
 * caller would act on.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { failureStatus } from "../../../../src/backend/transports/dashboard/routes/failure-status.js";
import {
  DiagnosticBundleBytesMissingError,
  DiagnosticBundleCorruptError,
  ProjectionDegradedError,
  SectionUnavailableError,
  TargetNotFoundError,
} from "../../../../src/backend/runs/refusals.js";
import { StartStepOmissionRefusedError } from "../../../../src/backend/runs/start/step-selection.js";

/** Every phrase the retired `NOT_FOUND_MARKERS` table and its two siblings keyed on. */
const RETIRED_MARKERS = [
  "is not registered",
  "does not exist",
  "has no span fold",
  "not in authority",
  "is not available",
  "degraded",
] as const;

describe("failureStatus", () => {
  it("answers 404 for a not-found refusal whose wording carries no retired marker", () => {
    const { status, body } = failureStatus(
      new TargetNotFoundError("nothing here answers to run 0f2c; try the archive"),
    );
    assert.equal(status, 404);
    assert.equal(body.code, "TARGET_NOT_FOUND");
    assert.equal(body.retryable, false);
    assert.equal(body.message, "nothing here answers to run 0f2c; try the archive");
    for (const marker of RETIRED_MARKERS) {
      assert.equal(String(body.message).includes(marker), false, marker);
    }
  });

  it("answers 400 for a D307 step-omission refusal, distinguishable from a shape failure", () => {
    const { status, body } = failureStatus(new StartStepOmissionRefusedError(
      "facts-invalid",
      "separations start step kronos-timecard omission facts are invalid at: lastDayWorked",
    ));
    assert.equal(status, 400);
    // Same 400 family as a schema failure, its OWN code: a surface that only
    // saw SCHEMA_INVALID could not tell "this body is malformed" from "this
    // omission does not reconcile with the descriptor".
    assert.equal(body.code, "START_STEP_OMISSION_REFUSED");
    const shapeFailure = failureStatus(z.strictObject({ step: z.string() }).safeParse({}).error);
    assert.equal(shapeFailure.status, 400);
    assert.notEqual(body.code, shapeFailure.body.code);
    assert.equal(body.retryable, false);
    assert.equal(
      body.message,
      "separations start step kronos-timecard omission facts are invalid at: lastDayWorked",
    );
  });

  it("answers 409 for a section refusal and 500+retryable for a degraded projection", () => {
    const unavailable = failureStatus(new SectionUnavailableError("this run carries no receipt"));
    assert.equal(unavailable.status, 409);
    assert.equal(unavailable.body.code, "SECTION_UNAVAILABLE");
    assert.equal(unavailable.body.retryable, false);

    const degraded = failureStatus(new ProjectionDegradedError("the fold refuses to serve counts"));
    assert.equal(degraded.status, 500);
    assert.equal(degraded.body.code, "PROJECTION_DEGRADED");
    // The ONE retryable arm: a guarded rebuild can clear it.
    assert.equal(degraded.body.retryable, true);
  });

  it("answers typed path-free corruption for a diagnostic readback failure", () => {
    const localPath = "/private/operator/.tracker/artifacts/missing";
    const corruption = failureStatus(new DiagnosticBundleCorruptError(
      "diagnostic bundle 00000000-0000-4000-8000-000000000004 is corrupt: an attachment could not be verified",
      { cause: new Error(`ENOENT ${localPath}`) },
    ));

    assert.equal(corruption.status, 500);
    assert.equal(corruption.body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(corruption.body.retryable, false);
    assert.equal(String(corruption.body.message).includes(localPath), false);
  });

  it("distinguishes physical absence by kind while retaining legacy corruption catches", () => {
    const message = "diagnostic bundle 00000000-0000-4000-8000-000000000004: attachment 00000000-0000-4000-8000-000000000005 (screenshot) has no stored bytes";
    const missing = new DiagnosticBundleBytesMissingError(message, {
      cause: new Error("ENOENT /private/operator/diagnostic.artifact"),
    });
    assert.ok(missing instanceof DiagnosticBundleCorruptError);
    assert.deepEqual(failureStatus(missing), {
      status: 500,
      body: { state: "error", code: "DIAGNOSTIC_BUNDLE_BYTES_MISSING", message, retryable: false },
    });
    // Identical prose cannot promote a generic corruption to physical absence.
    assert.equal(failureStatus(new DiagnosticBundleCorruptError(message)).body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
  });

  it("classifies buildActivityReportWire's degraded refusal as PROJECTION_DEGRADED, not the plain-Error 500 it was", () => {
    // Pins the exact producer: `buildActivityReportWire` (run-queue-projection.ts) used to throw a
    // plain `Error` for this wording, so /api/v1/reports/activity and .csv answered
    // INTERNAL_FAILURE/retryable:false during a degraded fold instead of PROJECTION_DEGRADED/
    // retryable:true — the sibling `counts` producer was re-kinded, this one was not.
    const activityAggregatesDegraded = failureStatus(
      new ProjectionDegradedError(
        "the run/queue projection is degraded and refuses to serve activity aggregates: unknown",
      ),
    );
    assert.equal(activityAggregatesDegraded.status, 500);
    assert.equal(activityAggregatesDegraded.body.code, "PROJECTION_DEGRADED");
    assert.equal(activityAggregatesDegraded.body.retryable, true);
  });

  it("answers 500 for an untyped throw even when it wears a retired marker", () => {
    // This is the whole defect, from the other side: before D2 each of these
    // was a 404/409/500-retryable decided by prose, and a caller could not
    // tell a real absence from a bug in this process.
    for (const marker of RETIRED_MARKERS) {
      const { status, body } = failureStatus(new Error(`run 0f2c ${marker} on this host`));
      assert.equal(status, 500, marker);
      assert.equal(body.code, "INTERNAL_FAILURE", marker);
      assert.equal(body.retryable, false, marker);
      // The message still reaches the operator verbatim — only the KIND moved.
      assert.equal(body.message, `run 0f2c ${marker} on this host`, marker);
    }
  });

  it("answers 400 for a schema failure, ahead of every refusal kind", () => {
    const parsed = z.strictObject({ day: z.iso.date() }).safeParse({ day: "today" });
    assert.equal(parsed.success, false);
    const { status, body } = failureStatus(parsed.error);
    assert.equal(status, 400);
    assert.equal(body.code, "SCHEMA_INVALID");
  });

  it("answers 500 for a thrown non-Error rather than losing it", () => {
    const { status, body } = failureStatus("the projection threw a string");
    assert.equal(status, 500);
    assert.equal(body.code, "INTERNAL_FAILURE");
    assert.equal(body.message, "the projection threw a string");
  });
});
