import { z } from "zod";
import { EidSchema, IsoInstantSchema } from "./ids.js";
import { deepFreeze } from "./immutability.js";
import { KualiDocumentNumberSchema } from "./ui/kuali-document-identity.js";

/**
 * D341 — test inputs are a separate owner from application configuration.
 *
 * - `config/test-data.json` (tracked) carries the public subject registry,
 *   named shared file references and synthetic sample values.
 * - `config/test-data.local.json` (ignored) carries the operator's private
 *   live-subject inputs (the former protected-Settings canaries) and private
 *   document paths. It is never a protected Setting, never a credential and
 *   never read by the settings authority.
 *
 * This module owns the strict shapes only. Loading, path resolution and the
 * once-per-start capture live in `src/backend/app/control/test-data.ts`.
 */
export const TEST_DATA_CONFIG_PATH = "config/test-data.json";
export const TEST_DATA_LOCAL_CONFIG_PATH = "config/test-data.local.json";
export const TEST_DATA_LOCAL_EXAMPLE_PATH = "config/test-data.local.example.json";
/** A private file larger than this is a defect, not a bigger configuration. */
export const TEST_DATA_LOCAL_MAXIMUM_BYTES = 64_000;

/**
 * The closed set of private test inputs. Each value is judged by the SAME
 * schema the owning workflow's start box applies, so what a resolver reads is
 * exactly what an operator could have typed (D300/D318).
 */
export const TestDataInputValueSchemas = Object.freeze({
  separationsKualiFinalizationCanaryDocumentNumber: KualiDocumentNumberSchema,
  personLookupCanaryEid: EidSchema,
});
export const TestDataInputNameSchema = z.strictObject(TestDataInputValueSchemas).keyof();
export type TestDataInputName = z.infer<typeof TestDataInputNameSchema>;
export const TEST_DATA_INPUT_NAMES = deepFreeze(TestDataInputNameSchema.options);

export const TestDataDocumentNumberReferenceSchema = z.strictObject({
  name: z.literal("separationsKualiFinalizationCanaryDocumentNumber"),
});
export const TestDataEidReferenceSchema = z.strictObject({
  name: z.literal("personLookupCanaryEid"),
});
export const TestDataInputReferenceSchema = z.union([
  TestDataDocumentNumberReferenceSchema,
  TestDataEidReferenceSchema,
]);
export type TestDataInputReference = z.infer<typeof TestDataInputReferenceSchema>;

export const TestDataFileNameSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(64);
export type TestDataFileName = z.infer<typeof TestDataFileNameSchema>;
export const TestDataFileKindSchema = z.enum(["pdf"]);
export type TestDataFileKind = z.infer<typeof TestDataFileKindSchema>;

/** A `.` segment, an empty segment or a trailing slash is a defect; parent (`..`) segments are only refused where noted. */
const PATH_DOT_SEGMENT_DEFECT = /(?:^|\/)\.(?:\/|$)|\/\/|\/$/u;
const PATH_PARENT_SEGMENT = /(?:^|\/)\.\.(?:\/|$)/u;
/** A path declared in a config file: relative to that file, no traversal, no NUL, no backslash. */
/**
 * A shared file path is relative to the declaring config file. Parent segments are
 * admitted so tracked fixtures can live outside `config/`; the loader still refuses
 * any target whose real path leaves the repository.
 */
export const DeclaredRelativePathSchema = z.string().min(1).max(1024).refine(
  (path) => !path.startsWith("/") && !path.includes("\0") && !path.includes("\\") && !PATH_DOT_SEGMENT_DEFECT.test(path),
  { message: "declared path must be relative to its config file without . or empty segments" },
);
/** A private path may name an explicitly configured external document by absolute path; no . or .. segments. */
export const DeclaredPrivatePathSchema = z.string().min(1).max(1024).refine(
  (path) => !path.includes("\0") && !path.includes("\\") && !PATH_DOT_SEGMENT_DEFECT.test(path) && !PATH_PARENT_SEGMENT.test(path),
  { message: "private path must not contain . or .. segments" },
);

