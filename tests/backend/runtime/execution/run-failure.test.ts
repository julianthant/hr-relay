import { BrowserLandingStallError, BrowserLoginError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { projectRunLogs } from "../../../../src/dashboard/state/run-wiring-adapter.js";
import { NotePageSchema, RunDetailSectionResponseSchema } from "../../../../src/models/dashboard/run-detail.js";
import { FIXTURE_RUN_DETAILS } from "../../../support/fixtures/dashboard/run-detail/timeline.js";
import { FIXTURE_FAILURE_SECTIONS } from "../../../support/fixtures/dashboard/run-detail/receipts-failures.js";
import { FIXTURE_IDS } from "../../../support/fixtures/dashboard/fixture-queue.js";
import { DelegationConfigUnavailableError } from "../../../../src/backend/runs/lifecycle/delegation-admission.js";
import { ERROR_CATALOG, operatorFailureSentence, resolveErrorCatalogFailure } from "../../../../src/models/failures/error-catalog.js";
import { projectFailureForOperator, signInPage } from "../../../../src/models/trust/failure.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
buildNodeFailureRecord, buildEntryValidationFailureRecord
} from "../../../../src/backend/runtime/execution/run-failure.js";
import { TaskError, wrapUnhandledTaskError } from "../../../../src/workflow-kit/errors.js";
import { NodeIdSchema,TaskIdSchema } from "../../../../src/rules/identity/ids.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { SIGN_IN_REFUSAL_PROBES } from "../../../support/fixtures/sign-in-refusal-probes.js";
const NODE_ID = NodeIdSchema.parse("searching");
const TASK_ID = TaskIdSchema.parse("ucpath/search-person-org");

describe("diagnostic evidence projection", () => {

  it("sanitizes credentials and URL query values in Error stacks and nested causes", () => {
    const nested = new Error("nested source read failed");
    nested.stack = "Error: nested source read failed password=STACK_PASSWORD_CANARY https://example.test/read?subject=CAUSE_QUERY_CANARY";
    const error = new Error("source read failed", { cause: nested });
    error.stack = "Error: source read failed Authorization: Bearer STACK_TOKEN_CANARY https://example.test/read?token=STACK_QUERY_CANARY";
    const authority = buildNodeFailureRecord({ writes: [],
      run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007",
      nodeId: NODE_ID,
      taskId: TASK_ID,
      error,
      occurredAt: "2026-08-29T08:00:00.000Z",
    });

    assert.ok(authority.debug);
    assert.match(authority.debug.stack, /source read failed/u);
    assert.equal(authority.debug.causes.length, 1);
    assert.match(authority.debug.causes[0], /nested source read failed/u);
    const bytes = JSON.stringify(authority.debug);
    for (const canary of ["STACK_PASSWORD_CANARY", "CAUSE_QUERY_CANARY", "STACK_TOKEN_CANARY", "STACK_QUERY_CANARY"]) {
      assert.equal(bytes.includes(canary), false, "debug evidence must sanitize every untrusted secret leaf");
    }
  });
});

