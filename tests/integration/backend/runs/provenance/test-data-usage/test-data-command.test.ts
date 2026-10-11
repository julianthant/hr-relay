
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../../src/backend/app/config/runtime-isolation.js";


import { TEST_DATA_USAGE } from "../../../../../../src/backend/runs/provenance/test-data-usage.js";
import { testDataLocalPath } from "../../../../../../src/backend/app/registries/test-data.js";
import { composeTestDataCommand, type TestDataComposeDependencies } from "../../../../../support/helpers/synthetic-storage-admission.js";

const REPO_ROOT = process.cwd();
const VALUE_EID = "d0000000-0000-4000-8000-000000000002";
const SYNTHETIC_DOCUMENT = "4000001";
const SYNTHETIC_EID = "10000001";
const NOW = "2026-09-06T12:00:00.000Z";
const MANIFESTS: TestDataComposeDependencies["loadManifests"] = async () => [
  { workflow: "separations", cases: [{ subjectLabel: "finalization-canary", subjectKind: "full-chain-dry-run" }] },
  { workflow: "person-lookup", cases: [{ subjectLabel: "person-lookup-canary", subjectKind: "search-by-eid" }] },
];
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), "hr-test-data-command-"));
  roots.push(root);
  mkdirSync(join(root, "config"), { mode: 0o755 });
  mkdirSync(join(root, "tests", "support", "fixtures", "documents"), { recursive: true });
  cpSync(join(REPO_ROOT, "config", "test-data.json"), join(root, "config", "test-data.json"));
  cpSync(join(REPO_ROOT, "tests", "support", "fixtures", "documents", "synthetic-sample.pdf"), join(root, "tests", "support", "fixtures", "documents", "synthetic-sample.pdf"));
  mkdirSync(join(root, rebuildRuntimeIsolation.stateRoot), { mode: 0o700, recursive: true });
  return root;
}

async function run(root: string, args: readonly string[]) {
  const outcome = await composeTestDataCommand(rebuildRuntimeIsolation, args, root, { loadManifests: MANIFESTS, now: () => new Date("2026-09-07T09:00:00.000Z") });
  assert.equal(outcome.output.endsWith("\n"), true);
  return { exitCode: outcome.exitCode, report: JSON.parse(outcome.output) as Record<string, unknown> & { status: string } };
}

function noValues(report: unknown): void {
  const text = JSON.stringify(report);
  assert.equal(text.includes(SYNTHETIC_DOCUMENT), false, "document number leaked");
  assert.equal(text.includes(SYNTHETIC_EID), false, "EID leaked");
}

