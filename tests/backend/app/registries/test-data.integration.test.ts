
import assert_m0 from "node:assert/strict";
import { spawnSync as spawnSync_m0 } from "node:child_process";
import {
chmodSync as chmodSync_m0,
closeSync as closeSync_m0,
cpSync as cpSync_m0,
existsSync as existsSync_m0,
fstatSync as fstatSync_m0,
mkdirSync as mkdirSync_m0,
mkdtempSync as mkdtempSync_m0,
openSync as openSync_m0,
readdirSync as readdirSync_m0,
readFileSync as readFileSync_m0,
realpathSync as realpathSync_m0,
rmSync as rmSync_m0,
symlinkSync as symlinkSync_m0,
writeFileSync as writeFileSync_m0
} from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { dirname as dirname_m0,join as join_m0,relative as relative_m0 } from "node:path";
import { pathToFileURL as pathToFileURL_m0 } from "node:url";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0 } from "vitest";
import {
absentTestDataInputSource as absentTestDataInputSource_m0,
assertNoDuplicateKeys as assertNoDuplicateKeys_m0,
createTestDataInputSource as createTestDataInputSource_m0,
parseTestDataSharedConfig as parseTestDataSharedConfig_m0,
planTestDataLocalMerge as planTestDataLocalMerge_m0,
readTestDataFileBytes as readTestDataFileBytes_m0,
readTestDataLocalConfig as readTestDataLocalConfig_m0,
readTestDataShared as readTestDataShared_m0,
TEST_DATA as TEST_DATA_m0,
testDataFile as testDataFile_m0,
testDataInputSourceFrom as testDataInputSourceFrom_m0,
testDataLocalFilePath as testDataLocalFilePath_m0,
testDataLocalPath as testDataLocalPath_m0,
testDataLocalPresence as testDataLocalPresence_m0,
testDataSamples as testDataSamples_m0,
writeTestDataLocalConfig as writeTestDataLocalConfig_m0,
type TestDataLocalWriteAccess as TestDataLocalWriteAccess_m0
} from "../../../../src/backend/app/registries/test-data.js";
import { TEST_TARGET_REGISTRY as TEST_TARGET_REGISTRY_m0 } from "../../../../src/backend/app/registries/test-target-registry.js";
import {
TEST_DATA_CONFIG_PATH as TEST_DATA_CONFIG_PATH_m0,
TEST_DATA_INPUT_NAMES as TEST_DATA_INPUT_NAMES_m0,
TEST_DATA_LOCAL_CONFIG_PATH as TEST_DATA_LOCAL_CONFIG_PATH_m0,
TEST_DATA_LOCAL_MAXIMUM_BYTES as TEST_DATA_LOCAL_MAXIMUM_BYTES_m0,
TestDataConfigError as TestDataConfigError_m0,
TestDataLocalConfigError as TestDataLocalConfigError_m0,
TestDataLocalConfigSchema as TestDataLocalConfigSchema_m0,
TestDataSharedConfigSchema as TestDataSharedConfigSchema_m0
} from "../../../../src/models/config/test-data.js";
import { KualiDocumentNumberSchema as KualiDocumentNumberSchema_m0 } from "../../../../src/models/ui/kuali-document-identity.js";
import { EidSchema as EidSchema_m0 } from "../../../../src/rules/identity/ids.js";

import assert_m1 from "node:assert/strict";
import { chmodSync as chmodSync_m1,cpSync as cpSync_m1,existsSync as existsSync_m1,mkdirSync as mkdirSync_m1,mkdtempSync as mkdtempSync_m1,rmSync as rmSync_m1,writeFileSync as writeFileSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m1 } from "node:path";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m1 } from "../../../../src/backend/app/config/runtime-isolation.js";


import { testDataLocalPath as testDataLocalPath_m1 } from "../../../../src/backend/app/registries/test-data.js";
import { TEST_DATA_USAGE as TEST_DATA_USAGE_m1 } from "../../../../src/backend/runs/provenance/test-data-usage.js";
import { composeTestDataCommand as composeTestDataCommand_m1,type TestDataComposeDependencies as TestDataComposeDependencies_m1 } from "../../../support/helpers/synthetic-storage-admission.js";


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
  for (const root of roots.splice(0)) rmSync_m0(root, { recursive: true, force: true });
};

function scratch(prefix: string): string {
  const root = mkdtempSync_m0(join_m0(realpathSync_m0(tmpdir_m0()), prefix));
  roots.push(root);
  return root;
}

function localDocument(inputs: Record<string, unknown> = {}, files: Record<string, string> = {}): string {
  return `${JSON.stringify({ schemaVersion: 1, inputs, files }, null, 2)}\n`;
}

function writePrivate(root: string, body: string, mode = 0o600): string {
  mkdirSync_m0(join_m0(root, "config"), { recursive: true });
  const path = join_m0(root, "config", "test-data.local.json");
  writeFileSync_m0(path, body, { mode });
  chmodSync_m0(path, mode);
  return path;
}

