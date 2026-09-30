import { protectIdentityEvidencePacket } from "../../../../domain/separations/identity-evidence.js";
import {
  retainedRunProtectedBindings,
  hasProtectedTransactionInput,
  publicTransactionKeyDigest,
} from "../../../../domain/protected-input.js";
import { deriveIdentityEvidenceDigest } from "../../../../domain/separations/identity-evidence.js";
import { MatchIdentityOutputSchema } from "../../../../domain/contracts/separations/match-identity.js";
import type { IdentityEvidencePacket } from "../../../../domain/separations/identity-evidence.js";
import {
  IdentityGateDetailWireSchema,
  ParkedWriteDetailWireSchema,
  RunDetailSectionResponseSchema,
  type RunDetailSectionResponse,
} from "../../../../domain/dashboard/run-detail.js";
import type { WriteBindingProof, WriteIntentRecord } from "../../../../domain/write-safety.js";
import type { GateResultRecord } from "../../../../domain/gates.js";
import { evidenceLeaves } from "../../../../domain/trust/evidence-classification.js";
import { findGateDecision } from "../../../../domain/trust/gate-decisions.js";
import type { RunRecord } from "../../../../domain/run/record.js";
import type { RunFoldRecord } from "../../projectors/run-queue-projection.js";
import { deterministicUuid } from "../../support.js";
import { idempotencyKeyDigestReference } from "../../../../domain/redaction.js";
import { SectionUnavailableError } from "../../../failures.js";
import type { RunDetailQueryDeps } from "../run-detail-types.js";
import { requireTrustRun } from "../../../trust/run-reader.js";
import { availableSections } from "./availability.js";
import { descriptorRuntimeNodes, runtimeNodeLabel } from "../../../../base/workflow.js";
import { BUILD_MANIFEST, resolveTaskImplFingerprint } from "../../../../domain/workflow/build-manifest.js";
import { checkpointLookupKey } from "../../../../domain/workflow/checkpoint.js";
import { deriveSchemaHash } from "../../../../domain/schema-bound-value.js";
import { deriveStableUuid, lifecycleCommandId } from "../../../../domain/identifiers.js";
import { canonicalJsonStringify } from "../../../../domain/canonical-json.js";
import { readRunCheckpoint } from "../../../../core/run-checkpoint-reader.js";
import { timelineCheckpointReference } from "../../../../events/timeline.js";

/**
 * D237 — what a SETTLED gate's panel says: approved or rejected, by whom, when.
 *
 * The verdict is read from the gate's own durable `gate_results` row through
 * D204's declared arm table, which is the same derivation the evidence receipt
 * uses — so the panel and the receipt cannot disagree about a human decision.
 * The span stream is deliberately NOT the source: the command service emits
 * `resolutionKey: "resolved"` for every gate (the one key that is true without
 * a display vocabulary), so a wire arm keyed on it was structurally unreachable
 * and every settled gated run's panel said the gate was absent — separations
 * §9.17 item 7(a).
 *
 * Every way this read can fail to produce a verdict is a NAMED absence, not a
 * coerced one. That is the split with the receipt, and it is deliberate: the
 * receipt is the durable artifact and REFUSES to derive at all when a gate is
 * undeclared or stores an arm value nobody declared (D204), while the panel
 * must still render the run it is explaining — so it states the exact gap in
 * the reason an operator reads instead of taking the surface down. Neither ever
 * guesses the word.
 */
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
      label: gate === undefined ? run.lifecycle.gateId : runtimeNodeLabel(gate),
      openedAt: run.lifecycle.parkedAt,
      revision: 1,
    };
  }
  return settledGateWire(runId, run.envelope.workflow, stored.at(-1), row?.resolvedGates.at(-1));
}

/* ── the parked-write section (ref write-safety §4.1) ──────────────────────────────── */

/**
 * The binding proof's subject. A `subject-match` proof pins `expected` and
 * `observed` as canonically identical — its own `superRefine` refuses any
 * proof where they are not — so `expected` IS the fact, not half of it.
 *
 * The evidence is copied, not re-shaped: `SubjectEvidenceSchema` is already the
 * display-safe form ref write-safety binds a write against, and every arm of it is a
 * digest, a branded id, or a bounded suffix. A second projection here could
 * only invent a name for a redaction that happened at binding time.
 */
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

/**
 * WHAT A CONFIRMED-PRESENT RESOLUTION MUST CARRY (D245, ref write-safety §4.1).
 *
 * `resolvePresent` refuses any proof whose `schemaHash` is not
 * `deriveSchemaHash(node.commit.uses.writeSafety.completion.proofSchema)` and
 * then parses the value through that exact schema. This wire served neither,
 * so the present arm was drawn DISABLED on every parked run in the build —
 * a fenced write that DID land could only be recorded as absent, which is a
 * durable lie, or left parked forever.
 *
 * Everything here is DERIVED and nothing is re-derived: the hash and the field
 * list are the composition root's `writeContracts` view, computed from the
 * descriptor beside `gateNodes` and for the same stated reason — this directory
 * never reaches the descriptor builders, and a query that recomputed a schema
 * hash would be a second copy of the contract's identity.
 *
 * Every failure is a NAMED `unavailable` reason rather than a throw, and that
 * split is deliberate: the checks above this one throw because a parked run
 * whose intent authority cannot produce is a storage fault, while a build that
 * cannot describe a proof is a build limitation — the panel must still render,
 * and the confirmed-ABSENT arm must still be reachable, for a run whose
 * workflow this build no longer registers.
 */
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
      + "declares this workflow is running (ref write-safety §4.1, D136).",
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

