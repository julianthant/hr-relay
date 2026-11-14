import { publicWriteTarget } from "../../commands/write-command-target.js";
import { readRunCheckpoint } from "../../../storage/sqlite/run-continuation.js";
import { acceptsRecheckTransactionId } from "../../../../rules/write-safety/parked-resolution.js";
import { retainedUcpathFindings } from "./ucpath-findings.js";
import { LogIdentityRefusedError } from "../../commands/refusals.js";
import type { IdentityGateAnswerResolution } from "../../commands/operator-command-ingress.js";
import { CommandRequestSchema, ParkedWriteCheckTargetSchema, type CommandRequest, type IdentityGateAnswerRequest, type ParkedWriteCheckTarget } from "../../../../rules/commands/commands.js";
import { IdentityApprovalResultSchema, type IdentityApprovalResult } from "../../../../rules/separations/identity-approval.js";
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
import type { z } from "zod";
import { SearchPersonMatchOutputSchema } from "../../../../models/systems/ucpath/search-person-match.js";
import { ONBOARDING_WRITE_REVIEW_GATE } from "../../../../models/workflows/onboarding/read-write-plan.js";
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
import { idempotencyKeyDigestReference, maskedEid } from "../../../../rules/redaction/redaction.js";
import { SectionUnavailableError } from "../../commands/refusals.js";
import type { RunDetailQueryDeps } from "../run-detail-types.js";
import { correctionStartRequest } from "./receipts-failures.js";
import { requireTrustRun } from "../../trust/run-reader.js";
import { availableSections } from "./availability.js";
import { descriptorRuntimeNodes, runtimeNodeLabel } from "../../../../workflow-kit/workflow.js";
import { taskImplFingerprint } from "../../../../workflow-kit/fingerprints.js";
import { checkpointLookupKey } from "../../../../models/workflow/checkpoint.js";
import { deriveSchemaHash } from "../../../../models/validation/schema-bound-value.js";
import { deriveStableUuid, lifecycleCommandId } from "../../../../rules/identity/identifiers.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { timelineCheckpointReference } from "../../../../models/events/timeline.js";
import { ActionDescriptorWireSchema, type ActionDescriptorWire } from "../../../../models/dashboard/actions.js";
import type { DecisionInputWire, RunDecisionWire } from "../../../../models/dashboard/run-decision.js";
import { IDENTITY_REVIEW_TEXT, PARKED_WRITE_RECORDS, parkedWriteRecordId, type ParkedWriteRecord } from "../../decisions/decision-catalog.js";
import { projectDecision, rowActionOption } from "../../decisions/project-decision.js";
import { decisionAnswerer, type DecisionAnswerer } from "../../decisions/decision-answer.js";


function settledGateWire(
  runId: string,
  workflowId: string,
  stored: GateResultRecord | undefined,
  folded: RunFoldRecord["resolvedGates"][number] | undefined,
  answer: DecisionAnswerer | undefined,
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
    ...(answer === undefined || gateId !== ONBOARDING_WRITE_REVIEW_GATE ? {} : { answer: answer(stored.commandId, { id: arm.value, label: arm.label }, stored.resolvedAt) }),
  };
}

/** D4 for the hire review: `new-hire` and `existing-person` are served only as `readOnboardingWritePlan` would accept them, from the run's own UCPath match. Other operator gates stay unprojected: the identity gate has its own section, and no other arm's result can be built from served facts. */
function reviewBeforeWriteDecision(deps: RunDetailQueryDeps, authority: RunRecord, gateId: string): RunDecisionWire | undefined {
  const arms = findGateDecision(authority.envelope.workflow, gateId)?.arms;
  if (gateId !== ONBOARDING_WRITE_REVIEW_GATE || arms === undefined) return undefined;
  const match = hireReviewMatch(deps, authority);
  return match === undefined ? undefined : hireReviewDecision(match, arms, gateId, authority.version);
}

