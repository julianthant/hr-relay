import { RunDetailSectionResponseSchema, type RunDetailSectionResponse } from "../../../domain/dashboard/run-detail.js";
import { SectionUnavailableError } from "../../failures.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import {
  RunCaptureArtifactWireSchema,
  type RunCaptureAvailabilityWire,
  type RunCaptureArtifactWire,
} from "../../../domain/dashboard/run-detail.js";
import { DiagnosticBundleSchema, type DiagnosticBundle } from "../../../domain/trust/diagnostic.js";
import { ArtifactRefWireSchema, type ArtifactRefWire } from "../../../domain/dashboard/artifacts.js";
import { ErrorCodeSchema, RunIdSchema } from "../../../domain/ids.js";
import { deepFreeze } from "../../../domain/immutability.js";
import {
  DiagnosticBundleBytesMissingError,
  DiagnosticBundleCorruptError,
} from "../../failures.js";
import { readDiagnosticBundle } from "./diagnostic-bundle.js";
import { createArtifactVerificationPass } from "./artifact-bytes.js";
import { VerifiedArtifactOperationalError } from "../../../infra/artifacts/server-verified-artifact-reader.js";
import type { RunDetailQueryDeps } from "./run-detail-types.js";
import { requireRun } from "./run-read.js";

export interface VerifiedRunCaptures {
  readonly state: "available";
  readonly artifacts: readonly RunCaptureArtifactWire[];
}

export type RunCaptureInspection = VerifiedRunCaptures | Readonly<{
  state: "absent";
  reason: string;
}>;

type RunCaptureOriginWire = RunCaptureArtifactWire["origins"][number];

interface RunCaptureAccumulator {
  readonly artifact: ArtifactRefWire;
  readonly origins: RunCaptureOriginWire[];
}

function captureCorrupt(runId: string, message: string, cause?: unknown): never {
  throw new DiagnosticBundleCorruptError(
    `run ${runId} diagnostic captures are corrupt: ${message}`,
    ...(cause === undefined ? [] : [{ cause }]),
  );
}

function captureArtifactRef(runId: string, attachment: DiagnosticBundle["attachments"][number]): ArtifactRefWire {
  try {
    return ArtifactRefWireSchema.parse({
      mediaKind: attachment.kind === "screenshot" ? "image" : "data",
      artifactId: attachment.artifactId,
      mediaType: attachment.mediaType,
      byteLength: attachment.byteLength,
      sha256: attachment.digest,
      sensitivity: attachment.sensitivity,
      redaction: attachment.sensitivity === "restricted" ? "restricted-access" : "applied",
      ...(attachment.kind === "screenshot"
        ? { width: attachment.width, height: attachment.height }
        : {}),
    });
  } catch (error: unknown) {
    captureCorrupt(runId, `verified attachment ${attachment.artifactId} cannot form an artifact resource`, error);
  }
}

export async function verifyRunCaptures(
  deps: RunDetailQueryDeps,
  runId: string,
  signal?: AbortSignal,
): Promise<RunCaptureInspection> {
  if (deps.captures === undefined) {
    return { state: "absent", reason: "this composition wires no diagnostic capture authority" };
  }
  let listed: readonly DiagnosticBundle[];
  try {
    listed = deps.captures.authority.listByRun(runId).map((bundle) => DiagnosticBundleSchema.parse(bundle));
  } catch (error: unknown) {
    captureCorrupt(runId, "the run-indexed bundle set could not be read", error);
  }
  // Validate the entire run index before opening any artifact bytes.
  const bundleIds = new Set<string>();
  for (const bundle of listed) {
    if (bundle.runId !== runId) {
      captureCorrupt(runId, "the run index returned a foreign run identity");
    }
    if (bundleIds.has(bundle.bundleId)) {
      captureCorrupt(runId, "the run index returned a duplicate bundle identity");
    }
    bundleIds.add(bundle.bundleId);
  }
  const artifacts = new Map<string, RunCaptureAccumulator>();
  const verificationPass = createArtifactVerificationPass(deps.captures.artifactReader, signal);
  for (const bundle of listed) {
    let readback: Awaited<ReturnType<typeof readDiagnosticBundle>>;
    try {
      readback = await readDiagnosticBundle(deps.captures, bundle.bundleId, verificationPass, signal);
    } catch (error: unknown) {
      if (signal?.aborted === true && error === signal.reason) throw error;
      if (error instanceof VerifiedArtifactOperationalError) throw error;
      if (error instanceof DiagnosticBundleBytesMissingError) throw error;
      captureCorrupt(runId, `bundle ${bundle.bundleId} failed exact verification`, error);
    }
    if (readback.wire.bundleId !== bundle.bundleId
      || readback.manifest !== canonicalJsonStringify(bundle)) {
      captureCorrupt(runId, `bundle ${bundle.bundleId} exact-id readback disagrees with the run index`);
    }
    for (const attachment of bundle.attachments) {
      const candidate = captureArtifactRef(runId, attachment);
      const existing = artifacts.get(candidate.artifactId);
      if (existing !== undefined && canonicalJsonStringify(existing.artifact) !== canonicalJsonStringify(candidate)) {
        captureCorrupt(runId, `artifact ${candidate.artifactId} has conflicting verified metadata`);
      }
      const origin = { bundleId: bundle.bundleId, originKind: bundle.origin.kind };
      if (existing === undefined) {
        artifacts.set(candidate.artifactId, { artifact: candidate, origins: [origin] });
      } else {
        existing.origins.push(origin);
      }
    }
  }
  if (artifacts.size === 0) {
    return { state: "absent", reason: "this run has no indexed diagnostic capture artifacts" };
  }
  const projected = [...artifacts.values()].map((capture) =>
    deepFreeze(RunCaptureArtifactWireSchema.parse(capture)));
  return { state: "available", artifacts: Object.freeze(projected) };
}

/** Verify initial capture availability, preserving named capture failures on the detail wire. */
export async function readRunCaptureAvailability(
  deps: RunDetailQueryDeps,
  runId: string,
  signal?: AbortSignal,
): Promise<RunCaptureAvailabilityWire> {
  RunIdSchema.parse(runId);
  requireRun(deps, runId);
  let inspected: RunCaptureInspection;
  try {
    inspected = await verifyRunCaptures(deps, runId, signal);
  } catch (error: unknown) {
    if (error instanceof DiagnosticBundleCorruptError
      || error instanceof DiagnosticBundleBytesMissingError) {
      return {
        state: "error",
        code: ErrorCodeSchema.parse(error instanceof DiagnosticBundleBytesMissingError
          ? "DIAGNOSTIC_BUNDLE_BYTES_MISSING"
          : "DIAGNOSTIC_BUNDLE_CORRUPT"),
        message: error.message,
        retryable: false,
      };
    }
    throw error;
  }
  const captures: RunCaptureAvailabilityWire = inspected.state === "available"
    ? { state: "available", artifactCount: inspected.artifacts.length }
    : inspected;
  return captures;
}

/** Read one capture section through its trust-owned admission and verification. */
export async function readRunCaptureSection(deps:RunDetailQueryDeps,runId:string,signal?:AbortSignal):Promise<RunDetailSectionResponse> {
  requireRun(deps, runId);
  const inspected = await verifyRunCaptures(deps, runId, signal);
  if (inspected.state === "absent") {
    throw new SectionUnavailableError(`section captures is not available for run ${runId}: ${inspected.reason}`);
  }
  return RunDetailSectionResponseSchema.parse({
    section: "captures",
    payload: { runId, artifacts: inspected.artifacts },
  });
}
