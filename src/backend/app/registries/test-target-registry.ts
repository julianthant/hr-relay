import { ProtectedInputBindingsSchema } from "../../../models/write-safety/protected-input.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { deepFreeze } from "../../../rules/validation/immutability.js";
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
} from "../../../models/config/test-data.js";
import {
  parseInputRunText,
  toRawSubmission,
} from "../../../models/workflow/ingress.js";
import { compileWorkflow } from "../../../workflow-kit/workflow-definition.js";
import {
  PersonLookupCanonicalInput,
  PersonLookupInput,
  personLookupWorkflow,
} from "../../../workflows/person-lookup/workflow.js";
import {
  SeparationsInput,
  separationsWorkflow,
} from "../../../workflows/separations/workflow.js";
import { SeparationsKualiFinalizationInput } from "../../../workflows/separations/steps/kuali-finalization/step.js";


export const TEST_TARGET_REGISTRY_PATH = TEST_DATA_CONFIG_PATH;
export const TEST_TARGET_REGISTRY_MEMBER = "subjects";

export const FINALIZATION_WORKFLOW = "separations-kuali-finalization";
export const SEPARATIONS_WORKFLOW = "separations";
export const PERSON_LOOKUP_WORKFLOW = "person-lookup";

// Live subjects model observed facts; scenario outcomes require injected fixtures, never registry claims.
export const SeparationsKualiFinalizationSubjectKindSchema = z.enum([
  "ordinary",
]);


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

// Partial observed facts describe absence; pending declarations decide whether missing leaves block admission.
export const SeparationsKualiFinalizationPublicTestInputSchema =
  SeparationsKualiFinalizationInput.omit({
    employeeName: true,
    emplId: true,
    documentEid: true,
    timekeeperName: true,
  }).partial();


export const FINALIZATION_PERSON_FACTS_DERIVED_REASON =
  "employee name, EID and timekeeper name are derived live by the composed separations chain " +
  "and are never registry- or protected-settings-supplied; run the composed separations workflow";

// A document read cannot supply downstream transaction, timecard or receipt facts.
const FinalizationPendingShape = {
  transactionNumber: z.string().min(1).optional(),
  timekeeperComments: z.string().min(1).optional(),
  terminationEffectiveDate: z.string().min(1).optional(),
};

export const SeparationsKualiFinalizationPendingSchema = z
  .strictObject(FinalizationPendingShape)

  .refine(
    (pending) => Object.values(pending).some((reason) => reason !== undefined),
    {
      message:
        "pending declares no field; an arm with nothing pending omits the block",
    },
  );

type FinalizationPendingField = keyof typeof FinalizationPendingShape;


const FINALIZATION_PENDING_ORDER = {
  transactionNumber: 0,
  timekeeperComments: 1,
  terminationEffectiveDate: 2,
} satisfies Record<FinalizationPendingField, number>;

function isFinalizationPendingField(
  key: string,
): key is FinalizationPendingField {
  return Object.hasOwn(FINALIZATION_PENDING_ORDER, key);
}

/** DERIVED from the schema's own shape, then ranked — never hand-duplicated. */
const FINALIZATION_PENDING_FIELDS: readonly FinalizationPendingField[] =
  Object.keys(FinalizationPendingShape)
    .map((key) => {
      if (!isFinalizationPendingField(key)) {
        throw new Error(
          `pending schema declares ${key}, which the finalization report order does not rank`,
        );
      }
      return key;
    })
    .sort(
      (left, right) =>
        FINALIZATION_PENDING_ORDER[left] - FINALIZATION_PENDING_ORDER[right],
    );

export const SeparationsKualiFinalizationArmSchema = z.strictObject({
  kind: SeparationsKualiFinalizationSubjectKindSchema,
  publicInput: SeparationsKualiFinalizationPublicTestInputSchema,
  pending: SeparationsKualiFinalizationPendingSchema.optional(),
});

// Commit the closed private-input reference, never a literal document number.
export const SeparationsChainSubjectDocumentSchema = z.discriminatedUnion(
  "state",
  [
    z.strictObject({
      state: z.literal("configured"),
      reference: TestDataDocumentNumberReferenceSchema,
    }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
  ],
);

export const SeparationsChainArmSchema = z.strictObject({
  kind: SeparationsChainSubjectKindSchema,
  publicInput: z.strictObject({
    document: SeparationsChainSubjectDocumentSchema,
    reRead: SeparationsInput.pick({ reRead: true }).shape.reRead,
  }),
});


export const PersonLookupSubjectKindSchema = z.enum(["search-by-eid"]);

export const PersonLookupSubjectEidSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("configured"),
    reference: TestDataEidReferenceSchema,
  }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

