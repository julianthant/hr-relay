import { acceptsRecheckTransactionId } from "../../../../rules/write-safety/parked-resolution.js";
import { LogIdentityRefusedError } from "../../commands/refusals.js";
import { ParkedWriteCheckTargetSchema } from "../../../../rules/commands/commands.js";
import { requireParkedWriteCheckTarget } from "../../../runtime/writes/write-recovery.js";
import { WorkerControlRefusal } from "../../../../models/run/worker-control.js";
import { readTimelineRecords } from "../../../storage/events/timeline-reader.js";
import { protectIdentityEvidencePacket } from "../../../../rules/separations/identity-evidence.js";
import {
  retainedRunProtectedBindings,
  hasProtectedTransactionInput,
  publicTransactionKeyDigest,
} from "../../../../models/write-safety/protected-input.js";
import { deriveIdentityEvidenceDigest } from "../../../../rules/separations/identity-evidence.js";
import { MatchIdentityOutputSchema } from "../../../../models/workflows/separations/match-identity.js";
import type { IdentityEvidencePacket } from "../../../../rules/separations/identity-evidence.js";
import {
  IdentityGateDetailWireSchema,
  ParkedWriteDetailWireSchema,
  RunDetailSectionResponseSchema,
  type RunDetailSectionResponse,
} from "../../../../models/dashboard/run-detail.js";
import type { WriteBindingProof, WriteIntentRecord } from "../../../../rules/write-safety/write-safety.js";
import type { GateResultRecord } from "../../../../models/workflow/gates.js";
import { evidenceLeaves } from "../../../../models/trust/evidence-classification.js";
import { findGateDecision } from "../../../../models/trust/gate-decisions.js";
import type { RunRecord } from "../../../../models/run/record.js";
import type { RunFoldRecord } from "../../projections/run-queue-projection.js";
import { deterministicUuid } from "../../lifecycle/support.js";
import { idempotencyKeyDigestReference } from "../../../../rules/redaction/redaction.js";
import { SectionUnavailableError } from "../../commands/refusals.js";
import type { RunDetailQueryDeps } from "../run-detail-types.js";
import { requireTrustRun } from "../../trust/run-reader.js";
import { availableSections } from "./availability.js";
import { descriptorRuntimeNodes, runtimeNodeLabel } from "../../../../workflow-kit/workflow.js";
import { BUILD_MANIFEST, resolveTaskImplFingerprint } from "../../../../workflow-kit/validation/build-manifest.js";
import { checkpointLookupKey } from "../../../../models/workflow/checkpoint.js";
import { deriveSchemaHash } from "../../../../models/validation/schema-bound-value.js";
import { deriveStableUuid, lifecycleCommandId } from "../../../../rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { readRunCheckpoint } from "../../../runtime/checkpoints/run-checkpoint-reader.js";
import { timelineCheckpointReference } from "../../../../models/events/timeline.js";


function settledGateWire(
  runId: string,
  workflowId: string,
  stored: GateResultRecord | undefined,
  folded: RunFoldRecord["resolvedGates"][number] | undefined,
): unknown {
  if (stored === undefined) {
    return folded === undefined
      ? { state: "absent", reason: "this run declares no operator gate" }
      : {
        state: "absent",
        reason: `this run's span stream recorded gate ${folded.gate} resolved at ${folded.resolvedAt}, `
          + "and authority holds no gate result row for it — the decision cannot be attributed to anyone",
    };
  }
  if ("source" in stored) {
    return {
      state: "absent",
      reason: `gate ${stored.gateId} was settled by ${stored.source.kind} source `
        + `${stored.source.sourceId} event ${stored.source.eventId} at ${stored.resolvedAt}; `
        + "this is a source result, not a human decision, so the operator verdict is absent",
    };
  }
  const gateId = String(stored.gateId);
  const declaration = findGateDecision(workflowId, gateId);
  if (declaration === undefined) {
    return {
      state: "absent",
      reason: `gate ${gateId} of ${workflowId} has no declared decision in `
        + "src/domain/trust/gate-decisions.ts, so this build cannot say what its stored answer means",
    };
  }
  const leaves = evidenceLeaves(stored.result.value);
  const decided = leaves.find((leaf) => leaf.path === declaration.decisionPath);
  if (decided === undefined) {
    return {
      state: "absent",
      reason: `gate ${gateId} stored no leaf at its declared decision path "${declaration.decisionPath}" `
        + `(it stored: ${leaves.map((leaf) => leaf.path).join(", ")})`,
    };
  }
  const arm = declaration.arms.find((candidate) => candidate.value === decided.value);
  if (arm === undefined) {
    return {
      state: "absent",
      reason: `gate ${gateId} stored ${JSON.stringify(decided.value)} at "${declaration.decisionPath}" and no `
        + `declared arm matches it (declared: ${declaration.arms.map((candidate) => candidate.value).join(", ")})`,
    };
  }
  if (arm.outcome !== "approved" && arm.outcome !== "rejected") {
    return {
      state: "absent",
      reason: `gate ${gateId} resolved as ${arm.outcome}, which is not an approve/reject verdict`,
    };
  }
  return {
    state: "resolved",
    gateId: deterministicUuid(`gate:${runId}:${gateId}`),
    nodeId: stored.nodeId,
    label: gateId,
    resolution: arm.outcome,
    resolvedBy: stored.resolvedBy,
    resolvedAt: stored.resolvedAt,
    revision: 2,
  };
}

