import { default as assert_m0,default as assert_m1,default as assert_m2 } from "node:assert/strict";
import { randomUUID as randomUUID_m0 } from "node:crypto";
import fs_m2,{ lstatSync as lstatSync_m1,mkdirSync as mkdirSync_m0,mkdirSync as mkdirSync_m2,mkdtempSync as mkdtempSync_m0,mkdtempSync as mkdtempSync_m1,mkdtempSync as mkdtempSync_m2,readFileSync as readFileSync_m0,readFileSync as readFileSync_m1,readdirSync as readdirSync_m0,readdirSync as readdirSync_m1,realpathSync as realpathSync_m0,realpathSync as realpathSync_m1,realpathSync as realpathSync_m2,rmSync as rmSync_m0,rmSync as rmSync_m1,rmSync as rmSync_m2,utimesSync as utimesSync_m0,writeFileSync as writeFileSync_m0 } from "node:fs";
import { syncBuiltinESMExports as syncBuiltinESMExports_m2 } from "node:module";
import { tmpdir as tmpdir_m0,tmpdir as tmpdir_m1,tmpdir as tmpdir_m2 } from "node:os";
import { join as join_m0,join as join_m1,join as join_m2 } from "node:path";
import { DatabaseSync as DatabaseSync_m1,DatabaseSync as DatabaseSync_m2 } from "node:sqlite";
import { isDeepStrictEqual as isDeepStrictEqual_m1 } from "node:util";
import { afterEach as afterEach_m1,afterEach as afterEach_m2,describe as describe_m1,describe as describe_m2,it as it_m0,it as it_m1,it as it_m2,vi } from "vitest";
import { resolveConfigWithProvenance as resolveConfigWithProvenance_m0 } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m2 } from "../../../../src/backend/app/config/runtime-isolation.js";
import { buildStorageDoctor as buildStorageDoctor_m2 } from "../../../../src/backend/runs/queries/storage.js";
import { acquireExclusiveRuntimeAdmission as acquireExclusiveRuntimeAdmission_m0 } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission as acquireEntrypointAdmission_m0,acquireEntrypointAdmission as acquireEntrypointAdmission_m1 } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore as createCredentialStore_m1 } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createTimelineEmitter as createTimelineEmitter_m2 } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { backupStoppedAuthority as backupStoppedAuthority_m0 } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase as AuthorityDatabase_m0,AuthorityDatabase as AuthorityDatabase_m1 } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { doctorAuthorityStorage as doctorAuthorityStorage_m0,doctorAuthorityStorage as doctorAuthorityStorage_m1,summarizeBackupHealth as summarizeBackupHealth_m0 } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { hostConfigFacts as hostConfigFacts_m0 } from "../../../../src/models/config/host-display.js";
import { SpanEventWireSchema as SpanEventWireSchema_m2 } from "../../../../src/models/events/types.js";
import { manualClock as manualClock_m0,manualClock as manualClock_m2 } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT as CONFIG_SNAPSHOT_m2,NOW as NOW_m2 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN as QUEUED_RUN_m2 } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { plan as plan_m0,relocate as relocate_m0 } from "../../../support/helpers/storage/storage-relocation-fixture.js";
import { AuthorityDatabase as AuthorityDatabase_m2,composeStorageCommand as composeStorageCommand_m2,doctorAuthorityStorage as doctorAuthorityStorage_m2,syntheticStateRoot as syntheticStateRoot_m2 } from "../../../support/helpers/synthetic-storage-admission.js";

