import { z } from "zod";
import {
NotePageSchema,
RunDetailSectionResponseSchema,
RunDetailWireSchema,
type RunDetailSectionResponse,
type RunDetailWire,
type TimelineStepWire,
} from "../../../src/domain/dashboard/run-detail.js";
import { idempotencyKeyDigestReference } from "../../../src/domain/redaction.js";
import { FIXTURE_DIAGNOSTIC_BUNDLE } from "./fixture-diagnostic.js";
import { buildFixtureIdentityGate } from "./fixture-gate.js";
import { at,traceOf,uuidOf,WORKFLOW_ID } from "./fixture-identity.js";
import type { Status } from "./fixture-queue.js";
import { absent,FIXTURE_IDS } from "./fixture-queue.js";


/* ── run detail ──────────────────────────────────────────────────────────── */

interface DetailSeed {
  readonly seed: number;
  readonly panelKind: "run" | "member" | "group";
  readonly title: string;
  readonly status: Status;
  readonly workflowId?: string;
  readonly attempt?: number;
  readonly gate: unknown;
  readonly outcome: unknown;
  readonly timeline: readonly {
    seed: number;
    minute: number;
    label: string;
    state: "pending" | "active" | "done" | "failed" | "blocked" | "cancelled" | "skipped";
    /** Only on a `skipped` step, and only when the executor recorded one. */
    notRunReason?: "condition-false" | "branch-not-selected";
  }[];
  /**
   * D225's CATEGORICAL steps — one segment per descriptor-declared category.
   *
   * The corpus served none of these until now, so `Timeline` took its
   * `!categorical` arm for every reference and the strip the run-detail panel
   * ACTUALLY draws for a composed graph — the segment button, its member
   * disclosure, the `×N` marker, the replayed tone and the two-half axis — had
   * never been photographed at all. Every one of those is a decision about
   * markup (D273 item 2), which is exactly the kind a screenshot is supposed to
   * hold and a fold cannot see.
   */
  readonly steps?: readonly TimelineStepWire[];
  readonly dataFacts?: number;
  /**
   * An explicit advertisement, for a state the status alone cannot imply. A
   * `blocked` row is `parked-write` OR `interrupted` — the lifecycle knows and
   * the coarse queue status does not (the real `availableSections` reads
   * `authority.lifecycle`, not `header.status`), so the corpus states it.
   */
  readonly sections?: readonly string[];
}


function detailOf(input: DetailSeed): RunDetailWire {
  return RunDetailWireSchema.parse({
    runId: uuidOf(input.seed),
    rowRevision: input.seed,
    panelKind: input.panelKind,
    header: {
      runId: uuidOf(input.seed),
      traceId: traceOf(input.seed),
      workflowId: input.workflowId ?? WORKFLOW_ID,
      actorId: "local-operator",
      title: input.title,
      status: input.status,
      attempt: input.attempt ?? 1,
    },
    timeline: {
      ...(input.steps === undefined ? {} : { steps: input.steps }),
      events: input.timeline.map((event, index) => ({
        noteId: uuidOf(input.seed * 100 + 9000 + index),
        sequence: index,
        at: at(event.minute),
        label: event.label,
        state: event.state,
        notRun: event.notRunReason === undefined
          ? {
            state: "absent",
            reason: event.state === "skipped"
              ? "this step did not run; its span recorded no reason"
              : "this step ran",
          }
          : { state: "present", reason: event.notRunReason },
      })),
    },
    gate: input.gate,
    outcome: input.outcome,
    context: { dataFacts: input.dataFacts ?? 2, evidenceFacts: 0, attempts: 1 },
    availableSections: input.sections ?? (input.status === "failed"
      ? ["logs", "receipt", "context-data", "context-attempts", "failure"]
      : ["logs", "receipt", "context-data", "context-attempts"]),
  });
}


/**
 * The gate NODE's id — what the `identity-gate` SECTION is keyed by, and what a
 * `resolve-gate` command targets. It is deliberately not the same value as the
 * run detail's `gate.gateId`, which the server derives as a deterministic uuid
 * per `(run, gate)` for the timeline; the fixture carries both, exactly as the
 * two wires do.
 */
const GATE_NODE_ID = "identity-approval";


