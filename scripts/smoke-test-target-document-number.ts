import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TestTargetRegistryDefectError } from "../src/backend/app/control/test-target-registry.js";
import { createTestDataInputSource, testDataLocalPath } from "../src/backend/app/control/test-data.js";
import { assertNoMigratedEnvironmentKeys } from "../src/domain/secrets.js";
import {
  TestDataInputReferenceSchema,
  TestDataLocalConfigError,
  type TestDataInputReference,
  type TestDataInputSource,
} from "../src/domain/test-data.js";

type DocumentNumberState = "present" | "refused" | "invalid" | "not-attempted";
type ResolutionState = "ready" | "blocked" | "defect" | "not-attempted";

export interface TestTargetDocumentNumberSmokeOptions {
  readonly testInputs?: TestDataInputSource;
  readonly loadCommittedReference?: () => Promise<TestDataInputReference>;
  readonly resolveSubject?: (source: TestDataInputSource) => Promise<ResolutionState>;
  readonly readDocumentNumber?: (
    reference: TestDataInputReference,
    source: TestDataInputSource,
  ) => string | undefined;
  readonly writeLine?: (line: string) => void;
}

const CANARY_LABEL = "finalization-canary";

async function committedReference(): Promise<TestDataInputReference> {
  const { SEPARATIONS_WORKFLOW, TEST_TARGET_REGISTRY } = await import(
    "../src/backend/app/control/test-target-registry.js"
  );
  const target = TEST_TARGET_REGISTRY.targets.find(({ label }) => label === CANARY_LABEL);
  const document = target?.workflows[SEPARATIONS_WORKFLOW]?.publicInput.document;
  if (document === undefined) throw new Error("the committed finalization-canary has no separations arm");
  if (document.state !== "configured") {
    throw new Error("the committed finalization-canary declares no configured document reference");
  }
  return TestDataInputReferenceSchema.parse(document.reference);
}

/**
 * The same private source the CLI's `dry-run-scenario separations` path reads
 * before any browser starts: THIS checkout's ignored `config/test-data.local.json`,
 * captured once (D341). Never the caller's CWD, never protected Settings.
 */
function checkoutTestInputs(): TestDataInputSource {
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  return createTestDataInputSource(testDataLocalPath(repoRoot));
}

async function resolveCommittedSubject(source: TestDataInputSource): Promise<ResolutionState> {
  const { resolveSeparationsTestTarget, TEST_TARGET_REGISTRY } = await import(
    "../src/backend/app/control/test-target-registry.js"
  );
  return resolveSeparationsTestTarget(TEST_TARGET_REGISTRY, CANARY_LABEL, source).state;
}

async function subjectResolution(
  resolveSubject: (source: TestDataInputSource) => Promise<ResolutionState>,
  source: TestDataInputSource,
): Promise<ResolutionState> {
  try {
    return await resolveSubject(source);
  } catch (error) {
    if (!(error instanceof TestTargetRegistryDefectError)) throw error;
    // A registry defect names the offending reference/key in its own message;
    // this closed output records only that resolution defected.
    return "defect";
  }
}

function documentNumberState(
  reference: TestDataInputReference,
  source: TestDataInputSource,
  readDocumentNumber: (reference: TestDataInputReference, source: TestDataInputSource) => string | undefined,
): DocumentNumberState {
  try {
    return readDocumentNumber(reference, source) === undefined ? "refused" : "present";
  } catch (error) {
    if (!(error instanceof TestDataLocalConfigError)) throw error;
    // The private file or its value is malformed. Its message names only the
    // file and key, but this output is closed to state anyway.
    return "invalid";
  }
}

/**
 * Read-only pre-run admission for the ONE canary value (D300/D341): is the
 * registered document-number input set in the private test-data file, does it
 * satisfy the Kuali document-number schema, and does the composed `separations`
 * subject resolve `ready` from it? Output is closed to public metadata + state
 * — the number is never printed, so the transcript can be preserved as
 * evidence without redaction.
 */
export async function runTestTargetDocumentNumberSmoke(
  options: TestTargetDocumentNumberSmokeOptions = {},
): Promise<number> {
  assertNoMigratedEnvironmentKeys();
  const writeLine = options.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
  let reference: TestDataInputReference;
  try {
    reference = TestDataInputReferenceSchema.parse(await (options.loadCommittedReference ?? committedReference)());
  } catch {
    throw new Error("committed canary document-number registry unavailable");
  }

  const testInputs = options.testInputs ?? checkoutTestInputs();
  const resolution = await subjectResolution(options.resolveSubject ?? resolveCommittedSubject, testInputs);
  const readDocumentNumber = options.readDocumentNumber ?? ((documentReference, source) =>
    source.read(documentReference.name)?.value
  );
  const state = resolution === "ready"
    ? documentNumberState(reference, testInputs, readDocumentNumber)
    : "not-attempted";
  writeLine(`field=documentNumber reference=${reference.name} source=test-data-local state=${state}`);

  const reportedResolution: ResolutionState = resolution === "ready" && state !== "present"
    ? "not-attempted"
    : resolution;
  writeLine(`workflow=separations label=${CANARY_LABEL} resolution=${reportedResolution}`);
  return state === "present" && reportedResolution === "ready" ? 0 : 1;
}
