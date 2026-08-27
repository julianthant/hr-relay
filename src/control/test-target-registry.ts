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

export const TestTargetKindSchema = z.enum([
  "ordinary",
  "already-present",
  "no-active-job",
  "ambiguous-name",
  "subject-mismatch",
  "name-differs",
  "concurrent-jobs",
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
 * Every remaining field is explicit and strict in config; `.partial()` lets
 * gone/unknown subjects record only what was actually observed.
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
 * Every entry carries these, whatever workflow owns it: what the subject is
 * FOR (`purpose`, doc 03b's "what it is good for" column), the dated
 * availability claim, the record that observed it, and D85's usage rules.
 */
const COMMON_TEST_TARGET_FIELDS = {
  label: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  availability: TestTargetAvailabilitySchema,
  provenance: TestTargetProvenanceSchema,
  usagePolicy: z.enum(["read-only", "write-allowed-if-restored"]),
  cleanupObligation: z.string().min(1),
  owner: z.string().min(1),
  purpose: z.string().min(1),
} as const;

export const SeparationsKualiFinalizationTestTargetSchema = z.strictObject({
  ...COMMON_TEST_TARGET_FIELDS,
  workflow: z.literal("separations-kuali-finalization"),
  kind: TestTargetKindSchema,
  publicInput: SeparationsKualiFinalizationPublicTestInputSchema,
  secretInput: TestTargetEidInputSchema.optional(),
});

/**
 * What a subject of the COMPOSED separations chain is for. These are not the
 * finalization scenario matrix's kinds — they name the migration role doc 03b
 * mapped the document into, and a subject that evaporated keeps its row with
 * an explicit `gone` availability rather than being deleted (§9.16 recorded
 * two canaries evaporating between passes; a deleted row loses that history).
 */
export const SeparationsChainSubjectKindSchema = z.enum([
  "full-chain-dry-run",
  "future-dated",
  "controlled-commit-candidate",
  "pending-termination",
]);

/**
 * A Kuali document number is not a person, so it lives in the repo — but
 * "no subject exists" is a real, recorded state (the PENDING-sweep gap), and
 * it is spelled out rather than left as a missing key.
 */
export const SeparationsChainSubjectDocumentSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("present"), documentNumber: z.string().regex(/^[0-9]{1,8}$/) }),
  z.strictObject({ state: z.literal("absent"), reason: z.string().min(1) }),
]);

export const SeparationsChainTestTargetSchema = z.strictObject({
  ...COMMON_TEST_TARGET_FIELDS,
  workflow: z.literal("separations"),
  kind: SeparationsChainSubjectKindSchema,
  publicInput: z.strictObject({ document: SeparationsChainSubjectDocumentSchema }),
});

export const TestTargetRegistryEntrySchema = z.discriminatedUnion("workflow", [
  SeparationsKualiFinalizationTestTargetSchema,
  SeparationsChainTestTargetSchema,
]);

export const TestTargetRegistrySchema = z.strictObject({
  schemaVersion: z.literal(1),
  targets: z.array(TestTargetRegistryEntrySchema),
});

export type TestTargetRegistryInput = z.input<typeof TestTargetRegistrySchema>;
export type TestTargetRegistry = z.output<typeof TestTargetRegistrySchema>;

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

