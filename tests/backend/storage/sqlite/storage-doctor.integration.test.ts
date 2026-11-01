import { createCredentialDoctorFixtures } from "../../../support/helpers/credential-doctor-fixtures.js";
import { default as assert } from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { afterAll, afterEach, describe, it, vi } from "vitest";

import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { runOfflineStorageRelocation } from "../../../../src/backend/app/composition/storage/relocate.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { buildStorageDoctor } from "../../../../src/backend/runs/queries/storage.js";



import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";

import { doctorAuthorityStorage, summarizeBackupHealth } from "../../../../src/backend/storage/sqlite/storage-doctor.js";

import { SpanEventWireSchema } from "../../../../src/models/events/types.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

import { createBoundProfileFixture, createClonedProfileFixtures } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase as AuthorityDatabase_m2, composeStorageCommand, doctorAuthorityStorage as doctorAuthorityStorage_m2, syntheticStateRoot } from "../../../support/helpers/synthetic-storage-admission.js";

import { UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

import { AuthorityBackupService, summarizeBackupHealth as summarizeBackupHealth_m3 } from "../../../support/helpers/synthetic-storage-admission.js";

const diagnosticProfiles = createClonedProfileFixtures();
afterAll(() => diagnosticProfiles.close());


{

const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
it("refuses profile relocation without changing current backup selection or source bytes", async () => {
  const f = await createBoundProfileFixture();
  try {
    const directory = join(f.stateRoot, "backups", "authority");
    const database = AuthorityDatabase_m2.open({path:f.path,busyTimeoutMs:250,migrationOwner:"backup-location-doctor"},clock);
    try {
      await new AuthorityBackupService(database,{directory},clock).request({trigger:"operator",requiredGeneration:database.getMeta().authorityGeneration});
    } finally { database.close(); }
    const options = {stateRootTrustAnchor:f.workspace,stateRoot:f.stateRoot,authorityPath:f.path,backupDirectory:directory,busyTimeoutMs:250};
    const before = await doctorAuthorityStorage(f.admission, options, clock);
    assert.equal(before.backup.state, "current");
    assert.ok(before.restoreCandidates.some(candidate => candidate.state === "verified-compatible"));
    assert.equal(before.previousLocationBackups, undefined);
    assert.equal(summarizeBackupHealth({backupDirectory:directory},0,clock),"current");
    const original = storageTree(f.workspace);
    await assert.rejects(runOfflineStorageRelocation({workspace:f.workspace,lifetime:f.lifetime,admission:f.admission,
      command:{kind:"plan",id:UUID_7,json:false},clock}),{code:"PROFILE_STORAGE_RELOCATION_UNSUPPORTED"});
    assert.deepEqual(storageTree(f.workspace), original);
    const manifest = before.restoreCandidates.find(candidate => candidate.state === "verified-compatible");
    assert.ok(manifest);
    utimesSync(join(directory,manifest.manifestFileName),new Date(clock.nowMs()+30_000),new Date(clock.nowMs()+30_000));
    const after = await doctorAuthorityStorage(f.admission, options, clock);
    assert.equal(after.backup.state,"current");
    assert.deepEqual(after.restoreCandidates,before.restoreCandidates);
    assert.equal(summarizeBackupHealth({backupDirectory:directory},0,clock),"current");
    const unrelated = join(directory,"unrelated.manifest.json");
    const sourceManifest = JSON.parse(readFileSync(join(directory,manifest.manifestFileName),"utf8")) as Record<string,unknown>;
    writeFileSync(unrelated,JSON.stringify({...sourceManifest,sourceDatabaseIdentity:"f".repeat(64)}));
    const invalid = await doctorAuthorityStorage(f.admission, options, clock);
    assert.equal(invalid.backup.state,"invalid");
    assert.equal(invalid.restoreCandidates.find(candidate => candidate.manifestFileName === "unrelated.manifest.json")?.state,"invalid");
    assert.equal(invalid.previousLocationBackups,undefined);
  } finally { await f.close(); }
});
}

{

const cleanups: (() => void)[] = [];

const _afterEachFixture0 = () => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
};

const { fixture, snapshot } = createCredentialDoctorFixtures(cleanups);



describe("read-only upgrade phase reporting", () => {
afterEach(_afterEachFixture0);

  it("keeps a corrupt journal explicitly unavailable without exposing its payload or mutating it", async () => {
    const f = await fixture();
    const raw = new DatabaseSync(f.options.authorityPath);
    raw.prepare("INSERT INTO database_upgrades (id, upgrade_id, phase, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("broken", "private-upgrade-identity", "planned", JSON.stringify({ private: "private-journal-payload" }), "2026-09-06T20:00:00.000Z");
    raw.close();
    const before = snapshot(f.root);
    const report = await doctorAuthorityStorage(f.admission,f.options);
    assert.deepEqual(report.authorityUpgrades, { state: "unavailable", cause: {
      code: "authority-unavailable", summary: "authority upgrade journal could not be verified",
    } });
    assert.equal(JSON.stringify(report.authorityUpgrades).includes("private-journal-payload"), false);
    assert.ok(isDeepStrictEqual(snapshot(f.root), before), "corrupt journal inspection changed source inventory or bytes");
  });
});
}

{

const roots: string[] = [];
const clock = manualClock(new Date(NOW));
const _afterEachFixture0 = () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};

const CASES = [
  ["private-path", "/private/synthetic-home/person-documents"],
  ["secret-marker", "SYNTHETIC_SECRET_NEVER_REAL"],
  ["person-marker", "10999999"],
] as const;

describe.each(["doctor", "browser-wire", "cli-json"] as const)("storage diagnostic redaction at %s", (boundary) => {
afterEach(_afterEachFixture0);

  it.each([...CASES.flatMap(([label, marker]) => [
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
    const profile = event === "nested-root"
      ? await createBoundProfileFixture({ workspace: realpathSync(mkdtempSync(join(tmpdir(), "hrauto-diagnostic-redaction-"))) })
      : await diagnosticProfiles.create();
    const repoRoot = profile.workspace;
    if (event === "nested-root") roots.push(repoRoot);
    if (event === "nested-root") {
      const actualParent = join(repoRoot, "owned");
      mkdirSync(actualParent);
      fs.symlinkSync(actualParent, join(repoRoot, marker), "dir");
      const stateRoot = join(repoRoot, marker, "state");
      const authorityPath = join(repoRoot, "owned", "state", "state.db");
      mkdirSync(dirname(authorityPath), { recursive: true });
      const doctorOptions = {
        stateRootTrustAnchor: repoRoot, stateRoot, authorityPath,
        backupDirectory: join(stateRoot, "backups", "authority"), maxBackupAgeMs: 60_000, busyTimeoutMs: 500,
      };
      const expected = boundary === "doctor"
        ? "runtime-admission: fixture overlaps installation witness"
        : "runtime-admission: unsafe synthetic fixture ancestor";
      await assert.rejects(async () => boundary === "doctor"
        ? doctorAuthorityStorage_m2(doctorOptions, clock)
        : buildStorageDoctor({ admission: syntheticStateRoot(doctorOptions.stateRoot), doctorOptions, clock,
          serviceState: () => ({ state: "never-run", reason: "test has no backup service" }) }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, expected);
        assert.equal(error.message.includes(marker), false);
        return true;
      });
      await profile.close();
      return;
    }
    const stateRoot = profile.stateRoot;
    const authorityPath = profile.path;
    const database = AuthorityDatabase_m2.open({ path: authorityPath, busyTimeoutMs: 500, migrationOwner: "redaction-test" }, clock);
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    database.authority.runs.enqueue(QUEUED_RUN);
    const e = QUEUED_RUN.envelope;
    const common = { ts: e.enqueuedAt, workflow: e.workflow, runId: e.runId, attempt: e.attempt, traceId: e.traceId };
    const writer = createTimelineEmitter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
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
      using raw = new DatabaseSync(authorityPath);
      const trigger = raw.prepare("SELECT sql FROM sqlite_schema WHERE name='timeline_events_immutable'").get();
      assert.equal(typeof trigger?.sql, "string");
      try {
        raw.exec("DROP TRIGGER timeline_events_immutable");
        assert.equal(raw.prepare("UPDATE timeline_events SET payload_json=json_set(payload_json, ?, ?) WHERE json_extract(payload_json,'$.payload.event.t')=?")
          .run(`$.payload.event.${field}`, marker, event === "root" ? "run.queued" : "span.started").changes, 1);
      } finally { raw.exec(String(trigger?.sql)); }
    }
    if (event === "schema-key" || event === "schema-field") {
        const invalid = event === "schema-key"
          ? { ...queued, pid: 4242, resolvedInstance: { [marker]: "test" } }
          : { ...common, pid: 4242, t: "span.ended", kind: "task", spanPath: marker,
            parentSpanPath: e.traceId, outcome: "done", notRunReason: "condition-false" };
        if (event === "schema-key") {
          assert.equal(SpanEventWireSchema.safeParse({ ...queued, pid: 4242 }).success, true,
            "the control event must satisfy every required field");
          const parsed = SpanEventWireSchema.safeParse(invalid);
          assert.equal(parsed.success, false);
          if (parsed.success) throw new Error("the invalid record key must be refused");
          const [union] = parsed.error.issues;
          assert.ok(union?.code === "invalid_union");
          assert.deepEqual(union.errors[0]?.map(({ code, path }) => ({ code, path })), [
            { code: "invalid_key", path: ["resolvedInstance", marker] },
          ], "the otherwise-valid queued arm must fail at the marker-bearing nested record key");
          assert.deepEqual(union.path, [], "the union itself has a root path; it does not flatten nested key paths");
        }
        const raw = new DatabaseSync(authorityPath);
        try {
          const trigger = raw.prepare("SELECT sql FROM sqlite_master WHERE name='timeline_events_immutable'").get();
          assert.equal(typeof trigger?.sql, "string");
          raw.exec("DROP TRIGGER timeline_events_immutable; PRAGMA ignore_check_constraints=ON");
          raw.prepare("UPDATE timeline_events SET payload_json=json_set(payload_json, '$.payload.event', json(?))").run(JSON.stringify(invalid));
          raw.exec(String(trigger?.sql));
        } finally { raw.close(); }
    }
    if ("code" in testCase) {
      vi.spyOn(AuthorityDatabase_m2, "inspectTimelineReadOnly").mockImplementation(() => {
        throw Object.assign(new Error(`${marker} /private/synthetic-home/person-documents 10999999`), { code: testCase.code });
      });
      syncBuiltinESMExports();
    }
    const doctorOptions = {
      stateRootTrustAnchor: repoRoot, stateRoot, authorityPath,
      backupDirectory: join(stateRoot, "backups", "authority"), maxBackupAgeMs: 60_000, busyTimeoutMs: 500,
    };
    let output: string;
    if (boundary === "cli-json") {
      const result = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], clock, repoRoot);
      assert.equal(result.exitCode, 1);
      output = result.output;
    } else {
      const report = boundary === "doctor"
        ? await doctorAuthorityStorage_m2(doctorOptions, clock)
        : await buildStorageDoctor({ admission: syntheticStateRoot(doctorOptions.stateRoot), doctorOptions, clock, serviceState: () => ({ state: "never-run", reason: "test has no backup service" }) });
      output = JSON.stringify(report);
    }
    assert.equal(output.includes(marker), false, `${boundary} must not echo synthetic sensitive path content`);
    assert.equal(output.includes(field), true, "diagnosis must still name the offending field");
    if ("code" in testCase) {
      assert.equal(output.includes("/private/synthetic-home"), false);
      assert.equal(output.includes("10999999"), false);
      assert.equal(output.includes("SYNTHETIC_ERRNO_NEVER_REAL"), false);
      assert.match(output, /span-stream-invalid/u);
    } else if (event === "schema-key" || event === "schema-field") {
      assert.match(output, /span-stream-invalid/u);
      if (event === "schema-key" || event === "schema-field") assert.match(output, /timeline-record-invalid/u);
    } else assert.match(output, /span_stream/u);
    await profile.close();
  });
});
}

