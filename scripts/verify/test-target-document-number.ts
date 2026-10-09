import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TestTargetRegistryDefectError } from "../../src/backend/app/registries/test-target-registry.js";
import { createTestDataInputSource, testDataLocalPath } from "../../src/backend/app/registries/test-data.js";
import { assertNoMigratedEnvironmentKeys } from "../../src/models/config/secrets.js";
import {
  TestDataInputReferenceSchema,
  TestDataLocalConfigError,
  type TestDataInputReference,
  type TestDataInputSource,
} from "../../src/models/config/test-data.js";

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
    "../../src/backend/app/registries/test-target-registry.js"
  );
  const target = TEST_TARGET_REGISTRY.targets.find(({ label }) => label === CANARY_LABEL);
  const document = target?.workflows[SEPARATIONS_WORKFLOW]?.publicInput.document;
  if (document === undefined) throw new Error("the committed finalization-canary has no separations arm");
  if (document.state !== "configured") {
    throw new Error("the committed finalization-canary declares no configured document reference");
  }
  return TestDataInputReferenceSchema.parse(document.reference);
}

/** This checkout's ignored `config/test-data.local.json`, never the caller's CWD or protected Settings. */
function checkoutTestInputs(): TestDataInputSource {
  const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  return createTestDataInputSource(testDataLocalPath(repoRoot));
}

async function resolveCommittedSubject(source: TestDataInputSource): Promise<ResolutionState> {
  const { resolveSeparationsTestTarget, TEST_TARGET_REGISTRY } = await import(
    "../../src/backend/app/registries/test-target-registry.js"
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

/** Read-only admission whose output stays public metadata/state, so retained evidence cannot expose the canary number. */
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
