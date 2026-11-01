import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  type Stats,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { systemClock } from "../src/rules/time/clock.js";

const PARITY_JSON_REPORT = "tests/parity/.output/results.json";
const PARITY_REQUIRED_A11Y_ANNOTATION = "required-a11y-evidence";

const PARITY_REPORT_LIMITS = Object.freeze({
  reportBytes: 8 * 1024 * 1024,
  jsonDepth: 64,
  jsonNodes: 100_000,
  suiteDepth: 16,
  suites: 512,
  specs: 2_048,
  tests: 4_096,
  results: 4_096,
  attachments: 8_192,
  annotations: 16_384,
  localArray: 512,
  stringChars: 1024 * 1024,
  base64Chars: 512 * 1024,
  decodedBytes: 256 * 1024,
} as const);

const PARITY_JSON_ENV_OVERRIDES = [
  "PLAYWRIGHT_JSON_OUTPUT_FILE",
  "PLAYWRIGHT_JSON_OUTPUT_DIR",
  "PLAYWRIGHT_JSON_OUTPUT_NAME",
] as const;
const A11Y_DIGEST_PREFIX = "a11y-attachment-sha256:";
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const LOCK_READY = "parity-json-lock-held\n";
const LOCK_HOLDER_SOURCE = `process.stdout.write(${JSON.stringify(LOCK_READY)}); process.stdin.resume();`;

const BoundedStringSchema = z.string().max(PARITY_REPORT_LIMITS.stringChars);
const BoundedBase64Schema = z.string().max(PARITY_REPORT_LIMITS.base64Chars);
const BoundedUnknownArraySchema = z.array(z.unknown()).max(PARITY_REPORT_LIMITS.localArray);

const AnnotationSchema = z.object({
  type: BoundedStringSchema,
  description: BoundedStringSchema.optional(),
  location: z.unknown().optional(),
}).strict();

const AttachmentSchema = z.object({
  name: BoundedStringSchema,
  contentType: BoundedStringSchema,
  path: BoundedStringSchema.optional(),
  body: BoundedBase64Schema.optional(),
}).strict();

const ResultSchema = z.object({
  workerIndex: z.number().int(),
  parallelIndex: z.number().int(),
  status: BoundedStringSchema,
  duration: z.number(),
  error: z.unknown().optional(),
  errors: BoundedUnknownArraySchema,
  stdout: BoundedUnknownArraySchema,
  stderr: BoundedUnknownArraySchema,
  retry: z.number().int().nonnegative(),
  steps: BoundedUnknownArraySchema.optional(),
  startTime: BoundedStringSchema,
  annotations: z.array(AnnotationSchema).max(PARITY_REPORT_LIMITS.localArray),
  attachments: z.array(AttachmentSchema).max(PARITY_REPORT_LIMITS.localArray),
  errorLocation: z.unknown().optional(),
}).strict();

const TestSchema = z.object({
  timeout: z.number(),
  annotations: z.array(AnnotationSchema).max(PARITY_REPORT_LIMITS.localArray),
  expectedStatus: BoundedStringSchema,
  projectId: BoundedStringSchema,
  projectName: BoundedStringSchema,
  results: z.array(ResultSchema).max(PARITY_REPORT_LIMITS.localArray),
  status: BoundedStringSchema,
}).strict();

const SpecSchema = z.object({
  title: BoundedStringSchema,
  ok: z.boolean(),
  tags: z.array(BoundedStringSchema).max(PARITY_REPORT_LIMITS.localArray),
  tests: z.array(TestSchema).max(PARITY_REPORT_LIMITS.localArray),
  id: BoundedStringSchema,
  file: BoundedStringSchema,
  line: z.number().int(),
  column: z.number().int(),
}).strict();

interface SuiteReport {
  readonly title: string;
  readonly file: string;
  readonly column: number;
  readonly line: number;
  readonly specs: readonly z.infer<typeof SpecSchema>[];
  readonly suites?: readonly SuiteReport[];
}