{

const disposers: (() => void | Promise<void>)[] = [];
const _afterEachFixture0 = async () => {
  for (const dispose of disposers.splice(0)) await dispose();
};

const MAX_AGE_MS = 45 * 60 * 1000;

async function world() {
  const clock = manualClock(new Date(NOW));
  const profile = await diagnosticProfiles.create();
  const database = AuthorityDatabase_m2.open({ path: profile.path, busyTimeoutMs: 1000, migrationOwner: "summary-test" }, clock);
  disposers.push(async () => { database.close(); await profile.close(); });
  const directory = join(profile.stateRoot, "backups", "authority");
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const service = new AuthorityBackupService(database, { directory }, clock);
  const options = { backupDirectory: directory, maxBackupAgeMs: MAX_AGE_MS };
  return { clock, database, directory, service, options };
}

function dirtyAuthority(database: AuthorityDatabase_m2): number {
  database.authority.notifications.create({
    notificationId: UUID_7,
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
    lastSeenAt: NOW,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return database.getMeta().authorityGeneration;
}

describe("summarizeBackupHealth", () => {
afterEach(_afterEachFixture0);

  it("reads missing with no directory, and current right after a real verified backup", async () => {
    const w = await world();
    assert.equal(summarizeBackupHealth_m3(w.options, w.database.getMeta().authorityGeneration, w.clock), "missing");

    await w.service.request({ trigger: "interval", requiredGeneration: w.database.getMeta().authorityGeneration });
    assert.equal(summarizeBackupHealth_m3(w.options, w.database.getMeta().authorityGeneration, w.clock), "current");
  });

  it("refuses a missing, nonregular or wrong-size physical copy and distinguishes I/O uncertainty", async () => {
    const w = await world();
    await w.service.request({ trigger: "interval", requiredGeneration: w.database.getMeta().authorityGeneration });
    const name = readdirSync(w.directory).find(name => name.endsWith(".manifest.json"));
    assert.ok(name);
    const manifest = JSON.parse(readFileSync(join(w.directory, name), "utf8")) as { backupFileName: string };
    const copy = join(w.directory, manifest.backupFileName);
    rmSync(copy);
    assert.equal(summarizeBackupHealth_m3(w.options, w.database.getMeta().authorityGeneration, w.clock), "missing");
    mkdirSync(copy);
    assert.equal(summarizeBackupHealth_m3(w.options, w.database.getMeta().authorityGeneration, w.clock), "missing");
    rmSync(copy, { recursive: true });
    writeFileSync(copy, "short");
    assert.equal(summarizeBackupHealth_m3(w.options, w.database.getMeta().authorityGeneration, w.clock), "missing");
    const spy = vi.spyOn(fs, "lstatSync").mockImplementation(() => { throw Object.assign(new Error("denied"), { code: "EACCES" }); });
    syncBuiltinESMExports();
    try { assert.equal(summarizeBackupHealth_m3(w.options, undefined, w.clock), "unavailable"); }
    finally { spy.mockRestore(); syncBuiltinESMExports(); }
  });

  it("reads stale on ANY authority-generation gap, and current again after the next backup", async () => {
    const w = await world();
    await w.service.request({ trigger: "interval", requiredGeneration: w.database.getMeta().authorityGeneration });

    const generation = dirtyAuthority(w.database);
    assert.equal(summarizeBackupHealth_m3(w.options, generation, w.clock), "stale");

    w.clock.advanceWall(60_000);
    await w.service.request({ trigger: "interval", requiredGeneration: generation });
    assert.equal(summarizeBackupHealth_m3(w.options, w.database.getMeta().authorityGeneration, w.clock), "current");
  });

  it("reads stale past the age bound even with no gap, and judges by age alone when the live generation is unknown", async () => {
    const w = await world();
    await w.service.request({ trigger: "interval", requiredGeneration: w.database.getMeta().authorityGeneration });

    w.clock.advanceWall(MAX_AGE_MS + 1);
    assert.equal(summarizeBackupHealth_m3(w.options, w.database.getMeta().authorityGeneration, w.clock), "stale");

    // Authority unavailable (undefined generation): the fresh-age arm still
    // answers — the summary's documented degraded contract.
    const fresh = await world();
    await fresh.service.request({ trigger: "interval", requiredGeneration: fresh.database.getMeta().authorityGeneration });
    assert.equal(summarizeBackupHealth_m3(fresh.options, undefined, fresh.clock), "current");
  });

  it("treats an unparseable manifest as no usable backup — missing, never a guessed state", async () => {
    const w = await world();
    mkdirSync(w.directory, { recursive: true });
    writeFileSync(join(w.directory, "authority-1.manifest.json"), "{ not json");
    assert.equal(summarizeBackupHealth_m3(w.options, w.database.getMeta().authorityGeneration, w.clock), "missing");
  });
});
}
