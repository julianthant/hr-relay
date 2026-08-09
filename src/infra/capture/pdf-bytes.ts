/**
 * Image-format parsing for the capture PDF bundler (doc 06 §5.1, D167).
 *
 * The bundler NEVER re-encodes a photo: a JPEG rides into the page as a
 * `/DCTDecode` XObject and a PNG's own zlib stream rides in as `/FlateDecode`
 * with PDF predictor 15 (which IS PNG's per-scanline filtering). That keeps
 * the operator's evidence byte-identical to what the phone uploaded, and it
 * is what makes the whole bundle a pure function of the ordered photo set.
 *
 * Pass-through is only correct for the encodings PDF's own filters decode, so
 * everything else is REFUSED BY NAME rather than accepted and rendered wrong:
 *
 * - progressive / lossless / differential JPEG — `/DCTDecode` decodes baseline
 *   and extended sequential only. A progressive frame is not "slightly off":
 *   a viewer renders NOTHING, and the operator would file a blank page.
 * - a PNG with alpha, a palette, a `tRNS` chunk, a non-8 bit depth, or Adam7
 *   interlacing — each of those needs a real decode, and the tempting
 *   shortcut (drop the alpha, ignore the interlace) changes the picture.
 *
 * These are the only two formats the capture surface converts to; anything
 * else reaching here is a defect upstream, not a case to guess at.
 */

/** The colour spaces PDF names directly for a pass-through image. */
export type PdfColorSpace = "DeviceGray" | "DeviceRGB" | "DeviceCMYK";

export interface EmbeddedImage {
  readonly width: number;
  readonly height: number;
  readonly colorSpace: PdfColorSpace;
  readonly filter: "DCTDecode" | "FlateDecode";
  /**
   * Ordered, already-serialized extra image-dictionary entries (`/Key value`).
   * Ordered because the emitted bytes must not drift between two runs.
   */
  readonly extraEntries: readonly string[];
  /** The SOURCE bytes, verbatim — no re-encode, ever. */
  readonly data: Uint8Array;
}

/**
 * The ONE numeric formatter every emitted number goes through: at most four
 * decimals, no trailing zeros, no exponent, no `-0`. Two runs of the same
 * ordered photo set must produce the same bytes, and a stringified float is
 * exactly where that would quietly stop being true.
 */