export function hireReviewDecision(match: z.infer<typeof SearchPersonMatchOutputSchema>,
  arms: readonly Readonly<{ value: string; label: string; hint: string }>[], gateId: string, expectedVersion: number): RunDecisionWire | undefined {
  const confirmed = match.confirmed.filter(person => match.hits.some(hit => hit.emplId === person.emplId && hit.name === person.name)
    && !match.dropped.some(hit => hit.emplId === person.emplId));
  const newHire = match.hits.length === 0 && match.confirmed.length === 0 && match.dropped.length === 0;
  const send = (arm: string) => ({ via: "gate-arm" as const, gateNodeId: gateId, expectedVersion, arm });
  const served = arms.flatMap(arm => {
    if (arm.value === "new-hire" && newHire) return [{ id: arm.value, label: arm.label, hint: arm.hint, send: send(arm.value) }];
    if (arm.value === "existing-person" && confirmed.length > 0) return [{ id: arm.value, label: arm.label, hint: arm.hint, send: send(arm.value), input: { kind: "candidate" as const, table: {
      title: "Confirmed UCPath matches",
      columns: [{ id: "name", label: "Name" }, { id: "eid", label: "Employee ID" }],
      rows: confirmed.map(person => ({ id: person.emplId, name: person.name, eid: person.emplId, cells: [
        { columnId: "name", value: person.name }, { columnId: "eid", value: maskedEid(person.emplId) },
      ] })),
    } } }];
    return [];
  });
  return served.length === 0 ? undefined : projectDecision("review-before-write", served);
}

/** The run's `ucpath-source` match checkpoint, or undefined when it cannot be read for this run's bound descriptor. */
function hireReviewMatch(deps: RunDetailQueryDeps, authority: RunRecord): z.infer<typeof SearchPersonMatchOutputSchema> | undefined {
  const canonical = deps.canonical;
  if (canonical === undefined) return undefined;
  const { envelope } = authority;
  const stored = readRunCheckpoint(canonical.database.authority, envelope, "ucpath-source", true);
  if (stored === undefined || stored.workflowId !== envelope.workflow || stored.itemId !== envelope.itemId
    || stored.attempt > envelope.attempt || stored.descriptorVersion !== envelope.descriptorVersion
    || stored.contractFingerprint !== envelope.contractFingerprint
    || stored.output.schemaHash !== deriveSchemaHash(SearchPersonMatchOutputSchema, "output")) return undefined;
  const parsed = SearchPersonMatchOutputSchema.safeParse(stored.output.value);
  return parsed.success ? parsed.data : undefined;
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
    const decision = gate === undefined ? undefined : reviewBeforeWriteDecision(deps, authority, gateId);
    return {
      state: "open",
      gateId: deterministicUuid(`gate:${runId}:${run.lifecycle.gateId}`),
      nodeId: run.lifecycle.gateId,
      label: gate === undefined ? run.lifecycle.gateId : runtimeNodeLabel(gate),
      openedAt: run.lifecycle.parkedAt,
      revision: 1,
      ...(decision === undefined ? {} : { decision }),
    };
  }
  const answer = deps.operatorName === undefined || deps.canonical === undefined ? undefined
    : decisionAnswerer(deps.canonical.database.authority.commands, deps.operatorName);
  return settledGateWire(runId, run.envelope.workflow, stored.at(-1), row?.resolvedGates.at(-1), answer);
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
  const writeTarget = publicWriteTarget({ writeIntentId: intent.writeIntentId, intentGeneration: intent.generation,
    writeAttemptId: intent.currentAttemptId, bindingProofDigest: intent.bindingProofDigest, occurrenceKeyDigest: intent.idempotencyKeyDigest });
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


type IdentityOption = Readonly<{ ref: string; eid: string; chosenFrom: "checked" | "name-search" | "manual"; displayName: string; maskedEid: string; origin: string }>;
type IdentityArm = Readonly<{ outcome: string; label: string; hint: string; rejectReason?: string }>;
type IdentityGateFacts = Readonly<{
  runId: string; gateId: string; label: string; parkedAt: string; version: number; resultSchemaHash: string;
  packet: IdentityEvidencePacket; evidenceDigest: string; gateRef: string; order: number | undefined;
  options: readonly IdentityOption[]; arms: readonly IdentityArm[]; rejected: IdentityArm | undefined;
}>;

