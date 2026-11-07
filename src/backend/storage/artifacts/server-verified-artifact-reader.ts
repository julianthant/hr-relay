import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { ArtifactRefSchema, type ArtifactRef } from "../../../models/artifacts/artifacts.js";

const IO_CHUNK_BYTES = 64 * 1024;

export type VerifiedArtifactIoKind = "source-read" | "snapshot-write" | "prepared-write" | "prepared-read";
export type VerifiedArtifactMemoryPhase = "snapshot" | "parse-and-decode" | "prepared-verify" | "lease-read";
export type VerifiedArtifactFaultPoint =
  | "scratch-unlink"
  | "source-read"
  | "snapshot-write"
  | "snapshot-sync"
  | "prepared-write"
  | "prepared-sync"
  | "prepared-read"
  | "source-close"
  | "snapshot-close"
  | "prepared-close"
  | "lease-read"
  | "lease-close";

export interface ServerVerifiedArtifactReaderOptions {
  readonly admission: RuntimeAdmission;
  readonly observeIo?: (kind: VerifiedArtifactIoKind, bytes: number) => void;
  /** Conservative upper bound for reader-owned live byte-buffer capacity in the active phase. */
  readonly observeRetainedBytes?: (phase: VerifiedArtifactMemoryPhase, bytes: number) => void;
  /** Narrow deterministic fault seam for this private reader's lifecycle tests. */
  readonly injectFault?: (point: VerifiedArtifactFaultPoint) => void;
  readonly observeLeaseClosed?: () => void;
  readonly observeHandleClosed?: (
    kind: "source" | "snapshot" | "prepared",
    handle: FileHandle,
  ) => void;
}

export interface VerifiedByteLease {
  readonly ref: ArtifactRef;
  takeBody(): Promise<ReadableStream<Uint8Array>>;
  dispose(): Promise<void>;
}

export interface ServerVerifiedArtifactReader {
  verify(ref: ArtifactRef, signal?: AbortSignal): Promise<void>;
  prepare(ref: ArtifactRef, signal?: AbortSignal): Promise<VerifiedByteLease>;
}

/** A private storage/lifetime failure, never evidence that authoritative bytes are corrupt. */
export class VerifiedArtifactOperationalError extends Error {
  constructor(options?: ErrorOptions) {
    super("verified artifact storage operation failed", options);
    this.name = "VerifiedArtifactOperationalError";
  }
}

export class VerifiedArtifactSourceMissingError extends Error {
  constructor(options?: ErrorOptions) {
    super("verified artifact source is missing", options);
    this.name = "VerifiedArtifactSourceMissingError";
  }
}

interface ReaderRoots {
  readonly artifactRoot: string;
  readonly scratchRoot: string;
}

interface PayloadSpan {
  readonly state: "string";
  readonly start: number;
  readonly end: number;
}

type PayloadCandidate = PayloadSpan | Readonly<{ state: "invalid" }>;

interface ParsedEnvelope {
  readonly ref: unknown;
  readonly refMediaTypeMatchesExpected: boolean;
  readonly payload: PayloadCandidate | undefined;
  readonly hasUnknownProperty: boolean;
}

interface ParsedRefObject {
  readonly value: unknown;
  readonly mediaTypeMatchesExpected: boolean;
}

interface RefCandidate {
  id?: unknown;
  sha256?: unknown;
  bytes?: unknown;
  mediaType?: unknown;
}

