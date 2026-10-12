import { BASELINE_JPEG_BASE64 } from "../../../fixtures/diagnostic-image-fixtures.js";
import { TRUECOLOUR_PNG_BASE64 } from "../../../fixtures/diagnostic-image-fixtures.js";
import { readImageGeometry } from "../../../fixtures/image-geometry.js";
import { createHash } from "node:crypto";
import { DashboardDayWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { RunCaptureArtifactWireSchema, RunDetailSectionResponseSchema, RunDetailWireSchema, type RunCaptureArtifactWire, type RunDetailSectionResponse, type RunDetailWire } from "../../../../../src/models/dashboard/run-detail.js";
import { deepFreeze } from "../../../../../src/rules/validation/immutability.js";
import { RunEvidenceReceiptSchema } from "../../../../../src/models/trust/evidence.js";
import type * as FixtureDetailTypes from "../../../fixtures/dashboard/fixture-detail.js";
import type * as FixtureIdentityTypes from "../../../fixtures/dashboard/fixture-identity.js";
import type * as FixtureQueueTypes from "../../../fixtures/dashboard/fixture-queue.js";


export function createFixtureRunCapturesSetup({ FIXTURE_RUN_DETAILS, FIXTURE_DESCRIPTOR_HASH, FIXTURE_DAY_WIRE, FIXTURE_IDS }: {
FIXTURE_RUN_DETAILS: typeof FixtureDetailTypes.FIXTURE_RUN_DETAILS;
FIXTURE_DESCRIPTOR_HASH: typeof FixtureIdentityTypes.FIXTURE_DESCRIPTOR_HASH;
FIXTURE_DAY_WIRE: typeof FixtureQueueTypes.FIXTURE_DAY_WIRE;
FIXTURE_IDS: typeof FixtureQueueTypes.FIXTURE_IDS;
}) {
  const RUN_CAPTURE_FIXTURE_IDS = deepFreeze({
    png: "00000000-0000-4000-8000-00000000c101",
    jpeg: "00000000-0000-4000-8000-00000000c102",
    data: "00000000-0000-4000-8000-00000000c103",
  });

  const RUN_CAPTURE_FULL_RECEIPT_ID = "00000000-0000-4000-8000-00000000c201";

  const bytesById = new Map([
    [RUN_CAPTURE_FIXTURE_IDS.png, Buffer.from(TRUECOLOUR_PNG_BASE64, "base64")],
    [RUN_CAPTURE_FIXTURE_IDS.jpeg, Buffer.from(BASELINE_JPEG_BASE64, "base64")],
    [RUN_CAPTURE_FIXTURE_IDS.data, Buffer.from('{"fixture":"run-capture"}\n')],
  ]);

  function runCaptureFixtureBytes(artifactId: string): Uint8Array<ArrayBuffer> | undefined {
    const bytes = bytesById.get(artifactId);
    return bytes === undefined ? undefined : new Uint8Array(bytes);
  }

  function captureOf(artifactId: string, mediaType: "image/png" | "image/jpeg" | "application/json",
    origins: RunCaptureArtifactWire["origins"]): RunCaptureArtifactWire {
    const bytes = bytesById.get(artifactId);
    if (bytes === undefined) throw new Error(`The run-capture fixture lost bytes for ${artifactId}`);
    const facts = { artifactId, mediaType, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    if (mediaType === "application/json") return RunCaptureArtifactWireSchema.parse({ origins,
      artifact: { ...facts, mediaKind: "data", sensitivity: "restricted", redaction: "restricted-access" } });
    const image = readImageGeometry(artifactId, mediaType, bytes);
    return RunCaptureArtifactWireSchema.parse({ origins, artifact: { ...facts, mediaKind: "image",
      width: image.width, height: image.height, sensitivity: "safe", redaction: "not-required" } });
  }

  const allOrigins = RunCaptureArtifactWireSchema.shape.origins.parse([
    { bundleId: "00000000-0000-4000-8000-00000000b101", originKind: "operator-request" },
    { bundleId: "00000000-0000-4000-8000-00000000b102", originKind: "failure" },
    { bundleId: "00000000-0000-4000-8000-00000000b103", originKind: "unexpected-state" },
    { bundleId: "00000000-0000-4000-8000-00000000b104", originKind: "subject-mismatch" },
    { bundleId: "00000000-0000-4000-8000-00000000b105", originKind: "recovery-park" },
  ]);

  const operator = RunCaptureArtifactWireSchema.shape.origins.parse([
    { bundleId: "00000000-0000-4000-8000-00000000b201", originKind: "operator-request" },
  ]);

  const artifactsByRun = new Map([
    [FIXTURE_IDS.failedRun, [captureOf(RUN_CAPTURE_FIXTURE_IDS.png, "image/png", allOrigins)]],
    [FIXTURE_IDS.doneRun, [captureOf(RUN_CAPTURE_FIXTURE_IDS.jpeg, "image/jpeg", operator),
      captureOf(RUN_CAPTURE_FIXTURE_IDS.data, "application/json", operator)]],
  ]);

  const FIXTURE_RUN_CAPTURE_DETAILS: Readonly<Record<string, RunDetailWire>> = deepFreeze(Object.fromEntries(
    [...artifactsByRun].map(([runId, artifacts]) => {
      const base = FIXTURE_RUN_DETAILS[runId];
      if (base === undefined) throw new Error(`The run-capture fixture has no original run ${runId}`);
      return [runId, RunDetailWireSchema.parse({ ...base, captures: { state: "available", artifactCount: artifacts.length },
        availableSections: [...base.availableSections, "captures"] })];
    }),
  ));

  const FIXTURE_RUN_CAPTURE_SECTIONS: Readonly<Record<string, RunDetailSectionResponse>> = deepFreeze(Object.fromEntries(
    [...artifactsByRun].map(([runId, artifacts]) => [runId, RunDetailSectionResponseSchema.parse({ section: "captures", payload: { runId, artifacts } })]),
  ));

  const FIXTURE_RUN_CAPTURE_RECEIPTS: Readonly<Record<string, RunDetailSectionResponse>> = deepFreeze({
    [FIXTURE_IDS.doneRun]: RunDetailSectionResponseSchema.parse({
      section: "receipt",
      payload: {
        state: "available",
        value: RunEvidenceReceiptSchema.parse({
          composition: 5,
          receiptId: RUN_CAPTURE_FULL_RECEIPT_ID,
          runId: FIXTURE_IDS.doneRun,
          traceId: "fw-100001-0000",
          workflowId: "person-lookup",
          attempt: 1,
          generatedAt: "2026-08-20T10:00:00.000Z",
          descriptorFingerprint: FIXTURE_DESCRIPTOR_HASH,
          configFingerprint: "b".repeat(64),
          retryOf: { state: "absent" },
          failure: { state: "absent" },
          input: [],
          observations: [],
          decisions: [],
          actions: [],
          verification: [],
          output: [],
          reuse: [],
          warnings: [],
          confidence: "verified",
          result: "verified-done",
        }),
      },
    }),
  });

  const FIXTURE_RUN_CAPTURE_REFS = deepFreeze(Object.fromEntries(
    [...artifactsByRun.values()].flat().map(capture => [capture.artifact.artifactId, capture.artifact]),
  ));

  const FIXTURE_RUN_CAPTURE_DAY = deepFreeze(DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE,
    queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map(row => {
      const detail = FIXTURE_RUN_CAPTURE_DETAILS[row.runId];
      return detail === undefined ? row : { ...row, availableSections: detail.availableSections };
    }),
  }));

  return { RUN_CAPTURE_FIXTURE_IDS, RUN_CAPTURE_FULL_RECEIPT_ID, runCaptureFixtureBytes, FIXTURE_RUN_CAPTURE_DETAILS, FIXTURE_RUN_CAPTURE_SECTIONS, FIXTURE_RUN_CAPTURE_RECEIPTS, FIXTURE_RUN_CAPTURE_REFS, FIXTURE_RUN_CAPTURE_DAY };
}