/** Opaque: binds an answer to this run version's exact evidence without serving the digest. */
function identityGateRef(runId: string, gateId: string, version: number, evidenceDigest: string): string {
  return deriveStableUuid("identity-gate-ref", canonicalJsonStringify([runId, gateId, version, evidenceDigest]));
}
/** Keyed by the unserved evidence digest: a served ref plus the served last four digits must not recover the Employee ID. */
const identityOptionRef = (evidenceDigest: string, eid: string): string => deriveStableUuid("identity-gate-option", canonicalJsonStringify([evidenceDigest, eid]));

function readIdentityGate(
  deps: RunDetailQueryDeps,
  authority: RunRecord,
): Readonly<{ state: "missing"; reason: string }> | Readonly<{ state: "available"; facts: IdentityGateFacts }> {
  const { lifecycle } = authority;
  const runId = authority.envelope.runId;
  if (lifecycle.state !== "parked-gate") {
    throw new Error(`run ${runId} advertises an identity-gate section while it is ${lifecycle.state}`);
  }
  const missing = { state: "missing" as const, reason: IDENTITY_REVIEW_TEXT.unavailable };
  const descriptor = deps.descriptors.resolve(authority.envelope.workflow);
  if (descriptor === undefined) {
    return missing;
  }
  const gate = (descriptor.gateNodes ?? [])
    .find(({ nodeId }) => nodeId === String(lifecycle.gateId));
  if (gate === undefined) {
    return missing;
  }
  if (deps.canonical === undefined) {
    return missing;
  }
  const runtimeDescriptor = deps.canonical.descriptors.resolve(authority.envelope.workflow);
  if (runtimeDescriptor === undefined) {
    return missing;
  }
  if (runtimeDescriptor.version !== authority.envelope.descriptorVersion
    || runtimeDescriptor.contractFingerprint !== authority.envelope.contractFingerprint) {
    return missing;
  }
  const runtimeGate = descriptorRuntimeNodes(runtimeDescriptor)
    .find((candidate) => candidate.kind === "gate" && String(candidate.id) === gate.nodeId);
  if (runtimeGate === undefined || runtimeGate.kind !== "gate"
    || deriveSchemaHash(runtimeGate.result, "output") !== gate.resultSchemaHash
    || canonicalJsonStringify(runtimeGate.dependsOn.map(String)) !== canonicalJsonStringify(gate.dependsOn)) {
    return missing;
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
        || stored.implFingerprint !== taskImplFingerprint(runtimeNode.uses)) return [];
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
    return missing;
  }
  const found = evidence[0];
  if (found === undefined) throw new Error(`gate "${gate.nodeId}" evidence disappeared mid-projection`);
  const packet = protectIdentityEvidencePacket(found.packet, retainedRunProtectedBindings(authority));
  const evidenceDigest = deriveIdentityEvidenceDigest(packet);
  if (packet.emplIdSource !== "name-resolved" && packet.emplIdSource !== "operator-entered") {
    return missing;
  }
  const source = packet.emplIdSource;
  const nameSearchEid = packet.nameSearch.status === "resolved" ? packet.nameSearch.candidate.eid : undefined;
  const gateRef = identityGateRef(runId, gate.nodeId, authority.version, evidenceDigest);
  const { origin, value: text } = IDENTITY_REVIEW_TEXT;
  const options: IdentityOption[] = packet.approvableEids.map((eid) => ({
    ref: identityOptionRef(evidenceDigest, eid),
    eid,
    chosenFrom: eid === packet.emplId ? "checked" : eid === nameSearchEid ? "name-search" : "manual",
    displayName: eid === packet.emplId
      ? packet.ucpathName
      : eid === nameSearchEid && packet.nameSearch.status === "resolved"
        ? packet.nameSearch.candidate.name
        : text.unnamed,
    maskedEid: maskedEid(eid),
    origin: eid === packet.emplId ? origin[source] : eid === nameSearchEid ? origin["name-search"] : origin.manual,
  }));
  const nativeEvents = readTimelineRecords(deps.timeline, 0, runId).records.filter(record =>
    record.payload.kind === "span" && record.payload.event.t === "gate.opened"
    && record.payload.event.gate === gate.nodeId && record.payload.event.attempt === authority.envelope.attempt);
  if (nativeEvents.length > 1) throw new LogIdentityRefusedError("RUN_LOG_GATE_NATIVE_IDENTITY_DUPLICATE");
  const nativeEvent = nativeEvents[0];
  const native = nativeEvent?.payload.kind === "span" && nativeEvent.payload.event.t === "gate.opened"
    ? nativeEvent.payload.event : undefined;
  if (native !== undefined && native.traceId !== authority.envelope.traceId) throw new LogIdentityRefusedError("RUN_LOG_GATE_NATIVE_IDENTITY_MISMATCH");
  const arms = findGateDecision(authority.envelope.workflow, String(gate.nodeId))?.arms ?? [];
  return { state: "available", facts: {
    runId, gateId: gate.nodeId, label: gate.label, parkedAt: lifecycle.parkedAt, version: authority.version,
    resultSchemaHash: gate.resultSchemaHash, packet, evidenceDigest, gateRef,
    order: native === undefined || nativeEvent === undefined ? undefined : nativeEvent.cursor,
    options, arms, rejected: arms.find(arm => arm.outcome === "rejected"),
  } };
}