const NO_GATE = absent("this run reached no gate");

const STILL_RUNNING = absent("run is still executing");


export const FIXTURE_RUN_DETAILS: Readonly<Record<string, RunDetailWire>> = Object.freeze({
  [FIXTURE_IDS.queuedRun]: detailOf({
    seed: 1, panelKind: "run", title: "EID 10873698", status: "queued",
    gate: absent("this run has not started"), outcome: absent("this run has not started"),
    timeline: [], dataFacts: 0,
  }),
  [FIXTURE_IDS.runningRun]: detailOf({
    seed: 2, panelKind: "run", title: "Battistessa, Johnnie", status: "running",
    gate: NO_GATE, outcome: STILL_RUNNING,
    timeline: [{ seed: 2, minute: 52, label: "searching", state: "active" }],
  }),
  [FIXTURE_IDS.doneRun]: detailOf({
    seed: 3, panelKind: "run", title: "EID 10001573", status: "done",
    gate: NO_GATE,
    outcome: { state: "terminal", result: "verified-done", completedAt: at(39) },
    timeline: [
      { seed: 3, minute: 35, label: "searching", state: "done" },
      { seed: 3, minute: 36, label: "cross-verify", state: "done" },
      { seed: 3, minute: 37, label: "active-status", state: "done" },
      { seed: 3, minute: 38, label: "crm-dates", state: "done" },
    ],
  }),
  [FIXTURE_IDS.failedRun]: detailOf({
    seed: 4, panelKind: "run", title: "EID 10555001", status: "failed",
    gate: NO_GATE,
    outcome: { state: "terminal", result: "failed", completedAt: at(36) },
    timeline: [
      { seed: 4, minute: 33, label: "searching", state: "done" },
      { seed: 4, minute: 35, label: "cross-verify", state: "failed" },
    ],
  }),
  /*
    THE GATED RUN (ref write-safety §14.4, D226). The corpus has photographed this run's
    open-gate CARD since it was written and never served the section behind it,
    so the decision card drew no way to answer it and the ceremony was
    unphotographed. It advertises
    `identity-gate` now, and the section carries a packet built by the
    production fold — see `fixture-gate.ts` for why the shape is derived rather
    than authored.
  */
  [FIXTURE_IDS.openGateRun]: detailOf({
    seed: 5, panelKind: "run", title: "Blirea, Glaundi", status: "awaiting-approval",
    gate: { state: "open", gateId: uuidOf(105), label: "identity-review", openedAt: at(49), revision: 5 },
    outcome: STILL_RUNNING,
    timeline: [
      { seed: 5, minute: 47, label: "searching", state: "done" },
      { seed: 5, minute: 49, label: "gate:identity-review", state: "blocked" },
    ],
    sections: ["logs", "receipt", "context-data", "context-attempts", "identity-gate"],
  }),
  /*
    The SECOND ceremony, on a delegated member. The names on this one do not
    match at all — `T002173685`'s own shape — so `deriveApprovalShape` returns
    `type-the-eid` and the operator must state the EID rather than recognise it.
  */
  [FIXTURE_IDS.gateTypedEidRun]: detailOf({
    seed: 44, panelKind: "member", title: "Blirea, Glaundi", status: "awaiting-approval",
    gate: { state: "open", gateId: uuidOf(144), label: "identity-review", openedAt: at(24), revision: 44 },
    outcome: STILL_RUNNING,
    timeline: [
      { seed: 44, minute: 22, label: "searching", state: "done" },
      { seed: 44, minute: 24, label: "gate:identity-review", state: "blocked" },
    ],
    sections: ["logs", "receipt", "context-data", "context-attempts", "identity-gate"],
  }),
  /*
    THE PARKED WRITE (ref write-safety §4.1, W2). The one lifecycle whose ordinary
    controls are refused by name, and — until this reference existed — the one
    the corpus had never opened at all: the queue photographed its `blocked`
    row from the day the corpus was written, and nothing had ever asked what
    the panel behind it drew. A run is NOT terminal while a write is parked, so
    its outcome is absent with the reason and its receipt section is not
    advertised: a receipt states a settled verdict and this run has none.
  */
  [FIXTURE_IDS.parkedRun]: detailOf({
    seed: 6, panelKind: "run", title: "EID 10777012", status: "blocked",
    gate: NO_GATE,
    outcome: absent("a write to UCPath is fenced and unresolved; the run is stopped"),
    timeline: [
      { seed: 6, minute: 44, label: "searching", state: "done" },
      { seed: 6, minute: 45, label: "terminate", state: "blocked" },
    ],
    sections: ["logs", "context-data", "context-attempts", "parked-write"],
  }),
  [FIXTURE_IDS.memberRun]: detailOf({
    seed: 31, panelKind: "member", title: "Alvarez, Maria", status: "done",
    gate: NO_GATE,
    outcome: { state: "terminal", result: "verified-done", completedAt: at(32) },
    timeline: [
      { seed: 31, minute: 29, label: "searching", state: "done" },
      { seed: 31, minute: 30, label: "cross-verify", state: "done" },
      { seed: 31, minute: 31, label: "active-status", state: "done" },
      // The live exit run's exact shape (master plan §Phase 1): a conditional
      // node whose `when` was false. It is SKIPPED, never "cancelled".
      { seed: 31, minute: 32, label: "crm-dates", state: "skipped", notRunReason: "condition-false" },
    ],
  }),
  /*
    THE CATEGORICAL STRIP (D225), on the run it was written for.

    D225 exists because the composed separations graph drew eighteen truncated
    stubs, and the sweep is the only fixture run whose shape is a composed
    graph — so it is the one that carries `steps`. Every state the strip tones
    differently is here on purpose: `done` with a measurement, `done` whose
    category re-ran (the `×N` marker a gate park/resume produces, folded into
    ONE segment rather than drawn twice), `active`, `replayed` (D259 — EVERY
    member replayed, so no member and therefore no category has a duration to
    print), and `pending`. A strip photographed only in `done` would prove
    nothing about the four tones beside it.
  */
  [FIXTURE_IDS.groupOf13]: detailOf({
    seed: 70, panelKind: "group", title: "Separation audit — August", status: "partial",
    gate: NO_GATE, outcome: absent("members are still executing"),
    timeline: [
      { seed: 70, minute: 10, label: "fan-out", state: "done" },
      { seed: 70, minute: 14, label: "members", state: "active" },
    ],
    steps: [
      {
        label: "Identity check",
        state: "done",
        durationSec: 46,
        members: [
          { label: "Person lookup", state: "done", durationSec: 31 },
          { label: "Identity approval", state: "done", durationSec: 15 },
        ],
      },
      {
        label: "UCPath termination",
        state: "done",
        durationSec: 168,
        // The gate parked and resumed, so the `always-rerun` node executed
        // twice. It is ONE category with `×2`, not two segments.
        executions: 2,
        members: [
          { label: "Open the termination", state: "done", durationSec: 122 },
          { label: "Confirm the effective date", state: "done", durationSec: 46 },
        ],
      },
      {
        label: "Kuali finalization",
        state: "active",
        members: [{ label: "Finalize the separation document", state: "active" }],
      },
      {
        label: "Separation timecard",
        state: "replayed",
        // No `durationSec`: a replay emits no span, and `took 0s` is the exact
        // lie D259 removed from this surface.
        members: [
          { label: "Read the timecard", state: "replayed", replayedFrom: { attempt: 1, claimGeneration: 2 } },
          { label: "Close the pay period", state: "replayed", replayedFrom: { attempt: 1, claimGeneration: 2 } },
        ],
      },
      {
        label: "Separation document",
        state: "pending",
        members: [{ label: "File to OnBase", state: "pending" }],
      },
    ],
  }),
});