export function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`pdf number ${String(value)} is not finite; a page geometry must be a real measurement`);
  }
  const rounded = Math.round(value * 10_000) / 10_000;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  const fixed = normalized.toFixed(4);
  if (!fixed.includes(".")) return fixed;
  const trimmed = fixed.replace(/0+$/u, "").replace(/\.$/u, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

interface JpegFrameKind {
  readonly name: string;
  readonly accepted: boolean;
  /** Why a refused frame cannot ride through `/DCTDecode` untouched. */
  readonly refusal: string;
}

/** Every SOF marker, so an unknown frame can never be read as a supported one. */
const JPEG_FRAME_KINDS = new Map<number, JpegFrameKind>([
  [0xc0, { name: "SOF0 (baseline DCT)", accepted: true, refusal: "" }],
  [0xc1, { name: "SOF1 (extended sequential DCT)", accepted: true, refusal: "" }],
  [0xc2, { name: "SOF2 (progressive DCT)", accepted: false, refusal: "progressive" }],
  [0xc3, { name: "SOF3 (lossless sequential)", accepted: false, refusal: "lossless" }],
  [0xc5, { name: "SOF5 (differential sequential DCT)", accepted: false, refusal: "differential" }],
  [0xc6, { name: "SOF6 (differential progressive DCT)", accepted: false, refusal: "progressive" }],
  [0xc7, { name: "SOF7 (differential lossless)", accepted: false, refusal: "lossless" }],
  [0xc9, { name: "SOF9 (extended sequential DCT, arithmetic)", accepted: true, refusal: "" }],
  [0xca, { name: "SOF10 (progressive DCT, arithmetic)", accepted: false, refusal: "progressive" }],
  [0xcb, { name: "SOF11 (lossless, arithmetic)", accepted: false, refusal: "lossless" }],
  [0xcd, { name: "SOF13 (differential sequential DCT, arithmetic)", accepted: false, refusal: "differential" }],
  [0xce, { name: "SOF14 (differential progressive DCT, arithmetic)", accepted: false, refusal: "progressive" }],
  [0xcf, { name: "SOF15 (differential lossless, arithmetic)", accepted: false, refusal: "lossless" }],
]);

const JPEG_COMPONENT_COLOR_SPACES = new Map<number, PdfColorSpace>([
  [1, "DeviceGray"],
  [3, "DeviceRGB"],
  [4, "DeviceCMYK"],
]);

const ADOBE_APP14_MARKER = 0xee;
const ADOBE_APP14_TAG = "Adobe";

function ascii(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

interface JpegFrame {
  readonly kind: JpegFrameKind;
  readonly precision: number;
  readonly width: number;
  readonly height: number;
  readonly components: number;
}

function readJpegFrame(photoId: string, marker: number, segment: Uint8Array): JpegFrame {
  const kind = JPEG_FRAME_KINDS.get(marker);
  if (kind === undefined) {
    throw new Error(
      `capture photo ${photoId} carries JPEG frame marker 0xff${marker.toString(16)}, which names no known SOF frame`,
    );
  }
  if (segment.length < 6) {
    throw new Error(`capture photo ${photoId} has a truncated JPEG ${kind.name} frame header`);
  }
  return {
    kind,
    precision: segment[0],
    height: (segment[1] << 8) | segment[2],
    width: (segment[3] << 8) | segment[4],
    components: segment[5],
  };
}

/**
 * Walks the JPEG marker segments to the frame header. Entropy-coded data
 * begins at SOS, so the walk stops there — a frame that has not been seen by
 * then is a JPEG this bundler will not guess at.
 */
function parseJpeg(photoId: string, bytes: Uint8Array): EmbeddedImage {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(`capture photo ${photoId} is declared image/jpeg but carries no JPEG SOI marker`);
  }
  let cursor = 2;
  let frame: JpegFrame | undefined;
  let adobeApp14 = false;
  while (cursor < bytes.length) {
    if (bytes[cursor] !== 0xff) {
      throw new Error(`capture photo ${photoId} has a malformed JPEG marker at byte ${cursor}`);
    }
    while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
    if (cursor >= bytes.length) {
      throw new Error(`capture photo ${photoId} ends inside a JPEG marker`);
    }
    const marker = bytes[cursor];
    cursor += 1;
    // Standalone markers carry no length: SOI, TEM, and the restart markers.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) break;
    if (cursor + 2 > bytes.length) {
      throw new Error(`capture photo ${photoId} ends where a JPEG segment length was expected`);
    }
    const length = (bytes[cursor] << 8) | bytes[cursor + 1];
    if (length < 2 || cursor + length > bytes.length) {
      throw new Error(`capture photo ${photoId} declares a JPEG segment of ${length} bytes that runs past its end`);
    }
    const segment = bytes.subarray(cursor + 2, cursor + length);
    if (marker === ADOBE_APP14_MARKER && ascii(segment.subarray(0, 5)) === ADOBE_APP14_TAG) adobeApp14 = true;
    if (JPEG_FRAME_KINDS.has(marker)) frame = readJpegFrame(photoId, marker, segment);
    if (marker === 0xda) break;
    cursor += length;
  }

  if (frame === undefined) {
    throw new Error(`capture photo ${photoId} carries no JPEG frame header, so its size and colour space are unknown`);
  }
  if (!frame.kind.accepted) {
    throw new Error(
      `capture photo ${photoId} carries a ${frame.kind.refusal} JPEG frame ${frame.kind.name}; PDF /DCTDecode `
      + "decodes only baseline and extended sequential JPEG, so the page would render nothing",
    );
  }
  if (frame.precision !== 8) {
    throw new Error(
      `capture photo ${photoId} carries a ${frame.precision}-bit JPEG frame ${frame.kind.name}; this bundler `
      + "embeds 8-bit samples only",
    );
  }
  if (frame.width <= 0 || frame.height <= 0) {
    throw new Error(`capture photo ${photoId} declares JPEG dimensions ${frame.width}x${frame.height}`);
  }
  const colorSpace = JPEG_COMPONENT_COLOR_SPACES.get(frame.components);
  if (colorSpace === undefined) {
    throw new Error(
      `capture photo ${photoId} is a ${frame.components}-component JPEG; PDF names a direct colour space for 1 `
      + "(DeviceGray), 3 (DeviceRGB) and 4 (DeviceCMYK) components only",
    );
  }
  // An Adobe APP14 marker means the CMYK samples are stored INVERTED (what
  // Photoshop and Pillow both write). Embedding them without the Decode array
  // would put a colour-inverted page in front of an operator.
  const inverted = colorSpace === "DeviceCMYK" && adobeApp14;
  return {
    width: frame.width,
    height: frame.height,
    colorSpace,
    filter: "DCTDecode",
    extraEntries: inverted ? ["/Decode [1 0 1 0 1 0 1 0]"] : [],
    data: bytes,
  };
}

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const PNG_COLOR_TYPE_NAMES = new Map<number, string>([
  [0, "greyscale"],
  [2, "truecolour"],
  [3, "indexed-colour / palette"],
  [4, "greyscale with alpha"],
  [6, "truecolour with alpha"],
]);

const PNG_PASS_THROUGH_COMPONENTS = new Map<number, number>([[0, 1], [2, 3]]);

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly components: number;
}