const configuredInputs = {
  separationsKualiFinalizationCanaryDocumentNumber: { valueId: VALUE_ID_1, value: SYNTHETIC_DOCUMENT, updatedAt: NOW },
  personLookupCanaryEid: { valueId: VALUE_ID_2, value: SYNTHETIC_EID, updatedAt: NOW },
};

describe_m0("shared test-data config", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("is the tracked, frozen owner of the public subject registry, files and samples", () => {
    assert_m0.equal(TEST_DATA_CONFIG_PATH_m0, "config/test-data.json");
    assert_m0.equal(TEST_DATA_m0.configPath, join_m0(REPO_ROOT, TEST_DATA_CONFIG_PATH_m0));
    assert_m0.equal(realpathSync_m0(TEST_DATA_m0.repoRoot), realpathSync_m0(REPO_ROOT));
    assert_m0.equal(Object.isFrozen(TEST_DATA_m0), true);
    assert_m0.equal(Object.isFrozen(TEST_DATA_m0.samples.eids), true);
    // The registry export and the shared config expose ONE registry.
    assert_m0.deepEqual(TEST_DATA_m0.subjects, TEST_TARGET_REGISTRY_m0);
    assert_m0.equal(existsSync_m0(join_m0(REPO_ROOT, "config", "test-subjects.json")), false, "the old registry file is retired");
    assert_m0.deepEqual(TEST_DATA_m0.files.map(({ name, kind }) => ({ name, kind })), [{ name: "synthetic-sample-pdf", kind: "pdf" }]);
  });

  it_m0("hands out isolated sample copies so one test cannot mutate another's inputs", () => {
    const first = testDataSamples_m0();
    const second = testDataSamples_m0();
    first.eids.push("99999999");
    assert_m0.notDeepEqual(first.eids, second.eids);
    assert_m0.deepEqual(second.eids, [...TEST_DATA_m0.samples.eids]);
    for (const eid of TEST_DATA_m0.samples.eids) assert_m0.equal(EidSchema_m0.safeParse(eid).success, true, eid);
    for (const number of TEST_DATA_m0.samples.kualiDocumentNumbers) assert_m0.equal(KualiDocumentNumberSchema_m0.safeParse(number).success, true, number);
  });

  it_m0("resolves declared file paths against the declaring config file, not the working directory", () => {
    const file = testDataFile_m0(TEST_DATA_m0, "synthetic-sample-pdf");
    assert_m0.equal(file.path, join_m0(dirname_m0(TEST_DATA_m0.configPath), "..", "tests", "support", "fixtures", "documents", "synthetic-sample.pdf").replace("/config/../", "/"));
    assert_m0.equal(relative_m0(REPO_ROOT, file.path), join_m0("tests", "support", "fixtures", "documents", "synthetic-sample.pdf"));
    const { bytes } = readTestDataFileBytes_m0(TEST_DATA_m0, "synthetic-sample-pdf");
    assert_m0.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
    assert_m0.equal(bytes.byteLength > 0, true);
    assert_m0.equal(bytes.includes(Buffer.from("SYNTHETIC TEST DOCUMENT")), true, "the tracked asset is the synthetic document");
    assert_m0.throws(() => testDataFile_m0(TEST_DATA_m0, "no-such-file"), /declares no file named no-such-file/u);
  });

  it_m0("reads the same bytes from a different working directory and from a separate checkout copy", () => {
    // Different CWD: the module resolves from import.meta.url, so a child process
    // started elsewhere reads the identical asset.
    const elsewhere = scratch("hrauto-test-data-cwd-");
    const tsxLoader = pathToFileURL_m0(join_m0(REPO_ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href;
    const child = spawnSync_m0(process.execPath, ["--import", tsxLoader, "--input-type=module", "--eval", `
      import { TEST_DATA, readTestDataFileBytes } from ${JSON.stringify(join_m0(REPO_ROOT, "src", "backend", "app", "registries", "test-data.ts"))};
      const { bytes } = readTestDataFileBytes(TEST_DATA, "synthetic-sample-pdf");
      process.stdout.write(JSON.stringify({ length: bytes.byteLength, head: bytes.subarray(0, 5).toString("latin1") }));
    `], { cwd: elsewhere, encoding: "utf8", env: { ...process.env, TMPDIR: elsewhere } });
    assert_m0.equal(child.status, 0, child.stderr);
    const expected = readTestDataFileBytes_m0(TEST_DATA_m0, "synthetic-sample-pdf").bytes;
    assert_m0.deepEqual(JSON.parse(child.stdout), { length: expected.byteLength, head: "%PDF-" });

    // Separate checkout copy: the declared relative path follows the copied config.
    const copy = scratch("hrauto-test-data-copy-");
    mkdirSync_m0(join_m0(copy, "config"));
    mkdirSync_m0(join_m0(copy, "tests", "support", "fixtures", "documents"), { recursive: true });
    cpSync_m0(join_m0(REPO_ROOT, TEST_DATA_CONFIG_PATH_m0), join_m0(copy, TEST_DATA_CONFIG_PATH_m0));
    cpSync_m0(join_m0(REPO_ROOT, "tests", "support", "fixtures", "documents", "synthetic-sample.pdf"), join_m0(copy, "tests", "support", "fixtures", "documents", "synthetic-sample.pdf"));
    const shared = readTestDataShared_m0(copy, []);
    assert_m0.equal(realpathSync_m0(shared.repoRoot), realpathSync_m0(copy));
    assert_m0.deepEqual(readTestDataFileBytes_m0(shared, "synthetic-sample-pdf").bytes, expected);
  });

  it_m0("refuses a missing, empty, non-PDF, or symlinked-out file by name", () => {
    const root = scratch("hrauto-test-data-files-");
    mkdirSync_m0(join_m0(root, "config"));
    mkdirSync_m0(join_m0(root, "docs"));
    const outside = scratch("hrauto-test-data-outside-");
    writeFileSync_m0(join_m0(outside, "real.pdf"), "%PDF-1.4 outside");
    writeFileSync_m0(join_m0(root, "docs", "empty.pdf"), "");
    writeFileSync_m0(join_m0(root, "docs", "text.pdf"), "not a pdf");
    symlinkSync_m0(join_m0(outside, "real.pdf"), join_m0(root, "docs", "escape.pdf"));
    const config = (path: string) => ({
      schemaVersion: 1,
      subjects: TEST_TARGET_REGISTRY_m0,
      files: { probe: { path, kind: "pdf", purpose: "probe" } },
      samples: TEST_DATA_m0.samples,
    });
    const sharedFor = (path: string) => parseTestDataSharedConfig_m0(config(path), join_m0(root, "config", "test-data.json"), []);
    assert_m0.throws(() => readTestDataFileBytes_m0(sharedFor("../docs/missing.pdf"), "probe"), /probe is missing at its declared path/u);
    assert_m0.throws(() => readTestDataFileBytes_m0(sharedFor("../docs/empty.pdf"), "probe"), /probe is empty/u);
    assert_m0.throws(() => readTestDataFileBytes_m0(sharedFor("../docs/text.pdf"), "probe"), /probe is not a PDF document/u);
    assert_m0.throws(() => readTestDataFileBytes_m0(sharedFor("../docs/escape.pdf"), "probe"), /probe resolves outside the repository/u);
    // A declared path that leaves the repository is a config defect before any read.
    assert_m0.throws(() => sharedFor("../../../../../../elsewhere.pdf"), TestDataConfigError_m0);
    assert_m0.throws(() => sharedFor("/etc/hosts"), TestDataConfigError_m0);
  });

  it_m0("refuses an unknown member, a duplicate sample, or an unregistered subject shape", () => {
    const base = JSON.parse(readFileSync_m0(join_m0(REPO_ROOT, TEST_DATA_CONFIG_PATH_m0), "utf8")) as Record<string, unknown>;
    assert_m0.equal(TestDataSharedConfigSchema_m0.safeParse({ ...base, extra: true }).success, false);
    assert_m0.equal(TestDataSharedConfigSchema_m0.safeParse({ ...base, samples: { ...(base.samples as object), eids: ["10000001", "10000001"] } }).success, false);
    assert_m0.equal(TestDataSharedConfigSchema_m0.safeParse({ ...base, samples: { ...(base.samples as object), eids: ["not-an-eid"] } }).success, false);
    // A malformed subject is the registry's own strict-schema refusal; it never becomes a partial registry.
    assert_m0.throws(
      () => parseTestDataSharedConfig_m0({ ...base, subjects: { schemaVersion: 2, targets: [{ label: "x" }] } }, join_m0(REPO_ROOT, TEST_DATA_CONFIG_PATH_m0), []),
      (error: unknown) => error instanceof Error && !(error instanceof TestDataConfigError_m0),
    );
    assert_m0.throws(
      () => parseTestDataSharedConfig_m0({ ...base, schemaVersion: 2 }, join_m0(REPO_ROOT, TEST_DATA_CONFIG_PATH_m0), []),
      /config\/test-data\.json is malformed/u,
    );
  });
});

describe_m0("private test-data file", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("treats an absent file as a truthful absent state, never a default", () => {
    const root = scratch("hrauto-test-data-absent-");
    const outcome = readTestDataLocalConfig_m0(testDataLocalPath_m0(root));
    assert_m0.deepEqual(outcome, { state: "absent", path: join_m0(root, TEST_DATA_LOCAL_CONFIG_PATH_m0) });
    assert_m0.deepEqual(testDataLocalPresence_m0(outcome), {
      state: "absent",
      inputs: TEST_DATA_INPUT_NAMES_m0.map((name) => ({ name, present: false })),
      files: [],
    });
    assert_m0.equal(createTestDataInputSource_m0(testDataLocalPath_m0(root)).read("personLookupCanaryEid"), undefined);
    assert_m0.equal(absentTestDataInputSource_m0().read("personLookupCanaryEid"), undefined);
    assert_m0.throws(() => testDataLocalPath_m0("relative/root"), /must be absolute/u);
    assert_m0.throws(() => readTestDataLocalConfig_m0("relative/path.json"), /must be absolute/u);
  });

  it_m0("reads a private 0600 file, exposes presence without values, and resolves private file paths", () => {
    const root = scratch("hrauto-test-data-valid-");
    const path = writePrivate(root, localDocument(configuredInputs, { "private-sample": "private/sample.pdf", absolute: "/elsewhere/doc.pdf" }));
    const outcome = readTestDataLocalConfig_m0(path);
    assert_m0.equal(outcome.state, "valid");
    if (outcome.state !== "valid") throw new Error("expected a valid private file");
    assert_m0.equal(Object.isFrozen(outcome.config.inputs), true);
    const presence = testDataLocalPresence_m0(outcome);
    assert_m0.deepEqual(presence, {
      state: "valid",
      inputs: [
        { name: "separationsKualiFinalizationCanaryDocumentNumber", present: true },
        { name: "personLookupCanaryEid", present: true },
      ],
      files: ["absolute", "private-sample"],
    });
    assert_m0.equal(JSON.stringify(presence).includes(SYNTHETIC_DOCUMENT), false);
    assert_m0.equal(JSON.stringify(presence).includes(SYNTHETIC_EID), false);
    assert_m0.equal(testDataLocalFilePath_m0(outcome, "private-sample"), join_m0(root, "config", "private", "sample.pdf"));
    assert_m0.equal(testDataLocalFilePath_m0(outcome, "absolute"), "/elsewhere/doc.pdf");
    assert_m0.equal(testDataLocalFilePath_m0(outcome, "unknown"), undefined);
  });

  it_m0("captures the file once per source so a later edit affects only later starts", () => {
    const root = scratch("hrauto-test-data-capture-");
    const path = writePrivate(root, localDocument(configuredInputs));
    const source = createTestDataInputSource_m0(path);
    assert_m0.equal(source.read("personLookupCanaryEid")?.valueId, VALUE_ID_2);
    writeFileSync_m0(path, localDocument({
      personLookupCanaryEid: { valueId: VALUE_ID_3, value: "10000002", updatedAt: NOW },
    }), { mode: 0o600 });
    assert_m0.equal(source.read("personLookupCanaryEid")?.valueId, VALUE_ID_2, "the captured snapshot answers");
    assert_m0.equal(source.read("separationsKualiFinalizationCanaryDocumentNumber")?.valueId, VALUE_ID_1);
    const later = createTestDataInputSource_m0(path);
    assert_m0.equal(later.read("personLookupCanaryEid")?.valueId, VALUE_ID_3, "a new start sees the edit");
    assert_m0.equal(later.read("separationsKualiFinalizationCanaryDocumentNumber"), undefined);
  });

  it_m0("refuses a file readable by group or others, a symbolic link, a directory, or an oversized file", () => {
    const root = scratch("hrauto-test-data-mode-");
    const path = writePrivate(root, localDocument(configuredInputs), 0o640);
    assert_m0.throws(() => readTestDataLocalConfig_m0(path), /must be private to its owner \(mode 0600\)/u);
    chmodSync_m0(path, 0o604);
    assert_m0.throws(() => readTestDataLocalConfig_m0(path), /must be private to its owner/u);
    chmodSync_m0(path, 0o600);
    assert_m0.equal(readTestDataLocalConfig_m0(path).state, "valid");

    const linkRoot = scratch("hrauto-test-data-link-");
    mkdirSync_m0(join_m0(linkRoot, "config"));
    symlinkSync_m0(path, join_m0(linkRoot, "config", "test-data.local.json"));
    assert_m0.throws(() => readTestDataLocalConfig_m0(testDataLocalPath_m0(linkRoot)), /must not be a symbolic link/u);

    const directoryRoot = scratch("hrauto-test-data-dir-");
    mkdirSync_m0(join_m0(directoryRoot, "config", "test-data.local.json"), { recursive: true });
    assert_m0.throws(() => readTestDataLocalConfig_m0(testDataLocalPath_m0(directoryRoot)), TestDataLocalConfigError_m0);

    const bigRoot = scratch("hrauto-test-data-big-");
    const padding = "x".repeat(TEST_DATA_LOCAL_MAXIMUM_BYTES_m0);
    const bigPath = writePrivate(bigRoot, localDocument(configuredInputs, { pad: padding }));
    assert_m0.throws(() => readTestDataLocalConfig_m0(bigPath), /exceeds its size bound/u);
  });

  it_m0("refuses duplicate keys, unknown keys, invalid values, and repeated value identities by key only", () => {
    const root = scratch("hrauto-test-data-invalid-");
    const duplicate = `{"schemaVersion":1,"inputs":{"personLookupCanaryEid":{"valueId":"${VALUE_ID_1}","value":"10000001","updatedAt":"${NOW}"},"personLookupCanaryEid":{"valueId":"${VALUE_ID_2}","value":"10000002","updatedAt":"${NOW}"}},"files":{}}\n`;
    const path = writePrivate(root, duplicate);
    assert_m0.throws(() => readTestDataLocalConfig_m0(path), /repeats key personLookupCanaryEid/u);
    assert_m0.throws(() => assertNoDuplicateKeys_m0('{"a":1,"b":{"a":2,"a":3}}', "probe"), /probe repeats key a/u);
    assert_m0.doesNotThrow(() => assertNoDuplicateKeys_m0('{"a":{"x":1},"b":{"x":2},"c":[{"x":1},{"x":2}],"d":"x\\"x"}', "probe"));
    assert_m0.throws(() => assertNoDuplicateKeys_m0('{"a":"unterminated', "probe"), /unterminated string/u);
    // Keys are compared decoded: distinct bytes that JSON.parse would fold into ONE key are duplicates.
    assert_m0.throws(() => assertNoDuplicateKeys_m0('{"valueId":1,"value\\u0049d":2}', "probe"), /probe repeats key valueId/u);
    assert_m0.throws(() => assertNoDuplicateKeys_m0('{"a\\"b":1,"a\\u0022b":2}', "probe"), /probe repeats key a"b/u);
    assert_m0.doesNotThrow(() => assertNoDuplicateKeys_m0('{"a\\u0031":1,"a\\u0032":2}', "probe"));
    assert_m0.throws(() => assertNoDuplicateKeys_m0('{"a\\x":1}', "probe"), /invalid key string/u);
    assert_m0.throws(() => assertNoDuplicateKeys_m0('{"a\tb":1}', "probe"), /invalid key string/u);
    const escapedRoot = scratch("hrauto-test-data-escaped-");
    const escaped = writePrivate(escapedRoot, `{"schemaVersion":1,"inputs":{"personLookupCanaryEid":{"valueId":"${VALUE_ID_1}","value":"10000001","updatedAt":"${NOW}"},"personLookup\\u0043anaryEid":{"valueId":"${VALUE_ID_2}","value":"10000002","updatedAt":"${NOW}"}},"files":{}}\n`);
    assert_m0.throws(() => readTestDataLocalConfig_m0(escaped), /repeats key personLookupCanaryEid/u);

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
      assert_m0.throws(() => readTestDataLocalConfig_m0(casePath), (error: unknown) => {
        assert_m0.equal((error as Error).name, "TestDataLocalConfigError");
        assert_m0.match((error as Error).message, pattern);
        for (const secret of secrets) assert_m0.equal((error as Error).message.includes(secret), false, secret);
        return true;
      }, body);
      // A captured source surfaces the same refusal on its first read, by key only.
      assert_m0.throws(() => createTestDataInputSource_m0(casePath).read("personLookupCanaryEid"), TestDataLocalConfigError_m0);
    }
  });

  it_m0("builds a synthetic source from a parsed document and refuses an invalid one", () => {
    const source = testDataInputSourceFrom_m0({ schemaVersion: 1, inputs: configuredInputs, files: {} });
    assert_m0.equal(source.read("separationsKualiFinalizationCanaryDocumentNumber")?.value, SYNTHETIC_DOCUMENT);
    assert_m0.throws(() => testDataInputSourceFrom_m0({ schemaVersion: 1, inputs: { personLookupCanaryEid: { valueId: VALUE_ID_1, value: "x", updatedAt: NOW } }, files: {} }));
    assert_m0.equal(TestDataLocalConfigSchema_m0.safeParse({ schemaVersion: 1, inputs: {}, files: {} }).success, true);
  });
});

