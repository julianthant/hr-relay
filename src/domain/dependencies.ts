import { z } from "zod";
import { deepFreeze } from "./immutability.js";
import {
  DelegationEdgeIdSchema,
  DelegationManifestIdSchema,
  DependencyIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  PositiveIntSchema,
  RunIdSchema,
} from "./ids.js";
/**
 * D102: the durable dependency row stores doc 02 §3.2's delegation vocabulary
 * verbatim — one vocabulary from builder through manifest, dependency row, and
 * UI. The 1c shape (`failure: fail-parent|collect|ignore`,
 * `retry: retry-child|replace-child|parent-only`,
 * `visibility: member|linked|delegated`) was never ratified in any owning doc
 * and had no arm for doc 02's `block-parent`, so it is replaced rather than
 * mapped. The policy is a JSON payload validated here, not a SQL enum, so no
 * migration version is consumed.
 */
import { DelegationPolicySchema } from "./workflow/delegation-policy.js";

export const DependencyRecordSchema = z.strictObject({
  dependencyId: DependencyIdSchema,
  manifestId: DelegationManifestIdSchema,
  edgeId: DelegationEdgeIdSchema,
  parentRunId: RunIdSchema,
  childRunId: RunIdSchema,
  childItemId: ItemIdSchema,
  policy: DelegationPolicySchema,
  state: z.enum(["active", "satisfied", "failed", "cancelled"]),
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  updatedAt: IsoInstantSchema,
}).superRefine((record, context) => {
  if (record.parentRunId === record.childRunId) {
    context.addIssue({ code: "custom", path: ["childRunId"], message: "a run cannot depend on itself" });
  }
  if (Date.parse(record.updatedAt) < Date.parse(record.createdAt)) {
    context.addIssue({ code: "custom", path: ["updatedAt"], message: "dependency updatedAt cannot precede createdAt" });
  }
});

const DelegatedChildManifestEntrySchema = z.strictObject({
  dependencyId: DependencyIdSchema,
  childRunId: RunIdSchema,
  childItemId: ItemIdSchema,
  canonicalInputFingerprint: FingerprintSchema,
});

export const DelegationManifestSchema = z.strictObject({
  manifestId: DelegationManifestIdSchema,
  parentRunId: RunIdSchema,
  edgeId: DelegationEdgeIdSchema,
  inputSchemaHash: FingerprintSchema,
  resultSchemaHash: FingerprintSchema,
  cardinality: z.enum(["one", "many"]),
  join: z.enum(["all", "all-settled"]),
  children: z.array(DelegatedChildManifestEntrySchema).min(1),
  createdAt: IsoInstantSchema,
  manifestFingerprint: FingerprintSchema,
}).superRefine((manifest, context) => {
  for (const field of ["dependencyId", "childRunId", "childItemId"] as const) {
    const values = manifest.children.map((child) => child[field]);
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: ["children"], message: `delegation manifest ${field} values must be unique` });
    }
  }
  if (manifest.cardinality === "one" && manifest.children.length !== 1) {
    context.addIssue({ code: "custom", path: ["children"], message: "one-cardinality manifests require exactly one child" });
  }
});

export function defineDelegationManifest(input: unknown): Readonly<DelegationManifest> {
  return deepFreeze(DelegationManifestSchema.parse(input));
}

export type DependencyRecord = z.infer<typeof DependencyRecordSchema>;
export type DelegationManifest = z.infer<typeof DelegationManifestSchema>;