describe("node failure code selection", () => {
  it.each([
    { name: "declared task code", error: new TaskError(TASK_ID, "subject-mismatch", "Synthetic failure"), expected: "SUBJECT_MISMATCH" },
    { name: "catalogued own code", error: Object.assign(new Error("Synthetic failure"), { code: "browser-profile-still-closing" }), expected: "BROWSER_PROFILE_STILL_CLOSING" },
    { name: "uncatalogued own code", error: Object.assign(new Error("Synthetic failure"), { code: "ECONNRESET" }), expected: "TASK_UNHANDLED_FAILURE" },
    { name: "uncaught task error", error: wrapUnhandledTaskError(TASK_ID, new Error("Timeout 30000ms exceeded")), expected: "TASK_UNHANDLED_FAILURE" },
    { name: "plain Error", error: new Error("Synthetic failure"), expected: "TASK_UNHANDLED_FAILURE" },
    { name: "non-Error value", error: "Synthetic non-Error failure", expected: "TASK_UNHANDLED_FAILURE" },
  ])("records $expected for a $name", ({ error, expected }) => {
    const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID,
      error, occurredAt: "2026-08-29T08:00:00.000Z" });
    assert.equal(failure.code, expected);
    assert.equal(failure.causeChain[0]?.code, expected);
    assert.notEqual(operatorFailureSentence(failure.code), ERROR_CATALOG.ERROR_CATALOG_CODE_UNREGISTERED.text);
  });

  it("serves an uncaught task error with the unclassified-failure sentence", () => {
    const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID,
      error: wrapUnhandledTaskError(TASK_ID, new Error("Timeout 30000ms exceeded")), occurredAt: "2026-08-29T08:00:00.000Z" });
    assert.equal(projectFailureForOperator(failure).summary, "The task stopped with an unclassified failure. Review local diagnostic evidence.");
  });

  it("records each named secondary cause after the task's own primary cause", () => {
    const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID,
      error: new TaskError(TASK_ID, "subject-mismatch", "Synthetic failure"), occurredAt: "2026-08-29T08:00:00.000Z",
      secondaryCauses: [{ code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", summary: "Failure screenshot not taken: page-closed" }] });
    assert.equal(failure.code, "SUBJECT_MISMATCH");
    assert.deepEqual(failure.causeChain.map(({ code, role }) => [code, role]),
      [["SUBJECT_MISMATCH", "primary"], ["BROWSER_SCREENSHOT_CAPTURE_FAILED", "secondary"]]);
    assert.equal(failure.causeChain[1]?.summary, "Failure screenshot not taken: page-closed");
  });
});

it.each([undefined, "RUN_CONTINUATION_REFUSED"] as const)("keeps entry validation code selection explicit for %s", code => {
  const failure = buildEntryValidationFailureRecord({ run: QUEUED_RUN,
    failureId: "10000000-0000-4000-8000-000000000007", problems: ["Synthetic validation failure"],
    occurredAt: "2026-08-29T08:00:00.000Z", ...(code === undefined ? {} : { code }) });
  assert.equal(failure.code, code === undefined ? "RESUME_VALIDATION_FAILED" : "RUN_CONTINUATION_REFUSED");
});

describe("node failure write state", () => {
  it("records a failure after a write this run settled as after that write, and anything else as not written", () => {
    const stateAfter = (writes: readonly Readonly<{ status: "committed" | "observed-present" | "retryable" }>[]) => buildNodeFailureRecord({ run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID, error: new Error("receipt refused"),
      occurredAt: "2026-08-29T08:00:00.000Z", writes }).writeState;
    assert.equal(stateAfter([]), "not-attempted");
    assert.equal(stateAfter([{ status: "retryable" }]), "not-attempted", "a confirmed-absent write was not written");
    assert.equal(stateAfter([{ status: "committed" }]), "committed");
    assert.equal(stateAfter([{ status: "committed" }, { status: "observed-present" }]), "verified");
  });
});

it.each(["not-attempted", "committed", "verified"] as const)("maps retained delegation config failure with independent %s write evidence", writeState => {
  const cause = new Error("private retained config snapshot mismatch");
  const error = new DelegationConfigUnavailableError(cause);
  const failure = buildNodeFailureRecord({ run: QUEUED_RUN,
    failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID,
    error, occurredAt: "2026-08-29T08:00:00.000Z",
    writes: writeState === "not-attempted" ? [] : [{ status: writeState === "verified" ? "observed-present" : "committed" }] });
  assert.equal(error.cause, cause);
  assert.equal(failure.code, "DELEGATION_CONFIG_UNAVAILABLE");
  assert.equal(failure.causeChain[0]?.code, "DELEGATION_CONFIG_UNAVAILABLE");
  assert.equal(failure.writeState, writeState);
  assert.equal(failure.taskId, undefined, "a child control node owns no task");
  assert.ok(failure.debug?.causes.some(value => value.includes(cause.message)));
  const resolved = resolveErrorCatalogFailure({ code: failure.code, parameters: {}, summary: failure.summary }, "http-response");
  assert.equal(resolved.state, "resolved");
  assert.equal(resolved.code, "DELEGATION_CONFIG_UNAVAILABLE");
  assert.equal(resolved.text, "Relay could not verify this run's saved settings, so the child workflow did not start. Review the run evidence before continuing.");
  assert.equal(resolved.text.includes(cause.message), false);
});

