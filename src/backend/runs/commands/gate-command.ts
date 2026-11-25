import { runWorkbookReferenceTypeIds } from "../../../models/dashboard/workbooks.js";
import { timelineCheckpointReference } from "../../../models/events/timeline.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { OcrApprovedSnapshotSchema, ocrSnapshotDigest } from "../../../models/ocr/review.js";
import type { RunRecord } from "../../../models/run/record.js";
import { findGateDecision } from "../../../models/trust/gate-decisions.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { checkpointLookupKey, resolveFreshnessBound, type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { deriveGateResultCheckpointFingerprint as deriveGateFingerprint } from "../../../models/workflow/gates.js";
import { evaluateNodeCondition } from "../../../models/workflow/node-condition.js";
import type { CommandRequest } from "../../../rules/commands/commands.js";
import { deriveStableUuid } from "../../../rules/identity/identifiers.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { canonicalJsonStringify, type JsonValue, JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { taskImplFingerprint } from "../../../workflow-kit/fingerprints.js";
import { type AnyWorkflowDescriptor, descriptorRuntimeNodes } from "../../../workflow-kit/workflow.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import { readRunCheckpoint } from "../../storage/sqlite/run-continuation.js";
import { assertOcrReviewChildrenCurrent, assertOcrSelectionCurrent, readOcrReviewAuthority } from "../lifecycle/ocr-review-authority.js";
import { runTarget, type TargetReference } from "../lifecycle/run-fan-out.js";
import { lifecycleCommandId } from "../lifecycle/run-record-service.js";
import { applied, type CommandApplication } from "./command-application.js";
import type { CommandKernelDependencies } from "./command-kernel.js";
import { conflict, reject } from "./command-refusal.js";
import { lifecycleRun, requireDescriptorMatchesEnvelope, requireRun, resolveDescriptorOrReject } from "./run-command-context.js";
import { createHash } from "node:crypto";

export function deriveGateResultCheckpointFingerprint(result: unknown): string {
  return deriveGateFingerprint(result);
}