/* ── lazy sections ───────────────────────────────────────────────────────── */

interface NoteSeed {
  readonly level: "info" | "warning" | "error";
  readonly minute: number;
  readonly message: string;
}


/**
 * A LIVE combined log page, built the way the server builds one (D270 / L3).
 *
 * `buildRunSection`'s `logs` arm composes `rows` FIRST — one row per ordered
 * log entry, a note entry becoming a `kind: "note"` row whose `logId` is the
 * note's own id — and then derives `notes` from those rows as the exact
 * compatibility mirror. This fixture does the same, in that order, because the
 * live renderer (`logRowsOf` → `requireLiveLogRows`) reads `rows` and THROWS
 * when a live page omits them: a page authored the other way round is not a
 * thinner fixture, it is a screen that unmounts before anything is asserted.
 *
 * `rows` is optional on the wire only so a frozen archive written before this
 * vocabulary stays readable, which is why `NotePageSchema.parse` alone cannot
 * catch the omission — `requireLiveRows` below is the half that can.
 */
function notePageOf(seed: number, notes: readonly NoteSeed[]): z.infer<typeof NotePageSchema> {
  const rows = notes.map((note, index) => ({
    kind: "note" as const,
    logId: uuidOf(seed * 1000 + index + 1),
    sequence: index,
    note: {
      noteId: uuidOf(seed * 1000 + index + 1),
      runId: uuidOf(seed),
      sequence: index,
      at: at(note.minute, index),
      level: note.level,
      message: note.message,
    },
  }));
  return requireLiveRows(NotePageSchema.parse({
    runId: uuidOf(seed),
    rows,
    notes: rows.map((row) => row.note),
    nextCursor: { state: "absent", reason: "end-of-page" },
  }));
}


