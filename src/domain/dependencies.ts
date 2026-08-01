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

/**
 * Three shapes here changed when 1e built the planner that writes this record
 * (D102's "one vocabulary end to end" applied to the manifest, not only the
 * dependency row):
 *
 * - `policy` is recorded. Without it the manifest cannot verify on replay that
 *   the fan-out still runs under the policy the operator selected, and the
 *   dependency rows would be the only durable copy of a decision the manifest
 *   is supposed to be authoritative for.
 * - `join` carries all four arms. A `cardinality:"one"` awaited edge joins
 *   `"one"`, and an un-awaited fan-out joins `"none"` while still minting a
 *   manifest — that manifest reference IS the node's output
 *   (`DelegationManifestRef`), so the record must be expressible.
 * - `children` may be empty. A zero-child fan-out is a legitimate outcome of an
 *   empty upstream list, and doc 02 §3.2 requires it to stay an explicit
 *   satisfied join rather than an edge that silently vanished. `min(1)` made
 *   the honest record unwritable.
 */
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