describe_m0("private merge planner and writer", () => {
afterEach_m0(_afterEachFixture0);

  const candidates = [
    { name: "separationsKualiFinalizationCanaryDocumentNumber" as const, valueId: VALUE_ID_1, value: SYNTHETIC_DOCUMENT, updatedAt: NOW },
    { name: "personLookupCanaryEid" as const, valueId: VALUE_ID_2, value: SYNTHETIC_EID, updatedAt: NOW },
  ];

  it_m0("creates a missing destination, adds to an existing one, and is idempotent on equal entries", () => {
    const absent = { state: "absent" as const, path: "/synthetic/config/test-data.local.json" };
    const create = planTestDataLocalMerge_m0(absent, candidates);
    assert_m0.equal(create.action, "create");
    assert_m0.deepEqual(create.dispositions.map(({ disposition }) => disposition), ["create", "create"]);
    assert_m0.deepEqual(create.next?.inputs, configuredInputs);

    const partial = readOutcome(localDocument({ personLookupCanaryEid: configuredInputs.personLookupCanaryEid }));
    const add = planTestDataLocalMerge_m0(partial, candidates);
    assert_m0.equal(add.action, "update");
    assert_m0.deepEqual(add.dispositions, [
      { name: "separationsKualiFinalizationCanaryDocumentNumber", disposition: "add" },
      { name: "personLookupCanaryEid", disposition: "equal" },
    ]);

    const equal = planTestDataLocalMerge_m0(readOutcome(localDocument(configuredInputs, { keep: "private/keep.pdf" })), candidates);
    assert_m0.equal(equal.action, "unchanged");
    assert_m0.equal(equal.next, undefined);
    assert_m0.deepEqual(planTestDataLocalMerge_m0(absent, []).action, "none");
  });

  it_m0("stops on a different value or identity for the same name without composing a document", () => {
    const differentValue = readOutcome(localDocument({
      personLookupCanaryEid: { valueId: VALUE_ID_2, value: "10000002", updatedAt: NOW },
    }));
    const plan = planTestDataLocalMerge_m0(differentValue, candidates);
    assert_m0.equal(plan.action, "none");
    assert_m0.equal(plan.next, undefined);
    assert_m0.deepEqual(plan.dispositions, [
      { name: "separationsKualiFinalizationCanaryDocumentNumber", disposition: "add" },
      { name: "personLookupCanaryEid", disposition: "conflict" },
    ]);
    const differentIdentity = readOutcome(localDocument({
      personLookupCanaryEid: { valueId: VALUE_ID_3, value: SYNTHETIC_EID, updatedAt: NOW },
    }));
    assert_m0.equal(planTestDataLocalMerge_m0(differentIdentity, candidates).dispositions[1]?.disposition, "conflict");
  });

  it_m0("writes a private 0600 file atomically, verifies readback, and cleans its staging file", () => {
    const root = scratch("hrauto-test-data-write-");
    mkdirSync_m0(join_m0(root, "config"));
    const path = testDataLocalPath_m0(root);
    const prior = readTestDataLocalConfig_m0(path);
    const next = TestDataLocalConfigSchema_m0.parse({ schemaVersion: 1, inputs: configuredInputs, files: {} });
    writeTestDataLocalConfig_m0(path, next, prior);
    const written = readTestDataLocalConfig_m0(path);
    assert_m0.equal(written.state, "valid");
    if (written.state !== "valid") throw new Error("expected the written file");
    assert_m0.deepEqual(written.config, next);
    assert_m0.deepEqual(readdirSync_m0(join_m0(root, "config")), ["test-data.local.json"], "no staging residue");

    writeTestDataLocalConfig_m0(path, next, written);
    assert_m0.throws(
      () => writeTestDataLocalConfig_m0(path, next, prior),
      /changed before it could be replaced/u,
    );
    assert_m0.deepEqual(readTestDataLocalConfig_m0(path), written);
    assert_m0.deepEqual(readdirSync_m0(join_m0(root, "config")), ["test-data.local.json"]);
  });

  it_m0("refuses to replace a destination that changed under it and removes its staging file", () => {
    const root = scratch("hrauto-test-data-race-");
    const path = writePrivate(root, localDocument({ personLookupCanaryEid: configuredInputs.personLookupCanaryEid }));
    const prior = readTestDataLocalConfig_m0(path);
    const next = TestDataLocalConfigSchema_m0.parse({ schemaVersion: 1, inputs: configuredInputs, files: {} });
    const racing: TestDataLocalWriteAccess_m0 = {
      open: openSync_m0,
      inspect: fstatSync_m0,
      read: (descriptor) => readFileSync_m0(descriptor),
      close: closeSync_m0,
      writeExclusive: (target, bytes, mode) => {
        writeFileSync_m0(target, bytes, { mode, flag: "wx" });
        // Another writer replaces the destination between staging and rename.
        writeFileSync_m0(path, localDocument({
          personLookupCanaryEid: { valueId: VALUE_ID_3, value: "10000002", updatedAt: NOW },
        }), { mode: 0o600 });
      },
      syncPath: () => undefined,
      rename: () => { throw new Error("rename must not run after the destination changed"); },
      remove: (target) => { rmSync_m0(target, { force: true }); },
      randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    assert_m0.throws(() => writeTestDataLocalConfig_m0(path, next, prior, racing), /changed before it could be replaced/u);
    assert_m0.deepEqual(readdirSync_m0(join_m0(root, "config")), ["test-data.local.json"]);
    const after = readTestDataLocalConfig_m0(path);
    assert_m0.equal(after.state === "valid" && after.config.inputs.personLookupCanaryEid?.valueId, VALUE_ID_3, "the other writer's file survives");
  });

  it_m0("refuses an oversized document before staging anything", () => {
    const root = scratch("hrauto-test-data-bound-");
    mkdirSync_m0(join_m0(root, "config"));
    const path = testDataLocalPath_m0(root);
    const next = TestDataLocalConfigSchema_m0.parse({ schemaVersion: 1, inputs: {},
      files: Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`pad${String(index)}`, "p".repeat(1000)])) });
    assert_m0.throws(() => writeTestDataLocalConfig_m0(path, next, { state: "absent", path }), /would exceed its size bound/u);
    assert_m0.deepEqual(readdirSync_m0(join_m0(root, "config")), []);
  });
});

