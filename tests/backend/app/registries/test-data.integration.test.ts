import { testProcessImport } from "../../../support/compiled-process.js";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, cpSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join as join_m0, relative } from "node:path";
import { afterEach, describe, it } from "vitest";
import { absentTestDataInputSource, assertNoDuplicateKeys, createTestDataInputSource, parseTestDataSharedConfig, planTestDataLocalMerge, readTestDataFileBytes, readTestDataLocalConfig, readTestDataShared, TEST_DATA, testDataFile, testDataInputSourceFrom, testDataLocalFilePath, testDataLocalPath, testDataLocalPresence, testDataSamples, writeTestDataLocalConfig, type TestDataLocalWriteAccess } from "../../../../src/backend/app/registries/test-data.js";
import { TEST_TARGET_REGISTRY } from "../../../../src/backend/app/registries/test-target-registry.js";
import { TEST_DATA_CONFIG_PATH, TEST_DATA_INPUT_NAMES, TEST_DATA_LOCAL_CONFIG_PATH, TEST_DATA_LOCAL_MAXIMUM_BYTES, TestDataConfigError, TestDataLocalConfigError, TestDataLocalConfigSchema, TestDataSharedConfigSchema } from "../../../../src/models/config/test-data.js";
import { KualiDocumentNumberSchema } from "../../../../src/models/ui/kuali-document-identity.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";

import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";

import { TEST_DATA_USAGE } from "../../../../src/backend/runs/provenance/test-data-usage.js";
import { composeTestDataCommand, type TestDataComposeDependencies } from "../../../support/helpers/synthetic-storage-admission.js";

{

const REPO_ROOT = process.cwd();
const VALUE_ID_1 = "10000000-0000-4000-8000-000000000001";
const VALUE_ID_2 = "10000000-0000-4000-8000-000000000002";
const VALUE_ID_3 = "10000000-0000-4000-8000-000000000003";
const NOW = "2026-09-07T00:00:00.000Z";
const SYNTHETIC_DOCUMENT = "4000001";
const SYNTHETIC_EID = "10000001";

const roots: string[] = [];
const _afterEachFixture0 = () => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};

function scratch(prefix: string): string {
  const root = mkdtempSync(join_m0(realpathSync(tmpdir()), prefix));
  roots.push(root);
  return root;
}

function localDocument(inputs: Record<string, unknown> = {}, files: Record<string, string> = {}): string {
  return `${JSON.stringify({ schemaVersion: 1, inputs, files }, null, 2)}\n`;
}

function writePrivate(root: string, body: string, mode = 0o600): string {
  mkdirSync(join_m0(root, "config"), { recursive: true });
  const path = join_m0(root, "config", "test-data.local.json");
  writeFileSync(path, body, { mode });
  chmodSync(path, mode);
  return path;
}

const configuredInputs = {
  separationsKualiFinalizationCanaryDocumentNumber: { valueId: VALUE_ID_1, value: SYNTHETIC_DOCUMENT, updatedAt: NOW },
  personLookupCanaryEid: { valueId: VALUE_ID_2, value: SYNTHETIC_EID, updatedAt: NOW },
};