function buildIdentityGatePayload(deps: RunDetailQueryDeps, authority: RunRecord): unknown {
  const read = readIdentityGate(deps, authority);
  if (read.state === "missing") return read;
  const { facts } = read;
  const actions = ActionDescriptorWireSchema.array().parse(identityGateActions(facts));
  const correction = facts.options.length > 1 ? identityGateCorrection(deps, authority, facts.gateId) : undefined;
  return {
    state: "available",
    value: IdentityGateDetailWireSchema.parse({
      runId: facts.runId,
      gateRef: facts.gateRef,
      label: facts.label,
      parkedAt: facts.parkedAt,
      expectedVersion: facts.version,
      ...(facts.order === undefined ? {} : { order: facts.order }),
      reason: identityReviewReason(facts.packet, facts.options.length),
      comparisons: identityComparisons(facts.packet),
      options: facts.options.map(({ ref, displayName, maskedEid, origin }) => ({ ref, displayName, maskedEid, origin })),
      approvalShape: facts.options.length > 1 ? "choose-a-candidate" : "one-click",
      actions,
      decision: identityGateDecision(facts.options, actions, facts.arms, deps.projection.queueSurface(facts.runId)?.actions,
        { documentName: facts.packet.documentName }, correction),
      ...(correction === undefined ? {} : { correction }),
    }),
  };
}

/** The fill row's lookup: a typed value restarts this run's lookup for that person, served only where the workflow declares it for this gate. */
function identityGateCorrection(deps: RunDetailQueryDeps, authority: RunRecord, gateId: string) {
  const canonical = deps.canonical;
  const descriptor = canonical?.descriptors.resolve(authority.envelope.workflow);
  const declared = descriptor?.gateCorrections?.find(entry => entry.gateId === gateId);
  if (canonical === undefined || descriptor === undefined || declared === undefined) return undefined;
  const request = correctionStartRequest(canonical, descriptor, authority, { gateCorrection: { gateId, inputField: declared.inputField } });
  return request === undefined ? undefined : { inputField: declared.inputField, label: declared.label, placeholder: declared.placeholder,
    pattern: declared.pattern, expectedVersion: authority.version, confirm: { ...IDENTITY_REVIEW_TEXT.lookup, tone: "neutral" as const }, request };
}

/** Why Relay asks: several matches, else the first disagreement in the packet's disagreements-first order. */
function identityReviewReason(packet: IdentityEvidencePacket, candidates: number): string {
  const { reason } = IDENTITY_REVIEW_TEXT;
  if (candidates > 1) return reason["several-people"];
  if (packet.emplIdSource === "operator-entered") return reason["eid-entered"];
  const first = packet.comparisons.find(({ agrees }) => !agrees);
  if (first === undefined) return reason.agreed;
  if (first.field === "eid") return reason.eid;
  return reason[first.field];
}

