
// Prepare the bundle ID before writing the failure; persist its foreign-key reference in the same transaction.
import { z } from "zod";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import { DiagnosticBundleIdSchema, FingerprintSchema, IsoInstantSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import { redactDiagnosticFields } from "../../../rules/redaction/redaction.js";
import {
  assertDiagnosticExportSafe,
  deriveDiagnosticContentDigest,
  diagnosticOriginOfTrigger,
  planDiagnosticRetention,
  type DiagnosticCaptureTrigger,
} from "../../../models/trust/diagnostic-capture.js";
import {
  DiagnosticAttachmentSchema,
  DiagnosticBundleSchema,
  type DiagnosticBundle,
} from "../../../models/trust/diagnostic.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";


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
  readonly operation?: DiagnosticBundle["operation"];
  readonly runId: string;
  /** Mandatory for every trigger but `operator-request`. */
  readonly failureId?: string;
  /** Mandatory for `operator-request`, forbidden otherwise. */
  readonly requestedBy?: string;
  readonly configFingerprint: string;
  readonly descriptorFingerprint: string;
  // Unclassified diagnostic fields retain a warning rather than silently acquiring a classification.
  readonly fields: unknown;
  readonly attachments: readonly DiagnosticAttachmentSource[];

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
    if (request.operation !== undefined) {
      if (request.operation.runId !== request.runId || request.operation.definitionFingerprint !== request.descriptorFingerprint) throw new Error("diagnostic-operation-request-owner-mismatch");
      dependencies.authority.diagnosticBundles.validateOperation(request.operation);
    }
    const capturedAt = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
    // Keep the capture's original classified values with its provenance.
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
      ...(request.operation === undefined ? {} : { operation: request.operation }),
      createdAt: capturedAt,
      contentDigest: deriveDiagnosticContentDigest({
        runId: request.runId,
        origin,
        capturedAt,
        configFingerprint: request.configFingerprint,
        descriptorFingerprint: request.descriptorFingerprint,
        redaction,
        attachments,
        ...(request.operation === undefined ? {} : { operation: request.operation }),
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