export const PersonLookupArmSchema = z.strictObject({
  kind: PersonLookupSubjectKindSchema,
  publicInput: z.strictObject({ subject: PersonLookupSubjectEidSchema }),
});


export const TestTargetWorkflowArmsSchema = z.strictObject({
  [SEPARATIONS_WORKFLOW]: SeparationsChainArmSchema.optional(),
  [FINALIZATION_WORKFLOW]: SeparationsKualiFinalizationArmSchema.optional(),
  [PERSON_LOOKUP_WORKFLOW]: PersonLookupArmSchema.optional(),
});


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

export const SeparationsKualiFinalizationTestTargetResolutionSchema =
  TestTargetBlockedResolutionSchema;
export type SeparationsKualiFinalizationTestTargetResolution = z.output<
  typeof SeparationsKualiFinalizationTestTargetResolutionSchema
>;

export const SeparationsReadyTestTargetSchema = z.strictObject({
  state: z.literal("ready"),
  label: z.string().min(1),
  // Protected workflow fields and ingress defaults are admitted once by the server planner.
  canonicalInput: SeparationsInput.pick({ documentNumber: true, reRead: true }),
  protectedBindings: ProtectedInputBindingsSchema,
});
export const SeparationsTestTargetResolutionSchema = z.discriminatedUnion(
  "state",
  [TestTargetBlockedResolutionSchema, SeparationsReadyTestTargetSchema],
);
export type SeparationsTestTargetResolution = z.output<
  typeof SeparationsTestTargetResolutionSchema
>;

export const PersonLookupReadyTestTargetSchema = z.strictObject({
  state: z.literal("ready"),
  label: z.string().min(1),
  canonicalInput: PersonLookupCanonicalInput,
  protectedBindings: ProtectedInputBindingsSchema,
});
export const PersonLookupTestTargetResolutionSchema = z.discriminatedUnion(
  "state",
  [TestTargetBlockedResolutionSchema, PersonLookupReadyTestTargetSchema],
);
export type PersonLookupTestTargetResolution = z.output<
  typeof PersonLookupTestTargetResolutionSchema
>;

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


const WORKFLOW_ARM_KEYS = Object.keys(
  TestTargetWorkflowArmsSchema.shape,
) as ReadonlyArray<keyof typeof TestTargetWorkflowArmsSchema.shape>;

/** Which workflows this subject declares an arm for, in the schema's fixed order. */
function declaredWorkflows(target: TestTargetRegistryEntry): readonly string[] {
  return WORKFLOW_ARM_KEYS.filter(
    (workflow) => target.workflows[workflow] !== undefined,
  );
}

/** Every workflow id a resolver in this module models, in one fixed order. */
const MODELLED_WORKFLOWS = [
  SEPARATIONS_WORKFLOW,
  FINALIZATION_WORKFLOW,
  PERSON_LOOKUP_WORKFLOW,
] as const;

type ModelledWorkflow = (typeof MODELLED_WORKFLOWS)[number];

function isModelledWorkflow(workflow: string): workflow is ModelledWorkflow {
  return MODELLED_WORKFLOWS.some((modelled) => modelled === workflow);
}

// Undefined means the subject lacks an arm for a modeled workflow, never an unknown workflow ID.
function workflowArm(
  target: TestTargetRegistryEntry,
  workflow: ModelledWorkflow,
): Readonly<{ kind: string }> | undefined {
  return target.workflows[workflow];
}

function missingArmMessage(
  target: TestTargetRegistryEntry,
  workflow: string,
): string {
  return `test target ${target.label} declares no ${workflow} arm; it declares ${declaredWorkflows(target).join(", ")}`;
}