/** The Request and UCPath table, with display labels and masked Employee IDs in place of the packet's keys, notes and full IDs. */
function identityComparisons(packet: IdentityEvidencePacket): readonly Readonly<{ label: string; request: string; ucpath: string; agrees: boolean }>[] {
  const { label, value } = IDENTITY_REVIEW_TEXT;
  const { jobs, nameSearch } = packet;
  const cells: Readonly<Record<IdentityEvidencePacket["comparisons"][number]["field"], readonly [string, string]>> = {
    name: [packet.documentName, packet.ucpathName],
    eid: [/^\d{8}$/u.test(packet.documentEidText) ? maskedEid(packet.documentEidText) : value.noFormEid, maskedEid(packet.emplId)],
    employment: [value.oneActiveJob, jobs.disposition === "single-active-job" ? value.oneActiveJob
      : jobs.disposition === "no-active-job" ? value.noActiveJob
        : jobs.disposition === "concurrent-active-jobs" ? `${String(jobs.activeRowCount)} active jobs` : value.unknownJob],
    "name-search": [packet.documentName, nameSearch.status === "resolved" ? `${nameSearch.candidate.name} · ${maskedEid(nameSearch.candidate.eid)}`
      : nameSearch.status === "ambiguous" ? `${String(nameSearch.candidateEids.length)} people` : value.noMatch],
  };
  return packet.comparisons.map(({ field, agrees }) => ({ label: label[field], request: cells[field][0], ucpath: cells[field][1], agrees }));
}

/** D1 (one candidate): approve or, where the gate declares it, reject. D2 (several): pick a served candidate, or cancel the run. */
export function identityGateDecision(
  options: readonly Pick<IdentityOption, "ref" | "displayName" | "maskedEid" | "origin">[],
  actions: readonly ActionDescriptorWire[],
  arms: readonly Readonly<{ outcome: string; label: string; hint: string }>[],
  rowActions: readonly ActionDescriptorWire[] | undefined,
  subject?: Readonly<{ documentName: string }>,
  typed?: Readonly<{ label: string; placeholder: string; pattern: string }>,
): RunDecisionWire {
  const find = (resolution: "approved" | "rejected") => actions.find(action => action.kind === "command" && action.resolution === resolution);
  const approved = find("approved"), approve = approved?.key, reject = find("rejected")?.key;
  // The approve option carries the served approval's confirm; the rejection descriptor has none.
  const approveConfirm = approved?.kind === "command" && approved.confirm !== undefined ? { confirm: approved.confirm } : {};
  const text = (outcome: string) => { const arm = arms.find(candidate => candidate.outcome === outcome); return arm === undefined ? {} : { label: arm.label, hint: arm.hint }; };
  if (options.length === 1) {
    return projectDecision("identity-mismatch", [
      ...(approve === undefined ? [] : [{ id: "approve", send: { via: "action" as const, actionKey: approve }, ...text("approved"), ...approveConfirm }]),
      ...(reject === undefined ? [] : [{ id: "reject", send: { via: "action" as const, actionKey: reject }, ...text("rejected") }]),
    ]);
  }
  return projectDecision("pick-person", [
    ...(approve === undefined ? [] : [{ id: "confirm", send: { via: "action" as const, actionKey: approve }, ...approveConfirm, input: { kind: "candidate" as const, table: {
      title: "Search results",
      columns: [{ id: "name", label: "Name" }, { id: "eid", label: "Employee ID" }, { id: "origin", label: "Found by" }],
      rows: options.map(option => ({ id: option.ref, name: option.displayName, cells: [
        { columnId: "name", value: option.displayName }, { columnId: "eid", value: option.maskedEid }, { columnId: "origin", value: option.origin },
      ] })),
      ...(typed === undefined ? {} : { typed: { label: typed.label, placeholder: typed.placeholder, pattern: typed.pattern, lookup: true as const } }),
    } } }]),
    ...rowActionOption("cancel-run", "cancel", rowActions),
  ], subject === undefined ? {} : { title: `Which ${subject.documentName} is this run about?`, context: `UCPath found ${options.length} people with this name.` });
}