import assert_m3 from "node:assert/strict";
import { mkdirSync as mkdirSync_m3,mkdtempSync as mkdtempSync_m3,realpathSync as realpathSync_m3,rmSync as rmSync_m3,writeFileSync as writeFileSync_m3 } from "node:fs";
import { tmpdir as tmpdir_m3 } from "node:os";
import { join as join_m3 } from "node:path";
import { afterEach as afterEach_m3,describe as describe_m3,it as it_m3 } from "vitest";
import { manualClock as manualClock_m3 } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT as CONFIG_SNAPSHOT_m3,NOW as NOW_m3,UUID_7 as UUID_7_m3 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
AuthorityBackupService as AuthorityBackupService_m3,
AuthorityDatabase as AuthorityDatabase_m3,
summarizeBackupHealth as summarizeBackupHealth_m3
} from "../../../support/helpers/synthetic-storage-admission.js";


{

const clock = manualClock_m0(new Date("2026-09-26T12:00:00.000Z"));
const workspaces: string[] = [];
const _afterEachFixture0 = () => { for (const workspace of workspaces.splice(0)) rmSync_m0(workspace, { recursive: true, force: true }); };

async function movedFixture(artifactOnly = false) {
  const root = mkdtempSync_m0(join_m0(realpathSync_m0(tmpdir_m0()), "backup-location-")); workspaces.push(root);
  const workspace = join_m0(root, "workspace"); mkdirSync_m0(workspace, {mode: 0o700});
  const initial = acquireEntrypointAdmission_m0(workspace, "exclusive");
  let source = { stateRoot: initial.stateRoot, artifactRoot: initial.artifactRoot };
  try {
    const database = AuthorityDatabase_m0.open(initial, { path: join_m0(initial.stateRoot, "state.db"),
      busyTimeoutMs: 250, migrationOwner: "backup-location-fixture" }, clock);
    try {
      const resolved = resolveConfigWithProvenance_m0({}, hostConfigFacts_m0({}), clock, initial);
      database.authority.runtimeConfig.initialize({ configSnapshotId: randomUUID_m0(), revision: 1,
        fingerprint: resolved.fingerprint, capturedAt: clock.now().toISOString(), capturedBy: "local-operator",
        config: resolved.config, provenance: resolved.provenance });
    } finally { database.close(); }
    await backupStoppedAuthority_m0(initial, initial.stateRoot, clock, join_m0(initial.stateRoot, "locks"));
  } finally { initial.release(); }
  if (artifactOnly) {
    const exterior = { stateRoot: join_m0(root, "exterior-state"), artifactRoot: join_m0(root, "exterior-artifacts") };
    const first = plan_m0(workspace, exterior); await relocate_m0(workspace, first.commandId);
    source = exterior;
  }
  const destination = artifactOnly ? { stateRoot: source.stateRoot, artifactRoot: join_m0(root,"moved-artifacts") }
    : { stateRoot: join_m0(root,"moved-state"), artifactRoot: join_m0(root,"moved-artifacts") };
  const request = plan_m0(workspace, destination); await relocate_m0(workspace, request.commandId);
  const admission = acquireExclusiveRuntimeAdmission_m0(workspace);
  const options = { stateRootTrustAnchor: root, stateRoot: destination.stateRoot,
    authorityPath: join_m0(destination.stateRoot,"state.db"), backupDirectory: join_m0(destination.stateRoot,"backups","authority"), busyTimeoutMs:250 };
  return { workspace, source, destination, admission, options };
}

it_m0("verifies copied native backups as previous-location evidence without current restore eligibility", async () => {
try {


  const f = await movedFixture();
  try {
    const before = await doctorAuthorityStorage_m0(f.admission, f.options, clock);
    assert_m0.equal(before.backup.state, "current");
    assert_m0.ok(before.restoreCandidates.some(candidate => candidate.state === "verified-compatible"));
    assert_m0.ok((before.previousLocationBackups?.length ?? 0) > 0);
    assert_m0.ok(before.previousLocationBackups?.every((backup) => backup.restoreEligibility === "not-admitted"));
    assert_m0.equal(summarizeBackupHealth_m0({ backupDirectory: f.options.backupDirectory }, 0, clock), "current");

    await backupStoppedAuthority_m0(f.admission, f.destination.stateRoot, clock, join_m0(f.destination.stateRoot, "locks"));
    const oldManifest = before.previousLocationBackups?.find((entry) => entry.selection === "single-database");
    assert_m0.ok(oldManifest);
    const nextMtime = new Date(clock.nowMs() + 30_000);
    utimesSync_m0(join_m0(f.options.backupDirectory, oldManifest.manifestFileName), nextMtime, nextMtime);
    const after = await doctorAuthorityStorage_m0(f.admission, f.options, clock);
    assert_m0.equal(after.backup.state, "current");
    assert_m0.deepEqual(after.previousLocationBackups?.map(entry => JSON.stringify(entry)).sort(),
      before.previousLocationBackups?.map(entry => JSON.stringify(entry)).sort());
    assert_m0.ok(after.restoreCandidates.some((candidate) => candidate.state === "verified-compatible"));
    assert_m0.equal(summarizeBackupHealth_m0({ backupDirectory: f.options.backupDirectory }, 0, clock), "current");

    const unrelated = join_m0(f.options.backupDirectory, "unrelated.manifest.json");
    const sourceManifest = JSON.parse(readFileSync_m0(join_m0(f.options.backupDirectory, oldManifest.manifestFileName), "utf8")) as Record<string, unknown>;
    writeFileSync_m0(unrelated, JSON.stringify({ ...sourceManifest, sourceDatabaseIdentity: "f".repeat(64) }));
    const unrelatedReport = await doctorAuthorityStorage_m0(f.admission, f.options, clock);
    assert_m0.equal(unrelatedReport.backup.state, "invalid");
    assert_m0.equal(unrelatedReport.restoreCandidates.find((candidate) => candidate.manifestFileName === "unrelated.manifest.json")?.state, "invalid");

    const receiptsDirectory = join_m0(f.workspace, ".tracker/control", "relocation-receipts");
    const receiptName = readdirSync_m0(receiptsDirectory)[0];
    assert_m0.ok(receiptName);
    const receiptPath = join_m0(receiptsDirectory, receiptName);
    const receipt = JSON.parse(readFileSync_m0(receiptPath, "utf8")) as Record<string, unknown>;
    writeFileSync_m0(receiptPath, JSON.stringify({ ...receipt, installationId: randomUUID_m0() }));
    const tampered = await doctorAuthorityStorage_m0(f.admission, f.options, clock);
    assert_m0.equal(tampered.backup.state, "invalid");
    assert_m0.equal(tampered.previousLocationBackups, undefined);
    assert_m0.equal(tampered.restoreCandidates.find((candidate) => candidate.manifestFileName === oldManifest.manifestFileName)?.state, "invalid");
  } finally { f.admission.release(); }

} finally {
_afterEachFixture0();
}
});
}

