import { readFileSync } from "node:fs";
import { z } from "zod";
import { deepFreeze } from "../domain/immutability.js";
import {
  optionalTestTargetEidSecret,
  TestTargetEidSecretReferenceSchema,
} from "../domain/secrets.js";
import { parseInputRunText, toRawSubmission } from "../domain/workflow/ingress.js";
import {
  SeparationsCanonicalInput,
  SeparationsInput,
  separationsDescriptor,
} from "../workflows/separations/descriptor.js";
import {
  SeparationsKualiFinalizationCanonicalInput,
  SeparationsKualiFinalizationInput,
} from "../workflows/separations/kuali-finalization/descriptor.js";

export const TEST_TARGET_REGISTRY_PATH = "config/test-subjects.json";

export const FINALIZATION_WORKFLOW = "separations-kuali-finalization";
export const SEPARATIONS_WORKFLOW = "separations";

/**
 * What a live finalization subject can truthfully BE. The scenario matrix's
 * other arms (`already-present`, `no-active-job`, `ambiguous-name`,
 * `subject-mismatch`, `name-differs`, `concurrent-jobs`) are manifest
 * vocabulary — they live in `DryRunSubjectKindSchema`, where a manifest case
 * names them — and D284 retired the entries that claimed them here, because no
 * live subject exercises one. A kind this registry cannot honour is a lie about
 * a real document, so it is not offered.
 */
export const SeparationsKualiFinalizationSubjectKindSchema = z.enum(["ordinary"]);

/**
 * What a subject of the COMPOSED separations chain is for: the full-chain
 * rehearsal role, and the controlled-commit role D280 names. Doc 03b's other
 * migration roles retired with D284 along with the documents that carried them.
 */
export const SeparationsChainSubjectKindSchema = z.enum([
  "full-chain-dry-run",
  "controlled-commit-candidate",
]);

export const TestTargetAvailabilitySchema = z.strictObject({
  state: z.enum(["available", "consumed", "gone", "unknown"]),
  lastObserved: z.iso.date(),
  reason: z.string().min(1),
});

export const TestTargetProvenanceSchema = z.strictObject({
  document: z.string().min(1),
  section: z.string().min(1),
});

/**
 * The exact first-workflow ingress with its two EID-bearing leaves removed.
 * Every remaining field is explicit and strict in config; `.partial()` lets a
 * subject record only what was actually observed — what is MISSING is then
 * either declared `pending` below, or a registry defect.
 */
export const SeparationsKualiFinalizationPublicTestInputSchema =
  SeparationsKualiFinalizationInput.omit({ emplId: true, documentEid: true }).partial();

export const TestTargetEidInputSchema = z.strictObject({
  emplId: TestTargetEidSecretReferenceSchema.optional(),
  documentEid: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), eid: TestTargetEidSecretReferenceSchema }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ]).optional(),
});

/**
 * The canonical leaves a live READ cannot supply, each with the reason it is
 * absent. All three are values a real run receives from upstream work, not from
 * the document: `transactionNumber` exists only after the UCPath filing ② files
 * it, `timekeeperComments` is composed by the chain, and
 * `terminationEffectiveDate` is EMPTY on the live form — the finalization stages
 * it from the chain's `dates` node (separation date + 1). Declaring them here is
 * what separates "the registry is telling the truth and the run is not ready"
 * from "the registry is wrong" — the first blocks by name, the second is a
 * defect.
 */
const FinalizationPendingShape = {
  transactionNumber: z.string().min(1).optional(),
  timekeeperComments: z.string().min(1).optional(),
  terminationEffectiveDate: z.string().min(1).optional(),
};

