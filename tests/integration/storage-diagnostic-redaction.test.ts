import { syntheticStateRoot } from "../helpers/synthetic-storage-admission.js";
import assert from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { manualClock } from "../../src/domain/clock.js";
import { SpanEventWireSchema } from "../../src/events/types.js";
import { createSpanJsonlWriter } from "../../src/infra/events/span-jsonl-writer.js";
import { createTimelineEmitter } from "../../src/infra/events/timeline-emitter.js";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { doctorAuthorityStorage, inspectSpanAuthorityCorpusReadOnly } from "../helpers/synthetic-storage-admission.js";
import { buildStorageDoctor } from "../../src/server/dashboard/queries/storage.js";
import { composeStorageCommand } from "../helpers/synthetic-storage-admission.js";
import { NOW } from "../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";

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
  { label: "invalid-filename", marker: "SYNTHETIC_SECRET_NEVER_REAL", event: "invalid-file", field: "stream file" },
  { label: "valid-filename", marker: "10999999", event: "valid-file", field: "workflow" },
  { label: "schema-key", marker: "/private/SYNTHETIC_SECRET_NEVER_REAL/10999999", event: "schema-key", field: "strict span schema" },
  { label: "schema-field", marker: "SYNTHETIC_SECRET_NEVER_REAL", event: "schema-field", field: "notRunReason" },
  // CLI isolation fixes stateRoot to the anchor's direct .tracker child;
  // only doctor/browser options can express intermediate relative components.
  ...(boundary === "cli-json" ? [] : [
    { label: "nested-root", marker: "SYNTHETIC_SECRET_NEVER_REAL_10999999", event: "nested-root", field: "path component 1" },
  ]),
  ])("validates $label from $event / $field or refuses an unadmitted root before a doctor report", async (testCase) => {
    const { marker, event, field } = testCase;
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-diagnostic-redaction-"));
    roots.push(repoRoot);
    if (event === "nested-root") {
      const actualParent = join(repoRoot, "owned");
      mkdirSync(actualParent);
      fs.symlinkSync(actualParent, join(repoRoot, marker), "dir");
    }
    const stateRoot = join(repoRoot,
      event === "nested-root" ? join(marker, "state") : rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot);
    const authorityPath = join(event === "nested-root" ? join(repoRoot, "owned", "state") : stateRoot, "state.db");
    const database = AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 500, migrationOwner: "redaction-test" }, clock);
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
      ...(event === "root" ? { [field]: marker } : {}),
    };
    writer.emit(queued);
    if (event === "task") writer.emit({
      ...common, t: "span.started", kind: "task", spanPath: `${e.traceId}/searching#1`,
      parentSpanPath: e.traceId, name: "searching", [field]: marker,
    });
    database.close();
    if (event === "invalid-file" || event === "valid-file" || event === "schema-key" || event === "schema-field") {
      createSpanJsonlWriter({ stateRoot, clock, pid: 4242 }).emit(queued);
      const spans = join(stateRoot, "spans");
      const [fileName] = fs.readdirSync(spans);
      assert.ok(fileName);
      const filePath = join(spans, fileName);
      if (event === "invalid-file" || event === "valid-file") {
        fs.renameSync(filePath, join(spans, `${marker}-2026-07-31.jsonl`));
      } else {
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
        fs.appendFileSync(filePath, `${JSON.stringify(invalid)}\n`);
        const raw = new DatabaseSync(authorityPath);
        try {
          raw.exec("DROP TRIGGER timeline_events_never_updated");
          raw.prepare("UPDATE timeline_events SET record_json=json_set(record_json, '$.payload.event', json(?))").run(JSON.stringify(invalid));
        } finally { raw.close(); }
      }
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
      if (event !== "invalid-file" && event !== "valid-file") assert.equal(result.exitCode, 1);
      output = result.output;
    } else {
      const report = boundary === "doctor"
        ? await doctorAuthorityStorage(doctorOptions, clock)
        : await buildStorageDoctor({ admission: syntheticStateRoot(doctorOptions.stateRoot), doctorOptions, clock, serviceState: () => ({ state: "never-run", reason: "test has no backup service" }) });
      output = JSON.stringify(report);
    }
    assert.equal(output.includes(marker), false, `${boundary} must not echo synthetic sensitive path content`);
    if (event !== "invalid-file" && event !== "valid-file") {
      assert.equal(output.includes(field), true, "diagnosis must still name the offending field");
    }
    if ("code" in testCase) {
      assert.equal(output.includes("/private/synthetic-home"), false);
      assert.equal(output.includes("10999999"), false);
      assert.equal(output.includes("SYNTHETIC_ERRNO_NEVER_REAL"), false);
      assert.match(output, /span-stream-invalid/u);
    } else if (event === "invalid-file" || event === "valid-file") {
      assert.match(output, /"spanAuthority":\s*\{\s*"state":\s*"reconciled"/u);
      let diagnostic: string;
      try {
        const corpus = inspectSpanAuthorityCorpusReadOnly(repoRoot, stateRoot);
        diagnostic = JSON.stringify(corpus.roots.flatMap((root) => root.streamIssues));
      } catch (error) {
        assert.ok(error instanceof Error);
        diagnostic = error.message;
      }
      assert.equal(diagnostic.includes(marker), false);
      assert.equal(diagnostic.includes(field), true);
    } else if (event === "schema-key" || event === "schema-field") {
      assert.match(output, /span-stream-invalid/u);
      if (event === "schema-key" || event === "schema-field") assert.match(output, /timeline-record-invalid/u);
    } else assert.match(output, /span_stream/u);
  });
});