function readOutcome(body: string) {
  const root = scratch("hrauto-test-data-outcome-");
  return readTestDataLocalConfig_m0(writePrivate(root, body));
}
}

{


const REPO_ROOT = process.cwd();
const VALUE_EID = "d0000000-0000-4000-8000-000000000002";
const SYNTHETIC_DOCUMENT = "4000001";
const SYNTHETIC_EID = "10000001";
const NOW = "2026-09-06T12:00:00.000Z";
const MANIFESTS: TestDataComposeDependencies_m1["loadManifests"] = async () => [
  { workflow: "separations", cases: [{ subjectLabel: "finalization-canary", subjectKind: "full-chain-dry-run" }] },
  { workflow: "person-lookup", cases: [{ subjectLabel: "person-lookup-canary", subjectKind: "search-by-eid" }] },
];
const roots: string[] = [];
const _afterEachFixture0 = () => { for (const root of roots.splice(0)) rmSync_m1(root, { recursive: true, force: true }); };

function checkout(): string {
  const root = mkdtempSync_m1(join_m1(tmpdir_m1(), "hr-test-data-command-"));
  roots.push(root);
  mkdirSync_m1(join_m1(root, "config"), { mode: 0o755 });
  mkdirSync_m1(join_m1(root, "tests", "support", "fixtures", "documents"), { recursive: true });
  cpSync_m1(join_m1(REPO_ROOT, "config", "test-data.json"), join_m1(root, "config", "test-data.json"));
  cpSync_m1(join_m1(REPO_ROOT, "tests", "support", "fixtures", "documents", "synthetic-sample.pdf"), join_m1(root, "tests", "support", "fixtures", "documents", "synthetic-sample.pdf"));
  mkdirSync_m1(join_m1(root, rebuildRuntimeIsolation_m1.stateRoot), { mode: 0o700, recursive: true });
  return root;
}

async function run(root: string, args: readonly string[]) {
  const outcome = await composeTestDataCommand_m1(rebuildRuntimeIsolation_m1, args, root, { loadManifests: MANIFESTS, now: () => new Date("2026-09-07T09:00:00.000Z") });
  assert_m1.equal(outcome.output.endsWith("\n"), true);
  return { exitCode: outcome.exitCode, report: JSON.parse(outcome.output) as Record<string, unknown> & { status: string } };
}

function noValues(report: unknown): void {
  const text = JSON.stringify(report);
  assert_m1.equal(text.includes(SYNTHETIC_DOCUMENT), false, "document number leaked");
  assert_m1.equal(text.includes(SYNTHETIC_EID), false, "EID leaked");
}

describe_m1("cli test-data", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("refuses unknown or incomplete options with exit 2 before any work, naming the usage", async () => {
    const root = checkout();
    const cases: readonly (readonly string[])[] = [
      [], ["frobnicate", "--json"], ["check"], ["check", "--json", "--bogus"], ["check", "--json", "--subject"],
      ["check", "--json", "--workflow", "person-lookup"], ["check", "--json", "--subject", "a", "--subject", "b"],
      ["migrate", "--json"], ["migrate", "--from-credentials"], ["migrate", "--from-credentials", "--json", "--force"],
      ["migrate", "--from-credentials", "--json", "--from-credentials=yes"],
    ];
    for (const args of cases) {
      const { exitCode, report } = await run(root, args);
      assert_m1.equal(exitCode, 2, `args ${args.join(" ")}`);
      assert_m1.equal(report.status, "defect");
      assert_m1.equal(typeof report.reason, "string");
    }
    const usage = await run(root, ["nope"]);
    for (const line of TEST_DATA_USAGE_m1) assert_m1.equal(String(usage.report.reason).includes(line), true);
    assert_m1.equal(existsSync_m1(join_m1(root, rebuildRuntimeIsolation_m1.stateRoot, "credentials")), false, "no credential store was created");
    assert_m1.equal(existsSync_m1(testDataLocalPath_m1(root)), false);
  });

  it_m1("check reports shared subjects, files and samples with the private file absent, and names blocked inputs only", async () => {
    const root = checkout();
    const plain = await run(root, ["check", "--json"]);
    assert_m1.equal(plain.exitCode, 0);
    assert_m1.equal(plain.report.status, "ok");
    const shared = plain.report.shared as { subjects: { label: string; workflows: string[] }[]; files: { name: string; state: string }[]; samples: Record<string, number> };
    assert_m1.deepEqual(shared.subjects.map(({ label, workflows }) => ({ label, workflows })), [
      { label: "finalization-canary", workflows: ["separations", "separations-kuali-finalization"] },
      { label: "person-lookup-canary", workflows: ["person-lookup"] },
    ]);
    assert_m1.deepEqual(shared.files, [{ name: "synthetic-sample-pdf", kind: "pdf", state: "readable" }]);
    assert_m1.equal(shared.samples.eids > 0 && shared.samples.kualiDocumentNumbers > 0 && shared.samples.timekeeperNames > 0, true);
    assert_m1.deepEqual(plain.report.local, { path: "config/test-data.local.json", state: "absent", files: [], inputs: [
      { name: "separationsKualiFinalizationCanaryDocumentNumber", present: false }, { name: "personLookupCanaryEid", present: false }] });

    const blocked = await run(root, ["check", "--json", "--subject", "person-lookup-canary"]);
    assert_m1.equal(blocked.exitCode, 1);
    assert_m1.equal(blocked.report.status, "blocked");
    assert_m1.deepEqual(blocked.report.subjects, [{ label: "person-lookup-canary", workflow: "person-lookup", state: "blocked",
      reason: "blocked: needs person-lookup-canary; its UCPath employee id is not configured — set personLookupCanaryEid in config/test-data.local.json" }]);

    const unknown = await run(root, ["check", "--json", "--subject", "nobody"]);
    assert_m1.equal(unknown.exitCode, 1);
    assert_m1.deepEqual(unknown.report.subjects, [{ label: "nobody", workflow: "*", state: "blocked", reason: "blocked: needs nobody; no such subject" }]);

    const file = await run(root, ["check", "--json", "--file", "synthetic-sample-pdf"]);
    assert_m1.equal(file.exitCode, 0);
    assert_m1.deepEqual(file.report.file, { name: "synthetic-sample-pdf", source: "shared", state: "readable" });
    const missingFile = await run(root, ["check", "--json", "--file", "nothing"]);
    assert_m1.equal(missingFile.exitCode, 1);
    assert_m1.deepEqual(missingFile.report.file, { name: "nothing", source: "local", state: "not-declared",
      reason: "no file named nothing in config/test-data.json or config/test-data.local.json" });
  });

  it_m1("check reads a valid private file by name only, and a corrupt shared or private file is a named defect", async () => {
    const root = checkout();
    writeFileSync_m1(testDataLocalPath_m1(root), `${JSON.stringify({ schemaVersion: 1, inputs: {
      personLookupCanaryEid: { valueId: VALUE_EID, value: SYNTHETIC_EID, updatedAt: NOW },
    }, files: {} })}\n`, { mode: 0o600 });
    const ready = await run(root, ["check", "--json", "--subject", "person-lookup-canary", "--workflow", "person-lookup"]);
    noValues(ready.report);
    assert_m1.equal(ready.exitCode, 0);
    assert_m1.equal(ready.report.status, "ok");
    assert_m1.deepEqual(ready.report.local, { path: "config/test-data.local.json", state: "valid", files: [], inputs: [
      { name: "separationsKualiFinalizationCanaryDocumentNumber", present: false }, { name: "personLookupCanaryEid", present: true }] });
    assert_m1.deepEqual(ready.report.subjects, [{ label: "person-lookup-canary", workflow: "person-lookup", state: "ready" }]);

    // Every declared arm is reported: the standalone finalization arm stays a blocked manifest witness by design.
    const otherArm = await run(root, ["check", "--json", "--subject", "finalization-canary"]);
    assert_m1.equal(otherArm.exitCode, 1);
    const arms = otherArm.report.subjects as { workflow: string; state: string; reason?: string }[];
    assert_m1.deepEqual(arms.map(({ workflow, state }) => ({ workflow, state })), [
      { workflow: "separations", state: "blocked" }, { workflow: "separations-kuali-finalization", state: "blocked" }]);
    assert_m1.equal(arms[0]?.reason, "blocked: needs finalization-canary; its Kuali document number is not configured — set separationsKualiFinalizationCanaryDocumentNumber in config/test-data.local.json");

    chmodSync_m1(testDataLocalPath_m1(root), 0o644);
    const loose = await run(root, ["check", "--json", "--subject", "person-lookup-canary"]);
    noValues(loose.report);
    assert_m1.equal(loose.exitCode, 2);
    assert_m1.equal(loose.report.status, "defect");
    assert_m1.equal((loose.report.local as { state: string }).state, "invalid");
    assert_m1.match((loose.report.local as { reason: string }).reason, /config\/test-data\.local\.json/u);
    assert_m1.equal((loose.report.subjects as { state: string }[])[0]?.state, "defect");

    writeFileSync_m1(join_m1(root, "config", "test-data.json"), "{\n");
    const corrupt = await run(root, ["check", "--json"]);
    assert_m1.equal(corrupt.exitCode, 2);
    assert_m1.deepEqual(Object.keys(corrupt.report).sort(), ["command", "shared", "status"]);
    assert_m1.equal((corrupt.report.shared as { state: string }).state, "invalid");
  });
});
}