export const TestDataSharedFileSchema = z.strictObject({
  path: DeclaredRelativePathSchema,
  kind: TestDataFileKindSchema,
  purpose: z.string().min(1).max(240),
});
export type TestDataSharedFile = z.infer<typeof TestDataSharedFileSchema>;

/** Synthetic sample values shared by tests. Never a real HR value. */
export const TestDataSamplesSchema = z.strictObject({
  eids: z.array(EidSchema).min(1).max(16),
  kualiDocumentNumbers: z.array(KualiDocumentNumberSchema).min(1).max(16),
  timekeeperNames: z.array(z.string().min(1).max(256)).min(1).max(16),
}).superRefine((samples, context) => {
  for (const [key, values] of Object.entries(samples)) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [key], message: "sample values must be unique" });
    }
  }
});
export type TestDataSamples = z.infer<typeof TestDataSamplesSchema>;

/**
 * The tracked document. `subjects` is the public subject registry whose exact
 * shape belongs to `src/backend/app/control/test-target-registry.ts`; this layer only
 * insists it is present as an object, and the control reader parses it.
 */
export const TestDataSharedConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  subjects: z.looseObject({}),
  files: z.record(TestDataFileNameSchema, TestDataSharedFileSchema),
  samples: TestDataSamplesSchema,
});
export type TestDataSharedConfig = z.infer<typeof TestDataSharedConfigSchema>;

function localEntry<Value extends z.ZodType>(value: Value) {
  return z.strictObject({ valueId: z.uuid(), value, updatedAt: IsoInstantSchema });
}
export const TestDataLocalInputsSchema = z.strictObject({
  separationsKualiFinalizationCanaryDocumentNumber: localEntry(
    TestDataInputValueSchemas.separationsKualiFinalizationCanaryDocumentNumber,
  ).optional(),
  personLookupCanaryEid: localEntry(TestDataInputValueSchemas.personLookupCanaryEid).optional(),
});
export type TestDataLocalInputs = z.infer<typeof TestDataLocalInputsSchema>;
export type TestDataLocalInputEntry<Name extends TestDataInputName = TestDataInputName> =
  NonNullable<TestDataLocalInputs[Name]>;

/** The ignored private document. Values exist only here; no digest or surrogate is admitted. */
export const TestDataLocalConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  inputs: TestDataLocalInputsSchema,
  files: z.record(TestDataFileNameSchema, DeclaredPrivatePathSchema),
}).superRefine((config, context) => {
  const identities = Object.values(config.inputs).map((entry) => entry.valueId);
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: "custom", path: ["inputs"], message: "private test input valueId identities must be unique" });
  }
});
export type TestDataLocalConfig = z.infer<typeof TestDataLocalConfigSchema>;

/**
 * The once-per-start view of the private file. `read` returns the exact stored
 * entry (value + opaque `valueId`) or `undefined` when the operator has not
 * configured that name; a malformed or unreadable private file throws a
 * `TestDataLocalConfigError` naming the file and key, never a value.
 */
export interface TestDataInputSource {
  readonly read: <Name extends TestDataInputName>(name: Name) => TestDataLocalInputEntry<Name> | undefined;
}

/** Value-free presence, for `test-data check` and evidence. */
export const TestDataLocalPresenceSchema = z.strictObject({
  state: z.enum(["absent", "valid"]),
  inputs: z.array(z.strictObject({ name: TestDataInputNameSchema, present: z.boolean() })),
  files: z.array(TestDataFileNameSchema),
});
export type TestDataLocalPresence = z.infer<typeof TestDataLocalPresenceSchema>;

export class TestDataConfigError extends Error {
  override readonly name = "TestDataConfigError";
}
export class TestDataLocalConfigError extends Error {
  override readonly name = "TestDataLocalConfigError";
}
