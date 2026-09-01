import {
  optionalTestTargetSecret,
  SecretSourceError,
  TestTargetSecretReferenceSchema,
  type TestTargetSecretReference,
} from "../src/domain/secrets.js";
import { TestTargetRegistryDefectError } from "../src/control/test-target-registry.js";

type DocumentNumberState = "present" | "refused" | "invalid";
type ResolutionState = "ready" | "blocked" | "defect" | "not-attempted";

export interface TestTargetDocumentNumberSmokeOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly loadCommittedReference?: () => Promise<TestTargetSecretReference>;
  readonly resolveSubject?: (env?: NodeJS.ProcessEnv) => Promise<ResolutionState>;
  readonly readDocumentNumber?: (
    reference: TestTargetSecretReference,
    env?: NodeJS.ProcessEnv,
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
async function resolveCommittedSubject(env?: NodeJS.ProcessEnv): Promise<ResolutionState> {
  const { resolveSeparationsTestTarget, TEST_TARGET_REGISTRY } = await import(
    "../src/control/test-target-registry.js"
  );
  return resolveSeparationsTestTarget(TEST_TARGET_REGISTRY, CANARY_LABEL, env).state;
}

async function subjectResolution(
  resolveSubject: (env?: NodeJS.ProcessEnv) => Promise<ResolutionState>,
  env?: NodeJS.ProcessEnv,
): Promise<ResolutionState> {
  try {
    return await resolveSubject(env);
  } catch (error) {
    if (!(error instanceof TestTargetRegistryDefectError)) throw error;
    // A registry defect names the offending reference/key in its own message;
    // this closed output records only that resolution defected.
    return "defect";
  }
}

/**
 * `env` is passed through untouched: the ONLY reader of the process environment
 * is `optionalTestTargetSecret`'s registered default, so this script adds no
 * environment occurrence of its own.
 */
function documentNumberState(
  reference: TestTargetSecretReference,
  env: NodeJS.ProcessEnv | undefined,
  readDocumentNumber: (reference: TestTargetSecretReference, env?: NodeJS.ProcessEnv) => string | undefined,
): DocumentNumberState {
  try {
    return readDocumentNumber(reference, env) === undefined ? "refused" : "present";
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

  const readDocumentNumber = options.readDocumentNumber ?? ((documentReference, env) =>
    optionalTestTargetSecret(documentReference.name, env)
  );
  const state = documentNumberState(reference, options.env, readDocumentNumber);
  writeLine(`field=documentNumber reference=${reference.name} env=${reference.env} state=${state}`);

  const resolution: ResolutionState = state === "present"
    ? await subjectResolution(options.resolveSubject ?? resolveCommittedSubject, options.env)
    : "not-attempted";
  writeLine(`workflow=separations label=${CANARY_LABEL} resolution=${resolution}`);
  return state === "present" && resolution === "ready" ? 0 : 1;
}