/**
 * Fail loud when an authored LIVE page carries the archive-only shape.
 *
 * Every page this adapter serves answers a live `?section=logs` query, so the
 * optional arm of the wire is never the right one here. Asserting it at the
 * point of authorship names the fixture; discovering it in the browser costs a
 * silent unmount and a theme assertion blaming the capture.
 */
function requireLiveRows(page: z.infer<typeof NotePageSchema>): z.infer<typeof NotePageSchema> {
  if (page.rows === undefined) {
    throw new Error(
      `fixture log page for run ${String(page.runId)} omits rows; a live log page must carry the `
      + "combined row vocabulary the renderer reads, and the notes-only shape belongs to frozen archives",
    );
  }
  return page;
}


/**
 * Adapter #1 authors payloads; it derives nothing. A receipt is DERIVED from
 * authority rows this adapter has none of (D141), so it truthfully serves an
 * absence with the reason — adapter #2, the seeded BFF over the real database,
 * is where a real receipt is exercised.
 */
const RECEIPT_MISSING = {
  state: "missing",
  reason: "this fixture adapter holds no authority rows to derive a receipt from",
} as const;


/** The failed run's record, in the strict already-redacted wire shape (D142). */
function failureDetail(runId: string, failureId: string, seed: number) {
  const summary = "cross-verify failed: subject mismatch between CRM and UCPath";
  return {
    runId,
    failureId,
    // D's current unresolved annotation; the seeded adapter derives the same control shape.
    resolution: {
      capability: { state: "available" },
      capture: { runId, failureId, resolution: { status: "unresolved", version: 1 } },
    },
    traceId: traceOf(seed),
    attempt: 1,
    workflowId: "person-lookup",
    nodeId: "cross-verify",
    taskId: "crm/read-onboarding-record",
    fingerprint: "e".repeat(64),
    code: "SUBJECT_MISMATCH",
    summary,
    transient: false,
    writeState: "not-attempted",
    subject: {
      state: "present",
      expected: { kind: "eid", digest: "1".repeat(64), displayRedacted: "\u2022\u2022\u2022\u20225001" },
      observed: { kind: "eid", digest: "2".repeat(64), displayRedacted: "\u2022\u2022\u2022\u20224136" },
    },
    page: {
      screen: "crm.onboarding",
      state: "crm.onboarding.record-ready",
      urlRedacted: "https://crm.example/onboarding/[redacted]",
      titleRedacted: "Onboarding record",
    },
    action: { operation: "read", sequence: 3 },
    causeChain: [{ code: "SUBJECT_MISMATCH", summary, role: "primary", transient: false }],
    remediation: [{
      kind: "operator-action",
      message: "Confirm which EID is correct at the source before re-running; nothing was written.",
    }],
    sameFingerprintSeen: 1,
    diagnosticBundle: {
      state: "present",
      bundleId: FIXTURE_DIAGNOSTIC_BUNDLE.bundleId,
    },
    occurredAt: at(35),
  };
}


