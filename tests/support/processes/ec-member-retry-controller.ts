import { unusedWorkerPool } from "../helpers/backend/unused-worker-pool.js";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createEmergencyContactRetryWorld, EC_TREE_DESCRIPTORS } from "../helpers/backend/emergency-contact-retry-world.js";
import { FakeKeyringEntry } from "../helpers/credential-keychain-fake.js";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { createCommandKernel } from "../../../src/backend/runs/commands/command-kernel.js";
import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { reconcileStartupCrash } from "../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { workflowModuleOf, childWorkflowModuleOf } from "../../../src/backend/app/registries/workflow-registry.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../fixtures/intake-kernel-seams.js";

const [mode, serialized] = process.argv.slice(2);
const boundary = mode?.replace(/-failed$/u, "");
async function send(value: unknown) {
  await new Promise<void>((resolve, reject) => process.send?.(value, error => error ? reject(error) : resolve()));
}

if (serialized === undefined) {
  const world = createEmergencyContactRetryWorld();
  let armed = false;
  const f = await world.fixture({ failures: boundary === "settlement" || boundary === "parent-requested" ? 2 : 1, onFencedSave: () => {
    if (armed && boundary === "fence") process.kill(process.pid, "SIGKILL");
  } });
  await world.releaseSources();
  f.control.failAccounting = mode?.endsWith("-failed") === true;
  await f.canonical.execute(f.parentRun, new AbortController().signal);
  const parent = f.current(); assert.ok(parent.completion);
  const receipt = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: [...EC_TREE_DESCRIPTORS, f.root.descriptor] }).ensureReceipt(parent.envelope.runId);
  const failed = f.children().find(run => run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed"); assert.ok(failed);
  const request = f.runCommand("retry", failed);
  const source = f.database.authority.runResults.get(parent.envelope.runId); assert.ok(source);
  const retained = () => {
    const raw = new DatabaseSync(f.path, { readOnly: true });
    try {
      return { retainedResults: raw.prepare("SELECT settlement_version,payload_json,terminal_run_json FROM run_results WHERE run_id=? ORDER BY settlement_version").all(parent.envelope.runId),
        retainedReceipts: raw.prepare("SELECT id,payload_json FROM run_receipts WHERE run_id=? ORDER BY id").all(parent.envelope.runId) };
    } finally { raw.close(); }
  };
  const info = { workspace: f.harness.authority.profile.workspace, profileId: f.admission.profileBinding.profileId, path: f.path,
    keychain: FakeKeyringEntry.snapshot(), parentId: parent.envelope.runId, originalVersion: parent.completion.expectedVersion + 1,
    originalResult: canonicalJsonStringify(source), originalEnvelope: canonicalJsonStringify(parent.envelope),
    receiptId: receipt.receiptId, originalReceipt: canonicalJsonStringify(receipt), failedId: failed.envelope.runId,
    request, now: f.clock.now().toISOString(), ...retained() };
  await send(info);
  if (boundary === "before-commit") {
    const transaction = f.database.withAuthorityTransaction.bind(f.database);
    f.database.withAuthorityTransaction = work => transaction(repositories => {
      const result = work(repositories);
      if (repositories.commandAudits.findByCommand(request.commandId)?.result.state === "applied") process.kill(process.pid, "SIGKILL");
      return result;
    });
  }
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  armed = true;
  f.hooks.onTransactionSettled = () => { if (boundary === "commit") process.kill(process.pid, "SIGKILL"); };
  if (boundary === "fence" || boundary === "commit" || boundary === "resume" || boundary === "resume-rollback" || boundary === "settlement" || boundary === "parent-requested") {
    assert.equal((await f.canonical.step(f.parentRun, new AbortController().signal)).outcome.state,
      boundary === "settlement" || boundary === "parent-requested" ? "failed" : "done");
    if (boundary === "resume-rollback") {
      const resume = f.runCommand("resume", f.current());
      await send({ ...info, resume });
      const transaction = f.database.withAuthorityTransaction.bind(f.database);
      f.database.withAuthorityTransaction = work => transaction(repositories => {
        const result = work(repositories);
        if (repositories.commandAudits.findByCommand(resume.commandId)?.result.state === "applied") process.kill(process.pid, "SIGKILL");
        return result;
      });
      assert.equal(f.canonical.kernel.execute(resume).state, "applied");
      throw new Error("Resume rollback boundary did not terminate its owner");
    }
    if (boundary !== "fence" && boundary !== "commit") assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
  }
  if (boundary === "parent-requested") {
    const next = f.children().find(run => run.envelope.retryOf !== undefined); assert.ok(next);
    f.hooks.onSpan = event => {
      if (event.t === "span.ended" && event.kind === "task" && event.outcome === "done"
        && event.spanPath.includes("/read-result") && event.runId === parent.envelope.runId) {
        assert.equal(f.canonical.kernel.execute(f.runCommand("retry", next)).state, "applied");
        assert.equal(f.current().pause?.state, "requested");
        process.kill(process.pid, "SIGKILL");
      }
    };
    await f.canonical.step(f.parentRun, new AbortController().signal);
    throw new Error("parent accounting crash boundary was not reached");
  }
  if (boundary === "settlement") {
    f.control.failAccounting = false;
    assert.equal((await f.canonical.step(f.parentRun, new AbortController().signal)).outcome.state, "done");
    const receipts = createReceiptService({ database: f.database, runReader: f.canonical.lifecycle, descriptors: [...EC_TREE_DESCRIPTORS, f.root.descriptor] });
    receipts.ensureReceipt(parent.envelope.runId);
    const next = f.children().find(run => run.envelope.retryOf !== undefined && run.lifecycle.state === "terminal" && run.lifecycle.outcome === "failed"); assert.ok(next);
    assert.equal(f.canonical.kernel.execute(f.runCommand("retry", next)).state, "applied");
    assert.equal((await f.canonical.step(f.parentRun, new AbortController().signal)).outcome.state, "done");
    assert.equal(f.canonical.kernel.execute(f.runCommand("resume", f.current())).state, "applied");
    assert.equal((await f.canonical.step(f.parentRun, new AbortController().signal)).outcome.state, "done");
    receipts.ensureReceipt(parent.envelope.runId);
    assert.deepEqual([...f.persistence.values()].map(value => value.submissions.length), [1,1]);
  }
  await send({ ...info, ...retained() });
  process.kill(process.pid, "SIGKILL");
  throw new Error("EC retry controller did not terminate at its requested boundary");
} else {
  const { z } = await import("zod");
  const info = z.object({ workspace: z.string(), profileId: z.string(), path: z.string(), keychain: z.array(z.tuple([z.string(), z.string()])),
    parentId: z.string(), originalVersion: z.number(), originalResult: z.string(), originalEnvelope: z.string(), receiptId: z.string(), originalReceipt: z.string(),
    failedId: z.string(), request: CommandRequestSchema, resume: CommandRequestSchema.optional(), now: z.string(),
    retainedResults: z.array(z.object({ settlement_version: z.number(), payload_json: z.string(), terminal_run_json: z.string() })),
    retainedReceipts: z.array(z.object({ id: z.string(), payload_json: z.string() })) }).parse(JSON.parse(serialized));
  FakeKeyringEntry.import(info.keychain);
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  const machine = acquireEntrypointAdmission(info.workspace, "exclusive", lifetime), admission = machine.admitProfile(info.profileId);
  const clock = manualClock(new Date(info.now));
  const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
  const database = AuthorityDatabase.open(admission, { path: info.path, busyTimeoutMs: 250, migrationOwner: "ec-retry-successor" }, clock,
    undefined, undefined, undefined, credentials);
  const modules = [workflowModuleOf("emergency-contact"), childWorkflowModuleOf("emergency-contact", "emergency-contact-member")];
  const resolve = (id: string) => modules.find(module => module.descriptor.id === id)?.descriptor;
  const unused = (): never => { throw new Error("crash replay cannot execute effects"); };
  const lifecycle = new RunRecordService({ database, clock, ids: { uuid: randomUUID }, resolveDescriptor: resolve, publishQueued: unused });
  try {
    const old = database.authority.runResults.getSettlement(info.parentId, info.originalVersion); assert.ok(old);
    assert.equal(canonicalJsonStringify(old.result), info.originalResult);
    assert.equal(canonicalJsonStringify(database.authority.evidenceReceipts.get(info.receiptId)), info.originalReceipt);
    const parent = database.authority.runs.get(info.parentId); assert.ok(parent);
    assert.equal(canonicalJsonStringify(parent.envelope), info.originalEnvelope);
    const replacements = database.authority.runs.listChildren(info.parentId).filter(run => run.envelope.retryOf === info.failedId);
    if (boundary === "before-commit") {
      assert.equal(replacements.length, 0);
      assert.equal(database.authority.commands.get(info.request.commandId)?.commandId, info.request.commandId);
      assert.equal(database.authority.commandAudits.findByCommand(info.request.commandId), undefined);
      assert.equal(parent.lifecycle.state, "terminal");
    } else {
      assert.equal(replacements.length, 1);
      const replacement = replacements[0]; assert.ok(replacement);
      const intents = database.authority.writeIntents.listByRun(replacement.envelope.runId);
      if (boundary === "fence" || boundary === "commit") {
        assert.equal(intents[0]?.status, boundary === "commit" ? "committed" : "attempting");
        reconcileStartupCrash({ machine, admission, database, lifecycle, clock, lock: lifetime });
        const recovered = database.authority.runs.get(replacement.envelope.runId);
        if (boundary === "fence") assert.equal(recovered?.lifecycle.state, "parked-write");
        else assert.ok(recovered?.lifecycle.state === "terminal" && recovered.lifecycle.outcome === "failed");
      }
      if (boundary === "resume") {
        assert.equal(parent.pause, undefined);
        assert.equal(parent.envelope.continuation, undefined);
        assert.equal(database.authority.dependencies.readiness(info.parentId, "join").state, "ready");
      }
      if (boundary === "resume-rollback") {
        assert.ok(info.resume);
        assert.equal(database.authority.commands.get(info.resume.commandId)?.commandId, info.resume.commandId);
        assert.equal(database.authority.commandAudits.findByCommand(info.resume.commandId), undefined);
        assert.equal(parent.pause?.state, "paused");
        assert.equal(parent.envelope.continuation, undefined);
        assert.notEqual(database.authority.dependencies.readiness(info.parentId, "join").state, "ready");
      }
      if (boundary === "parent-requested") {
        assert.equal(parent.pause?.state, "requested");
        const queued = database.authority.runs.listChildren(info.parentId).find(run => run.envelope.retryOf === replacement.envelope.runId); assert.ok(queued);
        assert.equal(queued.lifecycle.state, "queued");
        reconcileStartupCrash({ machine, admission, database, lifecycle, clock, lock: lifetime });
        const recovered = database.authority.runs.get(info.parentId); assert.ok(recovered?.lifecycle.state === "terminal" && recovered.lifecycle.outcome === "failed");
        assert.equal(database.authority.runs.get(queued.envelope.runId)?.lifecycle.state, "queued");
        assert.notEqual(database.authority.dependencies.readiness(info.parentId, "join").state, "ready");
      }
      const before = canonicalJsonStringify({ runs: database.authority.runs.listChildren(info.parentId), intents: database.authority.writeIntents.listByRun(replacement.envelope.runId) });
      const kernel = createCommandKernel({ authority: database, lifecycle, clock, ids: { uuid: randomUUID }, appVersion: "0.1.0", descriptors: { resolve },
        configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
        writeResolution: { recheck: unused, resolveAbsent: unused }, workerRuntime: { pool: unusedWorkerPool(unused) } });
      assert.equal(kernel.execute(info.request).state, "already-applied");
      if (boundary === "commit") {
        const recovered = database.authority.runs.get(replacement.envelope.runId); assert.ok(recovered);
        assert.equal(kernel.execute({ commandId: randomUUID(), family: "run", type: "retry", source: "run-detail", requestedBy: "local-operator",
          requestedAt: clock.now().toISOString(), target: { runId: recovered.envelope.runId, expectedVersion: recovered.version } }).state, "rejected");
      }
      assert.equal(canonicalJsonStringify({ runs: database.authority.runs.listChildren(info.parentId), intents: database.authority.writeIntents.listByRun(replacement.envelope.runId) }), before);
      assert.equal(canonicalJsonStringify(database.authority.runResults.getSettlement(info.parentId, info.originalVersion)?.result), info.originalResult);
    }
    for (const row of info.retainedResults) {
      const settled = database.authority.runResults.getSettlement(info.parentId, row.settlement_version); assert.ok(settled);
      assert.equal(canonicalJsonStringify(settled.result), row.payload_json);
      assert.equal(canonicalJsonStringify(settled.run), row.terminal_run_json);
    }
    for (const row of info.retainedReceipts) assert.equal(canonicalJsonStringify(database.authority.evidenceReceipts.get(row.id)), row.payload_json);
    await send({ observed: true });
  } finally { database.close(); admission.release(); machine.release(); await lifetime.close(); }
}