{


const cleanups: (() => void)[] = [];

const _afterEachFixture0 = () => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
};

function fixture() {
  const workspace = mkdtempSync_m1(join_m1(realpathSync_m1(tmpdir_m1()), "hr-credential-doctor-"));
  cleanups.push(() => rmSync_m1(workspace, { recursive: true, force: true }));
  const admission = acquireEntrypointAdmission_m1(workspace,"exclusive");
  cleanups.push(() => admission.release());
  const root = admission.stateRoot;
  const authorityPath = join_m1(root,"state.db");
  const database = AuthorityDatabase_m1.open(admission,{path:authorityPath,busyTimeoutMs:100,migrationOwner:"credential-doctor-fixture"});
  cleanups.push(() => database.close());
  const credentialDirectory = join_m1(root,"credentials");
  const credentialPath = join_m1(credentialDirectory,"protected.json");
  const credentialStore = createCredentialStore_m1({admission,stateRoot:root});
  const options = {authorityPath,stateRoot:root,stateRootTrustAnchor:workspace,backupDirectory:join_m1(root,"backups","authority"),busyTimeoutMs:100};
  return {root,workspace,admission,database,credentialDirectory,credentialPath,credentialStore,options};
}

function snapshot(root: string): unknown {
  return readdirSync_m1(root).sort().map((name) => {
    const path = join_m1(root, name);
    const stat = lstatSync_m1(path);
    const bytes = stat.isDirectory() ? undefined : readFileSync_m1(path);
    return {
      name,
      mode: stat.mode,
      uid: stat.uid,
      ino: stat.ino,
      size: stat.size,
      mtime: stat.mtimeMs,
      ctime: stat.ctimeMs,
      content: stat.isDirectory() ? snapshot(path) : bytes?.toString("base64"),
    };
  });
}


