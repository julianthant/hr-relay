/**
 * Durable phone-capture authority (doc 06 §5.1, D79d trim, D167).
 *
 * Capture is an input-acquisition service, not a workflow and not an
 * in-memory callback — legacy's open sessions died with the dashboard
 * process, and its fire-and-forget finalize could return success and lose
 * the handoff. Two durability obligations survive the D79d trim and this
 * module owns their shapes: the SESSION (an open session survives a
 * restart) and the FINALIZE OUTBOX (bundle → register → enqueue either
 * succeeds visibly or fails visibly, replayed by stable key after a crash).
 *
 * `tokenDigest` is deliberately the DIGEST: the raw phone token is a
 * credential and never lands in a durable row, a log, or a projection.
 */
import { z } from "zod";
import { ArtifactRefSchema } from "./artifacts.js";
import {
  CapturePhotoIdSchema,
  CaptureSessionIdSchema,
  FailureIdSchema,
  FingerprintSchema,
  IntakeManifestIdSchema,
  IsoInstantSchema,
  OutboxIdSchema,
  PositiveIntSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from "./ids.js";

export const CaptureSessionStateSchema = z.enum([
  "open", "finalizing", "finalized", "failed", "discarded", "expired",
]);
export type CaptureSessionState = z.infer<typeof CaptureSessionStateSchema>;

/** One immutable photo: converted bytes behind a whole ArtifactRef (D161's rule). */
export const CapturePhotoRefSchema = z.strictObject({
  photoId: CapturePhotoIdSchema,
  artifact: ArtifactRefSchema,
  ordinal: PositiveIntSchema,
  originalMediaType: z.string().min(1),
});
export type CapturePhotoRef = z.infer<typeof CapturePhotoRefSchema>;

export const CaptureHandoffSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("pending") }),
  z.strictObject({
    state: z.literal("enqueued"),
    runId: RunIdSchema,
    intakeManifestId: IntakeManifestIdSchema,
  }),
  z.strictObject({ state: z.literal("failed"), failureId: FailureIdSchema }),
]);
export type CaptureHandoff = z.infer<typeof CaptureHandoffSchema>;

export const CaptureSessionSchema = z.strictObject({
  sessionId: CaptureSessionIdSchema,
  /** Digest only — the raw token never becomes durable state. */
  tokenDigest: FingerprintSchema,
  workflow: WorkflowIdSchema,
  formType: z.string().min(1).optional(),
  contextHint: z.string().min(1).optional(),
  state: CaptureSessionStateSchema,
  photoRefs: z.array(CapturePhotoRefSchema),
  finalArtifact: ArtifactRefSchema.optional(),
  handoff: CaptureHandoffSchema,
  /** 0 before the first finalize; retry-finalize mints the next generation. */
  finalizationGeneration: z.number().int().nonnegative(),
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  connectedAt: IsoInstantSchema.optional(),
  expiresAt: IsoInstantSchema,
}).superRefine((session, context) => {
  const photoIds = new Set(session.photoRefs.map((photo) => String(photo.photoId)));
  if (photoIds.size !== session.photoRefs.length) {
    context.addIssue({ code: "custom", path: ["photoRefs"], message: "photo ids must be unique" });
  }
  const ordinals = [...session.photoRefs.map((photo) => photo.ordinal)].sort((a, b) => a - b);
  for (const [index, ordinal] of ordinals.entries()) {
    if (ordinal !== index + 1) {
      context.addIssue({
        code: "custom",
        path: ["photoRefs"],
        message: "photo ordinals must be contiguous from 1 — order is meaning, not decoration",
      });
      break;
    }
  }
  if (session.state === "finalized") {
    if (session.finalArtifact === undefined) {
      context.addIssue({ code: "custom", path: ["finalArtifact"], message: "a finalized session names its bundle" });
    }
    if (session.handoff.state !== "enqueued") {
      context.addIssue({ code: "custom", path: ["handoff"], message: "a finalized session has an enqueued handoff" });
    }
  }
  if ((session.state === "finalizing" || session.state === "failed") && session.finalizationGeneration < 1) {
    context.addIssue({
      code: "custom",
      path: ["finalizationGeneration"],
      message: `state ${session.state} requires a finalization generation`,
    });
  }
  if (session.state === "failed" && session.handoff.state !== "failed") {
    context.addIssue({ code: "custom", path: ["handoff"], message: "a failed session records its failure handoff" });
  }
});
export type CaptureSession = z.infer<typeof CaptureSessionSchema>;

/**
 * One finalization attempt's durable outbox row. `stableKey` folds the
 * session, the generation, and the ordered photo digests — a crash replays
 * exactly this work, and a duplicate finalize of the same generation is the
 * same row, never a second handoff.
 */
export const CaptureFinalizationOutboxSchema = z.strictObject({
  outboxId: OutboxIdSchema,
  sessionId: CaptureSessionIdSchema,
  generation: PositiveIntSchema,
  stableKey: FingerprintSchema,
  orderedPhotoArtifacts: z.array(ArtifactRefSchema).min(1),
  workflow: WorkflowIdSchema,
  formType: z.string().min(1).optional(),
  state: z.enum(["pending", "done", "failed"]),
  finalArtifact: ArtifactRefSchema.optional(),
  runId: RunIdSchema.optional(),
  intakeManifestId: IntakeManifestIdSchema.optional(),
  failureId: FailureIdSchema.optional(),
  createdAt: IsoInstantSchema,
  settledAt: IsoInstantSchema.optional(),
}).superRefine((outbox, context) => {
  if (outbox.state === "done") {
    if (outbox.finalArtifact === undefined || outbox.runId === undefined || outbox.intakeManifestId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "a done finalization records its bundle, run, and manifest — success is never partial",
      });
    }
  }
  if (outbox.state === "failed" && outbox.failureId === undefined) {
    context.addIssue({ code: "custom", path: ["failureId"], message: "a failed finalization names its failure" });
  }
  if (outbox.state === "pending" && outbox.settledAt !== undefined) {
    context.addIssue({ code: "custom", path: ["settledAt"], message: "a pending row has not settled" });
  }
});
export type CaptureFinalizationOutbox = z.infer<typeof CaptureFinalizationOutboxSchema>;