function identityGateActions(facts: IdentityGateFacts): unknown[] {
  const { packet, options, rejected } = facts;
  const agreed = packet.comparisons.every(({ agrees }) => agrees);
  const { confirm } = IDENTITY_REVIEW_TEXT;
  return [
    {
      key: "resolve-gate-approved",
      label: options.length === 1 ? "Approve this person" : "Approve the chosen person",
      detail: options.length > 1
        ? "Choose which candidate the separation document means."
        : "Confirm the one candidate the separation document means.",
      intent: "primary",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-gate",
      expectedVersion: facts.version,
      resolution: "approved",
      confirm: {
        title: "Approve this identity",
        body: agreed ? confirm.agreed : `${identityReviewReason(packet, options.length)} ${confirm.disagreed}`,
        confirmLabel: "Approve",
        tone: agreed ? "neutral" : "destructive",
      },
    },
    ...(rejected === undefined ? [] : [{
      key: "resolve-gate-rejected",
      label: rejected.label,
      detail: rejected.hint,
      intent: "destructive",
      icon: "cancel",
      placement: ["footer"],
      kind: "command",
      command: "resolve-gate",
      expectedVersion: facts.version,
      resolution: "rejected",
    }]),
  ];
}

const STALE_IDENTITY_ANSWER = "This identity review changed. Reload it before answering.";

/** Resolve the dashboard's opaque identity answer to the kernel's `resolve-gate`, against the evidence this run holds now. */
export function resolveIdentityGateAnswer(
  deps: RunDetailQueryDeps,
  answer: IdentityGateAnswerRequest,
  journaled: CommandRequest | undefined,
): IdentityGateAnswerResolution {
  const refused = (code: "invalid-state" | "command-divergent", message: string) => ({ state: "refused" as const, code, message });
  if (journaled !== undefined) {
    return journaled.family === "gate" && journaled.type === "resolve-gate" && journaledAnswerMatches(journaled, answer)
      ? { state: "accepted", request: journaled }
      : refused("command-divergent", "command-divergent: this command was already used for a different answer");
  }
  const authority = requireTrustRun(deps.runReader, answer.target.runId);
  if (authority.lifecycle.state !== "parked-gate" || String(authority.lifecycle.gateId) !== String(answer.target.gateId)
    || authority.version !== answer.target.expectedVersion) return refused("invalid-state", STALE_IDENTITY_ANSWER);
  const read = readIdentityGate(deps, authority);
  if (read.state === "missing" || read.facts.gateRef !== answer.payload.gateRef) return refused("invalid-state", STALE_IDENTITY_ANSWER);
  const { facts } = read;
  const { payload } = answer;
  let value: IdentityApprovalResult;
  if (payload.decision === "rejected") {
    if (facts.rejected?.rejectReason === undefined) return refused("invalid-state", "This identity review has no reject answer.");
    value = IdentityApprovalResultSchema.parse({ decision: "rejected", reason: facts.rejected.rejectReason, evidenceDigest: facts.evidenceDigest });
  } else {
    const option = facts.options.find(({ ref }) => ref === payload.optionRef);
    if (option === undefined) return refused("invalid-state", STALE_IDENTITY_ANSWER);
    value = IdentityApprovalResultSchema.parse({ decision: "approved", eid: option.eid, chosenFrom: option.chosenFrom, evidenceDigest: facts.evidenceDigest });
  }
  const { commandId, requestedAt, requestedBy, source, target } = answer;
  return { state: "accepted", request: CommandRequestSchema.parse({ commandId, requestedAt, requestedBy, source, family: "gate", type: "resolve-gate",
    target, payload: { result: { schemaHash: facts.resultSchemaHash, value } } }) };
}

