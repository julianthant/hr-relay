
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";
import {
  readTestDataFileBytes,
  readTestDataLocalConfig,
  readTestDataShared,
  testDataLocalFilePath,
  testDataLocalPath,
  testDataLocalPresence,
  testDataInputSourceFrom,
  absentTestDataInputSource,
  type TestDataLocalReadOutcome,
  type TestDataShared,
} from "../registries/test-data.js";
import {
  PERSON_LOOKUP_WORKFLOW,
  SEPARATIONS_WORKFLOW,
  FINALIZATION_WORKFLOW,
  TestTargetRegistryDefectError,
  resolvePersonLookupTestTarget,
  resolveSeparationsKualiFinalizationTestTarget,
  resolveSeparationsTestTarget,
  type TestTargetManifestView,
} from "../registries/test-target-registry.js";
import {
  TEST_DATA_CONFIG_PATH,
  TEST_DATA_LOCAL_CONFIG_PATH,
  TestDataConfigError,
  TestDataLocalConfigError,
  type TestDataInputSource,
} from "../../../models/config/test-data.js";
import { realpathSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { TEST_DATA_USAGE } from "../../runs/provenance/test-data-usage.js";
import {
  migrateTestDataFromCredentials,
  type CredentialTestDataMigrationReport,
} from "../../storage/configuration/credential-test-data-migration.js";

export interface TestDataCommandOutcome {
  readonly output: string;
  readonly exitCode: 0 | 1 | 2;
}

export interface TestDataComposeDependencies {
  /** Every registered T1b manifest, for bidirectional subject/manifest correspondence. */
  readonly loadManifests: () => Promise<readonly TestTargetManifestView[]>;
  readonly now?: () => Date;
}

export { TEST_DATA_USAGE } from "../../runs/provenance/test-data-usage.js";

type SubjectState = "ready" | "blocked" | "defect";
interface SubjectReport {
  readonly label: string;
  readonly workflow: string;
  readonly state: SubjectState;
  readonly reason?: string;
}
interface FileReport {
  readonly name: string;
  readonly source: "shared" | "local";
  readonly state: "readable" | "missing" | "not-declared" | "invalid";
  readonly reason?: string;
}

interface ParsedCheck {
  readonly command: "check";
  readonly json: true;
  readonly subject?: string;
  readonly workflow?: string;
  readonly file?: string;
}
interface ParsedMigrate {
  readonly command: "migrate";
  readonly json: true;
  readonly plan: boolean;
}

class TestDataUsageError extends Error {
  override readonly name = "TestDataUsageError";
}

function parseArguments(args: readonly string[]): ParsedCheck | ParsedMigrate {
  const [command, ...rest] = args;
  if (command === "check") {
    let json = false;
    let subject: string | undefined;
    let workflow: string | undefined;
    let file: string | undefined;
    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--json") { json = true; continue; }
      if (token === "--subject" || token === "--workflow" || token === "--file") {
        const value = rest[index + 1];
        if (value === undefined || value.startsWith("--")) throw new TestDataUsageError(`${token} needs a value`);
        if (token === "--subject") { if (subject !== undefined) throw new TestDataUsageError("--subject given twice"); subject = value; }
        if (token === "--workflow") { if (workflow !== undefined) throw new TestDataUsageError("--workflow given twice"); workflow = value; }
        if (token === "--file") { if (file !== undefined) throw new TestDataUsageError("--file given twice"); file = value; }
        index += 1;
        continue;
      }
      throw new TestDataUsageError(`unknown test-data check option ${String(token)}`);
    }
    if (!json) throw new TestDataUsageError("test-data check requires --json");
    if (workflow !== undefined && subject === undefined) throw new TestDataUsageError("--workflow requires --subject");
    return { command: "check", json: true, ...(subject === undefined ? {} : { subject }),
      ...(workflow === undefined ? {} : { workflow }), ...(file === undefined ? {} : { file }) };
  }
  if (command === "migrate") {
    let json = false;
    let plan = false;
    let fromCredentials = false;
    for (const token of rest) {
      if (token === "--json") { json = true; continue; }
      if (token === "--plan") { plan = true; continue; }
      if (token === "--from-credentials") { fromCredentials = true; continue; }
      throw new TestDataUsageError(`unknown test-data migrate option ${token}`);
    }
    if (!fromCredentials) throw new TestDataUsageError("test-data migrate requires --from-credentials");
    if (!json) throw new TestDataUsageError("test-data migrate requires --json");
    return { command: "migrate", json: true, plan };
  }
  throw new TestDataUsageError(`unknown test-data command ${String(command)}; usage:\n  ${TEST_DATA_USAGE.join("\n  ")}`);
}

