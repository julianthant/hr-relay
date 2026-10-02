/**
 * D341 — `cli test-data check|migrate` composition. Runs against a copied
 * checkout root under a private temp directory: the real tracked
 * `config/test-data.json` and synthetic PDF, a synthetic private file and a
 * synthetic pre-D341 credential document. Never the operator's `.tracker`.
 */
import assert from "node:assert/strict";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../../src/backend/app/config/runtime-isolation.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../../../src/models/config/protected-settings-legacy.js";
import { TEST_DATA_USAGE } from "../../../../../../src/backend/runs/provenance/test-data-usage.js";
import { readTestDataLocalConfig, testDataLocalPath } from "../../../../../../src/backend/app/registries/test-data.js";
import { composeTestDataCommand, type TestDataComposeDependencies } from "../../../../../support/helpers/synthetic-storage-admission.js";

const REPO_ROOT = process.cwd();
const VALUE_DOC = "d0000000-0000-4000-8000-000000000001";
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
  mkdirSync(join(root, "tests", "fixtures", "documents"), { recursive: true });
  cpSync(join(REPO_ROOT, "config", "test-data.json"), join(root, "config", "test-data.json"));
  cpSync(join(REPO_ROOT, "tests", "fixtures", "documents", "synthetic-sample.pdf"), join(root, "tests", "fixtures", "documents", "synthetic-sample.pdf"));
  mkdirSync(join(root, rebuildRuntimeIsolation.stateRoot), { mode: 0o700 });
  return root;
}

function writeLegacyCredentials(root: string): string {
  const directory = join(root, rebuildRuntimeIsolation.stateRoot, "credentials");
  mkdirSync(directory, { mode: 0o700 });
  const path = join(directory, "protected.json");
  const request = {
    commandId: "11111111-1111-4111-8111-111111111111", commandFingerprint: "1".repeat(64), expectedRevision: 1,
    protectedSchemaHash: LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH, writeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", updatedAt: NOW,
    entries: { separationsKualiFinalizationCanaryDocumentNumber: { set: SYNTHETIC_DOCUMENT }, personLookupCanaryEid: { set: SYNTHETIC_EID } },
  };
  const document = {
    schemaVersion: 1,
    record: { schemaVersion: 1, revision: 2, protectedSchemaHash: LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH,
      entries: {
        separationsKualiFinalizationCanaryDocumentNumber: { valueId: VALUE_DOC, value: SYNTHETIC_DOCUMENT, updatedAt: NOW },
        personLookupCanaryEid: { valueId: VALUE_EID, value: SYNTHETIC_EID, updatedAt: NOW },
      },
      lastApplied: { commandId: request.commandId, commandFingerprint: request.commandFingerprint, expectedRevision: 1,
        protectedSchemaHash: LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH, writeId: request.writeId } },
    history: [{ request, setValueIds: { separationsKualiFinalizationCanaryDocumentNumber: VALUE_DOC, personLookupCanaryEid: VALUE_EID } }],
  };
  writeFileSync(path, `${canonicalJsonStringify(document)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
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

describe("cli test-data (D341)", () => {
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
      reason: "blocked: needs person-lookup-canary; its UCPath employee id is not configured — set personLookupCanaryEid in config/test-data.local.json (D341)" }]);

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
    assert.equal(arms[0]?.reason, "blocked: needs finalization-canary; its Kuali document number is not configured — set separationsKualiFinalizationCanaryDocumentNumber in config/test-data.local.json (D341)");

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

  it("migrate --plan writes nothing; migrate converts the synthetic credential document into the private file, then is idempotent", async () => {
    const root = checkout();
    const credentialPath = writeLegacyCredentials(root);
    const legacyBytes = readFileSync(credentialPath, "utf8");

    const plan = await run(root, ["migrate", "--from-credentials", "--plan", "--json"]);
    noValues(plan.report);
    assert.equal(plan.exitCode, 0);
    assert.equal(plan.report.command, "test-data migrate");
    assert.equal(plan.report.status, "planned");
    assert.equal(readFileSync(credentialPath, "utf8"), legacyBytes);
    assert.equal(existsSync(testDataLocalPath(root)), false);

    const apply = await run(root, ["migrate", "--from-credentials", "--json"]);
    noValues(apply.report);
    assert.equal(apply.exitCode, 0);
    assert.equal(apply.report.status, "converted");
    assert.deepEqual(apply.report.source, { path: "credentials/protected.json", state: "current", revision: 3, historyLength: 1,
      retiredEntries: ["separationsKualiFinalizationCanaryDocumentNumber", "personLookupCanaryEid"] });
    const local = readTestDataLocalConfig(testDataLocalPath(root));
    assert.equal(local.state, "valid");
    if (local.state !== "valid") throw new Error("expected the private file");
    assert.deepEqual(Object.keys(local.config.inputs).sort(), ["personLookupCanaryEid", "separationsKualiFinalizationCanaryDocumentNumber"]);
    assert.equal(local.config.inputs.personLookupCanaryEid?.valueId, VALUE_EID);
    assert.equal((JSON.parse(readFileSync(credentialPath, "utf8")) as { schemaVersion: unknown }).schemaVersion, 2);

    const again = await run(root, ["migrate", "--from-credentials", "--json"]);
    assert.equal(again.exitCode, 0);
    assert.equal(again.report.status, "already-converted");

    // The converted checkout is now ready by name for both arms without any Settings entry.
    const ready = await run(root, ["check", "--json", "--subject", "finalization-canary", "--workflow", "separations"]);
    assert.equal(ready.exitCode, 0);
    assert.deepEqual(ready.report.subjects, [{ label: "finalization-canary", workflow: "separations", state: "ready" }]);
  });

  it("migrate refuses with exit 1 on a conflicting destination and reports nothing to migrate for an absent store", async () => {
    const absent = checkout();
    const nothing = await run(absent, ["migrate", "--from-credentials", "--json"]);
    assert.equal(nothing.exitCode, 0);
    assert.equal(nothing.report.status, "nothing-to-migrate");
    assert.equal(existsSync(testDataLocalPath(absent)), false);

    const root = checkout();
    const credentialPath = writeLegacyCredentials(root);
    const legacyBytes = readFileSync(credentialPath, "utf8");
    const conflict = `${JSON.stringify({ schemaVersion: 1, inputs: {
      personLookupCanaryEid: { valueId: VALUE_EID, value: "10000002", updatedAt: NOW },
    }, files: {} })}\n`;
    writeFileSync(testDataLocalPath(root), conflict, { mode: 0o600 });
    const refused = await run(root, ["migrate", "--from-credentials", "--json"]);
    noValues(refused.report);
    assert.equal(refused.exitCode, 1);
    assert.equal(refused.report.status, "refused");
    assert.match(String(refused.report.reason), /different entry for personLookupCanaryEid/u);
    assert.equal(readFileSync(credentialPath, "utf8"), legacyBytes);
    assert.equal(readFileSync(testDataLocalPath(root), "utf8"), conflict);
  });
});
