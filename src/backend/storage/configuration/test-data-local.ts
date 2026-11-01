import { fsyncPath, privatePathRejects } from "../private-path.js";
import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { privateEqual } from "../../../rules/validation/private-equal.js";
import {
  TEST_DATA_LOCAL_CONFIG_PATH,
  TEST_DATA_LOCAL_MAXIMUM_BYTES,
  TEST_DATA_INPUT_NAMES,
  TestDataConfigError,
  TestDataLocalConfigError,
  TestDataLocalConfigSchema,
  type TestDataInputName,
  type TestDataInputSource,
  type TestDataLocalConfig,
  type TestDataLocalInputEntry,
  type TestDataLocalPresence,
} from "../../../models/config/test-data.js";



// JSON.parse accepts duplicate keys last-wins; reject them before parsing private inputs.
function decodeKey(raw: string, label: string): string {
  try {
    const decoded: unknown = JSON.parse(`"${raw}"`);
    if (typeof decoded !== "string") throw new Error("not a string");
    return decoded;
  } catch {
    throw new TestDataConfigError(`${label} has an invalid key string`);
  }
}

export function assertNoDuplicateKeys(text: string, label: string): void {
  const stack: Array<Set<string> | null> = [];
  let index = 0;
  const readString = (): string => {
    let value = "";
    index += 1;
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") { value += text.slice(index, index + 2); index += 2; continue; }
      if (char === '"') { index += 1; return value; }
      value += char;
      index += 1;
    }
    throw new TestDataConfigError(`${label} has an unterminated string`);
  };
  let expectKey = false;
  while (index < text.length) {
    const char = text[index];
    if (char === "{") { stack.push(new Set()); expectKey = true; index += 1; continue; }
    if (char === "[") { stack.push(null); expectKey = false; index += 1; continue; }
    if (char === "}" || char === "]") { stack.pop(); expectKey = false; index += 1; continue; }
    if (char === ",") { expectKey = stack[stack.length - 1] !== null && stack.length > 0; index += 1; continue; }
    if (char === '"') {
      const raw = readString();
      const scope = stack[stack.length - 1];
      if (expectKey && scope instanceof Set) {
        // Compare decoded keys: "valueId" and "value\u0049d" are ONE key to JSON.parse.
        const value = decodeKey(raw, label);
        if (scope.has(value)) throw new TestDataConfigError(`${label} repeats key ${value}`);
        scope.add(value);
        expectKey = false;
      }
      continue;
    }
    index += 1;
  }
}

export interface TestDataLocalAccess {
  readonly open: (path: string, flags: number) => number;
  readonly inspect: (descriptor: number) => Readonly<Pick<Stats, "isFile" | "isSymbolicLink" | "mode" | "uid" | "dev" | "ino" | "size">>;
  readonly read: (descriptor: number) => Buffer;
  readonly close: (descriptor: number) => void;
}
const DEFAULT_LOCAL_ACCESS: TestDataLocalAccess = {
  open: openSync,
  inspect: fstatSync,
  read: (descriptor) => readFileSync(descriptor),
  close: closeSync,
};

export type TestDataLocalReadOutcome =
  | Readonly<{ state: "absent"; path: string }>
  | Readonly<{ state: "valid"; path: string; config: TestDataLocalConfig }>;


