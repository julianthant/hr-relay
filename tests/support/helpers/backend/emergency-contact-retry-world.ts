import { OcrReviewRefusedError } from "../../../../src/backend/processing/ocr/review-authority.js";
import { emergencyContactModule, i9LookupModule, ocrModule, ocrPageModule, onbaseModule, personLookupModule } from "../registered-workflows.js";
import { OcrReviewRecordSchema } from "../../../../src/models/ocr/review-record.js";
import { OcrApprovedSnapshotSchema } from "../../../../src/models/ocr/review.js";
import { createApprovedOcrRecordReader } from "../../../../src/backend/runs/lifecycle/approved-ocr-records.js";
import type { SpanEmitter } from "../../../../src/backend/logs/span-emitter.js";
import type { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { TestClock } from "../../../../src/rules/time/clock.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createDeterministicContactPersistence } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { UCPATH_CONTACT_DISPLAYED_NAME, UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { EmergencyContactMemberInputSchema } from "../../../../src/models/workflows/emergency-contact-member/input.js";
import { approvedEmergencyContact, contactEffect } from "../../../../src/rules/ucpath/emergency-contact.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeWorkflowModule, compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { defineWorkflowStore } from "../../../../src/workflow-kit/task-registry.js";
import { readEmergencyContactResultTask } from "../../../../src/workflows/emergency-contact/tasks/read-result.js";
import { emergencyContactMemberWorkflow } from "../../../../src/workflows/emergency-contact-member/workflow.js";
import fixture from "../../fixtures/ui/ucpath/emergency-contact.fixture.json" with { type: "json" };
import type { BoundProfileStorageFixture } from "../admission-fixture.js";
import { registerBoundFixtureWorker, registerBoundProfile, unregisterBoundProfile } from "../synthetic-database-admission.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { createOcrReviewWorld } from "./ocr-review-world.js";
import { healthyCrmDriver, sessionFactoryHarness } from "../phase1f-executor-harness.js";
import type { Clock } from "../../../../src/rules/time/clock.js";
import type { SavedOnbaseFixture } from "../browser/fake-onbase-page.js";
import { ONBASE_SOURCE_PDF, onbaseChildFixture } from "./onbase-child-fixture.js";

export const contactSaveMember = compileWorkflow(emergencyContactMemberWorkflow);
/** Every workflow an Emergency Contact tree runs, so a parent receipt can read each child's own receipt. */
export const EC_TREE_DESCRIPTORS = [emergencyContactModule, ocrModule, ocrPageModule, personLookupModule, i9LookupModule, onbaseModule]
  .map(module => module.descriptor).concat(contactSaveMember.descriptor);

const facts = ["Example, Avery", "Example, Blake"].map((employeeName, index) => ({ employeeName, contactName: `Original Contact ${String(index)}`, correctedContactName: `Released Contact ${String(index)}` }));
const SqliteTableSchema = z.object({ name: z.string(), sql: z.string().nullable() });
const SqliteColumnSchema = z.object({ name: z.string(), type: z.string() });

type RetryOptions = Readonly<{ failures?: number; failApprovedRecordOnce?: boolean; onFencedSave?: () => void; secondMemberAlreadyPresent?: boolean; onbaseNoMatch?: boolean }>;
type ContactSeed = Readonly<{ emplId: string; persisted: ReturnType<ReturnType<typeof createDeterministicContactPersistence>["snapshot"]>; submissions: ReturnType<ReturnType<typeof createDeterministicContactPersistence>["snapshot"]>[] }>;
type MemberStageSeed = Readonly<{
  ticks: number; approvedReadFailed: boolean; failuresRemaining: number; failAfterSave: boolean;
  snapshotReads: number; recordReads: number; wall: string; monotonic: number; mintedIds: number; contacts: readonly ContactSeed[]; onbaseSaved: readonly SavedOnbaseFixture[];
}>;
type MemberStageTemplate = Readonly<{ workspace: string; profileId: string; dbRelative: string; seed: MemberStageSeed }>;

function quoteIdent(name: string) {
  return `"${name.replaceAll("\"", "\"\"")}"`;
}

function replaceBytes(bytes: Buffer, from: string, to: string) {
  const needle = Buffer.from(from), next = Buffer.from(to), chunks: Buffer[] = [];
  let start = 0, index = bytes.indexOf(needle);
  if (index === -1) return bytes;
  while (index !== -1) {
    chunks.push(bytes.subarray(start, index), next);
    start = index + needle.length;
    index = bytes.indexOf(needle, start);
  }
  chunks.push(bytes.subarray(start));
  return Buffer.concat(chunks);
}

// shortcut: prefix rewrite of text files plus sqlite text, upgrade if a copied profile stores this path in a blob or fingerprint
function retargetWorkspace(root: string, from: string, to: string, dbRelative: string) {
  const databasePath = join(root, dbRelative);
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop(); assert.ok(current);
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && path !== databasePath && !path.endsWith("-wal") && !path.endsWith("-shm")) {
        const bytes = readFileSync(path), replaced = replaceBytes(bytes, from, to);
        if (replaced !== bytes) writeFileSync(path, replaced);
      }
    }
  }
  const database = new DatabaseSync(databasePath);
  try {
    for (const table of database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(row => SqliteTableSchema.parse(row))) {
      if (table.sql?.includes("VIRTUAL") === true) continue;
      for (const column of database.prepare(`PRAGMA table_info(${quoteIdent(table.name)})`).all().map(row => SqliteColumnSchema.parse(row))) {
        const affinity = column.type.toUpperCase();
        if (affinity.includes("INT") || affinity.includes("REAL") || affinity.includes("FLOA") || affinity.includes("DOUB") || affinity.includes("BLOB")) continue;
        if (database.prepare(`SELECT 1 AS hit FROM ${quoteIdent(table.name)} WHERE instr(${quoteIdent(column.name)}, ?) > 0 LIMIT 1`).get(from) === undefined) continue;
        database.prepare(`UPDATE ${quoteIdent(table.name)} SET ${quoteIdent(column.name)} = replace(${quoteIdent(column.name)}, ?, ?) WHERE instr(${quoteIdent(column.name)}, ?) > 0`).run(from, to, from);
      }
    }
  } finally { database.close(); }
}