function assertManifestCompatibility(
  registry: TestTargetRegistry,
  manifests: readonly TestTargetManifestView[],
): void {
  for (const manifest of manifests) {

    if (!isModelledWorkflow(manifest.workflow)) {
      throw new Error(
        `no resolver models workflow ${manifest.workflow}; modelled: ${MODELLED_WORKFLOWS.join(", ")}`,
      );
    }
    for (const scenario of manifest.cases) {
      const target = registry.targets.find(
        ({ label }) => label === scenario.subjectLabel,
      );
      if (target === undefined) {
        throw new Error(
          `dry-run manifest ${manifest.workflow} label ${scenario.subjectLabel} has no test target registry entry`,
        );
      }
      const arm = workflowArm(target, manifest.workflow);
      if (arm === undefined)
        throw new Error(missingArmMessage(target, manifest.workflow));
      if (arm.kind !== scenario.subjectKind) {
        throw new Error(
          `test target ${target.label} arm ${manifest.workflow} kind ${arm.kind} does not match manifest kind ${scenario.subjectKind}`,
        );
      }
    }
  }
}

// Observed and pending claims for the same field contradict each other.
function assertPendingFieldsAreAbsent(target: TestTargetRegistryEntry): void {
  const arm = target.workflows[FINALIZATION_WORKFLOW];
  if (arm?.pending === undefined) return;
  for (const field of FINALIZATION_PENDING_FIELDS) {
    if (
      arm.pending[field] !== undefined &&
      arm.publicInput[field] !== undefined
    ) {
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
  const duplicate = labels.find(
    (label, index) => labels.indexOf(label) !== index,
  );
  if (duplicate !== undefined)
    throw new Error(`test target registry repeats label ${duplicate}`);
  for (const target of registry.targets) {
    if (declaredWorkflows(target).length === 0) {
      throw new Error(
        `test target ${target.label} declares no workflow arm; at least one is required`,
      );
    }
    assertPendingFieldsAreAbsent(target);
  }
  assertManifestCompatibility(registry, manifests);
  return deepFreeze(registry);
}

/** The `subjects` member of a shared test-data document, or a loud defect naming the file. */
export function testTargetRegistryMember(document: unknown): unknown {
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    !Object.hasOwn(document, TEST_TARGET_REGISTRY_MEMBER)
  ) {
    throw new TestTargetRegistryDefectError(
      `${TEST_TARGET_REGISTRY_PATH} has no ${TEST_TARGET_REGISTRY_MEMBER} member`,
    );
  }
  return Reflect.get(document, TEST_TARGET_REGISTRY_MEMBER);
}

/** Read the registry of an EXACT checkout root; no CWD default and no search. */
export function readTestTargetRegistry(
  repoRoot: string,
  manifests: readonly TestTargetManifestView[] = [],
): TestTargetRegistry {
  const document: unknown = JSON.parse(
    readFileSync(`${repoRoot}/${TEST_TARGET_REGISTRY_PATH}`, "utf8"),
  );
  return parseTestTargetRegistry(testTargetRegistryMember(document), manifests);
}

const committedRegistryInput: unknown = testTargetRegistryMember(
  JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../",
        TEST_DATA_CONFIG_PATH,
      ),
      "utf8",
    ),
  ),
);

/** The checked-in registry is parsed and recursively frozen at module load. */
export const TEST_TARGET_REGISTRY: TestTargetRegistry = parseTestTargetRegistry(
  committedRegistryInput,
);

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

// Private-input failures name keys and paths without publishing values.
function inputFailureDetail(error: unknown): string {
  if (error instanceof TestDataLocalConfigError)
    return `${error.name}: ${error.message}`;
  throw error;
}

function blocked(
  label: string,
  reason: string,
): z.output<typeof TestTargetBlockedResolutionSchema> {
  return TestTargetBlockedResolutionSchema.parse({
    state: "blocked",
    label,
    reason,
  });
}

function unavailableReason(target: TestTargetRegistryEntry): string {
  return `blocked: needs ${target.label}; registry says ${target.availability.state}, last observed ${target.availability.lastObserved}`;
}


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


