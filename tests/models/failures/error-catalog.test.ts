import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ERROR_CATALOG,
  ErrorCatalogCodeSchema,
  createErrorCatalogFailure,
  formatErrorCatalogFailure,
  resolveErrorCatalogFailure,
} from "../../../src/models/failures/error-catalog.js";

describe("error catalog", () => {
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
});