export function buildRunGate(
  deps: RunDetailQueryDeps,
  runId: string,
  row: RunFoldRecord | undefined,
  authority: RunRecord,
): unknown {
  const run = requireTrustRun(deps.runReader, runId);
  if (run.version !== authority.version) throw new Error(`TRUST_RUN_CHANGED: ${runId}`);
  const stored = deps.authority.listGateResults(runId);
  for (const result of stored) {
    if (result.runId !== runId) throw new Error(`TRUST_EVIDENCE_IDENTITY_MISMATCH: gate for ${runId}`);
  }
  if (run.lifecycle.state === "parked-gate") {
    const descriptor = deps.canonical?.descriptors.resolve(run.envelope.workflow);
    const gateId = String(run.lifecycle.gateId);
    const gate = descriptor !== undefined && descriptor.version === run.envelope.descriptorVersion && descriptor.contractFingerprint === run.envelope.contractFingerprint
      ? descriptorRuntimeNodes(descriptor).find((node) => node.kind === "gate" && String(node.id) === gateId)
      : undefined;
    return {
      state: "open",
      gateId: deterministicUuid(`gate:${runId}:${run.lifecycle.gateId}`),
      nodeId: run.lifecycle.gateId,
      label: gate === undefined ? run.lifecycle.gateId : runtimeNodeLabel(gate),
      openedAt: run.lifecycle.parkedAt,
      revision: 1,
    };
  }
  return settledGateWire(runId, run.envelope.workflow, stored.at(-1), row?.resolvedGates.at(-1));
}

/* ── the parked-write section (ref write-safety ) ──────────────────────────────── */

// Serve current data only through exact registered origin declarations; uncertain evidence stays distinct.
function parkedWriteSubject(proof: WriteBindingProof): unknown {
  return proof.kind === "unscoped"
    ? {
      state: "unscoped",
      proofId: proof.proofId,
      observedAt: proof.observedAt,
      reviewedReasonId: proof.reviewedReasonId,
    }
    : {
      state: "subject-match",
      proofId: proof.proofId,
      observedAt: proof.observedAt,
      evidence: proof.expected,
    };
}


function parkedWriteProofContract(
  deps: RunDetailQueryDeps,
  authority: RunRecord,
  intent: Extract<WriteIntentRecord, { status: "parked" }>,
): unknown {
  const unavailable = (reason: string): unknown => ({ state: "unavailable", reason });
  const workflow = authority.envelope.workflow;
  const descriptor = deps.descriptors.resolve(workflow);
  if (descriptor === undefined) {
    return unavailable(
      `workflow ${workflow} has no registered descriptor in this build, so the proof this write would `
      + "have to carry cannot be stated. Recording it PRESENT is unavailable until the build that "
      + "declares this workflow is running (ref write-safety §4.1).",
    );
  }
  const contract = (descriptor.writeContracts ?? [])
    .find((candidate) => candidate.commitTaskId === intent.taskId);
  if (contract === undefined) {
    return unavailable(
      `${workflow} declares no transaction node committing ${intent.taskId} in this build, so there is no `
      + "commit contract to take a proof for. Recording it PRESENT is unavailable until that node is back "
      + "— ref write-safety §4.1's `transaction-node` check would refuse the resolution for the same reason.",
    );
  }
  if (contract.proof.state === "undescribable") {
    return unavailable(
      `${contract.commitTaskId}'s completion proof cannot be rendered as a form by this build: `
      + `${contract.proof.reason}. Nothing here will guess at a shape the kernel would then refuse — `
      + "record the absence instead, or extend the proof describer.",
    );
  }
  return {
    state: "served",
    commitTaskId: contract.commitTaskId,
    completionKind: contract.completionKind,
    schemaHash: contract.proofSchemaHash,
    fields: contract.proof.fields,
  };
}