it.each(["not-attempted", "unknown"] as const)("shows the registered delegation config sentence in Logs while preserving %s write state", writeState => {
  const original = FIXTURE_FAILURE_SECTIONS[FIXTURE_IDS.failedRun].failure;
  assert.ok(original.section === "failure" && original.payload.state === "available");
  const source = original.payload.value;
  const section = RunDetailSectionResponseSchema.parse({ section: "failure", payload: { state: "available", value: {
    ...source, code: "DELEGATION_CONFIG_UNAVAILABLE", writeState, summary: "private retained snapshot details",
  } } });
  const detail = FIXTURE_RUN_DETAILS[FIXTURE_IDS.failedRun]; assert.ok(detail);
  const logs = NotePageSchema.parse({ runId: detail.runId, rows: [], notes: [], nextCursor: { state: "absent", reason: "end-of-page" } });
  const projection = projectRunLogs({ detail, logs, sections: [section], unavailableEvidence: [] },
    { artifactUrl: () => { throw new Error("config failure must not request an artifact"); } });
  const entry = projection.steps.find(step => step.id === source.failureId)?.entries[0];
  assert.ok(entry?.kind === "decision");
  assert.equal(entry.decision.message, "Relay could not verify this run's saved settings, so the child workflow did not start. Review the run evidence before continuing.");
  assert.equal(entry.decision.state, writeState === "unknown" ? "unconfirmed" : "failed");
  assert.equal(entry.decision.message.includes("private retained snapshot details"), false);
  if (writeState === "unknown") assert.equal(entry.decision.caution, "The result is unknown. Check the system before continuing.");
});

const FIXTURE_EMPLOYEE_ID = "10456712";
const PEOPLESOFT_PREFIX = "/psc/ucphrprd/EMPLOYEE/HRMS/";
const LISTED_SSO = "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO";

function storedSignInFailure(detail: string, observedUrl: string, system: "ucpath" | "crm" = "ucpath", check?: "application-route") {
  const login = new BrowserLoginError(system, "verify-landing", detail, observedUrl, undefined, undefined, check);
  return buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
    failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID,
    error: new TaskError(TASK_ID, login.code, login.message, { cause: login }),
    occurredAt: "2026-08-29T08:00:00.000Z" });
}

function retainedDebugBytes(debug: { stack: string; causes: readonly string[] }): number {
  return Buffer.byteLength(debug.stack) + debug.causes.reduce((total, text) => total + Buffer.byteLength(text), 0);
}