function sourceFor(local: TestDataLocalReadOutcome): TestDataInputSource {
  return local.state === "absent" ? absentTestDataInputSource() : testDataInputSourceFrom(local.config);
}

function resolveSubject(shared: TestDataShared, label: string, workflow: string, source: TestDataInputSource): SubjectReport {
  try {
    const resolution = workflow === FINALIZATION_WORKFLOW
      ? resolveSeparationsKualiFinalizationTestTarget(shared.subjects, label)
      : workflow === SEPARATIONS_WORKFLOW
        ? resolveSeparationsTestTarget(shared.subjects, label, source)
        : workflow === PERSON_LOOKUP_WORKFLOW
          ? resolvePersonLookupTestTarget(shared.subjects, label, source)
          : undefined;
    if (resolution === undefined) return { label, workflow, state: "defect", reason: `no resolver for workflow ${workflow}` };
    return resolution.state === "ready"
      ? { label, workflow, state: "ready" }
      : { label, workflow, state: "blocked", reason: resolution.reason };
  } catch (error) {
    if (error instanceof TestTargetRegistryDefectError) return { label, workflow, state: "defect", reason: error.message };
    throw error;
  }
}

function subjectReports(shared: TestDataShared, label: string, workflow: string | undefined, source: TestDataInputSource): readonly SubjectReport[] {
  const target = shared.subjects.targets.find((candidate) => candidate.label === label);
  const arms = target === undefined ? [] : Object.keys(target.workflows).sort();
  if (workflow !== undefined) return [resolveSubject(shared, label, workflow, source)];
  if (target === undefined) return [{ label, workflow: "*", state: "blocked", reason: `blocked: needs ${label}; no such subject` }];
  return arms.map((arm) => resolveSubject(shared, label, arm, source));
}

function readPdfHead(path: string): "readable" | "missing" | "invalid" {
  let descriptor: number;
  try {
    const real = realpathSync(path);
    if (!statSync(real).isFile()) return "invalid";
    descriptor = openSync(real, "r");
  } catch {
    return "missing";
  }
  try {
    const head = Buffer.alloc(5);
    const read = readSync(descriptor, head, 0, 5, 0);
    return read === 5 && head.equals(Buffer.from("%PDF-")) ? "readable" : "invalid";
  } finally {
    closeSync(descriptor);
  }
}

function fileReport(shared: TestDataShared, local: TestDataLocalReadOutcome, name: string): FileReport {
  if (shared.files.some((file) => file.name === name)) {
    try {
      readTestDataFileBytes(shared, name);
      return { name, source: "shared", state: "readable" };
    } catch (error) {
      if (!(error instanceof TestDataConfigError)) throw error;
      return { name, source: "shared", state: error.message.includes("missing") ? "missing" : "invalid", reason: error.message };
    }
  }
  const privatePath = testDataLocalFilePath(local, name);
  if (privatePath === undefined) {
    return { name, source: "local", state: "not-declared", reason: `no file named ${name} in ${TEST_DATA_CONFIG_PATH} or ${TEST_DATA_LOCAL_CONFIG_PATH}` };
  }
  // Private paths are never echoed: the declared name and state are the whole report.
  return { name, source: "local", state: readPdfHead(privatePath) };
}

