/** The pure half of automatic diagnostic capture: three facts live here because they must be identical for the capture path and the purge sweep. */
import { z } from "zod";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import {
  ActorIdSchema,
  DiagnosticBundleIdSchema,
  FailureIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  RunIdSchema,
} from "../../rules/identity/ids.js";
import { RedactionResultSchema } from "../../rules/redaction/redaction.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
import { DiagnosticAttachmentSchema, DiagnosticBundleSchema } from "./diagnostic.js";

/** Notes retain 30 days and an ordinary bundle follows notes retention unless pinned; one constant, one meaning. */
export const DIAGNOSTIC_ORDINARY_RETENTION_DAYS = 30;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** The exact trigger sentence: on an unexpected state, task failure, subject mismatch, recovery park, or operator-requested snapshot — nothing else may mint a bundle. */
export const DiagnosticCaptureTriggerSchema = z.enum([
  "unexpected-state",
  "task-failure",
  "subject-mismatch",
  "recovery-park",
  "operator-request",
]);
export type DiagnosticCaptureTrigger = z.infer<typeof DiagnosticCaptureTriggerSchema>;

/** The trigger decides the stored origin arm; the mapping is written once rather than at each call site, because one trigger name changes shape on the way in. */
const ORIGIN_KIND_OF_TRIGGER = Object.freeze({
  "unexpected-state": "unexpected-state",
  "task-failure": "failure",
  "subject-mismatch": "subject-mismatch",
  "recovery-park": "recovery-park",
  "operator-request": "operator-request",
} as const satisfies Record<DiagnosticCaptureTrigger, string>);

export const DiagnosticCaptureOriginSchema = DiagnosticBundleSchema.shape.origin;

/** A capture names EITHER the failure it explains or the operator who asked for it; refusing here means a mis-triggered capture fails before an artifact is written. */
export function diagnosticOriginOfTrigger(input: Readonly<{
  trigger: unknown;
  failureId?: unknown;
  requestedBy?: unknown;
}>): z.infer<typeof DiagnosticCaptureOriginSchema> {
  const trigger = DiagnosticCaptureTriggerSchema.parse(input.trigger);
  const kind = ORIGIN_KIND_OF_TRIGGER[trigger];
  if (kind === "operator-request") {
    if (input.requestedBy === undefined) {
      throw new Error("an operator-requested diagnostic capture must name the requesting actor");
    }
    if (input.failureId !== undefined) {
      throw new Error("an operator-requested diagnostic capture names no failure");
    }
    return DiagnosticCaptureOriginSchema.parse({
      kind,
      requestedBy: ActorIdSchema.parse(input.requestedBy),
    });
  }
  if (input.failureId === undefined) {
    throw new Error(`a ${trigger} diagnostic capture must name the failure it explains`);
  }
  if (input.requestedBy !== undefined) {
    throw new Error(`a ${trigger} diagnostic capture is automatic and names no requesting actor`);
  }
  return DiagnosticCaptureOriginSchema.parse({ kind, failureId: FailureIdSchema.parse(input.failureId) });
}

export const DiagnosticPinReasonSchema = DiagnosticBundleSchema.shape.retention.options[1].shape.reason;

export const DiagnosticRetentionRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ordinary") }),
  z.strictObject({ kind: z.literal("pinned"), reason: DiagnosticPinReasonSchema }),
]);

export const DiagnosticRetentionSchema = DiagnosticBundleSchema.shape.retention;

