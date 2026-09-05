import {
  optionalTestTargetSecret,
  SecretSourceError,
  TestTargetSecretReferenceSchema,
  type ProtectedSecretSource,
  type TestTargetSecretReference,
} from "../src/domain/secrets.js";
import { TestTargetRegistryDefectError } from "../src/control/test-target-registry.js";
import { rebuildRuntimeIsolation } from "../src/config/runtime-isolation.js";
import { settingsRootPaths } from "../src/domain/config/settings-root.js";
import { createProtectedSettingsFileAuthority } from "../src/infra/config/settings-file.js";
import { resolve } from "node:path";

type DocumentNumberState = "present" | "refused" | "invalid" | "not-attempted";
type ResolutionState = "ready" | "blocked" | "defect" | "not-attempted";

export interface TestTargetDocumentNumberSmokeOptions {
  readonly protectedSecrets?: ProtectedSecretSource;
  readonly loadCommittedReference?: () => Promise<TestTargetSecretReference>;
  readonly resolveSubject?: (source: ProtectedSecretSource) => Promise<ResolutionState>;
  readonly readDocumentNumber?: (
    reference: TestTargetSecretReference,
    source: ProtectedSecretSource,
  ) => string | undefined;
  readonly writeLine?: (line: string) => void;
}

const CANARY_LABEL = "finalization-canary";

async function committedReference(): Promise<TestTargetSecretReference> {
  const { SEPARATIONS_WORKFLOW, TEST_TARGET_REGISTRY } = await import(
    "../src/control/test-target-registry.js"
  );
  const target = TEST_TARGET_REGISTRY.targets.find(({ label }) => label === CANARY_LABEL);
  const document = target?.workflows[SEPARATIONS_WORKFLOW]?.publicInput.document;
  if (document === undefined) throw new Error("the committed finalization-canary has no separations arm");
  if (document.state !== "configured") {
    throw new Error("the committed finalization-canary declares no configured document reference");
  }
  return TestTargetSecretReferenceSchema.parse(document.reference);
}

/**
 * The same resolution the CLI's `dry-run-scenario separations` path performs
 * before any browser starts: the configured number through the descriptor's
 * own start-box parser, ingress and canonical schemas.
 */
function runtimeProtectedSecrets(): ProtectedSecretSource {
  const stateRoot = resolve(process.cwd(), rebuildRuntimeIsolation.stateRoot);
  const authority = createProtectedSettingsFileAuthority({
    path: settingsRootPaths(stateRoot).ordinary,
    assertWriteIdAvailable: () => undefined,
  });
  return { read: () => authority.read() };
}

async function resolveCommittedSubject(source: ProtectedSecretSource): Promise<ResolutionState> {
  const { resolveSeparationsTestTarget, TEST_TARGET_REGISTRY } = await import(
    "../src/control/test-target-registry.js"
  );
  return resolveSeparationsTestTarget(TEST_TARGET_REGISTRY, CANARY_LABEL, source).state;
}

async function subjectResolution(
  resolveSubject: (source: ProtectedSecretSource) => Promise<ResolutionState>,
  source: ProtectedSecretSource,
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

/**
 * The protected source is passed through untouched and read on each use.
 */
function documentNumberState(
  reference: TestTargetSecretReference,
  source: ProtectedSecretSource,
  readDocumentNumber: (reference: TestTargetSecretReference, source: ProtectedSecretSource) => string | undefined,
): DocumentNumberState {
  try {
    return readDocumentNumber(reference, source) === undefined ? "refused" : "present";
  } catch (error) {
    if (!(error instanceof SecretSourceError)) throw error;
    // The value is malformed for the document-number schema. Its message names
    // only the reference and key, but this output is closed to state anyway.
    return "invalid";
  }
}

/**
 * Read-only pre-run admission for the ONE canary value (D300): is the
 * registered document-number key set, does it satisfy the Kuali document-number
 * schema, and does the composed `separations` subject resolve `ready` from it?
 * Output is closed to public metadata + state — the number is never printed,
 * so the transcript can be preserved as evidence without redaction.
 */
export async function runTestTargetDocumentNumberSmoke(
  options: TestTargetDocumentNumberSmokeOptions = {},
): Promise<number> {
  const writeLine = options.writeLine ?? ((line: string) => process.stdout.write(`${line}\n`));
  let reference: TestTargetSecretReference;
  try {
    reference = TestTargetSecretReferenceSchema.parse(await (options.loadCommittedReference ?? committedReference)());
  } catch {
    throw new Error("committed canary document-number registry unavailable");
  }

  const protectedSecrets = options.protectedSecrets ?? runtimeProtectedSecrets();
  const resolution = await subjectResolution(options.resolveSubject ?? resolveCommittedSubject, protectedSecrets);
  const readDocumentNumber = options.readDocumentNumber ?? ((documentReference, source) =>
    optionalTestTargetSecret(documentReference.name, source)
  );
  const state = resolution === "ready"
    ? documentNumberState(reference, protectedSecrets, readDocumentNumber)
    : "not-attempted";
  writeLine(`field=documentNumber reference=${reference.name} source=protected-store state=${state}`);

  const reportedResolution: ResolutionState = resolution === "ready" && state !== "present"
    ? "not-attempted"
    : resolution;
  writeLine(`workflow=separations label=${CANARY_LABEL} resolution=${reportedResolution}`);
  return state === "present" && reportedResolution === "ready" ? 0 : 1;
}
