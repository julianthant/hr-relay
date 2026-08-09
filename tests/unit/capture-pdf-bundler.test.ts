/**
 * The deterministic capture PDF bundler (doc 06 §5.1, D167, 2i-F).
 *
 * D167's crash-window argument is the whole reason this file exists: the
 * finalize projector may die after bundling and before its settlement
 * transaction, and the replay is only safe because the SAME ordered photo set
 * bundles to the SAME bytes — the content-addressed put then converges by
 * digest instead of minting a second artifact and a second handoff. So the
 * first case is byte identity across two bundles, and its negative control is
 * that a DIFFERENT order is different bytes: order is meaning, not decoration.
 *
 * Every image case is driven by a REAL file from a real encoder
 * (`fixtures/capture-image-fixtures.ts`). A refusal arm pointed at a
 * hand-rolled header would only prove the parser reads headers; pointed at an
 * actual progressive JPEG out of Pillow it proves the thing that matters —
 * that a file a phone or a scanner can genuinely produce, and which
 * `/DCTDecode` would render as a blank page, is refused by name.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { inflateSync } from "node:zlib";
import { describe, it } from "vitest";
import { pdf } from "pdf-to-img";
import { ArtifactRefSchema, type ArtifactRef } from "../../src/domain/artifacts.js";
import { CaptureFinalizationOutboxSchema, type CaptureFinalizationOutbox } from "../../src/domain/capture.js";
import type { ContentAddressedArtifactWriter } from "../../src/base/artifacts.js";
import { createCapturePdfBundler } from "../../src/infra/capture/pdf-bundler.js";
import { NOW } from "./fixtures/phase1c-contract-fixtures.js";
import {
  BASELINE_JPEG_BASE64,
  CMYK_JPEG_BASE64,
  GRAYSCALE_JPEG_BASE64,
  INTERLACED_PNG_BASE64,
  PALETTE_PNG_BASE64,
  PROGRESSIVE_JPEG_BASE64,
  RGBA_PNG_BASE64,
  SIXTEEN_BIT_PNG_BASE64,
  TRNS_PNG_BASE64,
  TRUECOLOUR_PNG_BASE64,
  fixtureBytes,
} from "./fixtures/capture-image-fixtures.js";

const OUTBOX_ID = "0b0b0b0b-0000-4000-8000-00000000000b";
const SESSION_ID = "05e55105-0000-4000-8000-000000000005";
const STABLE_KEY = "c".repeat(64);

function artifactId(index: number): string {
  const tail = String(index).padStart(2, "0");
  return `a11fac70-0000-4000-8000-0000000000${tail}`;
}

/** A photo the way authority holds one: a whole `ArtifactRef` over real bytes. */
interface Photo {
  readonly ref: ArtifactRef;
  readonly bytes: Uint8Array;
}

function photo(index: number, base64: string, mediaType: string): Photo {
  const bytes = fixtureBytes(base64);
  return {
    bytes,
    ref: ArtifactRefSchema.parse({
      id: artifactId(index),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
      mediaType,
    }),
  };
}

const JPEG_PHOTO = photo(1, BASELINE_JPEG_BASE64, "image/jpeg");
const PNG_PHOTO = photo(2, TRUECOLOUR_PNG_BASE64, "image/png");

/**
 * The store seam, keyed by DIGEST — so a ref carrying a wrong digest reads
 * nothing back rather than silently getting the right bytes anyway.
 */
function artifactStore(photos: readonly Photo[]): Pick<ContentAddressedArtifactWriter, "open"> {
  const byDigest = new Map(photos.map((item) => [item.ref.sha256, item.bytes] as const));
  return {
    open: (ref: ArtifactRef) => {
      const bytes = byDigest.get(ref.sha256);
      if (bytes === undefined) throw new Error(`test store holds no artifact for digest ${String(ref.sha256)}`);
      return Promise.resolve(Readable.from([Buffer.from(bytes)]));
    },
  };
}

function outboxOver(refs: readonly ArtifactRef[]): CaptureFinalizationOutbox {
  return CaptureFinalizationOutboxSchema.parse({
    outboxId: OUTBOX_ID,
    sessionId: SESSION_ID,
    generation: 1,
    stableKey: STABLE_KEY,
    orderedPhotoArtifacts: refs,
    workflow: "person-lookup",
    state: "pending",
    createdAt: NOW,
  });
}

