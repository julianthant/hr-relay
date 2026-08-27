/**
 * The phone-capture corpus for parity adapter #1 (ref frontend-backend-integration §7.2, 2i-F).
 *
 * Nothing here is a hand-typed payload. Every session below is built and then
 * PARSED by `CaptureSessionWireSchema` — the same schema the real capture
 * service parses its own output through — so a reference is a photograph of
 * something the product could actually serve. A field the contract would refuse
 * cannot reach a screenshot, and a change to the contract moves the picture
 * rather than quietly disagreeing with it.
 *
 * The photographs are real PNG bytes, generated here from the page number
 * rather than checked in as a blob: the phone fetches each page's bytes through
 * its own route and renders them, so a fixture that served a placeholder would
 * be photographing a code path the product does not have. They are deliberately
 * page-SHAPED and page-COLOURED (ink bands on stock) so a tile reads as a
 * scanned form, and each page's bands sit differently so reordering three tiles
 * is visible in a still image.
 */
import { deflateSync } from "node:zlib";
import {
  CaptureSessionWireSchema,
  type CaptureSessionWire,
} from "../../../src/domain/capture-surface.js";
import {
  CaptureOperatorSessionListWireSchema,
  CaptureOperatorSessionWireSchema,
  type CaptureOperatorSessionListWire,
  type CaptureOperatorSessionWire,
} from "../../../src/domain/capture-operator.js";

/* ── identities ──────────────────────────────────────────────────────────── */

/**
 * Four sessions, because the states worth photographing are four different
 * things the phone can be looking at, and the phone addresses a session by the
 * TOKEN it was handed — never by an id in a URL. A token here is a fixed 43
 * base64url characters, exactly what `CaptureTokenSchema` admits.
 */
export const FIXTURE_CAPTURE_TOKENS = Object.freeze({
  empty: "Hs4Kk1Zt7Qb2Ne9Xf0Rc6Yv3Lw8Ma5Jd1Gp4Su7Th0e",
  photos: "Qm2Vx8Bd4Nf1Zt6Kc9Rw3Ly7Ha0Jp5Ge2Su8Md4Xb1p",
  sent: "Zr7Nc3Kf9Hb2Vt5Xq8Ld1Mw4Ja6Gy0Pe3Su9Bd7Tn2s",
  failed: "Lp5Hd9Kw2Nb7Zc4Xf1Vt8Ma3Jr6Ge0Sy5Qu2Bd8Nn4f",
});

/** The one the unit tests speak; the phone never sees more than one at a time. */
export const FIXTURE_CAPTURE_TOKEN = FIXTURE_CAPTURE_TOKENS.photos;

export const FIXTURE_CAPTURE_SESSION_IDS = Object.freeze({
  empty: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  photos: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
  sent: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
  failed: "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f8a",
});

/** Page one, two, three — in the order the operator photographed them. */
export const FIXTURE_CAPTURE_PHOTO_IDS: readonly string[] = Object.freeze([
  "5e6f7a8b-9c0d-4e1f-8a3b-4c5d6e7f8a9b",
  "6f7a8b9c-0d1e-4f2a-9b4c-5d6e7f8a9b0c",
  "7a8b9c0d-1e2f-4a3b-8c5d-6e7f8a9b0c1d",
]);

const ARTIFACT_IDS: readonly string[] = Object.freeze([
  "8b9c0d1e-2f3a-4b4c-9d6e-7f8a9b0c1d2e",
  "9c0d1e2f-3a4b-4c5d-8e7f-8a9b0c1d2e3f",
  "0d1e2f3a-4b5c-4d6e-9f8a-9b0c1d2e3f4a",
]);

const FINAL_ARTIFACT_ID = "1e2f3a4b-5c6d-4e7f-8a9b-0c1d2e3f4a5b";
const FINAL_SHA256 = "9f2c6b1a8e4d7053c9b8a2f14e6d3057b1c8a94f2e6d05713c8b9a2f4e6d0571";
const HANDOFF_RUN_ID = "2f3a4b5c-6d7e-4f8a-9b0c-1d2e3f4a5b6c";
const HANDOFF_MANIFEST_ID = "3a4b5c6d-7e8f-4a9b-8c1d-2e3f4a5b6c7d";