export async function composeTestDataCommand(
  admission: import("../../storage/admission/admission.js").RuntimeAdmission,
  _isolation: RuntimeIsolation,
  args: readonly string[],
  repoRoot: string,
  dependencies: TestDataComposeDependencies,
): Promise<TestDataCommandOutcome> {
  let parsed: ParsedCheck | ParsedMigrate;
  try {
    parsed = parseArguments(args);
  } catch (error) {
    if (!(error instanceof TestDataUsageError)) throw error;
    return { output: `${JSON.stringify({ command: "test-data", status: "defect", reason: error.message }, null, 2)}\n`, exitCode: 2 };
  }
  if (parsed.command === "migrate") {
    const report: CredentialTestDataMigrationReport = await migrateTestDataFromCredentials({
      admission,
      stateRoot: admission.stateRoot,
      localPath: testDataLocalPath(repoRoot),
      mode: parsed.plan ? "plan" : "apply",
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
    });
    const exitCode = report.status === "defect" ? 2 : report.status === "refused" ? 1 : 0;
    return { output: `${JSON.stringify({ command: "test-data migrate", ...report }, null, 2)}\n`, exitCode };
  }

  let shared: TestDataShared;
  try {
    shared = readTestDataShared(repoRoot, await dependencies.loadManifests());
  } catch (error) {
    if (!(error instanceof TestDataConfigError) && !(error instanceof TestTargetRegistryDefectError)) throw error;
    return { output: `${JSON.stringify({ command: "test-data check", status: "defect", shared: { path: TEST_DATA_CONFIG_PATH, state: "invalid", reason: error.message } }, null, 2)}\n`, exitCode: 2 };
  }
  const sharedReport = {
    path: TEST_DATA_CONFIG_PATH,
    state: "valid",
    subjects: shared.subjects.targets.map((target) => ({
      label: target.label,
      availability: { state: target.availability.state, lastObserved: target.availability.lastObserved },
      workflows: Object.keys(target.workflows).sort(),
    })),
    files: shared.files.map((file) => ({ name: file.name, kind: file.kind, state: readPdfHead(file.path) })),
    samples: Object.fromEntries(Object.entries(shared.samples).map(([key, values]) => [key, values.length])),
  };
  let local: TestDataLocalReadOutcome;
  let localReport: Record<string, unknown>;
  let localDefect: string | undefined;
  try {
    local = readTestDataLocalConfig(testDataLocalPath(repoRoot));
    localReport = { path: TEST_DATA_LOCAL_CONFIG_PATH, ...testDataLocalPresence(local) };
  } catch (error) {
    if (!(error instanceof TestDataLocalConfigError)) throw error;
    local = { state: "absent", path: testDataLocalPath(repoRoot) };
    localDefect = error.message;
    localReport = { path: TEST_DATA_LOCAL_CONFIG_PATH, state: "invalid", reason: error.message };
  }
  const subjects = parsed.subject === undefined ? undefined
    : localDefect !== undefined && parsed.subject !== undefined
      ? subjectReports(shared, parsed.subject, parsed.workflow, {
        read: () => { throw new TestDataLocalConfigError(localDefect ?? "private test-data file is invalid"); },
      })
      : subjectReports(shared, parsed.subject, parsed.workflow, sourceFor(local));
  const file = parsed.file === undefined ? undefined : fileReport(shared, local, parsed.file);

  const defect = localDefect !== undefined
    || (subjects?.some((subject) => subject.state === "defect") ?? false)
    || sharedReport.files.some((entry) => entry.state !== "readable")
    || file?.state === "invalid";
  const blocked = (subjects?.some((subject) => subject.state === "blocked") ?? false)
    || (file !== undefined && file.state !== "readable");
  const status = defect ? "defect" : blocked ? "blocked" : "ok";
  const output = {
    command: "test-data check",
    status,
    shared: sharedReport,
    local: localReport,
    ...(subjects === undefined ? {} : { subjects }),
    ...(file === undefined ? {} : { file }),
  };
  return { output: `${JSON.stringify(output, null, 2)}\n`, exitCode: status === "ok" ? 0 : status === "blocked" ? 1 : 2 };
}