function assertManifestCompatibility(
  registry: TestTargetRegistry,
  manifests: readonly TestTargetManifestView[],
): void {
  for (const manifest of manifests) for (const scenario of manifest.cases) {
    const target = registry.targets.find(({ label }) => label === scenario.subjectLabel);
    if (target === undefined) {
      throw new Error(
        `dry-run manifest ${manifest.workflow} label ${scenario.subjectLabel} has no test target registry entry`,
      );
    }
    if (target.workflow !== manifest.workflow) {
      throw new Error(
        `test target ${target.label} workflow ${target.workflow} does not match manifest ${manifest.workflow}`,
      );
    }
    if (target.kind !== scenario.subjectKind) {
      throw new Error(
        `test target ${target.label} kind ${target.kind} does not match manifest kind ${scenario.subjectKind}`,
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
  target: TestTargetRegistry["targets"][number],
  problem: string,
  detail?: string,
): never {
  const suffix = detail === undefined ? "" : ` (${detail})`;
  throw new TestTargetRegistryDefectError(
    `test target ${target.label} marked available, last observed ${target.availability.lastObserved}: ${problem}${suffix}`,
  );
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
  if (target === undefined) {
    return TestTargetBlockedResolutionSchema.parse({
      state: "blocked",
      label,
      reason: `blocked: needs ${label}`,
    });
  }
  // A label that exists but belongs to another workflow is a mis-addressed
  // request, not a decayed canary: `blocked` would read as "the subject left
  // the university" and hide the mistake. Refuse by name.
  if (target.workflow !== "separations-kuali-finalization") {
    throw new TestTargetRegistryDefectError(
      `test target ${target.label} belongs to workflow ${target.workflow}, not separations-kuali-finalization`,
    );
  }
  if (target.availability.state !== "available") {
    return TestTargetBlockedResolutionSchema.parse({
      state: "blocked",
      label,
      reason: `blocked: needs ${label}; registry says ${target.availability.state}, last observed ${target.availability.lastObserved}`,
    });
  }
  const eidReference = target.secretInput?.emplId;
  if (eidReference === undefined) registryDefect(target, "missing secret EID reference emplId");
  const documentEidInput = target.secretInput?.documentEid;
  if (documentEidInput === undefined) registryDefect(target, "missing secret EID mapping documentEid");

  let emplId: ReturnType<typeof optionalTestTargetEidSecret>;
  try {
    emplId = optionalTestTargetEidSecret(eidReference.name, env);
  } catch {
    registryDefect(target, `secret EID reference ${eidReference.name} is invalid`);
  }
  if (emplId === undefined) registryDefect(target, `secret EID reference ${eidReference.name} is missing`);

  let documentEid: z.input<typeof SeparationsKualiFinalizationInput>["documentEid"];
  if (documentEidInput.state === "absent") {
    documentEid = documentEidInput;
  } else {
    let value: ReturnType<typeof optionalTestTargetEidSecret>;
    try {
      value = optionalTestTargetEidSecret(documentEidInput.eid.name, env);
    } catch {
      registryDefect(target, `secret EID reference ${documentEidInput.eid.name} is invalid`);
    }
    if (value === undefined) {
      registryDefect(target, `secret EID reference ${documentEidInput.eid.name} is missing`);
    }
    documentEid = { state: "present", value };
  }

  const canonical = SeparationsKualiFinalizationCanonicalInput.safeParse({
    ...target.publicInput,
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
  if (target === undefined) {
    return TestTargetBlockedResolutionSchema.parse({
      state: "blocked",
      label,
      reason: `blocked: needs ${label}`,
    });
  }
  // Same refusal as the finalization resolver, for the same reason: a
  // mis-addressed label is a defect in the request, not a decayed canary.
  if (target.workflow !== "separations") {
    throw new TestTargetRegistryDefectError(
      `test target ${target.label} belongs to workflow ${target.workflow}, not separations`,
    );
  }
  if (target.availability.state !== "available") {
    return TestTargetBlockedResolutionSchema.parse({
      state: "blocked",
      label,
      reason: `blocked: needs ${label}; registry says ${target.availability.state}, last observed ${target.availability.lastObserved}`,
    });
  }
  if (target.publicInput.document.state === "absent") {
    registryDefect(target, `no Kuali document exists to run: ${target.publicInput.document.reason}`);
  }
  const surface = separationsDescriptor.surfaces?.inputRun;
  if (surface === undefined) {
    registryDefect(target, "descriptor separations declares no inputRun start box to resolve through");
  }
  const entries = parseInputRunText(surface.parser, target.publicInput.document.documentNumber);
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