export function readTestDataLocalConfig(
  localPath: string,
  access: TestDataLocalAccess = DEFAULT_LOCAL_ACCESS,
): TestDataLocalReadOutcome {
  if (!isAbsolute(localPath)) throw new TestDataLocalConfigError(`private test-data path must be absolute: ${localPath}`);
  let descriptor: number;
  try {
    descriptor = access.open(localPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code: unknown = error !== null && typeof error === "object" ? Reflect.get(error, "code") : undefined;
    if (code === "ENOENT") return Object.freeze({ state: "absent", path: localPath });
    if (code === "ELOOP") throw new TestDataLocalConfigError(`${TEST_DATA_LOCAL_CONFIG_PATH} must not be a symbolic link`);
    throw new TestDataLocalConfigError(`${TEST_DATA_LOCAL_CONFIG_PATH} could not be opened`);
  }
  let text: string;
  try {
    const metadata = access.inspect(descriptor);
    if (!metadata.isFile()) throw new TestDataLocalConfigError(`${TEST_DATA_LOCAL_CONFIG_PATH} is not a regular file`);
    if (privatePathRejects(localPath, metadata, "private")) {
      throw new TestDataLocalConfigError(`${TEST_DATA_LOCAL_CONFIG_PATH} must be private to its owner (mode 0600)`);
    }
    if (metadata.size > TEST_DATA_LOCAL_MAXIMUM_BYTES) {
      throw new TestDataLocalConfigError(`${TEST_DATA_LOCAL_CONFIG_PATH} exceeds its size bound`);
    }
    text = access.read(descriptor).toString("utf8");
  } finally {
    access.close(descriptor);
  }
  try {
    assertNoDuplicateKeys(text, TEST_DATA_LOCAL_CONFIG_PATH);
  } catch (error) {
    throw new TestDataLocalConfigError(error instanceof Error ? error.message : String(error));
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new TestDataLocalConfigError(`${TEST_DATA_LOCAL_CONFIG_PATH} is not valid JSON`);
  }
  const parsed = TestDataLocalConfigSchema.safeParse(document);
  if (!parsed.success) {
    // Issue paths name keys; zod messages for these leaf schemas never echo the input.
    const keys = [...new Set(parsed.error.issues.flatMap((issue) => {
      const base = issue.path.map(String);
      // An unrecognized key is named by key so the operator can find it; keys never carry values.
      const unknown = issue.code === "unrecognized_keys" ? issue.keys.map((key) => [...base, key].join(".")) : [];
      return unknown.length > 0 ? unknown : [base.join(".") || "<root>"];
    }))];
    throw new TestDataLocalConfigError(`${TEST_DATA_LOCAL_CONFIG_PATH} is invalid at ${keys.join(", ")}`);
  }
  return Object.freeze({ state: "valid", path: localPath, config: deepFreeze(parsed.data) });
}

export function testDataLocalPath(repoRoot: string): string {
  if (!isAbsolute(repoRoot)) throw new TestDataLocalConfigError(`test-data repository root must be absolute: ${repoRoot}`);
  return resolve(repoRoot, TEST_DATA_LOCAL_CONFIG_PATH);
}

// Capture the private file once so sequential reads cannot mix edits.
export function createTestDataInputSource(
  localPath: string,
  access: TestDataLocalAccess = DEFAULT_LOCAL_ACCESS,
): TestDataInputSource {
  let captured: TestDataLocalReadOutcome | undefined;
  const capture = (): TestDataLocalReadOutcome => {
    captured ??= readTestDataLocalConfig(localPath, access);
    return captured;
  };
  return Object.freeze({
    read: <Name extends TestDataInputName>(name: Name): TestDataLocalInputEntry<Name> | undefined => {
      const outcome = capture();
      if (outcome.state === "absent") return undefined;
      return outcome.config.inputs[name] as TestDataLocalInputEntry<Name> | undefined;
    },
  });
}

/** A source that has no private file at all — the offline default for tests. */
export function absentTestDataInputSource(): TestDataInputSource {
  return Object.freeze({ read: () => undefined });
}

/** A source over an already-parsed private config, for synthetic proofs. */
export function testDataInputSourceFrom(config: unknown): TestDataInputSource {
  const parsed = deepFreeze(TestDataLocalConfigSchema.parse(config));
  return Object.freeze({
    read: <Name extends TestDataInputName>(name: Name): TestDataLocalInputEntry<Name> | undefined =>
      parsed.inputs[name] as TestDataLocalInputEntry<Name> | undefined,
  });
}

export function testDataLocalPresence(outcome: TestDataLocalReadOutcome): TestDataLocalPresence {
  if (outcome.state === "absent") {
    return deepFreeze({ state: "absent", inputs: TEST_DATA_INPUT_NAMES.map((name) => ({ name, present: false })), files: [] });
  }
  return deepFreeze({
    state: "valid",
    inputs: TEST_DATA_INPUT_NAMES.map((name) => ({ name, present: outcome.config.inputs[name] !== undefined })),
    files: Object.keys(outcome.config.files).sort(),
  });
}

/** Resolve a named PRIVATE file path against the private file's directory; absolute paths stay as declared. */
export function testDataLocalFilePath(outcome: TestDataLocalReadOutcome, name: string): string | undefined {
  if (outcome.state === "absent") return undefined;
  const declared = outcome.config.files[name];
  if (declared === undefined) return undefined;
  return isAbsolute(declared) ? declared : resolve(dirname(outcome.path), declared);
}



export interface TestDataLocalInputCandidate {
  readonly name: TestDataInputName;
  readonly valueId: string;
  readonly value: string;
  readonly updatedAt: string;
}

export type TestDataLocalInputDisposition = "create" | "add" | "equal" | "conflict";

export interface TestDataLocalMergePlan {
  readonly action: "create" | "update" | "unchanged" | "none";
  readonly dispositions: readonly Readonly<{ name: TestDataInputName; disposition: TestDataLocalInputDisposition }>[];
  /** The complete next document; absent when no write is needed. */
  readonly next?: TestDataLocalConfig;
}

// Exact matching identity and value is an idempotent destination; any mismatch refuses conversion.
export function planTestDataLocalMerge(
  destination: TestDataLocalReadOutcome,
  candidates: readonly TestDataLocalInputCandidate[],
): TestDataLocalMergePlan {
  const existing: TestDataLocalConfig = destination.state === "absent"
    ? { schemaVersion: 1, inputs: {}, files: {} }
    : destination.config;
  const inputs: Record<string, unknown> = { ...existing.inputs };
  const dispositions: Array<{ name: TestDataInputName; disposition: TestDataLocalInputDisposition }> = [];
  let changed = false;
  for (const candidate of candidates) {
    const current = existing.inputs[candidate.name];
    const entry = { valueId: candidate.valueId, value: candidate.value, updatedAt: candidate.updatedAt };
    if (current === undefined) {
      inputs[candidate.name] = entry;
      dispositions.push({ name: candidate.name, disposition: destination.state === "absent" ? "create" : "add" });
      changed = true;
      continue;
    }
    if (current.valueId === candidate.valueId && privateEqual(current.value, candidate.value)) {
      dispositions.push({ name: candidate.name, disposition: "equal" });
      continue;
    }
    dispositions.push({ name: candidate.name, disposition: "conflict" });
  }
  if (dispositions.some(({ disposition }) => disposition === "conflict")) {
    return deepFreeze({ action: "none", dispositions });
  }
  if (candidates.length === 0) return deepFreeze({ action: "none", dispositions });
  if (!changed) return deepFreeze({ action: "unchanged", dispositions });
  const next = TestDataLocalConfigSchema.parse({ schemaVersion: 1, inputs, files: existing.files });
  return deepFreeze({ action: destination.state === "absent" ? "create" : "update", dispositions, next });
}

export interface TestDataLocalWriteAccess extends TestDataLocalAccess {
  readonly writeExclusive: (path: string, bytes: Uint8Array, mode: number) => void;
  readonly syncPath: (path: string) => void;
  readonly rename: (from: string, to: string) => void;
  readonly remove: (path: string) => void;
  readonly randomUUID: () => string;
}

const DEFAULT_LOCAL_WRITE_ACCESS: TestDataLocalWriteAccess = {
  ...DEFAULT_LOCAL_ACCESS,
  writeExclusive: (path, bytes, mode) => { writeFileSync(path, bytes, { mode, flag: "wx" }); },
  syncPath: fsyncPath,
  rename: renameSync,
  remove: (path) => { try { unlinkSync(path); } catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; } },
  randomUUID,
};