function resetProcessLocks(workspace: string) {
  const locks = join(workspace, rebuildRuntimeIsolation.processLockRoot);
  rmSync(locks, { recursive: true, force: true });
  mkdirSync(locks, { recursive: true, mode: 0o700 });
}

async function copyWorkspace(template: MemberStageTemplate): Promise<BoundProfileStorageFixture> {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relay-ec-copy-")));
  let lifetime: Awaited<ReturnType<typeof RuntimeLifetimeLock.acquire>> | undefined;
  let machine: ReturnType<typeof acquireEntrypointAdmission> | undefined;
  let admission: ReturnType<ReturnType<typeof acquireEntrypointAdmission>["admitProfile"]> | undefined;
  let registered = false;
  try {
    cpSync(template.workspace, workspace, { recursive: true });
    resetProcessLocks(workspace);
    retargetWorkspace(workspace, template.workspace, workspace, template.dbRelative);
    lifetime = await RuntimeLifetimeLock.acquire(0);
    machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
    admission = machine.admitProfile(template.profileId);
    assert.equal(join(admission.stateRoot, "state.db"), join(workspace, template.dbRelative));
    registerBoundProfile(admission, machine);
    registered = true;
  } catch (error) {
    const failures = [error];
    if (registered && admission !== undefined) try { unregisterBoundProfile(admission); } catch (cleanup) { failures.push(cleanup); }
    if (admission !== undefined) try { admission.release(); } catch (cleanup) { failures.push(cleanup); }
    if (machine !== undefined) try { machine.release(); } catch (cleanup) { failures.push(cleanup); }
    if (lifetime !== undefined) try { await lifetime.close(); } catch (cleanup) { failures.push(cleanup); }
    try { rmSync(workspace, { recursive: true, force: true }); } catch (cleanup) { failures.push(cleanup); }
    throw failures.length === 1 ? error : new AggregateError(failures, "copied profile admission failed");
  }
  assert.ok(lifetime !== undefined && machine !== undefined && admission !== undefined);
  const openedLifetime = lifetime, openedMachine = machine, openedAdmission = admission;
  let closed = false;
  return { workspace, get machine() { return openedMachine; }, get admission() { return openedAdmission; }, stateRoot: openedAdmission.stateRoot, path: join(openedAdmission.stateRoot, "state.db"),
    async close() {
      if (closed) return;
      closed = true;
      unregisterBoundProfile(openedAdmission); openedAdmission.release(); openedMachine.release(); await openedLifetime.close();
      rmSync(workspace, { recursive: true, force: true });
    } };
}

