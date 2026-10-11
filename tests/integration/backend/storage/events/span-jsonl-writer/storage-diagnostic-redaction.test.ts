import { syntheticStateRoot } from "../../../../../support/helpers/synthetic-storage-admission.js";
import assert from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../../src/backend/app/config/runtime-isolation.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { SpanEventWireSchema } from "../../../../../../src/models/events/types.js";
import { createTimelineEmitter } from "../../../../../../src/backend/storage/events/timeline-emitter.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { doctorAuthorityStorage } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { buildStorageDoctor } from "../../../../../../src/backend/runs/queries/storage.js";
import { composeStorageCommand } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { CONFIG_SNAPSHOT, NOW } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../../../support/fixtures/phase1f-run-fixtures.js";

const roots: string[] = [];
const clock = manualClock(new Date(NOW));
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const CASES = [
  ["private-path", "/private/synthetic-home/person-documents"],
  ["secret-marker", "SYNTHETIC_SECRET_NEVER_REAL"],
  ["person-marker", "10999999"],
] as const;

describe.each(["doctor", "browser-wire", "cli-json"] as const)("storage diagnostic redaction at %s", (boundary) => {
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
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-diagnostic-redaction-")));
    roots.push(repoRoot);
    if (event === "nested-root") {
      const actualParent = join(repoRoot, "owned");
      mkdirSync(actualParent);
      fs.symlinkSync(actualParent, join(repoRoot, marker), "dir");
    }
    const stateRoot = join(repoRoot,
      event === "nested-root" ? join(marker, "state") : rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const authorityPath = join(event === "nested-root" ? join(repoRoot, "owned", "state") : stateRoot, "state.db");
    const database = AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 500, migrationOwner: "redaction-test" }, clock);
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
      vi.spyOn(AuthorityDatabase, "inspectTimelineReadOnly").mockImplementation(() => {
        throw Object.assign(new Error(`${marker} /private/synthetic-home/person-documents 10999999`), { code: testCase.code });
      });
      syncBuiltinESMExports();
    }
    const doctorOptions = {
      stateRootTrustAnchor: repoRoot, stateRoot, authorityPath,
      backupDirectory: join(stateRoot, "backups", "authority"), maxBackupAgeMs: 60_000, busyTimeoutMs: 500,
    };
    if (event === "nested-root") {
      const expected = boundary === "doctor"
        ? "runtime-admission: storage doctor roots differ from active locator"
        : "runtime-admission: unsafe synthetic fixture ancestor";
      await assert.rejects(async () => boundary === "doctor"
        ? doctorAuthorityStorage(doctorOptions, clock)
        : buildStorageDoctor({ admission: syntheticStateRoot(doctorOptions.stateRoot), doctorOptions, clock,
          serviceState: () => ({ state: "never-run", reason: "test has no backup service" }) }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, expected);
        assert.equal(error.message.includes(marker), false);
        return true;
      });
      return;
    }
    let output: string;
    if (boundary === "cli-json") {
      const result = await composeStorageCommand(rebuildRuntimeIsolation, ["doctor", "--json"], clock, repoRoot);
      assert.equal(result.exitCode, 1);
      output = result.output;
    } else {
      const report = boundary === "doctor"
        ? await doctorAuthorityStorage(doctorOptions, clock)
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
  });
});