describe("shared test-data config", () => {
afterEach(_afterEachFixture0);

  it("is the tracked, frozen owner of the public subject registry, files and samples", () => {
    assert.equal(TEST_DATA_CONFIG_PATH, "config/test-data.json");
    assert.equal(TEST_DATA.configPath, join_m0(REPO_ROOT, TEST_DATA_CONFIG_PATH));
    assert.equal(realpathSync(TEST_DATA.repoRoot), realpathSync(REPO_ROOT));
    assert.equal(Object.isFrozen(TEST_DATA), true);
    assert.equal(Object.isFrozen(TEST_DATA.samples.eids), true);
    // The registry export and the shared config expose ONE registry.
    assert.deepEqual(TEST_DATA.subjects, TEST_TARGET_REGISTRY);
    assert.equal(existsSync(join_m0(REPO_ROOT, "config", "test-subjects.json")), false, "the old registry file is retired");
    assert.deepEqual(TEST_DATA.files.map(({ name, kind }) => ({ name, kind })), [{ name: "synthetic-sample-pdf", kind: "pdf" }]);
  });

  it("hands out isolated sample copies so one test cannot mutate another's inputs", () => {
    const first = testDataSamples();
    const second = testDataSamples();
    first.eids.push("99999999");
    assert.notDeepEqual(first.eids, second.eids);
    assert.deepEqual(second.eids, [...TEST_DATA.samples.eids]);
    for (const eid of TEST_DATA.samples.eids) assert.equal(EidSchema.safeParse(eid).success, true, eid);
    for (const number of TEST_DATA.samples.kualiDocumentNumbers) assert.equal(KualiDocumentNumberSchema.safeParse(number).success, true, number);
  });

  it("resolves declared file paths against the declaring config file, not the working directory", () => {
    const file = testDataFile(TEST_DATA, "synthetic-sample-pdf");
    assert.equal(file.path, join_m0(dirname(TEST_DATA.configPath), "..", "tests", "support", "fixtures", "documents", "synthetic-sample.pdf").replace("/config/../", "/"));
    assert.equal(relative(REPO_ROOT, file.path), join_m0("tests", "support", "fixtures", "documents", "synthetic-sample.pdf"));
    const { bytes } = readTestDataFileBytes(TEST_DATA, "synthetic-sample-pdf");
    assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.equal(bytes.byteLength > 0, true);
    assert.equal(bytes.includes(Buffer.from("SYNTHETIC TEST DOCUMENT")), true, "the tracked asset is the synthetic document");
    assert.throws(() => testDataFile(TEST_DATA, "no-such-file"), /declares no file named no-such-file/u);
  });

  it("reads the same bytes from a different working directory and from a separate checkout copy", () => {
    // Different CWD: the module resolves from import.meta.url, so a child process
    // started elsewhere reads the identical asset.
    const elsewhere = scratch("hrauto-test-data-cwd-");
    const child = spawnSync(process.execPath, ["--import", testProcessImport(), "--input-type=module", "--eval", `
      import { TEST_DATA, readTestDataFileBytes } from ${JSON.stringify(join_m0(REPO_ROOT, "src", "backend", "app", "registries", "test-data.ts"))};
      const { bytes } = readTestDataFileBytes(TEST_DATA, "synthetic-sample-pdf");
      process.stdout.write(JSON.stringify({ length: bytes.byteLength, head: bytes.subarray(0, 5).toString("latin1") }));
    `], { cwd: elsewhere, encoding: "utf8", env: { ...process.env, TMPDIR: elsewhere } });
    assert.equal(child.status, 0, child.stderr);
    const expected = readTestDataFileBytes(TEST_DATA, "synthetic-sample-pdf").bytes;
    assert.deepEqual(JSON.parse(child.stdout), { length: expected.byteLength, head: "%PDF-" });

    // Separate checkout copy: the declared relative path follows the copied config.
    const copy = scratch("hrauto-test-data-copy-");
    mkdirSync(join_m0(copy, "config"));
    mkdirSync(join_m0(copy, "tests", "support", "fixtures", "documents"), { recursive: true });
    cpSync(join_m0(REPO_ROOT, TEST_DATA_CONFIG_PATH), join_m0(copy, TEST_DATA_CONFIG_PATH));
    cpSync(join_m0(REPO_ROOT, "tests", "support", "fixtures", "documents", "synthetic-sample.pdf"), join_m0(copy, "tests", "support", "fixtures", "documents", "synthetic-sample.pdf"));
    const shared = readTestDataShared(copy, []);
    assert.equal(realpathSync(shared.repoRoot), realpathSync(copy));
    assert.deepEqual(readTestDataFileBytes(shared, "synthetic-sample-pdf").bytes, expected);
  });

  it("refuses a missing, empty, non-PDF, or symlinked-out file by name", () => {
    const root = scratch("hrauto-test-data-files-");
    mkdirSync(join_m0(root, "config"));
    mkdirSync(join_m0(root, "docs"));
    const outside = scratch("hrauto-test-data-outside-");
    writeFileSync(join_m0(outside, "real.pdf"), "%PDF-1.4 outside");
    writeFileSync(join_m0(root, "docs", "empty.pdf"), "");
    writeFileSync(join_m0(root, "docs", "text.pdf"), "not a pdf");
    symlinkSync(join_m0(outside, "real.pdf"), join_m0(root, "docs", "escape.pdf"));
    const config = (path: string) => ({
      schemaVersion: 1,
      subjects: TEST_TARGET_REGISTRY,
      files: { probe: { path, kind: "pdf", purpose: "probe" } },
      samples: TEST_DATA.samples,
    });
    const sharedFor = (path: string) => parseTestDataSharedConfig(config(path), join_m0(root, "config", "test-data.json"), []);
    assert.throws(() => readTestDataFileBytes(sharedFor("../docs/missing.pdf"), "probe"), /probe is missing at its declared path/u);
    assert.throws(() => readTestDataFileBytes(sharedFor("../docs/empty.pdf"), "probe"), /probe is empty/u);
    assert.throws(() => readTestDataFileBytes(sharedFor("../docs/text.pdf"), "probe"), /probe is not a PDF document/u);
    assert.throws(() => readTestDataFileBytes(sharedFor("../docs/escape.pdf"), "probe"), /probe resolves outside the repository/u);
    // A declared path that leaves the repository is a config defect before any read.
    assert.throws(() => sharedFor("../../../../../../elsewhere.pdf"), TestDataConfigError);
    assert.throws(() => sharedFor("/etc/hosts"), TestDataConfigError);
  });

  it("refuses an unknown member, a duplicate sample, or an unregistered subject shape", () => {
    const base = JSON.parse(readFileSync(join_m0(REPO_ROOT, TEST_DATA_CONFIG_PATH), "utf8")) as Record<string, unknown>;
    assert.equal(TestDataSharedConfigSchema.safeParse({ ...base, extra: true }).success, false);
    assert.equal(TestDataSharedConfigSchema.safeParse({ ...base, samples: { ...(base.samples as object), eids: ["10000001", "10000001"] } }).success, false);
    assert.equal(TestDataSharedConfigSchema.safeParse({ ...base, samples: { ...(base.samples as object), eids: ["not-an-eid"] } }).success, false);
    // A malformed subject is the registry's own strict-schema refusal; it never becomes a partial registry.
    assert.throws(
      () => parseTestDataSharedConfig({ ...base, subjects: { schemaVersion: 2, targets: [{ label: "x" }] } }, join_m0(REPO_ROOT, TEST_DATA_CONFIG_PATH), []),
      (error: unknown) => error instanceof Error && !(error instanceof TestDataConfigError),
    );
    assert.throws(
      () => parseTestDataSharedConfig({ ...base, schemaVersion: 2 }, join_m0(REPO_ROOT, TEST_DATA_CONFIG_PATH), []),
      /config\/test-data\.json is malformed/u,
    );
  });
});

