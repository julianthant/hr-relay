import { ProtectedInputBindingsSchema } from "../domain/protected-input.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { deepFreeze } from "../domain/immutability.js";
import {
  TEST_DATA_CONFIG_PATH,
  TEST_DATA_LOCAL_CONFIG_PATH,
  TestDataDocumentNumberReferenceSchema,
  TestDataEidReferenceSchema,
  TestDataLocalConfigError,
  type TestDataInputName,
  type TestDataInputReference,
  type TestDataInputSource,
  type TestDataLocalInputEntry,
} from "../domain/test-data.js";
import { parseInputRunText, toRawSubmission } from "../domain/workflow/ingress.js";
import { compileWorkflow } from "../base/workflow-definition.js";
import {
  PersonLookupCanonicalInput,
  PersonLookupInput,
  personLookupWorkflow,
} from "../workflows/person-lookup/workflow.js";
import {
  SeparationsInput,
  separationsWorkflow,
} from "../workflows/separations/workflow.js";
import { SeparationsKualiFinalizationInput } from "../workflows/separations/kuali-finalization/workflow.js";

/** D341: the public subject registry is the `subjects` member of the shared test-data config. */
export const TEST_TARGET_REGISTRY_PATH = TEST_DATA_CONFIG_PATH;
export const TEST_TARGET_REGISTRY_MEMBER = "subjects";

export const FINALIZATION_WORKFLOW = "separations-kuali-finalization";
export const SEPARATIONS_WORKFLOW = "separations";
export const PERSON_LOOKUP_WORKFLOW = "person-lookup";

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
 * rehearsal role, and the controlled-commit role D280 names. Doc 03.3's other
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
 * The exact first-workflow ingress with its four person leaves removed. Every
 * remaining field is explicit and strict in config; `.partial()` lets a subject
 * record only what was actually observed — what is MISSING is then either
 * declared `pending` below, or a registry defect. The four person leaves are
 * not registry-supplied at all (D300): the composed chain reads the employee
 * name and document EID from Kuali, resolves the UCPath subject through its
 * identity gate, and carries its declared timekeeper constant — so this arm is
 * an observation record, and its resolver blocks by name (below).
 */
export const SeparationsKualiFinalizationPublicTestInputSchema =
  SeparationsKualiFinalizationInput.omit({
    employeeName: true,
    emplId: true,
    documentEid: true,
    timekeeperName: true,
  }).partial();

/**
 * The public reason the standalone finalization harness cannot resolve a live
 * subject (D300). Stated once so the resolver's `blocked` row and the smoke
 * that reads it agree byte for byte.
 */
export const FINALIZATION_PERSON_FACTS_DERIVED_REASON =
  "employee name, EID and timekeeper name are derived live by the composed separations chain "
  + "and are never registry- or protected-settings-supplied (D300); run the composed separations workflow";

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
  pending: SeparationsKualiFinalizationPendingSchema.optional(),
});

/**
 * The canary is ONE Kuali document number selected in ignored
 * `config/test-data.local.json` (D300/D341): the registry commits the exact
 * closed reference — the registered input name — never a number. A literal
 * here would let a commit choose the live subject; the reference makes the
 * private file the only place that can. "No subject exists" is still a real,
 * recorded state, spelled out rather than left as a missing key.
 */
export const SeparationsChainSubjectDocumentSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("configured"), reference: TestDataDocumentNumberReferenceSchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

export const SeparationsChainArmSchema = z.strictObject({
  kind: SeparationsChainSubjectKindSchema,
  publicInput: z.strictObject({ document: SeparationsChainSubjectDocumentSchema }),
});

/**
 * D318 — what a person-lookup live-read subject is for: one Search by EID of
 * a current, access-visible person. The EID is a CLOSED reference (the
 * registered input name), never a committed value; `resolvePersonLookupTestTarget`
 * reads it from ignored `config/test-data.local.json` (D341).
 */