async function bundle(photos: readonly Photo[], stored?: readonly Photo[]): Promise<Uint8Array> {
  const bundler = createCapturePdfBundler({ artifacts: artifactStore(stored ?? photos) });
  return bundler.bundle(outboxOver(photos.map((item) => item.ref)));
}

async function refusalFrom(photos: readonly Photo[]): Promise<string> {
  try {
    await bundle(photos);
  } catch (error) {
    // Re-read, never swallowed: the message IS the assertion subject.
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("the bundler accepted a photo it must refuse");
}

const decoder = new TextDecoder("latin1");

/** Locates `<number> 0 obj` through the file's own xref table. */
function xrefOffsets(bytes: Uint8Array): readonly number[] {
  const text = decoder.decode(bytes);
  const startXref = /startxref\n(\d+)\n%%EOF/u.exec(text);
  assert.ok(startXref, "the trailer names its xref offset");
  const xrefStart = Number(startXref[1]);
  assert.equal(text.slice(xrefStart, xrefStart + 4), "xref", "startxref points at the xref table");
  const header = /^xref\n0 (\d+)\n/u.exec(text.slice(xrefStart));
  assert.ok(header, "the xref table declares its size");
  const size = Number(header[1]);
  const entriesAt = xrefStart + header[0].length;
  const offsets: number[] = [];
  for (let index = 1; index < size; index += 1) {
    const entry = text.slice(entriesAt + index * 20, entriesAt + (index + 1) * 20);
    assert.match(entry, /^\d{10} 00000 n \n$/u, `xref entry ${index} is a 20-byte in-use record`);
    offsets.push(Number(entry.slice(0, 10)));
  }
  return offsets;
}

/** The exact stream bytes of object `objectNumber`, read through the xref. */
function streamOf(bytes: Uint8Array, objectNumber: number): Uint8Array {
  const offsets = xrefOffsets(bytes);
  const offset = offsets[objectNumber - 1];
  assert.ok(offset !== undefined, `object ${objectNumber} has an xref entry`);
  const text = decoder.decode(bytes);
  assert.ok(text.startsWith(`${objectNumber} 0 obj\n`, offset), `object ${objectNumber} lives at its xref offset`);
  const length = /\/Length (\d+) >>\nstream\n/u.exec(text.slice(offset));
  assert.ok(length, `object ${objectNumber} is a stream with a /Length`);
  const dataAt = offset + length.index + length[0].length;
  return bytes.subarray(dataAt, dataAt + Number(length[1]));
}

function dictionaryOf(bytes: Uint8Array, objectNumber: number): string {
  const offsets = xrefOffsets(bytes);
  const offset = offsets[objectNumber - 1];
  assert.ok(offset !== undefined, `object ${objectNumber} has an xref entry`);
  const text = decoder.decode(bytes).slice(offset);
  const end = text.indexOf(">>\n");
  assert.ok(end > 0, `object ${objectNumber} has a dictionary`);
  return text.slice(0, end + 2);
}

describe("capture pdf bundler", () => {
  it("bundles the same ordered photo set to byte-identical output, and a different order to different bytes", async () => {
    const first = await bundle([JPEG_PHOTO, PNG_PHOTO]);
    const second = await bundle([JPEG_PHOTO, PNG_PHOTO]);
    assert.deepEqual(
      [...first],
      [...second],
      "the D167 replay depends on this: a re-bundle must converge by digest, not mint a second artifact",
    );

    const reversed = await bundle([PNG_PHOTO, JPEG_PHOTO]);
    assert.notDeepEqual([...reversed], [...first], "order is meaning — a reordered set is a different document");
    assert.equal(reversed.byteLength > 0, true);

    // Nothing that varies with the machine or the moment may reach the bytes.
    const text = decoder.decode(first);
    for (const forbidden of ["/CreationDate", "/ModDate", "/Producer", "/Creator"]) {
      assert.equal(text.includes(forbidden), false, `${forbidden} would make two identical bundles differ`);
    }
    const id = /\/ID \[<([0-9a-f]{32})> <([0-9a-f]{32})>\]/u.exec(text);
    assert.ok(id, "the trailer carries a deterministic /ID");
    assert.equal(id[1], id[2]);
    const expected = createHash("sha256")
      .update(`${String(JPEG_PHOTO.ref.sha256)}\n${String(PNG_PHOTO.ref.sha256)}\n`)
      .digest("hex")
      .slice(0, 32);
    assert.equal(id[1], expected, "/ID is a fold over the ordered photo digests — a function of the input alone");
  });

  it("emits a real PDF whose xref offsets point at the objects they claim", async () => {
    const bytes = await bundle([JPEG_PHOTO, PNG_PHOTO]);
    const text = decoder.decode(bytes);
    assert.equal(text.startsWith("%PDF-1.7\n"), true);
    assert.equal(text.trimEnd().endsWith("%%EOF"), true);

    // `/Type /Pages` must not be miscounted as a page.
    const pages = text.match(/\/Type \/Page(?!s)/gu) ?? [];
    assert.equal(pages.length, 2, "one /Type /Page object per photo");
    assert.match(text, /\/Type \/Pages \/Count 2 \/Kids \[3 0 R 6 0 R\]/u);

    const offsets = xrefOffsets(bytes);
    assert.equal(offsets.length, 2 + 2 * 3, "catalog + page tree + three objects per photo");
    for (const [index, offset] of offsets.entries()) {
      assert.equal(
        text.startsWith(`${index + 1} 0 obj\n`, offset),
        true,
        `xref offset ${offset} must actually name object ${index + 1}`,
      );
    }

    // Geometry: fit inside US Letter, aspect preserved, centred.
    const jpegContent = decoder.decode(streamOf(bytes, 4));
    assert.equal(jpegContent, "q\n612 0 0 459 0 166.5 cm\n/Im0 Do\nQ", jpegContent);
    const pngContent = decoder.decode(streamOf(bytes, 7));
    assert.equal(pngContent, "q\n565.7143 0 0 792 23.1429 0 cm\n/Im0 Do\nQ", pngContent);
  });

  it("passes the photo bytes through un-re-encoded, and renders the declared page count", async () => {
    const bytes = await bundle([JPEG_PHOTO, PNG_PHOTO]);

    // (a) Pass-through, asserted on the bytes: the JPEG stream IS the file.
    assert.deepEqual([...streamOf(bytes, 5)], [...JPEG_PHOTO.bytes], "a JPEG rides in as /DCTDecode, verbatim");
    assert.match(dictionaryOf(bytes, 5), /\/Width 16 \/Height 12 \/ColorSpace \/DeviceRGB .*\/Filter \/DCTDecode/u);

    // The PNG stream is its own IDAT zlib stream: inflating it must yield the
    // exact filtered raster (one filter byte + 3 bytes per pixel per row),
    // which is what makes `/Predictor 15` the correct — not merely plausible —
    // declaration.
    assert.match(
      dictionaryOf(bytes, 8),
      /\/Filter \/FlateDecode \/DecodeParms << \/Predictor 15 \/Colors 3 \/BitsPerComponent 8 \/Columns 10 >>/u,
    );
    assert.equal(inflateSync(Buffer.from(streamOf(bytes, 8))).byteLength, 14 * (1 + 10 * 3));

    // (b) Round trip: pdfjs (through the repo's own `pdf-to-img`) opens the
    // produced bytes and reports exactly the declared pages.
    const document = await pdf(new Uint8Array(bytes));
    assert.equal(document.length, 2, "pdfjs must find one page per photo");
    const rendered: Buffer[] = [];
    for await (const page of document) {
      assert.equal(page.byteLength > 0, true, "a page that renders to nothing is a lost photo");
      rendered.push(page);
    }
    assert.equal(rendered.length, 2);
    // Two different photos must RASTERIZE differently. Identical renders is
    // exactly what a pair of blank pages would look like — a document that
    // parses and shows nothing is the failure this bundler exists to avoid.
    assert.equal(rendered[0].equals(rendered[1]), false, "each page must carry its own photo");
  });

  it("names the JPEG colour space from the frame's component count", async () => {
    const gray = await bundle([photo(3, GRAYSCALE_JPEG_BASE64, "image/jpeg")]);
    assert.match(dictionaryOf(gray, 5), /\/ColorSpace \/DeviceGray/u);

    // An Adobe APP14 CMYK JPEG stores INVERTED samples; embedding it without
    // the Decode array would put a colour-inverted page in front of an operator.
    const cmyk = await bundle([photo(4, CMYK_JPEG_BASE64, "image/jpeg")]);
    assert.match(dictionaryOf(cmyk, 5), /\/ColorSpace \/DeviceCMYK/u);
    assert.match(dictionaryOf(cmyk, 5), /\/Decode \[1 0 1 0 1 0 1 0\]/u);
    // verified 2026-08-09: both pages were rendered through pdfjs and read by
    // eye — the greyscale page is a grey ramp and the CMYK page reproduces the
    // source's blue→red→cyan→yellow layout. Without the Decode array the CMYK
    // page renders as its own photo-negative, which no assertion on the
    // dictionary alone would have caught.
    for (const bytes of [gray, cmyk]) {
      const document = await pdf(new Uint8Array(bytes));
      assert.equal(document.length, 1);
    }
  });

  it("refuses a photo whose stored bytes are not what its ref names", async () => {
    const wrongDigest = ArtifactRefSchema.parse({ ...JPEG_PHOTO.ref, sha256: "b".repeat(64) });
    const digestMessage = await refusalFrom([{ ref: wrongDigest, bytes: JPEG_PHOTO.bytes }]);
    assert.match(digestMessage, new RegExp(String(JPEG_PHOTO.ref.id), "u"));
    assert.match(digestMessage, /read back digest [0-9a-f]{64} but its ref names b{64}/u);

    const wrongLength = ArtifactRefSchema.parse({ ...JPEG_PHOTO.ref, bytes: JPEG_PHOTO.ref.bytes + 1 });
    const lengthMessage = await refusalFrom([{ ref: wrongLength, bytes: JPEG_PHOTO.bytes }]);
    assert.match(lengthMessage, new RegExp(String(JPEG_PHOTO.ref.id), "u"));
    assert.match(lengthMessage, /read back \d+ bytes but its ref names \d+/u);
  });

  it("refuses, by name, every encoding PDF's own filters cannot decode as-is", async () => {
    const arms = [
      { name: "progressive JPEG", photo: photo(5, PROGRESSIVE_JPEG_BASE64, "image/jpeg"), expect: /carries a progressive JPEG frame SOF2 \(progressive DCT\)/u },
      { name: "RGBA PNG", photo: photo(6, RGBA_PNG_BASE64, "image/png"), expect: /has PNG colour type 6 \[truecolour with alpha\]/u },
      { name: "palette PNG", photo: photo(7, PALETTE_PNG_BASE64, "image/png"), expect: /has PNG colour type 3 \[indexed-colour \/ palette\]/u },
      { name: "16-bit PNG", photo: photo(8, SIXTEEN_BIT_PNG_BASE64, "image/png"), expect: /is a 16-bit PNG/u },
      { name: "interlaced PNG", photo: photo(9, INTERLACED_PNG_BASE64, "image/png"), expect: /is an Adam7-interlaced PNG \(interlace method 1\)/u },
      { name: "tRNS PNG", photo: photo(10, TRNS_PNG_BASE64, "image/png"), expect: /carries a PNG tRNS transparency chunk/u },
      { name: "unsupported media type", photo: photo(11, BASELINE_JPEG_BASE64, "image/heic"), expect: /has media type image\/heic/u },
    ] as const;
    for (const arm of arms) {
      const message = await refusalFrom([arm.photo]);
      assert.match(message, arm.expect, `${arm.name}: ${message}`);
      assert.match(message, new RegExp(String(arm.photo.ref.id), "u"), `${arm.name} names the offending photo`);
    }
  });

  it("refuses a JPEG whose media type lies about its bytes", async () => {
    const mislabelled = photo(12, TRUECOLOUR_PNG_BASE64, "image/jpeg");
    assert.match(await refusalFrom([mislabelled]), /carries no JPEG SOI marker/u);
    const otherWay = photo(13, BASELINE_JPEG_BASE64, "image/png");
    assert.match(await refusalFrom([otherWay]), /carries no PNG signature/u);
  });
});
