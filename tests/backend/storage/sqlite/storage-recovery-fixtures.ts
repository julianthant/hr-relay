import { cpSync, mkdtempSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase as FixtureAuthorityDatabase } from "../../../support/helpers/synthetic-database-admission.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { PERSON_LOOKUP_ACTIVE, personLookupTerminalIdentityEvidence } from "../../../support/helpers/run-integration-world.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { CONFIG_SNAPSHOT, HASH_A, HASH_B, NOW, UUID_1, UUID_2, UUID_3, UUID_7, UUID_8 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { releaseSeededWriteOwners } from "../../../support/helpers/timeline-write-fixture.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach } from "vitest";
import { buildRunResult } from "../../../../src/backend/runs/lifecycle/run-result.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { ReadActiveStatus } from "../../../../src/models/workflows/person-lookup/read-active-status.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { SpanEventWireSchema } from "../../../../src/models/events/types.js";
import { TimelineEventRecordSchema } from "../../../../src/models/events/timeline.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/index.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import {
  QUEUED_RUN,
} from "../../../support/fixtures/phase1f-run-fixtures.js";
import { PersonLookupCanonicalInput } from "../../../../src/workflows/person-lookup/workflow.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const roots: string[] = [];
const profiles = new Map<string, Awaited<ReturnType<typeof createBoundProfileFixture>>>();
const initialGenerations = new Map<string, number>();
const databases: AuthorityDatabase[] = [];
const CLOCK = manualClock(new Date(NOW));
const AFTER_NOW = "2026-07-31T17:01:00.000Z";
const ACTIVE_STATUS = PERSON_LOOKUP_ACTIVE;

function runningTerminalFixture(
  database: AuthorityDatabase,
  runId: string,
  itemId: string,
  traceId: string,
  nodeId: "active-status" | "crm-dates",
) {
  const path = [...timelineFixtureOwners].find(([, owner]) => owner === database)?.[0];
  assert.ok(path, "terminal fixture requires its owned authority path");
  const authorityPath = timelineFixturePaths.get(path);
  assert.ok(authorityPath);
  const poolIndex = database.authority.workerSlots.list().length + 1;
  testWorkerPorts(database, CLOCK, { path: authorityPath, descriptor: personLookupDescriptor, poolIndex });
  const member = database.authority.workerSlots.list().find((slot) => slot.poolIndex === poolIndex);
  assert.ok(member);
  const workerId = member.workerId;
  const activeConfig = database.authority.runtimeConfig.get();
  assert.ok(activeConfig);
  database.authority.runs.enqueue({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      configSnapshotId: activeConfig.configSnapshotId,
      configFingerprint: activeConfig.configFingerprint,
      runId,
      itemId,
      traceId,
      workflow: personLookupDescriptor.id,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: personLookupDescriptor.contractFingerprint,
    },
    input: {
      ...QUEUED_RUN.input,
      parsed: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        protectedBindings: [],
        value: { mode: "search", crmCheck: true, emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
      },
    },
  });
  const claimed = database.authority.runs.claimNext({
    workflow: personLookupDescriptor.id,
    workerId,
    now: NOW,
  });
  if (claimed.state !== "claimed" || claimed.run.envelope.runId !== runId) {
    throw new Error(`terminal recovery fixture did not claim ${runId}`);
  }
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const validating = database.authority.runs.transition({
    runId,
    expectedVersion: claimed.run.version,
    claim,
    lifecycle: { state: "validating", workerId, claimedAt: NOW, heartbeatAt: NOW },
    now: NOW,
  });
  if (validating.state !== "applied") throw new Error(`terminal recovery fixture did not validate ${runId}`);
  const running = database.authority.runs.transition({
    runId,
    expectedVersion: validating.run.version,
    claim,
    lifecycle: {
      state: "running",
      workerId,
      claimedAt: NOW,
      heartbeatAt: NOW,
      currentNodeId: nodeId,
    },
    now: NOW,
  });
  if (running.state !== "applied") throw new Error(`terminal recovery fixture did not run ${runId}`);
  return { run: running.run, claim };
}

