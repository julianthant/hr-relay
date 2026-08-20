/**
 * The capture PDF bundler (ref data-intake-and-edit-data §5.1, D167) — the real implementation of
 * `finalize-projector.ts`'s `CaptureBundler` seam.
 *
 * The seam's contract is one word: DETERMINISTIC. The finalize projector may
 * crash after bundling and before its settlement transaction, and its whole
 * recovery argument is that the replay bundles the SAME bytes so the
 * content-addressed put converges by digest instead of minting a second
 * artifact. That is why this file writes the PDF itself rather than reaching
 * for a library that stamps a creation date, a producer version, or a random
 * `/ID`: an "identical" bundle whose bytes differ is a second artifact, and a
 * second artifact is exactly the lost handoff D167 exists to prevent.
 *
 * So: no `/CreationDate`, no `/ModDate`, no `/Producer`, no wall clock, no
 * randomness. `/ID` is a SHA-256 fold over the ordered photo digests, which
 * makes it a function of the input and nothing else. Every emitted number goes
 * through `pdfNumber`, and every photo rides in un-re-encoded (`pdf-bytes.ts`).
 *
 * Integrity is checked at read, not assumed: a photo whose bytes do not match
 * the digest and length its `ArtifactRef` names is refused by artifact id.
 * Bundling a photo that is not what the session recorded would put the wrong
 * evidence in front of an operator, and content-addressed storage means the
 * mismatch is a real corruption signal, never a benign difference.
 */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { ContentAddressedArtifactWriter } from "../../base/artifacts.js";
import type { ArtifactRef } from "../../domain/artifacts.js";
import type { CaptureFinalizationOutbox } from "../../domain/capture.js";
import type { CaptureBundler } from "./finalize-projector.js";
import { embedCaptureImage, pdfNumber, type EmbeddedImage } from "./pdf-bytes.js";

/** US Letter, in PDF user-space points. */
const PAGE_WIDTH_PT = 612;
const PAGE_HEIGHT_PT = 792;

/** 1 catalog + 1 page tree, then page / contents / image per photo. */
const CATALOG_OBJECT = 1;
const PAGE_TREE_OBJECT = 2;
const OBJECTS_PER_PHOTO = 3;