function parkedWriteActions(
  authority: RunRecord,
  intent: Extract<WriteIntentRecord, { status: "parked" }>,
): unknown[] {
  const writeTarget = { writeIntentId: intent.writeIntentId, intentGeneration: intent.generation,
    writeAttemptId: intent.currentAttemptId, bindingProofDigest: intent.bindingProofDigest, occurrenceKeyDigest: intent.idempotencyKeyDigest };
  return [
    {
      key: "recheck-write",
      label: "Check again",
      detail: "Read the target system again. A verified transaction continues the run; uncertainty keeps the write parked.",
      intent: "warning",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "recheck-write",
      expectedVersion: authority.version,
      confirm: {
        title: "Check the target system again",
        body: `Relay reads ${intent.system} again and submits nothing. If it finds this write, the run continues to its next step.`,
        confirmLabel: "Check again",
        tone: "neutral",
      },
      writeTarget,
    },
    {
      key: "resolve-write-absent",
      label: "I confirmed it is NOT there",
      detail: "Release the fence so the run may attempt the write again under a new generation.",
      intent: "primary",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-write-absent",
      expectedVersion: authority.version,
      confirm: {
        title: "Confirm the transaction is absent",
        body: `This authorizes a fresh attempt against ${intent.system}. If the transaction does exist, `
          + "the retry submits it a SECOND time.",
        confirmLabel: "It is not there",
        tone: "destructive",
      },
      writeTarget,
    },
  ];
}