export function executeResolveGate(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<CommandRequest, { family: "gate" }>,
  now: string,
  source: "operator" | "workbook-reference",
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before resolving the gate`,
    );
  }
  if (current.lifecycle.state !== "parked-gate") {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; only a parked-gate run has a gate to resolve`,
    );
  }
  if (current.lifecycle.gateId !== request.target.gateId) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is parked on gate ${current.lifecycle.gateId}, not ${request.target.gateId}`,
    );
  }
  const descriptor = resolveDescriptorOrReject(dependencies, request, current.envelope.workflow);
  requireDescriptorMatchesEnvelope(request, descriptor, current);
  const node = descriptorRuntimeNodes(descriptor)
    .find((candidate) => candidate.kind === "gate" && String(candidate.id) === String(request.target.gateId));
  if (node === undefined || node.kind !== "gate") {
    throw new Error(
      `run ${request.target.runId} is parked on gate ${request.target.gateId}, which ${descriptor.id} does not declare; `
      + "the stored park is inconsistent with the descriptor",
    );
  }
  const declaration = findGateDecision(descriptor.id, request.target.gateId);
  if ((declaration !== undefined && declaration.resolution.source !== source)
    || (declaration === undefined && source !== "operator")) {
    reject(request, "policy-refused", "This gate must be resolved through its declared evidence source.");
  }
  if (node.resolvedBy !== "operator") {
    reject(
      request,
      "invalid-state",
      `gate ${request.target.gateId} is resolved by ${node.resolvedBy}; only its registered source may settle it`,
    );
  }
  const expectedSchemaHash = deriveSchemaHash(node.result, "output");
  if (request.payload.result.schemaHash !== expectedSchemaHash) {
    reject(
      request,
      "schema-mismatch",
      `gate ${request.target.gateId} result is bound to schema ${request.payload.result.schemaHash.slice(0, 12)}…, `
      + `but the descriptor's exact gate schema is ${expectedSchemaHash.slice(0, 12)}…`,
    );
  }
  const parsedValue = node.result.safeParse(request.payload.result.value);
  if (!parsedValue.success) {
    reject(
      request,
      "schema-mismatch",
      `gate ${request.target.gateId} result does not parse through the descriptor's exact gate schema: `
      + `${parsedValue.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  const evidenceScope = gateEvidenceScope(repositories, request, descriptor, current, node);
  if (node.when !== undefined && !evaluateNodeCondition(node.when, evidenceScope)) {
    reject(
      request,
      "invalid-state",
      `gate ${request.target.gateId} on run ${request.target.runId} is now skipped by its declared condition; `
      + "no gate result was recorded",
    );
  }
  verifyGateEvidenceCurrent(request, descriptor, node, evidenceScope, now, current);
  if (current.envelope.workflow === "ocr" && String(node.id) === "approve-records") {
    const approval = request.payload.ocrApproval;
    if (approval === undefined || request.requestedBy !== "local-operator" || request.source !== "dashboard") reject(request, "policy-refused", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    const review = readOcrReviewAuthority(repositories, dependencies.lifecycle, request.target.runId);
    if (review === undefined || review.revision.revision !== approval.expectedRevision || review.digest !== approval.reviewDigest) reject(request, "invalid-state", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    const lookupNodes = (["lookup-identities", "lookup-signers"] as const).filter(nodeId =>
      descriptorRuntimeNodes(descriptor).some(node => node.kind === "child-run" && node.id === nodeId));
    assertOcrReviewChildrenCurrent(repositories, request.target.runId, review.revision.seed, lookupNodes);
    const parsed = OcrApprovedSnapshotSchema.safeParse({ snapshotId: request.commandId, sourceRunId: request.target.runId,
      revision: review.revision.revision, reviewDigest: review.digest, selectedRecordIds: approval.selectedRecordIds,
      records: approval.selectedRecordIds.map(id => review.revision.records.find(record => record.recordId === id)),
      approvedBy: request.requestedBy, approvedAt: now });
    if (!parsed.success) reject(request, "invalid-state", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    const snapshot = parsed.data;
    assertOcrSelectionCurrent(review.revision.seed, snapshot.records);
    if (canonicalJsonStringify(parsedValue.data) !== canonicalJsonStringify({ snapshotId: snapshot.snapshotId,
      sourceRunId: snapshot.sourceRunId, revision: snapshot.revision, digest: ocrSnapshotDigest(snapshot) })) reject(request, "schema-mismatch", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    repositories.ocrReviews.approve(snapshot);
  } else if (request.payload.ocrApproval !== undefined) reject(request, "invalid-state", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
  const result = { schemaHash: expectedSchemaHash, value: parsedValue.data };
  const stored = repositories.gateResults.insert({
    nodeId: node.id,
    runId: request.target.runId,
    gateId: request.target.gateId,
    commandId: request.commandId,
    expectedVersion: request.target.expectedVersion,
    resolvedBy: request.requestedBy,
    resolvedAt: now,
    checkpointFingerprint: deriveGateResultCheckpointFingerprint(result),
    result,
  });
  if (stored.state !== "inserted") {
    throw new Error(
      `gate ${request.target.gateId} on run ${request.target.runId} already holds a stored result `
      + "while the run is still parked; the store is inconsistent",
    );
  }
  repositories.timelineEvents.append({ schemaVersion: 1,
    eventId: lifecycleCommandId("timeline-gate-resolved", request.commandId),
    workflow: current.envelope.workflow, scope: { kind: "run", runId: current.envelope.runId },
    occurredAt: now, recordedAt: now, retentionDate: localDatePart(new Date(now)), source: { kind: "native" },
    payload: { kind: "span", event: { t: "gate.resolved", ts: now, pid: process.pid,
      workflow: current.envelope.workflow, runId: current.envelope.runId, attempt: current.envelope.attempt,
      traceId: current.envelope.traceId, spanPath: current.envelope.traceId, gate: request.target.gateId,
      resolutionKey: "resolved", resultHash: createHash("sha256")
        .update(`hrauto:gate-resolved-span:v1\0${canonicalJsonStringify(request.payload.result)}`).digest("hex") } },
  });
  const resumed = dependencies.lifecycle.transition({
    commandId: lifecycleCommandId("operator-gate", request.commandId),
    lifecycle: { state: "queued" },
    runId: request.target.runId,
    expectedVersion: current.version,
  });
  lifecycleRun(request, resumed);
  const gateReference: TargetReference = {
    family: "gate",
    runId: request.target.runId,
    gateId: request.target.gateId,
  };
  return applied(request, [gateReference, runTarget(request.target.runId)], [{
    target: gateReference,
    before: current.version,
    after: current.version + 1,
  }]);
}

function gateEvidenceScope(
  repositories: AuthorityRepositories,
  request: Extract<CommandRequest, { family: "gate" }>,
  descriptor: AnyWorkflowDescriptor,
  run: ReturnType<typeof requireRun>,
  gate: Extract<ReturnType<typeof descriptorRuntimeNodes>[number], { kind: "gate" }>,
) {
  const input = JsonValueSchema.parse(descriptor.canonicalInput.parse(run.input.parsed.value));
  const nodes = descriptorRuntimeNodes(descriptor);
  const nodesById = new Map(nodes.map((node) => [String(node.id), node]));
  const outputs: Record<string, JsonValue> = {};
  const checkpoints = new Map<string, Readonly<{ node: Extract<typeof nodes[number], { kind: "task" }>; record: RunCheckpointRecord }>>();
  const visiting = new Set<string>();
  const buildOutput = (nodeId: string): JsonValue => {
    const ready = outputs[nodeId];
    if (ready !== undefined) return ready;
    const node = nodesById.get(nodeId);
    if (node === undefined) {
      reject(request, "invalid-state", `gate ${gate.id} depends on undeclared node ${nodeId}`);
    }
    if (visiting.has(nodeId)) throw new Error(`workflow graph contains a dependency cycle at ${nodeId}`);
    visiting.add(nodeId);
    const dependencyOutputs: Record<string, JsonValue> = {};
    if (node.kind === "task") {
      const checkpoint = readRunCheckpoint(repositories, run.envelope, String(node.id), true);
      if (checkpoint === undefined) {
        reject(request, "invalid-state", `gate ${gate.id} cannot be resolved because dependency checkpoint ${node.id} is absent`);
      }
      const expectedSchemaHash = deriveSchemaHash(node.uses.output, "output");
      if (checkpoint.workflowId !== descriptor.id || checkpoint.itemId !== run.envelope.itemId
        || checkpoint.nodeId !== nodeId || checkpoint.attempt > run.envelope.attempt
        || checkpoint.descriptorVersion !== descriptor.version
        || checkpoint.contractFingerprint !== descriptor.contractFingerprint
        || checkpoint.implFingerprint !== taskImplFingerprint(node.uses)
        || checkpoint.output.schemaHash !== expectedSchemaHash) {
        reject(request, "schema-mismatch", `gate ${gate.id} dependency checkpoint ${nodeId} is not compatible with this run's descriptor`);
      }
      const parsedOutput = node.uses.output.safeParse(checkpoint.output.value);
      if (!parsedOutput.success) {
        reject(request, "schema-mismatch", `gate ${gate.id} dependency checkpoint ${nodeId} no longer parses through its task schema`);
      }
      const isCurrentExecution = checkpoint.runId === run.envelope.runId
        && checkpoint.attempt === run.envelope.attempt
        && Number(checkpoint.claimGeneration) === Number(run.claimGeneration);
      const expectedEventId = isCurrentExecution
        ? deriveStableUuid("timeline-checkpoint-recorded", checkpointLookupKey(
          checkpoint.workflowId,
          checkpoint.itemId,
          checkpoint.nodeId,
          checkpoint.attempt,
          checkpoint.claimGeneration,
        ))
        : lifecycleCommandId("timeline-checkpoint-replayed", {
          runId: run.envelope.runId,
          nodeId,
          claimGeneration: run.claimGeneration,
        });
      const checkpointEvent = repositories.timelineEvents.get(expectedEventId);
      const expectedReference = timelineCheckpointReference(checkpoint);
      const eventMatches = checkpointEvent?.payload.kind === (isCurrentExecution ? "checkpoint-recorded" : "checkpoint-replayed")
        && checkpointEvent.payload.checkpoint !== undefined
        && canonicalJsonStringify(checkpointEvent.payload.checkpoint) === canonicalJsonStringify(expectedReference)
        && checkpointEvent.payload.workflow === descriptor.id
        && checkpointEvent.payload.runId === run.envelope.runId
        && checkpointEvent.payload.attempt === run.envelope.attempt
        && Number(checkpointEvent.payload.claimGeneration) === Number(run.claimGeneration);
      if (!eventMatches) {
        reject(request, "invalid-state", `gate ${gate.id} dependency checkpoint ${nodeId} is not linked to this run execution`);
      }
      checkpoints.set(nodeId, { node, record: checkpoint });
      outputs[nodeId] = JsonValueSchema.parse(parsedOutput.data);
    } else if (node.kind === "gate") {
      const result = repositories.gateResults.get(`${run.envelope.runId}:${String(node.id)}`);
      if (result === undefined) {
        reject(request, "invalid-state", `gate ${gate.id} cannot be resolved because dependency gate result ${node.id} is absent`);
      }
      const expectedSchemaHash = deriveSchemaHash(node.result, "output");
      if (result.runId !== run.envelope.runId || result.gateId !== nodeId
        || result.result.schemaHash !== expectedSchemaHash) {
        reject(request, "schema-mismatch", `gate ${gate.id} dependency gate result ${node.id} is not bound to this run and descriptor`);
      }
      outputs[nodeId] = JsonValueSchema.parse(node.result.parse(result.result.value));
    } else if (node.kind === "branch") {
      for (const dependency of node.dependsOn) buildOutput(String(dependency));
      for (const dependency of node.dependsOn) {
        const output = outputs[String(dependency)];
        if (output !== undefined) dependencyOutputs[String(dependency)] = output;
      }
      const scope = { input, outputs: dependencyOutputs };
      const selected = node.choose(scope);
      if (typeof selected !== "string" || !Object.prototype.hasOwnProperty.call(node.cases, selected)) {
        reject(request, "invalid-state", `gate ${gate.id} dependency branch ${nodeId} selected an undeclared case`);
      }
      outputs[nodeId] = JsonValueSchema.parse({ selected });
    } else {
      reject(request, "invalid-state", `gate ${gate.id} dependency ${node.kind} node ${nodeId} has no checkpoint-backed decision evidence`);
    }
    visiting.delete(nodeId);
    return outputs[nodeId]!;
  };
  for (const dependency of gate.dependsOn) buildOutput(String(dependency));
  return { input, outputs, checkpoints, references: runWorkbookReferenceTypeIds(run.input.workbookReferences) };
}

