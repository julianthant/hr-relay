import { z } from "zod";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
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

export type DelegationReadiness = Readonly<{ state: "ready" }>
  | Readonly<{ state: "waiting"; childRunId: string }>
  | Readonly<{ state: "blocked"; childRunId: string; reason: "child-failed" | "manual-parent-resume" | "child-cancellation-unavailable" }>
  | Readonly<{ state: "blocked"; childRunId: string; reason: "child-preview"; manifestId: DelegationManifest["manifestId"]; resultDigest: z.infer<typeof FingerprintSchema> }>;

export function delegationJoinDisposition(plan: Pick<DelegationManifest, "join" | "policy">, states: readonly string[]): "satisfied" | "blocked" | "failed" {
  if (plan.join === "none" || states.every(state => state === "done") || plan.join === "all-settled" || plan.policy.onChildFailed === "allow-partial") return "satisfied";
  return plan.policy.onChildFailed === "block-parent" ? "blocked" : "failed";
}

export function delegationReadiness(manifest: DelegationManifest, children: readonly Readonly<{
  dependency: DependencyRecord;
  attempt: "original" | "retry";
}>[], intent: "join" | "cancel"): DelegationReadiness {
  if (children.length !== manifest.children.length) throw new Error("delegation-membership-mismatch");
  for (const [index, entry] of manifest.children.entries()) {
    const dependency = children[index]?.dependency;
    if (dependency === undefined || dependency.dependencyId !== entry.dependencyId || dependency.manifestId !== manifest.manifestId
      || dependency.parentRunId !== manifest.parentRunId || dependency.childRunId !== entry.childRunId || dependency.childItemId !== entry.childItemId
      || dependency.edgeId !== manifest.edgeId || canonicalJsonStringify(dependency.policy) !== canonicalJsonStringify(manifest.policy)) throw new Error("delegation-membership-mismatch");
  }
  if (intent === "cancel" ? manifest.policy.cascadeCancel === "independent" : manifest.join === "none") return { state: "ready" };
  const active = children.find(child => child.dependency.state === "active");
  if (active !== undefined) return { state: "waiting", childRunId: active.dependency.childRunId };
  if (intent === "cancel") return { state: "ready" };
  const manual = children.find(child => child.attempt === "retry" && manifest.policy.afterChildRetry === "manual-parent-resume");
  if (manual !== undefined) return { state: "blocked", childRunId: manual.dependency.childRunId, reason: "manual-parent-resume" };
  const failed = children.find(child => child.dependency.state !== "satisfied");
  return failed !== undefined && delegationJoinDisposition(manifest, children.map(child => child.dependency.state === "satisfied" ? "done" : child.dependency.state)) === "blocked"
    ? { state: "blocked", childRunId: failed.dependency.childRunId, reason: "child-failed" } : { state: "ready" };
}
