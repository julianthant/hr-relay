// The largest worksheet XML the spreadsheet tests build is about 8 MB. 200 MB is a
// wide margin over that, and the same number caps each part and the archive total.
export const SPREADSHEET_INFLATED_BYTE_LIMIT = 200 * 1024 * 1024;

const STORE_MAGIC = '\u0000\u0000';
const DEFLATE_MAGIC = '\u0008\u0000';

export class SpreadsheetInflateLimitError extends Error {
  constructor() {
    super(`inflated spreadsheet bytes exceed ${String(SPREADSHEET_INFLATED_BYTE_LIMIT)}`);
    this.name = 'SpreadsheetInflateLimitError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function compressedPayload(entry: object): { readonly method: 'store' | 'deflate'; readonly bytes: Uint8Array } {
  if (!isRecord(entry)) throw new Error('spreadsheet archive entry is missing its compressed payload');
  const data = entry._data;
  if (!isRecord(data)) throw new Error('spreadsheet archive entry is missing its compressed payload');
  const compression = data.compression;
  const content = data.compressedContent;
  if (!isRecord(compression) || typeof compression.magic !== 'string' || !(content instanceof Uint8Array)) {
    throw new Error('spreadsheet archive entry is missing its compressed payload');
  }
  if (compression.magic === STORE_MAGIC) return { method: 'store', bytes: content };
  if (compression.magic === DEFLATE_MAGIC) return { method: 'deflate', bytes: content };
  throw new Error(`spreadsheet archive entry uses compression ${JSON.stringify(compression.magic)}`);
}

function add(count: { bytes: number }, amount: number): void {
  count.bytes += amount;
  if (count.bytes > SPREADSHEET_INFLATED_BYTE_LIMIT) throw new SpreadsheetInflateLimitError();
}

async function countDeflated(bytes: Uint8Array, part: { bytes: number }, total: { bytes: number }): Promise<void> {
  const reader = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  let failure: unknown;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw new Error('spreadsheet inflate produced a non-binary chunk');
      add(part, next.value.byteLength);
      add(total, next.value.byteLength);
    }
  } catch (error) {
    failure = error;
  }
  // A failed cancel is its own failure. It must not replace the inflate error the readers already map.
  try {
    await reader.cancel();
  } catch (error) {
    if (failure === undefined) failure = error;
    else if (failure instanceof Error && error !== failure && failure.cause === undefined) failure.cause = error;
  }
  if (failure instanceof Error) throw failure;
  if (failure !== undefined) throw new Error('spreadsheet inflate failed', { cause: failure });
}

export async function assertSpreadsheetWithinInflateLimit(data: ArrayBuffer | Uint8Array): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const archive = await JSZip.loadAsync(data);
  const total = { bytes: 0 };
  for (const entry of Object.values(archive.files)) {
    if (entry.dir) continue;
    const payload = compressedPayload(entry);
    if (payload.method === 'store') {
      const part = { bytes: 0 };
      add(part, payload.bytes.byteLength);
      add(total, payload.bytes.byteLength);
      continue;
    }
    await countDeflated(payload.bytes, { bytes: 0 }, total);
  }
}