// Re-verify the exact previous state before atomic rename and directory sync.
export function writeTestDataLocalConfig(
  localPath: string,
  next: TestDataLocalConfig,
  prior: TestDataLocalReadOutcome,
  access: TestDataLocalWriteAccess = DEFAULT_LOCAL_WRITE_ACCESS,
): void {
  if (!isAbsolute(localPath)) throw new TestDataLocalConfigError(`private test-data path must be absolute: ${localPath}`);
  const parsed = TestDataLocalConfigSchema.parse(next);
  const bytes = new TextEncoder().encode(`${JSON.stringify(parsed, null, 2)}\n`);
  if (bytes.byteLength > TEST_DATA_LOCAL_MAXIMUM_BYTES) {
    throw new TestDataLocalConfigError(`${TEST_DATA_LOCAL_CONFIG_PATH} would exceed its size bound`);
  }
  const directory = dirname(localPath);
  const temporary = resolve(directory, `.test-data.local.${access.randomUUID()}.tmp`);
  try {
    access.writeExclusive(temporary, bytes, 0o600);
    access.syncPath(temporary);
    const live = readTestDataLocalConfig(localPath, access);
    if (live.state !== prior.state
      || (live.state === "valid" && prior.state === "valid" && !privateEqual(live.config, prior.config))) {
      throw new TestDataLocalConfigError(`${TEST_DATA_LOCAL_CONFIG_PATH} changed before it could be replaced`);
    }
    access.rename(temporary, localPath);
    access.syncPath(directory);
    const readback = readTestDataLocalConfig(localPath, access);
    if (readback.state !== "valid" || !privateEqual(readback.config, parsed)) {
      throw new TestDataLocalConfigError(`${TEST_DATA_LOCAL_CONFIG_PATH} readback differs after replacement`);
    }
  } finally {
    access.remove(temporary);
  }
}
