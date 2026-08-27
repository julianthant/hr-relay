/**
 * Per-page image facts for the OPERATOR capture projection (D274 item 7,
 * ref dashboard-surfaces §10, ledger 3 §7 CP9/CP10/CP13).
 *
 * The desktop's unreadable-page fact is not a new judgement — it is the
 * finalize bundler's own refusal, surfaced BEFORE finalize. This reader runs
 * the recorded photo bytes through the SAME parse the bundler embeds with
 * (`embedCaptureImage`), so "this page cannot be read" on the desktop and
 * "this bundle refused page N" at finalize can never disagree about a page.
 *
 * Three distinguishable outcomes, never conflated:
 *
 * - `readable` — the parse yields the page's pixel geometry. Deterministic
 *   over immutable content, so it is cached by artifact id.
 * - `unreadable` — the parse REFUSES the recorded bytes; the reason is the
 *   parser's own sentence. Also deterministic, also cached: content-addressed
 *   bytes cannot become readable later.
 * - `unavailable` — the artifact could not be read back, or its bytes do not
 *   match the length and digest its ref names. This is an ERROR arm and is
 *   deliberately NEVER cached: a transient disk failure must be allowed to
 *   heal on the next read, and a pinned stale error would be its own silent
 *   fallback.
 */
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { ContentAddressedArtifactWriter } from "../../base/artifacts.js";
import type { CapturePhotoRef } from "../../domain/capture.js";
import {
  CapturePageImageFactSchema,
  type CapturePageImageFact,
} from "../../domain/capture-operator.js";
import { embedCaptureImage } from "./pdf-bytes.js";

export interface CapturePhotoImageFactReader {
  imageFactOf(photo: CapturePhotoRef): Promise<CapturePageImageFact>;
}

export interface CapturePhotoImageFactReaderOptions {
  readonly artifacts: Pick<ContentAddressedArtifactWriter, "open">;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCapturePhotoImageFactReader(
  options: CapturePhotoImageFactReaderOptions,
): CapturePhotoImageFactReader {
  /** Deterministic outcomes only — see the module doc. */
  const settled = new Map<string, CapturePageImageFact>();

  async function readVerifiedBytes(photo: CapturePhotoRef): Promise<Uint8Array> {
    const stream = await options.artifacts.open(photo.artifact);
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
      else if (chunk instanceof Uint8Array) chunks.push(Uint8Array.from(chunk));
      else throw new Error(`capture photo artifact ${String(photo.artifact.id)} emitted a non-byte chunk`);
    }
    const bytes = Uint8Array.from(Buffer.concat(chunks));
    if (bytes.byteLength !== photo.artifact.bytes) {
      throw new Error(
        `capture photo artifact ${String(photo.artifact.id)} read back ${String(bytes.byteLength)} bytes `
        + `but its ref names ${String(photo.artifact.bytes)}`,
      );
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== photo.artifact.sha256) {
      throw new Error(
        `capture photo artifact ${String(photo.artifact.id)} read back digest ${digest} `
        + `but its ref names ${String(photo.artifact.sha256)}`,
      );
    }
    return bytes;
  }

  return Object.freeze({
    async imageFactOf(photo: CapturePhotoRef): Promise<CapturePageImageFact> {
      const key = String(photo.artifact.id);
      const cached = settled.get(key);
      if (cached !== undefined) return cached;

      let bytes: Uint8Array;
      try {
        bytes = await readVerifiedBytes(photo);
      } catch (error) {
        // NOT cached: a read-back failure may be transient, and pinning it
        // would keep reporting a disk fault the next read no longer has.
        return CapturePageImageFactSchema.parse({ state: "unavailable", reason: messageOf(error) });
      }

      let image: { width: number; height: number } | undefined;
      let refusal: string | undefined;
      try {
        image = embedCaptureImage(String(photo.photoId), photo.artifact.mediaType, bytes);
      } catch (error) {
        // The bundler's own refusal, verbatim — the operator-facing
        // unreadable-page fact IS this sentence (never a fabricated score).
        refusal = messageOf(error);
      }
      // The readable arm is assembled OUTSIDE the catch: a parse that
      // "succeeded" with degenerate geometry is a defect and throws loud here
      // rather than masquerading as an unreadable page.
      const fact: CapturePageImageFact = image === undefined
        ? CapturePageImageFactSchema.parse({ state: "unreadable", reason: refusal })
        : CapturePageImageFactSchema.parse({
          state: "readable",
          pixelWidth: image.width,
          pixelHeight: image.height,
        });
      settled.set(key, fact);
      return fact;
    },
  });
}