function buildIdentityGatePayload(
  deps: RunDetailQueryDeps,
  authority: RunRecord,
): unknown {
  const { lifecycle } = authority;
  const runId = authority.envelope.runId;
  if (lifecycle.state !== "parked-gate") {
    throw new Error(`run ${runId} advertises an identity-gate section while it is ${lifecycle.state}`);
  }
  const missing = (reason: string): unknown => ({ state: "missing", reason });
  const descriptor = deps.descriptors.resolve(authority.envelope.workflow);
  if (descriptor === undefined) {
    return missing(`workflow ${authority.envelope.workflow} has no registered descriptor in this build`);
  }
  const gate = (descriptor.gateNodes ?? [])
    .find(({ nodeId }) => nodeId === String(lifecycle.gateId));
  if (gate === undefined) {
    return missing(
      `${authority.envelope.workflow} declares no gate "${String(lifecycle.gateId)}"; this build cannot `
      + "describe the decision this run is parked on",
    );
  }
  if (deps.canonical === undefined) {
    return missing(`gate "${gate.nodeId}" cannot verify checkpoint identity without canonical authority`);
  }
  const runtimeDescriptor = deps.canonical.descriptors.resolve(authority.envelope.workflow);
  if (runtimeDescriptor === undefined) {
    return missing(`workflow ${authority.envelope.workflow} has no canonical descriptor for checkpoint verification`);
  }
  if (runtimeDescriptor.version !== authority.envelope.descriptorVersion
    || runtimeDescriptor.contractFingerprint !== authority.envelope.contractFingerprint) {
    return missing(
      `workflow ${authority.envelope.workflow} descriptor ${String(runtimeDescriptor.version)}/`
      + `${runtimeDescriptor.contractFingerprint} does not match the run's bound descriptor `
      + `${String(authority.envelope.descriptorVersion)}/${authority.envelope.contractFingerprint}`,
    );
  }
  const runtimeGate = descriptorRuntimeNodes(runtimeDescriptor)
    .find((candidate) => candidate.kind === "gate" && String(candidate.id) === gate.nodeId);
  if (runtimeGate === undefined || runtimeGate.kind !== "gate"
    || deriveSchemaHash(runtimeGate.result, "output") !== gate.resultSchemaHash
    || canonicalJsonStringify(runtimeGate.dependsOn.map(String)) !== canonicalJsonStringify(gate.dependsOn)) {
    return missing(`gate "${gate.nodeId}" does not match the registered descriptor used by this run`);
  }
  const expectedOutputHash = deriveSchemaHash(MatchIdentityOutputSchema, "output");
  const evidence = gate.dependsOn
    .map((nodeId) => readRunCheckpoint(deps.canonical!.database.authority, authority.envelope, nodeId, true))
    .flatMap((stored) => {
      if (stored === undefined) return [];
      if (stored.workflowId !== authority.envelope.workflow || stored.itemId !== authority.envelope.itemId
        || stored.attempt > authority.envelope.attempt || stored.descriptorVersion !== authority.envelope.descriptorVersion
        || stored.contractFingerprint !== authority.envelope.contractFingerprint
        || stored.output.schemaHash !== expectedOutputHash) return [];
      // `stored.output` is the schema-BOUND envelope; the packet is its value.
      const parsed = MatchIdentityOutputSchema.safeParse(stored.output.value);
      if (!parsed.success || deriveIdentityEvidenceDigest(parsed.data.packet) !== parsed.data.evidenceDigest) return [];
      const runtimeNode = descriptorRuntimeNodes(runtimeDescriptor)
        .find((candidate) => candidate.kind === "task" && String(candidate.id) === String(stored.nodeId));
      if (runtimeNode === undefined || runtimeNode.kind !== "task"
        || deriveSchemaHash(runtimeNode.uses.output, "output") !== expectedOutputHash
        || stored.implFingerprint !== resolveTaskImplFingerprint(BUILD_MANIFEST, runtimeNode.uses.id)) return [];
      const currentExecution = stored.runId === runId && stored.attempt === authority.envelope.attempt
        && Number(stored.claimGeneration) === Number(authority.claimGeneration);
      const eventId = currentExecution
        ? deriveStableUuid("timeline-checkpoint-recorded", checkpointLookupKey(
          stored.workflowId,
          stored.itemId,
          stored.nodeId,
          stored.attempt,
          stored.claimGeneration,
        ))
        : lifecycleCommandId("timeline-checkpoint-replayed", {
          runId,
          nodeId: stored.nodeId,
          claimGeneration: authority.claimGeneration,
        });
      const checkpointEvent = deps.canonical!.database.authority.timelineEvents.get(eventId);
      const expectedReference = timelineCheckpointReference(stored);
      const expectedKind = currentExecution ? "checkpoint-recorded" : "checkpoint-replayed";
      if (checkpointEvent?.payload.kind !== expectedKind
        || canonicalJsonStringify(checkpointEvent.payload.checkpoint) !== canonicalJsonStringify(expectedReference)
        || checkpointEvent.payload.workflow !== authority.envelope.workflow
        || checkpointEvent.payload.runId !== runId
        || checkpointEvent.payload.attempt !== authority.envelope.attempt
        || Number(checkpointEvent.payload.claimGeneration) !== Number(authority.claimGeneration)) return [];
      return [parsed.data];
    });
  if (evidence.length !== 1) {
    return missing(
      `gate "${gate.nodeId}" waits on ${String(gate.dependsOn.length)} node(s), and `
      + `${String(evidence.length)} of them hold an identity decision packet; exactly one must, or the `
      + "packet this gate is about is not identifiable",
    );
  }
  const found = evidence[0];
  if (found === undefined) throw new Error(`gate "${gate.nodeId}" evidence disappeared mid-projection`);
  const packet = protectIdentityEvidencePacket(found.packet, retainedRunProtectedBindings(authority));
  const evidenceDigest = deriveIdentityEvidenceDigest(packet);
  if (packet.emplIdSource !== "name-resolved" && packet.emplIdSource !== "operator-entered") {
    return missing(
      `gate "${gate.nodeId}" is parked on ${packet.emplIdSource} evidence, but this build requires an `
      + "operator decision only for a name-resolved or operator-entered EID; this historical run cannot be resolved under the current contract",
    );
  }
  const nameSearchEid = packet.nameSearch.status === "resolved" ? packet.nameSearch.candidate.eid : undefined;
  const options = packet.approvableEids.map((eid) => ({
    eid,
    chosenFrom: eid === packet.emplId ? "checked" : eid === nameSearchEid ? "name-search" : "manual",
    displayName: eid === packet.emplId
      ? packet.ucpathName
      : eid === nameSearchEid && packet.nameSearch.status === "resolved"
        ? packet.nameSearch.candidate.name
        : "EID candidate",
    origin: eid === packet.emplId
      ? `the EID this run checked (${packet.emplIdSource})`
      : eid === nameSearchEid
        ? `a UCPath search on the document's name "${packet.documentName}" resolved this person`
        : `a UCPath search on the document's name "${packet.documentName}" listed this EID among its candidates`,
  }));
  const nativeEvents = readTimelineRecords(deps.timeline, 0, runId).records.filter(record =>
    record.payload.kind === "span" && record.payload.event.t === "gate.opened"
    && record.payload.event.gate === gate.nodeId && record.payload.event.attempt === authority.envelope.attempt);
  if (nativeEvents.length > 1) throw new LogIdentityRefusedError("RUN_LOG_GATE_NATIVE_IDENTITY_DUPLICATE");
  const nativeEvent = nativeEvents[0];
  const native = nativeEvent?.payload.kind === "span" && nativeEvent.payload.event.t === "gate.opened"
    ? nativeEvent.payload.event : undefined;
  if (native !== undefined && native.traceId !== authority.envelope.traceId) throw new LogIdentityRefusedError("RUN_LOG_GATE_NATIVE_IDENTITY_MISMATCH");
  return {
    state: "available",
    value: IdentityGateDetailWireSchema.parse({
      ...(native === undefined || nativeEvent === undefined ? {} : { native: {
        eventId: nativeEvent.eventId, order: nativeEvent.cursor, runId,
        attempt: native.attempt, traceId: native.traceId, spanPath: native.spanPath, nodeId: gate.nodeId,
      } }),
      runId,
      gateId: gate.nodeId,
      label: gate.label,
      parkedAt: lifecycle.parkedAt,
      resumeAt: lifecycle.resumeAt,
      expectedVersion: authority.version,
      resultSchemaHash: gate.resultSchemaHash,
      evidenceDigest,
      packet,
      options,
      approvalShape: options.length > 1 ? "choose-a-candidate" : "one-click",
      actions: identityGateActions(authority, packet),
    }),
  };
}


