/**
 * Ref operator-trust §2.2 — automatic diagnostic capture.
 *
 * Capture is TWO phases on purpose, and the reason is a foreign key:
 * `diagnostic_bundles.failure_id` references `failures(record_key)`, while
 * `FailureRecord.diagnosticBundleId` is a forward reference the failure row
 * must already carry. Neither row can be written second on its own, so the
 * only honest ordering is
 *
 *   1. `prepare` — redact, write every attachment to the content-addressed
 *      store, and mint the bundle id. Asynchronous, and nothing durable in
 *      authority has moved yet. A crash here leaves at most an unreferenced
 *      artifact, which the content-addressed writer already tolerates.
 *   2. inside ONE authority transaction: terminalize the failure with the
 *      prepared `bundleId`, then `persist` the bundle naming that failure.
 *
 * Redaction happens HERE, at capture, and is schema-owned: unclassified fields
 * are DROPPED by `redactDiagnosticFields` with a warning, never passed through
 * for the UI to hide later. `assertDiagnosticExportSafe` then refuses a bundle
 * that somehow still allows a never-exportable key.
 */
import { z } from "zod";
import type { ContentAddressedArtifactWriter } from "../../base/artifacts.js";
import type { Clock } from "../../domain/clock.js";
import type { IdFactory } from "../../domain/identifiers.js";
import { DiagnosticBundleIdSchema, FingerprintSchema, IsoInstantSchema, RunIdSchema } from "../../domain/ids.js";
import { redactDiagnosticFields } from "../../domain/redaction.js";
import {
  assertDiagnosticExportSafe,
  deriveDiagnosticContentDigest,
  diagnosticOriginOfTrigger,
  planDiagnosticRetention,
  type DiagnosticCaptureTrigger,
} from "../../domain/trust/diagnostic-capture.js";
import {
  DiagnosticAttachmentSchema,
  DiagnosticBundleSchema,
  type DiagnosticBundle,
} from "../../domain/trust/diagnostic.js";
import type { AuthorityRepositories } from "../../infra/sqlite/authority-database.js";

/**
 * The exact media type each attachment arm may carry. Ref operator-trust §2.2 allows a
 * screenshot, a bounded accessibility/DOM excerpt, and console/network
 * summaries — not an arbitrary blob — and `DiagnosticAttachmentSchema` pins
 * the same pairs, so a mismatch fails at both ends.
 */
const ATTACHMENT_MEDIA_TYPES = Object.freeze({
  screenshot: ["image/png", "image/jpeg"],
  "accessibility-excerpt": ["text/yaml"],
  "network-summary": ["application/json"],
  "console-summary": ["application/json"],
} as const);

export type DiagnosticAttachmentKind = keyof typeof ATTACHMENT_MEDIA_TYPES;

export interface DiagnosticAttachmentSource {
  readonly kind: DiagnosticAttachmentKind;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  /** Only a screenshot may be `restricted`; every other arm is redacted text. */
  readonly sensitivity: "redacted" | "restricted";
  readonly width?: number;
  readonly height?: number;
}

export interface DiagnosticCaptureRequest {
  readonly trigger: DiagnosticCaptureTrigger;
  readonly runId: string;
  /** Mandatory for every trigger but `operator-request`. */
  readonly failureId?: string;
  /** Mandatory for `operator-request`, forbidden otherwise. */
  readonly requestedBy?: string;
  readonly configFingerprint: string;
  readonly descriptorFingerprint: string;
  /**
   * Classified diagnostic fields. Anything this array cannot classify is
   * dropped with a warning — an unclassified field never reaches the bundle.
   */
  readonly fields: unknown;
  readonly attachments: readonly DiagnosticAttachmentSource[];
  /** Defaults to `ordinary`, i.e. the D86 notes retention floor. */
  readonly retention?: unknown;
}

export interface DiagnosticCaptureService {
  prepare(request: DiagnosticCaptureRequest): Promise<DiagnosticBundle>;
  persist(bundle: unknown): DiagnosticBundle;
  capture(request: DiagnosticCaptureRequest): Promise<DiagnosticBundle>;
}