/**
 * The two typed resolutions, both always served (ref write-safety §4.1, ref frontend-backend-integration §8.5).
 *
 * Serving only one would be this query deciding what the operator's look at
 * the target system is going to find, and there is no third arm on purpose:
 * ref write-safety is explicit that no "force done" or "retry anyway" endpoint exists.
 * Both carry `confirm` copy that names the CASUALTY in the operator's terms —
 * confirmed-present settles the run as though the transaction happened, and
 * confirmed-absent authorizes a fresh fence that will click again.
 */
function parkedWriteActions(
  authority: RunRecord,
  intent: Extract<WriteIntentRecord, { status: "parked" }>,
): unknown[] {
  const writeTarget = { writeIntentId: intent.writeIntentId, intentGeneration: intent.generation };
  return [
    {
      key: "resolve-write-present",
      label: "I confirmed it IS there",
      detail: "Record the transaction you found, with its proof. The run settles as committed and never clicks again.",
      intent: "warning",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-write-present",
      expectedVersion: authority.version,
      confirm: {
        title: "Confirm the transaction exists",
        body: `This files ${intent.system} transaction ${intent.writeIntentId} as committed on this run's `
          + "evidence. If it is not actually there, the run finishes reporting work nobody did.",
        confirmLabel: "It is there",
        tone: "destructive",
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

/**
 * The identity-approval gate section (ref write-safety §14.4).
 *
 * Everything is DERIVED and nothing is minted. The packet is the stored output
 * of the node the gate waits on — located through the descriptor's `dependsOn`,
 * so no node name is hard-coded — and the digest is the one that node stored
 * beside it, which is the value an approval must carry. `missing` is a real
 * answer with a reason: a run parked on a gate this composition cannot describe
 * says so rather than serving a half panel an operator could act on.
 */
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
  if (packet.emplIdSource !== "name-resolved") {
    return missing(
      `gate "${gate.nodeId}" is parked on ${packet.emplIdSource} evidence, but this build requires an `
      + "operator decision only for a name-resolved EID; this historical run cannot be resolved under the current contract",
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
  return {
    state: "available",
    value: IdentityGateDetailWireSchema.parse({
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
      approvalShape: packet.approvalShape,
      actions: identityGateActions(authority, packet),
    }),
  };
}

/**
 * The two typed resolutions, always both served.
 *
 * Which one is right is a question only the operator's look at the evidence can
 * answer, so hiding either would be this wire pre-deciding it — the same
 * argument the parked-write section makes. What DOES change with the risk is
 * the ceremony: `approvalShape` says whether approval is one click or an
 * explicit choice, and the approve action's `confirm` block names the
 * disagreements the operator is approving over.
 */
function identityGateActions(authority: RunRecord, packet: IdentityEvidencePacket): unknown[] {
  const disagreements = packet.comparisons.filter(({ agrees }) => !agrees);
  return [
    {
      key: "resolve-gate-approved",
      label: packet.approvalShape === "one-click" ? "Approve this person" : "Approve the chosen EID",
      detail: packet.approvalShape === "type-the-eid"
        ? "This decision is ambiguous: the EID must be typed, not selected."
        : packet.approvalShape === "choose-a-candidate"
          ? "Choose which candidate the separation document means."
          : "One unambiguous candidate, one active job, and the names agree.",
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
    {
      key: "resolve-gate-rejected",
      label: "Reject — this is not the right person",
      detail: "Ends the run with the reason recorded. Nothing downstream runs.",
      intent: "destructive",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-gate",
      expectedVersion: authority.version,
      resolution: "rejected",
      confirm: {
        title: "Reject this identity",
        body: `The run ends and records why. Separation document ${packet.documentNumber} stays untouched.`,
        confirmLabel: "Reject",
        tone: "neutral",
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
    // The run's own park NAMES this intent. Its absence is a storage fault on
    // the one record that says whether a real HR transaction exists — serving
    // an empty panel here would let an operator resolve nothing while being
    // told they resolved something.
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
  return ParkedWriteDetailWireSchema.parse({
    runId,
    writeIntentId: intent.writeIntentId,
    generation: intent.generation,
    runAttempt: intent.runAttempt,
    system: intent.system,
    taskId: intent.taskId,
    idempotencyKeyDigest: publicTransactionKeyDigest(intent.idempotencyKeyDigest, hasProtectedTransactionInput(authority)),
    fencedAt: intent.fencedAt,
    // The run's park instant, not the intent's `updatedAt`: the operator is
    // being told when THIS run stopped, and a later intent row touch is a
    // different event.
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