function identityGateActions(authority: RunRecord, packet: IdentityEvidencePacket): unknown[] {
  const disagreements = packet.comparisons.filter(({ agrees }) => !agrees);
  return [
    {
      key: "resolve-gate-approved",
      label: packet.approvableEids.length === 1 ? "Approve this person" : "Approve the chosen EID",
      detail: packet.approvableEids.length > 1
        ? "Choose which candidate the separation document means."
        : "Confirm the one candidate the separation document means.",
      intent: "primary",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-gate",
      expectedVersion: authority.version,
      resolution: "approved",
      confirm: {
        title: "Approve this identity",
        body: disagreements.length === 0
          ? `Every compared field agreed for ${packet.documentName} on separation document `
            + `${packet.documentNumber}. Approving binds the rest of this separation to this person.`
          : `${String(disagreements.length)} field(s) DISAGREE: ${
            disagreements.map(({ field }) => field).join(", ")
          }. Approving files the rest of this separation against this person anyway.`,
        confirmLabel: "Approve",
        tone: disagreements.length === 0 ? "neutral" : "destructive",
      },
    },
  ];
}

function buildParkedWritePayload(deps: RunDetailQueryDeps, authority: RunRecord): unknown {
  const { lifecycle } = authority;
  const runId = authority.envelope.runId;
  if (lifecycle.state !== "parked-write") {
    throw new Error(`run ${runId} advertises a parked-write section while it is ${lifecycle.state}`);
  }
  const intent = deps.authority.getWriteIntent(lifecycle.writeIntentId);
  if (intent === undefined) {

    throw new Error(
      `run ${runId} is parked on write intent ${lifecycle.writeIntentId}, which authority does not hold`,
    );
  }
  if (intent.status !== "parked") {
    throw new Error(
      `run ${runId} is parked on write intent ${lifecycle.writeIntentId}, which is ${intent.status}; `
      + "the run park and the intent disagree about what happened to this write",
    );
  }
  if (intent.runId !== runId) {
    throw new Error(
      `run ${runId} is parked on write intent ${lifecycle.writeIntentId}, but that intent belongs to `
      + `run ${intent.runId}`,
    );
  }
  if (intent.workflowId !== authority.envelope.workflow || intent.itemId !== authority.envelope.itemId
    || intent.runAttempt !== authority.envelope.attempt
    || intent.bindingProof.runId !== runId || intent.bindingProof.attempt !== intent.runAttempt) {
    throw new Error(`TRUST_EVIDENCE_IDENTITY_MISMATCH: parked write for ${runId}`);
  }
  if (intent.generation !== lifecycle.intentGeneration) {
    throw new Error(
      `run ${runId} is parked on generation ${String(lifecycle.intentGeneration)} of write intent `
      + `${lifecycle.writeIntentId}, which is at generation ${String(intent.generation)}`,
    );
  }
  const nativeEvents = readTimelineRecords(deps.timeline, 0, runId).records.filter(record =>
    record.payload.kind === "write-parked" && record.payload.writeIntentId === intent.writeIntentId
    && record.payload.generation === intent.generation);
  if (nativeEvents.length > 1) throw new LogIdentityRefusedError("RUN_LOG_WRITE_NATIVE_IDENTITY_DUPLICATE");
  const nativeEvent = nativeEvents[0];
  const native = nativeEvent?.payload.kind === "write-parked" ? nativeEvent.payload : undefined;
  if (native !== undefined && (native.runId !== runId || native.attempt !== intent.runAttempt
    || native.traceId !== authority.envelope.traceId || native.workflow !== authority.envelope.workflow
    || intent.bindingProof.afterPrepareSpanPath !== `${native.traceId}/${native.nodeId}/prepare`)) throw new LogIdentityRefusedError("RUN_LOG_WRITE_NATIVE_IDENTITY_MISMATCH");
  const descriptor = deps.canonical?.descriptors.resolve(authority.envelope.workflow);
  const acceptsTransactionId = descriptor !== undefined
    && descriptor.version === authority.envelope.descriptorVersion
    && descriptor.contractFingerprint === authority.envelope.contractFingerprint
    && descriptorRuntimeNodes(descriptor).some(node => node.kind === "transaction"
      && node.commit.uses.id === intent.taskId && acceptsRecheckTransactionId(node.commit.uses.writeSafety.completion));
  const repositories = deps.canonical?.database.authority;
  let check: unknown = { state: "unavailable", code: "PARKED_CHECK_UNAVAILABLE" };
  if (repositories !== undefined && deps.authorityIdentity !== undefined && native !== undefined && authority.envelope.workflow === "separations"
    && intent.bindingProof.kind === "subject-match" && ["ucpath/create-termination", "ucpath/delete-pending-terminations", "kuali/save-separation-finalization"].includes(intent.taskId)) {
    const worker = repositories.workerSlots.list(authority.envelope.workflow).filter(slot => slot.retiredAt === null)
      .map(slot => ({ slot, lease: repositories.workerLeases.get(slot.workerId) }))
      .find(({ slot, lease }) => lease?.lifecycle.state === "idle" && lease.workflow === slot.workflow && lease.controlRevision !== undefined
        && deps.ownsWorker?.(lease) === true
        && repositories.workerControls.pending(`worker-pool:${slot.workflow}`).length === 0
        && !repositories.runs.listByWorker(slot.workerId).some(run => ["claimed", "validating", "running"].includes(run.lifecycle.state)));
    if (worker?.lease?.lifecycle.state === "idle" && worker.lease.controlRevision !== undefined) {
      const { slot, lease } = worker;
      const target = ParkedWriteCheckTargetSchema.parse({ ...deps.authorityIdentity, workerId: slot.workerId, expectedVersion: lease.version,
        membershipRevision: slot.membershipRevision, processId: lease.processId, startedAt: lease.lifecycle.startedAt,
        controlBasis: { leaseGeneration: lease.leaseGeneration, controlRevision: lease.controlRevision },
        workflowId: authority.envelope.workflow, itemId: authority.envelope.itemId, runId, runVersion: authority.version,
        runAttempt: authority.envelope.attempt, traceId: authority.envelope.traceId, nodeId: native.nodeId,
        writeIntentId: intent.writeIntentId, intentVersion: intent.version, intentGeneration: intent.generation,
        writeAttemptId: intent.currentAttemptId, bindingProofDigest: intent.bindingProofDigest, occurrenceKeyDigest: intent.idempotencyKeyDigest });
      try {
        requireParkedWriteCheckTarget(repositories, target, deps.canonical?.descriptors.resolve(authority.envelope.workflow));
        check = { state: "available", target };
      } catch (error) { if (!(error instanceof WorkerControlRefusal)) throw error; }
    }
  }
  const latest = repositories?.workerControls.list().findLast(record => record.request.type === "check-parked-write"
    && record.request.requestedBy === "local-operator" && record.request.source === "run-detail"
    && record.request.target.installationId === deps.authorityIdentity?.installationId && record.request.target.profileId === deps.authorityIdentity?.profileId
    && record.request.target.workflowId === authority.envelope.workflow && record.request.target.itemId === authority.envelope.itemId
    && record.request.target.runAttempt === authority.envelope.attempt && record.request.target.traceId === authority.envelope.traceId
    && record.request.target.nodeId === native?.nodeId
    && record.request.target.runId === runId && record.request.target.writeIntentId === intent.writeIntentId
    && record.request.target.intentGeneration === intent.generation && record.request.target.writeAttemptId === intent.currentAttemptId
    && record.request.target.bindingProofDigest === intent.bindingProofDigest && record.request.target.occurrenceKeyDigest === intent.idempotencyKeyDigest
    && record.request.target.runVersion === authority.version && record.request.target.intentVersion === intent.version);
  const lastCheck = latest?.phase.state === "succeeded" && latest.phase.acknowledgement.kind === "parked-write-check"
    ? latest.phase.acknowledgement.result : undefined;
  return ParkedWriteDetailWireSchema.parse({ acceptsTransactionId, check, ...(lastCheck === undefined ? {} : { lastCheck }),
    ...(native === undefined || nativeEvent === undefined ? {} : { native: {
      eventId: nativeEvent.eventId, order: nativeEvent.cursor, runId: native.runId,
      attempt: native.attempt, traceId: native.traceId, nodeId: native.nodeId,
    } }),
    runId,
    writeIntentId: intent.writeIntentId,
    generation: intent.generation,
    runAttempt: intent.runAttempt,
    system: intent.system,
    taskId: intent.taskId,
    idempotencyKeyDigest: publicTransactionKeyDigest(intent.idempotencyKeyDigest, hasProtectedTransactionInput(authority)),
    fencedAt: intent.fencedAt,

    parkedAt: lifecycle.parkedAt,
    parkedCode: intent.parkedCode,
    parkedMessage: `Write intent ${intent.writeIntentId} is parked (${intent.parkedCode}) for `
      + `${idempotencyKeyDigestReference(intent.idempotencyKeyDigest, hasProtectedTransactionInput(authority))}. Verify the target system, then use one typed resolution.`,
    subject: parkedWriteSubject(intent.bindingProof),
    proofContract: parkedWriteProofContract(deps, authority, intent),
    actions: parkedWriteActions(authority, intent),
  });
}

export type GateParkSection = "parked-write" | "identity-gate";

export function buildGateParkSection(
  deps: RunDetailQueryDeps,
  runId: string,
  section: GateParkSection,
): RunDetailSectionResponse {
  const authority = requireTrustRun(deps.runReader, runId);
  const served = availableSections(undefined, authority, deps.trust);
  if (!served.includes(section)) {
    throw new SectionUnavailableError(
      `section ${section} is not available for run ${runId}; served sections are ${served.join(", ")}`,
    );
  }
  const payload = section === "parked-write"
    ? buildParkedWritePayload(deps, authority)
    : buildIdentityGatePayload(deps, authority);
  return RunDetailSectionResponseSchema.parse({ section, payload });
}
