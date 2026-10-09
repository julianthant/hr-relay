/**
 * D341 P1/P2 — the shared test-data config, the ignored private file, the
 * synthetic PDF consumer, and the private merge planner/writer.
 *
 * Every value here is synthetic. The private-file proofs write only into
 * temporary roots; nothing reads the developer's own `config/test-data.local.json`.
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, it } from "vitest";
import {
  TEST_DATA,
  absentTestDataInputSource,
  assertNoDuplicateKeys,
  createTestDataInputSource,
  parseTestDataSharedConfig,
  planTestDataLocalMerge,
  readTestDataFileBytes,
  readTestDataLocalConfig,
  readTestDataShared,
  testDataFile,
  testDataInputSourceFrom,
  testDataLocalFilePath,
  testDataLocalPath,
  testDataLocalPresence,
  testDataSamples,
  writeTestDataLocalConfig,
  type TestDataLocalWriteAccess,
} from "../../../../../../src/backend/app/registries/test-data.js";
import {
  DeclaredPrivatePathSchema,
  DeclaredRelativePathSchema,
  TEST_DATA_CONFIG_PATH,
  TEST_DATA_INPUT_NAMES,
  TEST_DATA_LOCAL_CONFIG_PATH,
  TEST_DATA_LOCAL_EXAMPLE_PATH,
  TEST_DATA_LOCAL_MAXIMUM_BYTES,
  TestDataConfigError,
  TestDataLocalConfigError,
  TestDataLocalConfigSchema,
  TestDataSharedConfigSchema,
} from "../../../../../../src/models/config/test-data.js";
import { TEST_TARGET_REGISTRY } from "../../../../../../src/backend/app/registries/test-target-registry.js";
import { EidSchema } from "../../../../../../src/rules/identity/ids.js";
import { KualiDocumentNumberSchema } from "../../../../../../src/models/ui/kuali-document-identity.js";
import { pathToFileURL } from "node:url";

const REPO_ROOT = process.cwd();
const VALUE_ID_1 = "10000000-0000-4000-8000-000000000001";
const VALUE_ID_2 = "10000000-0000-4000-8000-000000000002";
const VALUE_ID_3 = "10000000-0000-4000-8000-000000000003";
const NOW = "2026-09-07T00:00:00.000Z";
const SYNTHETIC_DOCUMENT = "4000001";
const SYNTHETIC_EID = "10000001";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  roots.push(root);
  return root;
}

function localDocument(inputs: Record<string, unknown> = {}, files: Record<string, string> = {}): string {
  return `${JSON.stringify({ schemaVersion: 1, inputs, files }, null, 2)}\n`;
}

function writePrivate(root: string, body: string, mode = 0o600): string {
  mkdirSync(join(root, "config"), { recursive: true });
  const path = join(root, "config", "test-data.local.json");
  writeFileSync(path, body, { mode });
  chmodSync(path, mode);
  return path;
}

const configuredInputs = {
  separationsKualiFinalizationCanaryDocumentNumber: { valueId: VALUE_ID_1, value: SYNTHETIC_DOCUMENT, updatedAt: NOW },
  personLookupCanaryEid: { valueId: VALUE_ID_2, value: SYNTHETIC_EID, updatedAt: NOW },
};

describe("D341 shared test-data config", () => {
  it("is the tracked, frozen owner of the public subject registry, files and samples", () => {
    assert.equal(TEST_DATA_CONFIG_PATH, "config/test-data.json");
    assert.equal(TEST_DATA.configPath, join(REPO_ROOT, TEST_DATA_CONFIG_PATH));
    assert.equal(realpathSync(TEST_DATA.repoRoot), realpathSync(REPO_ROOT));
    assert.equal(Object.isFrozen(TEST_DATA), true);
    assert.equal(Object.isFrozen(TEST_DATA.samples.eids), true);
    // The registry export and the shared config expose ONE registry.
    assert.deepEqual(TEST_DATA.subjects, TEST_TARGET_REGISTRY);
    assert.equal(existsSync(join(REPO_ROOT, "config", "test-subjects.json")), false, "the old registry file is retired");
    assert.deepEqual(TEST_DATA.files.map(({ name, kind }) => ({ name, kind })), [{ name: "synthetic-sample-pdf", kind: "pdf" }]);
  });

  it("commits no private test-target value and no retired environment name", () => {
    const committed = readFileSync(join(REPO_ROOT, TEST_DATA_CONFIG_PATH), "utf8");
    for (const forbidden of ["HRAUTO_TEST_SUBJECT_", "\"documentNumber\":", "\"emplId\":", "\"value\":"]) {
      assert.equal(committed.includes(forbidden), false, forbidden);
    }
    const example = JSON.parse(readFileSync(join(REPO_ROOT, TEST_DATA_LOCAL_EXAMPLE_PATH), "utf8")) as { inputs: Record<string, { value: string }> };
    assert.deepEqual(Object.keys(example.inputs).sort(), [...TEST_DATA_INPUT_NAMES].sort());
    for (const [name, entry] of Object.entries(example.inputs)) {
      assert.match(entry.value, /^<[a-z-]+>$/u, `${name} example holds a placeholder, never a value`);
    }
    const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8").split("\n");
    assert.equal(ignore.includes(TEST_DATA_LOCAL_CONFIG_PATH), true, "private file is ignored");
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", TEST_DATA_LOCAL_CONFIG_PATH], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.notEqual(tracked.status, 0, "private file is never tracked");
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
    assert.equal(file.path, join(dirname(TEST_DATA.configPath), "..", "tests", "support", "fixtures", "documents", "synthetic-sample.pdf").replace("/config/../", "/"));
    assert.equal(relative(REPO_ROOT, file.path), join("tests", "support", "fixtures", "documents", "synthetic-sample.pdf"));
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
    const tsxLoader = pathToFileURL(join(REPO_ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href;
    const child = spawnSync(process.execPath, ["--import", tsxLoader, "--input-type=module", "--eval", `
      import { TEST_DATA, readTestDataFileBytes } from ${JSON.stringify(join(REPO_ROOT, "src", "backend", "app", "registries", "test-data.ts"))};
      const { bytes } = readTestDataFileBytes(TEST_DATA, "synthetic-sample-pdf");
      process.stdout.write(JSON.stringify({ length: bytes.byteLength, head: bytes.subarray(0, 5).toString("latin1") }));
    `], { cwd: elsewhere, encoding: "utf8", env: { ...process.env, TMPDIR: elsewhere } });
    assert.equal(child.status, 0, child.stderr);
    const expected = readTestDataFileBytes(TEST_DATA, "synthetic-sample-pdf").bytes;
    assert.deepEqual(JSON.parse(child.stdout), { length: expected.byteLength, head: "%PDF-" });

    // Separate checkout copy: the declared relative path follows the copied config.
    const copy = scratch("hrauto-test-data-copy-");
    mkdirSync(join(copy, "config"));
    mkdirSync(join(copy, "tests", "support", "fixtures", "documents"), { recursive: true });
    cpSync(join(REPO_ROOT, TEST_DATA_CONFIG_PATH), join(copy, TEST_DATA_CONFIG_PATH));
    cpSync(join(REPO_ROOT, "tests", "support", "fixtures", "documents", "synthetic-sample.pdf"), join(copy, "tests", "support", "fixtures", "documents", "synthetic-sample.pdf"));
    const shared = readTestDataShared(copy, []);
    assert.equal(realpathSync(shared.repoRoot), realpathSync(copy));
    assert.deepEqual(readTestDataFileBytes(shared, "synthetic-sample-pdf").bytes, expected);
  });

  it("refuses a missing, empty, non-PDF, or symlinked-out file by name", () => {
    const root = scratch("hrauto-test-data-files-");
    mkdirSync(join(root, "config"));
    mkdirSync(join(root, "docs"));
    const outside = scratch("hrauto-test-data-outside-");
    writeFileSync(join(outside, "real.pdf"), "%PDF-1.4 outside");
    writeFileSync(join(root, "docs", "empty.pdf"), "");
    writeFileSync(join(root, "docs", "text.pdf"), "not a pdf");
    symlinkSync(join(outside, "real.pdf"), join(root, "docs", "escape.pdf"));
    const config = (path: string) => ({
      schemaVersion: 1,
      subjects: TEST_TARGET_REGISTRY,
      files: { probe: { path, kind: "pdf", purpose: "probe" } },
      samples: TEST_DATA.samples,
    });
    const sharedFor = (path: string) => parseTestDataSharedConfig(config(path), join(root, "config", "test-data.json"), []);
    assert.throws(() => readTestDataFileBytes(sharedFor("../docs/missing.pdf"), "probe"), /probe is missing at its declared path/u);
    assert.throws(() => readTestDataFileBytes(sharedFor("../docs/empty.pdf"), "probe"), /probe is empty/u);
    assert.throws(() => readTestDataFileBytes(sharedFor("../docs/text.pdf"), "probe"), /probe is not a PDF document/u);
    assert.throws(() => readTestDataFileBytes(sharedFor("../docs/escape.pdf"), "probe"), /probe resolves outside the repository/u);
    // A declared path that leaves the repository is a config defect before any read.
    assert.throws(() => sharedFor("../../../../../../elsewhere.pdf"), TestDataConfigError);
    assert.throws(() => sharedFor("/etc/hosts"), TestDataConfigError);
  });

  it("keeps the declared path grammar closed: relative, no dot or empty segments, no traversal in private paths", () => {
    for (const path of ["docs/a.pdf", "../tests/support/fixtures/documents/a.pdf", "../../../../a.pdf", "a.pdf"]) {
      assert.equal(DeclaredRelativePathSchema.safeParse(path).success, true, path);
    }
    for (const path of ["/abs/a.pdf", "docs/./a.pdf", "docs//a.pdf", "docs/", "a\\b.pdf", "a .pdf", ""]) {
      assert.equal(DeclaredRelativePathSchema.safeParse(path).success, false, JSON.stringify(path));
    }
    assert.equal(DeclaredPrivatePathSchema.safeParse("/private/docs/a.pdf").success, true);
    assert.equal(DeclaredPrivatePathSchema.safeParse("../../../../../a.pdf").success, false);
    assert.equal(DeclaredPrivatePathSchema.safeParse("../../../../a.pdf").success, false);
  });

  it("refuses an unknown member, a duplicate sample, or an unregistered subject shape", () => {
    const base = JSON.parse(readFileSync(join(REPO_ROOT, TEST_DATA_CONFIG_PATH), "utf8")) as Record<string, unknown>;
    assert.equal(TestDataSharedConfigSchema.safeParse({ ...base, extra: true }).success, false);
    assert.equal(TestDataSharedConfigSchema.safeParse({ ...base, samples: { ...(base.samples as object), eids: ["10000001", "10000001"] } }).success, false);
    assert.equal(TestDataSharedConfigSchema.safeParse({ ...base, samples: { ...(base.samples as object), eids: ["not-an-eid"] } }).success, false);
    // A malformed subject is the registry's own strict-schema refusal; it never becomes a partial registry.
    assert.throws(
      () => parseTestDataSharedConfig({ ...base, subjects: { schemaVersion: 2, targets: [{ label: "x" }] } }, join(REPO_ROOT, TEST_DATA_CONFIG_PATH), []),
      (error: unknown) => error instanceof Error && !(error instanceof TestDataConfigError),
    );
    assert.throws(
      () => parseTestDataSharedConfig({ ...base, schemaVersion: 2 }, join(REPO_ROOT, TEST_DATA_CONFIG_PATH), []),
      /config\/test-data\.json is malformed/u,
    );
  });
});

describe("D341 private test-data file", () => {
  it("treats an absent file as a truthful absent state, never a default", () => {
    const root = scratch("hrauto-test-data-absent-");
    const outcome = readTestDataLocalConfig(testDataLocalPath(root));
    assert.deepEqual(outcome, { state: "absent", path: join(root, TEST_DATA_LOCAL_CONFIG_PATH) });
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
    assert.equal(testDataLocalFilePath(outcome, "private-sample"), join(root, "config", "private", "sample.pdf"));
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
    mkdirSync(join(linkRoot, "config"));
    symlinkSync(path, join(linkRoot, "config", "test-data.local.json"));
    assert.throws(() => readTestDataLocalConfig(testDataLocalPath(linkRoot)), /must not be a symbolic link/u);

    const directoryRoot = scratch("hrauto-test-data-dir-");
    mkdirSync(join(directoryRoot, "config", "test-data.local.json"), { recursive: true });
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

describe("D341 private merge planner and writer", () => {
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
    mkdirSync(join(root, "config"));
    const path = testDataLocalPath(root);
    const prior = readTestDataLocalConfig(path);
    const next = TestDataLocalConfigSchema.parse({ schemaVersion: 1, inputs: configuredInputs, files: {} });
    writeTestDataLocalConfig(path, next, prior);
    const written = readTestDataLocalConfig(path);
    assert.equal(written.state, "valid");
    if (written.state !== "valid") throw new Error("expected the written file");
    assert.deepEqual(written.config, next);
    assert.deepEqual(readdirSync(join(root, "config")), ["test-data.local.json"], "no staging residue");
    // Equal rewrite is allowed and idempotent; a rewrite whose prior no longer matches stops.
    writeTestDataLocalConfig(path, next, written);
    assert.throws(
      () => writeTestDataLocalConfig(path, next, prior),
      /changed before it could be replaced/u,
    );
    assert.deepEqual(readTestDataLocalConfig(path), written);
    assert.deepEqual(readdirSync(join(root, "config")), ["test-data.local.json"]);
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
    assert.deepEqual(readdirSync(join(root, "config")), ["test-data.local.json"]);
    const after = readTestDataLocalConfig(path);
    assert.equal(after.state === "valid" && after.config.inputs.personLookupCanaryEid?.valueId, VALUE_ID_3, "the other writer's file survives");
  });

  it("refuses an oversized document before staging anything", () => {
    const root = scratch("hrauto-test-data-bound-");
    mkdirSync(join(root, "config"));
    const path = testDataLocalPath(root);
    const next = TestDataLocalConfigSchema.parse({ schemaVersion: 1, inputs: {},
      files: Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`pad${String(index)}`, "p".repeat(1000)])) });
    assert.throws(() => writeTestDataLocalConfig(path, next, { state: "absent", path }), /would exceed its size bound/u);
    assert.deepEqual(readdirSync(join(root, "config")), []);
  });
});

function readOutcome(body: string) {
  const root = scratch("hrauto-test-data-outcome-");
  return readTestDataLocalConfig(writePrivate(root, body));
}
