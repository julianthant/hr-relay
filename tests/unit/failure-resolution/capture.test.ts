import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { RunRecordService } from "../../../src/core/run-record-service.js";
import { buildTrustSection } from "../../../src/server/dashboard/queries/run-trust.js";
import { projectFailureResolution } from "../../../src/server/dashboard/queries/failure-resolution.js";
import { resolutionFixture, resolutionCommand, resolutionReadDeps } from "./fixtures.js";

describe("D capture identity and served resolution", () => {
  it("preserves populated receipt/failure/completion bytes and digest while projecting current protected notes", () => {
    const f = resolutionFixture();
    try {
      const deps = resolutionReadDeps(f); assert.ok(deps.trust);
      const receipt = deps.trust.ensureReceipt(f.record.runId);
      const sql = new DatabaseSync(f.path);
      try {
        const immutable = () => JSON.stringify(Object.fromEntries(["workflow_runs", "run_failures", "run_receipts"].map(table => [table,
          sql.prepare(`SELECT record_key, record_json FROM ${table} ORDER BY record_key`).all()])));
        const before = immutable();
        const note = "SYNTHETIC_PROTECTED_TEXT_10999999";
        assert.equal(f.kernel.execute(resolutionCommand({ payload: { action: "resolve", note } })).state, "applied");
        assert.equal(immutable(), before);
        assert.deepEqual(deps.trust.ensureReceipt(f.record.runId), receipt);
        const raw = deps.trust.failureResolution?.read(f.record.runId, f.record.failureId); assert.ok(raw);
        assert.ok(JSON.stringify(raw).includes(note));
        const served = buildTrustSection(deps, f.record.runId, "failure");
        assert.equal(JSON.stringify(served).includes(note), false);
        assert.ok(JSON.stringify(served).includes("Protected resolution note withheld."));
        assert.equal(JSON.stringify(projectFailureResolution(raw, false)).includes(note), true);
        const captured = structuredClone(served);
        f.kernel.execute(resolutionCommand({ target: { runId: f.record.runId, failureId: f.record.failureId, expectedVersion: 2 }, payload: { action: "reopen" } }));
        assert.ok(JSON.stringify(captured).includes('"status":"resolved"'));
        assert.ok(JSON.stringify(buildTrustSection(deps, f.record.runId, "failure")).includes('"status":"unresolved"'));
        assert.equal(immutable(), before);
        assert.deepEqual(deps.trust.ensureReceipt(f.record.runId), receipt);
      } finally { sql.close(); }
    } finally { f.dispose(); }
  });
  it("canonical deletion removes annotations; cached targets and new commands cannot resurrect them", () => {
    const f = resolutionFixture();
    try {
      f.kernel.execute(resolutionCommand());
      const run = f.db.authority.runs.get(f.record.runId); assert.ok(run);
      const lifecycle = new RunRecordService({ database: f.db, clock: f.clock, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("unexpected publish"); } });
      const outcome = lifecycle.delete({ commandId: randomUUID(), runId: f.record.runId, expectedVersion: run.version });
      assert.equal(outcome.state, "deleted");
      assert.equal(f.db.authority.failureResolution.read(f.record.runId, f.record.failureId), undefined);
      const generation = f.db.getMeta().authorityGeneration;
      const stale = resolutionCommand({ target: { runId: f.record.runId, failureId: f.record.failureId, expectedVersion: 2 }, payload: { action: "reopen" } });
      assert.deepEqual(f.kernel.execute(stale), { state: "rejected", commandId: stale.commandId, code: "target-deleted", message: "The failure's run was deleted." });
      assert.equal(f.db.getMeta().authorityGeneration, generation);
      assert.equal(f.db.authority.commands.get(stale.commandId), undefined);
    } finally { f.dispose(); }
  });
});

it("corrupt protected annotation JSON fails by name without echoing private text", () => {
  const f = resolutionFixture(); const sql = new DatabaseSync(f.path);
  try {
    sql.exec("PRAGMA ignore_check_constraints=ON");
    // Fault injection removes only this disposable fixture's immutable update trigger.
    const triggers = sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='run_failures'").all();
    for (const row of triggers) { assert.equal(typeof row.name, "string"); sql.exec(`DROP TRIGGER "${String(row.name).replaceAll('"', '""')}"`); }
    sql.prepare("UPDATE run_failures SET resolution_json=? WHERE record_key=?").run('SYNTHETIC_PRIVATE_NOTE_INVALID_JSON', f.record.failureId);
    assert.throws(() => buildTrustSection(resolutionReadDeps(f), f.record.runId, "failure"), error =>
      error instanceof Error && error.message === "failure-resolution-annotation-invalid");
  } finally { sql.close(); f.dispose(); }
});