export const SeparationsKualiFinalizationPendingSchema = z
  .strictObject(FinalizationPendingShape)
  // `pending: {}` would parse as "nothing is pending" while LOOKING like a
  // declaration, so the arm would resolve past the pending gate, spend the EID
  // secret and defect at canonical parse. An arm with nothing pending omits the
  // block entirely.
  //
  // The predicate is over the declared REASONS, not the keys: zod's parsed
  // object still owns a key whose value was an explicit `undefined`, so
  // `Object.keys(pending).length > 0` passed `{ transactionNumber: undefined }`
  // — the same empty claim spelled with a key, and the exact input this schema
  // exists to refuse. A field is pending only when it carries the reason it is.
  .refine((pending) => Object.values(pending).some((reason) => reason !== undefined), {
    message: "pending declares no field; an arm with nothing pending omits the block",
  });

type FinalizationPendingField = keyof typeof FinalizationPendingShape;

/**
 * Fixed report order, so a blocked reason never depends on JSON key order. The
 * `satisfies Record<FinalizationPendingField, number>` is the exhaustiveness
 * half: a key added to the pending schema and not ranked here is a COMPILE
 * error, never a leaf the resolver skips on its way to spending the EID secret
 * and defecting at canonical parse (the blocked/defect inversion D284 forbids).
 */
const FINALIZATION_PENDING_ORDER = {
  transactionNumber: 0,
  timekeeperComments: 1,
  terminationEffectiveDate: 2,
} satisfies Record<FinalizationPendingField, number>;

function isFinalizationPendingField(key: string): key is FinalizationPendingField {
  return Object.hasOwn(FINALIZATION_PENDING_ORDER, key);
}

/** DERIVED from the schema's own shape, then ranked — never hand-duplicated. */
const FINALIZATION_PENDING_FIELDS: readonly FinalizationPendingField[] =
  Object.keys(FinalizationPendingShape)
    .map((key) => {
      if (!isFinalizationPendingField(key)) {
        throw new Error(`pending schema declares ${key}, which the finalization report order does not rank`);
      }
      return key;
    })
    .sort((left, right) => FINALIZATION_PENDING_ORDER[left] - FINALIZATION_PENDING_ORDER[right]);

export const SeparationsKualiFinalizationArmSchema = z.strictObject({
  kind: SeparationsKualiFinalizationSubjectKindSchema,
  publicInput: SeparationsKualiFinalizationPublicTestInputSchema,
  secretInput: TestTargetEidInputSchema.optional(),
  pending: SeparationsKualiFinalizationPendingSchema.optional(),
});

/**
 * A Kuali document number is not a person, so it lives in the repo — but
 * "no subject exists" is a real, recorded state, and it is spelled out rather
 * than left as a missing key.
 */
export const SeparationsChainSubjectDocumentSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), documentNumber: z.string().regex(/^[0-9]{1,8}$/) }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

export const SeparationsChainArmSchema = z.strictObject({
  kind: SeparationsChainSubjectKindSchema,
  publicInput: z.strictObject({ document: SeparationsChainSubjectDocumentSchema }),
});

/**
 * ONE subject, one arm per workflow that can address it (D284). The subject is
 * the document; an arm is what a given workflow needs of it. Both arms are
 * optional because a subject may genuinely be addressable by only one workflow
 * — `parseTestTargetRegistry` refuses a subject that declares neither, and each
 * resolver refuses BY NAME when the arm it needs is absent.
 */
export const TestTargetWorkflowArmsSchema = z.strictObject({
  [SEPARATIONS_WORKFLOW]: SeparationsChainArmSchema.optional(),
  [FINALIZATION_WORKFLOW]: SeparationsKualiFinalizationArmSchema.optional(),
});

/**
 * Every entry carries these, whatever workflow addresses it: what the subject is
 * FOR (`purpose`, doc 03b's "what it is good for" column), the dated
 * availability claim — a fact about the DOCUMENT, not about one workflow — the
 * record that observed it, and D85's usage rules.
 */