/** A replayed answer is the journaled command only when its refs re-derive from that command's own evidence and choice. */
function journaledAnswerMatches(journaled: Extract<CommandRequest, { family: "gate" }>, answer: IdentityGateAnswerRequest): boolean {
  const { target } = journaled;
  if (canonicalJsonStringify(target) !== canonicalJsonStringify(answer.target)) return false;
  const parsed = IdentityApprovalResultSchema.safeParse(journaled.payload.result.value);
  if (!parsed.success || parsed.data.decision !== answer.payload.decision) return false;
  const gateRef = identityGateRef(target.runId, target.gateId, target.expectedVersion, parsed.data.evidenceDigest);
  if (gateRef !== answer.payload.gateRef) return false;
  const { payload } = answer;
  if (parsed.data.decision === "rejected" || payload.decision === "rejected") return true;
  return identityOptionRef(parsed.data.evidenceDigest, parsed.data.eid) === payload.optionRef;
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
  const repositories = deps.canonical?.database?.authority;
  let check: { state: "available"; target: ParkedWriteCheckTarget } | { state: "unavailable"; code: "PARKED_CHECK_UNAVAILABLE" }
    = { state: "unavailable", code: "PARKED_CHECK_UNAVAILABLE" };
  if (repositories !== undefined && deps.authorityIdentity !== undefined && native !== undefined
    && intent.bindingProof.kind === "subject-match" && ["ucpath/create-termination", "ucpath/delete-pending-terminations", "kuali/save-separation-finalization"].includes(intent.taskId)) {
    // The check runs on an idle running member of the run's workflow; its card fence is the pool's lifetime and version.
    const worker = repositories.workerSlots.list(authority.envelope.workflow).filter(slot => slot.retiredAt === null)
      .map(slot => ({ slot, view: deps.workerMembers?.().find(view => view.member.workerId === slot.workerId) }))
      .find(({ slot, view }) => view?.state === "running" && (view.activity === undefined || view.activity.state === "idle")
        && !repositories.runs.listByWorker(slot.workerId).some(run => ["claimed", "validating", "running"].includes(run.lifecycle.state)));
    if (worker?.view !== undefined) {
      const { slot, view } = worker;
      const target = ParkedWriteCheckTargetSchema.parse({ ...deps.authorityIdentity, workerId: slot.workerId, lifetimeId: view.lifetimeId, expectedVersion: view.version,
      workflowId: authority.envelope.workflow, itemId: authority.envelope.itemId, runId, runVersion: authority.version,
        runAttempt: authority.envelope.attempt, traceId: authority.envelope.traceId, nodeId: native.nodeId,
        writeIntentId: intent.writeIntentId, intentVersion: intent.version, intentGeneration: intent.generation,
        writeAttemptId: intent.currentAttemptId, bindingProofDigest: intent.bindingProofDigest, occurrenceKeyDigest: intent.idempotencyKeyDigest });
      try {
        requireParkedWriteCheckTarget(repositories, target, deps.canonical?.descriptors.resolve(authority.envelope.workflow));
        check = { state: "available", target: publicWriteTarget(target) };
      } catch (error) { if (!(error instanceof WorkerControlRefusal)) throw error; }
    }
  }
  const latest = repositories?.commandAudits.parkedWriteChecks(runId).findLast(({ request }) => request.type === "check-parked-write"
    && request.requestedBy === "local-operator" && request.source === "run-detail"
    && request.target.installationId === deps.authorityIdentity?.installationId && request.target.profileId === deps.authorityIdentity?.profileId
    && request.target.workflowId === authority.envelope.workflow && request.target.itemId === authority.envelope.itemId
    && request.target.runAttempt === authority.envelope.attempt && request.target.traceId === authority.envelope.traceId
    && request.target.nodeId === native?.nodeId
    && request.target.runId === runId && request.target.writeIntentId === intent.writeIntentId
    && request.target.intentGeneration === intent.generation && request.target.writeAttemptId === intent.currentAttemptId
    && request.target.bindingProofDigest === intent.bindingProofDigest && request.target.occurrenceKeyDigest === intent.idempotencyKeyDigest
    && request.target.runVersion === authority.version && request.target.intentVersion === intent.version);
  const lastCheck = latest?.parkedWriteCheck?.result;
  const actions = ActionDescriptorWireSchema.array().parse(parkedWriteActionsWithCheck(authority, intent, check));
  return ParkedWriteDetailWireSchema.parse({ acceptsTransactionId, check, ...(lastCheck === undefined ? {} : { lastCheck: { ...lastCheck, target: publicWriteTarget(lastCheck.target) } }),
    ...(intent.taskId === "ucpath/create-termination" ? { ucpathFindings: retainedUcpathFindings(deps, authority, intent, latest) } : {}),
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
    actions,
    decision: parkedWriteDecision({ taskId: intent.taskId, parkedCode: intent.parkedCode, acceptsTransactionId,
      ...(hasProtectedTransactionInput(authority) || intent.occurrence !== undefined ? {} : { recordId: parkedWriteRecordId(intent.taskId, intent.idempotencyKey) }),
      readBack: ["post-click-verifier-exception", "post-click-verifier-unknown"].includes(intent.authorityReason.code) }, actions),
  });
}