export const PersonLookupSubjectKindSchema = z.enum(["search-by-eid"]);

export const PersonLookupSubjectEidSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("configured"), reference: TestDataEidReferenceSchema }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

export const PersonLookupArmSchema = z.strictObject({
  kind: PersonLookupSubjectKindSchema,
  publicInput: z.strictObject({ subject: PersonLookupSubjectEidSchema }),
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
  [PERSON_LOOKUP_WORKFLOW]: PersonLookupArmSchema.optional(),
});

/**
 * Every entry carries these, whatever workflow addresses it: what the subject is
 * FOR (`purpose`, doc 03.3's target-registry contract), the dated
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
/**
 * The standalone finalization harness has no `ready` arm (D300): the composed
 * chain is the only path that can truthfully assemble the finalization's
 * person leaves, so this resolver's whole vocabulary is `blocked`.
 */
export const SeparationsKualiFinalizationTestTargetResolutionSchema = TestTargetBlockedResolutionSchema;
export type SeparationsKualiFinalizationTestTargetResolution =
  z.output<typeof SeparationsKualiFinalizationTestTargetResolutionSchema>;

export const SeparationsReadyTestTargetSchema = z.strictObject({
  state: z.literal("ready"),
  label: z.string().min(1),
  // Protected workflow fields and ingress defaults are admitted once by the server planner.
  canonicalInput: SeparationsInput.pick({ documentNumber: true }),
  protectedBindings: ProtectedInputBindingsSchema,
});
export const SeparationsTestTargetResolutionSchema = z.discriminatedUnion("state", [
  TestTargetBlockedResolutionSchema,
  SeparationsReadyTestTargetSchema,
]);
export type SeparationsTestTargetResolution =
  z.output<typeof SeparationsTestTargetResolutionSchema>;

export const PersonLookupReadyTestTargetSchema = z.strictObject({
  state: z.literal("ready"),
  label: z.string().min(1),
  canonicalInput: PersonLookupCanonicalInput,
  protectedBindings: ProtectedInputBindingsSchema,
});
export const PersonLookupTestTargetResolutionSchema = z.discriminatedUnion("state", [
  TestTargetBlockedResolutionSchema,
  PersonLookupReadyTestTargetSchema,
]);
export type PersonLookupTestTargetResolution =
  z.output<typeof PersonLookupTestTargetResolutionSchema>;

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
const MODELLED_WORKFLOWS = [SEPARATIONS_WORKFLOW, FINALIZATION_WORKFLOW, PERSON_LOOKUP_WORKFLOW] as const;

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

/** The `subjects` member of a shared test-data document, or a loud defect naming the file. */
export function testTargetRegistryMember(document: unknown): unknown {
  if (document === null || typeof document !== "object" || Array.isArray(document)
    || !Object.hasOwn(document, TEST_TARGET_REGISTRY_MEMBER)) {
    throw new TestTargetRegistryDefectError(`${TEST_TARGET_REGISTRY_PATH} has no ${TEST_TARGET_REGISTRY_MEMBER} member`);
  }
  return Reflect.get(document, TEST_TARGET_REGISTRY_MEMBER);
}

/** Read the registry of an EXACT checkout root; no CWD default and no search. */
export function readTestTargetRegistry(
  repoRoot: string,
  manifests: readonly TestTargetManifestView[] = [],
): TestTargetRegistry {
  const document: unknown = JSON.parse(readFileSync(`${repoRoot}/${TEST_TARGET_REGISTRY_PATH}`, "utf8"));
  return parseTestTargetRegistry(testTargetRegistryMember(document), manifests);
}

const committedRegistryInput: unknown = testTargetRegistryMember(JSON.parse(readFileSync(
  new URL(`../../${TEST_DATA_CONFIG_PATH}`, import.meta.url),
  "utf8",
)));

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
 * The cause of a failed private-input READ, for the defect detail.
 * `TestDataLocalConfigError` (src/domain/test-data.ts) names the private file
 * and the offending KEY and never a value, so quoting it cannot leak an input —
 * while dropping it makes "no such file" and "the value is malformed" the same
 * sentence. Any other error is a programming defect and propagates as-is.
 */