describe("cli test-data", () => {
  it("refuses unknown or incomplete options with exit 2 before any work, naming the usage", async () => {
    const root = checkout();
    const cases: readonly (readonly string[])[] = [
      [], ["frobnicate", "--json"], ["check"], ["check", "--json", "--bogus"], ["check", "--json", "--subject"],
      ["check", "--json", "--workflow", "person-lookup"], ["check", "--json", "--subject", "a", "--subject", "b"],
      ["migrate", "--json"], ["migrate", "--from-credentials"], ["migrate", "--from-credentials", "--json", "--force"],
      ["migrate", "--from-credentials", "--json", "--from-credentials=yes"],
    ];
    for (const args of cases) {
      const { exitCode, report } = await run(root, args);
      assert.equal(exitCode, 2, `args ${args.join(" ")}`);
      assert.equal(report.status, "defect");
      assert.equal(typeof report.reason, "string");
    }
    const usage = await run(root, ["nope"]);
    for (const line of TEST_DATA_USAGE) assert.equal(String(usage.report.reason).includes(line), true);
    assert.equal(existsSync(join(root, rebuildRuntimeIsolation.stateRoot, "credentials")), false, "no credential store was created");
    assert.equal(existsSync(testDataLocalPath(root)), false);
  });

  it("check reports shared subjects, files and samples with the private file absent, and names blocked inputs only", async () => {
    const root = checkout();
    const plain = await run(root, ["check", "--json"]);
    assert.equal(plain.exitCode, 0);
    assert.equal(plain.report.status, "ok");
    const shared = plain.report.shared as { subjects: { label: string; workflows: string[] }[]; files: { name: string; state: string }[]; samples: Record<string, number> };
    assert.deepEqual(shared.subjects.map(({ label, workflows }) => ({ label, workflows })), [
      { label: "finalization-canary", workflows: ["separations", "separations-kuali-finalization"] },
      { label: "person-lookup-canary", workflows: ["person-lookup"] },
    ]);
    assert.deepEqual(shared.files, [{ name: "synthetic-sample-pdf", kind: "pdf", state: "readable" }]);
    assert.equal(shared.samples.eids > 0 && shared.samples.kualiDocumentNumbers > 0 && shared.samples.timekeeperNames > 0, true);
    assert.deepEqual(plain.report.local, { path: "config/test-data.local.json", state: "absent", files: [], inputs: [
      { name: "separationsKualiFinalizationCanaryDocumentNumber", present: false }, { name: "personLookupCanaryEid", present: false }] });

    const blocked = await run(root, ["check", "--json", "--subject", "person-lookup-canary"]);
    assert.equal(blocked.exitCode, 1);
    assert.equal(blocked.report.status, "blocked");
    assert.deepEqual(blocked.report.subjects, [{ label: "person-lookup-canary", workflow: "person-lookup", state: "blocked",
      reason: "blocked: needs person-lookup-canary; its UCPath employee id is not configured — set personLookupCanaryEid in config/test-data.local.json" }]);

    const unknown = await run(root, ["check", "--json", "--subject", "nobody"]);
    assert.equal(unknown.exitCode, 1);
    assert.deepEqual(unknown.report.subjects, [{ label: "nobody", workflow: "*", state: "blocked", reason: "blocked: needs nobody; no such subject" }]);

    const file = await run(root, ["check", "--json", "--file", "synthetic-sample-pdf"]);
    assert.equal(file.exitCode, 0);
    assert.deepEqual(file.report.file, { name: "synthetic-sample-pdf", source: "shared", state: "readable" });
    const missingFile = await run(root, ["check", "--json", "--file", "nothing"]);
    assert.equal(missingFile.exitCode, 1);
    assert.deepEqual(missingFile.report.file, { name: "nothing", source: "local", state: "not-declared",
      reason: "no file named nothing in config/test-data.json or config/test-data.local.json" });
  });

  it("check reads a valid private file by name only, and a corrupt shared or private file is a named defect", async () => {
    const root = checkout();
    writeFileSync(testDataLocalPath(root), `${JSON.stringify({ schemaVersion: 1, inputs: {
      personLookupCanaryEid: { valueId: VALUE_EID, value: SYNTHETIC_EID, updatedAt: NOW },
    }, files: {} })}\n`, { mode: 0o600 });
    const ready = await run(root, ["check", "--json", "--subject", "person-lookup-canary", "--workflow", "person-lookup"]);
    noValues(ready.report);
    assert.equal(ready.exitCode, 0);
    assert.equal(ready.report.status, "ok");
    assert.deepEqual(ready.report.local, { path: "config/test-data.local.json", state: "valid", files: [], inputs: [
      { name: "separationsKualiFinalizationCanaryDocumentNumber", present: false }, { name: "personLookupCanaryEid", present: true }] });
    assert.deepEqual(ready.report.subjects, [{ label: "person-lookup-canary", workflow: "person-lookup", state: "ready" }]);

    // Every declared arm is reported: the standalone finalization arm stays a blocked manifest witness by design.
    const otherArm = await run(root, ["check", "--json", "--subject", "finalization-canary"]);
    assert.equal(otherArm.exitCode, 1);
    const arms = otherArm.report.subjects as { workflow: string; state: string; reason?: string }[];
    assert.deepEqual(arms.map(({ workflow, state }) => ({ workflow, state })), [
      { workflow: "separations", state: "blocked" }, { workflow: "separations-kuali-finalization", state: "blocked" }]);
    assert.equal(arms[0]?.reason, "blocked: needs finalization-canary; its Kuali document number is not configured — set separationsKualiFinalizationCanaryDocumentNumber in config/test-data.local.json");

    chmodSync(testDataLocalPath(root), 0o644);
    const loose = await run(root, ["check", "--json", "--subject", "person-lookup-canary"]);
    noValues(loose.report);
    assert.equal(loose.exitCode, 2);
    assert.equal(loose.report.status, "defect");
    assert.equal((loose.report.local as { state: string }).state, "invalid");
    assert.match((loose.report.local as { reason: string }).reason, /config\/test-data\.local\.json/u);
    assert.equal((loose.report.subjects as { state: string }[])[0]?.state, "defect");

    writeFileSync(join(root, "config", "test-data.json"), "{\n");
    const corrupt = await run(root, ["check", "--json"]);
    assert.equal(corrupt.exitCode, 2);
    assert.deepEqual(Object.keys(corrupt.report).sort(), ["command", "shared", "status"]);
    assert.equal((corrupt.report.shared as { state: string }).state, "invalid");
  });
});