describe_m1("read-only upgrade phase reporting", () => {
afterEach_m1(_afterEachFixture0);


  it_m1("keeps a corrupt journal explicitly unavailable without exposing its payload or mutating it", async () => {
    const f = fixture();
    const raw = new DatabaseSync_m1(f.options.authorityPath);
    raw.prepare("INSERT INTO database_upgrades (id, upgrade_id, phase, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("broken", "private-upgrade-identity", "planned", JSON.stringify({ private: "private-journal-payload" }), "2026-09-06T20:00:00.000Z");
    raw.close();
    const before = snapshot(f.root);
    const report = await doctorAuthorityStorage_m1(f.admission,f.options);
    assert_m1.deepEqual(report.authorityUpgrades, { state: "unavailable", cause: {
      code: "authority-unavailable", summary: "authority upgrade journal could not be verified",
    } });
    assert_m1.equal(JSON.stringify(report.authorityUpgrades).includes("private-journal-payload"), false);
    assert_m1.ok(isDeepStrictEqual_m1(snapshot(f.root), before), "corrupt journal inspection changed source inventory or bytes");
  });
});
}

{


const roots: string[] = [];
const clock = manualClock_m2(new Date(NOW_m2));
const _afterEachFixture0 = () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports_m2();
  for (const root of roots.splice(0)) rmSync_m2(root, { recursive: true, force: true });
};

const CASES = [
  ["private-path", "/private/synthetic-home/person-documents"],
  ["secret-marker", "SYNTHETIC_SECRET_NEVER_REAL"],
  ["person-marker", "10999999"],
] as const;