const WORKFLOW = "person-lookup";
const CREATED_AT = "2026-08-05T09:12:04.000-07:00";
const CONNECTED_AT = "2026-08-05T09:12:31.000-07:00";
const EXPIRES_AT = "2026-08-05T09:42:31.000-07:00";

/**
 * The operator's own words, which is what the phone's header shows. A workflow
 * id is a routing fact and means nothing to someone at a filing cabinet; this
 * is how they know they are photographing the right stack.
 */
const FORM_TYPE = "Timekeeper change form";
const CONTEXT_HINT = "Cohort 7 onboarding — the four in the blue folder";

/* ── the photographs ─────────────────────────────────────────────────────── */

/**
 * The real page proportion, at a size a phone tile actually renders. 612 × 792
 * pt is US Letter, measured from the packet the OCR fixtures are built on, and
 * the same ratio `--ds-aspect-page` carries — so the image fills its frame
 * rather than letterboxing inside it for a reason that is about the fixture.
 */
const PAGE_WIDTH = 153;
const PAGE_HEIGHT = 198;

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

/**
 * A minimal 8-bit greyscale PNG. Written out rather than depended on because
 * the whole point of a derived fixture is that the bytes on screen are produced
 * by something readable — and an encoder that can only emit one colour depth
 * and one filter has nowhere to be subtly wrong.
 */
function greyscalePng(width: number, height: number, pixel: (x: number, y: number) => number): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0; // filter type 0 (None) on every scanline
    for (let x = 0; x < width; x += 1) raw[y * (width + 1) + 1 + x] = pixel(x, y);
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 0; // colour type: greyscale
  const chunks = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", new Uint8Array(deflateSync(raw))),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
}

/**
 * One photographed page: stock, a ruled header block, and body lines whose
 * indent differs per page so three tiles are told apart at thumbnail size —
 * which is what makes a reorder reference show a reorder rather than three
 * identical grey rectangles.
 */
function pageImage(page: number): Uint8Array {
  return greyscalePng(PAGE_WIDTH, PAGE_HEIGHT, (x, y) => {
    const margin = 14;
    const inside = x > margin && x < PAGE_WIDTH - margin;
    if (!inside) return 244;
    // The header rule, at a depth that steps down the stack.
    if (y > 18 + page * 6 && y < 30 + page * 6) return 60;
    // Body lines: every 12th row, indented differently on each page.
    const bodyStart = 46 + page * 6;
    if (y > bodyStart && y % 12 < 5 && x > margin + page * 10 && x < PAGE_WIDTH - margin - 8) {
      return 120;
    }
    return 250;
  });
}

/** Photo id → the exact bytes that page's route serves. */
export const FIXTURE_CAPTURE_PHOTO_BYTES: ReadonlyMap<string, Uint8Array> = new Map(
  FIXTURE_CAPTURE_PHOTO_IDS.map((photoId, index) => [photoId, pageImage(index + 1)]),
);

/* ── the sessions ────────────────────────────────────────────────────────── */

function photoWires(count: number): readonly unknown[] {
  return FIXTURE_CAPTURE_PHOTO_IDS.slice(0, count).map((photoId, index) => ({
    photoId,
    ordinal: index + 1,
    mediaType: "image/png",
    // The real byte length of the real image — not a plausible round number.
    bytes: (FIXTURE_CAPTURE_PHOTO_BYTES.get(photoId) ?? new Uint8Array(0)).byteLength,
    artifactId: ARTIFACT_IDS[index],
  }));
}