function seedTerminalAuthority(database: AuthorityDatabase) {
  const failed = runningTerminalFixture(
    database,
    UUID_1,
    UUID_3,
    "pl-170000-aaaa",
    "crm-dates",
  );
  const failure = {
    failureId: UUID_8,
    fingerprint: HASH_B,
    runId: failed.run.envelope.runId,
    traceId: failed.run.envelope.traceId,
    attempt: failed.run.envelope.attempt,
    workflowId: failed.run.envelope.workflow,
    nodeId: "crm-dates",
    taskId: "crm/read-onboarding-dates",
    code: "CRM_UNAVAILABLE",
    summary: "CRM onboarding dates were unavailable",
    transient: true,
    writeState: "not-attempted",
    causeChain: [{
      code: "CRM_UNAVAILABLE",
      summary: "CRM returned an unavailable response",
      role: "primary",
      transient: true,
    }],
    remediation: [{ kind: "retry-when-served", message: "Retry after CRM is available" }],
    occurredAt: NOW,
  } as const;
  const failureAuthorization = {
    kind: "failed" as const,
    runId: failed.run.envelope.runId,
    workflowId: failed.run.envelope.workflow,
    attempt: failed.run.envelope.attempt,
    descriptorVersion: failed.run.envelope.descriptorVersion,
    contractFingerprint: failed.run.envelope.contractFingerprint,
    expectedVersion: failed.run.version,
    claim: failed.claim,
    authorizedAt: NOW,
    failureId: failure.failureId,
  };
  database.terminalizeFailure(personLookupDescriptor, {
    failure,
    authorization: failureAuthorization,
  });

  const done = runningTerminalFixture(
    database,
    UUID_2,
    UUID_7,
    "pl-170001-bbbb",
    "active-status",
  );
  const checkpoint = RunCheckpointRecordSchema.parse({
    workflowId: done.run.envelope.workflow,
    itemId: done.run.envelope.itemId,
    nodeId: "active-status",
    attempt: done.run.envelope.attempt,
    claimGeneration: 1,
    runId: done.run.envelope.runId,
    output: {
      schemaHash: deriveSchemaHash(ReadActiveStatus.output, "output"),
      value: ACTIVE_STATUS,
    },
    descriptorVersion: done.run.envelope.descriptorVersion,
    contractFingerprint: done.run.envelope.contractFingerprint,
    implFingerprint: HASH_A,
    provenance: [{ path: "state", source: "derived", observedAt: NOW, originalObservedAt: NOW }],
    writtenAt: NOW,
  });
  database.authority.runCheckpoints.insert(checkpoint);
  const identityEvidence = personLookupTerminalIdentityEvidence(done.run);
  for (const entry of identityEvidence) {
    if (entry.state === "resolved") database.authority.runCheckpoints.insert(entry.checkpoint);
  }
  const built = buildRunResult(personLookupDescriptor, done.run, [
    ...identityEvidence,
    { state: "resolved", nodeId: "active-status", checkpoint },
    { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
  ], CLOCK);
  const successAuthorization = {
    kind: "done" as const,
    runId: built.record.runId,
    workflowId: built.record.workflowId,
    attempt: built.record.attempt,
    descriptorVersion: built.record.descriptorVersion,
    contractFingerprint: built.record.contractFingerprint,
    expectedVersion: done.run.version,
    claim: done.claim,
    authorizedAt: NOW,
    resultDigest: built.record.resultDigest,
  };
  database.terminalizeSuccess({
    result: built.record,
    authorization: successAuthorization,
  }, built.authorization);
  return { failure, failureAuthorization, result: built.record, successAuthorization };
}

type AuthorityTemplate = {
  readonly profile: Awaited<ReturnType<typeof createBoundProfileFixture>>;
  readonly snapshotRoot: string;
  readonly generation: number;
};
const authorityTemplates = new Map<"global" | "profile", AuthorityTemplate>();
const templateRoots = new Set<string>();
const heldTemplates = new Set<"global" | "profile">();

async function openInitializedProfile(configScope: "global" | "profile") {
  const profile = await createBoundProfileFixture();
  const database = FixtureAuthorityDatabase.open(databaseOptions(profile.path), CLOCK);
  try {
    const resolved = configScope === "profile" ? resolveConfigWithProvenance(initialSettingsFileRecord().settings,
      { primaryDisplay: null }, CLOCK, { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot }) : undefined;
    const snapshot = resolved === undefined ? CONFIG_SNAPSHOT : ConfigSnapshotRecordSchema.parse({
      ...CONFIG_SNAPSHOT, config: resolved.config, fingerprint: resolved.fingerprint, provenance: resolved.provenance,
    });
    if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(snapshot);
    return { profile, generation: database.getMeta().authorityGeneration };
  } finally { database.close(); }
}

function rememberProfile(profile: Awaited<ReturnType<typeof createBoundProfileFixture>>, generation: number): string {
  profiles.set(profile.stateRoot, profile);
  roots.push(profile.workspace);
  admissions.set(profile.stateRoot, profile.admission);
  initialGenerations.set(profile.stateRoot, generation);
  return profile.stateRoot;
}

function restoreWorkspace(live: string, snapshot: string): void {
  const extras = new Set(readdirSync(live));
  for (const name of readdirSync(snapshot)) {
    extras.delete(name);
    const from = join(snapshot, name), to = join(live, name);
    if (statSync(from).isDirectory()) {
      if (!existsSync(to)) mkdirSync(to);
      restoreWorkspace(to, from);
    } else writeFileSync(to, readFileSync(from));
  }
  for (const name of extras) rmSync(join(live, name), { recursive: true, force: true });
}

function adoptAuthorityRoot(template: AuthorityTemplate): string {
  restoreWorkspace(template.profile.workspace, template.snapshotRoot);
  template.profile.renewAfterRestore();
  return rememberProfile(template.profile, template.generation);
}

async function testRoot(configScope: "global" | "profile" = "global"): Promise<string> {
  if (!heldTemplates.has(configScope)) {
    let template = authorityTemplates.get(configScope);
    if (template === undefined) {
      const created = await openInitializedProfile(configScope);
      const snapshotRoot = mkdtempSync(join(tmpdir(), "authority-template-"));
      cpSync(created.profile.workspace, snapshotRoot, { recursive: true });
      template = { profile: created.profile, snapshotRoot, generation: created.generation };
      authorityTemplates.set(configScope, template);
      templateRoots.add(template.profile.stateRoot);
    }
    heldTemplates.add(configScope);
    return adoptAuthorityRoot(template);
  }
  const disposable = await openInitializedProfile(configScope);
  return rememberProfile(disposable.profile, disposable.generation);
}
function fixtureFor(path: string) {
  const entry = [...profiles.entries()].find(([root]) => path === root || path.startsWith(root + "/"));
  if (entry === undefined) throw new Error("recovery fixture profile owner missing");
  return entry[1];
}
function baselineGeneration(path: string): number {
  const generation = initialGenerations.get(fixtureFor(path).stateRoot);
  assert.ok(generation !== undefined);
  return generation;
}

function discardTemplate(stateRoot: string): void {
  if (!templateRoots.delete(stateRoot)) return;
  for (const [scope, template] of authorityTemplates) {
    if (template.profile.stateRoot === stateRoot) {
      rmSync(template.snapshotRoot, { recursive: true, force: true });
      authorityTemplates.delete(scope);
    }
  }
}

function databaseOptions(path: string) {
  return { path, busyTimeoutMs: 100, migrationOwner: "storage-recovery-test" };
}

const admissions = new Map<string, RuntimeAdmission>();
function admissionFor(path: string): RuntimeAdmission {
  const held = [...admissions.entries()].find(([root]) => path === root || path.startsWith(root + "/"))?.[1];
  if (held === undefined) throw new Error("fixture authority has no held native installation owner");
  return held;
}

const timelineFixturePaths = new Map<string, string>();
const timelineFixtureOwners = new Map<string, AuthorityDatabase>();

function openDatabase(path: string): AuthorityDatabase {
  timelineFixturePaths.set(resolve(dirname(path)), path);
  const database = FixtureAuthorityDatabase.open(databaseOptions(path), CLOCK);
  databases.push(database);
  timelineFixtureOwners.set(resolve(dirname(path)),database);
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  return database;
}

function restoreMissingTriggers(raw: DatabaseSync, triggers: ReturnType<ReturnType<DatabaseSync["prepare"]>["all"]>): void {
  for (const trigger of triggers) {
    assert.equal(typeof trigger.name,"string"); assert.equal(typeof trigger.sql,"string");
    if(raw.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name=?").get(String(trigger.name)) === undefined) {
      raw.exec(String(trigger.sql));
    }
  }
}

function backupDirectory(root: string): string {
  return join(root, "backups", "authority");
}

/** Offline native evidence corruption; never bypass a production repository owner. */
function createImportedTimelineFixtureWriter(input: { stateRoot: string; clock: typeof CLOCK; pid: number }) {
  return { emit(value: unknown): void {
    const event = SpanEventWireSchema.parse({ ...(value as Record<string, unknown>), pid: input.pid });
    const path = timelineFixturePaths.get(resolve(input.stateRoot));
    if (path === undefined) throw new Error("timeline fixture authority path was not registered");
    const raw = new DatabaseSync(path, { enableForeignKeyConstraints: false });
    try {
      const cursor = Number(raw.prepare("SELECT COALESCE(MAX(cursor),0)+1 AS cursor FROM timeline_events").get()?.cursor);
      const record = TimelineEventRecordSchema.parse({ cursor, schemaVersion: 1, eventId: randomUUID(), workflow: event.workflow,
        scope: "runId" in event ? { kind: "run", runId: event.runId } : { kind: "worker", workerId: event.workerId },
        occurredAt: event.ts, recordedAt: input.clock.now().toISOString(), retentionDate: "2026-07-31",
        source: { kind: "native" }, payload: { kind: "span", event } });
      raw.prepare(`INSERT INTO timeline_events(cursor,id,workflow,run_id,worker_id,kind,occurred_at,recorded_at,
        retention_date,retention_class,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(cursor,record.eventId,
        record.workflow ?? null,"runId" in event ? event.runId : null,"workerId" in event ? event.workerId ?? null : null,
        event.t,event.ts,record.recordedAt,record.retentionDate,
        event.t === "span.ended" && ["failed","interrupted"].includes(event.outcome) ? "protected" : "ordinary",
        JSON.stringify(record));
    } finally { raw.close(); }
  } };
}

function emitQueuedSpan(stateRoot: string, runInput: unknown = QUEUED_RUN, corrupt = false): void {
  const run = RunRecordSchema.parse(runInput);
  const event = SpanEventWireSchema.parse({
    pid: 4242,
    t: "run.queued",
    kind: "run",
    ts: run.envelope.enqueuedAt,
    workflow: run.envelope.workflow,
    runId: run.envelope.runId,
    attempt: run.envelope.attempt,
    traceId: run.envelope.traceId,
    spanPath: run.envelope.traceId,
    itemId: run.envelope.itemId,
    shape: run.envelope.shape,
    priority: run.envelope.priority,
    dryRun: run.envelope.dryRun,
    actorId: "local-operator",
    title: "storage reconciliation fixture",
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: run.envelope.contractFingerprint,
    resolvedInstance: run.envelope.resolvedInstance,
    configFingerprint: run.envelope.configFingerprint,
    configSnapshotId: run.envelope.configSnapshotId,
  });
  const owner = timelineFixtureOwners.get(resolve(stateRoot));
  if (!corrupt && owner?.authority.runs.get(run.envelope.runId) !== undefined) {
    owner.authority.timelineEvents.append({schemaVersion:1,eventId:randomUUID(),workflow:event.workflow,
      scope:{kind:"run",runId:run.envelope.runId},occurredAt:event.ts,recordedAt:NOW,
      retentionDate:"2026-07-31",source:{kind:"native"},payload:{kind:"span",event}});
  } else {
    createImportedTimelineFixtureWriter({stateRoot,clock:CLOCK,pid:4242}).emit(event);
  }
}

function manifestPaths(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".manifest.json"))
    .sort()
    .map((name) => join(directory, name));
}

async function createBackup(database: AuthorityDatabase, directory: string) {
  const service = new AuthorityBackupService(admissionFor(directory), database, { directory }, CLOCK);
  const report = await service.request({
    trigger: "schema-migration",
    requiredGeneration: database.getMeta().authorityGeneration,
  });
  const paths = manifestPaths(directory);
  assert.equal(paths.length, report.manifests.length);
  return { report, manifestPath: paths.at(-1) ?? "" };
}

afterEach(async () => {
  timelineFixturePaths.clear();
  timelineFixtureOwners.clear();
  for (const database of databases.splice(0)) {
    try { releaseSeededWriteOwners(database, CLOCK.now().toISOString()); }
    catch (error) { if (!(error instanceof Error) || error.message !== "database is not open") throw error; }
    database.close();
  }
  admissions.clear();
  for (const template of [...authorityTemplates.values()]) {
    try {
      restoreWorkspace(template.profile.workspace, template.snapshotRoot);
      try { template.profile.admission.assertProfileRuntime(); }
      catch { template.profile.renewAfterRestore(); }
      template.profile.admission.assertProfileRuntime();
    } catch { discardTemplate(template.profile.stateRoot); }
  }
  for (const profile of profiles.values()) {
    if (!templateRoots.has(profile.stateRoot)) await profile.close();
  }
  profiles.clear(); initialGenerations.clear(); roots.splice(0);
  heldTemplates.clear();
});

afterAll(async () => {
  for (const template of authorityTemplates.values()) {
    await template.profile.close();
    rmSync(template.snapshotRoot, { recursive: true, force: true });
  }
  authorityTemplates.clear();
  templateRoots.clear();
});

export {
  admissionFor,
  admissions,
  AFTER_NOW,
  backupDirectory,
  baselineGeneration,
  CLOCK,
  createBackup,
  createImportedTimelineFixtureWriter,
  databaseOptions,
  emitQueuedSpan,
  fixtureFor,
  manifestPaths,
  openDatabase,
  restoreMissingTriggers,
  seedTerminalAuthority,
  testRoot,
};
