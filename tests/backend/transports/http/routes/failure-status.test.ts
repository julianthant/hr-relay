import { StartupCrashRecoveryRefusedError } from "../../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";

import assert from "node:assert/strict";
import { CredentialMaintenanceHold } from "../../../../../src/backend/storage/configuration/canonical-credential-store.js";
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
import { PreflightRunnerTimeoutError, requiredPreflightChecks } from "../../../../../src/models/preflight/preflight.js";
import { PreflightCheckIdSchema, type PreflightCheckId } from "../../../../../src/models/preflight/preflight-contract.js";
import { PREFLIGHT_CHECKS } from "../../../../../src/models/runtime/runtime-dependencies.js";
import { createPreflightAdmission, PreflightAdmissionRefusal, PreflightAdmissionScopeSchema, PreflightObservationChangedError } from "../../../../../src/rules/preflight/preflight-admission.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { CommandBrowserError, CommandBrowserClosureError } from "../../../../../src/backend/runtime/browser/command-browser.js";
import { SharePointDownloadError } from "../../../../../src/backend/systems/sharepoint/driver/interpreter.js";
import { BrowserLoginError } from "../../../../../src/backend/systems/browser-shared/login-contract.js";
import { WorkbookLibraryError } from "../../../../../src/backend/workbooks/workbook-library-error.js";


const RETIRED_MARKERS = [
  "is not registered",
  "does not exist",
  "has no span fold",
  "not in authority",
  "is not available",
  "degraded",
] as const;