function sessionWire(input: Readonly<{
  sessionId: string;
  state: CaptureSessionWire["state"];
  photos: number;
  handoff: unknown;
  version: number;
  finalizationGeneration?: number;
  finalized?: boolean;
}>): CaptureSessionWire {
  return CaptureSessionWireSchema.parse({
    wireVersion: 1,
    sessionId: input.sessionId,
    workflow: WORKFLOW,
    formType: FORM_TYPE,
    contextHint: CONTEXT_HINT,
    state: input.state,
    photos: photoWires(input.photos),
    ...(input.finalized === true
      ? {
        finalArtifact: {
          artifactId: FINAL_ARTIFACT_ID,
          sha256: FINAL_SHA256,
          // The bundled PDF is the three pages plus its own structure; the
          // number is the sum of the real page bytes so it cannot drift from
          // what the tiles above it are showing.
          bytes: FIXTURE_CAPTURE_PHOTO_IDS
            .reduce((sum, id) => sum + (FIXTURE_CAPTURE_PHOTO_BYTES.get(id)?.byteLength ?? 0), 0),
        },
      }
      : {}),
    handoff: input.handoff,
    finalizationGeneration: input.finalizationGeneration ?? 0,
    version: input.version,
    createdAt: CREATED_AT,
    connectedAt: CONNECTED_AT,
    expiresAt: EXPIRES_AT,
    ingress: { mode: "forwarded", originDigest: FINAL_SHA256 },
  });
}

/** Nothing photographed yet — the camera is the only verb on screen. */
export const FIXTURE_CAPTURE_EMPTY = sessionWire({
  sessionId: FIXTURE_CAPTURE_SESSION_IDS.empty,
  state: "open",
  photos: 0,
  handoff: { state: "pending" },
  version: 2,
});

/** Three pages at rest. Also the session the reorder reference drives. */
export const FIXTURE_CAPTURE_PHOTOS = sessionWire({
  sessionId: FIXTURE_CAPTURE_SESSION_IDS.photos,
  state: "open",
  photos: 3,
  handoff: { state: "pending" },
  version: 5,
});

/** The handoff landed: the bundle is a run, and the phone says which one. */
export const FIXTURE_CAPTURE_SENT = sessionWire({
  sessionId: FIXTURE_CAPTURE_SESSION_IDS.sent,
  state: "finalized",
  photos: 3,
  handoff: { state: "enqueued", runId: HANDOFF_RUN_ID, intakeManifestId: HANDOFF_MANIFEST_ID },
  version: 7,
  finalizationGeneration: 1,
  finalized: true,
});

/**
 * The handoff failed, carrying the projector's OWN recorded reason. The phone
 * shows it verbatim because the person holding the phone is the one who has to
 * choose between Retry and Discard, and a failure id decides nothing for them.
 */
export const FIXTURE_CAPTURE_FAILED = sessionWire({
  sessionId: FIXTURE_CAPTURE_SESSION_IDS.failed,
  state: "failed",
  photos: 3,
  handoff: {
    state: "failed",
    message: "the bundle was assembled but the intake manifest could not be minted: "
      + "person-lookup declares no capture projection",
  },
  version: 7,
  finalizationGeneration: 1,
  finalized: true,
});

export const FIXTURE_CAPTURE_SESSIONS: Readonly<Record<string, CaptureSessionWire>> = Object.freeze({
  empty: FIXTURE_CAPTURE_EMPTY,
  photos: FIXTURE_CAPTURE_PHOTOS,
  sent: FIXTURE_CAPTURE_SENT,
  failed: FIXTURE_CAPTURE_FAILED,
});

/** Token → session, which is the only lookup the phone's routes ever perform. */
export const FIXTURE_CAPTURE_BY_TOKEN: Readonly<Record<string, CaptureSessionWire>> = Object.freeze({
  [FIXTURE_CAPTURE_TOKENS.empty]: FIXTURE_CAPTURE_EMPTY,
  [FIXTURE_CAPTURE_TOKENS.photos]: FIXTURE_CAPTURE_PHOTOS,
  [FIXTURE_CAPTURE_TOKENS.sent]: FIXTURE_CAPTURE_SENT,
  [FIXTURE_CAPTURE_TOKENS.failed]: FIXTURE_CAPTURE_FAILED,
});

/**
 * What Start Capture hands the operator, for the QR reference. The raw token
 * appears here and nowhere else — exactly as the real `201` does.
 */
