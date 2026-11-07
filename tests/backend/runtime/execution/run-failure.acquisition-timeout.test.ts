import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildNodeFailureRecord } from "../../../../src/backend/runtime/execution/run-failure.js";
import { SessionAcquisitionTimeoutError } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { resolveErrorCatalogFailure } from "../../../../src/models/failures/error-catalog.js";
import { NodeIdSchema, TaskIdSchema } from "../../../../src/rules/identity/ids.js";
import { wrapUnhandledTaskError } from "../../../../src/workflow-kit/errors.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

const TASK_ID = TaskIdSchema.parse("ucpath/search-person-org");

describe("session acquisition timeout", () => {
  it("records BROWSER_SESSION_ACQUISITION_TIMEOUT instead of an unhandled failure", () => {
    const timeout = new SessionAcquisitionTimeoutError("ucpath", 60_000);
    const wrapped = wrapUnhandledTaskError(TASK_ID, timeout);
    const recorded = buildNodeFailureRecord({
      run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000041",
      nodeId: NodeIdSchema.parse("searching"),
      taskId: TASK_ID,
      error: wrapped,
      occurredAt: "2026-08-29T08:00:00.000Z",
    });
    assert.equal(recorded.code, "BROWSER_SESSION_ACQUISITION_TIMEOUT");
    assert.notEqual(recorded.code, "TASK_UNHANDLED_FAILURE");
    assert.notEqual(recorded.code, "UNHANDLED");

    const resolved = resolveErrorCatalogFailure(timeout, "subscription");
    assert.equal(resolved.state, "resolved");
    if (resolved.state !== "resolved") throw new Error("acquisition timeout was not resolved");
    assert.equal(resolved.code, "BROWSER_SESSION_ACQUISITION_TIMEOUT");
    assert.notEqual(resolved.code, "TASK_UNHANDLED_FAILURE");
    assert.equal(resolved.text, "Sign-in took too long. Run it again; if it repeats, check the system's sign-in in Sessions.");
  });
});
