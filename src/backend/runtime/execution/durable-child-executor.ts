import type { EvidenceSchemaReader } from "../../../models/storage/evidence-schema-admission.js";
import { z } from "zod";
import { RunRecordSchema, runClaim, type RunRecord } from "../../../models/run/record.js";
import { resolveDelegationEvidenceOutput, readRunPreviewResult, DelegationOutcomePolicyUnsatisfiedError, DelegationTerminalEvidenceSchema, RunResultRecordSchema, type DelegationTerminalEvidence } from "../../../models/run/result.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { parseCanonicalInputSnapshot } from "../../../models/workflow/canonical-input.js";
import { assertDelegationReplayMatches, type DelegationPlan } from "../../../models/workflow/delegation.js";
import { DelegationManifestRefSchema, type AnyWorkflowRef } from "../../../models/workflow/graph.js";
import { OcrPageOutcomeSchema } from "../../../models/workflows/ocr/page-accounting.js";
import { CommandIdSchema, DelegationManifestIdSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { DelegationManifestSchema, type DelegationManifest } from "../../../rules/workflow/dependencies.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import type { ChildRunBatchContext, ChildRunContext, ChildRunExecutor } from "./run-execution-contract.js";
import { descriptorRuntimeNodes, workflowProjections, workflowTerminalResultExecution, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { planCanonicalDelegation } from "../../runs/lifecycle/delegation-planning.js";
import { resolveInstances } from "../../runs/start/plan.js";

export const DelegationPendingSchema = z.strictObject({
  state: z.literal("delegation-pending"),
  runId: RunIdSchema,
  manifestId: DelegationManifestIdSchema,
  admissionCommandId: CommandIdSchema,
});

/** The canonical lifecycle owner atomically admits or replays the fan-out and releases an awaited parent with unresolved children. */
export interface DelegationAdmission {
  admitAndRelease(context: ChildRunBatchContext, plans: readonly DelegationPlan<AnyWorkflowRef>[]): Readonly<{
    entries: readonly (Readonly<{ state: "admitted"; manifest: DelegationManifest }> | Readonly<{ state: "reused"; evidence: DelegationTerminalEvidence }>)[];
  } & ({ state: "ready" } | { state: "released"; admissionCommandId: string })>;
}

export interface DelegationAuthority {
  readonly evidenceSchemaHash?: EvidenceSchemaReader;
  readonly authority: Pick<AuthorityRepositories, "delegationManifests" | "dependencies" | "runResults" | "failures">
    & { readonly runs: Pick<AuthorityRepositories["runs"], "get"> };
  withAuthorityReadSnapshot<Result>(read: () => Result): Result;
}

export function resolveExecutableChildOutput(evidence: DelegationTerminalEvidence, schema: z.ZodType,
  failures: Pick<AuthorityRepositories["failures"], "get">, parentEdgeId: string | undefined, schemaReader?: EvidenceSchemaReader) {
  const firstFailure = () => {
    for (const { run } of evidence.children) {
      if (run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "failed") continue;
      const failure = run.lifecycle.failureId === undefined ? undefined : failures.get(run.lifecycle.failureId);
      if (failure === undefined || failure.runId !== run.envelope.runId || failure.attempt !== run.envelope.attempt
        || failure.workflowId !== run.envelope.workflow) throw new Error("delegation-child-failure-mismatch");
      return Object.assign(new Error(failure.summary), { code: failure.code });
    }
    return undefined;
  };
  let resolution;
  try {
    resolution = resolveDelegationEvidenceOutput(evidence, schema, schemaReader);
  } catch (error) {
    if (evidence.edgeId === "document-ocr" && error instanceof DelegationOutcomePolicyUnsatisfiedError) throw firstFailure() ?? error;
    throw error;
  }
  if (resolution.kind === "ordinary" && evidence.edgeId === "ocr-pages" && parentEdgeId === "document-ocr") {
    const pages = OcrPageOutcomeSchema.array().parse(resolution.output);
    if (pages.length > 0 && !pages.some(page => page.state === "done" && page.output.extraction.record !== null)) {
      const failure = firstFailure();
      if (failure !== undefined) throw failure;
      const cancelled = pages.find(page => page.state === "cancelled");
      if (cancelled !== undefined) throw Object.assign(new Error(cancelled.reason), { code: "OCR_PAGE_CANCELLED" });
      throw Object.assign(new Error(ERROR_CATALOG.OCR_NO_REVIEWABLE_RECORDS.text), { code: "OCR_NO_REVIEWABLE_RECORDS" });
    }
  }
  return resolution;
}

function assertHeldParent(context: Pick<ChildRunContext, "run" | "claim">, parent: RunRecord): void {
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
  beforeConfirmedWrite?(): Promise<void>;
  resolveTarget(workflowId: string): AnyWorkflowDescriptor;
}>): ChildRunExecutor {
  const { authority, admission } = dependencies;
  return {
    async executeChildRuns(batch) {
      batch.signal.throwIfAborted();
      authority.withAuthorityReadSnapshot(() => assertHeldParent(batch, requireRun(authority, batch.run.envelope.runId)));
      const planned = batch.leaves.map(leaf => {
        const context: ChildRunContext = { ...batch, ...leaf };
        const { node } = context;
        if (context.descriptor.id !== context.run.envelope.workflow || context.descriptor.version !== context.run.envelope.descriptorVersion
          || context.descriptor.contractFingerprint !== context.run.envelope.contractFingerprint
          || !descriptorRuntimeNodes(context.descriptor).includes(node)) throw new Error("delegation-node-binding-mismatch");
        const target = dependencies.resolveTarget(node.target.id);
        if (target.id !== node.target.id || deriveSchemaHash(target.input, "input") !== deriveSchemaHash(node.target.input, "input")
          || workflowTerminalResultExecution(target).schemaHash !== deriveSchemaHash(node.target.result, "output")) throw new Error("delegation-target-contract-mismatch");
        const plan = planCanonicalDelegation(context, target, authority.evidenceSchemaHash?.bind(authority));
        return { context, target, plan };
      });
      if (dependencies.beforeConfirmedWrite !== undefined) await dependencies.beforeConfirmedWrite();
      batch.signal.throwIfAborted();
      const admitted = admission.admitAndRelease(batch, planned.map(({ plan }) => plan));
      return authority.withAuthorityReadSnapshot(() => {
        const parent = requireRun(authority, batch.run.envelope.runId);
        const values: Record<string, unknown> = {};
        for (const [index, { context, target, plan }] of planned.entries()) {
          const { node } = context;
          const member = admitted.entries[index];
          if (member?.state === "reused") {
            values[node.id] = resolveExecutableChildOutput(member.evidence, node.target.result, authority.authority.failures,
              parent.envelope.parent?.edgeId, authority.evidenceSchemaHash?.bind(authority)).output;
            continue;
          }
          const manifest = DelegationManifestSchema.parse(member?.manifest);
          const retained = authority.authority.delegationManifests.get(manifest.manifestId);
          if (retained === undefined || canonicalJsonStringify(retained) !== canonicalJsonStringify(manifest)
            || manifest.parentRunId !== parent.envelope.runId || (authority.evidenceSchemaHash?.({ kind: "delegation-input", id: manifest.manifestId }, manifest, manifest.inputSchemaHash, deriveSchemaHash(node.target.input, "input")) ?? manifest.inputSchemaHash) !== deriveSchemaHash(node.target.input, "input")
            || (authority.evidenceSchemaHash?.({ kind: "delegation-result", id: manifest.manifestId }, manifest, manifest.resultSchemaHash, deriveSchemaHash(node.target.result, "output")) ?? manifest.resultSchemaHash) !== deriveSchemaHash(node.target.result, "output")) throw new Error("delegation-manifest-binding-mismatch");
          assertDelegationReplayMatches({ edgeId: manifest.edgeId, planFingerprint: manifest.manifestFingerprint }, plan);
          if (manifest.cardinality !== plan.cardinality || manifest.join !== plan.join
            || canonicalJsonStringify(manifest.policy) !== canonicalJsonStringify(plan.policy)
            || canonicalJsonStringify(manifest.children.map(({ childItemId, canonicalInputFingerprint }) => ({ childItemId, canonicalInputFingerprint })))
              !== canonicalJsonStringify(plan.children.map(({ childItemId, canonicalInputFingerprint }) => ({ childItemId, canonicalInputFingerprint })))) {
            throw new Error("delegation-manifest-plan-mismatch");
          }
          const authenticated = authority.authority.dependencies.authenticateGroup(manifest);
          const children = authenticated.children.map(({ entry, child, dependency, terminal }, index) => {
            assertChildBinding(parent, child, context, target);
            if (child.envelope.descriptorVersion !== target.version || child.envelope.contractFingerprint !== target.contractFingerprint
              || child.input.ingressSchemaHash !== manifest.inputSchemaHash
              || canonicalJsonStringify(parseCanonicalInputSnapshot(target.canonicalInput, child.input.parsed, { owner: { kind: "run-input", id: child.envelope.runId }, source: child.input, schemaReader: authority.evidenceSchemaHash?.bind(authority) }))
                !== canonicalJsonStringify(plan.children[index]?.input)) throw new Error("delegation-child-input-mismatch");
            if (dependency.parentRunId !== parent.envelope.runId || dependency.childRunId !== entry.childRunId
              || dependency.childItemId !== entry.childItemId || child.envelope.itemId !== entry.childItemId
              || dependency.manifestId !== manifest.manifestId || dependency.edgeId !== manifest.edgeId
              || canonicalJsonStringify(dependency.policy) !== canonicalJsonStringify(plan.policy)) throw new Error("delegation-dependency-binding-mismatch");
            return { child, dependency, terminal };
          });
          if (admitted.state === "released") continue;
          assertHeldParent(batch, parent);
          if (node.await === "none") {
            values[node.id] = DelegationManifestRefSchema.parse({ manifestId: manifest.manifestId, edgeId: manifest.edgeId, childCount: children.length });
            continue;
          }
          const settled = children.map(({ child: currentChild, dependency, terminal }) => {
            const child = terminal?.run ?? currentChild;
            if (child.lifecycle.state !== "terminal") throw new Error("delegation-child-not-terminal");
            const result = RunResultRecordSchema.parse(terminal?.result ?? authority.authority.runResults.get(child.envelope.runId));
            switch (child.lifecycle.outcome) {
              case "done": {
                if (dependency.state !== "satisfied") throw new Error("delegation-dependency-unsettled");
                const preview = readRunPreviewResult(result);
                if (result.runId !== child.envelope.runId || result.workflowId !== child.envelope.workflow
                  || result.attempt !== child.envelope.attempt || result.descriptorVersion !== child.envelope.descriptorVersion
                  || result.contractFingerprint !== child.envelope.contractFingerprint
                  || (preview === undefined ? result.resultSchemaHash !== manifest.resultSchemaHash : !child.envelope.dryRun || !parent.envelope.dryRun)
                  || child.completion?.kind !== "done" || child.completion.resultDigest !== result.resultDigest
                  || result.configFingerprint !== child.envelope.configFingerprint || result.configSnapshotId !== child.envelope.configSnapshotId) {
                  throw new Error("delegation-child-result-mismatch");
                }
                return { run: child, result };
              }
              case "failed": {
                const failureId = child.lifecycle.failureId;
                if (failureId === undefined) throw new Error("delegation-child-failure-mismatch");
                const failure = authority.authority.failures.get(failureId);
                if (dependency.state !== "failed" || failure === undefined || failure.runId !== child.envelope.runId
                  || failure.attempt !== child.envelope.attempt || failure.workflowId !== child.envelope.workflow) throw new Error("delegation-child-failure-mismatch");
                return { run: child, result };
              }
              case "cancelled": {
                if (dependency.state !== "cancelled") throw new Error("delegation-dependency-unsettled");
                const source = authority.authority.dependencies.cancellationOutcome(child.envelope.runId);
                return { run: child, result, cancellation: source };
              }
              default:
                throw new Error("delegation-child-terminal-outcome-unresolved");
            }
          });
          const evidence = DelegationTerminalEvidenceSchema.parse({ state: "delegation-resolved", nodeId: node.id,
            parentRunId: parent.envelope.runId, edgeId: manifest.edgeId, invocationCommandId: authenticated.invocation.commandId,
            manifest, children: settled });
          values[node.id] = resolveExecutableChildOutput(evidence, node.target.result, authority.authority.failures,
            parent.envelope.parent?.edgeId, authority.evidenceSchemaHash?.bind(authority)).output;
        }
        if (admitted.state === "released") {
          const wait = authority.authority.dependencies.wait(parent.envelope.runId, batch.descriptor);
          const waiting = planned.find(({ context }, index) => context.node.await !== "none" && admitted.entries[index]?.state === "admitted");
          const member = waiting === undefined ? undefined : admitted.entries[planned.indexOf(waiting)];
          const manifest = member?.state === "admitted" ? member.manifest : undefined;
          if (wait?.admissionCommandId !== admitted.admissionCommandId || wait.nodeId !== batch.owner.id
            || manifest === undefined || parent.lifecycle.state !== "queued" || runClaim(parent) !== undefined
            || parent.version <= batch.run.version || Number(parent.claimGeneration) !== Number(batch.claim.claimGeneration)
            || parent.cancelRequested === true || canonicalJsonStringify(parent.envelope) !== canonicalJsonStringify(batch.run.envelope)
            || canonicalJsonStringify(parent.input) !== canonicalJsonStringify(batch.run.input)) throw new Error("delegation-parent-release-unproved");
          return DelegationPendingSchema.parse({ state: "delegation-pending", runId: parent.envelope.runId,
            manifestId: manifest.manifestId, admissionCommandId: admitted.admissionCommandId });
        }
        return values;
      });
    },
  };
}