export const TestTargetRegistryEntrySchema = z.strictObject({
  label: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  availability: TestTargetAvailabilitySchema,
  provenance: TestTargetProvenanceSchema,
  usagePolicy: z.enum(["read-only", "write-allowed-if-restored"]),
  cleanupObligation: z.string().min(1),
  owner: z.string().min(1),
  purpose: z.string().min(1),
  workflows: TestTargetWorkflowArmsSchema,
});

export const TestTargetRegistrySchema = z.strictObject({
  schemaVersion: z.literal(2),
  targets: z.array(TestTargetRegistryEntrySchema),
});

export type TestTargetRegistryInput = z.input<typeof TestTargetRegistrySchema>;
export type TestTargetRegistry = z.output<typeof TestTargetRegistrySchema>;
export type TestTargetRegistryEntry = TestTargetRegistry["targets"][number];

export const TestTargetBlockedResolutionSchema = z.strictObject({
  state: z.literal("blocked"),
  label: z.string().min(1),
  reason: z.string().min(1),
});
export const SeparationsKualiFinalizationReadyTestTargetSchema = z.strictObject({
  state: z.literal("ready"),
  label: z.string().min(1),
  canonicalInput: SeparationsKualiFinalizationCanonicalInput,
});
export const SeparationsKualiFinalizationTestTargetResolutionSchema = z.discriminatedUnion("state", [
  TestTargetBlockedResolutionSchema,
  SeparationsKualiFinalizationReadyTestTargetSchema,
]);
export type SeparationsKualiFinalizationTestTargetResolution =
  z.output<typeof SeparationsKualiFinalizationTestTargetResolutionSchema>;

export const SeparationsReadyTestTargetSchema = z.strictObject({
  state: z.literal("ready"),
  label: z.string().min(1),
  canonicalInput: SeparationsCanonicalInput,
});
export const SeparationsTestTargetResolutionSchema = z.discriminatedUnion("state", [
  TestTargetBlockedResolutionSchema,
  SeparationsReadyTestTargetSchema,
]);
export type SeparationsTestTargetResolution =
  z.output<typeof SeparationsTestTargetResolutionSchema>;

export class TestTargetRegistryDefectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestTargetRegistryDefectError";
  }
}

export type TestTargetManifestView = Readonly<{
  workflow: string;
  cases: readonly Readonly<{ subjectLabel: string; subjectKind: string }>[];
}>;

/**
 * Every arm key the schema declares, in the schema's own shape order. Deriving
 * this from `TestTargetWorkflowArmsSchema.shape` — rather than hand-listing the
 * two constants — means a third arm added to the schema is picked up here for
 * free instead of silently missing from `declaredWorkflows`'s output.
 */
const WORKFLOW_ARM_KEYS = Object.keys(TestTargetWorkflowArmsSchema.shape) as ReadonlyArray<
  keyof typeof TestTargetWorkflowArmsSchema.shape
>;

/** Which workflows this subject declares an arm for, in the schema's fixed order. */
function declaredWorkflows(target: TestTargetRegistryEntry): readonly string[] {
  return WORKFLOW_ARM_KEYS.filter((workflow) => target.workflows[workflow] !== undefined);
}

/** Every workflow id a resolver in this module models, in one fixed order. */
const MODELLED_WORKFLOWS = [SEPARATIONS_WORKFLOW, FINALIZATION_WORKFLOW] as const;

type ModelledWorkflow = (typeof MODELLED_WORKFLOWS)[number];

function isModelledWorkflow(workflow: string): workflow is ModelledWorkflow {
  return MODELLED_WORKFLOWS.some((modelled) => modelled === workflow);
}

