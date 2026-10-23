/** Delegation fan-out planning, replay verification, and joining; the fan-out is all-or-none — a plan is computed completely before anything is written. */
import { createHash } from "node:crypto";
import type { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { FingerprintSchema, ItemIdSchema } from "../../rules/identity/ids.js";
import type { DelegationEdgeId, Fingerprint, ItemId, RunId } from "../../rules/identity/ids.js";
import type { DelegationPolicy } from "./delegation-policy.js";
import { DelegationPolicySchema } from "./delegation-policy.js";
import type { AnyWorkflowRef, ChildRunOutcome } from "./graph.js";
import { parseAsSchemaOutput } from "../validation/schema-parse.js";

/** One planned child: its stable item id and the exact input that produced it. */
export interface PlannedChild<Target extends AnyWorkflowRef> {
  readonly childItemId: ItemId;
  readonly input: z.output<Target["input"]>;
  readonly canonicalInputFingerprint: Fingerprint;
}

export interface DelegationPlan<Target extends AnyWorkflowRef> {
  readonly edgeId: DelegationEdgeId;
  readonly cardinality: "one" | "many";
  readonly join: "one" | "all" | "all-settled" | "none";
  readonly policy: DelegationPolicy;
  readonly children: readonly PlannedChild<Target>[];
  /** Covers the edge, cardinality, join, policy, and every child id + input. */
  readonly planFingerprint: Fingerprint;
}

function fingerprintOf(domain: string, value: unknown): Fingerprint {
  return FingerprintSchema.parse(createHash("sha256")
    .update(`hrauto:${domain}:v1\0`)
    .update(canonicalJsonStringify(value))
    .digest("hex"));
}

export function delegationChildInputFingerprint(input: unknown): Fingerprint {
  return fingerprintOf("delegation-child-input", input);
}

export interface DelegationFanOutRequest<Target extends AnyWorkflowRef> {
  readonly edgeId: DelegationEdgeId;
  readonly target: Target;
  readonly cardinality: "one" | "many";
  readonly join: "one" | "all" | "all-settled" | "none";
  readonly policy: DelegationPolicy;
  /** Raw bound value: one input for `cardinality:"one"`, an array for `"many"`. */
  readonly bound: unknown;
  readonly deriveChildItemId: (input: z.output<Target["input"]>) => ItemId;
}

/** Plan a fan-out completely, or throw; nothing here writes, and the caller performs the whole enqueue in one transaction. */
export function planDelegationFanOut<Target extends AnyWorkflowRef>(
  request: DelegationFanOutRequest<Target>,
): DelegationPlan<Target> {
  const policy = DelegationPolicySchema.parse(request.policy);
  if (request.cardinality === "one" && Array.isArray(request.bound)) {
    throw new Error(`delegation edge ${request.edgeId} is cardinality "one" but bound an array`);
  }
  if (request.cardinality === "many" && !Array.isArray(request.bound)) {
    throw new Error(`delegation edge ${request.edgeId} is cardinality "many" but bound a single input`);
  }
  const rawInputs: readonly unknown[] = Array.isArray(request.bound) ? request.bound : [request.bound];
  if (request.cardinality === "one" && rawInputs.length !== 1) {
    throw new Error(`delegation edge ${request.edgeId} is cardinality "one" but produced ${String(rawInputs.length)} inputs`);
  }

  const children: PlannedChild<Target>[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rawInputs.entries()) {
    // Parse BEFORE deriving identity: a child id derived from unvalidated input
    // could key the dependency table off a value the child would later reject.
    const parsed = parseAsSchemaOutput<Target["input"]>(request.target.input, raw);
    const childItemId = ItemIdSchema.parse(request.deriveChildItemId(parsed));
    if (seen.has(childItemId)) {
      throw new Error(
        `delegation edge ${request.edgeId} derived duplicate child item id ${childItemId} at index ${String(index)}`
        + " - deriveChildItemId must be stable AND unique across the fan-out",
      );
    }
    seen.add(childItemId);
    children.push({
      childItemId,
      input: parsed,
      canonicalInputFingerprint: delegationChildInputFingerprint(parsed),
    });
  }

  // Record empty fan-outs explicitly so joins receive an empty array.
  const identity = {
    edgeId: request.edgeId,
    workflowId: request.target.id,
    cardinality: request.cardinality,
    join: request.join,
    policy,
    children: children.map(({ childItemId, canonicalInputFingerprint }) => ({
      childItemId,
      canonicalInputFingerprint,
    })),
  };
  return {
    edgeId: request.edgeId,
    cardinality: request.cardinality,
    join: request.join,
    policy,
    children,
    planFingerprint: fingerprintOf("delegation-plan", identity),
  };
}

/** Replaying a `child-run` node re-plans and must land on exactly the stored manifest; attaching new children silently would orphan the old ones. */
export function assertDelegationReplayMatches<Target extends AnyWorkflowRef>(
  stored: Readonly<{ edgeId: DelegationEdgeId; planFingerprint: Fingerprint }>,
  replanned: DelegationPlan<Target>,
): void {
  if (stored.edgeId !== replanned.edgeId) {
    throw new Error(
      `delegation replay targeted edge ${replanned.edgeId} but the stored manifest is for ${stored.edgeId}`,
    );
  }
  if (stored.planFingerprint !== replanned.planFingerprint) {
    throw new Error(
      `delegation edge ${stored.edgeId} replay does not match its manifest`
      + ` (stored ${stored.planFingerprint}, replanned ${replanned.planFingerprint})`
      + " - the fan-out inputs or policy changed after enqueue",
    );
  }
}

export type DelegationJoin<Target extends AnyWorkflowRef> =
  | Readonly<{ state: "satisfied"; outcomes: readonly ChildRunOutcome<Target>[] }>
  | Readonly<{ state: "failed"; reason: string; outcomes: readonly ChildRunOutcome<Target>[] }>
  | Readonly<{ state: "blocked"; reason: string; outcomes: readonly ChildRunOutcome<Target>[] }>;

/** Apply a join and its failure policy to the complete set of child outcomes; the caller must supply one outcome per planned child, in plan order. */
export function joinDelegationOutcomes<Target extends AnyWorkflowRef>(
  plan: DelegationPlan<Target>,
  outcomes: readonly ChildRunOutcome<Target>[],
): DelegationJoin<Target> {
  if (plan.join === "none") {
    throw new Error(`delegation edge ${plan.edgeId} is un-awaited and has no join to apply`);
  }
  if (outcomes.length !== plan.children.length) {
    throw new Error(
      `delegation edge ${plan.edgeId} join received ${String(outcomes.length)} outcomes`
      + ` for ${String(plan.children.length)} planned children`,
    );
  }
  const expected = plan.children.map(({ childItemId }) => childItemId);
  const actual = outcomes.map(({ itemId }) => itemId);
  if (canonicalJsonStringify(expected) !== canonicalJsonStringify(actual)) {
    throw new Error(
      `delegation edge ${plan.edgeId} join received outcomes for different children than it planned`,
    );
  }

  const notDone = outcomes.filter((outcome) => outcome.state !== "done");
  if (notDone.length === 0) return { state: "satisfied", outcomes };

  // `all-settled` hands the parent the complete typed array and requires it to
  // branch explicitly; the failure policy does not pre-empt that.
  if (plan.join === "all-settled") return { state: "satisfied", outcomes };

  const summary = notDone
    .map((outcome) => `${outcome.itemId}:${outcome.state}`)
    .join(", ");
  switch (plan.policy.onChildFailed) {
    case "allow-partial":
      return { state: "satisfied", outcomes };
    case "block-parent":
      return { state: "blocked", reason: `awaiting operator resolution for ${summary}`, outcomes };
    case "fail-parent":
      return { state: "failed", reason: `child run(s) did not complete: ${summary}`, outcomes };
  }
}

/** The parent's own run id is never a legal child id — a run cannot delegate to itself. */
export function assertChildRunIdentity(parentRunId: RunId, childRunId: RunId): void {
  if (parentRunId === childRunId) {
    throw new Error(`delegation cannot target the parent run ${parentRunId} as its own child`);
  }
}