function adoptWorkers(database: AuthorityDatabase, path: string, clock: TestClock) {
  const workflows = new Set<string>();
  const walk = (run: RunRecord) => {
    workflows.add(run.envelope.workflow);
    for (const child of database.authority.runs.listChildren(run.envelope.runId)) walk(child);
  };
  for (const root of database.authority.runs.listByWorkflow("emergency-contact")) walk(root);
  for (const workflow of workflows) {
    for (const slot of database.authority.workerSlots.active(workflow)) {
      registerBoundFixtureWorker({ database, path, workerId: slot.workerId, clock });
    }
  }
}

function templateKey(options: RetryOptions) {
  return JSON.stringify({ failures: options.failures ?? 1, failApprovedRecordOnce: options.failApprovedRecordOnce === true, secondMemberAlreadyPresent: options.secondMemberAlreadyPresent === true, onbaseNoMatch: options.onbaseNoMatch === true });
}

export function createEmergencyContactRetryWorld() {
  const world = createOcrReviewWorld();
  const templates = new Map<string, MemberStageTemplate>();
  const adopted: (() => Promise<void>)[] = [];
  function pieces(options: RetryOptions, seed?: MemberStageSeed) {
    const control = { failuresRemaining: seed?.failuresRemaining ?? options.failures ?? 1, unknownAfterSave: false, failAfterSave: seed?.failAfterSave ?? options.secondMemberAlreadyPresent === true, failAccounting: false, changeApprovedSnapshot: false, snapshotReads: seed?.snapshotReads ?? 0, changeApprovedRecord: false, recordReads: seed?.recordReads ?? 0 };
    const hooks: { onSpan?: (event: Parameters<SpanEmitter["emit"]>[0]) => void; onTransactionSettled?: () => void } = {};
    let ticks = seed?.ticks ?? Date.parse(fixture.page.observedAt);
    const now = () => new Date(++ticks).toISOString();
    const persistence = new Map<string, ReturnType<typeof createDeterministicContactPersistence>>();
    const onbase = onbaseChildFixture({ noMatch: options.onbaseNoMatch, saved: seed?.onbaseSaved }), onbaseClock: { current?: Clock } = {};
    for (const contact of seed?.contacts ?? []) {
      const backend = createDeterministicContactPersistence(contact.persisted, now);
      for (const submission of contact.submissions) backend.submissions.push(UcpathContactPageSnapshotSchema.parse(submission));
      persistence.set(contact.emplId, backend);
    }
    const sessions = sessionFactoryHarness({ ucpath: (): ReturnType<typeof createDeterministicUcpathPersonOrgDriver> => {
      const base = createDeterministicUcpathPersonOrgDriver();
      let activeEid: string | undefined;
      let active: ReturnType<typeof createDeterministicUcpathPersonOrgDriver> | undefined;
      function forSubject(input: { emplId: string; expectedName: string }) {
        if (active !== undefined && activeEid === input.emplId) return active;
        activeEid = input.emplId;
        let backend = persistence.get(input.emplId);
        if (backend === undefined) {
          backend = createDeterministicContactPersistence(UcpathContactPageSnapshotSchema.parse({ ...fixture.page, displayedEid: input.emplId, displayedName: input.expectedName }), now);
          persistence.set(input.emplId, backend);
        }
        const session = backend.session();
        active = createDeterministicUcpathPersonOrgDriver(undefined, undefined, session.port, session.save);
        return active;
      }
      return { ...base,
        async searchPersonOrg(input) {
          assert.equal(input.kind, "by-name"); assert.ok("name" in input);
          const index = facts.findIndex(fact => fact.employeeName === input.name); assert.ok(index >= 0);
          const candidate = { emplId: String(10800000 + index), name: input.name, department: "Housing Dining Hospitality", jobTitle: "Fixture employee", employeeStatus: "active", hdh: true,
            hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" };
          return SearchPersonOrgOutputSchema.parse({ results: [candidate], selection: { status: "resolved", selected: candidate, candidateEids: [candidate.emplId] } });
        },
        readEmergencyContacts: input => forSubject(input).readEmergencyContacts(input),
        async stageEmergencyContact(input, plan) {
          if (input.emplId === "10800001" && control.failuresRemaining > 0) {
            control.failuresRemaining -= 1;
            throw new Error("fixture-second-member-prepare-refused");
          }
          return forSubject(input).stageEmergencyContact(input, plan);
        },
        async saveEmergencyContact(input, capability) {
          options.onFencedSave?.();
          const result = await forSubject(input).saveEmergencyContact(input, capability);
          if (control.unknownAfterSave) throw new Error("fixture-save-response-lost");
          return result;
        },
        read: id => id === UCPATH_CONTACT_DISPLAYED_NAME && active !== undefined ? active.read(id) : base.read(id),
      };
    }, crm: () => ({ ...healthyCrmDriver(), async searchOnboardingRecords() { return []; } }), onbase: () => {
      assert.ok(onbaseClock.current);
      return onbase.driver(onbaseClock.current);
    } });
    const member = composeWorkflowModule(contactSaveMember, taskStoreRegistry.stores);
    let approvedReadFailed = seed?.approvedReadFailed === true;
    const approvedReader = (context: Parameters<typeof createApprovedOcrRecordReader>[0]): ReturnType<typeof createApprovedOcrRecordReader> => {
      const reader = createApprovedOcrRecordReader(context);
      return { ...reader, readRecord: query => {
        const record = reader.readRecord(query);
        control.recordReads += 1;
        if (options.failApprovedRecordOnce === true && !approvedReadFailed && record.assertedEid === "10800001") {
          approvedReadFailed = true;
          throw new OcrReviewRefusedError();
        }
        return control.changeApprovedRecord ? OcrReviewRecordSchema.parse({ ...record, assertedEid: "10800002" }) : record;
      }, readSnapshot: approval => {
        const snapshot = reader.readSnapshot(approval);
        control.snapshotReads += 1;
        return control.changeApprovedSnapshot ? OcrApprovedSnapshotSchema.parse({ ...snapshot,
          selectedRecordIds: snapshot.selectedRecordIds.slice(0, 1), records: snapshot.records.slice(0, 1) }) : snapshot;
      } };
    };
    const accountingStore = defineWorkflowStore("emergency-contact", { readResult: defineTask(readEmergencyContactResultTask.contract, {
      sessions: [], async run(args) {
        if (control.failAccounting) return args.ctx.fail("OCR_REVIEW_REFUSED", "Synthetic parent accounting failure.");
        return readEmergencyContactResultTask.impl.run(args);
      },
    }) });
    return { control, hooks, persistence, onbase, onbaseClock, sessions, approvedReader, accountingStore, member, now, tickCount: () => ticks, approvedReadFailed: () => approvedReadFailed };
  }
  async function build(options: RetryOptions) {
    const live = pieces({ ...options, onFencedSave: undefined });
    const ids = sequentialIdFactory("b");
    const f = await world.fixture({ ids, coordinator: true, member: live.member, approvedStore: live.accountingStore, sourcePdf: ONBASE_SOURCE_PDF,
      onHarness: harness => { live.onbaseClock.current = harness.authority.clock; },
      approvedReader: live.approvedReader, onSpan: event => live.hooks.onSpan?.(event),
      onTransactionSettled: run => {
        live.hooks.onTransactionSettled?.();
        if (live.control.failAfterSave && (options.secondMemberAlreadyPresent !== true
          || EmergencyContactMemberInputSchema.parse(run.input.parsed.value).record.assertedEid === "10800001")) {
          live.control.failAfterSave = false; throw new Error("fixture-local-failure-after-transaction-settlement");
        }
    }, record: true, release: true, pageCount: 2, reviewedPages: facts, operatorEvidence: true, sessions: live.sessions, screenshotCapture: { capture: async context => { assert.equal(context.screenshot.state, "available"); } } });
    assert.equal(live.persistence.size, 0);
    for (let index = 0; index < facts.length; index++) {
      const command = f.command("correct-ocr-record", index + 1, index);
      assert.equal(f.canonical.kernel.execute({ ...command, payload: { ...command.payload, assertedEid: String(10800000 + index) } }).state, "applied");
    }
    assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
    if (options.secondMemberAlreadyPresent) {
      const review = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(review);
      const record = review.records.find(record => record.assertedEid === "10800001"); assert.ok(record);
      const input = approvedEmergencyContact(record), desired = contactEffect(input);
      const rows = UcpathContactPageSnapshotSchema.parse(fixture.page).rows;
      rows[0] = { ...rows[0], primary: false };
      rows[1] = { rowIndex: 1, name: desired.name, relationship: desired.relationship, primary: true, phone: desired.phone ?? "",
        sameAddressAsEmployee: false, address: desired.address.kind === "explicit" ? desired.address.fields : null };
      live.persistence.set(input.emplId, createDeterministicContactPersistence(UcpathContactPageSnapshotSchema.parse({ ...fixture.page,
        displayedEid: input.emplId, displayedName: input.expectedName, rows }), live.now));
    }
    const interrupted = await f.canonical.execute(f.parentRun, new AbortController().signal);
    if ((options.failures ?? 1) > 0) assert.equal(interrupted.run?.lifecycle.state, "queued", "a terminal failed sibling requeues the allow-partial parent");
    // The failed sibling ends execute while the saved member's OnBase child can still be queued; settle it so the template holds only the parent.
    for (const child of f.database.authority.runs.listChildren(f.parentRun.envelope.runId)
      .flatMap(member => f.database.authority.runs.listChildren(member.envelope.runId)).filter(run => run.lifecycle.state === "queued")) {
      const imported = await f.canonical.step(f.parentRun, new AbortController().signal);
      assert.equal(imported.run.envelope.runId, child.envelope.runId);
      const member = await f.canonical.step(f.parentRun, new AbortController().signal);
      assert.equal(member.run.envelope.runId, child.envelope.parent?.runId);
      assert.equal(member.outcome.state, "done");
    }
    return { ...f, live, mintedIds: ids.minted().length };
  }
  function present(f: Awaited<ReturnType<typeof world.fixture>>, live: ReturnType<typeof pieces>) {
    const current = (runId = f.parentRun.envelope.runId) => { const run = f.database.authority.runs.get(runId); assert.ok(run); return run; };
    const command = (type: "retry" | "pause" | "resume", run: RunRecord) => ({ commandId: randomUUID(), family: "run" as const,
      type, source: "run-detail" as const, requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(),
      target: { runId: run.envelope.runId, expectedVersion: run.version } });
    const children = () => f.database.authority.runs.listChildren(f.parentRun.envelope.runId).filter(run => run.envelope.workflow === "emergency-contact-member");
    // A member yields to its hidden OnBase child; one step settles the child and the member's resumption with it.
    const step: typeof f.canonical.step = async (root, signal) => {
      const first = await f.canonical.step(root, signal);
      if (first.run.envelope.workflow !== "emergency-contact-member" || first.outcome.state !== "yielded-delegation") return first;
      const child = await f.canonical.step(root, signal);
      assert.equal(child.run.envelope.parent?.runId, first.run.envelope.runId);
      if (current(first.run.envelope.runId).lifecycle.state !== "queued") return child;
      const resumed = await f.canonical.step(root, signal);
      assert.equal(resumed.run.envelope.runId, first.run.envelope.runId);
      return resumed;
    };
    return { ...f, canonical: { ...f.canonical, step }, facts, persistence: live.persistence, onbase: live.onbase, control: live.control, hooks: live.hooks, approvedReader: live.approvedReader, current, runCommand: command, children };
  }
  async function capture(built: Awaited<ReturnType<typeof build>>): Promise<MemberStageTemplate> {
    const source = built.harness.authority.profile.workspace;
    const dbRelative = relative(source, built.path);
    assert.equal(dbRelative.startsWith(".."), false);
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relay-ec-template-")));
    try {
      cpSync(source, workspace, { recursive: true });
      resetProcessLocks(workspace);
      const destination = join(workspace, dbRelative);
      rmSync(destination, { force: true }); rmSync(`${destination}-wal`, { force: true }); rmSync(`${destination}-shm`, { force: true });
      const database = new DatabaseSync(built.path, { timeout: 5_000 });
      try { await backup(database, destination); } finally { database.close(); }
      retargetWorkspace(workspace, source, workspace, dbRelative);
    } catch (error) {
      try { rmSync(workspace, { recursive: true, force: true }); } catch (cleanup) { throw new AggregateError([error, cleanup], "member-stage template capture failed", { cause: cleanup }); }
      throw error;
    }
    const { live } = built;
    return { workspace, profileId: built.admission.profileBinding.profileId, dbRelative, seed: {
      ticks: live.tickCount(), approvedReadFailed: live.approvedReadFailed(), failuresRemaining: live.control.failuresRemaining, failAfterSave: live.control.failAfterSave,
      snapshotReads: live.control.snapshotReads, recordReads: live.control.recordReads, wall: built.clock.now().toISOString(), monotonic: built.clock.monotonicMs(), mintedIds: built.mintedIds,
      contacts: [...live.persistence.entries()].map(([emplId, backend]) => ({ emplId, persisted: backend.snapshot(), submissions: backend.submissions.map(submission => UcpathContactPageSnapshotSchema.parse(submission)) })),
      onbaseSaved: live.onbase.saved(),
    } };
  }
  async function reopen(template: MemberStageTemplate, options: RetryOptions) {
    const profile = await copyWorkspace(template);
    const adoptedWorld = createOcrReviewWorld(async () => profile);
    const close = () => adoptedWorld.cleanup();
    adopted.push(close);
    try {
      const live = pieces(options, template.seed);
      const ids = sequentialIdFactory("b");
      for (let index = 0; index < template.seed.mintedIds; index += 1) ids.uuid();
      const f = await adoptedWorld.fixture({ ids, adoptExisting: true, coordinator: true, member: live.member, approvedStore: live.accountingStore,
        onHarness: harness => { live.onbaseClock.current = harness.authority.clock; },
        approvedReader: live.approvedReader, onSpan: event => live.hooks.onSpan?.(event),
        onTransactionSettled: run => {
          live.hooks.onTransactionSettled?.();
          if (live.control.failAfterSave && (options.secondMemberAlreadyPresent !== true
            || EmergencyContactMemberInputSchema.parse(run.input.parsed.value).record.assertedEid === "10800001")) {
            live.control.failAfterSave = false; throw new Error("fixture-local-failure-after-transaction-settlement");
          }
        }, record: true, release: true, pageCount: 2, reviewedPages: facts, operatorEvidence: true, sessions: live.sessions, screenshotCapture: { capture: async context => { assert.equal(context.screenshot.state, "available"); } } });
      f.clock.setWall(new Date(template.seed.wall));
      f.clock.advanceMonotonic(template.seed.monotonic - f.clock.monotonicMs());
      adoptWorkers(f.database, f.path, f.clock);
      return present(f, live);
    } catch (error) {
      const index = adopted.lastIndexOf(close);
      if (index >= 0) adopted.splice(index, 1);
      const failures = [error];
      try { await close(); } catch (cleanup) { failures.push(cleanup); }
      try { await profile.close(); } catch (cleanup) { failures.push(cleanup); }
      throw failures.length === 1 ? error : new AggregateError(failures, "copied member-stage reopen failed");
    }
  }
  const releaseTemplates = () => {
    for (const template of templates.values()) rmSync(template.workspace, { recursive: true, force: true });
    templates.clear();
  };
  process.on("exit", releaseTemplates);
  return { releaseTemplates, async releaseSources() {
    releaseTemplates();
    await world.cleanup();
  }, cleanup: async () => {
    const failures: unknown[] = [];
    try { await world.cleanup(); } catch (error) { failures.push(error); }
    for (const close of adopted.splice(0)) {
      try { await close(); } catch (error) { failures.push(error); }
    }
    if (failures.length !== 0) throw new AggregateError(failures, "executor-fixture-closure-unproved");
  }, async fixture(options: RetryOptions = {}) {
    const key = templateKey(options);
    let template = templates.get(key);
    if (template === undefined) {
      const built = await build(options);
      template = await capture(built);
      templates.set(key, template);
    }
    return reopen(template, options);
  } };
}
