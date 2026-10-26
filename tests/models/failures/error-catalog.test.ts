import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ERROR_CATALOG,
  ErrorCatalogCodeSchema,
  createErrorCatalogFailure,
  formatErrorCatalogFailure,
  resolveErrorCatalogFailure,
} from "../../../src/models/failures/error-catalog.js";
import { AssistantRefusalCodeSchema } from "../../../src/models/profiles/assistant-permissions.js";

describe("error catalog", () => {
  it("maps the HTTP internal failure code without exposing its native cause", () => {
    const failure = { code: "INTERNAL_FAILURE", parameters: {}, summary: "private native path" };
    const resolved = resolveErrorCatalogFailure(failure, "http-response");
    assert.equal(resolved.state, "resolved");
    assert.equal(resolved.code, "INTERNAL_FAILURE");
    assert.equal(resolved.text, "Relay could not complete this request. Review the recorded local evidence before trying again.");
    assert.equal(resolved.text.includes(failure.summary), false);
  });
  it("registers Person Lookup and shared sign-in codes with fixed sentence-case text", () => {
    const expected = {
      PERSON_LOOKUP_MATCH_INPUT_MISSING_IDENTIFIERS: "Match requires a date of birth or SSN.",
      PERSON_LOOKUP_NOT_FOUND: "Person not found.",
      PERSON_LOOKUP_MULTIPLE_MATCHES: "Multiple people match; none was chosen.",
      PERSON_LOOKUP_MATCH_MULTIPLE_MATCHES: "Multiple UCPath people match; none was chosen.",
      PERSON_LOOKUP_EMPLOYMENT_STATUS_UNDETERMINED: "Employment status could not be determined.",
      INCONSISTENT_INPUTS: "Person Lookup received inconsistent UCPath and CRM identities.",
      PERSON_LOOKUP_UCPATH_SEARCH_FAILED: "UCPath search failed.",
      PERSON_LOOKUP_CRM_RECORD_IDENTITY_DRIFT: "CRM selected record identity changed.",
      PERSON_LOOKUP_CRM_CHECK_FAILED: "CRM check failed.",
      PERSON_LOOKUP_CRM_DATES_CHECK_FAILED: "CRM dates check failed.",
      PERSON_LOOKUP_CRM_DATES_BINDING_INVALID: "CRM dates subject binding is invalid.",
      SHIBBOLETH_STALE_REQUEST: "Shibboleth served its stale-request page; the SAML execution expired during login.",
      DUO_PROMPT_STALLED: "The Duo prompt never cleared; check that Duo Autopilot is loaded and its credential is current.",
      DUO_REFUSAL_UNPROVEN: "The Duo prompt never cleared, and its terminal refusal could not be probed.",
      SSO_FIRST_FACTOR_REJECTED: "The UCSD SSO form is still on the page; the first factor was rejected.",
      LANDING_PROBE_UNAVAILABLE: "No authenticated landing appeared, and the stalled page could not be probed.",
      AUTHENTICATED_LANDING_MISSING: "No authenticated landing appeared.",
      TRAINING_REMINDER_REPEATED: "The UCSD training reminder appeared again after Continue Log In.",
      DUO_TERMINAL_REFUSAL: "Duo refused the sign-in. Run it again; if it repeats, check Duo Autopilot.",
      UCPATH_SIGN_IN_FAILED: "UCPath sign-in failed.",
      CRM_SIGN_IN_FAILED: "CRM sign-in failed.",
      ONBASE_SIGN_IN_FAILED: "OnBase sign-in failed.",
      KUALI_SIGN_IN_FAILED: "Kuali sign-in failed.",
      SERVICENOW_SIGN_IN_FAILED: "ServiceNow sign-in failed.",
      I9_SIGN_IN_FAILED: "I-9 sign-in failed.",
      NEW_KRONOS_SIGN_IN_FAILED: "New Kronos sign-in failed.",
      OLD_KRONOS_SIGN_IN_FAILED: "Old Kronos sign-in failed.",
      SHAREPOINT_SIGN_IN_FAILED: "SharePoint sign-in failed.",
    } as const;
    for (const code of Object.keys(expected) as (keyof typeof expected)[]) {
      const message = formatErrorCatalogFailure(createErrorCatalogFailure(code, {}));
      assert.equal(message.code, code);
      assert.equal(message.text, expected[code]);
    }
  });

  it("registers spreadsheet parsing refusals with operator recovery text", () => {
    const expected = {
      SPREADSHEET_WORKSHEET_REFERENCE_INVALID: "This workbook has an invalid worksheet reference. Export a new XLSX copy and try again.",
      SPREADSHEET_WORKBOOK_XML_INVALID: "This workbook could not be read. Export a new XLSX copy and try again.",
      SPREADSHEET_DIMENSIONS_INVALID: "This workbook has an invalid worksheet range. Export a new XLSX copy and try again.",
    } as const;
    for (const code of Object.keys(expected) as (keyof typeof expected)[]) {
      const message = formatErrorCatalogFailure(createErrorCatalogFailure(code, {}));
      assert.equal(message.code, code);
      assert.equal(message.text, expected[code]);
    }
  });

  it("registers the exact Settings integration codes and fixed messages", () => {
    const expected = {
      SETTINGS_INITIAL_READ_UNAVAILABLE: "Settings could not be read. Try again.",
      SETTINGS_REFRESH_UNAVAILABLE: "Current settings could not be read. Your drafts are retained.",
      SETTINGS_DRAFT_INVALID: "Check the draft values. No request was sent.",
      PROTECTED_SETTINGS_DRAFT_INVALID: "Check the credential draft. No request was sent.",
      STORAGE_RELOCATION_DRAFT_INVALID: "Check the folder paths. No plan was sent.",
      STORAGE_RELOCATION_DRAFT_UNCHANGED: "The draft matches the current plan. Undo the edit or choose another folder.",
      STORAGE_RELOCATION_CANCEL_REQUIRED: "Cancel the current plan to keep the active locations, or choose another folder.",
      SETTINGS_PATH_PICKER_BUSY: "Another path picker is already open.",
      SETTINGS_PATH_PICKER_TIMEOUT: "The path picker timed out. Try again.",
      SETTINGS_PATH_PICKER_UNSUPPORTED: "The path picker is unavailable on this host.",
      SETTINGS_PATH_PICKER_FAILED: "The path picker could not be opened. Try again.",
    } as const;
    for (const code of Object.keys(expected) as (keyof typeof expected)[]) {
      const message = formatErrorCatalogFailure(createErrorCatalogFailure(code, {}));
      assert.equal(message.code, code);
      assert.equal(message.text, expected[code]);
    }
  });

  it("registers the exact Logs integration messages through the catalog types", () => {
    const expected = {
      DASHBOARD_READ_FAILED: "The dashboard could not load this from the local service. Try again.",
      LOGS_READ_FAILED_TITLE: "Could not load logs",
      LOGS_UNAVAILABLE_TITLE: "Logs unavailable",
      LOGS_CONFIRMED_ACTIONS_UNAVAILABLE_TITLE: "Confirmed actions unavailable",
      LOGS_CONFIRMED_ACTION_EVIDENCE_INCOMPLETE: "The response did not supply complete confirmed-action evidence.",
    } as const;
    for (const code of Object.keys(expected) as (keyof typeof expected)[]) {
      const message = formatErrorCatalogFailure(createErrorCatalogFailure(code, {}));
      assert.equal(message.code, code);
      assert.equal(message.text, expected[code]);
    }
  });

  it("derives a closed code schema from the frozen catalog and keeps parameters strict", () => {
    const codes = Object.keys(ERROR_CATALOG);
    assert.equal(Object.isFrozen(ERROR_CATALOG), true);
    assert.equal(codes.every((code) => /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u.test(code)), true);
    assert.deepEqual(ErrorCatalogCodeSchema.options, codes);

    for (const code of codes) {
      assert.equal(Object.isFrozen(ERROR_CATALOG[code as keyof typeof ERROR_CATALOG]), true);
      assert.equal(
        ERROR_CATALOG[code as keyof typeof ERROR_CATALOG].parameters.safeParse(
          code === "BOUNDARY_VALIDATION_FAILED"
            ? { source: "http-response", extra: true }
            : { extra: true },
        ).success,
        false,
      );
    }

    assert.equal(
      createErrorCatalogFailure("BOUNDARY_VALIDATION_FAILED", { source: "http-response" }).parameters.source,
      "http-response",
    );
    assert.equal(
      ERROR_CATALOG.BOUNDARY_VALIDATION_FAILED.parameters.safeParse({ source: "unknown" }).success,
      false,
    );
    assert.equal(ErrorCatalogCodeSchema.safeParse("HISTORICAL_FAILURE").success, false);
  });

  it("formats only fixed registered text", () => {
    for (const code of ErrorCatalogCodeSchema.options) {
      const failure = code === "BOUNDARY_VALIDATION_FAILED"
        ? createErrorCatalogFailure(code, { source: "http-response" })
        : createErrorCatalogFailure(code, {});
      assert.deepEqual(formatErrorCatalogFailure(failure), {
        code,
        text: ERROR_CATALOG[code].text,
        parameters: failure.parameters,
      });
    }
  });

  it("resolves unknown, malformed and unclassified codes explicitly", () => {
    const registered = { code: "DASHBOARD_DAY_INVALID", parameters: {} };
    const registeredResult = resolveErrorCatalogFailure(registered, "http-response");
    assert.equal(registeredResult.state, "resolved");
    assert.equal(registeredResult.code, "DASHBOARD_DAY_INVALID");
    assert.equal(registeredResult.text, ERROR_CATALOG.DASHBOARD_DAY_INVALID.text);
    assert.deepEqual(registeredResult.parameters, {});
    assert.equal(ERROR_CATALOG.DASHBOARD_DAY_INVALID.parameters.safeParse(registeredResult.parameters).success, true);
    assert.equal(registeredResult.originalFailure, registered);

    const unknown = { code: "HISTORICAL_FAILURE", parameters: {}, summary: "original detail" };
    const unknownResult = resolveErrorCatalogFailure(unknown, "http-response");
    assert.equal(unknownResult.state, "resolved");
    assert.equal(unknownResult.code, "ERROR_CATALOG_CODE_UNREGISTERED");
    assert.equal(unknownResult.text, ERROR_CATALOG.ERROR_CATALOG_CODE_UNREGISTERED.text);
    assert.equal(unknownResult.originalFailure, unknown);

    const unclassified = { summary: "unclassified detail" };
    const unclassifiedResult = resolveErrorCatalogFailure(unclassified, "subscription");
    assert.equal(unclassifiedResult.state, "resolved");
    assert.equal(unclassifiedResult.code, "TASK_UNHANDLED_FAILURE");
    assert.equal(unclassifiedResult.originalFailure, unclassified);

    for (const caught of [null, undefined, "raw failure text", 42, true]) {
      const caughtResult = resolveErrorCatalogFailure(caught, "subscription");
      assert.equal(caughtResult.state, "resolved");
      assert.equal(caughtResult.code, "TASK_UNHANDLED_FAILURE");
      assert.equal(caughtResult.originalFailure, caught);
    }

    const malformed = { code: "not a code", summary: "original detail" };
    const malformedResult = resolveErrorCatalogFailure(malformed, "http-response");
    assert.equal(malformedResult.state, "resolved");
    assert.equal(malformedResult.code, "TASK_UNHANDLED_FAILURE");
    assert.equal(malformedResult.originalFailure, malformed);
  });

  it("maps missing or invalid registered parameters to a closed boundary source", () => {
    const failures = [
      { code: "COMMAND_OUTCOME_UNCERTAIN" },
      { code: "DASHBOARD_DAY_INVALID", parameters: { secret: "private input" } },
      { code: "BOUNDARY_VALIDATION_FAILED", parameters: { source: "invalid-source" } },
      { code: "BOUNDARY_VALIDATION_FAILED", parameters: { source: "http-response", extra: true } },
    ];
    for (const originalFailure of failures) {
      const result = resolveErrorCatalogFailure(originalFailure, "http-response");
      assert.equal(result.state, "resolved");
      assert.equal(result.code, "BOUNDARY_VALIDATION_FAILED");
      assert.equal(result.text, "The supplied data does not match the expected contract.");
      assert.deepEqual(result.parameters, { source: "http-response" });
      assert.equal(ERROR_CATALOG.BOUNDARY_VALIDATION_FAILED.parameters.safeParse(result.parameters).success, true);
      assert.equal(
        ERROR_CATALOG.BOUNDARY_VALIDATION_FAILED.parameters.safeParse({ ...result.parameters, extra: true }).success,
        false,
      );
      assert.equal(result.originalFailure, originalFailure);
      assert.equal(result.text.includes("private input"), false);
    }
  });

  it("retains the original failure and write state if catalog formatting faults", () => {
    const originalFailure = {
      failureId: "failure-2",
      code: "COMMAND_OUTCOME_UNCERTAIN",
      causeChain: [{ code: "COMMAND_OUTCOME_UNCERTAIN", role: "primary" }],
      writeState: "unknown",
      cause: new Error("original cause detail"),
    };
    const faultingFailure = new Proxy(originalFailure, {
      has(target, property) {
        return property === "parameters" || property in target;
      },
      get(target, property) {
        if (property === "parameters") throw new Error("private formatter detail");
        return target[property as keyof typeof target];
      },
    });
    const result = resolveErrorCatalogFailure(faultingFailure, "http-response");

    assert.equal(result.state, "format-failed");
    assert.equal(result.originalFailure, faultingFailure);
    assert.equal(result.originalFailure.cause, originalFailure.cause);
    assert.deepEqual(result.originalFailure.causeChain, originalFailure.causeChain);
    assert.equal(result.originalFailure.writeState, "unknown");
    assert.equal(result.catalogFault.code, "ERROR_CATALOG_FORMAT_FAILED");
    assert.equal(result.catalogFault.text, ERROR_CATALOG.ERROR_CATALOG_FORMAT_FAILED.text);
    assert.equal(result.catalogFault.cause instanceof Error, true);
    assert.notEqual(result.catalogFault.text.includes("private formatter detail"), true);
  });
  it("registers every assistant refusal code with fixed operator text", () => {
    const expected = {
      ASSISTANT_AUTHORITY_INVALID: "The assistant permission could not be read. No action was taken.",
      ASSISTANT_GRANT_REQUIRED: "The assistant has no operator grant. No action was taken.",
      ASSISTANT_MODEL_PROPOSAL_REFUSED: "The assistant proposal was refused. No action was taken.",
      ASSISTANT_PROPOSAL_MISMATCH: "The assistant proposal does not match this command. No action was taken.",
      ASSISTANT_UNCLASSIFIED: "This command is not classified for the assistant. No action was taken.",
      ASSISTANT_OPTIONS_UNBOUND: "This command's options cannot be bound exactly. No action was taken.",
      ASSISTANT_SUBJECT_MISMATCH: "This command's subject does not match its classification. No action was taken.",
      ASSISTANT_BINDING_STALE: "The assistant approval no longer matches this command. No action was taken.",
      ASSISTANT_UNKNOWN_NOT_REPLAYABLE: "An uncertain assistant result cannot be replayed. Check its result before taking further action.",
      ASSISTANT_EFFECT_UNDERSTATED: "This command does more than its assistant classification says. No action was taken.",
    } as const;
    assert.deepEqual([...AssistantRefusalCodeSchema.options].sort(), Object.keys(expected).sort());
    for (const code of AssistantRefusalCodeSchema.options) {
      const message = formatErrorCatalogFailure(createErrorCatalogFailure(code, {}));
      assert.equal(message.code, code);
      assert.equal(message.text, expected[code]);
      assert.equal(ERROR_CATALOG[code].parameters.safeParse({ extra: true }).success, false);
    }
  });
});

it("owns Sessions availability and actual worker failure labels with strict empty parameters", () => {
  const entries = {
    SESSIONS_UNAVAILABLE: "Session information is unavailable.",
    WORKER_CRASHED: "crashed",
    WORKER_LEASE_EXPIRED: "The worker stopped responding. Run it again.",
  } as const;
  for (const code of Object.keys(entries) as (keyof typeof entries)[]) {
    assert.equal(formatErrorCatalogFailure(createErrorCatalogFailure(code, {})).text, entries[code]);
    assert.equal(ERROR_CATALOG[code].parameters.safeParse({ reason: "private diagnostic" }).success, false);
    const failure = { code, parameters: {}, message: "private diagnostic", cause: new Error("private cause") };
    const resolved = resolveErrorCatalogFailure(failure, "subscription");
    assert.equal(resolved.state, "resolved"); assert.equal(resolved.originalFailure, failure);
    if (resolved.state !== "resolved") throw new Error("catalog mapping failed");
    assert.equal(resolved.text, entries[code]); assert.equal(resolved.text.includes("private"), false);
  }
});