async function rejectSymlink(path: string, label: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link`);
    if (!stat.isDirectory()) throw new Error(`${label} must be a directory`);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

async function initializeRoots(admission: RuntimeAdmission): Promise<ReaderRoots> {
  admission.assertWritable();
  const artifactPath = admission.artifactRoot;
  const scratchPath = join(admission.stateRoot, "scratch");
  admission.assertArtifactRoot(artifactPath);
  admission.assertStateRoot(scratchPath);
  await rejectSymlink(artifactPath, "rebuild artifact root");
  admission.assertLive();
  await rejectSymlink(scratchPath, "verified-byte scratch root");
  admission.assertLive();
  admission.assertLive();
  return Object.freeze({ artifactRoot: artifactPath, scratchRoot: scratchPath });
}

async function createAnonymousScratch(
  root: string,
  kind: "snapshot" | "prepared",
  options: Pick<ServerVerifiedArtifactReaderOptions, "injectFault" | "observeHandleClosed">,
): Promise<FileHandle> {
  await rejectSymlink(root, "verified-byte scratch root");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, `verified-byte.${String(process.pid)}.${randomUUID()}.tmp`);
  let handle: FileHandle;
  try {
    handle = await open(path, "wx+", 0o600);
  } catch (error: unknown) {
    throw operationalFailure(error);
  }
  try {
    injectOperationalFault(options.injectFault, "scratch-unlink");
    await unlink(path);
    return handle;
  } catch (error: unknown) {
    let primary = error;
    try {
      await closeTransientHandle(handle, kind, options);
    } catch (cleanup: unknown) {
      primary = primaryFirstAggregate(primary, cleanup, "verified-byte scratch unlink and close both failed");
    }
    try {
      await unlink(path);
    } catch (cleanup: unknown) {
      if (!(cleanup instanceof Error && "code" in cleanup && cleanup.code === "ENOENT")) {
        primary = primaryFirstAggregate(primary, cleanup, "verified-byte scratch failure and name cleanup both failed");
      }
    }
    throw operationalFailure(primary);
  }
}

async function writeAll(handle: FileHandle, bytes: Uint8Array, position: number): Promise<void> {
  let written = 0;
  while (written < bytes.byteLength) {
    const result = await handle.write(bytes, written, bytes.byteLength - written, position + written);
    if (result.bytesWritten === 0) {
      throw new VerifiedArtifactOperationalError({
        cause: new Error("verified-byte scratch write made no progress"),
      });
    }
    written += result.bytesWritten;
  }
}

async function snapshotArtifact(
  roots: ReaderRoots,
  ref: ArtifactRef,
  signal: AbortSignal | undefined,
  observeIo: ServerVerifiedArtifactReaderOptions["observeIo"],
  injectFault: ServerVerifiedArtifactReaderOptions["injectFault"],
  observeHandleClosed: ServerVerifiedArtifactReaderOptions["observeHandleClosed"],
): Promise<FileHandle> {
  signal?.throwIfAborted();
  let source: FileHandle;
  try {
    source = await open(
      join(roots.artifactRoot, `${ref.sha256}.artifact`),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch (error: unknown) {
    if (isPhysicalObjectMissing(error)) throw new VerifiedArtifactSourceMissingError({ cause: error });
    throw operationalFailure(error);
  }
  let sourceStat: Awaited<ReturnType<FileHandle["stat"]>>;
  try {
    sourceStat = await source.stat();
  } catch (error: unknown) {
    try {
      await closeTransientHandle(source, "source", { injectFault, observeHandleClosed });
    } catch (cleanup: unknown) {
      throw primaryFirstAggregate(error, cleanup, "artifact source stat and cleanup both failed");
    }
    throw error;
  }
  if (!sourceStat.isFile()) {
    const primary = new VerifiedArtifactOperationalError({
      cause: new Error("verified artifact source is not a regular file"),
    });
    try {
      await closeTransientHandle(source, "source", { injectFault, observeHandleClosed });
    } catch (cleanup: unknown) {
      throw primaryFirstAggregate(primary, cleanup, "non-regular artifact source and cleanup both failed");
    }
    throw primary;
  }
  let snapshot: FileHandle;
  try {
    snapshot = await createAnonymousScratch(
      roots.scratchRoot,
      "snapshot",
      { injectFault, observeHandleClosed },
    );
  } catch (error: unknown) {
    try {
      await closeTransientHandle(source, "source", { injectFault, observeHandleClosed });
    } catch (cleanup: unknown) {
      throw primaryFirstAggregate(error, cleanup, "artifact snapshot creation and source cleanup both failed");
    }
    throw error;
  }
  let offset = 0;
  let sourceClosed = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      injectOperationalFault(injectFault, "source-read");
      const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
      const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, offset);
      if (bytesRead === 0) break;
      observeIo?.("source-read", bytesRead);
      injectOperationalFault(injectFault, "snapshot-write");
      await writeAll(snapshot, buffer.subarray(0, bytesRead), offset);
      observeIo?.("snapshot-write", bytesRead);
      offset += bytesRead;
    }
    await closeTransientHandle(
      source,
      "source",
      { injectFault, observeHandleClosed },
      () => {
        sourceClosed = true;
      },
    );
    injectOperationalFault(injectFault, "snapshot-sync");
    await snapshot.sync();
    return snapshot;
  } catch (error: unknown) {
    let primary = error;
    if (!sourceClosed) {
      try {
        await closeTransientHandle(source, "source", { injectFault, observeHandleClosed });
      } catch (cleanup: unknown) {
        primary = primaryFirstAggregate(error, cleanup, "artifact snapshot and source cleanup both failed");
      }
    }
    try {
      await closeTransientHandle(snapshot, "snapshot", { injectFault, observeHandleClosed });
    } catch (cleanup: unknown) {
      throw primaryFirstAggregate(primary, cleanup, "artifact snapshot and cleanup both failed");
    }
    throw primary;
  }
}

class ByteCursor {
  readonly #handle: FileHandle;
  readonly #end: number | undefined;
  readonly #signal: AbortSignal | undefined;
  #buffer = Buffer.alloc(0);
  #bufferIndex = 0;
  #nextReadPosition: number;
  #offset: number;

  constructor(handle: FileHandle, start = 0, end?: number, signal?: AbortSignal) {
    this.#handle = handle;
    this.#nextReadPosition = start;
    this.#offset = start;
    this.#end = end;
    this.#signal = signal;
  }

  get offset(): number {
    return this.#offset;
  }

  async #fill(): Promise<boolean> {
    this.#signal?.throwIfAborted();
    if (this.#bufferIndex < this.#buffer.byteLength) return true;
    if (this.#end !== undefined && this.#nextReadPosition >= this.#end) return false;
    const remaining = this.#end === undefined
      ? IO_CHUNK_BYTES
      : Math.min(IO_CHUNK_BYTES, this.#end - this.#nextReadPosition);
    const next = Buffer.allocUnsafe(remaining);
    const { bytesRead } = await this.#handle.read(next, 0, next.byteLength, this.#nextReadPosition);
    if (bytesRead === 0) return false;
    this.#buffer = next.subarray(0, bytesRead);
    this.#bufferIndex = 0;
    this.#nextReadPosition += bytesRead;
    return true;
  }

  async peek(): Promise<number | undefined> {
    if (!await this.#fill()) return undefined;
    return this.#buffer[this.#bufferIndex];
  }

  async read(): Promise<number | undefined> {
    if (!await this.#fill()) return undefined;
    const value = this.#buffer[this.#bufferIndex];
    this.#bufferIndex += 1;
    this.#offset += 1;
    return value;
  }

  async readChunk(): Promise<Uint8Array | undefined> {
    if (!await this.#fill()) return undefined;
    const chunk = this.#buffer.subarray(this.#bufferIndex);
    this.#bufferIndex = this.#buffer.byteLength;
    this.#offset += chunk.byteLength;
    return chunk;
  }
}

function byteLabel(byte: number | undefined): string {
  return byte === undefined ? "end of input" : `byte 0x${byte.toString(16).padStart(2, "0")}`;
}

async function expectByte(cursor: ByteCursor, expected: number, label: string): Promise<void> {
  const actual = await cursor.read();
  if (actual !== expected) throw new Error(`stored artifact JSON expected ${label}, received ${byteLabel(actual)}`);
}

function isWhitespace(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

async function skipWhitespace(cursor: ByteCursor): Promise<void> {
  while (isWhitespace(await cursor.peek())) await cursor.read();
}

function hexValue(byte: number): number | undefined {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return undefined;
}

interface JsonStringResult {
  readonly ascii: string | undefined;
  readonly start: number;
  readonly end: number;
  readonly matchesExpected: boolean | undefined;
}

async function readJsonString(
  cursor: ByteCursor,
  collectLimit = 0,
  expected?: string,
): Promise<JsonStringResult> {
  await expectByte(cursor, 0x22, "a string");
  const start = cursor.offset;
  let ascii = "";
  let collect = collectLimit > 0;
  let expectedIndex = 0;
  let matchesExpected = expected === undefined ? undefined : true;
  while (true) {
    const before = cursor.offset;
    const byte = await cursor.read();
    if (byte === undefined) throw new Error("stored artifact JSON has an unterminated string");
    if (byte === 0x22) {
      if (matchesExpected === true && expectedIndex !== expected?.length) matchesExpected = false;
      return { ascii: collect ? ascii : undefined, start, end: before, matchesExpected };
    }
    if (byte < 0x20) throw new Error("stored artifact JSON string contains an unescaped control byte");
    let codeUnit: number;
    if (byte !== 0x5c) {
      codeUnit = byte;
    } else {
      const escaped = await cursor.read();
      if (escaped === undefined) throw new Error("stored artifact JSON has an incomplete escape");
      switch (escaped) {
        case 0x22: case 0x5c: case 0x2f: codeUnit = escaped; break;
        case 0x62: codeUnit = 0x08; break;
        case 0x66: codeUnit = 0x0c; break;
        case 0x6e: codeUnit = 0x0a; break;
        case 0x72: codeUnit = 0x0d; break;
        case 0x74: codeUnit = 0x09; break;
        case 0x75: {
          codeUnit = 0;
          for (let index = 0; index < 4; index += 1) {
            const hex = await cursor.read();
            const value = hex === undefined ? undefined : hexValue(hex);
            if (value === undefined) throw new Error("stored artifact JSON has an invalid unicode escape");
            codeUnit = codeUnit * 16 + value;
          }
          break;
        }
        default: throw new Error("stored artifact JSON has an invalid escape");
      }
    }
    if (matchesExpected === true && codeUnit !== expected?.charCodeAt(expectedIndex)) matchesExpected = false;
    expectedIndex += 1;
    if (!collect) continue;
    if (codeUnit > 0x7f || ascii.length >= collectLimit) {
      collect = false;
      ascii = "";
    } else {
      ascii += String.fromCharCode(codeUnit);
    }
  }
}

async function readNumber(cursor: ByteCursor): Promise<number> {
  let negative = false;
  if (await cursor.peek() === 0x2d) {
    negative = true;
    await cursor.read();
  }
  let value = 0;
  const first = await cursor.peek();
  if (first === 0x30) {
    await cursor.read();
    const next = await cursor.peek();
    if (next !== undefined && next >= 0x30 && next <= 0x39) throw new Error("stored artifact JSON has a leading-zero number");
  } else if (first !== undefined && first >= 0x31 && first <= 0x39) {
    while (true) {
      const digit = await cursor.peek();
      if (digit === undefined || digit < 0x30 || digit > 0x39) break;
      await cursor.read();
      value = value * 10 + (digit - 0x30);
    }
  } else {
    throw new Error("stored artifact JSON has an invalid number");
  }
  let fractionScale = 0.1;
  if (await cursor.peek() === 0x2e) {
    await cursor.read();
    const digit = await cursor.peek();
    if (digit === undefined || digit < 0x30 || digit > 0x39) throw new Error("stored artifact JSON has an invalid fraction");
    while (true) {
      const fractionDigit = await cursor.peek();
      if (fractionDigit === undefined || fractionDigit < 0x30 || fractionDigit > 0x39) break;
      await cursor.read();
      value += (fractionDigit - 0x30) * fractionScale;
      fractionScale *= 0.1;
    }
  }
  let exponentValue = 0;
  let exponentNegative = false;
  const exponent = await cursor.peek();
  if (exponent === 0x65 || exponent === 0x45) {
    await cursor.read();
    const sign = await cursor.peek();
    if (sign === 0x2b || sign === 0x2d) {
      exponentNegative = sign === 0x2d;
      await cursor.read();
    }
    const digit = await cursor.peek();
    if (digit === undefined || digit < 0x30 || digit > 0x39) throw new Error("stored artifact JSON has an invalid exponent");
    while (true) {
      const exponentDigit = await cursor.peek();
      if (exponentDigit === undefined || exponentDigit < 0x30 || exponentDigit > 0x39) break;
      await cursor.read();
      exponentValue = Math.min(10_000, exponentValue * 10 + (exponentDigit - 0x30));
    }
  }
  const scaled = value === 0
    ? 0
    : exponentValue === 0
    ? value
    : value * (10 ** (exponentNegative ? -exponentValue : exponentValue));
  return negative ? -scaled : scaled;
}

async function readLiteral(cursor: ByteCursor, literal: string): Promise<void> {
  for (const character of literal) await expectByte(cursor, character.charCodeAt(0), literal);
}

const ARRAY_VALUE_OR_CLOSE = 1;
const ARRAY_DELIMITER_OR_CLOSE = 2;
const OBJECT_KEY_OR_CLOSE = 3;
const OBJECT_DELIMITER_OR_CLOSE = 4;
const ARRAY_VALUE_AFTER_COMMA = 5;
const OBJECT_KEY_AFTER_COMMA = 6;

class FileBackedJsonStack {
  readonly #handle: FileHandle;
  readonly #start: number;
  readonly #page = Buffer.allocUnsafe(IO_CHUNK_BYTES);
  #pageIndex = 0;
  #pageLength = 0;

  constructor(handle: FileHandle, start: number) {
    this.#handle = handle;
    this.#start = start;
  }

  get depth(): number {
    return this.#pageIndex * this.#page.byteLength + this.#pageLength;
  }

  async push(state: number): Promise<void> {
    if (this.#pageLength === this.#page.byteLength) {
      await writeAll(
        this.#handle,
        this.#page,
        this.#start + this.#pageIndex * this.#page.byteLength,
      );
      this.#pageIndex += 1;
      this.#pageLength = 0;
    }
    this.#page[this.#pageLength] = state;
    this.#pageLength += 1;
  }

  async top(): Promise<number> {
    if (this.#pageLength === 0) throw new Error("stored artifact JSON parser stack is empty");
    return this.#page[this.#pageLength - 1];
  }

  async replaceTop(state: number): Promise<void> {
    if (this.#pageLength === 0) throw new Error("stored artifact JSON parser stack is empty");
    this.#page[this.#pageLength - 1] = state;
  }

  async pop(): Promise<void> {
    if (this.#pageLength === 0) throw new Error("stored artifact JSON parser stack is empty");
    this.#pageLength -= 1;
    if (this.#pageLength !== 0 || this.#pageIndex === 0) return;
    this.#pageIndex -= 1;
    const { bytesRead } = await this.#handle.read(
      this.#page,
      0,
      this.#page.byteLength,
      this.#start + this.#pageIndex * this.#page.byteLength,
    );
    if (bytesRead !== this.#page.byteLength) {
      throw new VerifiedArtifactOperationalError({ cause: new Error("JSON parser stack page ended early") });
    }
    this.#pageLength = this.#page.byteLength;
  }
}

async function skipJsonValue(cursor: ByteCursor, stack: FileBackedJsonStack): Promise<void> {
  const startValue = async (): Promise<boolean> => {
    await skipWhitespace(cursor);
    const next = await cursor.peek();
    if (next === 0x22) {
      await readJsonString(cursor);
      return true;
    }
    if (next === 0x7b) {
      await cursor.read();
      await stack.push(OBJECT_KEY_OR_CLOSE);
      return false;
    }
    if (next === 0x5b) {
      await cursor.read();
      await stack.push(ARRAY_VALUE_OR_CLOSE);
      return false;
    }
    if (next === 0x74) await readLiteral(cursor, "true");
    else if (next === 0x66) await readLiteral(cursor, "false");
    else if (next === 0x6e) await readLiteral(cursor, "null");
    else await readNumber(cursor);
    return true;
  };

  if (await startValue()) return;
  while (stack.depth > 0) {
    await skipWhitespace(cursor);
    const state = await stack.top();
    if (state === ARRAY_VALUE_OR_CLOSE || state === ARRAY_VALUE_AFTER_COMMA) {
      if (state === ARRAY_VALUE_OR_CLOSE && await cursor.peek() === 0x5d) {
        await cursor.read();
        await stack.pop();
      } else {
        await stack.replaceTop(ARRAY_DELIMITER_OR_CLOSE);
        await startValue();
      }
    } else if (state === ARRAY_DELIMITER_OR_CLOSE) {
      const delimiter = await cursor.read();
      if (delimiter === 0x5d) await stack.pop();
      else if (delimiter === 0x2c) await stack.replaceTop(ARRAY_VALUE_AFTER_COMMA);
      else throw new Error("stored artifact JSON array expected comma or close");
    } else if (state === OBJECT_KEY_OR_CLOSE || state === OBJECT_KEY_AFTER_COMMA) {
      if (state === OBJECT_KEY_OR_CLOSE && await cursor.peek() === 0x7d) {
        await cursor.read();
        await stack.pop();
      } else {
        await readJsonString(cursor);
        await skipWhitespace(cursor);
        await expectByte(cursor, 0x3a, ":");
        await stack.replaceTop(OBJECT_DELIMITER_OR_CLOSE);
        await startValue();
      }
    } else if (state === OBJECT_DELIMITER_OR_CLOSE) {
      const delimiter = await cursor.read();
      if (delimiter === 0x7d) await stack.pop();
      else if (delimiter === 0x2c) await stack.replaceTop(OBJECT_KEY_AFTER_COMMA);
      else throw new Error("stored artifact JSON object expected comma or close");
    } else {
      throw new VerifiedArtifactOperationalError({ cause: new Error("JSON parser stack state is invalid") });
    }
  }
}

async function parseRefObject(
  cursor: ByteCursor,
  stack: FileBackedJsonStack,
  expected: ArtifactRef,
): Promise<ParsedRefObject> {
  await expectByte(cursor, 0x7b, "{");
  const candidate: RefCandidate = {};
  let unknown = false;
  let mediaTypeMatchesExpected = true;
  await skipWhitespace(cursor);
  if (await cursor.peek() === 0x7d) {
    await cursor.read();
    return { value: candidate, mediaTypeMatchesExpected };
  }
  while (true) {
    const key = (await readJsonString(cursor, 32)).ascii;
    await skipWhitespace(cursor);
    await expectByte(cursor, 0x3a, ":");
    await skipWhitespace(cursor);
    if (key === "id" || key === "sha256") {
      if (await cursor.peek() === 0x22) candidate[key] = (await readJsonString(cursor, 512)).ascii;
      else {
        candidate[key] = undefined;
        await skipJsonValue(cursor, stack);
      }
    } else if (key === "mediaType") {
      if (await cursor.peek() === 0x22) {
        const comparison = await readJsonString(cursor, 0, expected.mediaType);
        candidate.mediaType = expected.mediaType;
        mediaTypeMatchesExpected = comparison.matchesExpected === true;
      } else {
        candidate.mediaType = undefined;
        mediaTypeMatchesExpected = false;
        await skipJsonValue(cursor, stack);
      }
    } else if (key === "bytes") {
      const next = await cursor.peek();
      if (next === 0x2d || (next !== undefined && next >= 0x30 && next <= 0x39)) {
        candidate.bytes = await readNumber(cursor);
      } else {
        candidate.bytes = undefined;
        await skipJsonValue(cursor, stack);
      }
    } else {
      unknown = true;
      await skipJsonValue(cursor, stack);
    }
    await skipWhitespace(cursor);
    const delimiter = await cursor.read();
    if (delimiter === 0x7d) break;
    if (delimiter !== 0x2c) throw new Error("stored artifact ref expected comma or close");
    await skipWhitespace(cursor);
  }
  return { value: unknown ? undefined : candidate, mediaTypeMatchesExpected };
}

async function parseEnvelope(
  handle: FileHandle,
  expected: ArtifactRef,
  signal: AbortSignal | undefined,
): Promise<ParsedEnvelope> {
  const sourceBytes = (await handle.stat()).size;
  if (!Number.isSafeInteger(sourceBytes)) {
    throw new VerifiedArtifactOperationalError({ cause: new Error("stored envelope size is not safely addressable") });
  }
  const cursor = new ByteCursor(handle, 0, sourceBytes, signal);
  const stack = new FileBackedJsonStack(handle, sourceBytes);
  await skipWhitespace(cursor);
  await expectByte(cursor, 0x7b, "{");
  let ref: unknown;
  let refMediaTypeMatchesExpected = true;
  let payload: PayloadCandidate | undefined;
  let hasUnknownProperty = false;
  await skipWhitespace(cursor);
  if (await cursor.peek() !== 0x7d) {
    while (true) {
      const key = (await readJsonString(cursor, 64)).ascii;
      await skipWhitespace(cursor);
      await expectByte(cursor, 0x3a, ":");
      await skipWhitespace(cursor);
      if (key === "ref") {
        if (await cursor.peek() === 0x7b) {
          const parsedRef = await parseRefObject(cursor, stack, expected);
          ref = parsedRef.value;
          refMediaTypeMatchesExpected = parsedRef.mediaTypeMatchesExpected;
        }
        else {
          ref = undefined;
          await skipJsonValue(cursor, stack);
        }
      } else if (key === "payloadBase64") {
        if (await cursor.peek() === 0x22) {
          const string = await readJsonString(cursor);
          payload = { state: "string", start: string.start, end: string.end };
        } else {
          payload = { state: "invalid" };
          await skipJsonValue(cursor, stack);
        }
      } else {
        hasUnknownProperty = true;
        await skipJsonValue(cursor, stack);
      }
      await skipWhitespace(cursor);
      const delimiter = await cursor.read();
      if (delimiter === 0x7d) break;
      if (delimiter !== 0x2c) throw new Error("stored artifact envelope expected comma or close");
      await skipWhitespace(cursor);
    }
  } else {
    await cursor.read();
  }
  await skipWhitespace(cursor);
  if (await cursor.read() !== undefined) throw new Error("stored artifact JSON has trailing content");
  return Object.freeze({ ref, refMediaTypeMatchesExpected, payload, hasUnknownProperty });
}

function base64Value(byte: number): number | undefined {
  if (byte >= 0x41 && byte <= 0x5a) return byte - 0x41;
  if (byte >= 0x61 && byte <= 0x7a) return byte - 0x61 + 26;
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30 + 52;
  if (byte === 0x2b) return 62;
  if (byte === 0x2f) return 63;
  return undefined;
}

async function decodeStringSpan(
  handle: FileHandle,
  span: PayloadSpan,
  signal: AbortSignal | undefined,
  onChunk: (bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  const cursor = new ByteCursor(handle, span.start, span.end, signal);
  let escaped = false;
  let unicodeDigits = 0;
  let codeUnit = 0;
  while (cursor.offset < span.end) {
    const sourceChunk = await cursor.readChunk();
    if (sourceChunk === undefined) throw new Error("stored artifact payload string ended early");
    const decoded = Buffer.allocUnsafe(sourceChunk.byteLength);
    let decodedLength = 0;
    for (const byte of sourceChunk) {
      if (unicodeDigits > 0) {
        const value = hexValue(byte);
        if (value === undefined) throw new Error("artifact payload has an invalid unicode escape");
        codeUnit = codeUnit * 16 + value;
        unicodeDigits -= 1;
        if (unicodeDigits === 0) {
          if (codeUnit > 0x7f) throw new Error("artifact payload is not canonical base64");
          decoded[decodedLength] = codeUnit;
          decodedLength += 1;
        }
        continue;
      }
      if (escaped) {
        escaped = false;
        if (byte === 0x75) {
          unicodeDigits = 4;
          codeUnit = 0;
          continue;
        }
        const escapedByte = byte === 0x22 || byte === 0x5c || byte === 0x2f ? byte
          : byte === 0x62 ? 0x08
            : byte === 0x66 ? 0x0c
              : byte === 0x6e ? 0x0a
                : byte === 0x72 ? 0x0d
                  : byte === 0x74 ? 0x09
                    : undefined;
        if (escapedByte === undefined) throw new Error("artifact payload has an invalid JSON escape");
        decoded[decodedLength] = escapedByte;
        decodedLength += 1;
        continue;
      }
      if (byte === 0x5c) {
        escaped = true;
        continue;
      }
      if (byte > 0x7f) throw new Error("artifact payload is not canonical base64");
      decoded[decodedLength] = byte;
      decodedLength += 1;
    }
    if (decodedLength > 0) await onChunk(decoded.subarray(0, decodedLength));
  }
  if (escaped) throw new Error("artifact payload has an incomplete JSON escape");
  if (unicodeDigits !== 0) throw new Error("artifact payload has an invalid unicode escape");
}

async function verifyOrPreparePayload(
  snapshot: FileHandle,
  span: PayloadSpan,
  ref: ArtifactRef,
  prepared: FileHandle | undefined,
  signal: AbortSignal | undefined,
  observeIo: ServerVerifiedArtifactReaderOptions["observeIo"],
  injectFault: ServerVerifiedArtifactReaderOptions["injectFault"],
): Promise<void> {
  const digest = createHash("sha256");
  const quartet = Buffer.allocUnsafe(4);
  let quartetLength = 0;
  let outputOffset = 0;
  let persistedOffset = 0;
  const outputBuffer = Buffer.allocUnsafe(IO_CHUNK_BYTES - 1);
  let bufferedBytes = 0;
  let sawPadding = false;
  const flushOutput = async (): Promise<void> => {
    if (bufferedBytes === 0) return;
    const chunk = outputBuffer.subarray(0, bufferedBytes);
    digest.update(chunk);
    if (prepared !== undefined) {
      injectOperationalFault(injectFault, "prepared-write");
      await writeAll(prepared, chunk, persistedOffset);
      observeIo?.("prepared-write", chunk.byteLength);
    }
    persistedOffset += chunk.byteLength;
    bufferedBytes = 0;
  };
  const emit = (byte: number): void => {
    if (outputOffset >= ref.bytes) throw new Error(`artifact ${ref.id} exceeds its authoritative byte size`);
    outputBuffer[bufferedBytes] = byte;
    bufferedBytes += 1;
    outputOffset += 1;
  };
  const flushQuartet = (): void => {
    const [a, b, c, d] = quartet;
    if (a === 0x3d || b === 0x3d) throw new Error(`artifact ${ref.id} has invalid base64 padding`);
    const av = base64Value(a);
    const bv = base64Value(b);
    if (av === undefined || bv === undefined) throw new Error(`artifact ${ref.id} has invalid base64 payload`);
    if (c === 0x3d) {
      if (d !== 0x3d || (bv & 0x0f) !== 0) throw new Error(`artifact ${ref.id} has invalid base64 padding`);
      sawPadding = true;
      emit((av << 2) | (bv >> 4));
    } else {
      const cv = base64Value(c);
      if (cv === undefined) throw new Error(`artifact ${ref.id} has invalid base64 payload`);
      if (d === 0x3d) {
        if ((cv & 0x03) !== 0) throw new Error(`artifact ${ref.id} has invalid base64 padding`);
        sawPadding = true;
        emit((av << 2) | (bv >> 4));
        emit(((bv & 0x0f) << 4) | (cv >> 2));
      } else {
        const dv = base64Value(d);
        if (dv === undefined) throw new Error(`artifact ${ref.id} has invalid base64 payload`);
        emit((av << 2) | (bv >> 4));
        emit(((bv & 0x0f) << 4) | (cv >> 2));
        emit(((cv & 0x03) << 6) | dv);
      }
    }
    quartetLength = 0;
  };
  await decodeStringSpan(snapshot, span, signal, async (characters) => {
    signal?.throwIfAborted();
    for (const byte of characters) {
      if (sawPadding) throw new Error(`artifact ${ref.id} has data after base64 padding`);
      if (base64Value(byte) === undefined && byte !== 0x3d) throw new Error(`artifact ${ref.id} has invalid base64 payload`);
      quartet[quartetLength] = byte;
      quartetLength += 1;
      if (quartetLength === 4) {
        flushQuartet();
        if (bufferedBytes === outputBuffer.byteLength) await flushOutput();
      }
    }
  });
  if (quartetLength !== 0) throw new Error(`artifact ${ref.id} has non-canonical base64 length`);
  await flushOutput();
  if (outputOffset !== ref.bytes) throw new Error(`artifact ${ref.id} byte length does not match stored content`);
  if (digest.digest("hex") !== ref.sha256) throw new Error(`artifact ${ref.id} content digest does not match ${ref.sha256}`);
}

async function verifyPrepared(
  handle: FileHandle,
  ref: ArtifactRef,
  signal: AbortSignal | undefined,
  observeIo: ServerVerifiedArtifactReaderOptions["observeIo"],
  injectFault: ServerVerifiedArtifactReaderOptions["injectFault"],
): Promise<void> {
  const digest = createHash("sha256");
  let offset = 0;
  while (offset < ref.bytes) {
    signal?.throwIfAborted();
    injectOperationalFault(injectFault, "prepared-read");
    const buffer = Buffer.allocUnsafe(Math.min(IO_CHUNK_BYTES, ref.bytes - offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset);
    if (bytesRead === 0) {
      throw new VerifiedArtifactOperationalError({
        cause: new Error(`artifact ${ref.id} prepared bytes ended early`),
      });
    }
    observeIo?.("prepared-read", bytesRead);
    digest.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  const extra = Buffer.allocUnsafe(1);
  if ((await handle.read(extra, 0, 1, offset)).bytesRead !== 0) {
    throw new VerifiedArtifactOperationalError({
      cause: new Error(`artifact ${ref.id} prepared bytes exceed their authority`),
    });
  }
  if (digest.digest("hex") !== ref.sha256) {
    throw new VerifiedArtifactOperationalError({
      cause: new Error(`artifact ${ref.id} prepared bytes failed verification`),
    });
  }
}

function isPhysicalObjectMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAborted(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && error === signal.reason;
}

function hasNodeIoFailure(error: unknown, seen = new Set<unknown>()): boolean {
  if (seen.has(error)) return false;
  seen.add(error);
  if (error instanceof AggregateError) {
    if (error.errors.some((nested) => hasNodeIoFailure(nested, seen))) return true;
  }
  if (error instanceof Error) {
    if ("code" in error && typeof error.code === "string" && error.code !== "ABORT_ERR") return true;
    if (error.cause !== undefined && hasNodeIoFailure(error.cause, seen)) return true;
  }
  return false;
}

function hasOperationalFailure(error: unknown, seen = new Set<unknown>()): boolean {
  if (seen.has(error)) return false;
  seen.add(error);
  if (error instanceof VerifiedArtifactOperationalError) return true;
  if (error instanceof AggregateError) {
    if (error.errors.some((nested) => hasOperationalFailure(nested, seen))) return true;
  }
  return error instanceof Error
    && error.cause !== undefined
    && hasOperationalFailure(error.cause, seen);
}

function operationalFailure(error: unknown): VerifiedArtifactOperationalError {
  return error instanceof VerifiedArtifactOperationalError
    ? error
    : new VerifiedArtifactOperationalError({ cause: error });
}

function injectOperationalFault(
  injectFault: ServerVerifiedArtifactReaderOptions["injectFault"],
  point: VerifiedArtifactFaultPoint,
): void {
  try {
    injectFault?.(point);
  } catch (error: unknown) {
    throw operationalFailure(error);
  }
}

function primaryFirstAggregate(primary: unknown, cleanup: unknown, message: string): AggregateError {
  return new AggregateError([primary, cleanup], message, { cause: primary });
}

async function closeTransientHandle(
  handle: FileHandle,
  kind: "source" | "snapshot" | "prepared",
  options: Pick<ServerVerifiedArtifactReaderOptions, "injectFault" | "observeHandleClosed">,
  onActualClose?: () => void,
): Promise<void> {
  let injected: unknown;
  try {
    options.injectFault?.(`${kind}-close`);
  } catch (error: unknown) {
    injected = error;
  }
  try {
    await handle.close();
  } catch (cleanup: unknown) {
    if (injected !== undefined) {
      throw primaryFirstAggregate(injected, cleanup, `verified artifact ${kind} injected close and actual close both failed`);
    }
    throw operationalFailure(cleanup);
  }
  onActualClose?.();
  options.observeHandleClosed?.(kind, handle);
  if (injected !== undefined) throw operationalFailure(injected);
}

async function inspectSnapshot(
  snapshot: FileHandle,
  expected: ArtifactRef,
  prepared: FileHandle | undefined,
  signal: AbortSignal | undefined,
  observeIo: ServerVerifiedArtifactReaderOptions["observeIo"],
  injectFault: ServerVerifiedArtifactReaderOptions["injectFault"],
): Promise<void> {
  const envelope = await parseEnvelope(snapshot, expected, signal);
  if (envelope.hasUnknownProperty) throw new Error(`artifact ${expected.id} stored envelope has unknown properties`);
  const storedRef = ArtifactRefSchema.parse(envelope.ref);
  if (!envelope.refMediaTypeMatchesExpected
    || storedRef.id !== expected.id || storedRef.sha256 !== expected.sha256
    || storedRef.bytes !== expected.bytes || storedRef.mediaType !== expected.mediaType) {
    throw new Error(`artifact ${expected.id} metadata does not match stored content`);
  }
  if (envelope.payload?.state !== "string") throw new Error(`artifact ${expected.id} stored envelope lacks a string payload`);
  await verifyOrPreparePayload(snapshot, envelope.payload, expected, prepared, signal, observeIo, injectFault);
}

function createLease(
  handle: FileHandle,
  ref: ArtifactRef,
  admission: RuntimeAdmission,
  observeIo: ServerVerifiedArtifactReaderOptions["observeIo"],
  injectFault: ServerVerifiedArtifactReaderOptions["injectFault"],
  observeLeaseClosed: ServerVerifiedArtifactReaderOptions["observeLeaseClosed"],
  observeRetainedBytes: ServerVerifiedArtifactReaderOptions["observeRetainedBytes"],
): VerifiedByteLease {
  let taken = false;
  let closed = false;
  let offset = 0;
  let closePromise: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    closed = true;
    closePromise = (async (): Promise<void> => {
      let injected: unknown;
      try {
        injectFault?.("lease-close");
      } catch (error: unknown) {
        injected = error;
      }
      try {
        await handle.close();
      } catch (cleanup: unknown) {
        if (injected !== undefined) {
          throw primaryFirstAggregate(injected, cleanup, "verified artifact injected close and actual close both failed");
        }
        throw operationalFailure(cleanup);
      }
      observeLeaseClosed?.();
      if (injected !== undefined) throw operationalFailure(injected);
    })();
    return closePromise;
  };
  return Object.freeze({
    ref: Object.freeze(ref),
    async takeBody() {
      try { admission.assertLive(); }
      catch (error: unknown) { await dispose(); throw error; }
      if (taken) throw new Error(`verified artifact ${ref.id} body lease is single-use`);
      if (closed) throw new Error(`verified artifact ${ref.id} body lease is disposed`);
      taken = true;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          try { admission.assertLive(); }
          catch (error: unknown) { await dispose(); controller.error(error); return; }
          if (closed) {
            controller.error(new Error(`verified artifact ${ref.id} body lease closed before EOF`));
            return;
          }
          if (offset === ref.bytes) {
            try {
              await dispose();
              controller.close();
            } catch (error: unknown) {
              controller.error(error);
            }
            return;
          }
          try {
            injectOperationalFault(injectFault, "lease-read");
            observeRetainedBytes?.("lease-read", IO_CHUNK_BYTES * 2);
            const buffer = Buffer.allocUnsafe(Math.min(IO_CHUNK_BYTES, ref.bytes - offset));
            const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset);
            admission.assertLive();
            if (bytesRead === 0) {
              throw new VerifiedArtifactOperationalError({
                cause: new Error(`verified artifact ${ref.id} body ended before its authoritative length`),
              });
            }
            observeIo?.("prepared-read", bytesRead);
            offset += bytesRead;
            controller.enqueue(Uint8Array.from(buffer.subarray(0, bytesRead)));
          } catch (error: unknown) {
            try {
              await dispose();
              controller.error(error);
            } catch (cleanup: unknown) {
              controller.error(primaryFirstAggregate(error, cleanup, "verified artifact body and cleanup both failed"));
            }
          }
        },
        async cancel() {
          await dispose();
        },
      });
    },
    dispose,
  });
}

export function createServerVerifiedArtifactReader(
  options: ServerVerifiedArtifactReaderOptions,
): ServerVerifiedArtifactReader & { readonly ready: Promise<void> } {
  const admission = requireRuntimeAdmission(options.admission);
  admission.assertWritable();
  const rootsPromise = initializeRoots(admission);
  const inspect = async (
    refInput: ArtifactRef,
    signal: AbortSignal | undefined,
    retain: boolean,
  ): Promise<VerifiedByteLease | undefined> => {
    admission.assertLive();
    admission.assertArtifactRoot(admission.artifactRoot);
    admission.assertStateRoot(admission.stateRoot);
    const ref = ArtifactRefSchema.parse(refInput);
    let roots: ReaderRoots;
    try {
      roots = await rootsPromise;
      admission.assertLive();
    } catch (error: unknown) {
      if (isAborted(error, signal)) throw error;
      throw operationalFailure(error);
    }
    let snapshot: FileHandle;
    try {
      options.observeRetainedBytes?.("snapshot", IO_CHUNK_BYTES);
      snapshot = await snapshotArtifact(
        roots,
        ref,
        signal,
        options.observeIo,
        options.injectFault,
        options.observeHandleClosed,
      );
    } catch (error: unknown) {
      if (isAborted(error, signal) || error instanceof VerifiedArtifactSourceMissingError) throw error;
      throw operationalFailure(error);
    }
    let prepared: FileHandle | undefined;
    let snapshotClosed = false;
    try {
      admission.assertLive();
      if (retain) {
        prepared = await createAnonymousScratch(
          roots.scratchRoot,
          "prepared",
          { injectFault: options.injectFault, observeHandleClosed: options.observeHandleClosed },
        );
      }
      options.observeRetainedBytes?.("parse-and-decode", IO_CHUNK_BYTES * 4);
      await inspectSnapshot(snapshot, ref, prepared, signal, options.observeIo, options.injectFault);
      admission.assertLive();
      await closeTransientHandle(snapshot, "snapshot", options, () => {
        snapshotClosed = true;
      });
      if (prepared === undefined) return undefined;
      injectOperationalFault(options.injectFault, "prepared-sync");
      await prepared.sync();
      options.observeRetainedBytes?.("prepared-verify", IO_CHUNK_BYTES);
      await verifyPrepared(prepared, ref, signal, options.observeIo, options.injectFault);
      admission.assertLive();
      signal?.throwIfAborted();
      return createLease(
        prepared,
        ref,
        admission,
        options.observeIo,
        options.injectFault,
        options.observeLeaseClosed,
        options.observeRetainedBytes,
      );
    } catch (error: unknown) {
      let primary = error;
      if (!snapshotClosed) {
        try {
          await closeTransientHandle(snapshot, "snapshot", options);
        } catch (cleanup: unknown) {
          primary = primaryFirstAggregate(
            error,
            cleanup,
            "verified artifact inspection and snapshot cleanup both failed",
          );
        }
      }
      if (prepared !== undefined) {
        try {
          await closeTransientHandle(prepared, "prepared", options);
        } catch (cleanup: unknown) {
          primary = primaryFirstAggregate(
            primary,
            cleanup,
            "verified artifact inspection and prepared cleanup both failed",
          );
        }
      }
      if (isAborted(primary, signal)) throw primary;
      if (hasOperationalFailure(primary) || hasNodeIoFailure(primary)) {
        throw operationalFailure(primary);
      }
      throw primary;
    }
  };
  const reader: ServerVerifiedArtifactReader & { readonly ready: Promise<void> } = {
    // Await root initialization before serving; use a getter to avoid an unobserved derived rejection.
    get ready(): Promise<void> {
      return rootsPromise.then(() => { admission.assertLive(); });
    },
    async verify(ref: ArtifactRef, signal?: AbortSignal) {
      await inspect(ref, signal, false);
    },
    async prepare(ref: ArtifactRef, signal?: AbortSignal) {
      const lease = await inspect(ref, signal, true);
      if (lease === undefined) throw new Error("verified artifact prepare did not produce a lease");
      return lease;
    },
  };
  return Object.freeze(reader);
}