/** A locked context-data row, the fixture's default (2i-C wire shape). */
type DataEntrySeed = {
  label: string;
  valueRedacted: string;
  edit?: Record<string, unknown>;
  /** W2: the fact's own provenance, when the producing checkpoint carried one. */
  observedAt?: string;
  source?: "live" | "derived" | "operator";
  correctedAt?: string;
};


const LOCKED_NOT_DECLARED = {
  state: "locked",
  reason: "not declared correctable by this workflow",
} as const;


/**
 * The parked write, in the durable facts the real query projects (ref write-safety §4.1).
 *
 * Adapter #1 AUTHORS this payload, and `sectionsOf` parses every section it
 * returns through `RunDetailSectionResponseSchema` — so the bytes the corpus
 * photographs are bytes the real wire would accept, including the schema's own
 * `superRefine`: `parkedAt` may not precede `fencedAt`, and EVERY served action
 * must target this exact intent and generation. A hand-rolled blob that drifted
 * from either would fail here rather than in a screenshot.
 *
 * The two action descriptors are the server's, word for word
 * (`parkedWriteActions` in `src/server/dashboard/queries/run-detail.ts`). They
 * are copied rather than imported because that function is not exported and
 * takes an authority `RunRecord` this adapter has none of — so the copy is
 * PINNED to the server's, modulo the identities the two adapters legitimately
 * differ on, by `tests/unit/server/parked-write-section.test.ts`. A copy nobody
 * compares is a reference that documents last month's copy.
 */
const PARKED_WRITE_INTENT_ID = uuidOf(906);

const PARKED_WRITE_TARGET = { writeIntentId: PARKED_WRITE_INTENT_ID, intentGeneration: 1 };

const PARKED_WRITE_SYSTEM = "ucpath";

const PARKED_WRITE_REVISION = 6;


export const FIXTURE_PARKED_WRITE = {
  runId: FIXTURE_IDS.parkedRun,
  writeIntentId: PARKED_WRITE_INTENT_ID,
  generation: 1,
  runAttempt: 1,
  system: PARKED_WRITE_SYSTEM,
  taskId: "ucpath/terminate-person",
  idempotencyKeyDigest: "7".repeat(64),
  fencedAt: at(44),
  parkedAt: at(45),
  parkedCode: "unknown",
  // The wire's repository-authored projection. Authority retains the original
  // park evidence; a driver reason and its person-bearing text never cross here.
  parkedMessage: `Write intent ${PARKED_WRITE_INTENT_ID} is parked (unknown) for `
    + `${idempotencyKeyDigestReference("7".repeat(64))}. Verify the target system, then use one typed resolution.`,
  subject: {
    state: "subject-match",
    proofId: uuidOf(907),
    observedAt: at(44),
    evidence: {
      kind: "person",
      identifierKind: "eid",
      bindingDigest: "3".repeat(64),
      displaySuffix: "7012",
    },
  },
  /**
   * D245 — what a confirmed-present resolution has to carry. The server derives
   * this from the commit contract's own `completion.proofSchema`
   * (`describeProofShape`); this adapter states the same shape by hand for the
   * fixture's own `ucpath/terminate-person`, mirroring the real
   * `UcpathTerminationProofSchema`: two literals the schema pins, an EID and a
   * date under their own patterns, the receipt, the closed approval-status
   * vocabulary, and the name the page displayed.
   *
   * Photographing the SERVED arm rather than the `unavailable` one is
   * deliberate. Before D245 this reference recorded the present arm as a
   * disabled control with a refusal — which is exactly the corpus-records-a-
   * defect shape D187 found — and a parked run in the shipped build now gets
   * the form.
   */
  proofContract: {
    state: "served",
    commitTaskId: "ucpath/terminate-person",
    completionKind: "save-verify",
    schemaHash: "c".repeat(64),
    fields: [
      { kind: "fixed", path: "kind", value: "ucpath-termination" },
      { kind: "text", path: "emplId", pattern: "^10\\d{6}$", serverOnlyRules: false },
      {
        kind: "text",
        path: "effectiveDate",
        pattern: "^(0[1-9]|1[0-2])/(0[1-9]|[12]\\d|3[01])/\\d{4}$",
        serverOnlyRules: false,
      },
      { kind: "text", path: "transactionId", pattern: "^T\\d{6,}$", serverOnlyRules: false },
      {
        kind: "choice",
        path: "approvalStatus",
        options: ["Approved", "Denied", "Error", "Manually Processed", "Pending", "Pushed Back"],
      },
      { kind: "text", path: "displayedName", minLength: 1, serverOnlyRules: false },
      { kind: "fixed", path: "source", value: "ss-smart-hr-detail-read" },
    ],
  },
  actions: [
    {
      key: "resolve-write-present",
      label: "I confirmed it IS there",
      detail: "Record the transaction you found, with its proof. The run settles as committed and never clicks again.",
      intent: "warning",
      icon: "resolve",
      placement: ["banner", "footer"],
      kind: "command",
      command: "resolve-write-present",
      expectedVersion: PARKED_WRITE_REVISION,
      confirm: {
        title: "Confirm the transaction exists",
        body: `This files ${PARKED_WRITE_SYSTEM} transaction ${PARKED_WRITE_INTENT_ID} as committed on this run's `
          + "evidence. If it is not actually there, the run finishes reporting work nobody did.",
        confirmLabel: "It is there",
        tone: "destructive",
      },
      writeTarget: PARKED_WRITE_TARGET,
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
      expectedVersion: PARKED_WRITE_REVISION,
      confirm: {
        title: "Confirm the transaction is absent",
        body: `This authorizes a fresh attempt against ${PARKED_WRITE_SYSTEM}. If the transaction does exist, `
          + "the retry submits it a SECOND time.",
        confirmLabel: "It is not there",
        tone: "destructive",
      },
      writeTarget: PARKED_WRITE_TARGET,
    },
  ],
} as const;