function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)
      || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function verifyGateEvidenceCurrent(
  request: Extract<CommandRequest, { family: "gate" }>,
  descriptor: AnyWorkflowDescriptor,
  gate: Extract<ReturnType<typeof descriptorRuntimeNodes>[number], { kind: "gate" }>,
  scope: ReturnType<typeof gateEvidenceScope>,
  now: string,
  run: RunRecord,
): void {
  const declaration = findGateDecision(descriptor.id, request.target.gateId);
  if (declaration?.boundEvidencePath !== undefined) {
    const submitted = valueAtPath(request.payload.result.value, declaration.boundEvidencePath);
    const policy = declaration.resolution;
    const boundInput = policy.source === "workbook-reference" && "boundInputPath" in policy
      && valueAtPath(scope.input, policy.inputCondition.path) === policy.inputCondition.equals
      ? valueAtPath(scope.input, policy.boundInputPath) : undefined;
    const checkpoint = policy.source === "workbook-reference" && "boundNodeId" in policy
      ? scope.checkpoints.get(policy.boundNodeId)?.record : undefined;
    const boundOutput = checkpoint !== undefined && policy.source === "workbook-reference" && "boundOutputPath" in policy
      ? valueAtPath(checkpoint.output.value, policy.boundOutputPath) : undefined;
    const bound = policy.source === "workbook-reference" && "boundNodeId" in policy ? boundOutput : boundInput;
    const currentEvidence = policy.source === "workbook-reference"
      ? (bound === undefined ? [] : [{ nodeId: gate.id, value: bound }])
      : gate.dependsOn.flatMap((nodeId) => {
      const checkpoint = scope.checkpoints.get(String(nodeId))?.record;
      const value = checkpoint === undefined ? undefined : valueAtPath(checkpoint.output.value, declaration.boundEvidencePath!);
      return value === undefined ? [] : [{ nodeId: String(nodeId), value }];
    });
    const retained = currentEvidence[0]?.value;
    const capturedDigests = new Set((run.input.workbookReferences ?? []).map(bound => sha256Hex(canonicalJsonStringify(bound))));
    const sameRetainedSource = retained === submitted
      || (typeof submitted === "string" && typeof retained === "string" && capturedDigests.has(submitted) && capturedDigests.has(retained));
    if (currentEvidence.length !== 1 || !sameRetainedSource) {
      reject(
        request,
        "invalid-state",
        `gate ${request.target.gateId} evidence changed or is unavailable; refresh the packet before deciding`,
      );
    }
  }

  const instant = Date.parse(now);
  for (const nodeId of gate.dependsOn) {
    const checkpoint = scope.checkpoints.get(String(nodeId));
    if (checkpoint === undefined) continue;
    const { node, record } = checkpoint;
    // The run re-reads always-rerun dependencies after the decision.
    if (node.replay === "always-rerun") continue;
    for (const fact of record.provenance) {
      const bound = resolveFreshnessBound(node.uses.freshness, fact.path).maxAgeMs;
      if (!Number.isFinite(bound)) continue;
      const observedAt = fact.source === "derived" ? fact.originalObservedAt : fact.observedAt;
      if (instant - Date.parse(observedAt) > bound) {
        reject(
          request,
          "invalid-state",
          `gate ${request.target.gateId} evidence from checkpoint ${nodeId} expired at `
          + `${observedAt} under its declared ${String(bound)}ms freshness limit`,
        );
      }
    }
  }
}
