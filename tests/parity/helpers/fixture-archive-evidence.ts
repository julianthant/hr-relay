/**
 * Exact bytes for DCA4's archive-evidence fixture.
 *
 * This is intentionally separate from `fixture-archive.ts`: the broad Archive
 * corpus keeps its archived record, while this one proof owns the only capture
 * it downloads. Its metadata is parsed from the exact bytes it serves, so a
 * successful browser image can never be a first-entry substitute from another
 * fixture map.
 */
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import {
ArchivedRunContentSchema,
ArchivedRunRecordSchema,
archivedRunContentDigest,
} from "../../../src/domain/archive/model.js";
import { archiveRetention } from "../../../src/domain/archive/retention.js";
import { ArchivedCaptureTileSchema } from "../../../src/domain/archive/sections.js";
import {
ArchiveIndexWireSchema,
ArchivedRunDetailWireSchema,
type ArchivedRunDetailWire,
} from "../../../src/domain/dashboard/archive.js";
import { ARCHIVED_RUN_WITH_SECTIONS } from "../../fixtures/archive-fixtures.js";
import { FIXTURE_ARCHIVE_INDEX } from "./fixture-archive.js";
import { FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./fixture-identity.js";

const WIDTH = 1440;
const HEIGHT = 900;

const CRC_TABLE: readonly number[] = Object.freeze(
  Array.from({ length: 256 }, (_unused, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  }),
);

function crc32(bytes: Uint8Array): number {
  let value = 0xff_ff_ff_ff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xff_ff_ff_ff) >>> 0;
}

function pngChunk(type: string, body: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(type);
  const payload = new Uint8Array(name.length + body.length);
  payload.set(name, 0);
  payload.set(body, name.length);
  const chunk = new Uint8Array(payload.length + 8);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  chunk.set(payload, 4);
  view.setUint32(chunk.length - 4, crc32(payload));
  return chunk;
}

