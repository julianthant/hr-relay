import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { assertNoDuplicateKeys } from "../../storage/configuration/test-data-local.js";
import {
  TEST_DATA_CONFIG_PATH,
  TestDataConfigError,
  TestDataSharedConfigSchema,
  type TestDataFileKind,
  type TestDataFileName,
  type TestDataSamples,
} from "../../../models/config/test-data.js";
import {
  parseTestTargetRegistry,
  type TestTargetManifestView,
  type TestTargetRegistry,
} from "./test-target-registry.js";



export interface TestDataSharedFileResolution {
  readonly name: TestDataFileName;
  readonly kind: TestDataFileKind;
  readonly purpose: string;
  /** Absolute path, proven to live inside the repository that declares it. */
  readonly path: string;
}

export interface TestDataShared {
  /** Absolute path of the tracked config file. */
  readonly configPath: string;
  readonly repoRoot: string;
  readonly subjects: TestTargetRegistry;
  readonly files: readonly TestDataSharedFileResolution[];
  readonly samples: TestDataSamples;
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}


export function parseTestDataSharedConfig(
  input: unknown,
  configPath: string,
  manifests: readonly TestTargetManifestView[] = [],
): TestDataShared {
  if (!isAbsolute(configPath)) throw new TestDataConfigError(`test-data config path must be absolute: ${configPath}`);
  const parsed = TestDataSharedConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new TestDataConfigError(`${TEST_DATA_CONFIG_PATH} is malformed: ${z.prettifyError(parsed.error)}`);
  }
  const configDirectory = dirname(configPath);
  const repoRoot = dirname(configDirectory);
  const files = Object.entries(parsed.data.files).map(([name, file]) => {
    const path = resolve(configDirectory, file.path);
    if (!isInside(repoRoot, path)) {
      throw new TestDataConfigError(`${TEST_DATA_CONFIG_PATH} file ${name} resolves outside the repository`);
    }
    return { name, kind: file.kind, purpose: file.purpose, path };
  });
  const subjects = parseTestTargetRegistry(parsed.data.subjects, manifests);
  return deepFreeze({ configPath, repoRoot, subjects, files, samples: parsed.data.samples });
}

function readJsonDocument(path: string, label: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new TestDataConfigError(`${label} is unreadable at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertNoDuplicateKeys(text, label);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TestDataConfigError(`${label} is not valid JSON`);
  }
}

/** Read the tracked config that belongs to `repoRoot`. No search, no default root. */
export function readTestDataShared(
  repoRoot: string,
  manifests: readonly TestTargetManifestView[] = [],
): TestDataShared {
  if (!isAbsolute(repoRoot)) throw new TestDataConfigError(`test-data repository root must be absolute: ${repoRoot}`);
  const configPath = resolve(repoRoot, TEST_DATA_CONFIG_PATH);
  return parseTestDataSharedConfig(readJsonDocument(configPath, TEST_DATA_CONFIG_PATH), configPath, manifests);
}

const COMMITTED_CONFIG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../",
  TEST_DATA_CONFIG_PATH,
);
/** The checked-in shared data of THIS checkout, parsed and frozen at module load. */
export const TEST_DATA: TestDataShared = parseTestDataSharedConfig(
  readJsonDocument(COMMITTED_CONFIG_PATH, TEST_DATA_CONFIG_PATH),
  COMMITTED_CONFIG_PATH,
);

export function testDataFile(shared: TestDataShared, name: string): TestDataSharedFileResolution {
  const file = shared.files.find((candidate) => candidate.name === name);
  if (file === undefined) {
    throw new TestDataConfigError(`${TEST_DATA_CONFIG_PATH} declares no file named ${name}`);
  }
  return file;
}

// Recheck shared-file realpaths inside the repository; empty bytes are a defect.
export function readTestDataFileBytes(shared: TestDataShared, name: string): Readonly<{ file: TestDataSharedFileResolution; bytes: Buffer }> {
  const file = testDataFile(shared, name);
  let real: string;
  try {
    real = realpathSync(file.path);
  } catch {
    throw new TestDataConfigError(`test-data file ${name} is missing at its declared path`);
  }
  if (!isInside(realpathSync(shared.repoRoot), real)) {
    throw new TestDataConfigError(`test-data file ${name} resolves outside the repository`);
  }
  const bytes = readFileSync(real);
  if (bytes.byteLength === 0) throw new TestDataConfigError(`test-data file ${name} is empty`);
  if (file.kind === "pdf" && !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new TestDataConfigError(`test-data file ${name} is not a PDF document`);
  }
  return Object.freeze({ file, bytes });
}

/** Isolated, mutable copies of frozen shared samples; callers never share an instance. */
export function testDataSamples(shared: TestDataShared = TEST_DATA): {
  eids: string[]; kualiDocumentNumbers: string[]; timekeeperNames: string[];
} {
  return {
    eids: [...shared.samples.eids],
    kualiDocumentNumbers: [...shared.samples.kualiDocumentNumbers],
    timekeeperNames: [...shared.samples.timekeeperNames],
  };
}


export {
  absentTestDataInputSource,
  assertNoDuplicateKeys,
  createTestDataInputSource,
  planTestDataLocalMerge,
  readTestDataLocalConfig,
  testDataInputSourceFrom,
  testDataLocalFilePath,
  testDataLocalPath,
  testDataLocalPresence,
  writeTestDataLocalConfig,
  type TestDataLocalAccess,
  type TestDataLocalInputCandidate,
  type TestDataLocalInputDisposition,
  type TestDataLocalMergePlan,
  type TestDataLocalReadOutcome,
  type TestDataLocalWriteAccess,
} from "../../storage/configuration/test-data-local.js";