/** D5/D6: "Did the <record> save in <system>?" — Check again (held check only), Saved (Relay re-reads; a typed transaction number where the verifier takes one), Not saved (confirmed absence). */
export function parkedWriteDecision(parked: Readonly<{ taskId: string; parkedCode: string; readBack: boolean; acceptsTransactionId: boolean; recordId?: string }>,
  actions: readonly ActionDescriptorWire[]): RunDecisionWire {
  const find = (command: string) => actions.find(action => action.kind === "command" && action.command === command);
  const sending = (id: string, action: ActionDescriptorWire | undefined, text: Readonly<{ label?: string; hint?: string }>, input?: DecisionInputWire) => action === undefined ? []
    : [{ id, send: { via: "action" as const, actionKey: action.key }, ...text, ...(input === undefined ? {} : { input }),
      ...(action.kind === "command" && action.confirm !== undefined ? { confirm: action.confirm } : {}) }];
  // A task no longer registered keeps both typed resolutions in the catalog's general wording.
  const record = PARKED_WRITE_RECORDS[parked.taskId];
  const transaction = parked.acceptsTransactionId ? { kind: "text" as const, label: "Transaction number", placeholder: "T00000000", pattern: "^T\\d+$" } : undefined;
  return projectDecision(parked.parkedCode === "unknown" ? "write-unknown" : "write-parked", [
    ...sending("check-again", find("check-parked-write"), record === undefined ? {} : { hint: `Reads ${record.check} again; files nothing.` }),
    ...sending("saved", find("recheck-write"), record === undefined ? {} : { label: `Saved in ${record.system}`,
      hint: transaction === undefined ? `Relay checks ${record.system}, then the run continues.` : "Relay checks this number, then the run continues." }, transaction),
    ...sending("not-saved", find("resolve-write-absent"), record === undefined ? {} : { label: `Not saved, ${record.again}`, hint: record.againHint }),
  ], { ...(record === undefined ? {} : parkedWriteText(record, parked.readBack, parked.recordId)),
    // After a failed read-back the frame preselects the read that files nothing.
    ...(parked.readBack ? { recommend: "check-again" } : {}) });
}

/** The question and its context line; a park after the saved-effect read failed says the system accepted the write but its status could not be read. */
function parkedWriteText(record: ParkedWriteRecord, readBack: boolean, recordId: string | undefined) {
  const where = recordId === undefined || record.id === undefined ? `${record.check} in ${record.system}` : record.id.where(recordId);
  return readBack
    ? { title: `${record.record[0]?.toUpperCase() ?? ""}${record.record.slice(1)} saved, but the read-back failed`,
      context: `${record.system} accepted the ${record.act.toLowerCase()}, but Relay could not read its status. Check ${where}.` }
    : { title: `Did the ${record.record} save in ${record.system}?`, context: `${record.act} did not confirm. Check ${where}.` };
}

function parkedWriteActionsWithCheck(
  authority: RunRecord,
  intent: Extract<WriteIntentRecord, { status: "parked" }>,
  check: { state: "available"; target: ParkedWriteCheckTarget } | { state: "unavailable"; code: "PARKED_CHECK_UNAVAILABLE" },
): unknown[] {
  return [...parkedWriteActions(authority, intent), ...(intent.taskId !== "ucpath/create-termination" || check.state !== "available" ? [] : [{
      key: "check-parked-write", label: "Check again", detail: "Read UCPath while keeping this write parked.",
      intent: "warning", icon: "resolve", placement: ["review"], kind: "command", command: "check-parked-write",
      expectedVersion: authority.version, checkTarget: check.target,
      writeTarget: publicWriteTarget({ writeIntentId: intent.writeIntentId, intentGeneration: intent.generation, writeAttemptId: intent.currentAttemptId,
        bindingProofDigest: intent.bindingProofDigest, occurrenceKeyDigest: intent.idempotencyKeyDigest }),
      confirm: { title: "Read UCPath transaction findings", body: "Read the transaction list and details. The write stays parked; Relay submits nothing and does not authorize a retry.",
        confirmLabel: "Check again", tone: "neutral" },
    }])];
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