/**
 * The arm a workflow id addresses, without an index signature: the id is
 * narrowed to a MODELLED workflow first, so `undefined` here means exactly one
 * thing — this subject declares no arm for a workflow that does have a resolver
 * — and never "nobody models that id at all", which is a different mistake with
 * a different fix. A prototype key such as `constructor` cannot reach this.
 *
 * The narrowed id indexes the arms object DIRECTLY rather than through a
 * two-way ternary. The ternary's else branch answered with the FINALIZATION arm
 * for every id that was not `separations`, so a third member added to
 * `MODELLED_WORKFLOWS` would have been compared against the wrong arm — a
 * silently passing manifest check, not a compile error. Indexing makes that
 * third member a COMPILE error until `TestTargetWorkflowArmsSchema` grows its
 * arm, and answers with the right one the moment it does.
 */
function workflowArm(
  target: TestTargetRegistryEntry,
  workflow: ModelledWorkflow,
): Readonly<{ kind: string }> | undefined {
  return target.workflows[workflow];
}

function missingArmMessage(target: TestTargetRegistryEntry, workflow: string): string {
  return `test target ${target.label} declares no ${workflow} arm; it declares ${declaredWorkflows(target).join(", ")}`;
}

function assertManifestCompatibility(
  registry: TestTargetRegistry,
  manifests: readonly TestTargetManifestView[],
): void {
  for (const manifest of manifests) {
    // An id no resolver models is a defect in the MANIFEST, and it is checked
    // before any entry is consulted: "declares no <workflow> arm" would send the
    // reader to config to add an arm for a workflow that has no resolver at all.
    if (!isModelledWorkflow(manifest.workflow)) {
      throw new Error(
        `no resolver models workflow ${manifest.workflow}; modelled: ${MODELLED_WORKFLOWS.join(", ")}`,
      );
    }
    for (const scenario of manifest.cases) {
      const target = registry.targets.find(({ label }) => label === scenario.subjectLabel);
      if (target === undefined) {
        throw new Error(
          `dry-run manifest ${manifest.workflow} label ${scenario.subjectLabel} has no test target registry entry`,
        );
      }
      const arm = workflowArm(target, manifest.workflow);
      if (arm === undefined) throw new Error(missingArmMessage(target, manifest.workflow));
      if (arm.kind !== scenario.subjectKind) {
        throw new Error(
          `test target ${target.label} arm ${manifest.workflow} kind ${arm.kind} does not match manifest kind ${scenario.subjectKind}`,
        );
      }
    }
  }
}

/**
 * A field cannot be BOTH observed and pending: one of the two claims is false,
 * and which one it is cannot be guessed from config.
 */
function assertPendingFieldsAreAbsent(target: TestTargetRegistryEntry): void {
  const arm = target.workflows[FINALIZATION_WORKFLOW];
  if (arm?.pending === undefined) return;
  for (const field of FINALIZATION_PENDING_FIELDS) {
    if (arm.pending[field] !== undefined && arm.publicInput[field] !== undefined) {
      throw new Error(
        `test target ${target.label} declares ${field} both observed and pending for ${FINALIZATION_WORKFLOW}`,
      );
    }
  }
}

export function parseTestTargetRegistry(
  input: unknown,
  manifests: readonly TestTargetManifestView[] = [],
): TestTargetRegistry {
  const registry = TestTargetRegistrySchema.parse(input);
  const labels = registry.targets.map(({ label }) => label);
  const duplicate = labels.find((label, index) => labels.indexOf(label) !== index);
  if (duplicate !== undefined) throw new Error(`test target registry repeats label ${duplicate}`);
  for (const target of registry.targets) {
    if (declaredWorkflows(target).length === 0) {
      throw new Error(`test target ${target.label} declares no workflow arm; at least one is required`);
    }
    assertPendingFieldsAreAbsent(target);
  }
  assertManifestCompatibility(registry, manifests);
  return deepFreeze(registry);
}

export function readTestTargetRegistry(
  repoRoot: string,
  manifests: readonly TestTargetManifestView[] = [],
): TestTargetRegistry {
  const input: unknown = JSON.parse(readFileSync(`${repoRoot}/${TEST_TARGET_REGISTRY_PATH}`, "utf8"));
  return parseTestTargetRegistry(input, manifests);
}