describe("refused sign-in detail", () => {
  it("stores the step and the registry page, and leaves the employee id out", () => {
    const failure = storedSignInFailure(
      "the login could not prove the authenticated application",
      `https://user:secret@ucphrprdpub.universityofcalifornia.edu${PEOPLESOFT_PREFIX}c/app?EMPLID=${FIXTURE_EMPLOYEE_ID}#frag-canary`,
      "ucpath",
      "application-route",
    );
    assert.equal(failure.code, "UCPATH_SIGN_IN_FAILED");
    assert.equal(projectFailureForOperator(failure).summary, "UCPath sign-in failed.");
    assert.deepEqual(failure.debug?.signInRefusal, {
      system: "ucpath",
      step: "verify-landing",
      check: "application-route",
      pageOrigin: "https://ucphrprdpub.universityofcalifornia.edu",
      pagePath: PEOPLESOFT_PREFIX,
    });
    const stored = JSON.stringify(failure);
    assert.equal(stored.includes(FIXTURE_EMPLOYEE_ID), false);
    assert.equal(stored.includes("frag-canary"), false);
    assert.equal(stored.includes("EMPLID"), false);
    assert.equal(stored.includes("secret"), false);
  });

  it("stores a CRM refusal as registry leaves, and Logs still show the catalog sentence", () => {
    const failure = storedSignInFailure(
      "the login could not prove the authenticated application",
      `https://act-crm.my.site.com/hr/ONB_SearchOnboardings?EMPLID=${FIXTURE_EMPLOYEE_ID}`,
      "crm",
    );
    assert.equal(failure.code, "CRM_SIGN_IN_FAILED");
    assert.equal(failure.debug?.signInRefusal?.check, undefined);
    assert.deepEqual(failure.debug?.signInRefusal, {
      system: "crm",
      step: "verify-landing",
      pageOrigin: "https://act-crm.my.site.com",
      pagePath: "/hr/ONB_SearchOnboardings",
    });
    assert.equal(projectFailureForOperator(failure).summary, "CRM sign-in failed.");
    assert.equal(JSON.stringify(failure).includes(FIXTURE_EMPLOYEE_ID), false);

    const original = FIXTURE_FAILURE_SECTIONS[FIXTURE_IDS.failedRun].failure;
    assert.ok(original.section === "failure" && original.payload.state === "available");
    const source = original.payload.value;
    const section = RunDetailSectionResponseSchema.parse({ section: "failure", payload: { state: "available", value: {
      ...source, code: "UCPATH_SIGN_IN_FAILED", summary: `private ${FIXTURE_EMPLOYEE_ID}`,
    } } });
    const detail = FIXTURE_RUN_DETAILS[FIXTURE_IDS.failedRun];
    assert.ok(detail);
    const logs = NotePageSchema.parse({ runId: detail.runId, rows: [], notes: [], nextCursor: { state: "absent", reason: "end-of-page" } });
    const projection = projectRunLogs({ detail, logs, sections: [section], unavailableEvidence: [] },
      { artifactUrl: () => { throw new Error("sign-in refusal must not request an artifact"); } });
    const entry = projection.steps.find(step => step.id === source.failureId)?.entries[0];
    assert.ok(entry?.kind === "decision");
    assert.equal(entry.decision.message, "UCPath sign-in failed.");
    assert.equal(entry.decision.message.includes(FIXTURE_EMPLOYEE_ID), false);
  });

  it("stores a landing stall as the registry origin when the path is not listed", () => {
    const login = new BrowserLandingStallError("ucpath", "DUO_PROMPT_STALLED", {
      host: "a5.ucsd.edu", path: "/sso", title: "SSO https://example.invalid/private",
    });
    const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID,
      error: new TaskError(TASK_ID, login.code, login.message, { cause: login }),
      occurredAt: "2026-08-29T08:00:00.000Z" });
    assert.equal(failure.debug?.signInRefusal?.check, undefined);
    assert.deepEqual(failure.debug?.signInRefusal, {
      system: "ucpath",
      step: "duo-clearance",
      pageOrigin: "https://a5.ucsd.edu",
    });
    assert.equal(projectFailureForOperator(failure).summary, operatorFailureSentence("DUO_PROMPT_STALLED"));
    assert.equal(JSON.stringify(failure).includes("example.invalid"), false);
  });

  it("stores a landing stall's listed path as the registry constant", () => {
    const login = new BrowserLandingStallError("ucpath", "DUO_PROMPT_STALLED", {
      host: "a5.ucsd.edu", path: "/tritON/profile/SAML2/Redirect/SSO", title: "SSO",
    });
    const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID,
      error: new TaskError(TASK_ID, login.code, login.message, { cause: login }),
      occurredAt: "2026-08-29T08:00:00.000Z" });
    assert.deepEqual(failure.debug?.signInRefusal, {
      system: "ucpath",
      step: "duo-clearance",
      pageOrigin: "https://a5.ucsd.edu",
      pagePath: "/tritON/profile/SAML2/Redirect/SSO",
    });
  });

  it("keeps the same refusal for every probe, and copies none of its text", () => {
    for (const row of SIGN_IN_REFUSAL_PROBES) {
      const failure = storedSignInFailure(row.detail, row.observedUrl);
      const plain = storedSignInFailure("the check refused", row.observedUrl);
      assert.deepEqual(failure.debug?.signInRefusal, plain.debug?.signInRefusal, row.name);
      assert.deepEqual(failure.debug?.signInRefusal, {
        system: "ucpath",
        step: "verify-landing",
        ...signInPage(row.observedUrl),
      }, row.name);
      const stored = JSON.stringify(failure);
      for (const canary of row.canaries) assert.equal(stored.includes(canary), false, `${row.name} ${canary}`);
    }
  });

  it("keeps the refusal outside the stack budget", () => {
    const short = storedSignInFailure("the check refused", LISTED_SSO);
    const longReason = storedSignInFailure(`${"r".repeat(200_000)}LONG_REASON_CANARY`, LISTED_SSO);
    const longPage = storedSignInFailure("the check refused", `https://example.test/${"p".repeat(100_000)}LONG_PAGE_CANARY`);
    const multibyte = storedSignInFailure(`${"€".repeat(50_000)}MULTIBYTE_CANARY`, LISTED_SSO);
    assert.ok(short.debug?.signInRefusal);
    assert.deepEqual(longReason.debug?.signInRefusal, short.debug.signInRefusal);
    assert.deepEqual(multibyte.debug?.signInRefusal, short.debug.signInRefusal);
    assert.equal(longReason.debug?.originalBytes, short.debug.originalBytes);
    assert.equal(longPage.debug?.originalBytes, short.debug.originalBytes);
    assert.equal(multibyte.debug?.originalBytes, short.debug.originalBytes);
    assert.equal(longReason.debug?.omittedBytes, short.debug.omittedBytes);
    assert.equal(longPage.debug?.omittedBytes, short.debug.omittedBytes);
    assert.equal(multibyte.debug?.omittedBytes, short.debug.omittedBytes);

    const huge = new Error("y".repeat(200_000));
    const login = new BrowserLoginError("ucpath", "verify-landing", "the check refused", LISTED_SSO, { cause: huge });
    const failure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID,
      error: new TaskError(TASK_ID, login.code, login.message, { cause: login }),
      occurredAt: "2026-08-29T08:00:00.000Z" });
    const debug = failure.debug;
    assert.ok(debug?.signInRefusal);
    assert.deepEqual(debug.signInRefusal, short.debug.signInRefusal);
    assert.ok(debug.originalBytes > 200_000);
    assert.equal(debug.omittedBytes, debug.originalBytes - retainedDebugBytes(debug));

    const cutLogin = new BrowserLoginError("ucpath", "verify-landing", "the check refused", LISTED_SSO);
    cutLogin.stack = `${"a".repeat(96 * 1024 - 1)}€tail`;
    const cutFailure = buildNodeFailureRecord({ writes: [], run: QUEUED_RUN,
      failureId: "10000000-0000-4000-8000-000000000007", nodeId: NODE_ID, taskId: TASK_ID,
      error: cutLogin, occurredAt: "2026-08-29T08:00:00.000Z" });
    const cutDebug = cutFailure.debug;
    assert.ok(cutDebug?.signInRefusal);
    assert.equal(cutDebug.stack.includes("\uFFFD"), false);
    assert.equal(cutDebug.causes.some(text => text.includes("\uFFFD")), false);
    assert.equal(cutDebug.omittedBytes, cutDebug.originalBytes - retainedDebugBytes(cutDebug));
    assert.ok(cutDebug.omittedBytes > 0);
  });
});