const SuiteSchema: z.ZodType<SuiteReport> = z.lazy(() => z.object({
  title: BoundedStringSchema,
  file: BoundedStringSchema,
  column: z.number().int(),
  line: z.number().int(),
  specs: z.array(SpecSchema).max(PARITY_REPORT_LIMITS.localArray),
  suites: z.array(SuiteSchema).max(PARITY_REPORT_LIMITS.localArray).optional(),
}).strict());

const ParityReportSchema = z.object({
  config: z.unknown(),
  suites: z.array(SuiteSchema).max(PARITY_REPORT_LIMITS.localArray),
  errors: BoundedUnknownArraySchema,
  stats: z.object({
    startTime: BoundedStringSchema,
    duration: z.number(),
    expected: z.number().int(),
    skipped: z.number().int(),
    unexpected: z.number().int(),
    flaky: z.number().int(),
  }).strict(),
}).strict();

type ParityMode = "assert" | "update";

interface ParityReportIdentity {
  readonly sha256: string;
  readonly bytes: number;
  readonly modifiedAtMs: number;
}

interface VerifyParityJsonOptions {
  readonly cwd: string;
  readonly runStartedAtMs: number;
  readonly before: ParityReportIdentity | null;
  readonly expectedUid?: number;
  readonly afterReportRead?: (path: string) => void;
}

interface RunParityOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly args: readonly string[];
  readonly mode: ParityMode;
  readonly command?: string;
  readonly commandArgs?: readonly string[];
  readonly lockCommand?: string;
  readonly expectedUid?: number;
  readonly inactivityTimeoutMs?: number;
  readonly writeError?: (message: string) => void;
  readonly afterReportRead?: (path: string) => void;
}

interface ChildResult {
  readonly code: number;
  readonly detail: string;
}

interface RunParityDependencies {
  readonly runChild?: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => Promise<ChildResult>;
}

interface FileIdentity {
  readonly device: number;
  readonly inode: number;
  readonly bytes: number;
  readonly modifiedAtMs: number;
  readonly changedAtMs: number;
}

interface HeldCommandLock {
  readonly release: () => Promise<void>;
}

interface VerificationCounts {
  suites: number;
  specs: number;
  tests: number;
  results: number;
  attachments: number;
  annotations: number;
}

const PARITY_PLAYWRIGHT_COMMAND = process.execPath;
const PARITY_PLAYWRIGHT_ARGS = Object.freeze([
  fileURLToPath(new URL("../node_modules/playwright/cli.js", import.meta.url)),
  "test",
  "--config",
  "playwright.parity.config.ts",
] as const);

function currentUid(expectedUid?: number): number {
  if (expectedUid !== undefined) return expectedUid;
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("parity JSON evidence requires an operating-system user identity");
  return uid;
}

function modeBits(mode: number): number {
  return mode & 0o777;
}

function canonicalCheckoutRoot(cwd: string): string {
  return realpathSync(cwd);
}

function reportOutputDirectory(cwd: string): string {
  return resolve(canonicalCheckoutRoot(cwd), dirname(PARITY_JSON_REPORT));
}

function parityReportPath(cwd: string): string {
  const root = canonicalCheckoutRoot(cwd);
  const outputRoot = reportOutputDirectory(cwd);
  const reportPath = resolve(root, PARITY_JSON_REPORT);
  if (!reportPath.startsWith(`${outputRoot}${sep}`)) {
    throw new Error(`parity JSON report escaped its output root: ${reportPath}`);
  }
  return reportPath;
}

function parityCommandLockPath(cwd: string): string {
  return resolve(canonicalCheckoutRoot(cwd), ".tracker/data/locks/parity-json-report.lock");
}

function directFileIdentity(stats: Stats): FileIdentity {
  return {
    device: stats.dev,
    inode: stats.ino,
    bytes: stats.size,
    modifiedAtMs: stats.mtimeMs,
    changedAtMs: stats.ctimeMs,
  };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.bytes === right.bytes
    && left.modifiedAtMs === right.modifiedAtMs
    && left.changedAtMs === right.changedAtMs;
}

function assertDirectOwnedDirectory(path: string, expectedUid: number, privateMode: boolean): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`parity JSON report parent must be one direct directory: ${path}`);
  }
  if (stats.uid !== expectedUid) {
    throw new Error(`parity JSON report parent is not owned by the current user: ${path}`);
  }
  if (privateMode && modeBits(stats.mode) !== PRIVATE_DIRECTORY_MODE) {
    throw new Error(`parity JSON report directory must have mode 0700: ${path}`);
  }
}