function archivedEvidencePng(): Uint8Array {
  const raw = new Uint8Array((WIDTH + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    raw[y * (WIDTH + 1)] = 0;
    for (let x = 0; x < WIDTH; x += 1) {
      const band = y > 100 && y < 196;
      const rule = y > 276 && y < 292 && x > 180 && x < 1_260;
      const marker = x > 180 && x < 236 && y > 344 && y < 680;
      raw[y * (WIDTH + 1) + 1 + x] = band ? 72 : rule ? 124 : marker ? 156 : 244;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, WIDTH);
  view.setUint32(4, HEIGHT);
  header[8] = 8;
  header[9] = 0;
  const chunks = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", new Uint8Array(deflateSync(raw))),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export const FIXTURE_ARCHIVE_EVIDENCE_BYTES = archivedEvidencePng();
const DIGEST = createHash("sha256").update(FIXTURE_ARCHIVE_EVIDENCE_BYTES).digest("hex");

export const FIXTURE_ARCHIVE_EVIDENCE_CAPTURE = ArchivedCaptureTileSchema.parse({
  artifactId: "aa11bb22-000a-4000-8000-aa11bb22000a",
  bundleId: "aa11bb22-000b-4000-8000-aa11bb22000b",
  kind: "screenshot",
  mediaType: "image/png",
  byteLength: FIXTURE_ARCHIVE_EVIDENCE_BYTES.byteLength,
  digest: DIGEST,
  sensitivity: "redacted",
  capturedAt: ARCHIVED_RUN_WITH_SECTIONS.archivedAt,
  origin: "operator-request",
  dimensions: { width: WIDTH, height: HEIGHT },
  step: { state: "present", nodeId: "ucpath-person" },
  system: { state: "present", value: "ucpath" },
  retention: { kind: "ordinary", purgeAfter: "2026-09-02T09:11:00.000Z" },
});

// Start from a declared DURABLE fixture (including its immutable input), never
// reconstruct authority from an ArchivedRunDetailWire. Only this scenario gets
// a new capture and a freshly sealed canonical record; the broad corpus is intact.
const { contentDigest: _seedDigest, ...SEED_CONTENT } = ARCHIVED_RUN_WITH_SECTIONS;
if (SEED_CONTENT.sections === undefined) throw new Error("the archive-evidence durable seed has no frozen sections");
const CONTENT = ArchivedRunContentSchema.parse({
  ...SEED_CONTENT,
  archiveSchemaGeneration: 3,
  workflowCode: { state: "present", value: "pl" },
  row: {
    ...SEED_CONTENT.row,
    session: { state: "absent", reason: "no session recorded (archived before D269)" },
  },
  evidence: { ...SEED_CONTENT.evidence, artifactIds: [FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId] },
  sections: {
    ...SEED_CONTENT.sections,
    captures: { state: "present", value: [FIXTURE_ARCHIVE_EVIDENCE_CAPTURE] },
  },
});
export const FIXTURE_ARCHIVE_EVIDENCE_RECORD = ArchivedRunRecordSchema.parse({
  ...CONTENT,
  contentDigest: archivedRunContentDigest(CONTENT),
});
const RECORD = FIXTURE_ARCHIVE_EVIDENCE_RECORD;
if (RECORD.workflowLabel.state !== "present" || RECORD.workflowCode?.state !== "present" || RECORD.sections === undefined) {
  throw new Error("the archive-evidence record requires its declared label, code and sections");
}
if (RECORD.evidence.ledgerPartitions.length !== 0) throw new Error("the archive-evidence fixture has no ledger read-through");

/** Wire-only affordances are added AFTER sealing and are never inputs to the content digest. */
export const FIXTURE_ARCHIVE_EVIDENCE_RUN: ArchivedRunDetailWire = ArchivedRunDetailWireSchema.parse({
  wireVersion: 1,
  archiveSchemaGeneration: RECORD.archiveSchemaGeneration,
  runId: RECORD.runId,
  applicationId: RECORD.applicationId,
  workflowId: RECORD.workflowId,
  workflowLabel: RECORD.workflowLabel.value,
  workflowCode: RECORD.workflowCode,
  archivedIdentity: RECORD.archivedIdentity,
  appVersion: RECORD.appVersion,
  drift: RECORD.drift,
  archivedAt: RECORD.archivedAt,
  archivedBy: RECORD.archivedBy,
  archiveFingerprint: RECORD.contentDigest,
  row: RECORD.row,
  detail: RECORD.detail,
  receipt: RECORD.receipt,
  failure: RECORD.failure,
  evidence: RECORD.evidence,
  sections: { state: "present", value: RECORD.sections },
  ledger: [],
  retention: archiveRetention({
    now: `${FIXTURE_DAY}T11:00:00.000Z`,
    endedAt: RECORD.row.endedAt,
    pointerCounts: {
      artifacts: RECORD.evidence.artifactIds.length,
      checkpoints: RECORD.evidence.checkpointNodeIds.length,
      writeIntents: RECORD.evidence.writeIntentIds.length,
      ledgerLines: RECORD.evidence.ledgerPartitions.length,
    },
  }),
  relaunches: [],
  relaunch: {
    state: "available",
    current: { workflowId: RECORD.workflowId, descriptorVersion: 2, contractFingerprint: FIXTURE_DESCRIPTOR_HASH },
  },
});

if (FIXTURE_ARCHIVE_INDEX.sweeps.length !== 1) {
  throw new Error("the archive-evidence scenario requires one declared fixture sweep");
}
export const FIXTURE_ARCHIVE_EVIDENCE_INDEX = ArchiveIndexWireSchema.parse({
  ...FIXTURE_ARCHIVE_INDEX,
  archiveSchemaGeneration: RECORD.archiveSchemaGeneration,
  entries: [{
    runId: RECORD.runId,
    traceId: RECORD.traceId,
    workflowId: RECORD.workflowId,
    workflowLabel: RECORD.workflowLabel.value,
    workflowCode: RECORD.workflowCode,
    title: RECORD.row.title,
    status: RECORD.row.status,
    archivedIdentity: RECORD.archivedIdentity,
    appVersion: RECORD.appVersion,
    drift: RECORD.drift,
    startedAt: RECORD.row.startedAt,
    endedAt: RECORD.row.endedAt,
    archivedAt: RECORD.archivedAt,
    applicationId: RECORD.applicationId,
    resolvedInstances: RECORD.row.resolvedInstances,
    dryRun: RECORD.row.dryRun,
    warnings: RECORD.row.warnings,
    archiveFingerprint: RECORD.contentDigest,
  }],
  sweeps: FIXTURE_ARCHIVE_INDEX.sweeps.map((sweep) => ({
    ...sweep,
    applicationId: RECORD.applicationId,
    appliedAt: RECORD.archivedAt,
    appliedBy: RECORD.archivedBy,
    archivedCount: 1,
    fromVersions: [RECORD.archivedIdentity.descriptorVersion],
  })),
});

/** A BodyInit-safe own copy: `Uint8Array<ArrayBufferLike>` is not one. */
export function archiveEvidenceResponseBody(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return body;
}
