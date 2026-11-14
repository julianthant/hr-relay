import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { DashboardDayWireSchema, QueueSurfaceWireSchema, type StepInterruptWire } from "../../../../src/models/dashboard/projection.js";
import { RunDetailWireSchema, RunDetailSectionResponseSchema } from "../../../../src/models/dashboard/run-detail.js";
import { ApplicationLifecycleSchema } from "../../../../src/models/dashboard/application-lifecycle.js";
import { PublicProfileStateSchema } from "../../../../src/models/profiles/public-profile.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { queueRowActions } from "../../../../src/backend/runs/projections/queue-row-actions.js";
import { FIXTURE_DAY_WIRE, FIXTURE_IDS } from "../../fixtures/dashboard/fixture-queue.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "../../fixtures/dashboard/fixture-start.js";
import { separationsDescriptor } from "../registered-workflows.js";
import { TERMINATION_NODE, UCPATH_TRANSACTION_STEP } from "../../../../src/workflows/separations/steps/ucpath-transaction/step.js";
import { FIXTURE_NOW, uuidOf } from "../../fixtures/dashboard/fixture-identity.js";

// The mock runner loads this file in Node. status-model pulls in the CSS token sheet.
function servedInterruptLabel(interrupt: StepInterruptWire | undefined): string | undefined {
  if (interrupt?.step === "finish-write") return "Finishing the save first";
  if (interrupt?.action === "pause") return "This step will restart";
  if (interrupt?.action === "stop") return "This step is cancelled";
  return undefined;
}

export const PICKED_RUN_STATES = ["running", "pausing", "paused", "resuming", "pause-all", "quit-confirm", "quitting", "after-crash"] as const;
export const PICKED_SAFETY_STATES = ["captures", "before-after", "pre-submit-failed", "post-submit-unknown", "post-submit-proved", "dry-run"] as const;
export const PICKED_SIGNUP_STATES = ["details", "duo-setup", "touch-pending", "virtual", "key-next", "both-added", "cancel-confirm"] as const;
export type PickedRunState = (typeof PICKED_RUN_STATES)[number] | (typeof PICKED_SAFETY_STATES)[number];