describe("failureStatus", () => {
  it("returns a clear conversion next step for a current-only credential reader", () => {
    const result = failureStatus(new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_REQUIRED"));
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "CREDENTIAL_CONVERSION_REQUIRED");
    assert.equal(result.body.message, ERROR_CATALOG.CREDENTIAL_CONVERSION_REQUIRED.text);
    assert.match(String(result.body.message), /Restart Relay/u);
  });
  it('returns a known conflict when workbook history protects a type definition', () => {
    const result = failureStatus(new WorkbookLibraryError('WORKBOOK_TYPE_IN_USE'));
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'WORKBOOK_TYPE_IN_USE');
    assert.equal(result.body.message, ERROR_CATALOG.WORKBOOK_TYPE_IN_USE.text);
  });
  it("serves closed catalog failures for SharePoint commands without private cause data", () => {
    const privateDetail = "private file URL, account and authentication response";
    const cases = [
      { error: new CommandBrowserError("COMMAND_BROWSER_BUSY", { cause: new Error(privateDetail) }), status: 409 },
      { error: new CommandBrowserClosureError([new Error(privateDetail)]), status: 500 },
      { error: new SharePointDownloadError("SHAREPOINT_LINK_UNSUPPORTED"), status: 400 },
      { error: new SharePointDownloadError("SHAREPOINT_DOWNLOAD_TOO_LARGE"), status: 409 },
      { error: new BrowserLoginError("sharepoint", "verify-landing", privateDetail, "https://tenant.sharepoint.com/private?key=private"), status: 409 },
    ];
    for (const { error, status } of cases) {
      const result = failureStatus(error);
      assert.equal(result.status, status);
      assert.equal(result.body.code, error.code);
      assert.equal(result.body.message, ERROR_CATALOG[error.code].text);
      assert.equal(result.body.retryable, false);
      assert.equal(JSON.stringify(result).includes(privateDetail), false);
      assert.equal(JSON.stringify(result).includes("key=private"), false);
    }
  });

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

  it("classifies a detector timeout ahead of the prepare refusal wrapper", async () => {
    const timeout = new PreflightRunnerTimeoutError(PreflightCheckIdSchema.parse("config.valid"), 1_000);
    const expected = { status: 409, body: { state: "error", code: "PREFLIGHT_TIMEOUT", message: `${ERROR_CATALOG.PREFLIGHT_TIMEOUT.text} (config.valid)`, retryable: false } };
    const wrapped = (cause: unknown) => new PreflightAdmissionRefusal("unavailable", "Preflight detectors could not verify readiness.", { cause });
    assert.deepEqual(failureStatus(timeout), expected);
    assert.deepEqual(failureStatus(new Error("outer", { cause: timeout })), expected);
    assert.deepEqual(failureStatus(new AggregateError([timeout], "runners")), expected);
    assert.deepEqual(failureStatus(wrapped(new AggregateError([new Error("sibling"), timeout], "runners"))), expected);
    const scope = PreflightAdmissionScopeSchema.parse({
      configSnapshotId: "11111111-1111-4111-8111-111111111111",
      configFingerprint: "a".repeat(64),
      descriptorFingerprint: "b".repeat(64),
      requestedCapabilities: ["dashboard.serve"],
    });
    const prepare = (fail: (check: PreflightCheckId) => Error) => createPreflightAdmission({
      clock: manualClock(new Date("2026-08-10T12:00:00-07:00")),
      scheduler: { schedule() { return { cancel() {} }; } },
      runners() {
        return requiredPreflightChecks(scope.requestedCapabilities).map(check => {
          const spec = PREFLIGHT_CHECKS.find(candidate => candidate.id === check);
          if (spec === undefined) throw new Error(`missing preflight check ${check}`);
          return { check, kind: spec.runner, async run() {
            if (check === "config.valid") throw fail(check);
            return { check, state: "healthy" as const, summary: `${check} healthy` };
          } };
        });
      },
      validate() {},
    }).prepare(scope, new AbortController().signal);
    await assert.rejects(prepare(check => new PreflightRunnerTimeoutError(check, 1_000)), (error: unknown) => {
      assert.deepEqual(failureStatus(error), expected);
      return true;
    });
    const unavailable = failureStatus(new PreflightAdmissionRefusal("unavailable", "Preflight evidence is unavailable for this exact scope; re-check readiness."));
    assert.equal(unavailable.status, 409);
    assert.equal(unavailable.body.code, "PREFLIGHT_UNAVAILABLE");
    assert.equal(unavailable.body.retryable, false);
    const blocked = failureStatus(new PreflightAdmissionRefusal("blocked", "Readiness checks blocked this worker."));
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, "PREFLIGHT_BLOCKED");
    assert.equal(blocked.body.retryable, false);
    const changed = failureStatus(new AggregateError([new PreflightObservationChangedError()], "runners"));
    assert.equal(changed.status, 409);
    assert.equal(changed.body.code, "PREFLIGHT_OBSERVATION_CHANGED");
    assert.equal(changed.body.message, ERROR_CATALOG.PREFLIGHT_OBSERVATION_CHANGED.text);
    assert.equal(changed.body.retryable, false);
    await assert.rejects(prepare(() => new Error("disk full")), (error: unknown) => {
      const mapped = failureStatus(error);
      assert.equal(mapped.status, 409);
      assert.equal(mapped.body.code, "PREFLIGHT_UNAVAILABLE");
      assert.equal(mapped.body.message, "Preflight detectors could not verify readiness.");
      assert.equal(mapped.body.retryable, false);
      return true;
    });
    assert.equal(failureStatus(new Error("boom")).status, 500);
    assert.equal(failureStatus(new Error("boom")).body.code, "INTERNAL_FAILURE");
  });
});

it("returns fixed catalog text for a failed dashboard read while preserving its private cause", () => {
  const cause = new Error("private-query-detail");
  const error = new DashboardReadFailedError(cause);
  assert.equal(error.cause, cause);
  assert.deepEqual(failureStatus(error), { status: 500, body: { state: "error", code: "DASHBOARD_READ_FAILED", message: "The dashboard could not load this from the local service. Try again.", retryable: false } });
});

it("returns the defined crash cleanup refusal without disclosing its private proof failure", () => {
  assert.deepEqual(failureStatus(new StartupCrashRecoveryRefusedError(new Error("private OS custody details"))), {
    status: 409, body: { state: "error", code: "STARTUP_CRASH_RECOVERY_REFUSED", message: ERROR_CATALOG.STARTUP_CRASH_RECOVERY_REFUSED.text, retryable: false },
  });
});