function assertDirectOwnedReport(
  stats: Stats,
  path: string,
  expectedUid: number,
): void {
  if (!stats.isFile()) throw new Error(`parity JSON report must be one direct regular file: ${path}`);
  if (stats.uid !== expectedUid) throw new Error(`parity JSON report is not owned by the current user: ${path}`);
  if (stats.nlink !== 1) throw new Error(`parity JSON report must have exactly one link: ${path}`);
  if (modeBits(stats.mode) !== PRIVATE_FILE_MODE) {
    throw new Error(`parity JSON report must have mode 0600: ${path}`);
  }
}

function assertPathMatchesDescriptor(path: string, descriptorStats: Stats): void {
  const pathStats = lstatSync(path);
  if (pathStats.isSymbolicLink() || !pathStats.isFile()
      || pathStats.dev !== descriptorStats.dev || pathStats.ino !== descriptorStats.ino) {
    throw new Error("parity JSON report path changed while its evidence was being verified");
  }
}

function readParityReportOnce(
  cwd: string,
  expectedUid: number,
  afterReportRead?: (path: string) => void,
): { readonly bytes: Buffer; readonly identity: ParityReportIdentity } {
  const path = parityReportPath(cwd);
  let descriptor: number | undefined;
  try {
    assertDirectOwnedDirectory(reportOutputDirectory(cwd), expectedUid, true);
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const beforeStats = fstatSync(descriptor);
    assertDirectOwnedReport(beforeStats, path, expectedUid);
    if (beforeStats.size > PARITY_REPORT_LIMITS.reportBytes) {
      throw new Error(`parity JSON report exceeds ${String(PARITY_REPORT_LIMITS.reportBytes)} bytes`);
    }
    assertPathMatchesDescriptor(path, beforeStats);
    const beforeIdentity = directFileIdentity(beforeStats);
    const bytes = readFileSync(descriptor);
    afterReportRead?.(path);
    const afterStats = fstatSync(descriptor);
    assertDirectOwnedReport(afterStats, path, expectedUid);
    if (!sameFileIdentity(beforeIdentity, directFileIdentity(afterStats)) || bytes.byteLength !== beforeStats.size) {
      throw new Error("parity JSON report changed while its evidence was being verified");
    }
    assertPathMatchesDescriptor(path, afterStats);
    return {
      bytes,
      identity: {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
        modifiedAtMs: beforeStats.mtimeMs,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`parity JSON report is missing, unsafe, or unreadable at ${path}: ${message}`, { cause: error });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function assertJsonValueBounds(root: unknown): void {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    nodes += 1;
    if (nodes > PARITY_REPORT_LIMITS.jsonNodes) {
      throw new Error(`parity JSON report exceeds ${String(PARITY_REPORT_LIMITS.jsonNodes)} JSON values`);
    }
    if (entry.depth > PARITY_REPORT_LIMITS.jsonDepth) {
      throw new Error(`parity JSON report exceeds JSON depth ${String(PARITY_REPORT_LIMITS.jsonDepth)}`);
    }
    if (typeof entry.value === "string") {
      if (entry.value.length > PARITY_REPORT_LIMITS.stringChars) {
        throw new Error(`parity JSON report carries a string longer than ${String(PARITY_REPORT_LIMITS.stringChars)} characters`);
      }
      continue;
    }
    if (Array.isArray(entry.value)) {
      for (const value of entry.value) pending.push({ value, depth: entry.depth + 1 });
      continue;
    }
    if (entry.value !== null && typeof entry.value === "object") {
      for (const [key, value] of Object.entries(entry.value)) {
        if (key.length > PARITY_REPORT_LIMITS.stringChars) {
          throw new Error(`parity JSON report carries a key longer than ${String(PARITY_REPORT_LIMITS.stringChars)} characters`);
        }
        pending.push({ value, depth: entry.depth + 1 });
      }
    }
  }
}

function strictBase64Bytes(body: string, name: string): Buffer {
  if (body.length > PARITY_REPORT_LIMITS.base64Chars) throw new Error(`${name} exceeds the base64 evidence ceiling`);
  if (body.length === 0 || body.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(body)) {
    throw new Error(`${name} carries malformed or noncanonical base64 body evidence`);
  }
  const bytes = Buffer.from(body, "base64");
  if (bytes.toString("base64") !== body || bytes.byteLength === 0) {
    throw new Error(`${name} carries malformed, noncanonical, or empty base64 body evidence`);
  }
  if (bytes.byteLength > PARITY_REPORT_LIMITS.decodedBytes) {
    throw new Error(`${name} exceeds the decoded evidence ceiling`);
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${name} carries invalid UTF-8 body evidence`, { cause: error });
  }
  return bytes;
}

function incrementCount(counts: VerificationCounts, key: keyof VerificationCounts, maximum: number): void {
  counts[key] += 1;
  if (counts[key] > maximum) {
    throw new Error(`parity JSON report exceeds aggregate ${key} ceiling ${String(maximum)}`);
  }
}

function evidenceAttachments(result: z.infer<typeof ResultSchema>): readonly z.infer<typeof AttachmentSchema>[] {
  return result.attachments.filter(
    (attachment) => attachment.name.endsWith(".a11y.yml") || attachment.contentType === "text/yaml",
  );
}

function evidenceAnnotations(result: z.infer<typeof ResultSchema>): readonly z.infer<typeof AnnotationSchema>[] {
  return result.annotations.filter((annotation) => annotation.type.startsWith(A11Y_DIGEST_PREFIX));
}

function requiredEvidenceNames(test: z.infer<typeof TestSchema>, context: string): readonly string[] {
  const declarations = test.annotations.filter((annotation) => annotation.type === PARITY_REQUIRED_A11Y_ANNOTATION);
  const names = declarations.map((annotation) => annotation.description ?? "");
  for (const name of names) {
    if (!name.endsWith(".a11y.yml") || name.length === ".a11y.yml".length) {
      throw new Error(`${context} carries an invalid required a11y evidence declaration`);
    }
  }
  if (new Set(names).size !== names.length) {
    throw new Error(`${context} repeats a required a11y evidence declaration`);
  }
  return names;
}

function verifyResultEvidence(
  result: z.infer<typeof ResultSchema>,
  requiredNames: readonly string[],
  context: string,
): readonly string[] {
  const attachments = evidenceAttachments(result);
  const annotations = evidenceAnnotations(result);
  const required = new Set(requiredNames);
  for (const attachment of attachments) {
    if (!required.has(attachment.name)) throw new Error(`${context} carries undeclared a11y attachment ${attachment.name}`);
  }
  for (const annotation of annotations) {
    const name = annotation.type.slice(A11Y_DIGEST_PREFIX.length);
    if (!required.has(name)) throw new Error(`${context} carries undeclared a11y digest annotation ${name}`);
  }
  for (const name of requiredNames) {
    const namedAttachments = attachments.filter((attachment) => attachment.name === name);
    const namedAnnotations = annotations.filter((annotation) => annotation.type === `${A11Y_DIGEST_PREFIX}${name}`);
    if (namedAttachments.length !== 1) {
      throw new Error(`${context} required a11y evidence ${name} is missing or duplicated; found ${String(namedAttachments.length)} body attachments`);
    }
    if (namedAnnotations.length !== 1) {
      throw new Error(`${context} required a11y evidence ${name} is missing or duplicated; found ${String(namedAnnotations.length)} digest annotations`);
    }
    const attachment = namedAttachments[0];
    const annotation = namedAnnotations[0];
    if (attachment === undefined || annotation === undefined) throw new Error(`${context} lost ${name} during verification`);
    if (attachment.contentType !== "text/yaml") throw new Error(`${context} attachment ${name} must be text/yaml evidence`);
    if (attachment.path !== undefined || attachment.body === undefined) {
      throw new Error(`${context} attachment ${name} must be body-backed and may not carry a path`);
    }
    if (!/^[0-9a-f]{64}$/u.test(annotation.description ?? "")) {
      throw new Error(`${context} annotation for ${name} must carry one lowercase sha256 digest`);
    }
    const digest = createHash("sha256").update(strictBase64Bytes(attachment.body, name)).digest("hex");
    if (annotation.description !== digest) {
      throw new Error(`${context} annotation digest does not match the exact attached body for ${name}`);
    }
  }
  return requiredNames;
}

function parseParityReport(bytes: Buffer, path: string): z.infer<typeof ParityReportSchema> {
  let parsed: unknown;
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(json);
    assertJsonValueBounds(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`parity JSON report is malformed at ${path}: ${message}`, { cause: error });
  }
  const result = ParityReportSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`parity JSON report is malformed at ${path}: ${result.error.message}`, { cause: result.error });
  }
  return result.data;
}

function verifyParityJsonReport(options: VerifyParityJsonOptions): { readonly attachmentCount: number } {
  const expectedUid = currentUid(options.expectedUid);
  const path = parityReportPath(options.cwd);
  const read = readParityReportOnce(options.cwd, expectedUid, options.afterReportRead);
  if (options.before !== null
      && read.identity.sha256 === options.before.sha256
      && read.identity.bytes === options.before.bytes
      && read.identity.modifiedAtMs === options.before.modifiedAtMs) {
    throw new Error("parity JSON report is stale: the current run did not replace the prior evidence");
  }
  if (read.identity.modifiedAtMs < options.runStartedAtMs) {
    throw new Error("parity JSON report is stale: its file timestamp predates this run");
  }

  const report = parseParityReport(read.bytes, path);
  const reportStartedAtMs = Date.parse(report.stats.startTime);
  if (!Number.isFinite(reportStartedAtMs) || reportStartedAtMs < options.runStartedAtMs) {
    throw new Error("parity JSON report is stale: stats.startTime predates this run");
  }

  const counts: VerificationCounts = { suites: 0, specs: 0, tests: 0, results: 0, attachments: 0, annotations: 0 };
  const globalNames = new Set<string>();
  let attachmentCount = 0;
  const pending = report.suites.map((suite) => ({ suite, depth: 1 }));
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    if (entry.depth > PARITY_REPORT_LIMITS.suiteDepth) {
      throw new Error(`parity JSON report exceeds suite depth ${String(PARITY_REPORT_LIMITS.suiteDepth)}`);
    }
    incrementCount(counts, "suites", PARITY_REPORT_LIMITS.suites);
    for (const nested of entry.suite.suites ?? []) pending.push({ suite: nested, depth: entry.depth + 1 });
    for (const spec of entry.suite.specs) {
      incrementCount(counts, "specs", PARITY_REPORT_LIMITS.specs);
      for (const test of spec.tests) {
        incrementCount(counts, "tests", PARITY_REPORT_LIMITS.tests);
        const context = `${spec.file}:${String(spec.line)} ${spec.title}`;
        const requiredNames = requiredEvidenceNames(test, context);
        for (const result of test.results) {
          incrementCount(counts, "results", PARITY_REPORT_LIMITS.results);
          for (const _attachment of result.attachments) incrementCount(counts, "attachments", PARITY_REPORT_LIMITS.attachments);
          for (const _annotation of result.annotations) incrementCount(counts, "annotations", PARITY_REPORT_LIMITS.annotations);
          const startedAtMs = Date.parse(result.startTime);
          if (!Number.isFinite(startedAtMs) || startedAtMs < options.runStartedAtMs) {
            throw new Error(`${context} carries a result startTime that predates this run`);
          }
        }
        for (const _annotation of test.annotations) incrementCount(counts, "annotations", PARITY_REPORT_LIMITS.annotations);
        if (requiredNames.length === 0) {
          for (const [resultIndex, result] of test.results.entries()) {
            if (evidenceAttachments(result).length > 0 || evidenceAnnotations(result).length > 0) {
              throw new Error(`${context} result ${String(resultIndex)} carries a11y evidence without a static requirement`);
            }
          }
          continue;
        }
        if (test.results.length !== 1 || test.results[0]?.retry !== 0) {
          throw new Error(`${context} required a11y evidence must come from exactly one retry-0 result`);
        }
        if (test.expectedStatus !== "passed") {
          throw new Error(`${context} required a11y evidence producer expectedStatus must be passed`);
        }
        if (test.status !== "expected") {
          throw new Error(`${context} required a11y evidence producer outcome must be expected`);
        }
        const requiredResult = test.results[0];
        if (requiredResult.status !== "passed") {
          throw new Error(`${context} required a11y evidence retry-0 result status must be passed`);
        }
        if (requiredResult.error !== undefined || requiredResult.errors.length !== 0) {
          throw new Error(`${context} required a11y evidence retry-0 result must carry no errors`);
        }
        for (const name of requiredNames) {
          if (globalNames.has(name)) throw new Error(`parity JSON report repeats required a11y evidence name ${name} across results`);
          globalNames.add(name);
        }
        attachmentCount += verifyResultEvidence(requiredResult, requiredNames, `${context} result 0`).length;
      }
    }
  }
  if (attachmentCount === 0) throw new Error("parity JSON report carries no statically required body-backed a11y evidence");
  return { attachmentCount };
}

function assertOwnedParentComponents(cwd: string, expectedUid: number): void {
  const root = canonicalCheckoutRoot(cwd);
  for (const path of [root, resolve(root, "tests"), resolve(root, "tests/parity")]) {
    assertDirectOwnedDirectory(path, expectedUid, false);
  }
}

function prepareParityReportLifecycle(cwd: string, expectedUid?: number): ParityReportIdentity {
  const uid = currentUid(expectedUid);
  assertOwnedParentComponents(cwd, uid);
  const outputDirectory = reportOutputDirectory(cwd);
  try {
    const outputStats = lstatSync(outputDirectory);
    if (outputStats.isSymbolicLink() || !outputStats.isDirectory()) {
      throw new Error(`parity JSON report directory must be one direct directory: ${outputDirectory}`);
    }
    if (outputStats.uid !== uid) throw new Error(`parity JSON report directory is not owned by the current user: ${outputDirectory}`);
    chmodSync(outputDirectory, PRIVATE_DIRECTORY_MODE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    mkdirSync(outputDirectory, { mode: PRIVATE_DIRECTORY_MODE });
  }
  assertDirectOwnedDirectory(outputDirectory, uid, true);

  const path = parityReportPath(cwd);
  try {
    const existing = lstatSync(path);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error(`existing parity JSON report is not one direct regular file: ${path}`);
    }
    if (existing.uid !== uid) throw new Error(`existing parity JSON report is not owned by the current user: ${path}`);
    if (existing.nlink !== 1) throw new Error(`existing parity JSON report must have exactly one link: ${path}`);
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const descriptor = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    PRIVATE_FILE_MODE,
  );
  closeSync(descriptor);
  return readParityReportOnce(cwd, uid).identity;
}

function commandStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status : undefined;
}

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch (error) {
      if (commandStatus(error) !== 128) throw error;
    }
    return;
  }
  // shortcut: one pgrep snapshot, upgrade when a process forked during the kill must die too
  let listed = "";
  try {
    listed = execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  } catch (error) {
    if (commandStatus(error) !== 1) throw error;
  }
  for (const line of listed.split("\n")) {
    if (line.trim() === "") continue;
    const childPid = Number(line);
    if (!Number.isInteger(childPid)) throw new Error(`pgrep returned a non-pid: ${line}`);
    killProcessTree(childPid);
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

export function runChild(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, idleTimeoutMs = 180_000): Promise<ChildResult> {
  const previousUmask = process.umask(0o077);
  const child = (() => {
    try {
      return spawn(command, [...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } finally {
      process.umask(previousUmask);
    }
  })();
  let failure: string | undefined;
  let timer: NodeJS.Timeout | undefined;
  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      failure = `no output for ${idleTimeoutMs}ms`;
      const pid = child.pid;
      if (pid === undefined) {
        child.kill("SIGKILL");
        return;
      }
      try {
        killProcessTree(pid);
      } catch (error) {
        failure = `${failure}; descendant kill failed: ${error instanceof Error ? error.message : String(error)}`;
        child.kill("SIGKILL");
      }
    }, idleTimeoutMs);
  };
  const pipe = (stream: NodeJS.ReadableStream | null, out: NodeJS.WriteStream): void => {
    stream?.on("data", (data: Buffer) => { out.write(data); arm(); });
  };
  arm();
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve({
        code: failure === undefined ? (code ?? 1) : 1,
        detail: failure ?? (signal === null ? `exit ${code}` : `signal ${signal}`),
      });
    };
    child.once("error", (error) => {
      if (failure === undefined) failure = `could not start: ${error.message}`;
      finish(1, null);
    });
    child.once("close", (code, signal) => finish(code, signal));
  });
}

function prepareCommandLockFile(cwd: string): string {
  const path = parityCommandLockPath(cwd);
  const uid = currentUid();
  const root = canonicalCheckoutRoot(cwd);
  assertDirectOwnedDirectory(root, uid, false);
  for (const parent of [resolve(root, ".tracker"), resolve(root, ".tracker/data"), resolve(root, ".tracker/data/locks")]) {
    try {
      mkdirSync(parent, { mode: PRIVATE_DIRECTORY_MODE });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    assertDirectOwnedDirectory(parent, uid, false);
  }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const stats = lstatSync(path);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.uid !== uid || stats.nlink !== 1
        || modeBits(stats.mode) !== PRIVATE_FILE_MODE) {
      throw new Error(`parity JSON command lock path is not one direct private current-user file: ${path}`, {
        cause: error,
      });
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return path;
}

async function acquireCommandLock(cwd: string, lockCommand: string): Promise<HeldCommandLock> {
  const lockPath = prepareCommandLockFile(cwd);
  const previousUmask = process.umask(0o077);
  const holder = (() => {
    try {
      return spawn(
        lockCommand,
        ["-k", "-t", "0", lockPath, process.execPath, "-e", LOCK_HOLDER_SOURCE],
        { cwd, stdio: ["pipe", "pipe", "pipe"] },
      );
    } finally {
      process.umask(previousUmask);
    }
  })();
  let stderr = "";
  holder.stderr.setEncoding("utf8");
  holder.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4_096); });
  const closed = new Promise<ChildResult>((resolveClose) => {
    let spawnError: Error | undefined;
    holder.once("error", (error) => { spawnError = error; });
    holder.once("close", (code, signal) => {
      if (spawnError !== undefined) resolveClose({ code: 1, detail: `could not start: ${spawnError.message}` });
      else if (code !== null) resolveClose({ code, detail: `exit ${String(code)}` });
      else resolveClose({ code: 1, detail: `signal ${signal ?? "unknown"}` });
    });
  });
  const ready = new Promise<boolean>((resolveReady) => {
    let output = "";
    holder.stdout.setEncoding("utf8");
    holder.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output === LOCK_READY) resolveReady(true);
      else if (output.length >= LOCK_READY.length) resolveReady(false);
    });
  });
  const first = await Promise.race([
    ready.then((valid) => ({ kind: "ready" as const, valid })),
    closed.then((result) => ({ kind: "closed" as const, result })),
  ]);
  if (first.kind === "closed") {
    throw new Error(`parity JSON command lock is already held or unavailable (${first.result.detail})${stderr === "" ? "" : `: ${stderr.trim()}`}`);
  }
  if (!first.valid) {
    holder.stdin.end();
    await closed;
    throw new Error("parity JSON command lock holder returned an invalid readiness marker");
  }
  let released = false;
  return {
    release: async () => {
      if (released) throw new Error("parity JSON command lock was released twice");
      released = true;
      holder.stdin.end();
      const result = await closed;
      if (result.code !== 0) throw new Error(`parity JSON command lock holder failed during release (${result.detail})`);
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorObject(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error), { cause: error });
}

function childEnvironment(mode: ParityMode, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  delete childEnv.PARITY_UPDATE;
  if (mode === "update") childEnv.PARITY_UPDATE = "1";
  return childEnv;
}

export async function runParityAndVerify(
  options: RunParityOptions,
  dependencies: RunParityDependencies = {},
): Promise<number> {
  assertParityJsonOutputIsFixed(options.mode, options.env, options.args);
  const lock = await acquireCommandLock(options.cwd, options.lockCommand ?? "/usr/bin/lockf");
  let child: ChildResult | undefined;
  let verifierError: unknown;
  let operationError: unknown;
  try {
    const before = prepareParityReportLifecycle(options.cwd, options.expectedUid);
    const runStartedAtMs = systemClock.nowMs();
    child = await (dependencies.runChild ?? ((command, args, cwd, env) => runChild(command, args, cwd, env, options.inactivityTimeoutMs)))(
      options.command ?? PARITY_PLAYWRIGHT_COMMAND,
      [...(options.commandArgs ?? PARITY_PLAYWRIGHT_ARGS), ...options.args],
      options.cwd,
      childEnvironment(options.mode, options.env),
    );
    try {
      verifyParityJsonReport({
        cwd: options.cwd,
        runStartedAtMs,
        before,
        expectedUid: options.expectedUid,
        afterReportRead: options.afterReportRead,
      });
    } catch (error) {
      verifierError = error;
    }
  } catch (error) {
    operationError = error;
  }
  try {
    await lock.release();
  } catch (error) {
    if (operationError !== undefined) operationError = new AggregateError([operationError, error], "parity command and lock release both failed");
    else if (verifierError !== undefined) verifierError = new AggregateError([verifierError, error], "parity verification and lock release both failed");
    else verifierError = error;
  }
  if (operationError !== undefined) throw errorObject(operationError);
  if (child === undefined) throw new Error("parity command completed without a child result");

  const writeError = options.writeError ?? ((message: string) => process.stderr.write(message));
  if (child.code !== 0) {
    writeError(`Playwright parity command failed first (${child.detail}).\n`);
    if (verifierError !== undefined) writeError(`Parity JSON evidence verification also failed: ${errorMessage(verifierError)}\n`);
    return child.code;
  }
  if (verifierError !== undefined) {
    writeError(`Parity JSON evidence verification failed: ${errorMessage(verifierError)}\n`);
    return 1;
  }
  return 0;
}

function assertParityJsonOutputIsFixed(
  mode: ParityMode,
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): void {
  if (mode !== "assert" && mode !== "update") throw new Error(`unknown parity mode: ${String(mode)}`);
  if (Object.hasOwn(env, "PARITY_UPDATE")) {
    throw new Error("PARITY_UPDATE is wrapper-owned and may not select parity mode from the environment");
  }
  for (const name of PARITY_JSON_ENV_OVERRIDES) {
    if (Object.hasOwn(env, name)) throw new Error(`${name} may not redirect parity JSON evidence`);
  }
  for (const argument of args) {
    if (argument === "--reporter" || argument.startsWith("--reporter=")) {
      throw new Error("--reporter may not suppress the configured parity JSON reporter");
    }
    if (argument === "--config" || argument.startsWith("--config=") || argument.startsWith("-c")) {
      throw new Error("--config may not replace the parity authority configuration");
    }
    if (argument === "--output" || argument.startsWith("--output=")) {
      throw new Error("--output may not redirect or delete parity command artifacts");
    }
    if (argument === "-u" || argument.startsWith("-u=") || /^-u(?:all|changed|missing|none)$/u.test(argument)
        || argument === "--update-snapshots" || argument.startsWith("--update-snapshots=")
        || argument === "--update-source-method" || argument.startsWith("--update-source-method=")) {
      throw new Error(`${argument} may not bypass the wrapper-owned parity mode`);
    }
    if (argument === "--ignore-snapshots" || argument === "--retries" || argument.startsWith("--retries=")) {
      throw new Error(`${argument} may not bypass the wrapper-owned parity assertion/retry policy`);
    }
  }
}

function parseMode(value: string | undefined): ParityMode {
  if (value === "assert" || value === "update") return value;
  throw new Error("parity JSON wrapper requires explicit mode: assert or update");
}

async function main(): Promise<void> {
  const [modeValue, ...args] = process.argv.slice(2);
  process.exitCode = await runParityAndVerify({ cwd: process.cwd(), env: process.env, args, mode: parseMode(modeValue) });
}

const entryPath = process.argv[1];
if (entryPath !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entryPath))) {
  void main().catch((error: unknown) => {
    process.stderr.write(`Parity JSON evidence refused: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