describe("private test-data file", () => {
afterEach(_afterEachFixture0);

  it("treats an absent file as a truthful absent state, never a default", () => {
    const root = scratch("hrauto-test-data-absent-");
    const outcome = readTestDataLocalConfig(testDataLocalPath(root));
    assert.deepEqual(outcome, { state: "absent", path: join_m0(root, TEST_DATA_LOCAL_CONFIG_PATH) });
    assert.deepEqual(testDataLocalPresence(outcome), {
      state: "absent",
      inputs: TEST_DATA_INPUT_NAMES.map((name) => ({ name, present: false })),
      files: [],
    });
    assert.equal(createTestDataInputSource(testDataLocalPath(root)).read("personLookupCanaryEid"), undefined);
    assert.equal(absentTestDataInputSource().read("personLookupCanaryEid"), undefined);
    assert.throws(() => testDataLocalPath("relative/root"), /must be absolute/u);
    assert.throws(() => readTestDataLocalConfig("relative/path.json"), /must be absolute/u);
  });

  it("reads a private 0600 file, exposes presence without values, and resolves private file paths", () => {
    const root = scratch("hrauto-test-data-valid-");
    const path = writePrivate(root, localDocument(configuredInputs, { "private-sample": "private/sample.pdf", absolute: "/elsewhere/doc.pdf" }));
    const outcome = readTestDataLocalConfig(path);
    assert.equal(outcome.state, "valid");
    if (outcome.state !== "valid") throw new Error("expected a valid private file");
    assert.equal(Object.isFrozen(outcome.config.inputs), true);
    const presence = testDataLocalPresence(outcome);
    assert.deepEqual(presence, {
      state: "valid",
      inputs: [
        { name: "separationsKualiFinalizationCanaryDocumentNumber", present: true },
        { name: "personLookupCanaryEid", present: true },
      ],
      files: ["absolute", "private-sample"],
    });
    assert.equal(JSON.stringify(presence).includes(SYNTHETIC_DOCUMENT), false);
    assert.equal(JSON.stringify(presence).includes(SYNTHETIC_EID), false);
    assert.equal(testDataLocalFilePath(outcome, "private-sample"), join_m0(root, "config", "private", "sample.pdf"));
    assert.equal(testDataLocalFilePath(outcome, "absolute"), "/elsewhere/doc.pdf");
    assert.equal(testDataLocalFilePath(outcome, "unknown"), undefined);
  });

  it("captures the file once per source so a later edit affects only later starts", () => {
    const root = scratch("hrauto-test-data-capture-");
    const path = writePrivate(root, localDocument(configuredInputs));
    const source = createTestDataInputSource(path);
    assert.equal(source.read("personLookupCanaryEid")?.valueId, VALUE_ID_2);
    writeFileSync(path, localDocument({
      personLookupCanaryEid: { valueId: VALUE_ID_3, value: "10000002", updatedAt: NOW },
    }), { mode: 0o600 });
    assert.equal(source.read("personLookupCanaryEid")?.valueId, VALUE_ID_2, "the captured snapshot answers");
    assert.equal(source.read("separationsKualiFinalizationCanaryDocumentNumber")?.valueId, VALUE_ID_1);
    const later = createTestDataInputSource(path);
    assert.equal(later.read("personLookupCanaryEid")?.valueId, VALUE_ID_3, "a new start sees the edit");
    assert.equal(later.read("separationsKualiFinalizationCanaryDocumentNumber"), undefined);
  });

  it("refuses a file readable by group or others, a symbolic link, a directory, or an oversized file", () => {
    const root = scratch("hrauto-test-data-mode-");
    const path = writePrivate(root, localDocument(configuredInputs), 0o640);
    assert.throws(() => readTestDataLocalConfig(path), /must be private to its owner \(mode 0600\)/u);
    chmodSync(path, 0o604);
    assert.throws(() => readTestDataLocalConfig(path), /must be private to its owner/u);
    chmodSync(path, 0o600);
    assert.equal(readTestDataLocalConfig(path).state, "valid");

    const linkRoot = scratch("hrauto-test-data-link-");
    mkdirSync(join_m0(linkRoot, "config"));
    symlinkSync(path, join_m0(linkRoot, "config", "test-data.local.json"));
    assert.throws(() => readTestDataLocalConfig(testDataLocalPath(linkRoot)), /must not be a symbolic link/u);

    const directoryRoot = scratch("hrauto-test-data-dir-");
    mkdirSync(join_m0(directoryRoot, "config", "test-data.local.json"), { recursive: true });
    assert.throws(() => readTestDataLocalConfig(testDataLocalPath(directoryRoot)), TestDataLocalConfigError);

    const bigRoot = scratch("hrauto-test-data-big-");
    const padding = "x".repeat(TEST_DATA_LOCAL_MAXIMUM_BYTES);
    const bigPath = writePrivate(bigRoot, localDocument(configuredInputs, { pad: padding }));
    assert.throws(() => readTestDataLocalConfig(bigPath), /exceeds its size bound/u);
  });

  it("refuses duplicate keys, unknown keys, invalid values, and repeated value identities by key only", () => {
    const root = scratch("hrauto-test-data-invalid-");
    const duplicate = `{"schemaVersion":1,"inputs":{"personLookupCanaryEid":{"valueId":"${VALUE_ID_1}","value":"10000001","updatedAt":"${NOW}"},"personLookupCanaryEid":{"valueId":"${VALUE_ID_2}","value":"10000002","updatedAt":"${NOW}"}},"files":{}}\n`;
    const path = writePrivate(root, duplicate);
    assert.throws(() => readTestDataLocalConfig(path), /repeats key personLookupCanaryEid/u);
    assert.throws(() => assertNoDuplicateKeys('{"a":1,"b":{"a":2,"a":3}}', "probe"), /probe repeats key a/u);
    assert.doesNotThrow(() => assertNoDuplicateKeys('{"a":{"x":1},"b":{"x":2},"c":[{"x":1},{"x":2}],"d":"x\\"x"}', "probe"));
    assert.throws(() => assertNoDuplicateKeys('{"a":"unterminated', "probe"), /unterminated string/u);
    // Keys are compared decoded: distinct bytes that JSON.parse would fold into ONE key are duplicates.
    assert.throws(() => assertNoDuplicateKeys('{"valueId":1,"value\\u0049d":2}', "probe"), /probe repeats key valueId/u);
    assert.throws(() => assertNoDuplicateKeys('{"a\\"b":1,"a\\u0022b":2}', "probe"), /probe repeats key a"b/u);
    assert.doesNotThrow(() => assertNoDuplicateKeys('{"a\\u0031":1,"a\\u0032":2}', "probe"));
    assert.throws(() => assertNoDuplicateKeys('{"a\\x":1}', "probe"), /invalid key string/u);
    assert.throws(() => assertNoDuplicateKeys('{"a\tb":1}', "probe"), /invalid key string/u);
    const escapedRoot = scratch("hrauto-test-data-escaped-");
    const escaped = writePrivate(escapedRoot, `{"schemaVersion":1,"inputs":{"personLookupCanaryEid":{"valueId":"${VALUE_ID_1}","value":"10000001","updatedAt":"${NOW}"},"personLookup\\u0043anaryEid":{"valueId":"${VALUE_ID_2}","value":"10000002","updatedAt":"${NOW}"}},"files":{}}\n`);
    assert.throws(() => readTestDataLocalConfig(escaped), /repeats key personLookupCanaryEid/u);

    const cases: Array<[string, RegExp, string[]]> = [
      [localDocument({ unknownInput: { valueId: VALUE_ID_1, value: "1", updatedAt: NOW } }), /is invalid at inputs\.unknownInput/u, []],
      [localDocument({ personLookupCanaryEid: { valueId: VALUE_ID_1, value: "not-an-eid-77", updatedAt: NOW } }), /is invalid at inputs\.personLookupCanaryEid\.value/u, ["not-an-eid-77"]],
      [localDocument({ separationsKualiFinalizationCanaryDocumentNumber: { valueId: VALUE_ID_1, value: "123456789", updatedAt: NOW } }), /inputs\.separationsKualiFinalizationCanaryDocumentNumber\.value/u, ["123456789"]],
      [localDocument({ personLookupCanaryEid: { valueId: VALUE_ID_1, value: "10000001", updatedAt: NOW, extra: 1 } }), /inputs\.personLookupCanaryEid\.extra/u, []],
      [localDocument({
        personLookupCanaryEid: { valueId: VALUE_ID_1, value: "10000001", updatedAt: NOW },
        separationsKualiFinalizationCanaryDocumentNumber: { valueId: VALUE_ID_1, value: "4000001", updatedAt: NOW },
      }), /is invalid at inputs/u, []],
      [`${JSON.stringify({ schemaVersion: 2, inputs: {}, files: {} })}\n`, /is invalid at schemaVersion/u, []],
      ["{not json\n", /is not valid JSON/u, []],
      [localDocument({}, { bad: "../../../../../escape.pdf" }), /is invalid at files\.bad/u, []],
    ];
    for (const [body, pattern, secrets] of cases) {
      const caseRoot = scratch("hrauto-test-data-case-");
      const casePath = writePrivate(caseRoot, body);
      assert.throws(() => readTestDataLocalConfig(casePath), (error: unknown) => {
        assert.equal((error as Error).name, "TestDataLocalConfigError");
        assert.match((error as Error).message, pattern);
        for (const secret of secrets) assert.equal((error as Error).message.includes(secret), false, secret);
        return true;
      }, body);
      // A captured source surfaces the same refusal on its first read, by key only.
      assert.throws(() => createTestDataInputSource(casePath).read("personLookupCanaryEid"), TestDataLocalConfigError);
    }
  });

  it("builds a synthetic source from a parsed document and refuses an invalid one", () => {
    const source = testDataInputSourceFrom({ schemaVersion: 1, inputs: configuredInputs, files: {} });
    assert.equal(source.read("separationsKualiFinalizationCanaryDocumentNumber")?.value, SYNTHETIC_DOCUMENT);
    assert.throws(() => testDataInputSourceFrom({ schemaVersion: 1, inputs: { personLookupCanaryEid: { valueId: VALUE_ID_1, value: "x", updatedAt: NOW } }, files: {} }));
    assert.equal(TestDataLocalConfigSchema.safeParse({ schemaVersion: 1, inputs: {}, files: {} }).success, true);
  });
});

describe("private merge planner and writer", () => {
afterEach(_afterEachFixture0);

  const candidates = [
    { name: "separationsKualiFinalizationCanaryDocumentNumber" as const, valueId: VALUE_ID_1, value: SYNTHETIC_DOCUMENT, updatedAt: NOW },
    { name: "personLookupCanaryEid" as const, valueId: VALUE_ID_2, value: SYNTHETIC_EID, updatedAt: NOW },
  ];

  it("creates a missing destination, adds to an existing one, and is idempotent on equal entries", () => {
    const absent = { state: "absent" as const, path: "/synthetic/config/test-data.local.json" };
    const create = planTestDataLocalMerge(absent, candidates);
    assert.equal(create.action, "create");
    assert.deepEqual(create.dispositions.map(({ disposition }) => disposition), ["create", "create"]);
    assert.deepEqual(create.next?.inputs, configuredInputs);

    const partial = readOutcome(localDocument({ personLookupCanaryEid: configuredInputs.personLookupCanaryEid }));
    const add = planTestDataLocalMerge(partial, candidates);
    assert.equal(add.action, "update");
    assert.deepEqual(add.dispositions, [
      { name: "separationsKualiFinalizationCanaryDocumentNumber", disposition: "add" },
      { name: "personLookupCanaryEid", disposition: "equal" },
    ]);

    const equal = planTestDataLocalMerge(readOutcome(localDocument(configuredInputs, { keep: "private/keep.pdf" })), candidates);
    assert.equal(equal.action, "unchanged");
    assert.equal(equal.next, undefined);
    assert.deepEqual(planTestDataLocalMerge(absent, []).action, "none");
  });

  it("stops on a different value or identity for the same name without composing a document", () => {
    const differentValue = readOutcome(localDocument({
      personLookupCanaryEid: { valueId: VALUE_ID_2, value: "10000002", updatedAt: NOW },
    }));
    const plan = planTestDataLocalMerge(differentValue, candidates);
    assert.equal(plan.action, "none");
    assert.equal(plan.next, undefined);
    assert.deepEqual(plan.dispositions, [
      { name: "separationsKualiFinalizationCanaryDocumentNumber", disposition: "add" },
      { name: "personLookupCanaryEid", disposition: "conflict" },
    ]);
    const differentIdentity = readOutcome(localDocument({
      personLookupCanaryEid: { valueId: VALUE_ID_3, value: SYNTHETIC_EID, updatedAt: NOW },
    }));
    assert.equal(planTestDataLocalMerge(differentIdentity, candidates).dispositions[1]?.disposition, "conflict");
  });

  it("writes a private 0600 file atomically, verifies readback, and cleans its staging file", () => {
    const root = scratch("hrauto-test-data-write-");
    mkdirSync(join_m0(root, "config"));
    const path = testDataLocalPath(root);
    const prior = readTestDataLocalConfig(path);
    const next = TestDataLocalConfigSchema.parse({ schemaVersion: 1, inputs: configuredInputs, files: {} });
    writeTestDataLocalConfig(path, next, prior);
    const written = readTestDataLocalConfig(path);
    assert.equal(written.state, "valid");
    if (written.state !== "valid") throw new Error("expected the written file");
    assert.deepEqual(written.config, next);
    assert.deepEqual(readdirSync(join_m0(root, "config")), ["test-data.local.json"], "no staging residue");

    writeTestDataLocalConfig(path, next, written);
    assert.throws(
      () => writeTestDataLocalConfig(path, next, prior),
      /changed before it could be replaced/u,
    );
    assert.deepEqual(readTestDataLocalConfig(path), written);
    assert.deepEqual(readdirSync(join_m0(root, "config")), ["test-data.local.json"]);
  });

  it("refuses to replace a destination that changed under it and removes its staging file", () => {
    const root = scratch("hrauto-test-data-race-");
    const path = writePrivate(root, localDocument({ personLookupCanaryEid: configuredInputs.personLookupCanaryEid }));
    const prior = readTestDataLocalConfig(path);
    const next = TestDataLocalConfigSchema.parse({ schemaVersion: 1, inputs: configuredInputs, files: {} });
    const racing: TestDataLocalWriteAccess = {
      open: openSync,
      inspect: fstatSync,
      read: (descriptor) => readFileSync(descriptor),
      close: closeSync,
      writeExclusive: (target, bytes, mode) => {
        writeFileSync(target, bytes, { mode, flag: "wx" });
        // Another writer replaces the destination between staging and rename.
        writeFileSync(path, localDocument({
          personLookupCanaryEid: { valueId: VALUE_ID_3, value: "10000002", updatedAt: NOW },
        }), { mode: 0o600 });
      },
      syncPath: () => undefined,
      rename: () => { throw new Error("rename must not run after the destination changed"); },
      remove: (target) => { rmSync(target, { force: true }); },
      randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    assert.throws(() => writeTestDataLocalConfig(path, next, prior, racing), /changed before it could be replaced/u);
    assert.deepEqual(readdirSync(join_m0(root, "config")), ["test-data.local.json"]);
    const after = readTestDataLocalConfig(path);
    assert.equal(after.state === "valid" && after.config.inputs.personLookupCanaryEid?.valueId, VALUE_ID_3, "the other writer's file survives");
  });

  it("refuses an oversized document before staging anything", () => {
    const root = scratch("hrauto-test-data-bound-");
    mkdirSync(join_m0(root, "config"));
    const path = testDataLocalPath(root);
    const next = TestDataLocalConfigSchema.parse({ schemaVersion: 1, inputs: {},
      files: Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`pad${String(index)}`, "p".repeat(1000)])) });
    assert.throws(() => writeTestDataLocalConfig(path, next, { state: "absent", path }), /would exceed its size bound/u);
    assert.deepEqual(readdirSync(join_m0(root, "config")), []);
  });
});