const committedRegistryInput: unknown = JSON.parse(readFileSync(
  new URL("../../config/test-subjects.json", import.meta.url),
  "utf8",
));

/** The checked-in registry is parsed and recursively frozen at module load. */
export const TEST_TARGET_REGISTRY: TestTargetRegistry = parseTestTargetRegistry(committedRegistryInput);

function registryDefect(
  target: TestTargetRegistryEntry,
  problem: string,
  detail?: string,
): never {
  const suffix = detail === undefined ? "" : ` (${detail})`;
  throw new TestTargetRegistryDefectError(
    `test target ${target.label} marked available, last observed ${target.availability.lastObserved}: ${problem}${suffix}`,
  );
}

/**
 * The cause of a failed secret READ, for the defect detail. `SecretMissingError`
 * and `SecretSourceError` (src/domain/secrets.ts) name the secret's registered
 * NAME and its env-var key and never its value, so quoting them cannot leak a
 * credential — while dropping them makes "no such registry entry" and "the value
 * is malformed" the same sentence.
 */
function secretFailureDetail(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : `non-Error thrown: ${String(error)}`;
}

function blocked(label: string, reason: string): z.output<typeof TestTargetBlockedResolutionSchema> {
  return TestTargetBlockedResolutionSchema.parse({ state: "blocked", label, reason });
}

function unavailableReason(target: TestTargetRegistryEntry): string {
  return `blocked: needs ${target.label}; registry says ${target.availability.state}, last observed ${target.availability.lastObserved}`;
}

/**
 * Resolve the first T1b workflow's label before any browser can start. Only
 * EIDs cross the secret boundary; every other canonical leaf is explicit in
 * the strict public config and the exact canonical schema judges the merge.
 */
export function resolveSeparationsKualiFinalizationTestTarget(
  registry: TestTargetRegistry,
  label: string,
  env?: NodeJS.ProcessEnv,
): SeparationsKualiFinalizationTestTargetResolution {
  const target = registry.targets.find((candidate) => candidate.label === label);
  if (target === undefined) return blocked(label, `blocked: needs ${label}`);
  // A label that exists but carries no arm for THIS workflow is a mis-addressed
  // request, not a decayed canary: `blocked` would read as "the subject left
  // the university" and hide the mistake. Refuse by name.
  const arm = target.workflows[FINALIZATION_WORKFLOW];
  if (arm === undefined) {
    throw new TestTargetRegistryDefectError(missingArmMessage(target, FINALIZATION_WORKFLOW));
  }
  if (target.availability.state !== "available") return blocked(label, unavailableReason(target));

  // Declared-pending leaves come BEFORE any secret read: a run that cannot
  // start must not spend a credential, and the reason it cannot start is a
  // truthful registry claim, not a defect.
  const pending = FINALIZATION_PENDING_FIELDS.flatMap((field) => {
    const reason = arm.pending?.[field];
    return reason === undefined ? [] : [`${field} ${reason}`];
  });
  if (pending.length > 0) {
    return blocked(
      label,
      `blocked: needs ${label} for ${FINALIZATION_WORKFLOW}; ${pending.join("; ")}, last observed ${target.availability.lastObserved}`,
    );
  }

  const eidReference = arm.secretInput?.emplId;
  if (eidReference === undefined) registryDefect(target, "missing secret EID reference emplId");
  const documentEidInput = arm.secretInput?.documentEid;
  if (documentEidInput === undefined) registryDefect(target, "missing secret EID mapping documentEid");

  let emplId: ReturnType<typeof optionalTestTargetEidSecret>;
  try {
    emplId = optionalTestTargetEidSecret(eidReference.name, env);
  } catch (error) {
    registryDefect(target, `secret EID reference ${eidReference.name} is invalid`, secretFailureDetail(error));
  }
  if (emplId === undefined) registryDefect(target, `secret EID reference ${eidReference.name} is missing`);

  let documentEid: z.input<typeof SeparationsKualiFinalizationInput>["documentEid"];
  if (documentEidInput.state === "absent") {
    documentEid = documentEidInput;
  } else {
    let value: ReturnType<typeof optionalTestTargetEidSecret>;
    try {
      value = optionalTestTargetEidSecret(documentEidInput.eid.name, env);
    } catch (error) {
      registryDefect(
        target,
        `secret EID reference ${documentEidInput.eid.name} is invalid`,
        secretFailureDetail(error),
      );
    }
    if (value === undefined) {
      registryDefect(target, `secret EID reference ${documentEidInput.eid.name} is missing`);
    }
    documentEid = { state: "present", value };
  }

  const canonical = SeparationsKualiFinalizationCanonicalInput.safeParse({
    ...arm.publicInput,
    emplId,
    documentEid,
  });
  if (!canonical.success) {
    registryDefect(
      target,
      "declared public fields and secret EID references do not form the complete canonical input",
      z.prettifyError(canonical.error),
    );
  }
  return SeparationsKualiFinalizationReadyTestTargetSchema.parse({
    state: "ready",
    label,
    canonicalInput: canonical.data,
  });
}

