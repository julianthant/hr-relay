import { z } from "zod";
import { RunRecordSchema, runClaim, type RunRecord } from "../../../models/run/record.js";
import { RunResultRecordSchema } from "../../../models/run/result.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { parseCanonicalInputSnapshot } from "../../../models/workflow/canonical-input.js";
import { assertDelegationReplayMatches, joinDelegationOutcomes, type DelegationPlan } from "../../../models/workflow/delegation.js";
import { childRunOutcomeSchema, DelegationManifestRefSchema, type AnyWorkflowRef } from "../../../models/workflow/graph.js";
import { DelegationManifestIdSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { DelegationManifestSchema, type DelegationManifest } from "../../../rules/workflow/dependencies.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import type { ChildRunContext, ChildRunExecutor } from "./run-executor.js";
import { descriptorRuntimeNodes, workflowProjections, workflowTerminalResultExecution, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { planCanonicalDelegation } from "../../runs/lifecycle/delegation-planning.js";
import { resolveInstances } from "../../runs/start/plan.js";

export const DelegationPendingSchema = z.strictObject({
  state: z.literal("delegation-pending"),
  runId: RunIdSchema,
  manifestId: DelegationManifestIdSchema,
});

/** The canonical lifecycle owner atomically admits or replays the fan-out and releases an awaited parent with unresolved children. */
export interface DelegationAdmission {
  admitAndRelease(context: ChildRunContext, plan: DelegationPlan<AnyWorkflowRef>): Readonly<{
    state: "released" | "ready";
    manifest: DelegationManifest;
  }>;
}

export interface DelegationAuthority {
  readonly authority: Pick<AuthorityRepositories, "delegationManifests" | "dependencies" | "runResults" | "failures">
    & { readonly runs: Pick<AuthorityRepositories["runs"], "get"> };
  withAuthorityReadSnapshot<Result>(read: () => Result): Result;
}

function assertHeldParent(context: ChildRunContext, parent: RunRecord): void {
  const held = runClaim(parent);
  if (parent.version !== context.run.version || canonicalJsonStringify(parent.envelope) !== canonicalJsonStringify(context.run.envelope)
    || canonicalJsonStringify(parent.input) !== canonicalJsonStringify(context.run.input)
    || parent.cancelRequested === true || held?.workerId !== context.claim.workerId
    || held.claimGeneration !== context.claim.claimGeneration) throw new Error("delegation-parent-claim-stale");
}

function requireRun(authority: DelegationAuthority, runId: string): RunRecord {
  const run = authority.authority.runs.get(runId);
  if (run === undefined) throw new Error("delegation-run-unavailable");
  return RunRecordSchema.parse(run);
}

function assertChildBinding(parent: RunRecord, child: RunRecord, context: ChildRunContext, target: AnyWorkflowDescriptor): void {
  const projected = Object.fromEntries(Object.entries(parent.envelope.requestedInstance ?? {}).filter(([system]) => workflowProjections(target).systems.includes(system)));
  if (child.envelope.runId === parent.envelope.runId || child.envelope.parent?.runId !== parent.envelope.runId
    || child.envelope.parent.edgeId !== context.node.edgeId || child.envelope.parent.tracePrefix !== parent.envelope.traceId
    || child.envelope.workflow !== context.node.target.id || child.envelope.dryRun !== parent.envelope.dryRun
    || child.envelope.configFingerprint !== parent.envelope.configFingerprint || child.envelope.configSnapshotId !== parent.envelope.configSnapshotId
    || canonicalJsonStringify(child.envelope.requestedInstance ?? {}) !== canonicalJsonStringify(projected)
    || canonicalJsonStringify(child.envelope.resolvedInstance) !== canonicalJsonStringify(resolveInstances(target, projected))) {
    throw new Error("delegation-child-binding-mismatch");
  }
}

export function createDurableChildRunExecutor(dependencies: Readonly<{
  authority: DelegationAuthority;
  admission: DelegationAdmission;
  resolveTarget(workflowId: string): AnyWorkflowDescriptor;
}>): ChildRunExecutor {
  const { authority, admission } = dependencies;
  return {
    async executeChildRun(context) {
      context.signal.throwIfAborted();
      authority.withAuthorityReadSnapshot(() => assertHeldParent(context, requireRun(authority, context.run.envelope.runId)));
      const { node } = context;
      if (context.descriptor.id !== context.run.envelope.workflow || context.descriptor.version !== context.run.envelope.descriptorVersion
        || context.descriptor.contractFingerprint !== context.run.envelope.contractFingerprint
        || !descriptorRuntimeNodes(context.descriptor).includes(node)) throw new Error("delegation-node-binding-mismatch");
      const target = dependencies.resolveTarget(node.target.id);
      if (target.id !== node.target.id || deriveSchemaHash(target.input, "input") !== deriveSchemaHash(node.target.input, "input")
        || workflowTerminalResultExecution(target).schemaHash !== deriveSchemaHash(node.target.result, "output")) throw new Error("delegation-target-contract-mismatch");
      const plan = planCanonicalDelegation(context, target);
      const admitted = admission.admitAndRelease(context, plan);
      return authority.withAuthorityReadSnapshot(() => {
        const parent = requireRun(authority, context.run.envelope.runId);
        const manifest = DelegationManifestSchema.parse(admitted.manifest);
        const retained = authority.authority.delegationManifests.get(manifest.manifestId);
        if (retained === undefined || canonicalJsonStringify(retained) !== canonicalJsonStringify(manifest)
          || manifest.parentRunId !== parent.envelope.runId || manifest.inputSchemaHash !== deriveSchemaHash(node.target.input, "input")
          || manifest.resultSchemaHash !== deriveSchemaHash(node.target.result, "output")) throw new Error("delegation-manifest-binding-mismatch");
        assertDelegationReplayMatches({ edgeId: manifest.edgeId, planFingerprint: manifest.manifestFingerprint }, plan);
        if (manifest.cardinality !== plan.cardinality || manifest.join !== plan.join
          || canonicalJsonStringify(manifest.policy) !== canonicalJsonStringify(plan.policy)
          || canonicalJsonStringify(manifest.children.map(({ childItemId, canonicalInputFingerprint }) => ({ childItemId, canonicalInputFingerprint })))
            !== canonicalJsonStringify(plan.children.map(({ childItemId, canonicalInputFingerprint }) => ({ childItemId, canonicalInputFingerprint })))) {
          throw new Error("delegation-manifest-plan-mismatch");
        }
        const children = manifest.children.map((entry, index) => {
          const child = authority.authority.dependencies.effectiveChild(entry.dependencyId);
          assertChildBinding(parent, child, context, target);
          if (child.envelope.descriptorVersion !== target.version || child.envelope.contractFingerprint !== target.contractFingerprint
            || child.input.ingressSchemaHash !== manifest.inputSchemaHash
            || canonicalJsonStringify(parseCanonicalInputSnapshot(target.canonicalInput, child.input.parsed))
              !== canonicalJsonStringify(plan.children[index]?.input)) throw new Error("delegation-child-input-mismatch");
          const dependency = authority.authority.dependencies.get(entry.dependencyId);
          if (dependency === undefined || dependency.parentRunId !== parent.envelope.runId || dependency.childRunId !== entry.childRunId
            || dependency.childItemId !== entry.childItemId || child.envelope.itemId !== entry.childItemId
            || dependency.manifestId !== manifest.manifestId || dependency.edgeId !== manifest.edgeId
            || canonicalJsonStringify(dependency.policy) !== canonicalJsonStringify(plan.policy)) throw new Error("delegation-dependency-binding-mismatch");
          return { child, dependency };
        });
        if (admitted.state === "released") {
          if (node.await === "none" || parent.lifecycle.state !== "queued" || runClaim(parent) !== undefined
            || parent.version <= context.run.version || Number(parent.claimGeneration) !== Number(context.claim.claimGeneration)
            || parent.cancelRequested === true || canonicalJsonStringify(parent.envelope) !== canonicalJsonStringify(context.run.envelope)
            || canonicalJsonStringify(parent.input) !== canonicalJsonStringify(context.run.input)) {
            throw new Error("delegation-parent-release-unproved");
          }
          return DelegationPendingSchema.parse({ state: "delegation-pending", runId: parent.envelope.runId, manifestId: manifest.manifestId });
        }
        assertHeldParent(context, parent);
        if (node.await === "none") return DelegationManifestRefSchema.parse({ manifestId: manifest.manifestId, edgeId: manifest.edgeId, childCount: children.length });
        const outcomes = children.map(({ child, dependency }) => {
          if (child.lifecycle.state !== "terminal") throw new Error("delegation-child-not-terminal");
          const identity = { runId: child.envelope.runId, itemId: child.envelope.itemId };
          switch (child.lifecycle.outcome) {
            case "done": {
              if (dependency.state !== "satisfied") throw new Error("delegation-dependency-unsettled");
              const result = RunResultRecordSchema.parse(authority.authority.runResults.get(child.envelope.runId));
              if (result.runId !== child.envelope.runId || result.workflowId !== child.envelope.workflow
                || result.attempt !== child.envelope.attempt || result.descriptorVersion !== child.envelope.descriptorVersion
                || result.contractFingerprint !== child.envelope.contractFingerprint || result.resultSchemaHash !== manifest.resultSchemaHash
                || child.completion?.kind !== "done" || child.completion.resultDigest !== result.resultDigest
                || result.configFingerprint !== child.envelope.configFingerprint || result.configSnapshotId !== child.envelope.configSnapshotId) {
                throw new Error("delegation-child-result-mismatch");
              }
              return childRunOutcomeSchema(node.target.result).parse({ state: "done", ...identity, output: result.result.value });
            }
            case "failed": {
              const failureId = child.lifecycle.failureId;
              if (failureId === undefined) throw new Error("delegation-child-failure-mismatch");
              const failure = authority.authority.failures.get(failureId);
              if (dependency.state !== "failed" || failure === undefined || failure.runId !== child.envelope.runId
                || failure.attempt !== child.envelope.attempt || failure.workflowId !== child.envelope.workflow) throw new Error("delegation-child-failure-mismatch");
              return childRunOutcomeSchema(node.target.result).parse({ state: "failed", ...identity, failureId });
            }
            case "cancelled": {
              if (dependency.state !== "cancelled") throw new Error("delegation-dependency-unsettled");
              const source = authority.authority.dependencies.cancellationOutcome(child.envelope.runId);
              if (source.reason === undefined) throw new Error("delegation-child-cancellation-reason-unavailable");
              return childRunOutcomeSchema(node.target.result).parse({ state: "cancelled", ...identity, ...source });
            }
            default:
              throw new Error("delegation-child-terminal-outcome-unresolved");
          }
        });
        const joined = joinDelegationOutcomes(plan, outcomes);
        if (joined.state !== "satisfied") throw new Error(`delegation-join-${joined.state}: ${joined.reason}`);
        return node.cardinality === "one" ? outcomes[0] : outcomes;
      });
    },
  };
}
