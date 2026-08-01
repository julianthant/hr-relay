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

const DependencyPolicySchema = z.strictObject({
  failure: z.enum(["fail-parent", "collect", "ignore"]),
  cancel: z.enum(["cascade", "independent"]),
  retry: z.enum(["retry-child", "replace-child", "parent-only"]),
  visibility: z.enum(["member", "linked", "delegated"]),
});

export const DependencyRecordSchema = z.strictObject({
  dependencyId: DependencyIdSchema,
  manifestId: DelegationManifestIdSchema,
  edgeId: DelegationEdgeIdSchema,
  parentRunId: RunIdSchema,
  childRunId: RunIdSchema,
  childItemId: ItemIdSchema,
  policy: DependencyPolicySchema,
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
