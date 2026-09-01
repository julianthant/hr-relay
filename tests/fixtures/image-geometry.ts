/**
 * Minimal format facts for retained diagnostic-image fixtures.
 *
 * This is test-only verification of the bytes a fixture server publishes. It
 * deliberately derives dimensions from the image itself instead of copying
 * them from display metadata.
 */
export interface ImageGeometry {
  readonly width: number;
  readonly height: number;
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function readJpegGeometry(artifactId: string, bytes: Uint8Array): ImageGeometry {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(`diagnostic image ${artifactId} is declared image/jpeg but has no JPEG SOI marker`);
  }
  let cursor = 2;
  while (cursor < bytes.length) {
    if (bytes[cursor] !== 0xff) throw new Error(`diagnostic image ${artifactId} has a malformed JPEG marker at byte ${cursor}`);
    while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
    const marker = bytes[cursor];
    cursor += 1;
    if (marker === undefined || marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (cursor + 2 > bytes.length) throw new Error(`diagnostic image ${artifactId} ends where a JPEG segment length was expected`);
    const length = (bytes[cursor] << 8) | bytes[cursor + 1];
    if (length < 2 || cursor + length > bytes.length) {
      throw new Error(`diagnostic image ${artifactId} declares a JPEG segment that runs past its end`);
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 8) throw new Error(`diagnostic image ${artifactId} has a truncated JPEG frame header`);
      const height = (bytes[cursor + 3] << 8) | bytes[cursor + 4];
      const width = (bytes[cursor + 5] << 8) | bytes[cursor + 6];
      if (width <= 0 || height <= 0) throw new Error(`diagnostic image ${artifactId} declares invalid JPEG dimensions`);
      return { width, height };
    }
    cursor += length;
  }
  throw new Error(`diagnostic image ${artifactId} carries no JPEG frame header`);
}

function readPngGeometry(artifactId: string, bytes: Uint8Array): ImageGeometry {
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error(`diagnostic image ${artifactId} is declared image/png but has no PNG signature`);
  }
  const chunkLength = ((bytes[8] << 24) >>> 0) + (bytes[9] << 16) + (bytes[10] << 8) + bytes[11];
  const chunkType = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunkLength !== 13 || chunkType !== "IHDR") throw new Error(`diagnostic image ${artifactId} has no PNG IHDR header`);
  const width = ((bytes[16] << 24) >>> 0) + (bytes[17] << 16) + (bytes[18] << 8) + bytes[19];
  const height = ((bytes[20] << 24) >>> 0) + (bytes[21] << 16) + (bytes[22] << 8) + bytes[23];
  if (width <= 0 || height <= 0) throw new Error(`diagnostic image ${artifactId} declares invalid PNG dimensions`);
  return { width, height };
}

export function readImageGeometry(artifactId: string, mediaType: string, bytes: Uint8Array): ImageGeometry {
  if (mediaType === "image/jpeg") return readJpegGeometry(artifactId, bytes);
  if (mediaType === "image/png") return readPngGeometry(artifactId, bytes);
  throw new Error(`diagnostic image ${artifactId} has unsupported media type ${mediaType}`);
}