function readPngHeader(photoId: string, data: Uint8Array): PngHeader {
  if (data.length !== 13) {
    throw new Error(`capture photo ${photoId} has a ${data.length}-byte PNG IHDR chunk; PNG IHDR is 13 bytes`);
  }
  const width = readUint32(data, 0);
  const height = readUint32(data, 4);
  const bitDepth = data[8];
  const colorType = data[9];
  const compressionMethod = data[10];
  const filterMethod = data[11];
  const interlaceMethod = data[12];
  const components = PNG_PASS_THROUGH_COMPONENTS.get(colorType);
  if (components === undefined) {
    const name = PNG_COLOR_TYPE_NAMES.get(colorType) ?? "unknown";
    throw new Error(
      `capture photo ${photoId} has PNG colour type ${colorType} [${name}]; embedding it would mean decoding it, `
      + "and silently dropping a palette or an alpha channel would change the picture",
    );
  }
  if (bitDepth !== 8) {
    throw new Error(
      `capture photo ${photoId} is a ${bitDepth}-bit PNG; this bundler passes through 8-bit samples only`,
    );
  }
  if (interlaceMethod !== 0) {
    throw new Error(
      `capture photo ${photoId} is an Adam7-interlaced PNG (interlace method ${interlaceMethod}); its scanlines are `
      + "not the single raster a PDF predictor stream decodes",
    );
  }
  if (compressionMethod !== 0 || filterMethod !== 0) {
    throw new Error(
      `capture photo ${photoId} declares PNG compression method ${compressionMethod} and filter method `
      + `${filterMethod}; only the standard 0/0 pair is deflate with PDF predictor 15`,
    );
  }
  if (width <= 0 || height <= 0) {
    throw new Error(`capture photo ${photoId} declares PNG dimensions ${width}x${height}`);
  }
  return { width, height, bitDepth, colorType, components };
}

/**
 * PNG's IDAT chunks are ONE zlib stream cut at arbitrary boundaries, so the
 * embedded stream is their concatenation — never a per-chunk re-deflate.
 */
function parsePng(photoId: string, bytes: Uint8Array): EmbeddedImage {
  if (bytes.length < PNG_SIGNATURE.length
    || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error(`capture photo ${photoId} is declared image/png but carries no PNG signature`);
  }
  let cursor = PNG_SIGNATURE.length;
  let header: PngHeader | undefined;
  const idatChunks: Uint8Array[] = [];
  let sawEnd = false;
  while (cursor + 8 <= bytes.length) {
    const length = readUint32(bytes, cursor);
    const type = ascii(bytes.subarray(cursor + 4, cursor + 8));
    const dataStart = cursor + 8;
    if (dataStart + length + 4 > bytes.length) {
      throw new Error(`capture photo ${photoId} declares a PNG ${type} chunk of ${length} bytes that runs past its end`);
    }
    const data = bytes.subarray(dataStart, dataStart + length);
    if (type === "IHDR") {
      if (header !== undefined) throw new Error(`capture photo ${photoId} carries a second PNG IHDR chunk`);
      header = readPngHeader(photoId, data);
    } else if (type === "tRNS") {
      throw new Error(
        `capture photo ${photoId} carries a PNG tRNS transparency chunk; ignoring it would flatten transparency the `
        + "operator can see",
      );
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    cursor = dataStart + length + 4;
  }
  if (header === undefined) {
    throw new Error(`capture photo ${photoId} carries no PNG IHDR chunk, so its size and colour type are unknown`);
  }
  if (!sawEnd) throw new Error(`capture photo ${photoId} carries no PNG IEND chunk, so it is truncated`);
  if (idatChunks.length === 0) {
    throw new Error(`capture photo ${photoId} carries no PNG IDAT chunk, so it holds no image data`);
  }

  const total = idatChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const data = new Uint8Array(total);
  let written = 0;
  for (const chunk of idatChunks) {
    data.set(chunk, written);
    written += chunk.length;
  }
  return {
    width: header.width,
    height: header.height,
    colorSpace: header.components === 1 ? "DeviceGray" : "DeviceRGB",
    filter: "FlateDecode",
    // PNG's own per-scanline filtering IS PDF predictor 15.
    extraEntries: [
      `/DecodeParms << /Predictor 15 /Colors ${header.components} /BitsPerComponent ${header.bitDepth}`
      + ` /Columns ${header.width} >>`,
    ],
    data,
  };
}

/**
 * Reads one capture photo into a pass-through PDF image, refusing by name
 * anything PDF's own filters cannot decode as-is.
 */
export function embedCaptureImage(photoId: string, mediaType: string, bytes: Uint8Array): EmbeddedImage {
  if (mediaType === "image/jpeg") return parseJpeg(photoId, bytes);
  if (mediaType === "image/png") return parsePng(photoId, bytes);
  throw new Error(
    `capture photo ${photoId} has media type ${mediaType}; the capture bundler embeds image/jpeg and image/png only`,
  );
}