/** The classic binary marker comment: it tells a transport this file is not text. */
const BINARY_MARKER_COMMENT = Object.freeze([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

/** Both `/ID` array entries are this many hex characters (16 bytes). */
const DOCUMENT_ID_HEX_LENGTH = 32;

export interface CapturePdfBundlerOptions {
  readonly artifacts: Pick<ContentAddressedArtifactWriter, "open">;
}

interface PhotoPlacement {
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

async function drainArtifact(stream: Readable): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(Uint8Array.from(chunk));
    else throw new Error("a capture photo stream emitted a non-byte chunk");
  }
  return Uint8Array.from(Buffer.concat(chunks));
}

/**
 * Reads one photo and proves it is the artifact the ref names. A digest that
 * does not match is corruption or a mis-wired ref — never something to bundle
 * anyway and sort out later.
 */
async function readVerifiedPhoto(
  artifacts: Pick<ContentAddressedArtifactWriter, "open">,
  ref: ArtifactRef,
): Promise<Uint8Array> {
  const bytes = await drainArtifact(await artifacts.open(ref));
  if (bytes.byteLength !== ref.bytes) {
    throw new Error(
      `capture photo artifact ${String(ref.id)} read back ${bytes.byteLength} bytes but its ref names ${ref.bytes}`,
    );
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== ref.sha256) {
    throw new Error(
      `capture photo artifact ${String(ref.id)} read back digest ${digest} but its ref names ${String(ref.sha256)}`,
    );
  }
  return bytes;
}

/** Fit inside the page, aspect preserved, centred. */
function placeOnPage(image: EmbeddedImage): PhotoPlacement {
  const scale = Math.min(PAGE_WIDTH_PT / image.width, PAGE_HEIGHT_PT / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { width, height, x: (PAGE_WIDTH_PT - width) / 2, y: (PAGE_HEIGHT_PT - height) / 2 };
}

/**
 * Writes the whole file: header, objects in a fixed order, a real `xref` table
 * of byte offsets, trailer, `startxref`, `%%EOF`.
 */
function buildCapturePdf(images: readonly EmbeddedImage[], documentId: string): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const objectOffsets = new Map<number, number>();
  const emittedPageObjects: number[] = [];
  let offset = 0;

  const raw = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const write = (text: string): void => { raw(encoder.encode(text)); };
  const beginObject = (objectNumber: number): void => {
    objectOffsets.set(objectNumber, offset);
    write(`${objectNumber} 0 obj\n`);
  };
  const endObject = (): void => { write("endobj\n"); };
  const writeStreamObject = (objectNumber: number, dictionaryEntries: readonly string[], data: Uint8Array): void => {
    beginObject(objectNumber);
    write(`<< ${[...dictionaryEntries, `/Length ${data.length}`].join(" ")} >>\nstream\n`);
    raw(data);
    write("\nendstream\n");
    endObject();
  };

  const pageObject = (index: number): number => CATALOG_OBJECT + PAGE_TREE_OBJECT + index * OBJECTS_PER_PHOTO;

  write("%PDF-1.7\n");
  raw(Uint8Array.from(BINARY_MARKER_COMMENT));

  beginObject(CATALOG_OBJECT);
  write(`<< /Type /Catalog /Pages ${PAGE_TREE_OBJECT} 0 R >>\n`);
  endObject();

  const kids = images.map((_image, index) => `${pageObject(index)} 0 R`).join(" ");
  beginObject(PAGE_TREE_OBJECT);
  write(`<< /Type /Pages /Count ${images.length} /Kids [${kids}] >>\n`);
  endObject();

  for (const [index, image] of images.entries()) {
    const pageNumber = pageObject(index);
    const contentsNumber = pageNumber + 1;
    const imageNumber = pageNumber + 2;
    const placement = placeOnPage(image);

    beginObject(pageNumber);
    write(
      `<< /Type /Page /Parent ${PAGE_TREE_OBJECT} 0 R `
      + `/MediaBox [0 0 ${pdfNumber(PAGE_WIDTH_PT)} ${pdfNumber(PAGE_HEIGHT_PT)}] `
      + `/Resources << /XObject << /Im0 ${imageNumber} 0 R >> >> /Contents ${contentsNumber} 0 R >>\n`,
    );
    endObject();
    emittedPageObjects.push(pageNumber);

    writeStreamObject(contentsNumber, [], encoder.encode(
      `q\n${pdfNumber(placement.width)} 0 0 ${pdfNumber(placement.height)} `
      + `${pdfNumber(placement.x)} ${pdfNumber(placement.y)} cm\n/Im0 Do\nQ`,
    ));

    writeStreamObject(imageNumber, [
      "/Type /XObject",
      "/Subtype /Image",
      `/Width ${image.width}`,
      `/Height ${image.height}`,
      `/ColorSpace /${image.colorSpace}`,
      "/BitsPerComponent 8",
      `/Filter /${image.filter}`,
      ...image.extraEntries,
    ], image.data);
  }

  // Ref data-intake-and-edit-data §5.1: the bundle validates its own page count. A page tree that
  // claims more pages than were emitted is a silently short document.
  if (emittedPageObjects.length !== images.length) {
    throw new Error(
      `capture bundle emitted ${emittedPageObjects.length} pages for ${images.length} photos`,
    );
  }

  const size = PAGE_TREE_OBJECT + images.length * OBJECTS_PER_PHOTO + 1;
  const startXref = offset;
  write(`xref\n0 ${size}\n`);
  write("0000000000 65535 f \n");
  for (let objectNumber = 1; objectNumber < size; objectNumber += 1) {
    const objectOffset = objectOffsets.get(objectNumber);
    if (objectOffset === undefined) {
      throw new Error(`capture bundle xref names object ${objectNumber}, which was never emitted`);
    }
    write(`${String(objectOffset).padStart(10, "0")} 00000 n \n`);
  }
  write(
    `trailer\n<< /Size ${size} /Root ${CATALOG_OBJECT} 0 R /ID [<${documentId}> <${documentId}>] >>\n`
    + `startxref\n${startXref}\n%%EOF\n`,
  );

  return Uint8Array.from(Buffer.concat(chunks));
}

/**
 * The deterministic bundler. Same ordered photo set → byte-identical output,
 * on any machine, at any time.
 */
export function createCapturePdfBundler(options: CapturePdfBundlerOptions): CaptureBundler {
  return Object.freeze({
    async bundle(outbox: CaptureFinalizationOutbox): Promise<Uint8Array> {
      const refs = outbox.orderedPhotoArtifacts;
      if (refs.length === 0) {
        throw new Error(`capture outbox ${String(outbox.outboxId)} carries no photos to bundle`);
      }
      const images: EmbeddedImage[] = [];
      const documentIdFold = createHash("sha256");
      for (const ref of refs) {
        const bytes = await readVerifiedPhoto(options.artifacts, ref);
        images.push(embedCaptureImage(String(ref.id), ref.mediaType, bytes));
        // Order is meaning: the fold consumes the digests in page order.
        documentIdFold.update(`${String(ref.sha256)}\n`);
      }
      if (images.length !== refs.length) {
        throw new Error(`capture bundle prepared ${images.length} pages for ${refs.length} photos`);
      }
      return buildCapturePdf(images, documentIdFold.digest("hex").slice(0, DOCUMENT_ID_HEX_LENGTH));
    },
  });
}
