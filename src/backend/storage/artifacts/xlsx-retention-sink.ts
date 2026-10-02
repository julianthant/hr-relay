import type { ContentAddressedArtifactWriter } from "../../../base/artifacts.js";
import type { ArtifactRef } from "../../../domain/artifacts.js";
import { OPERATOR_XLSX_MEDIA_TYPE } from "../../../domain/dashboard/xlsx-export.js";
/**
 * The `xlsx-retention` sink (ref data-intake-and-edit-data §4.1, ref dashboard-surfaces §3.2): one workbook, one
 * stable-keyed idempotent upsert, one atomic replace.
 *
 * ## The workbook layout is deliberately the durability layout, not a guess
 *
 * Four columns — `stableKey`, `keyValues`, `record`, `projectedAt` — with the
 * two value columns holding canonical JSON text. The operator-facing column
 * layout for i9-check's real retention workbook belongs to that workflow's
 * migration, which knows the real fields; inventing a display layout here
 * would be exactly the plausible-but-wrong shape this tree bans. What THIS
 * layout proves is the §4.1 contract: a duplicate key is a verified no-op, a
 * changed record is an in-place update, rows are sorted by stable key so the
 * bytes are deterministic per row set, and nothing is ever appended twice.
 *
 * ## Writer choice (recorded like the reader's, same commit discipline)
 *
 * `write-excel-file` — the maintained sibling of `read-excel-file`, already
 * trusted in this tree for building test fixtures. The alternatives were
 * rejected for the reasons `extract-spreadsheet.ts` documents: SheetJS CE is
 * abandoned with open advisories, `node-xlsx` resolves through a CDN tarball,
 * `exceljs` (legacy's writer) is unmaintained since 2023, and
 * `@office-kit/xlsx` is still pre-1.0 (0.9.0, checked 2026-08-08).
 *
 * ## Conflict = anything the head cannot vouch for
 *
 * The projector's recorded head hash is the ONLY authority on what this sink
 * last wrote. A workbook whose bytes hash differently was changed by the
 * operator or another process; a workbook present with no head, or a head
 * with no workbook, is the same uncertainty from another side. Every arm
 * throws `ArtifactSinkConflictError` naming both hashes — and on a byte
 * mismatch the intended update is PRESERVED beside the operator's file
 * (`<workbook>.pending-<outboxId>.xlsx`), never written over it.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import readXlsxFile from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { FingerprintSchema } from "../../../domain/ids.js";
import type { Fingerprint } from "../../../domain/ids.js";
import type {
  ArtifactOutboxStorageRecord,
  ArtifactSinkHeadRecord,
} from "../sqlite/storage-records.js";

const SHEET_HEADER = ["stableKey", "keyValues", "record", "projectedAt"] as const;

export class ArtifactSinkConflictError extends Error {
  readonly sinkId: string;
  readonly recordedSha256: string | undefined;
  readonly actualSha256: string | undefined;
  readonly preservedPendingPath: string | undefined;

  constructor(input: Readonly<{
    sinkId: string;
    message: string;
    recordedSha256?: string;
    actualSha256?: string;
    preservedPendingPath?: string;
  }>) {
    super(input.message);
    this.name = "ArtifactSinkConflictError";
    this.sinkId = input.sinkId;
    this.recordedSha256 = input.recordedSha256;
    this.actualSha256 = input.actualSha256;
    this.preservedPendingPath = input.preservedPendingPath;
  }
}

export interface ArtifactSinkProjectionRequest {
  readonly row: ArtifactOutboxStorageRecord;
  readonly head: ArtifactSinkHeadRecord | undefined;
  readonly previousArtifact: ArtifactRef | undefined;
  readonly prepare: (artifact: ArtifactRef) => void;
  readonly assertPrepared: (artifact: ArtifactRef) => void;
}

export interface ArtifactSink {
  readonly sinkId: string;
  writerLockPath(): Promise<string>;
  /** Applies the row and returns the workbook's new content hash. */
  project(request: ArtifactSinkProjectionRequest): Promise<Readonly<{ contentSha256: Fingerprint; artifact: ArtifactRef }>>;
}

