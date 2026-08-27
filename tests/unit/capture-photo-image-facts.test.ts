/**
 * The per-page image-fact reader (D274 item 7) over the REAL content-addressed
 * artifact writer and REAL photographs — the same fixtures the bundler suite
 * proves itself on, so "readable here" and "bundles there" are one fact.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import type { ArtifactRef } from "../../src/domain/artifacts.js";
import { CapturePhotoRefSchema, type CapturePhotoRef } from "../../src/domain/capture.js";
import { createContentAddressedArtifactWriter } from "../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { createCapturePhotoImageFactReader } from "../../src/infra/capture/photo-image-facts.js";
import {
  BASELINE_JPEG_BASE64,
  TRUECOLOUR_PNG_BASE64,
  fixtureBytes,
} from "./fixtures/capture-image-fixtures.js";

const PHOTO_ID = "aaaaaaaa-0000-4000-8000-00000000000a";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

interface Harness {
  readonly artifacts: ReturnType<typeof createContentAddressedArtifactWriter>;
  readonly opens: () => number;
  readonly reader: ReturnType<typeof createCapturePhotoImageFactReader>;
}

function harness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "hrauto-capture-image-facts-"));
  cleanups.push(() => { rmSync(root, { recursive: true, force: true }); });
  const artifacts = createContentAddressedArtifactWriter({
    workspaceRoot: root,
    artifactRoot: ".tracker-rebuild/artifacts",
  });
  let openCount = 0;
  const reader = createCapturePhotoImageFactReader({
    artifacts: {
      open: async (ref) => {
        openCount += 1;
        return artifacts.open(ref);
      },
    },
  });
  return { artifacts, opens: () => openCount, reader };
}

function photoRef(artifact: ArtifactRef, ordinal = 1): CapturePhotoRef {
  return CapturePhotoRefSchema.parse({
    photoId: PHOTO_ID,
    artifact,
    ordinal,
    originalMediaType: artifact.mediaType,
  });
}

describe("readable pages carry their real pixel geometry", () => {
  it("reads the baseline JPEG as 16x12 and the truecolour PNG as 10x14", async () => {
    const h = harness();
    const jpeg = await h.artifacts.put(fixtureBytes(BASELINE_JPEG_BASE64), { mediaType: "image/jpeg" });
    const png = await h.artifacts.put(fixtureBytes(TRUECOLOUR_PNG_BASE64), { mediaType: "image/png" });

    assert.deepEqual(await h.reader.imageFactOf(photoRef(jpeg)), {
      state: "readable", pixelWidth: 16, pixelHeight: 12,
    });
    assert.deepEqual(await h.reader.imageFactOf(photoRef(png, 2)), {
      state: "readable", pixelWidth: 10, pixelHeight: 14,
    });
  });

  it("caches the deterministic fact by artifact id — one open, ever", async () => {
    const h = harness();
    const jpeg = await h.artifacts.put(fixtureBytes(BASELINE_JPEG_BASE64), { mediaType: "image/jpeg" });
    await h.reader.imageFactOf(photoRef(jpeg));
    await h.reader.imageFactOf(photoRef(jpeg));
    assert.equal(h.opens(), 1, "immutable content is parsed once");
  });
});

describe("an unreadable page is the bundler's own refusal, verbatim", () => {
  it("refuses recorded garbage that claims to be a JPEG, naming the photo", async () => {
    const h = harness();
    const garbage = new TextEncoder().encode("not a photograph at all, but 40 bytes of it");
    const artifact = await h.artifacts.put(garbage, { mediaType: "image/jpeg" });

    const fact = await h.reader.imageFactOf(photoRef(artifact));
    assert.equal(fact.state, "unreadable");
    assert.match(
      (fact as { reason: string }).reason,
      new RegExp(PHOTO_ID),
      "the refusal names the photo it refuses",
    );
    // Deterministic too: content-addressed bytes cannot become readable later.
    await h.reader.imageFactOf(photoRef(artifact));
    assert.equal(h.opens(), 1);
  });
});

describe("unavailable is an ERROR arm, never cached and never conflated", () => {
  it("reports an artifact that cannot be read back, and retries on the next read", async () => {
    const h = harness();
    // A ref shaped like a real artifact that was never written.
    const missing: ArtifactRef = {
      id: "99999999-8888-4777-8666-555555555555",
      sha256: "a".repeat(64),
      bytes: 44,
      mediaType: "image/jpeg",
    } as ArtifactRef;

    const first = await h.reader.imageFactOf(photoRef(missing));
    assert.equal(first.state, "unavailable");
    assert.ok((first as { reason: string }).reason.length > 0, "the failure carries its own reason");

    const second = await h.reader.imageFactOf(photoRef(missing));
    assert.equal(second.state, "unavailable");
    assert.equal(h.opens(), 2, "a read-back failure is retried, not pinned");
  });

  it("reports bytes that do not match the length the ref names", async () => {
    const h = harness();
    const jpeg = await h.artifacts.put(fixtureBytes(BASELINE_JPEG_BASE64), { mediaType: "image/jpeg" });
    const lying: ArtifactRef = { ...jpeg, bytes: jpeg.bytes + 1 };

    const fact = await h.reader.imageFactOf(photoRef(lying));
    assert.equal(fact.state, "unavailable");
    // The store's own integrity refusal fires first ("metadata does not match
    // stored content"); the reader's read-back check is the second fence.
    assert.match((fact as { reason: string }).reason, /does not match|read back/);
  });
});