function readOutcome(body: string) {
  const root = scratch("hrauto-test-data-outcome-");
  return readTestDataLocalConfig(writePrivate(root, body));
}
}

{

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
const _afterEachFixture0 = () => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); };

function checkout(): string {
  const root = mkdtempSync(join_m0(tmpdir(), "hr-test-data-command-"));
  roots.push(root);
  mkdirSync(join_m0(root, "config"), { mode: 0o755 });
  mkdirSync(join_m0(root, "tests", "support", "fixtures", "documents"), { recursive: true });
  cpSync(join_m0(REPO_ROOT, "config", "test-data.json"), join_m0(root, "config", "test-data.json"));
  cpSync(join_m0(REPO_ROOT, "tests", "support", "fixtures", "documents", "synthetic-sample.pdf"), join_m0(root, "tests", "support", "fixtures", "documents", "synthetic-sample.pdf"));
  mkdirSync(join_m0(root, rebuildRuntimeIsolation.stateRoot), { mode: 0o700, recursive: true });
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
afterEach(_afterEachFixture0);

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
    assert.equal(existsSync(join_m0(root, rebuildRuntimeIsolation.stateRoot, "credentials")), false, "no credential store was created");
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

    writeFileSync(join_m0(root, "config", "test-data.json"), "{\n");
    const corrupt = await run(root, ["check", "--json"]);
    assert.equal(corrupt.exitCode, 2);
    assert.deepEqual(Object.keys(corrupt.report).sort(), ["command", "shared", "status"]);
    assert.equal((corrupt.report.shared as { state: string }).state, "invalid");
  });
});
}