function contentSha256(bytes: Uint8Array): Fingerprint {
  return FingerprintSchema.parse(createHash("sha256").update(bytes).digest("hex"));
}

type WorkbookBytes = Readonly<{ present: true; bytes: Buffer }> | Readonly<{ present: false }>;

/** Absence is a discriminated FACT, never a bare default from a catch. */
async function readWorkbookBytes(path: string): Promise<WorkbookBytes> {
  try {
    return { present: true, bytes: await readFile(path) };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { present: false };
    throw error;
  }
}

/** Parse the workbook back to text rows; the layout is this module's own. */
async function readRows(bytes: Buffer): Promise<string[][]> {
  const workbook = await readXlsxFile(bytes);
  const first = workbook[0];
  if (first === undefined) throw new Error("retention workbook has no worksheets");
  return first.data.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
}

export type PublicationFaultPoint = "before-stage" | "after-stage" | "after-stage-sync" | "after-prepare" | "before-replace" | "after-replace" | "after-directory-sync";
export function createXlsxRetentionSink(options: Readonly<{ workbookPath: string; artifacts: ContentAddressedArtifactWriter;
  fault?: (point: PublicationFaultPoint) => void | Promise<void>;
}>): ArtifactSink {
  const { workbookPath } = options;
  return Object.freeze({
    sinkId: "xlsx-retention",
    async writerLockPath() {
      await mkdir(dirname(workbookPath), { recursive: true });
      // Canonical parent identity makes aliases share the same exclusive destination fence.
      return join(await realpath(dirname(workbookPath)), `.${basename(workbookPath)}.writer.lock`);
    },
    async project(request: ArtifactSinkProjectionRequest) {
      const { row, head } = request;
      const stored = await readWorkbookBytes(workbookPath);
      if (stored.present && (await lstat(workbookPath)).isSymbolicLink()) throw new ArtifactSinkConflictError({
        sinkId: row.sinkId, message: "generated-artifact-symlink-destination-conflict",
      });

      if (head === undefined && stored.present) {
        throw new ArtifactSinkConflictError({
          sinkId: "xlsx-retention",
          message: `a workbook already exists at ${workbookPath} with no recorded head; this projector `
            + "cannot prove it owns those bytes and will not write over them",
          actualSha256: contentSha256(stored.bytes),
        });
      }
      if (head !== undefined && !stored.present) {
        throw new ArtifactSinkConflictError({
          sinkId: "xlsx-retention",
          message: `the recorded head names content ${head.contentSha256} but no workbook exists at `
            + `${workbookPath}; someone removed or moved the file this projector last wrote`,
          recordedSha256: head.contentSha256,
        });
      }

      const intended = [
        String(row.stableKeyFingerprint),
        canonicalJsonStringify(row.keyValues),
        canonicalJsonStringify(row.payload.value),
        String(row.createdAt),
      ];

      // The hash is verified BEFORE the bytes are interpreted: operator-edited
      // bytes may not even parse as a workbook, and a parse failure must not
      // mask the real finding (somebody else changed the file).
      if (stored.present && head !== undefined) {
        const actual = contentSha256(stored.bytes);
        if (actual !== head.contentSha256) {
          // Preserve BOTH files: the operator's bytes stay untouched, and the
          // intended update is materialized beside them so nothing is lost.
          const pendingPath = `${workbookPath}.pending-${String(row.outboxId)}.xlsx`;
          await writeFile(pendingPath, await composeWorkbook([intended]));
          throw new ArtifactSinkConflictError({
            sinkId: "xlsx-retention",
            message: `workbook ${workbookPath} does not hash to the recorded head (recorded `
              + `${head.contentSha256}, actual ${actual}); the operator or another process changed it, `
              + `and the intended update is preserved at ${pendingPath}`,
            recordedSha256: head.contentSha256,
            actualSha256: actual,
            preservedPendingPath: pendingPath,
          });
        }
      }

      const verifyRetained = async (artifact: ArtifactRef, bytes: Buffer) => {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of await options.artifacts.open(artifact)) {
          if (!(chunk instanceof Uint8Array)) throw new Error("generated-artifact-non-byte-readback");
          length += chunk.byteLength;
          if (length > bytes.length) throw new Error("generated-artifact-readback-size-conflict");
          chunks.push(Buffer.from(chunk));
        }
        if (!Buffer.concat(chunks).equals(bytes) || artifact.bytes !== bytes.length || artifact.sha256 !== contentSha256(bytes)
          || artifact.mediaType !== OPERATOR_XLSX_MEDIA_TYPE) throw new Error("generated-artifact-readback-conflict");
        return artifact;
      };
      const retain = async (bytes: Buffer) => verifyRetained(
        await options.artifacts.put(bytes, { mediaType: OPERATOR_XLSX_MEDIA_TYPE }), bytes,
      );
      if (stored.present) {
        if (request.previousArtifact === undefined) throw new Error("generated-artifact-previous-version-unavailable");
        await verifyRetained(request.previousArtifact, stored.bytes);
      }
      const existingRows: string[][] = stored.present ? (await readRows(stored.bytes)).slice(1) : [];
      const upserted = new Map(existingRows.map((cells) => [cells[0] ?? "", cells]));
      const current = upserted.get(intended[0] ?? "");
      if (current !== undefined
        && current[1] === intended[1] && current[2] === intended[2]) {
        if (!stored.present) {
          throw new Error("retention upsert found an existing row without existing bytes; impossible state");
        }
        // A duplicate key with identical content is a VERIFIED no-op: the
        // hash-checked bytes on disk already say what this row says, so
        // nothing is rewritten and the recorded hash stays authoritative.
        if (request.previousArtifact === undefined) throw new Error("generated-artifact-previous-version-unavailable");
        const artifact = request.previousArtifact;
        request.prepare(artifact);
        return Object.freeze({ contentSha256: contentSha256(stored.bytes), artifact });
      }

      const nextBytes = await composeWorkbook([...upsert(upserted, intended).values()]);
      const artifact = await retain(nextBytes);
      await mkdir(dirname(workbookPath), { recursive: true });
      const tempPath = `${workbookPath}.tmp-${String(row.outboxId)}`;
      request.prepare(artifact);
      await options.fault?.("after-prepare");
      await options.fault?.("before-stage");
      await writeFile(tempPath, nextBytes, { flag: "wx" });
      await options.fault?.("after-stage");
      const tempHandle = await open(tempPath, "r+");
      try {
        await tempHandle.sync();
      } finally {
        await tempHandle.close();
      }
      await options.fault?.("after-stage-sync");
      if (!(await readFile(tempPath)).equals(nextBytes)) throw new Error("generated-artifact-staged-bytes-conflict");
      await options.fault?.("before-replace");
      const beforeReplace = await readWorkbookBytes(workbookPath);
      if (beforeReplace.present !== stored.present || (beforeReplace.present && stored.present && !beforeReplace.bytes.equals(stored.bytes))) {
        throw new ArtifactSinkConflictError({ sinkId: row.sinkId, message: "generated-artifact-destination-changed-before-replace" });
      }
      request.assertPrepared(artifact);
      await rename(tempPath, workbookPath);
      await options.fault?.("after-replace");
      const directoryHandle = await open(dirname(workbookPath), "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
      await options.fault?.("after-directory-sync");
      if (!(await readFile(workbookPath)).equals(nextBytes)) throw new ArtifactSinkConflictError({ sinkId: row.sinkId, message: "generated-artifact-published-bytes-conflict" });
      return Object.freeze({ contentSha256: contentSha256(nextBytes), artifact });
    },
  });
}

function upsert(rows: ReadonlyMap<string, readonly string[]>, intended: readonly string[]): Map<string, readonly string[]> {
  const next = new Map(rows);
  next.set(intended[0] ?? "", intended);
  return new Map([...next.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

async function composeWorkbook(rows: readonly (readonly string[])[]): Promise<Buffer> {
  const sheet = [
    [...SHEET_HEADER].map((header) => ({ value: header })),
    ...rows.map((cells) => cells.map((cell) => ({ value: cell }))),
  ];
  const written = writeXlsxFile(sheet);
  const buffer: unknown = await written.toBuffer();
  if (!Buffer.isBuffer(buffer)) throw new Error("write-excel-file returned a non-Buffer workbook");
  return buffer;
}
