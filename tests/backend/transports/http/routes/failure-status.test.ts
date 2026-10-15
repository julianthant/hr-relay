
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import {
LogIdentityRefusedError,
DashboardReadFailedError,
DiagnosticBundleBytesMissingError,
DiagnosticBundleCorruptError,
ProjectionDegradedError,
SectionUnavailableError,
TargetNotFoundError,
} from "../../../../../src/backend/runs/commands/refusals.js";
import { StartStepOmissionRefusedError } from "../../../../../src/backend/runs/start/step-selection.js";
import { failureStatus } from "../../../../../src/backend/transports/http/routes/failure-status.js";


const RETIRED_MARKERS = [
  "is not registered",
  "does not exist",
  "has no span fold",
  "not in authority",
  "is not available",
  "degraded",
] as const;

describe("failureStatus", () => {
  it("refuses Logs identity contradictions with the shared catalog code and text", () => {
    const refusal = failureStatus(new LogIdentityRefusedError("private native mismatch"));
    assert.equal(refusal.status, 409);
    assert.equal(refusal.body.code, "LOGS_IDENTITY_REFUSED");
    assert.equal(refusal.body.retryable, false);
    assert.equal(refusal.body.message, "Logs cannot be ordered because their recorded identities are missing or inconsistent.");
  });

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

  it("answers 400 for a step-omission refusal, distinguishable from a shape failure", () => {
    const { status, body } = failureStatus(new StartStepOmissionRefusedError(
      "facts-invalid",
      "separations start step kronos-timecard omission facts are invalid at: lastDayWorked",
    ));
    assert.equal(status, 400);

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

  it("classifies buildActivityReportWire degraded refusal as PROJECTION_DEGRADED", () => {

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

it("returns fixed catalog text for a failed dashboard read while preserving its private cause", () => {
  const cause = new Error("private-query-detail");
  const error = new DashboardReadFailedError(cause);
  assert.equal(error.cause, cause);
  assert.deepEqual(failureStatus(error), { status: 500, body: { state: "error", code: "DASHBOARD_READ_FAILED", message: "The dashboard could not load this from the local service. Try again.", retryable: false } });
});