describe_m2.each(["doctor", "browser-wire", "cli-json"] as const)("storage diagnostic redaction at %s", (boundary) => {
afterEach_m2(_afterEachFixture0);

  it_m2.each([...CASES.flatMap(([label, marker]) => [
    { label, marker, event: "root", field: "spanPath" },
    { label, marker, event: "root", field: "parentSpanPath" },
    { label, marker, event: "task", field: "spanPath" },
    { label, marker, event: "task", field: "parentSpanPath" },
  ] as const),
  { label: "raw-read-EIO", marker: "SYNTHETIC_READ_FAILURE", event: "read", field: "span corpus", code: "EIO" },
  { label: "raw-read-hostile-code", marker: "SYNTHETIC_READ_FAILURE", event: "read", field: "span corpus", code: "SYNTHETIC_ERRNO_NEVER_REAL" },
  { label: "schema-key", marker: "/private/SYNTHETIC_SECRET_NEVER_REAL/10999999", event: "schema-key", field: "strict span schema" },
  { label: "schema-field", marker: "SYNTHETIC_SECRET_NEVER_REAL", event: "schema-field", field: "notRunReason" },
  // CLI isolation fixes stateRoot to the anchor's direct .tracker child;
  // only doctor/browser options can express intermediate relative components.
  ...(boundary === "cli-json" ? [] : [
    { label: "nested-root", marker: "SYNTHETIC_SECRET_NEVER_REAL_10999999", event: "nested-root", field: "path component 1" },
  ]),
  ])("validates $label from $event / $field or refuses an unadmitted root before a doctor report", async (testCase) => {
    const { marker, event, field } = testCase;
    const repoRoot = realpathSync_m2(mkdtempSync_m2(join_m2(tmpdir_m2(), "hrauto-diagnostic-redaction-")));
    roots.push(repoRoot);
    if (event === "nested-root") {
      const actualParent = join_m2(repoRoot, "owned");
      mkdirSync_m2(actualParent);
      fs_m2.symlinkSync(actualParent, join_m2(repoRoot, marker), "dir");
    }
    const stateRoot = join_m2(repoRoot,
      event === "nested-root" ? join_m2(marker, "state") : rebuildRuntimeIsolation_m2.stateRoot);
    mkdirSync_m2(stateRoot, { recursive: true });
    const authorityPath = join_m2(event === "nested-root" ? join_m2(repoRoot, "owned", "state") : stateRoot, "state.db");
    const database = AuthorityDatabase_m2.open({ path: authorityPath, busyTimeoutMs: 500, migrationOwner: "redaction-test" }, clock);
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT_m2);
    database.authority.runs.enqueue(QUEUED_RUN_m2);
    const e = QUEUED_RUN_m2.envelope;
    const common = { ts: e.enqueuedAt, workflow: e.workflow, runId: e.runId, attempt: e.attempt, traceId: e.traceId };
    const writer = createTimelineEmitter_m2({ repository: database.authority.timelineEvents, clock, pid: 4242 });
    const queued = {
      ...common, t: "run.queued", kind: "run", spanPath: e.traceId,
      itemId: e.itemId, shape: e.shape, priority: e.priority, dryRun: e.dryRun,
      actorId: "local-operator", title: "Redacted test run",
      descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
      resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint,
      configSnapshotId: e.configSnapshotId,

    };
    writer.emit(queued);
    if (event === "task") writer.emit({
      ...common, t: "span.started", kind: "task", spanPath: `${e.traceId}/searching#1`,
      parentSpanPath: e.traceId, name: "searching",
    });
    database.close();
    if (event === "root" || event === "task") {
      using raw = new DatabaseSync_m2(authorityPath);
      const trigger = raw.prepare("SELECT sql FROM sqlite_schema WHERE name='timeline_events_immutable'").get();
      assert_m2.equal(typeof trigger?.sql, "string");
      try {
        raw.exec("DROP TRIGGER timeline_events_immutable");
        assert_m2.equal(raw.prepare("UPDATE timeline_events SET payload_json=json_set(payload_json, ?, ?) WHERE json_extract(payload_json,'$.payload.event.t')=?")
          .run(`$.payload.event.${field}`, marker, event === "root" ? "run.queued" : "span.started").changes, 1);
      } finally { raw.exec(String(trigger?.sql)); }
    }
    if (event === "schema-key" || event === "schema-field") {
        const invalid = event === "schema-key"
          ? { ...queued, pid: 4242, resolvedInstance: { [marker]: "test" } }
          : { ...common, pid: 4242, t: "span.ended", kind: "task", spanPath: marker,
            parentSpanPath: e.traceId, outcome: "done", notRunReason: "condition-false" };
        if (event === "schema-key") {
          assert_m2.equal(SpanEventWireSchema_m2.safeParse({ ...queued, pid: 4242 }).success, true,
            "the control event must satisfy every required field");
          const parsed = SpanEventWireSchema_m2.safeParse(invalid);
          assert_m2.equal(parsed.success, false);
          if (parsed.success) throw new Error("the invalid record key must be refused");
          const [union] = parsed.error.issues;
          assert_m2.ok(union?.code === "invalid_union");
          assert_m2.deepEqual(union.errors[0]?.map(({ code, path }) => ({ code, path })), [
            { code: "invalid_key", path: ["resolvedInstance", marker] },
          ], "the otherwise-valid queued arm must fail at the marker-bearing nested record key");
          assert_m2.deepEqual(union.path, [], "the union itself has a root path; it does not flatten nested key paths");
        }
        const raw = new DatabaseSync_m2(authorityPath);
        try {
          const trigger = raw.prepare("SELECT sql FROM sqlite_master WHERE name='timeline_events_immutable'").get();
          assert_m2.equal(typeof trigger?.sql, "string");
          raw.exec("DROP TRIGGER timeline_events_immutable; PRAGMA ignore_check_constraints=ON");
          raw.prepare("UPDATE timeline_events SET payload_json=json_set(payload_json, '$.payload.event', json(?))").run(JSON.stringify(invalid));
          raw.exec(String(trigger?.sql));
        } finally { raw.close(); }
    }
    if ("code" in testCase) {
      vi.spyOn(AuthorityDatabase_m2, "inspectTimelineReadOnly").mockImplementation(() => {
        throw Object.assign(new Error(`${marker} /private/synthetic-home/person-documents 10999999`), { code: testCase.code });
      });
      syncBuiltinESMExports_m2();
    }
    const doctorOptions = {
      stateRootTrustAnchor: repoRoot, stateRoot, authorityPath,
      backupDirectory: join_m2(stateRoot, "backups", "authority"), maxBackupAgeMs: 60_000, busyTimeoutMs: 500,
    };
    if (event === "nested-root") {
      const expected = boundary === "doctor"
        ? "runtime-admission: storage doctor roots differ from active locator"
        : "runtime-admission: unsafe synthetic fixture ancestor";
      await assert_m2.rejects(async () => boundary === "doctor"
        ? doctorAuthorityStorage_m2(doctorOptions, clock)
        : buildStorageDoctor_m2({ admission: syntheticStateRoot_m2(doctorOptions.stateRoot), doctorOptions, clock,
          serviceState: () => ({ state: "never-run", reason: "test has no backup service" }) }),
      (error: unknown) => {
        assert_m2.ok(error instanceof Error);
        assert_m2.equal(error.message, expected);
        assert_m2.equal(error.message.includes(marker), false);
        return true;
      });
      return;
    }
    let output: string;
    if (boundary === "cli-json") {
      const result = await composeStorageCommand_m2(rebuildRuntimeIsolation_m2, ["doctor", "--json"], clock, repoRoot);
      assert_m2.equal(result.exitCode, 1);
      output = result.output;
    } else {
      const report = boundary === "doctor"
        ? await doctorAuthorityStorage_m2(doctorOptions, clock)
        : await buildStorageDoctor_m2({ admission: syntheticStateRoot_m2(doctorOptions.stateRoot), doctorOptions, clock, serviceState: () => ({ state: "never-run", reason: "test has no backup service" }) });
      output = JSON.stringify(report);
    }
    assert_m2.equal(output.includes(marker), false, `${boundary} must not echo synthetic sensitive path content`);
    assert_m2.equal(output.includes(field), true, "diagnosis must still name the offending field");
    if ("code" in testCase) {
      assert_m2.equal(output.includes("/private/synthetic-home"), false);
      assert_m2.equal(output.includes("10999999"), false);
      assert_m2.equal(output.includes("SYNTHETIC_ERRNO_NEVER_REAL"), false);
      assert_m2.match(output, /span-stream-invalid/u);
    } else if (event === "schema-key" || event === "schema-field") {
      assert_m2.match(output, /span-stream-invalid/u);
      if (event === "schema-key" || event === "schema-field") assert_m2.match(output, /timeline-record-invalid/u);
    } else assert_m2.match(output, /span_stream/u);
  });
});
}

