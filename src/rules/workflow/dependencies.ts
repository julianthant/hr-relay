import { z } from "zod";
import { deepFreeze } from "../validation/immutability.js";
import {
  DelegationEdgeIdSchema,
  DelegationManifestIdSchema,
  DependencyIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  PositiveIntSchema,
  RunIdSchema,
} from "../identity/ids.js";
/** Preserve one delegation vocabulary; validate policy JSON rather than narrowing it to a SQL enum. */
import { DelegationPolicySchema } from "../../models/workflow/delegation-policy.js";

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

/** Three shapes the manifest record needs: `policy` recorded, `join` with all four arms, and `children` allowed to be empty for a zero-child fan-out. */
export const DelegationManifestSchema = z.strictObject({
  manifestId: DelegationManifestIdSchema,
  parentRunId: RunIdSchema,
  edgeId: DelegationEdgeIdSchema,
  inputSchemaHash: FingerprintSchema,
  resultSchemaHash: FingerprintSchema,
  cardinality: z.enum(["one", "many"]),
  join: z.enum(["one", "all", "all-settled", "none"]),
  policy: DelegationPolicySchema,
  children: z.array(DelegatedChildManifestEntrySchema),
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
  // `none` is the un-awaited arm and is legal at either cardinality; the awaited
  // joins are not interchangeable.
  if (manifest.join === "one" && manifest.cardinality !== "one") {
    context.addIssue({ code: "custom", path: ["join"], message: "join \"one\" requires cardinality \"one\"" });
  }
  if ((manifest.join === "all" || manifest.join === "all-settled") && manifest.cardinality !== "many") {
    context.addIssue({ code: "custom", path: ["join"], message: `join "${manifest.join}" requires cardinality "many"` });
  }
});

export function defineDelegationManifest(input: unknown): Readonly<DelegationManifest> {
  return deepFreeze(DelegationManifestSchema.parse(input));
}

export type DependencyRecord = z.infer<typeof DependencyRecordSchema>;
export type DelegationManifest = z.infer<typeof DelegationManifestSchema>;