function inputFailureDetail(error: unknown): string {
  if (error instanceof TestDataLocalConfigError) return `${error.name}: ${error.message}`;
  throw error;
}

function blocked(label: string, reason: string): z.output<typeof TestTargetBlockedResolutionSchema> {
  return TestTargetBlockedResolutionSchema.parse({ state: "blocked", label, reason });
}

function unavailableReason(target: TestTargetRegistryEntry): string {
  return `blocked: needs ${target.label}; registry says ${target.availability.state}, last observed ${target.availability.lastObserved}`;
}

/**
 * Read a subject's configured private input through its closed reference
 * (D341). `undefined` means the operator has not configured it — a truthful
 * "not ready", reported as `blocked` by key. A private file that is malformed,
 * not private, or carries a value failing the input's own workflow schema is a
 * DEFECT in local configuration, named by reference and key and never by value.
 */
function resolveConfiguredInput<Name extends TestDataInputName>(
  target: TestTargetRegistryEntry,
  reference: TestDataInputReference & { name: Name },
  source: TestDataInputSource,
  field: string,
): TestDataLocalInputEntry<Name> | undefined {
  try {
    return source.read(reference.name);
  } catch (error) {
    registryDefect(
      target,
      `${field} reference ${reference.name} is invalid in ${TEST_DATA_LOCAL_CONFIG_PATH}`,
      inputFailureDetail(error),
    );
  }
}

/**
 * Resolve the first T1b workflow's label. Since D300 this resolver can only
 * answer `blocked`: the standalone finalization harness holds no person facts
 * — the composed `separations` chain derives them live — so after the truthful
 * registry gates (unknown label, availability, declared-pending leaves) it
 * blocks BY NAME with the one public reason. No secret is read here at all.
 */
export function resolveSeparationsKualiFinalizationTestTarget(
  registry: TestTargetRegistry,
  label: string,
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

  // Declared-pending leaves come first: the reason a run cannot start is a
  // truthful registry claim about the DOCUMENT, and it outranks the harness's
  // own standing limitation below.
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

  return blocked(
    label,
    `blocked: needs ${label} for ${FINALIZATION_WORKFLOW}; ${FINALIZATION_PERSON_FACTS_DERIVED_REASON}, last observed ${target.availability.lastObserved}`,
  );
}

/**
 * Resolve a composed-chain label the way the OPERATOR would start the run.
 *
 * The chain's ingress is one typed Kuali document number (D261), so this
 * resolver does not assemble a canonical input field by field the way the
 * finalization resolver must. It feeds the registry's document number through
 * the descriptor's OWN `inputRun` parser — the same code path the dashboard's
 * start box uses — and parses the resulting submission through the descriptor's
 * own server admission. The ready value contains only the start-box submission:
 * `timekeeperName` is bound once from protected settings by the planner, which
 * then applies the ingress defaults and canonical validation. Readiness never
 * manufactures a protected default or accepts a protected caller override.
 *
 * The number itself comes from ignored `config/test-data.local.json` through
 * the arm's closed reference (D300/D341) — the registry never commits it. Unset is `blocked`
 * by key; malformed is a defect by key. No EID crosses this boundary at all: a
 * Kuali document number is not a person, and it is never copied into one.
 */