function sectionsOf(
  seed: number,
  notes: readonly NoteSeed[],
  dataEntries: readonly DataEntrySeed[],
  failureId?: string,
  editing?: Record<string, unknown>,
  parkedWrite?: unknown,
  identityGate?: unknown,
  receipt?: unknown,
): Readonly<Record<string, RunDetailSectionResponse>> {
  const runId = uuidOf(seed);
  const sections: Record<string, unknown> = {
    logs: { section: "logs", payload: notePageOf(seed, notes) },
    receipt: {
      section: "receipt",
      payload: receipt === undefined ? RECEIPT_MISSING : { state: "available", value: receipt },
    },
    "context-data": {
      section: "context-data",
      payload: {
        runId,
        editing: editing ?? {
          state: "locked",
          reason: "run is terminal; corrections apply only to a non-executing resumable run",
        },
        entries: dataEntries.map((entry) => ({
          label: entry.label,
          valueRedacted: entry.valueRedacted,
          edit: entry.edit ?? LOCKED_NOT_DECLARED,
          // OMITTED, never nulled — the wire's members are optional and an
          // absent one is what "this build cannot date this value" looks like.
          ...(entry.observedAt === undefined ? {} : { observedAt: entry.observedAt }),
          ...(entry.source === undefined ? {} : { source: entry.source }),
          ...(entry.correctedAt === undefined ? {} : { correctedAt: entry.correctedAt }),
        })),
      },
    },
    "context-attempts": {
      section: "context-attempts",
      payload: {
        runId,
        entries: [{ label: "Attempt 1", valueRedacted: `${at(30)} · this attempt` }],
      },
    },
  };
  if (failureId !== undefined) {
    sections.failure = {
      section: "failure",
      payload: { state: "available", value: failureDetail(runId, failureId, seed) },
    };
  }
  if (parkedWrite !== undefined) {
    sections["parked-write"] = { section: "parked-write", payload: parkedWrite };
  }
  if (identityGate !== undefined) {
    // Wrapped in the wire's own resource envelope: the section is
    // `wireResourceSchema(IdentityGateDetailWireSchema)`, so the corpus serves
    // an `available` arm and the panel's `missing`/`error` arms stay reachable
    // for a build that cannot describe a gate.
    sections["identity-gate"] = {
      section: "identity-gate",
      payload: { state: "available", value: identityGate },
    };
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(sections).map(([name, value]) => [name, RunDetailSectionResponseSchema.parse(value)]),
  ));
}