export function pickedSignupState(state: (typeof PICKED_SIGNUP_STATES)[number]) {
  if (state === "details") return PublicProfileStateSchema.parse({ state: "signed-out", signUpRequired: true });
  const idle = { state: "idle", ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
  const complete = { state: "complete", ceremonyObserved: true, portalAccepted: true, operatorConfirmed: true, exactCredentialRequestObserved: true };
  return PublicProfileStateSchema.parse({ browser: { state: "open" as const, generation: 1 }, state: "onboarding", operationId: uuidOf(960), profileId: uuidOf(961), step: state === "both-added" ? "ready" : "duo",
    methods: { key: state === "both-added" ? complete : idle,
      touch: state === "both-added" || state === "key-next" ? complete : state === "touch-pending" ? { ...idle, state: "pending", attemptId: uuidOf(962) }
        : state === "virtual" ? { ...idle, platformAuthenticator: "chromium-platform" } : idle } });
}

export function pickedRunWorld(state: PickedRunState) {
  const original = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.runId === FIXTURE_IDS.runningRun);
  if (original === undefined) throw new Error("picked running fixture missing");
  const safety = PICKED_SAFETY_STATES.some(candidate => candidate === state);
  const nodeId = safety ? TERMINATION_NODE : "searching", categoryKey = safety ? UCPATH_TRANSACTION_STEP.key : "searching";
  const paused = state === "paused" || state === "pause-all";
  const pending = state === "pausing" || state === "quitting";
  const terminal = state === "after-crash" || state === "captures" || state === "before-after" || state === "pre-submit-failed" || state === "post-submit-proved" || state === "dry-run";
  const unknownWrite = state === "post-submit-unknown";
  const status = state === "after-crash" || state === "pre-submit-failed" || state === "post-submit-proved" ? "failed"
    : unknownWrite ? "blocked" : terminal ? "done" : state === "resuming" ? "queued" : "running";
  const pauseControl = { state: terminal || unknownWrite ? "unavailable" as const : paused ? "paused" as const : pending ? "pause-pending" as const : "running" as const,
    expectedVersion: PositiveIntSchema.parse(original.rowRevision), ...(terminal || unknownWrite ? {} : { command: paused || pending ? "resume" as const : "pause" as const }) };
  const interrupt = state === "quitting" ? { action: "pause" as const, step: "finish-write" as const }
    : pending ? { action: "pause" as const, step: "cancel" as const } : undefined;
  const interruptLabel = servedInterruptLabel(interrupt);
  const row = QueueSurfaceWireSchema.parse({ ...original, ...(safety ? { workflowId: separationsDescriptor.id, descriptorHash: separationsDescriptor.contractFingerprint, traceId: "sp-095200-0002" } : {}), status, pauseControl, dryRun: state === "dry-run",
    ...(paused || pending ? { pause: { state: paused ? "paused" : "requested", commandId: uuidOf(963), requestedAt: FIXTURE_NOW, ...(paused ? { pausedAt: FIXTURE_NOW } : {}) } } : {}),
    ...(interrupt === undefined ? {} : { interrupt }),
    pipeline: safety ? [{ id: categoryKey, label: UCPATH_TRANSACTION_STEP.label, state: status === "done" ? "done" : status === "failed" ? "failed" : unknownWrite ? "blocked" : "active" }] : original.pipeline.map(stage => ({ ...stage, state: status === "failed" && stage.state === "active" ? "failed" : stage.state })),
    endedAt: terminal ? { state: "present", value: FIXTURE_NOW } : { state: "absent", reason: "The run is not terminal." },
    liveMessage: { state: "present", value: state === "after-crash" ? "Relay closed during Searching. Rerun continues after authenticated completed steps."
      : interruptLabel ?? (paused ? "Pause recorded. Resume to continue." : unknownWrite ? "Write outcome unknown. Check UCPath without submitting again."
        : terminal ? "Recorded workflow result" : "Searching UCPath") },
    actions: queueRowActions(STANDARD_WORKFLOW_ACTIONS, { status, rowRevision: original.rowRevision, pauseControl,
      ...(state === "after-crash" ? { recoverySource: "failed", crashed: true } : {}), dryRun: state === "dry-run", isChild: false, parkedWrite: unknownWrite,
      memberCount: 0, isMember: false, named: false, hasReviewPanel: false }) });
  const statusCounts = [{ status, count: 1 }];
  const day = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH, queueSurfaces: [row], attemptHistory: [{ runId: row.runId, startedAt: row.startedAt, endedAt: row.endedAt }],
    monthCounts: [{ day: FIXTURE_DAY_WIRE.day, count: 1 }], workflowCounts: [{ workflowId: row.workflowId, count: 1, statusCounts }], statusCounts,
    workerCards: [], workerPools: [], workerAuthority: { state: "present", members: [] }, notifications: [] });
  const native = (order: number) => ({ eventId: uuidOf(970 + order), order, runId: row.runId, attempt: row.attempt,
    traceId: row.traceId, nodeId, spanPath: `${row.traceId}/${nodeId}#1` });
  const sessionId = uuidOf(964);
  const image = new PNG({ width: 850, height: 300 });
  for (let pixel = 0; pixel < image.data.length; pixel += 4) {
    const y = Math.floor(pixel / 4 / image.width);
    image.data[pixel] = y < 30 ? 35 : 245; image.data[pixel + 1] = y < 30 ? 60 : 246;
    image.data[pixel + 2] = y < 30 ? 95 : 248; image.data[pixel + 3] = 255;
  }
  const bytes = PNG.sync.write(image);
  const shot = (order: number, boundary: "step" | "before-submit" | "after-submit") => {
    const bundleId = uuidOf(980 + order), artifactId = uuidOf(990 + order);
    const note = { native: native(order), noteId: uuidOf(1000 + order), runId: row.runId, sequence: order,
      at: FIXTURE_NOW, level: "info", message: "Screenshot", screenshot: { bundleId, artifactId, sessionId } };
    return { note, artifactId, capture: { artifact: { artifactId, mediaKind: "image", mediaType: "image/png", sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.length, sensitivity: "safe", redaction: "not-required", width: 850, height: 300 },
      origins: [{ bundleId, originKind: "operator-request", capturedAt: FIXTURE_NOW, browserCapture: { nodeId, attempt: row.attempt, sessionId, boundary } }] } };
  };
  const before = shot(2, "before-submit"), after = shot(4, "after-submit");
  const capturePair = state === "before-after";
  const captures = capturePair ? [before, after] : state === "captures" ? [shot(2, "step")] : [];
  const note = { native: native(3), noteId: uuidOf(1003), runId: row.runId, sequence: 3, at: FIXTURE_NOW, level: "info", message: capturePair ? "Save and Submit" : "Read employee search",
    ...(capturePair ? { operatorAction: { kind: "click", label: "Save and Submit", sessionId } } : {}) };
  const failed = state === "pre-submit-failed" || state === "post-submit-unknown" || state === "post-submit-proved";
  const failureNote = { native: native(5), noteId: uuidOf(1005), runId: row.runId, sequence: 5, at: FIXTURE_NOW, level: "warning", message: "Screenshot capture unavailable.",
    fields: [{ key: "code", kind: "text", value: "BROWSER_SCREENSHOT_CAPTURE_FAILED" }, { key: "boundary", kind: "text", value: state === "pre-submit-failed" ? "before-submit" : "after-submit" }] };
  const notes = [...captures.map(capture => capture.note), note, ...(failed ? [failureNote] : [])].sort((left, right) => left.sequence - right.sequence);
  const logs = RunDetailSectionResponseSchema.parse({ section: "logs", payload: { runId: row.runId, notes,
    rows: notes.map(note => ({ kind: "note", native: note.native, logId: note.noteId, sequence: note.sequence, note })), nextCursor: { state: "absent", reason: "end-of-page" },
    ...(state === "dry-run" ? { dryRunPreview: { state: "available", coverage: "full", stages: [
      { id: "searching", label: "Search for employee", state: "exercised", detail: "Read and verified the sample employee.", sample: { label: "dry-run sample", value: "Sample employee" } },
      { id: "submit", label: "Save and Submit", state: "exercised", submitNotClicked: true, detail: "Filled and checked without submitting." },
    ] } } : {}) } });
  const captureSection = captures.length === 0 ? undefined : RunDetailSectionResponseSchema.parse({ section: "captures", payload: { runId: row.runId, artifacts: captures.map(capture => capture.capture) } });
  const failureSection = state !== "post-submit-proved" ? undefined : RunDetailSectionResponseSchema.parse({ section: "failure", payload: { state: "available", value: { runId: row.runId, traceId: row.traceId, attempt: row.attempt,
    workflowId: row.workflowId, nodeId, native: native(6), failureId: uuidOf(965), fingerprint: "a".repeat(64), code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", summary: "Screenshot capture unavailable.", transient: false,
    writeState: "verified", subject: { state: "absent", reason: "Fictional fixture" }, causeChain: [{ code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", summary: "Screenshot capture unavailable.", role: "primary", transient: false }],
    remediation: [{ kind: "operator-action", message: "Review recorded evidence." }], sameFingerprintSeen: 1, diagnosticBundle: { state: "absent", reason: "No diagnostic bundle" }, occurredAt: FIXTURE_NOW } } });
  const timelineState = status === "failed" ? "failed" : terminal ? "done" : unknownWrite ? "blocked" : "active";
  const detail = RunDetailWireSchema.parse({ runId: row.runId, rowRevision: row.rowRevision, panelKind: "run",
    header: { runId: row.runId, traceId: row.traceId, workflowId: row.workflowId, title: row.title, status, attempt: row.attempt },
    timeline: { steps: [{ key: categoryKey, label: capturePair ? "File termination" : "Search for employee", state: timelineState,
      members: [{ nodeId, categoryKey, label: "Read employee", state: timelineState }] }],
    events: [{ native: native(1), categoryKey, noteId: uuidOf(1001), sequence: 1, at: FIXTURE_NOW,
      label: "Read employee", state: timelineState, notRun: { state: "absent", reason: "This step ran" } }] },
    gate: { state: "absent", reason: "No gate" }, outcome: { state: "absent", reason: "Fictional receipt omitted" }, context: { dataFacts: 0, evidenceFacts: captures.length, attempts: 1 },
    captures: captures.length > 0 ? { state: "available", artifactCount: captures.length } : { state: "absent", reason: "No captures in this scenario" },
    availableSections: ["logs", ...(captures.length > 0 ? ["captures"] : []), ...(state === "post-submit-proved" ? ["failure"] : [])] });
  const lifecycle = ApplicationLifecycleSchema.parse({ runtimeGeneration: 1, state: "ready", pause: paused ? "paused" : pending ? "pause-pending" : "running", update: "installer-unavailable",
    targets: terminal ? [] : [{ runId: row.runId, expectedVersion: row.rowRevision, ...(row.pause === undefined ? {} : { pause: row.pause }), pauseUnavailable: unknownWrite }] });
  return { bootstrap: FIXTURE_START_PICKER_BOOTSTRAP, row, day, detail, logs, captureSection, failureSection, lifecycle, bytes, artifactIds: captures.map(capture => capture.artifactId) };
}