export function resolveSeparationsTestTarget(
  registry: TestTargetRegistry,
  label: string,
  source: TestDataInputSource,
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
  const { reference } = arm.publicInput.document;
  const documentNumber = resolveConfiguredInput(target, reference, source, "document-number");
  if (documentNumber === undefined) {
    return blocked(
      label,
      `blocked: needs ${label}; its Kuali document number is not configured — set ${reference.name} in ${TEST_DATA_LOCAL_CONFIG_PATH} (D341)`,
    );
  }
  const surface = compileWorkflow(separationsWorkflow).descriptor.surfaces?.inputRun;
  if (surface === undefined) {
    registryDefect(target, "descriptor separations declares no inputRun start box to resolve through");
  }
  const entries = parseInputRunText(surface.parser, documentNumber.value);
  const entry = entries[0];
  if (entries.length !== 1 || entry === undefined) {
    registryDefect(target, `document number parsed into ${String(entries.length)} start-box entries; exactly one is required`);
  }
  return SeparationsReadyTestTargetSchema.parse({
    state: "ready",
    label,
    canonicalInput: toRawSubmission(entry),
    protectedBindings: [{ kind: "test-data-local", inputPath: "documentNumber", name: reference.name, sourceId: documentNumber.valueId }],
  });
}

/**
 * Resolve a person-lookup live-read label the way the OPERATOR would start
 * the run (D318). The ingress is the person-lookup start box: the configured
 * EID is fed through the descriptor's OWN `inputRun` parser — the same code
 * path the dashboard uses — and parsed through the descriptor's own ingress
 * and canonical schemas, so `keepNonHdh` and `includeCrmDates` come from the
 * parser's declared constants, never from this resolver.
 *
 * The EID itself comes from ignored `config/test-data.local.json` through the
 * arm's closed reference (D341): unset is `blocked` by key; malformed is a defect by key.
 * No person value is committed, and none is echoed in a refusal.
 */
export function resolvePersonLookupTestTarget(
  registry: TestTargetRegistry,
  label: string,
  source: TestDataInputSource,
): PersonLookupTestTargetResolution {
  const target = registry.targets.find((candidate) => candidate.label === label);
  if (target === undefined) return blocked(label, `blocked: needs ${label}`);
  const arm = target.workflows[PERSON_LOOKUP_WORKFLOW];
  if (arm === undefined) {
    throw new TestTargetRegistryDefectError(missingArmMessage(target, PERSON_LOOKUP_WORKFLOW));
  }
  if (target.availability.state !== "available") return blocked(label, unavailableReason(target));
  if (arm.publicInput.subject.state === "absent") {
    registryDefect(target, `no person exists to search: ${arm.publicInput.subject.reason}`);
  }
  const { reference } = arm.publicInput.subject;
  const emplId = resolveConfiguredInput(target, reference, source, "employee-id");
  if (emplId === undefined) {
    return blocked(
      label,
      `blocked: needs ${label}; its UCPath employee id is not configured — set ${reference.name} in ${TEST_DATA_LOCAL_CONFIG_PATH} (D341)`,
    );
  }
  const surface = compileWorkflow(personLookupWorkflow).descriptor.surfaces?.inputRun;
  if (surface === undefined) {
    registryDefect(target, "descriptor person-lookup declares no inputRun start box to resolve through");
  }
  const entries = parseInputRunText(surface.parser, emplId.value);
  const entry = entries[0];
  if (entries.length !== 1 || entry === undefined) {
    registryDefect(target, `employee id parsed into ${String(entries.length)} start-box entries; exactly one is required`);
  }
  const submission = PersonLookupInput.safeParse(toRawSubmission(entry));
  if (!submission.success) {
    registryDefect(
      target,
      "configured employee id does not form a valid person-lookup submission",
      z.prettifyError(submission.error),
    );
  }
  const canonical = PersonLookupCanonicalInput.safeParse(submission.data);
  if (!canonical.success) {
    registryDefect(
      target,
      "configured employee id does not form the complete canonical input",
      z.prettifyError(canonical.error),
    );
  }
  return PersonLookupReadyTestTargetSchema.parse({
    state: "ready",
    label,
    canonicalInput: canonical.data,
    protectedBindings: [{ kind: "test-data-local", inputPath: "emplId", name: reference.name, sourceId: emplId.valueId }],
  });
}