/**
 * Resolve a composed-chain label the way the OPERATOR would start the run.
 *
 * The chain's ingress is one typed Kuali document number (D261), so this
 * resolver does not assemble a canonical input field by field the way the
 * finalization resolver must. It feeds the registry's document number through
 * the descriptor's OWN `inputRun` parser — the same code path the dashboard's
 * start box uses — and parses the resulting submission through the descriptor's
 * own ingress and canonical schemas. `timekeeperName` therefore comes from the
 * descriptor's `constants[]` and `searchTimeoutMs` from the ingress default;
 * neither is authored here, so a rehearsal cannot start from an input a real
 * run would never produce.
 *
 * No EID crosses this boundary at all: a Kuali document number is not a person.
 */
export function resolveSeparationsTestTarget(
  registry: TestTargetRegistry,
  label: string,
): SeparationsTestTargetResolution {
  const target = registry.targets.find((candidate) => candidate.label === label);
  if (target === undefined) return blocked(label, `blocked: needs ${label}`);
  // Same refusal as the finalization resolver, for the same reason: a
  // mis-addressed label is a defect in the request, not a decayed canary.
  const arm = target.workflows[SEPARATIONS_WORKFLOW];
  if (arm === undefined) {
    throw new TestTargetRegistryDefectError(missingArmMessage(target, SEPARATIONS_WORKFLOW));
  }
  if (target.availability.state !== "available") return blocked(label, unavailableReason(target));
  if (arm.publicInput.document.state === "absent") {
    registryDefect(target, `no Kuali document exists to run: ${arm.publicInput.document.reason}`);
  }
  const surface = separationsDescriptor.surfaces?.inputRun;
  if (surface === undefined) {
    registryDefect(target, "descriptor separations declares no inputRun start box to resolve through");
  }
  const entries = parseInputRunText(surface.parser, arm.publicInput.document.documentNumber);
  const entry = entries[0];
  if (entries.length !== 1 || entry === undefined) {
    registryDefect(target, `document number parsed into ${String(entries.length)} start-box entries; exactly one is required`);
  }
  const submission = SeparationsInput.safeParse(toRawSubmission(entry));
  if (!submission.success) {
    registryDefect(
      target,
      "declared document number does not form a valid separations submission",
      z.prettifyError(submission.error),
    );
  }
  const canonical = SeparationsCanonicalInput.safeParse(submission.data);
  if (!canonical.success) {
    registryDefect(
      target,
      "declared document number does not form the complete canonical input",
      z.prettifyError(canonical.error),
    );
  }
  return SeparationsReadyTestTargetSchema.parse({
    state: "ready",
    label,
    canonicalInput: canonical.data,
  });
}