/** An ordinary bundle's purge instant is derived from its OWN capture instant, never from wall-clock now at sweep time, so a late sweep cannot extend expired data. */
export function planDiagnosticRetention(input: Readonly<{
  capturedAt: unknown;
  request: unknown;
  retentionDays?: number;
}>): z.infer<typeof DiagnosticRetentionSchema> {
  const capturedAt = IsoInstantSchema.parse(input.capturedAt);
  const request = DiagnosticRetentionRequestSchema.parse(input.request);
  if (request.kind === "pinned") {
    return DiagnosticRetentionSchema.parse({ kind: "pinned", reason: request.reason });
  }
  const days = z.number().int().positive().parse(input.retentionDays ?? DIAGNOSTIC_ORDINARY_RETENTION_DAYS);
  const captured = Date.parse(capturedAt);
  if (!Number.isFinite(captured)) throw new Error(`diagnostic capture instant ${capturedAt} is not a real instant`);
  return DiagnosticRetentionSchema.parse({
    kind: "ordinary",
    purgeAfter: new Date(captured + days * MILLISECONDS_PER_DAY).toISOString(),
  });
}

/** Content addressing over the exact facts the bundle publishes; the digest covers the REDACTED payload, so two captures of the same failure with the same evidence agree. */
export function deriveDiagnosticContentDigest(input: Readonly<{
  runId: unknown;
  origin: unknown;
  capturedAt: unknown;
  configFingerprint: unknown;
  descriptorFingerprint: unknown;
  redaction: unknown;
  attachments: unknown;
  operation?: unknown;
}>): string {
  return FingerprintSchema.parse(sha256Hex(`hrauto:diagnostic-bundle:v1\0${canonicalJsonStringify({
    runId: RunIdSchema.parse(input.runId),
    origin: DiagnosticCaptureOriginSchema.parse(input.origin),
    capturedAt: IsoInstantSchema.parse(input.capturedAt),
    configFingerprint: FingerprintSchema.parse(input.configFingerprint),
    descriptorFingerprint: FingerprintSchema.parse(input.descriptorFingerprint),
    redaction: RedactionResultSchema.parse(input.redaction),
    attachments: z.array(DiagnosticAttachmentSchema).parse(input.attachments),
    ...(input.operation === undefined ? {} : { operation: DiagnosticBundleSchema.shape.operation.unwrap().parse(input.operation) }),
  })}`));
}

/** Parse the retained capture values before they become durable evidence. */
export function assertDiagnosticExportSafe(redactionInput: unknown): z.infer<typeof RedactionResultSchema> {
  return RedactionResultSchema.parse(redactionInput);
}

/* ── retention sweep ─────────────────────────────────────────────────────── */

export const DiagnosticSweepDispositionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("purge"), bundleId: DiagnosticBundleIdSchema, purgeAfter: IsoInstantSchema }),
  z.strictObject({ state: z.literal("retain-live"), bundleId: DiagnosticBundleIdSchema, purgeAfter: IsoInstantSchema }),
  z.strictObject({ state: z.literal("retain-pinned"), bundleId: DiagnosticBundleIdSchema, reason: DiagnosticPinReasonSchema }),
]);
export type DiagnosticSweepDisposition = z.infer<typeof DiagnosticSweepDispositionSchema>;

/** One decision per bundle, with no hidden third state: pinned retains for its named reason, ordinary purges exactly when its own `purgeAfter` has passed, and anything else is still live. */
export function planDiagnosticSweep(input: Readonly<{
  now: unknown;
  bundles: readonly z.infer<typeof DiagnosticBundleSchema>[];
}>): readonly DiagnosticSweepDisposition[] {
  const now = Date.parse(IsoInstantSchema.parse(input.now));
  if (!Number.isFinite(now)) throw new Error("diagnostic sweep requires a real instant");
  return Object.freeze(input.bundles.map((bundle) => {
    if (bundle.retention.kind === "pinned") {
      return DiagnosticSweepDispositionSchema.parse({
        state: "retain-pinned",
        bundleId: bundle.bundleId,
        reason: bundle.retention.reason,
      });
    }
    const purgeAfter = bundle.retention.purgeAfter;
    return DiagnosticSweepDispositionSchema.parse({
      state: Date.parse(purgeAfter) <= now ? "purge" : "retain-live",
      bundleId: bundle.bundleId,
      purgeAfter,
    });
  }));
}
