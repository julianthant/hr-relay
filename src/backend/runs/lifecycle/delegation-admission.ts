import { AuthenticatedRunContinuation } from "../../storage/sqlite/run-continuation-delegation.js";
import { continuationEvidenceDigest } from "../../storage/sqlite/run-continuation.js";
import { authenticateWorkbookReferenceChoice, authenticateWorkbookReferenceExecution } from "../workbooks.js";
import type { z } from "zod";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor, workflowDryRunSupport, workflowPlanning, workflowProjections, workflowTerminalResultExecution } from "../../../workflow-kit/workflow.js";
import { freezeWorkflowOperationDisplaySnapshot } from "../../../models/workflow/operation-display-snapshot.js";
import { parseCanonicalInputSnapshot } from "../../../models/workflow/canonical-input.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { retainedRunProtectedBindings, valueFreeProtectedData, valueFreeProtectedInput } from "../../../models/write-safety/protected-input.js";
import { readRunPreviewResult, delegationDependencyRecord, delegationEvidenceOutput } from "../../../models/run/result.js";
import { runClaim, type RunRecord } from "../../../models/run/record.js";
import { assertDelegationReplayMatches, type DelegationPlan } from "../../../models/workflow/delegation.js";
import { projectTransactionOutcome, type AnyWorkflowRef } from "../../../models/workflow/graph.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { delegationInvocationCommandId } from "../../../rules/commands/lifecycle-command-id.js";
import { lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { DelegationReadReuseSchema, DelegationManifestSchema, DependencyRecordSchema } from "../../../rules/workflow/dependencies.js";
import { RunLifecycleCommandAuditRecordSchema, RunLifecycleCommandRecordSchema, RunLifecycleCommandFenceSchema, RunLifecycleCommandOperationSchema } from "../../../rules/commands/commands.js";
import { DelegationAdmissionRequestSchema, DelegationInvocationRequestSchema, DelegationRefreshRequestSchema } from "../../storage/sqlite/delegation-contracts.js";
import { authenticateOriginalDelegationGroup, currentDelegationManifests, readDelegationScopeEvidence } from "../../storage/sqlite/delegation-authority.js";
import { authenticateDelegationRefresh } from "../../storage/sqlite/delegation-refresh.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import type { ChildRunBatchContext, ChildRunContext } from "../../runtime/execution/run-executor.js";
import { resolveInstances } from "../start/plan.js";
import { selectRunRuntime } from "../settings/run-settings.js";
import type { CreateRunRequest, RunQueuedPublication, RunRecordServiceDependencies, RunRecoveryOutcome } from "./run-record-service.js";
import { protectedSubjectDisplay } from "../start/protected-input.js";
import { SETTINGS_CATALOG } from "../../../models/config/catalog.js";
import { canonicalDelegationChild, planCanonicalDelegation } from "./delegation-planning.js";
import { isLiveWorker } from "../../../models/run/worker.js";
import { authenticateRootRun } from "../../storage/sqlite/delegation-root-authority.js";
import { delegatedCandidateEligible } from "./run-claim-admission.js";
import { readRunCheckpoint } from "../../runtime/checkpoints/run-checkpoint-reader.js";
import { CheckpointExpectationSchema, loadCheckpoint, resolveFreshnessBound } from "../../../models/workflow/checkpoint.js";
import { BUILD_MANIFEST, resolveTaskImplFingerprint } from "../../../workflow-kit/validation/build-manifest.js";
import type { BuildManifest } from "../../../models/workflow/build-manifest.js";
import { TransactionOutcomeSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import { deriveGateResultCheckpointFingerprint } from "../../../models/workflow/gates.js";
import { taskSpanPath } from "../../logs/span-emitter.js";
import { readObservationPath } from "../../../models/events/data-observation-origin.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { DelegationManifestIdSchema, DependencyIdSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";

type Journal = z.infer<typeof RunLifecycleCommandRecordSchema>;
type JournalResult = z.infer<typeof RunLifecycleCommandAuditRecordSchema>["result"];
type Inspection = Readonly<{ state: "new"; command: Journal }> | Readonly<{ state: "divergent" }>
  | Readonly<{ state: "replay"; command: Journal; result: JournalResult }>;
interface AdmissionLifecycle {
  create(request: CreateRunRequest, publication: RunQueuedPublication): RunRecord;
  inspectJournal(repositories: AuthorityRepositories, operation: z.infer<typeof RunLifecycleCommandOperationSchema>, request: unknown,
    fence: z.input<typeof RunLifecycleCommandFenceSchema>): Inspection;
  recordJournal(repositories: AuthorityRepositories, command: Journal, result: JournalResult): void;
  release(request: unknown): RunRecoveryOutcome;
}

export function admitDelegation(dependencies: RunRecordServiceDependencies, batch: ChildRunBatchContext,
  suppliedPlans: readonly DelegationPlan<AnyWorkflowRef>[], lifecycle: AdmissionLifecycle) {
  batch.signal.throwIfAborted();
  const buildManifest = dependencies.buildManifest ?? BUILD_MANIFEST;
  return dependencies.database.withAuthorityTransaction(repositories => {
    const nodes = descriptorRuntimeNodes(batch.descriptor);
    if (!nodes.includes(batch.owner)) throw new Error("delegation-owner-binding-mismatch");
    const leafIds = batch.owner.kind === "child-run" ? [batch.owner.id]
      : batch.owner.branches.flatMap(branch => branch.nodes).filter(id => nodes.some(node => node.id === id && node.kind === "child-run"));
    if (leafIds.length === 0 || new Set(leafIds).size !== leafIds.length || suppliedPlans.length !== leafIds.length || batch.leaves.length !== leafIds.length
      || batch.leaves.some((leaf, index) => leaf.node.id !== leafIds[index] || !nodes.includes(leaf.node))) throw new Error("delegation-owner-membership-mismatch");
    const admitted = batch.leaves.map((leaf, leafIndex) => {
      const context: ChildRunContext = { ...batch, ...leaf };
      const suppliedPlan = suppliedPlans[leafIndex];
      const parent = repositories.runs.get(context.run.envelope.runId);
      const held = parent === undefined ? undefined : runClaim(parent);
      if (parent === undefined || parent.lifecycle.state !== "running" || parent.lifecycle.currentNodeId !== batch.owner.id
        || parent.version !== context.run.version || parent.cancelRequested === true
        || canonicalJsonStringify(parent) !== canonicalJsonStringify(context.run)
        || held?.workerId !== context.claim.workerId || held.claimGeneration !== context.claim.claimGeneration) throw new Error("delegation-parent-claim-stale");
      const slot = repositories.workerSlots.get(held.workerId), lease = repositories.workerLeases.get(held.workerId);
      const owner = parent.lifecycle.workerLifetime;
      if (slot === undefined || slot.retiredAt !== null || lease === undefined || !isLiveWorker(lease)
        || lease.lifecycle.state === "stopping"
        || owner === undefined || owner.membershipRevision !== slot.membershipRevision || owner.leaseGeneration !== lease.leaseGeneration
        || repositories.workerControls.resetForWorker(held.workerId) !== undefined
        || repositories.workerControls.resetForRun(parent.envelope.runId) !== undefined
        || repositories.workerControls.lifecycleForWorker(held.workerId) !== undefined
        || repositories.workerSlots.recovery(held.workerId) !== undefined
        || repositories.workerSlots.verification(held.workerId) !== undefined
        || repositories.workerControls.initializingForWorker(held.workerId, lease.leaseGeneration) !== undefined) throw new Error("delegation-worker-authority-stale");
      const descriptor = dependencies.resolveDescriptor?.(parent.envelope.workflow);
      const target = dependencies.resolveDescriptor?.(context.node.target.id);
      if (parent.envelope.parent === undefined) authenticateRootRun(repositories, parent);
      else if (!delegatedCandidateEligible(repositories, parent, slot.workflow, dependencies.resolveDescriptor)) {
        throw new Error("delegation-parent-home-authority-unavailable");
      }
      if (descriptor === undefined || target === undefined) throw new Error("delegation-target-unavailable");
      if (descriptor !== context.descriptor || descriptor.version !== parent.envelope.descriptorVersion
        || descriptor.contractFingerprint !== parent.envelope.contractFingerprint
        || !descriptorRuntimeNodes(descriptor).includes(context.node)
        || target.id !== context.node.target.id
        || deriveSchemaHash(target.input, "input") !== deriveSchemaHash(context.node.target.input, "input")
        || workflowTerminalResultExecution(target).schemaHash !== deriveSchemaHash(context.node.target.result, "output")) throw new Error("delegation-node-binding-mismatch");
      const dryRunSupport = workflowDryRunSupport(target);
      if (parent.envelope.dryRun && dryRunSupport.state === "unsupported" && dryRunSupport.reason !== "no-transaction-node") throw new Error("delegation-target-dry-run-unsupported");
      const snapshot = repositories.configSnapshots.get(parent.envelope.configSnapshotId);
      const active = repositories.runtimeConfig.get();
      if (snapshot === undefined || snapshot.fingerprint !== parent.envelope.configFingerprint || active === undefined
        || active.configSnapshotId !== snapshot.configSnapshotId || active.configFingerprint !== snapshot.fingerprint) throw new Error("delegation-config-stale");
      if (canonicalJsonStringify(resolveInstances(descriptor, parent.envelope.requestedInstance)) !== canonicalJsonStringify(parent.envelope.resolvedInstance)) throw new Error("delegation-parent-instance-mismatch");
      if (repositories.writeIntents.listAttemptingByItem({ workflowId: parent.envelope.workflow, itemId: parent.envelope.itemId }).length > 0
        || repositories.writeIntents.listByRun(parent.envelope.runId).some(intent => intent.status === "parked")) throw new Error("delegation-write-recovery-required");
      authenticateWorkbookReferenceExecution(repositories, parent);
      const canonicalInput = parseCanonicalInputSnapshot(descriptor.canonicalInput, parent.input.parsed);
      if (canonicalJsonStringify(canonicalInput) !== canonicalJsonStringify(context.scope.input)
        || canonicalJsonStringify(retainedRunProtectedBindings(parent)) !== canonicalJsonStringify(context.scope.protectedInputBindings ?? [])) throw new Error("delegation-scope-input-mismatch");
      for (const [key, configured] of Object.entries(context.scope.configuration ?? {})) {
        if (!SETTINGS_CATALOG.some(row => row.key === key && row.sensitivity === "ordinary")) throw new Error("delegation-scope-configuration-unavailable");
        let value: unknown = snapshot.config;
        for (const segment of key.split(".")) value = value !== null && typeof value === "object" ? Reflect.get(value, segment) : undefined;
        if (value === undefined || canonicalJsonStringify(value) !== canonicalJsonStringify(configured)) throw new Error("delegation-scope-configuration-mismatch");
      }
      const approvals = context.node.dependsOn.map(nodeId => {
        const value = context.scope.outputs[nodeId];
        const source = descriptorRuntimeNodes(descriptor).find(node => node.id === nodeId);
        if (source === undefined) throw new Error("delegation-scope-node-unavailable");
        if (source.kind === "child-run") {
          const evidence = repositories.dependencies.evidence(parent.envelope.runId, nodeId);
          if (evidence.edgeId !== source.edgeId || evidence.manifest.cardinality !== source.cardinality
            || evidence.manifest.join !== source.join || canonicalJsonStringify(evidence.manifest.policy) !== canonicalJsonStringify(source.policy)
            || evidence.manifest.inputSchemaHash !== deriveSchemaHash(source.target.input, "input")
            || evidence.manifest.resultSchemaHash !== deriveSchemaHash(source.target.result, "output")
            || canonicalJsonStringify(delegationEvidenceOutput(evidence, source.target.result)) !== canonicalJsonStringify(value)) throw new Error("delegation-scope-outcome-mismatch");
          const sourceCommand = repositories.lifecycleJournal.getCommand(evidence.invocationCommandId);
          if (sourceCommand === undefined || !("kind" in sourceCommand) || sourceCommand.kind !== "run-lifecycle"
            || DelegationInvocationRequestSchema.parse(sourceCommand.request).target.workflowId !== source.target.id) throw new Error("delegation-scope-outcome-mismatch");
          if (evidence.children.some(child => child.result.result.protectedBindings?.length)) throw new Error("delegation-protected-output-mapping-unavailable");
          return { nodeId, delegation: delegationDependencyRecord(evidence) };
        }
        if (source.kind === "gate") {
          const gate = repositories.gateResults.get(`${parent.envelope.runId}:${nodeId}`);
          if (gate === undefined || value === undefined || gate.runId !== parent.envelope.runId || gate.nodeId !== nodeId || String(gate.gateId) !== String(nodeId)
            || gate.result.schemaHash !== deriveSchemaHash(source.result, "output")
            || gate.checkpointFingerprint !== deriveGateResultCheckpointFingerprint(gate.result)
            || canonicalJsonStringify(source.result.parse(gate.result.value)) !== canonicalJsonStringify(value)) throw new Error("delegation-approval-mismatch");
          if ("source" in gate) {
            if (source.resolvedBy === "operator" || gate.source.attempt !== parent.envelope.attempt) throw new Error("delegation-approval-source-mismatch");
          } else {
            const command = repositories.commands.get(gate.commandId), audit = repositories.commandAudits.findByCommand(gate.commandId);
            if (command?.family === "run" && command.type === "resolve-workbook-reference-row") {
              if (source.resolvedBy !== "operator") throw new Error("delegation-approval-source-mismatch");
              authenticateWorkbookReferenceChoice(repositories, parent, gate);
            } else if (source.resolvedBy !== "operator" || command?.family !== "gate" || command.type !== "resolve-gate"
              || command.target.runId !== parent.envelope.runId || String(command.target.gateId) !== String(nodeId) || command.target.expectedVersion !== gate.expectedVersion
              || command.requestedBy !== gate.resolvedBy || canonicalJsonStringify(command.payload.result) !== canonicalJsonStringify(gate.result)
              || audit?.result.state !== "applied" || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) throw new Error("delegation-approval-source-mismatch");
          }
          return { nodeId, gate };
        }
        if (source.kind === "task" || source.kind === "transaction") {
          const checkpoint = readRunCheckpoint(repositories, parent.envelope, nodeId, true);
          if (checkpoint === undefined || checkpoint.descriptorVersion !== descriptor.version || checkpoint.contractFingerprint !== descriptor.contractFingerprint
            || checkpoint.workflowId !== parent.envelope.workflow || checkpoint.itemId !== parent.envelope.itemId || checkpoint.attempt > parent.envelope.attempt
            || value === undefined || checkpoint.runId === parent.envelope.runId && checkpoint.claimGeneration > parent.claimGeneration
            || canonicalJsonStringify(source.kind === "transaction" ? projectTransactionOutcome(source.commit.uses, checkpoint.output.value, "delegation prerequisite") : checkpoint.output.value) !== canonicalJsonStringify(value)) throw new Error("delegation-scope-checkpoint-mismatch");
          if (source.kind === "task") {
            const continued = parent.envelope.continuation?.checkpoints.some(reference => reference.nodeId === nodeId
              && reference.nodeId === checkpoint.nodeId && reference.runId === checkpoint.runId
              && reference.attempt === checkpoint.attempt && reference.claimGeneration === checkpoint.claimGeneration
              && reference.digest === continuationEvidenceDigest(checkpoint)) === true;
            if (checkpoint.assertion !== undefined
              || checkpoint.runId !== parent.envelope.runId && source.replay !== "checkpoint" && !continued) throw new Error("delegation-scope-checkpoint-mismatch");
            const producer = repositories.runs.get(checkpoint.runId);
            if (producer === undefined || producer.envelope.workflow !== parent.envelope.workflow || producer.envelope.itemId !== parent.envelope.itemId
              || producer.envelope.attempt !== checkpoint.attempt || producer.envelope.contractFingerprint !== descriptor.contractFingerprint) throw new Error("delegation-scope-checkpoint-mismatch");
            const loaded = loadCheckpoint(checkpoint, CheckpointExpectationSchema.parse({ descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
              implFingerprint: resolveTaskImplFingerprint(buildManifest, source.uses.id), outputSchemaHash: deriveSchemaHash(source.uses.output, "output") }), source.uses.output);
            if (!loaded.found || checkpoint.provenance.some(fact => {
              const observedAt = fact.source === "derived" ? fact.originalObservedAt : fact.observedAt;
              const age = dependencies.clock.nowMs() - Date.parse(observedAt);
              return age < 0 || age > resolveFreshnessBound(source.uses.freshness, fact.path).maxAgeMs;
            })) throw new Error("delegation-scope-checkpoint-mismatch");
          } else if (checkpoint.runId !== parent.envelope.runId || checkpoint.attempt !== parent.envelope.attempt
            || checkpoint.output.schemaHash !== deriveSchemaHash(TransactionOutcomeSchema, "output")
            || checkpoint.implFingerprint !== resolveTaskImplFingerprint(buildManifest, source.commit.uses.id)
            || !TransactionOutcomeSchema.safeParse(checkpoint.output.value).success) throw new Error("delegation-scope-checkpoint-mismatch");
          authenticateObservationOrigins(repositories, descriptor, checkpoint, buildManifest);
          return { nodeId, checkpoint };
        }
        throw new Error("delegation-scope-source-unavailable");
      });
      if (Object.keys(context.scope.outputs).some(key => !context.node.dependsOn.some(nodeId => nodeId === key))) throw new Error("delegation-scope-extra-output");
      const plan = planCanonicalDelegation(context, target);
      if (canonicalJsonStringify(plan) !== canonicalJsonStringify(suppliedPlan)) throw new Error("delegation-plan-mismatch");
      const reused = parent.envelope.continuation === undefined ? undefined
        : AuthenticatedRunContinuation.authenticate(repositories, parent.envelope).delegation(context.node.id, context.node.edgeId);
      if (reused !== undefined) {
        assertDelegationReplayMatches({ edgeId: reused.edgeId, planFingerprint: reused.manifest.manifestFingerprint }, plan);
        if (reused.manifest.inputSchemaHash !== deriveSchemaHash(context.node.target.input, "input")
          || reused.manifest.resultSchemaHash !== deriveSchemaHash(context.node.target.result, "output")) throw new Error("delegation-target-contract-mismatch");
        return { state: "reused" as const, evidence: reused };
      }
      const scopeEvidence = approvals.map(entry => "delegation" in entry ? { kind: "delegation" as const, nodeId: entry.nodeId, receipt: entry.delegation } : "gate" in entry ? { kind: "gate" as const, nodeId: entry.nodeId }
        : { kind: "checkpoint" as const, nodeId: entry.nodeId, runId: entry.checkpoint.runId, attempt: entry.checkpoint.attempt, claimGeneration: entry.checkpoint.claimGeneration });
      const observedScopeDigest = sha256Hex(canonicalJsonStringify(valueFreeProtectedData(approvals)));
      let invocationCommandId = lifecycleCommandId("delegation-invocation", { runId: parent.envelope.runId, attempt: parent.envelope.attempt, nodeId: context.node.id });
      let retainedInvocation: z.infer<typeof DelegationInvocationRequestSchema> | undefined;
      let revision: z.infer<typeof DelegationInvocationRequestSchema>["revision"];
      const currentManifest = currentDelegationManifests(repositories,parent.envelope.runId).find(manifest => {
        const command = repositories.lifecycleJournal.findDelegationInvocation(manifest.manifestId);
        return command !== undefined && DelegationInvocationRequestSchema.parse(command.request).nodeId === context.node.id;
      });
      if (currentManifest !== undefined) {
        const previous = authenticateOriginalDelegationGroup(repositories,currentManifest);
        const original = readDelegationScopeEvidence(repositories,parent,previous.invocation.scopeEvidence);
        if (sha256Hex(canonicalJsonStringify(valueFreeProtectedData(original))) !== previous.invocation.approvalDigest) throw new Error("delegation-replay-divergent");
        const sameScope = canonicalJsonStringify(original.map(entry => reconfirmedScopeIdentity(repositories,descriptor,entry,buildManifest)))
          === canonicalJsonStringify(approvals.map(entry => reconfirmedScopeIdentity(repositories,descriptor,entry,buildManifest)));
        const refresh = parent.delegationRefresh;
        let refreshedCheckpoint = false;
        if (refresh?.phase === "settled" && previous.invocation.revision?.refreshCommandId !== refresh.commandId) {
          authenticateDelegationRefresh(repositories,parent);
          const command = repositories.lifecycleJournal.getCommand(refresh.commandId);
          if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle") throw new Error("delegation-refresh-authority-unavailable");
          const root = DelegationRefreshRequestSchema.parse(command.request);
          if (root.phase !== "admit") throw new Error("delegation-refresh-root-mismatch");
          refreshedCheckpoint = approvals.some(entry => {
            if (!("checkpoint" in entry) || entry.checkpoint === undefined) return false;
            const node = descriptorRuntimeNodes(descriptor).find(node => node.id === entry.nodeId);
            const old = original.find(previous => previous.nodeId === entry.nodeId);
            return node?.kind === "task" && node.replay === "always-rerun" && old !== undefined && "checkpoint" in old && old.checkpoint !== undefined
              && entry.checkpoint.runId === parent.envelope.runId && entry.checkpoint.claimGeneration > root.claimGeneration
              && (old.checkpoint.runId !== parent.envelope.runId || old.checkpoint.claimGeneration <= root.claimGeneration);
          });
        }
        if (sameScope && !refreshedCheckpoint) {
          retainedInvocation = previous.invocation;
          invocationCommandId = previous.invocation.commandId;
          revision = previous.invocation.revision;
        } else {
          if (refresh?.phase !== "settled" || previous.invocation.revision?.refreshCommandId === refresh.commandId) throw new Error("delegation-replay-divergent");
          authenticateDelegationRefresh(repositories,parent);
          revision = { previousInvocationCommandId: previous.invocation.commandId, refreshCommandId: refresh.commandId,
            settlementCommandId: lifecycleCommandId("delegation-refresh-settle", { rootCommandId: refresh.commandId, retryCommandIds: refresh.retryCommandIds }) };
          invocationCommandId = delegationInvocationCommandId({ runId: parent.envelope.runId, attempt: parent.envelope.attempt, nodeId: context.node.id, revision });
        }
      }
      const manifestId = DelegationManifestIdSchema.parse(lifecycleCommandId("delegation-manifest",invocationCommandId));
      const reuse = plan.children.map((planned,index) => retainedInvocation?.children[index]?.reuse ?? (revision === undefined || currentManifest === undefined || retainedInvocation !== undefined
        ? undefined : reusableDelegationRead(repositories,dependencies,currentManifest,planned,target,buildManifest)));
      const invocation = DelegationInvocationRequestSchema.parse({ ...(revision === undefined ? {} : { revision }), commandId: invocationCommandId, runId: parent.envelope.runId,
        attempt: parent.envelope.attempt, nodeId: context.node.id, edgeId: context.node.edgeId, manifestId,
        definitionFingerprint: descriptor.contractFingerprint, parentInputDigest: sha256Hex(canonicalJsonStringify(valueFreeProtectedData(parent.input))),
        approvalDigest: retainedInvocation?.approvalDigest ?? observedScopeDigest,
        scopeEvidence: retainedInvocation?.scopeEvidence ?? scopeEvidence,
        target: { workflowId: target.id, descriptorVersion: target.version, contractFingerprint: target.contractFingerprint,
          inputSchemaHash: deriveSchemaHash(target.input, "input"), canonicalInputSchemaHash: deriveSchemaHash(target.canonicalInput, "output"), resultSchemaHash: workflowTerminalResultExecution(target).schemaHash },
        configSnapshotId: parent.envelope.configSnapshotId, configFingerprint: parent.envelope.configFingerprint,
        dryRun: parent.envelope.dryRun, cardinality: plan.cardinality, join: plan.join, policy: plan.policy, planFingerprint: plan.planFingerprint,
        children: plan.children.map(({ childItemId, canonicalInputFingerprint, sourceRecordIds },index) => ({ childItemId, canonicalInputFingerprint,
          ...(reuse[index] === undefined ? {} : { reuse: reuse[index] }),
          ...(sourceRecordIds === undefined ? {} : { sourceRecordIds }) })) });
      const journal = lifecycle.inspectJournal(repositories, "delegation-invocation", invocation, { kind: "none" });
      if (journal.state === "divergent") throw new Error("delegation-replay-divergent");
      let manifest = repositories.delegationManifests.get(manifestId);
      if (journal.state === "new") {
        if (manifest !== undefined) throw new Error("delegation-manifest-orphaned");
        const systems = workflowProjections(target).systems;
        const inherited = Object.fromEntries(Object.entries(parent.envelope.requestedInstance ?? {}).filter(([system]) => systems.includes(system)));
        const resolvedInstance = resolveInstances(target, inherited);
        const display = freezeWorkflowOperationDisplaySnapshot({ workflowId: target.id, definitionFingerprint: target.contractFingerprint, display: target.operationDisplay });
        const children = plan.children.map((planned, index) => {
          const { input, bindings, matchKey, canonicalItemId } = canonicalDelegationChild(context, target, planned.input);
          for (const approval of approvals) {
            if ("delegation" in approval) continue;
            const output = approval.gate !== undefined ? approval.gate.result : approval.checkpoint.output;
            for (const binding of output.protectedBindings ?? []) {
              const sourceValue: unknown = Reflect.get(Object(output.value), binding.inputPath);
              const contains = (value: unknown): boolean => value !== null && typeof value === "object"
                ? Object.values(value).some(contains) : value === sourceValue;
              if (sourceValue !== undefined && contains(input) && (!bindings.some(candidate => canonicalJsonStringify(candidate) === canonicalJsonStringify(binding))
                || canonicalJsonStringify(Reflect.get(Object(canonicalInput), binding.inputPath)) !== canonicalJsonStringify(sourceValue))) throw new Error("delegation-protected-output-mapping-unavailable");
            }
          }
          if (canonicalItemId !== planned.childItemId) throw new Error("delegation-child-match-key-mismatch");
          const retained = reuse[index];
          if (retained !== undefined) {
            const child = repositories.runs.get(retained.runId);
            if (child === undefined) throw new Error("delegation-reuse-child-unavailable");
            return { dependencyId: DependencyIdSchema.parse(lifecycleCommandId("delegation-dependency", { invocationCommandId,index })),
              childRunId: child.envelope.runId, childItemId: child.envelope.itemId, canonicalInputFingerprint: planned.canonicalInputFingerprint, reuse: retained };
          }
          const activeChildren = repositories.runs.listByItem({ workflow: target.id, itemId: planned.childItemId }).filter(run => run.lifecycle.state !== "terminal");
          if (activeChildren.length > 0 && target.enqueue !== "allow-parallel") throw new Error("delegation-target-item-active");
          const child = lifecycle.create({ commandId: lifecycleCommandId("delegation-child-create", { invocationCommandId, index }),
            code: target.code, workflow: target.id, matchKey, descriptorVersion: target.version, contractFingerprint: target.contractFingerprint,
            operationDisplayCapability: display === undefined ? "legacy" : "complete", ...(display === undefined ? {} : { operationDisplaySnapshot: display }),
            configSnapshotId: parent.envelope.configSnapshotId, configFingerprint: parent.envelope.configFingerprint, resolvedInstance,
            ...(Object.keys(inherited).length === 0 ? {} : { requestedInstance: inherited }),
            priority: parent.envelope.priority, shape: "operation-member", dryRun: parent.envelope.dryRun,
            ...(revision === undefined ? {} : { recovery: "restart-from-start" as const }),
            ...(parent.envelope.browserMode === undefined ? {} : { browserMode: parent.envelope.browserMode }),
            ...(parent.envelope.captureBrowserScreenshots === undefined ? {} : { captureBrowserScreenshots: parent.envelope.captureBrowserScreenshots }),
            parent: { runId: parent.envelope.runId, edgeId: plan.edgeId, tracePrefix: parent.envelope.traceId },
            input: { raw: valueFreeProtectedInput(input, bindings), parsed: { schemaHash: invocation.target.canonicalInputSchemaHash, value: input, protectedBindings: bindings }, ingressSchemaHash: invocation.target.inputSchemaHash },
            ...(parent.appVersion === undefined ? {} : { appVersion: parent.appVersion }), runtimeConfig: selectRunRuntime(repositories) },
          { ...protectedSubjectDisplay(bindings, () => {
            const planning = workflowPlanning(target);
            return { title: planning.title(input), subtitle: planning.subtitle(input) };
          }), actorId: LOCAL_OPERATOR_ACTOR_ID });
          if (child.envelope.itemId !== planned.childItemId) throw new Error("delegation-child-match-key-mismatch");
          const dependencyId = DependencyIdSchema.parse(lifecycleCommandId("delegation-dependency", { invocationCommandId, index }));
          return { dependencyId, childRunId: child.envelope.runId, childItemId: child.envelope.itemId, canonicalInputFingerprint: planned.canonicalInputFingerprint };
        });
        manifest = DelegationManifestSchema.parse({ ...(revision === undefined ? {} : { revision: { previousInvocationCommandId: revision.previousInvocationCommandId, previousManifestId: retainedInvocation === undefined ? currentManifest?.manifestId : currentManifest?.revision?.previousManifestId, refreshCommandId: revision.refreshCommandId, settlementCommandId: revision.settlementCommandId } }), manifestId, parentRunId: parent.envelope.runId, edgeId: plan.edgeId,
          inputSchemaHash: invocation.target.inputSchemaHash, resultSchemaHash: invocation.target.resultSchemaHash,
          cardinality: plan.cardinality, join: plan.join, policy: plan.policy, children, manifestFingerprint: plan.planFingerprint, createdAt: dependencies.clock.now().toISOString() });
        repositories.delegationManifests.insert(manifest);
        for (const child of children) repositories.dependencies.insert(DependencyRecordSchema.parse({
          dependencyId: child.dependencyId, manifestId, edgeId: plan.edgeId, parentRunId: parent.envelope.runId,
          childRunId: child.childRunId, childItemId: child.childItemId, policy: plan.policy, state: "active", version: 1,
          createdAt: manifest.createdAt, updatedAt: manifest.createdAt,
        }));
        lifecycle.recordJournal(repositories, journal.command, { kind: "run", runId: parent.envelope.runId, appliedVersion: parent.version });
      } else if (manifest === undefined) throw new Error("delegation-manifest-unavailable");
      if (manifest.parentRunId !== parent.envelope.runId || manifest.edgeId !== plan.edgeId || manifest.manifestFingerprint !== plan.planFingerprint
        || manifest.inputSchemaHash !== invocation.target.inputSchemaHash || manifest.resultSchemaHash !== invocation.target.resultSchemaHash
        || manifest.cardinality !== plan.cardinality || manifest.join !== plan.join || canonicalJsonStringify(manifest.policy) !== canonicalJsonStringify(plan.policy)
        || manifest.children.length !== plan.children.length) throw new Error("delegation-manifest-binding-mismatch");
      authenticateOriginalDelegationGroup(repositories,manifest);
      const projected = Object.fromEntries(Object.entries(parent.envelope.requestedInstance ?? {}).filter(([system]) => workflowProjections(target).systems.includes(system)));
      for (const [index, entry] of manifest.children.entries()) {
        const planned = plan.children[index], child = repositories.runs.get(entry.childRunId), dependency = repositories.dependencies.get(entry.dependencyId);
        if (planned === undefined
          || entry.dependencyId !== DependencyIdSchema.parse(lifecycleCommandId("delegation-dependency", { invocationCommandId, index }))
          || entry.childItemId !== planned.childItemId || entry.canonicalInputFingerprint !== planned.canonicalInputFingerprint
          || child === undefined || child.envelope.parent?.runId !== parent.envelope.runId || child.envelope.parent.edgeId !== plan.edgeId
          || child.envelope.parent.tracePrefix !== parent.envelope.traceId || child.envelope.workflow !== target.id || child.envelope.itemId !== planned.childItemId
          || child.envelope.descriptorVersion !== target.version || child.envelope.contractFingerprint !== target.contractFingerprint
          || child.envelope.dryRun !== parent.envelope.dryRun || child.envelope.configSnapshotId !== parent.envelope.configSnapshotId
          || child.envelope.configFingerprint !== parent.envelope.configFingerprint || child.input.ingressSchemaHash !== invocation.target.inputSchemaHash
          || canonicalJsonStringify(child.envelope.requestedInstance ?? {}) !== canonicalJsonStringify(projected)
          || canonicalJsonStringify(child.input.parsed.protectedBindings) !== canonicalJsonStringify(retainedRunProtectedBindings(parent).filter(binding => planned.input !== null
            && typeof planned.input === "object" && Object.hasOwn(planned.input, binding.inputPath)))
          || canonicalJsonStringify(child.envelope.resolvedInstance) !== canonicalJsonStringify(resolveInstances(target, projected))
          || canonicalJsonStringify(parseCanonicalInputSnapshot(target.canonicalInput, child.input.parsed)) !== canonicalJsonStringify(planned.input)) throw new Error("delegation-child-binding-mismatch");
        if (dependency === undefined || dependency.manifestId !== manifestId || dependency.parentRunId !== parent.envelope.runId
          || dependency.childRunId !== child.envelope.runId || dependency.childItemId !== planned.childItemId || dependency.edgeId !== plan.edgeId
          || canonicalJsonStringify(dependency.policy) !== canonicalJsonStringify(plan.policy)
          || child.lifecycle.state !== "terminal" && dependency.state !== "active") throw new Error("delegation-dependency-binding-mismatch");
      }
      return { state: "admitted" as const, manifest, member: { state: "admitted" as const, nodeId: context.node.id,
        invocationCommandId, scopeEvidence, observedScopeDigest } };

    });
    const parent = repositories.runs.get(batch.run.envelope.runId);
    if (parent === undefined || canonicalJsonStringify(parent) !== canonicalJsonStringify(batch.run)) throw new Error("delegation-parent-claim-stale");
    repositories.dependencies.reconcile(parent.envelope.runId, dependencies.clock.now().toISOString());
    const ready = repositories.dependencies.readiness(parent.envelope.runId, "join").state === "ready";
    const admissions = admitted.flatMap(entry => {
      if (entry.state === "reused") return [];
      const request = DelegationAdmissionRequestSchema.parse({
        commandId: lifecycleCommandId("delegation-admission", { invocationCommandId: entry.member.invocationCommandId,
          claimGeneration: batch.claim.claimGeneration, version: parent.version }),
        runId: parent.envelope.runId, expectedVersion: parent.version, claim: batch.claim,
        invocationCommandId: entry.member.invocationCommandId, scopeEvidence: entry.member.scopeEvidence,
        observedScopeDigest: entry.member.observedScopeDigest,
      });
      const admission = lifecycle.inspectJournal(repositories, "delegation-admission", request,
        { kind: "terminal", expectedVersion: parent.version, ...batch.claim });
      if (admission.state === "divergent") throw new Error("delegation-replay-divergent");
      return [{ request, admission }];
    });
    const entries = admitted.map(member => member.state === "reused" ? member : { state: "admitted" as const, manifest: member.manifest });
    const anchor = admissions[0];
    if (!ready && anchor === undefined) throw new Error("delegation-release-anchor-unavailable");
    const released = ready ? parent : (() => {
      if (anchor === undefined) throw new Error("delegation-release-anchor-unavailable");
      const outcome = lifecycle.release({ commandId: lifecycleCommandId("delegation-release", anchor.request.commandId), runId: parent.envelope.runId,
        expectedVersion: parent.version, claim: batch.claim, cause: "recovery" });
      if (outcome.state !== "applied" || outcome.run.lifecycle.state !== "queued" || runClaim(outcome.run) !== undefined) throw new Error("delegation-release-refused");
      return outcome.run;
    })();
    const result = { kind: "run" as const, runId: released.envelope.runId, appliedVersion: released.version };
    for (const { admission } of admissions) if (admission.state === "new") lifecycle.recordJournal(repositories, admission.command, result);
    if (ready) return { state: "ready" as const, entries };
    if (anchor === undefined) throw new Error("delegation-release-anchor-unavailable");
    return { state: "released" as const, entries, admissionCommandId: anchor.request.commandId };
  });
}

function authenticateObservationOrigins(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor, checkpoint: RunCheckpointRecord, buildManifest: BuildManifest): void {
  if (checkpoint.observationOrigins === undefined) return;
  const nodes = descriptorRuntimeNodes(descriptor), node = nodes.find(node => node.id === checkpoint.nodeId);
  const run = repositories.runs.get(checkpoint.runId);
  if (node?.kind !== "task" || run === undefined) throw new Error("delegation-observation-source-unavailable");
  const allowed = new Set<string>();
  const visit = (id: string): void => {
    if (allowed.has(id)) return;
    allowed.add(id);
    const source = nodes.find(node => node.id === id);
    for (const dependency of source?.dependsOn ?? []) visit(dependency);
  };
  visit(node.id);
  const observed = new Set<string>();
  let after = 0;
  for (;;) {
    const page = repositories.timelineEvents.page({ runId: checkpoint.runId, after, limit: 1000 });
    for (const record of page) {
      if (record.payload.kind !== "span" || record.payload.event.t !== "data.observed") continue;
      const event = record.payload.event;
      const taskAttempt = Number(event.spanPath.split(".").at(-1));
      if (event.nodeId === checkpoint.nodeId && event.taskId === node.uses.id && event.attempt === checkpoint.attempt
        && Number.isSafeInteger(taskAttempt) && taskAttempt > 0
        && event.spanPath === taskSpanPath(run.envelope.traceId, checkpoint.nodeId, taskAttempt, checkpoint.claimGeneration)) {
        for (const point of event.points) for (const source of point.origins ?? []) {
          observed.add(canonicalJsonStringify([[...point.field.split("."), ...source.path],source.origin]));
        }
      }
    }
    if (page.length < 1000) break;
    const last = page.at(-1);
    if (last === undefined) throw new Error("delegation-observation-page-unavailable");
    after = last.cursor;
  }
  const checkpointsByProducer = new Map<string, readonly Readonly<{ checkpoint: RunCheckpointRecord; origins: ReadonlySet<string> }>[]>();
  for (const entry of checkpoint.observationOrigins) {
    const { origin } = entry;
    if (!observed.has(canonicalJsonStringify([entry.path,origin]))) throw new Error("delegation-observation-event-mismatch");
    const key = canonicalJsonStringify([origin.runId,origin.nodeId,origin.taskId,origin.attempt]);
    let candidates = checkpointsByProducer.get(key);
    if (candidates === undefined) {
      const producer = repositories.runs.get(origin.runId), source = nodes.find(node => node.id === origin.nodeId);
      if (producer !== undefined && producer.envelope.workflow !== checkpoint.workflowId) throw new Error("delegation-observation-child-result-origin-unavailable");
      if (!allowed.has(origin.nodeId) || source?.kind !== "task" || source.uses.id !== origin.taskId || producer === undefined
        || producer.envelope.workflow !== checkpoint.workflowId || producer.envelope.itemId !== checkpoint.itemId
        || producer.envelope.attempt !== origin.attempt || producer.envelope.contractFingerprint !== descriptor.contractFingerprint) throw new Error("delegation-observation-producer-mismatch");
      const outputSchemaHash = deriveSchemaHash(source.uses.output,"output"), implFingerprint = resolveTaskImplFingerprint(buildManifest,source.uses.id);
      candidates = repositories.runCheckpoints.listByAttempt(checkpoint.workflowId, checkpoint.itemId, origin.nodeId, origin.attempt)
        .filter(candidate => candidate.runId === origin.runId && candidate.contractFingerprint === descriptor.contractFingerprint
          && candidate.output.schemaHash === outputSchemaHash && candidate.implFingerprint === implFingerprint)
        .map(checkpoint => ({ checkpoint, origins: new Set((checkpoint.observationOrigins ?? []).map(value => canonicalJsonStringify([value.path,value.origin]))) }));
      checkpointsByProducer.set(key, candidates);
    }
    const sourcePath = [...origin.field.split("."),...origin.path], sourceIdentity = canonicalJsonStringify([sourcePath,origin]);
    if (!candidates.some(candidate => candidate.origins.has(sourceIdentity)
      && canonicalJsonStringify(readObservationPath(candidate.checkpoint.output.value, sourcePath))
        === canonicalJsonStringify(readObservationPath(checkpoint.output.value, entry.path)))) throw new Error("delegation-observation-checkpoint-mismatch");
  }
}

function reusableDelegationRead(repositories: AuthorityRepositories, dependencies: RunRecordServiceDependencies,
  manifest: z.infer<typeof DelegationManifestSchema>, planned: DelegationPlan<AnyWorkflowRef>["children"][number],
  target: AnyWorkflowDescriptor, buildManifest: BuildManifest) {
  if (planned.sourceRecordIds === undefined) return undefined;
  const group = repositories.dependencies.authenticateGroup(manifest);
  const sourceIndex = group.invocation.children.findIndex(source => source.canonicalInputFingerprint === planned.canonicalInputFingerprint
    && canonicalJsonStringify(source.sourceRecordIds ?? null) === canonicalJsonStringify(planned.sourceRecordIds));
  const member = group.children[sourceIndex];
  if (member === undefined) return undefined;
  const child = member.child;
  if (child.completion?.kind !== "done" || child.lifecycle.state !== "terminal" || child.lifecycle.outcome !== "done"
    || child.envelope.workflow !== target.id || child.envelope.descriptorVersion !== target.version || child.envelope.contractFingerprint !== target.contractFingerprint
    || child.envelope.configSnapshotId !== group.invocation.configSnapshotId || child.envelope.configFingerprint !== group.invocation.configFingerprint
    || child.input.ingressSchemaHash !== deriveSchemaHash(target.input,"input") || child.input.parsed.schemaHash !== deriveSchemaHash(target.canonicalInput,"output")) return undefined;
  const result = repositories.runResults.get(child.envelope.runId);
  if (result === undefined) throw new Error("delegation-reuse-result-unavailable");
  if (readRunPreviewResult(result) !== undefined || result.resultSchemaHash !== workflowTerminalResultExecution(target).schemaHash) return undefined;
  const fresh = (run: RunRecord, descriptor: AnyWorkflowDescriptor, path = new Set<string>()): boolean => {
    if (path.has(run.envelope.runId)) throw new Error("delegation-reuse-cycle");
    const nextPath = new Set(path).add(run.envelope.runId);
    const support = workflowDryRunSupport(descriptor);
    if (support.state !== "unsupported" || support.reason !== "no-transaction-node") return false;
    for (const node of descriptorRuntimeNodes(descriptor)) {
      if (node.kind !== "task") continue;
      const checkpoint = readRunCheckpoint(repositories,run.envelope,String(node.id),true);
      if (checkpoint === undefined) continue;
      const loaded = loadCheckpoint(checkpoint,CheckpointExpectationSchema.parse({ descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
        implFingerprint: resolveTaskImplFingerprint(buildManifest,node.uses.id), outputSchemaHash: deriveSchemaHash(node.uses.output,"output") }),node.uses.output);
      if (!loaded.found) return false;
      authenticateObservationOrigins(repositories,descriptor,checkpoint,buildManifest);
      if (checkpoint.provenance.some(fact => {
        const age = dependencies.clock.nowMs() - Date.parse(fact.source === "derived" ? fact.originalObservedAt : fact.observedAt);
        return age < 0 || age > resolveFreshnessBound(node.uses.freshness,fact.path).maxAgeMs;
      })) return false;
    }
    for (const { group } of repositories.dependencies.groups(run.envelope.runId)) for (const member of group.children) {
      if (member.terminal?.state !== "satisfied" || member.terminal.kind !== "ordinary") return false;
      const descriptor = dependencies.resolveDescriptor?.(member.child.envelope.workflow);
      if (descriptor === undefined) throw new Error("delegation-reuse-definition-unavailable");
      if (!fresh(member.terminal.run,descriptor,nextPath)) return false;
    }
    return true;
  };
  if (!fresh(child,target)) return undefined;
  return DelegationReadReuseSchema.parse({ manifestId: manifest.manifestId, dependencyId: member.dependency.dependencyId,
    runId: child.envelope.runId, appliedVersion: child.completion.expectedVersion + 1 });
}

function reconfirmedScopeIdentity(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor, entry: ReturnType<typeof readDelegationScopeEvidence>[number], buildManifest: BuildManifest) {
  if ("gate" in entry || "delegation" in entry) return entry;
  authenticateObservationOrigins(repositories, descriptor, entry.checkpoint, buildManifest);
  const { claimGeneration: _claim, writtenAt: _written, provenance, operationSources, observationOrigins, ...checkpoint } = entry.checkpoint;
  return { nodeId: entry.nodeId, checkpoint: { ...checkpoint,
    provenance: provenance.map(fact => {
      if (fact.source === "operator") return fact;
      const { observedAt: _observed, originalObservedAt: _original, ...identity } = fact;
      return identity;
    }),
    ...(observationOrigins === undefined ? {} : { observationOrigins: observationOrigins.map(({ path, origin }) => {
      const { spanPath: _spanPath, ...producer } = origin;
      return { path, origin: producer };
    }) }),
    ...(operationSources === undefined ? {} : { operationSources: operationSources.map(({ path, identity }) => {
      const { claimGeneration: _generation, taskAttempt: _attempt, logicalSessionId: _logicalSession,
        physicalSessionId: _physicalSession, ...producer } = identity;
      return { path, identity: producer };
    }) }),
  } };
}