/**
 * THE TWO NAME-ONLY GATED PACKETS (ref write-safety §14.4/§14.6, D226).
 *
 * Their ceremonies are DERIVED — `buildFixtureIdentityGate` feeds real inputs
 * to the production fold and `deriveApprovalShape` decides. The only thing that
 * differs between them is the document's own spelling of the name. Both derive
 * the strict `type-the-eid` shape because the EID came from a name search; the
 * second also carries a name disagreement.
 */
export const FIXTURE_IDENTITY_GATE = buildFixtureIdentityGate({
  runId: FIXTURE_IDS.openGateRun,
  gateId: GATE_NODE_ID,
  label: "Identity Approval",
  parkedAt: at(49),
  resumeAt: "approval",
  expectedVersion: 5,
  observedAt: at(48),
  // The names agree, but the EID came from the name search, so approval still
  // requires the typed-EID ceremony.
  documentName: "Blirea, Glaundi",
});


export const FIXTURE_IDENTITY_GATE_TYPED_EID = buildFixtureIdentityGate({
  runId: FIXTURE_IDS.gateTypedEidRun,
  gateId: GATE_NODE_ID,
  label: "Identity Approval",
  parkedAt: at(24),
  resumeAt: "approval",
  expectedVersion: 44,
  observedAt: at(23),
  // The names do not match at all — `T002173685`'s shape — so the riskiest
  // ceremony applies and the EID is typed rather than recognised.
  documentName: "Okonkwo, Adaeze",
});