export const FIXTURE_CAPTURE_START = Object.freeze({
  state: "started" as const,
  session: FIXTURE_CAPTURE_EMPTY,
  token: FIXTURE_CAPTURE_TOKENS.empty,
  phoneUrl: `https://capture.example/capture.html#t=${FIXTURE_CAPTURE_TOKENS.empty}`,
  ingressMode: "forwarded" as const,
});

/* ── the OPERATOR's half (D274 item 7, ledger 3 §7 CP2–CP21) ─────────────── */

/**
 * What the DESKTOP is served about the same three pages.
 *
 * Built from the SAME photo bytes as the phone fixtures above, so the two ends
 * of one session cannot disagree in a reference — and parsed by
 * `CaptureOperatorSessionWireSchema`, whose `superRefine` pins the phase to the
 * facts beside it, so a fixture claiming a phase it has not earned refuses to
 * exist.
 *
 * The three pages are deliberately one of each: a page the bundler parsed, a
 * page it REFUSED, and a page the artifact store could not read back. Those
 * last two are the surface's whole reason for existing and its one standing
 * hazard — a fixture where every page parsed would photograph a screen that
 * cannot be wrong.
 */
function operatorPage(index: number, image: unknown): unknown {
  const photoId = FIXTURE_CAPTURE_PHOTO_IDS[index];
  if (photoId === undefined) throw new Error(`the capture fixture holds no photograph ${String(index)}`);
  const bytes = FIXTURE_CAPTURE_PHOTO_BYTES.get(photoId);
  if (bytes === undefined) throw new Error(`the capture fixture holds no bytes for ${photoId}`);
  return {
    photoId,
    ordinal: index + 1,
    mediaType: "image/png",
    bytes: bytes.byteLength,
    artifactId: ARTIFACT_IDS[index],
    image,
  };
}

export const FIXTURE_CAPTURE_OPERATOR: CaptureOperatorSessionWire = CaptureOperatorSessionWireSchema.parse({
  wireVersion: 1,
  sessionId: FIXTURE_CAPTURE_SESSION_IDS.photos,
  workflow: WORKFLOW,
  formType: FORM_TYPE,
  contextHint: CONTEXT_HINT,
  state: "open",
  phase: "receiving",
  pages: [
    // The real PNG's own geometry, from the same generator the bytes come from.
    operatorPage(0, { state: "readable", pixelWidth: 612, pixelHeight: 792 }),
    operatorPage(1, {
      state: "unreadable",
      reason: "the PNG IHDR chunk declares a bit depth this decoder cannot read",
    }),
    operatorPage(2, {
      state: "unavailable",
      reason: "the artifact's stored digest does not match its bytes",
    }),
  ],
  handoff: { state: "pending" },
  finalizationGeneration: 0,
  version: 5,
  createdAt: CREATED_AT,
  connectedAt: CONNECTED_AT,
  expiresAt: EXPIRES_AT,
});

/** The active set the operator's picker reads (CP2). */
export const FIXTURE_CAPTURE_OPERATOR_LIST: CaptureOperatorSessionListWire =
  CaptureOperatorSessionListWireSchema.parse({
    wireVersion: 1,
    sessions: [{
      sessionId: FIXTURE_CAPTURE_OPERATOR.sessionId,
      workflow: FIXTURE_CAPTURE_OPERATOR.workflow,
      formType: FIXTURE_CAPTURE_OPERATOR.formType,
      state: FIXTURE_CAPTURE_OPERATOR.state,
      phase: FIXTURE_CAPTURE_OPERATOR.phase,
      pageCount: FIXTURE_CAPTURE_OPERATOR.pages.length,
      createdAt: FIXTURE_CAPTURE_OPERATOR.createdAt,
      connectedAt: FIXTURE_CAPTURE_OPERATOR.connectedAt,
      expiresAt: FIXTURE_CAPTURE_OPERATOR.expiresAt,
      version: FIXTURE_CAPTURE_OPERATOR.version,
    }],
  });
