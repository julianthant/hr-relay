/**
 * Ref operator-trust §2.2 — the pure half of automatic diagnostic capture.
 *
 * Three facts live here because they must be identical for the capture path,
 * the retention sweep, and every test that pins either:
 *
 *  1. the CLOSED trigger set and its one-to-one mapping onto the stored
 *     `DiagnosticBundle.origin` arm — a bundle can only exist because one of
 *     ref operator-trust §2.2's five triggers fired, and the trigger is what decides
 *     whether a failure id or a requesting actor is mandatory;
 *  2. the retention plan — an ordinary bundle follows the D86 notes floor
 *     (30 days) computed from its own capture instant, and a pin is an
 *     explicit reason, never "keep it a bit longer";
 *  3. the sweep disposition — a closed union over (retention, now) so
 *     "this bundle is due" is a decision a test can pin without a database.
 *
 * Redaction is NOT re-implemented here: `src/domain/redaction.ts` owns it and
 * drops every unclassified field. This module only refuses to build a bundle
 * whose redaction result still carries something that must never be exported.
 */
import { z } from "zod";
import { canonicalJsonStringify } from "../canonical-json.js";
import {
  ActorIdSchema,
  DiagnosticBundleIdSchema,
  FailureIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  RunIdSchema,
} from "../ids.js";
import { RedactionResultSchema } from "../redaction.js";
import {
  EnvironmentSecretNameSchema,
  SecretFamilyNameSchema,
  SecretFileNameSchema,
} from "../secret-names.js";
import { sha256Hex } from "../sha256.js";
import { DiagnosticAttachmentSchema, DiagnosticBundleSchema } from "./diagnostic.js";

/**
 * D86 (ref dashboard-surfaces §10.4): notes retain 30 days, and ref operator-trust §2.2 says an ordinary
 * bundle "follows notes retention unless pinned". One constant, one meaning.
 */
export const DIAGNOSTIC_ORDINARY_RETENTION_DAYS = 30;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Ref operator-trust §2.2's exact trigger sentence: "On an unexpected state, task failure,
 * subject mismatch, recovery park, or operator-requested snapshot". Nothing
 * else may mint a bundle, and the union is what makes that checkable.
 */
export const DiagnosticCaptureTriggerSchema = z.enum([
  "unexpected-state",
  "task-failure",
  "subject-mismatch",
  "recovery-park",
  "operator-request",
]);
export type DiagnosticCaptureTrigger = z.infer<typeof DiagnosticCaptureTriggerSchema>;

/**
 * The trigger decides the stored origin arm. `task-failure` is the only name
 * that changes shape on the way in — ref operator-trust §2.1 calls the stored arm
 * `failure` — so the mapping is written once rather than at each call site.
 */
const ORIGIN_KIND_OF_TRIGGER = Object.freeze({
  "unexpected-state": "unexpected-state",
  "task-failure": "failure",
  "subject-mismatch": "subject-mismatch",
  "recovery-park": "recovery-park",
  "operator-request": "operator-request",
} as const satisfies Record<DiagnosticCaptureTrigger, string>);

export const DiagnosticCaptureOriginSchema = DiagnosticBundleSchema.shape.origin;

/**
 * A capture names EITHER the failure it explains or the operator who asked for
 * it. The stored table carries the same rule as a CHECK constraint; refusing
 * here means a mis-triggered capture fails before an artifact is written.
 */
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

/**
 * An ordinary bundle's purge instant is derived from its OWN capture instant,
 * never from wall-clock now at sweep time — otherwise a late sweep would keep
 * extending the life of data the retention floor already expired.
 */
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

/**
 * Content addressing over the exact facts the bundle publishes. The digest
 * covers the REDACTED payload, so two captures of the same failure with the
 * same evidence agree, and a capture whose redaction changed does not.
 */
export function deriveDiagnosticContentDigest(input: Readonly<{
  runId: unknown;
  origin: unknown;
  capturedAt: unknown;
  configFingerprint: unknown;
  descriptorFingerprint: unknown;
  redaction: unknown;
  attachments: unknown;
}>): string {
  return FingerprintSchema.parse(sha256Hex(`hrauto:diagnostic-bundle:v1\0${canonicalJsonStringify({
    runId: RunIdSchema.parse(input.runId),
    origin: DiagnosticCaptureOriginSchema.parse(input.origin),
    capturedAt: IsoInstantSchema.parse(input.capturedAt),
    configFingerprint: FingerprintSchema.parse(input.configFingerprint),
    descriptorFingerprint: FingerprintSchema.parse(input.descriptorFingerprint),
    redaction: RedactionResultSchema.parse(input.redaction),
    attachments: z.array(DiagnosticAttachmentSchema).parse(input.attachments),
  })}`));
}

const FORBIDDEN_EXPORT_KEYS: ReadonlySet<string> = new Set<string>([
  ...EnvironmentSecretNameSchema.options,
  "ngrokCredential",
  ...SecretFamilyNameSchema.options,
  ...SecretFileNameSchema.options,
  "cookie",
  "cookies",
  "storageState",
  "sessionStorage",
  "localStorage",
  "authorization",
  "password",
  "secret",
  "token",
  "credential",
  "credentials",
  "ssn",
  "socialSecurityNumber",
]);

/**
 * Redaction is schema-owned and drops what it cannot classify, so this is the
 * belt-and-braces arm ref guards-and-tests §3.10 asks for: a field that survived redaction
 * as an ALLOWED value may not be one of the names that must never leave the
 * machine. It fails the capture loudly rather than exporting the bundle.
 */
export function assertDiagnosticExportSafe(redactionInput: unknown): z.infer<typeof RedactionResultSchema> {
  const redaction = RedactionResultSchema.parse(redactionInput);
  for (const field of redaction.fields) {
    if (field.state !== "allowed") continue;
    if (FORBIDDEN_EXPORT_KEYS.has(field.key)) {
      throw new Error(`diagnostic capture refused: "${field.key}" can never be exported as a safe-diagnostic value`);
    }
  }
  return redaction;
}

/* ── retention sweep ─────────────────────────────────────────────────────── */

export const DiagnosticSweepDispositionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("purge"), bundleId: DiagnosticBundleIdSchema, purgeAfter: IsoInstantSchema }),
  z.strictObject({ state: z.literal("retain-live"), bundleId: DiagnosticBundleIdSchema, purgeAfter: IsoInstantSchema }),
  z.strictObject({ state: z.literal("retain-pinned"), bundleId: DiagnosticBundleIdSchema, reason: DiagnosticPinReasonSchema }),
]);
export type DiagnosticSweepDisposition = z.infer<typeof DiagnosticSweepDispositionSchema>;

/**
 * One decision per bundle, with no hidden third state: a pinned bundle is
 * retained for its named reason, an ordinary bundle is purged exactly when its
 * own `purgeAfter` has passed, and anything else is still live. `purgeAfter`
 * is inclusive of the boundary instant — the stored value IS the expiry.
 */
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
