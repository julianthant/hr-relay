import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { bindErrorOrigin, clientCauseRowAccepted, serializeErrorCauses } from "../../../src/models/failures/error-origins.js";
import { PreflightObservationChangedError } from "../../../src/rules/preflight/preflight-admission.js";
import { WorkerControlRefusal } from "../../../src/models/run/worker-control.js";
import { DashboardClientError } from "../../../src/dashboard/client/errors.js";
import { DashboardReadFailedError } from "../../../src/backend/runs/commands/refusals.js";

const PRIVATE = /Quillan|Petra|private|fictional|record|CANARY/u;

describe("closed error origins", () => {
  it("keeps only closed names, codes, reasons and build-relative frames from cyclic aggregate chains", () => {
    const cause = new TypeError("Quillan, Petra; fictional record contents");
    cause.stack = "TypeError: fictional private message\n    at privateFunction (/Users/private/project/src/backend/runs/queries/run-detail.ts:42:7)\n    at /private/profiles/record.txt:1:2\nprivate continuation";
    const error = new AggregateError([cause, cause], "fictional private aggregate", { cause });
    Object.defineProperty(cause, "cause", { value: error });
    error.stack = "AggregateError: private\n    at handler (/Users/private/project/src/backend/transports/http/routes/api.ts:40:1)";
    const causes = serializeErrorCauses(error);
    assert.deepEqual(causes, [
      { name: "AggregateError", code: "INTERNAL_FAILURE", reason: "aggregate-cause", stack: "AggregateError\n    at src/backend/transports/http/routes/api.ts:40:1" },
      { name: "TypeError", code: "INTERNAL_FAILURE", reason: "cause-unavailable", stack: "TypeError\n    at src/backend/runs/queries/run-detail.ts:42:7" },
    ]);
    assert.equal(PRIVATE.test(JSON.stringify(causes)), false);
  });

  it("selects rows by exact bound constructor and keeps the real cause chain", () => {
    const preflight = new PreflightObservationChangedError();
    const refusal = new WorkerControlRefusal("observation-changed CANARY", { cause: preflight });
    assert.deepEqual(serializeErrorCauses(new AggregateError([refusal, new DashboardReadFailedError(undefined)])).map(({ name, code, reason }) => ({ name, code, reason })), [
      { name: "AggregateError", code: "INTERNAL_FAILURE", reason: "aggregate-cause" },
      { name: "WorkerControlRefusal", code: "INTERNAL_FAILURE", reason: "cause-unavailable" },
      { name: "DashboardReadFailedError", code: "DASHBOARD_READ_FAILED", reason: "read-failed" },
      { name: "PreflightObservationChangedError", code: "PREFLIGHT_OBSERVATION_CHANGED", reason: "observation-changed" },
    ]);
  });

  it("grants no row from runtime names, codes or subclasses, and names an unbound error by its constructor", () => {
    const spoofed = Object.assign(new Error("PRIVATE_CANARY"), { name: "RuntimeCustodyUncertainError", code: "RUNTIME_CUSTODY_UNCERTAIN", reason: "custody-unproved" });
    class Derived extends PreflightObservationChangedError {}
    const rows = [spoofed, new Derived(), new WorkerControlRefusal("worker-removal-child-close-unproved-PRIVATE_CANARY")]
      .map(error => { const [cause] = serializeErrorCauses(error); return { name: cause?.name, code: cause?.code, reason: cause?.reason }; });
    assert.deepEqual(rows, [
      { name: "Error", code: "RUNTIME_CUSTODY_UNCERTAIN", reason: "cause-unavailable" },
      { name: "Derived", code: "INTERNAL_FAILURE", reason: "cause-unavailable" },
      { name: "WorkerControlRefusal", code: "INTERNAL_FAILURE", reason: "cause-unavailable" },
    ]);
    assert.equal(serializeErrorCauses(Object.assign(new Error("x"), { code: "private value" }))[0]?.code, "INTERNAL_FAILURE");
  });

  it("names a raw SQLite error by its integer result code and drops its message", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(":memory:");
    let failure: unknown;
    try { database.exec("SELECT * FROM private_canary"); } catch (error) { failure = error; } finally { database.close(); }
    const [cause] = serializeErrorCauses(failure);
    assert.deepEqual({ name: cause?.name, code: cause?.code, reason: cause?.reason }, { name: "Error", code: "ERR_SQLITE_ERROR", reason: "sqlite-errcode-1" });
    assert.equal(PRIVATE.test(JSON.stringify(cause)), false);
  });

  it("names a worker lifecycle refusal only from its closed reason list", () => {
    assert.deepEqual(serializeErrorCauses(new WorkerControlRefusal("worker-removal-child-close-unproved")).map(({ name, code, reason }) => ({ name, code, reason })),
      [{ name: "WorkerControlRefusal", code: "INTERNAL_FAILURE", reason: "worker-removal-child-close-unproved" }]);
  });

  it("uses fixed rows for non-errors and bounds long chains", () => {
    assert.deepEqual(serializeErrorCauses(undefined), [{ name: "UnknownCause", code: "INTERNAL_FAILURE", reason: "cause-unavailable", stack: "UnknownCause" }]);
    assert.deepEqual(serializeErrorCauses(new Error("x", { cause: "PRIVATE_CANARY" })).map(cause => cause.name), ["Error", "UnknownCause"]);
    let chain: Error = new Error("root");
    for (let index = 0; index < 30; index += 1) chain = new Error(`level ${String(index)}`, { cause: chain });
    const causes = serializeErrorCauses(chain);
    assert.equal(causes.length, 16);
    assert.deepEqual(causes.at(-1), { name: "UnknownCause", code: "INTERNAL_FAILURE", reason: "cause-chain-truncated", stack: "UnknownCause" });
  });

  it("maps browser client errors to finite codes", () => {
    const rows = [new DashboardClientError({ kind: "http", status: 409, code: "DASHBOARD_READ_FAILED", message: "PRIVATE_CANARY" }),
      new DashboardClientError({ kind: "http", status: 500, code: "PRIVATE_CANARY", message: "x" }),
      new DashboardClientError({ kind: "schema", message: "PRIVATE_CANARY" }),
      new DashboardClientError({ kind: "network", message: "x" })].map(error => serializeErrorCauses(error)[0]);
    assert.deepEqual(rows.map(row => [row?.code, row?.reason]), [["DASHBOARD_READ_FAILED", "read-failed"], ["INTERNAL_FAILURE", "read-failed"],
      ["SCHEMA_INVALID", "schema-invalid"], ["DASHBOARD_READ_FAILED", "network-failed"]]);
    assert.equal(PRIVATE.test(JSON.stringify(rows)), false);
  });

  it("revalidates client-claimed rows", () => {
    const error = new DashboardClientError({ kind: "schema", message: "x" });
    error.stack = "DashboardClientError: x\n    at load (http://127.0.0.1:5173/assets/index-abc123.js:1:2345)";
    const [row] = serializeErrorCauses(error);
    assert.ok(row);
    assert.equal(clientCauseRowAccepted({ message: row.name, code: row.code, reason: row.reason, stack: row.stack }), true);
    for (const claim of [
      { ...row, message: "PRIVATE_CANARY" },
      { ...row, message: "RuntimeCustodyUncertainError", code: "RUNTIME_CUSTODY_UNCERTAIN", reason: "custody-unproved" },
      { ...row, message: row.name, reason: "read-failed" },
      { ...row, message: row.name, stack: `${row.name}\n    at private (/Users/private/record.txt:1:2)` },
      { ...row, message: row.name, stack: `${row.name}\n    at assets/../secret.js:1:2` },
      { ...row, message: row.name, stack: `${row.name}: PRIVATE_CANARY` },
    ]) assert.equal(clientCauseRowAccepted({ message: claim.message, code: claim.code, reason: claim.reason, stack: claim.stack }), false);
  });

  it("refuses a second binding for one constructor", () => {
    assert.throws(() => { bindErrorOrigin(PreflightObservationChangedError, "unknown-error"); }, /error-origin-already-bound/u);
  });
});