export interface DiagnosticCaptureDependencies {
  readonly artifacts: ContentAddressedArtifactWriter;
  readonly authority: Pick<AuthorityRepositories, "diagnosticBundles">;
  readonly clock: Clock;
  readonly ids: IdFactory;
  /** Test seam only; production uses the D86 floor from the domain module. */
  readonly retentionDays?: number;
}

function assertAttachmentShape(source: DiagnosticAttachmentSource): void {
  const allowed: readonly string[] = ATTACHMENT_MEDIA_TYPES[source.kind];
  if (!allowed.includes(source.mediaType)) {
    throw new Error(`diagnostic attachment ${source.kind} cannot carry media type ${source.mediaType}`);
  }
  if (source.sensitivity === "restricted" && source.kind !== "screenshot") {
    throw new Error(`diagnostic attachment ${source.kind} must be redacted before capture; only a screenshot may stay restricted`);
  }
  if (source.kind === "screenshot") {
    if (source.width === undefined || source.height === undefined) {
      throw new Error("a diagnostic screenshot must record its captured width and height");
    }
  } else if (source.width !== undefined || source.height !== undefined) {
    throw new Error(`diagnostic attachment ${source.kind} has no pixel dimensions`);
  }
  if (source.bytes.byteLength === 0) {
    throw new Error(`diagnostic attachment ${source.kind} carries no bytes`);
  }
}

export function createDiagnosticCaptureService(
  dependencies: DiagnosticCaptureDependencies,
): DiagnosticCaptureService {
  const persist = (bundleInput: unknown): DiagnosticBundle => {
    const bundle = DiagnosticBundleSchema.parse(bundleInput);
    return dependencies.authority.diagnosticBundles.insert(bundle).record;
  };

  const prepare = async (request: DiagnosticCaptureRequest): Promise<DiagnosticBundle> => {
    const origin = diagnosticOriginOfTrigger({
      trigger: request.trigger,
      ...(request.failureId === undefined ? {} : { failureId: request.failureId }),
      ...(request.requestedBy === undefined ? {} : { requestedBy: request.requestedBy }),
    });
    const capturedAt = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
    // Schema-owned redaction, at capture. Unclassified fields are already gone
    // by the time anything is written; the export assertion is the second lock.
    const redaction = assertDiagnosticExportSafe(redactDiagnosticFields(request.fields));

    const attachments: z.infer<typeof DiagnosticAttachmentSchema>[] = [];
    for (const source of request.attachments) {
      assertAttachmentShape(source);
      const ref = await dependencies.artifacts.put(source.bytes, { mediaType: source.mediaType });
      attachments.push(DiagnosticAttachmentSchema.parse({
        kind: source.kind,
        artifactId: ref.id,
        mediaType: source.mediaType,
        byteLength: ref.bytes,
        digest: ref.sha256,
        sensitivity: source.sensitivity,
        ...(source.kind === "screenshot" ? { width: source.width, height: source.height } : {}),
      }));
    }

    return DiagnosticBundleSchema.parse({
      bundleId: DiagnosticBundleIdSchema.parse(dependencies.ids.uuid()),
      runId: RunIdSchema.parse(request.runId),
      origin,
      createdAt: capturedAt,
      contentDigest: deriveDiagnosticContentDigest({
        runId: request.runId,
        origin,
        capturedAt,
        configFingerprint: request.configFingerprint,
        descriptorFingerprint: request.descriptorFingerprint,
        redaction,
        attachments,
      }),
      configFingerprint: FingerprintSchema.parse(request.configFingerprint),
      descriptorFingerprint: FingerprintSchema.parse(request.descriptorFingerprint),
      redaction,
      attachments,
      retention: planDiagnosticRetention({
        capturedAt,
        request: request.retention ?? { kind: "ordinary" },
        ...(dependencies.retentionDays === undefined ? {} : { retentionDays: dependencies.retentionDays }),
      }),
    });
  };

  return Object.freeze({
    prepare,
    persist,
    capture: async (request: DiagnosticCaptureRequest) => persist(await prepare(request)),
  });
}