export const FIXTURE_SECTIONS: Readonly<Record<string, Readonly<Record<string, RunDetailSectionResponse>>>> = Object.freeze({
  // The 2i-C showcase: a RETRY-queued run — resumable, unclaimed, with the
  // prior attempt's recorded checkpoints — is the one state where the merged
  // Data/Edit-Data surface is genuinely editable. One row editable at rest,
  // one carrying a staged correction. (The open-gate run cannot host this:
  // its seeded twin is CLAIMED while its gate is open, so both adapters
  // render it locked.)
  [FIXTURE_IDS.queuedRun]: sectionsOf(1, [
    { level: "info", minute: 55, message: "Run queued at interactive priority" },
  ], [
    // W2: the same two rows now carry the provenance the wire serves — one a
    // plain live read (clock only, no badge, because `live` is what most rows
    // are and a badge on every row is a badge on none) and one an operator
    // correction, which is the row the `corrected` badge exists for.
    {
      label: "Starts on",
      valueRedacted: "2026-07-15",
      edit: {
        state: "editable",
        nodeId: "crm-dates",
        fieldPath: "startsOn.value",
        value: "2026-07-15",
        pendingCorrection: { state: "none" },
      },
      observedAt: at(51),
      source: "live",
    },
    {
      label: "Invited on",
      valueRedacted: "2026-06-01",
      edit: {
        state: "editable",
        nodeId: "crm-dates",
        fieldPath: "invitedOn.value",
        value: "2026-06-01",
        pendingCorrection: { state: "pending", value: "2026-06-02", correctedAt: at(50) },
      },
      observedAt: at(50),
      source: "operator",
      correctedAt: at(50),
    },
  ], undefined, { state: "editable", expectedVersion: 2 }),
  [FIXTURE_IDS.runningRun]: sectionsOf(2, [
    { level: "info", minute: 52, message: "Searching UCPath directory for Battistessa, Johnnie" },
    { level: "info", minute: 53, message: "2 candidates returned from person search" },
    { level: "info", minute: 54, message: "Selecting the exact name match" },
  ], [
    { label: "Selection", valueRedacted: "exact-match" },
    { label: "Active status", valueRedacted: "pending" },
  ], undefined, {
    state: "locked",
    reason: "the run is claimed by a worker — the resume consumes corrections and wins races; "
      + "editing reopens when it parks or finishes",
  }),
  [FIXTURE_IDS.doneRun]: sectionsOf(3, [
    { level: "info", minute: 35, message: "Searching UCPath directory for EID 10001573" },
    { level: "info", minute: 36, message: "Cross-verified against the CRM onboarding record" },
    { level: "info", minute: 37, message: "Active status resolved: active" },
    { level: "info", minute: 38, message: "CRM onboarding dates recorded" },
  ], [
    { label: "Selection", valueRedacted: "exact-match" },
    { label: "Active status", valueRedacted: "active" },
  ]),
  [FIXTURE_IDS.failedRun]: sectionsOf(4, [
    { level: "info", minute: 33, message: "Searching UCPath directory for EID 10555001" },
    { level: "warning", minute: 34, message: "CRM record name disagrees with the UCPath name" },
    { level: "error", minute: 35, message: "cross-verify failed: subject mismatch between CRM and UCPath" },
    { level: "error", minute: 36, message: "Run failed at cross-verify; nothing was written" },
  ], [
    { label: "Selection", valueRedacted: "exact-match" },
    { label: "Active status", valueRedacted: "not-reached" },
  ], FIXTURE_IDS.failureId),
  [FIXTURE_IDS.openGateRun]: sectionsOf(5, [
    { level: "info", minute: 47, message: "Searching UCPath directory for Blirea, Glaundi" },
    { level: "warning", minute: 48, message: "Two candidates share the name Blirea, Glaundi" },
    { level: "info", minute: 49, message: "identity-review gate opened for candidate selection" },
  ], [
    { label: "Selection", valueRedacted: "ambiguous (2 candidates)" },
    { label: "Active status", valueRedacted: "pending" },
  ], undefined, {
    // The seeded twin of this run is CLAIMED while its gate is open, so both
    // adapters must render the same locked shape (dual-adapter structure).
    state: "locked",
    reason: "the run is claimed by a worker — the resume consumes corrections and wins races; "
      + "editing reopens when it parks or finishes",
  }, undefined, FIXTURE_IDENTITY_GATE),
  [FIXTURE_IDS.gateTypedEidRun]: sectionsOf(44, [
    { level: "info", minute: 22, message: "Searching UCPath directory for Blirea, Glaundi" },
    { level: "warning", minute: 23, message: "The UCPath detail displays a different name for this EID" },
    { level: "info", minute: 24, message: "identity-review gate opened; the EID must be typed" },
  ], [
    { label: "Selection", valueRedacted: "name mismatch" },
    { label: "Active status", valueRedacted: "pending" },
  ], undefined, {
    state: "locked",
    reason: "the run is claimed by a worker — the resume consumes corrections and wins races; "
      + "editing reopens when it parks or finishes",
  }, undefined, FIXTURE_IDENTITY_GATE_TYPED_EID),
  [FIXTURE_IDS.parkedRun]: sectionsOf(6, [
    { level: "info", minute: 44, message: "Searching UCPath directory for EID 10777012" },
    { level: "info", minute: 44, message: "Subject bound: the termination page names the expected EID" },
    { level: "warning", minute: 45, message: "Save submitted; the confirmation page did not render" },
    { level: "warning", minute: 45, message: "Write fenced at generation 1; the run is parked pending proof" },
  ], [
    { label: "Selection", valueRedacted: "exact-match", observedAt: at(44), source: "live" },
    { label: "Termination reason", valueRedacted: "Resign - No Reason Given", observedAt: at(44), source: "derived" },
  ], undefined, {
    // Ref dashboard-surfaces D19: a parked run is not executing, but it is not resumable by a
    // correction either — the kernel's own arm says so, so the fixture does.
    state: "locked",
    reason: "run is parked-write; corrections apply only to a non-executing resumable run",
  }, FIXTURE_PARKED_WRITE),
  [FIXTURE_IDS.memberRun]: sectionsOf(31, [
    { level: "info", minute: 29, message: "Searching UCPath directory for Alvarez, Maria" },
    { level: "info", minute: 31, message: "Active status resolved: active" },
  ], [
    { label: "Selection", valueRedacted: "exact-match" },
    { label: "Active status", valueRedacted: "active" },
  ]),
  [FIXTURE_IDS.groupOf13]: sectionsOf(70, [
    { level: "info", minute: 10, message: "Fan-out planned 13 member lookups" },
    { level: "warning", minute: 13, message: "2 members failed cross-verification" },
  ], [
    { label: "Selection", valueRedacted: "13 members" },
    { label: "Active status", valueRedacted: "mixed" },
  ]),
});