{


const disposers: (() => void)[] = [];
const _afterEachFixture0 = () => {
  for (const dispose of disposers.splice(0)) dispose();
};

const MAX_AGE_MS = 45 * 60 * 1000;

function world() {
  const clock = manualClock_m3(new Date(NOW_m3));
  const root = mkdtempSync_m3(join_m3(realpathSync_m3(tmpdir_m3()), "hrauto-backup-summary-"));
  disposers.push(() => rmSync_m3(root, { recursive: true, force: true }));
  const database = AuthorityDatabase_m3.open(
    { path: join_m3(root, "state.db"), busyTimeoutMs: 1000, migrationOwner: "summary-test" },
    clock,
  );
  disposers.push(() => database.close());
  const directory = join_m3(root, "backups", "authority");
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT_m3);
  const service = new AuthorityBackupService_m3(database, { directory }, clock);
  const options = { backupDirectory: directory, maxBackupAgeMs: MAX_AGE_MS };
  return { clock, database, directory, service, options };
}

function dirtyAuthority(database: AuthorityDatabase_m3): number {
  database.authority.notifications.create({
    notificationId: UUID_7_m3,
    actorId: "local-operator",
    dedupeFingerprint: "f".repeat(64),
    trigger: "failed",
    channel: "ping",
    status: "unread",
    snooze: { state: "not-snoozed" },
    title: "Run failed",
    summary: "a generation-bumping durable write",
    links: [{ kind: "run", runId: "00010001-0001-4001-8001-000100010001" }],
    count: 1,
    lastSeenAt: NOW_m3,
    version: 1,
    createdAt: NOW_m3,
    updatedAt: NOW_m3,
  });
  return database.getMeta().authorityGeneration;
}