export function resolveSeparationsKualiFinalizationTestTarget(
  registry: TestTargetRegistry,
  label: string,
): SeparationsKualiFinalizationTestTargetResolution {
  const target = registry.targets.find(
    (candidate) => candidate.label === label,
  );
  if (target === undefined) return blocked(label, `blocked: needs ${label}`);

  const arm = target.workflows[FINALIZATION_WORKFLOW];
  if (arm === undefined) {
    throw new TestTargetRegistryDefectError(
      missingArmMessage(target, FINALIZATION_WORKFLOW),
    );
  }
  if (target.availability.state !== "available")
    return blocked(label, unavailableReason(target));

  // Declared pending document facts take precedence over standing harness limitations.
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


export function resolveSeparationsTestTarget(
  registry: TestTargetRegistry,
  label: string,
  source: TestDataInputSource,
): SeparationsTestTargetResolution {
  const target = registry.targets.find(
    (candidate) => candidate.label === label,
  );
  if (target === undefined) return blocked(label, `blocked: needs ${label}`);
  // Same refusal as the finalization resolver, for the same reason: a
  // mis-addressed label is a defect in the request, not a decayed canary.
  const arm = target.workflows[SEPARATIONS_WORKFLOW];
  if (arm === undefined) {
    throw new TestTargetRegistryDefectError(
      missingArmMessage(target, SEPARATIONS_WORKFLOW),
    );
  }
  if (target.availability.state !== "available")
    return blocked(label, unavailableReason(target));
  if (arm.publicInput.document.state === "absent") {
    registryDefect(
      target,
      `no Kuali document exists to run: ${arm.publicInput.document.reason}`,
    );
  }
  const { reference } = arm.publicInput.document;
  const documentNumber = resolveConfiguredInput(
    target,
    reference,
    source,
    "document-number",
  );
  if (documentNumber === undefined) {
    return blocked(
      label,
      `blocked: needs ${label}; its Kuali document number is not configured — set ${reference.name} in ${TEST_DATA_LOCAL_CONFIG_PATH}`,
    );
  }
  const surface =
    compileWorkflow(separationsWorkflow).descriptor.surfaces?.inputRun;
  if (surface === undefined) {
    registryDefect(
      target,
      "descriptor separations declares no inputRun start box to resolve through",
    );
  }
  const entries = parseInputRunText(surface.parser, documentNumber.value);
  const entry = entries[0];
  if (entries.length !== 1 || entry === undefined) {
    registryDefect(
      target,
      `document number parsed into ${String(entries.length)} start-box entries; exactly one is required`,
    );
  }
  const submission =
    SeparationsReadyTestTargetSchema.shape.canonicalInput.parse(
      toRawSubmission(entry),
    );
  return SeparationsReadyTestTargetSchema.parse({
    state: "ready",
    label,
    canonicalInput: {
      ...submission,
      ...(arm.publicInput.reRead === undefined
        ? {}
        : { reRead: arm.publicInput.reRead }),
    },
    protectedBindings: [
      {
        kind: "test-data-local",
        inputPath: "documentNumber",
        name: reference.name,
        sourceId: documentNumber.valueId,
      },
    ],
  });
}


export function resolvePersonLookupTestTarget(
  registry: TestTargetRegistry,
  label: string,
  source: TestDataInputSource,
): PersonLookupTestTargetResolution {
  const target = registry.targets.find(
    (candidate) => candidate.label === label,
  );
  if (target === undefined) return blocked(label, `blocked: needs ${label}`);
  const arm = target.workflows[PERSON_LOOKUP_WORKFLOW];
  if (arm === undefined) {
    throw new TestTargetRegistryDefectError(
      missingArmMessage(target, PERSON_LOOKUP_WORKFLOW),
    );
  }
  if (target.availability.state !== "available")
    return blocked(label, unavailableReason(target));
  if (arm.publicInput.subject.state === "absent") {
    registryDefect(
      target,
      `no person exists to search: ${arm.publicInput.subject.reason}`,
    );
  }
  const { reference } = arm.publicInput.subject;
  const emplId = resolveConfiguredInput(
    target,
    reference,
    source,
    "employee-id",
  );
  if (emplId === undefined) {
    return blocked(
      label,
      `blocked: needs ${label}; its UCPath employee id is not configured — set ${reference.name} in ${TEST_DATA_LOCAL_CONFIG_PATH}`,
    );
  }
  const surface =
    compileWorkflow(personLookupWorkflow).descriptor.surfaces?.inputRun;
  if (surface === undefined) {
    registryDefect(
      target,
      "descriptor person-lookup declares no inputRun start box to resolve through",
    );
  }
  const entries = parseInputRunText(surface.parser, emplId.value);
  const entry = entries[0];
  if (entries.length !== 1 || entry === undefined) {
    registryDefect(
      target,
      `employee id parsed into ${String(entries.length)} start-box entries; exactly one is required`,
    );
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
    protectedBindings: [
      {
        kind: "test-data-local",
        inputPath: "emplId",
        name: reference.name,
        sourceId: emplId.valueId,
      },
    ],
  });
}