describe_m3("summarizeBackupHealth", () => {
afterEach_m3(_afterEachFixture0);

  it_m3("reads missing with no directory, and current right after a real verified backup", async () => {
    const w = world();
    assert_m3.equal(summarizeBackupHealth_m3(w.options, w.database.getMeta().authorityGeneration, w.clock), "missing");

    await w.service.request({ trigger: "interval", requiredGeneration: w.database.getMeta().authorityGeneration });
    assert_m3.equal(summarizeBackupHealth_m3(w.options, w.database.getMeta().authorityGeneration, w.clock), "current");
  });

  it_m3("reads stale on ANY authority-generation gap, and current again after the next backup", async () => {
    const w = world();
    await w.service.request({ trigger: "interval", requiredGeneration: w.database.getMeta().authorityGeneration });

    const generation = dirtyAuthority(w.database);
    assert_m3.equal(summarizeBackupHealth_m3(w.options, generation, w.clock), "stale");

    w.clock.advanceWall(60_000);
    await w.service.request({ trigger: "interval", requiredGeneration: generation });
    assert_m3.equal(summarizeBackupHealth_m3(w.options, w.database.getMeta().authorityGeneration, w.clock), "current");
  });

  it_m3("reads stale past the age bound even with no gap, and judges by age alone when the live generation is unknown", async () => {
    const w = world();
    await w.service.request({ trigger: "interval", requiredGeneration: w.database.getMeta().authorityGeneration });

    w.clock.advanceWall(MAX_AGE_MS + 1);
    assert_m3.equal(summarizeBackupHealth_m3(w.options, w.database.getMeta().authorityGeneration, w.clock), "stale");

    // Authority unavailable (undefined generation): the fresh-age arm still
    // answers — the summary's documented degraded contract.
    const fresh = world();
    await fresh.service.request({ trigger: "interval", requiredGeneration: fresh.database.getMeta().authorityGeneration });
    assert_m3.equal(summarizeBackupHealth_m3(fresh.options, undefined, fresh.clock), "current");
  });

  it_m3("treats an unparseable manifest as no usable backup — missing, never a guessed state", () => {
    const w = world();
    mkdirSync_m3(w.directory, { recursive: true });
    writeFileSync_m3(join_m3(w.directory, "authority-1.manifest.json"), "{ not json");
    assert_m3.equal(summarizeBackupHealth_m3(w.options, w.database.getMeta().authorityGeneration, w.clock), "missing");
  });
});
}
