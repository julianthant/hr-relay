/**
 * The phone-capture SURFACE contract (ref data-intake-and-edit-data §5.1, ref clock-config-secrets §capture ingress,
 * ref operator-trust §7, D174).
 *
 * `src/domain/capture.ts` owns what capture DURABLY records. This module owns
 * what the phone is allowed to reach and what it is allowed to see, and it is
 * deliberately the one place both halves are written down:
 *
 * - `CAPTURE_PHONE_ROUTES` is a CLOSED union. Ref operator-trust §7 permits exactly one
 *   exception to the loopback rule — a short-lived capture ingress — and only
 *   for these routes. The ingress allowlist and the server's own registration
 *   are both derived from this constant, so "the phone cannot reach the queue"
 *   is a fact about one list rather than an agreement between two.
 *
 * - The token is a CREDENTIAL. It rides the URL FRAGMENT of the QR payload
 *   (never a path segment, never a query string — ref clock-config-secrets bans secret-bearing
 *   URLs, and a fragment is not transmitted to any server) and reaches the API
 *   in the `X-Capture-Token` header. Only its digest is durable, and no wire
 *   below carries either form.
 *
 * - Enumeration is FAIL-CLOSED. `CapturePhoneRefusal` has exactly one arm for
 *   "this token does not name a live session you may act on", and an unknown,
 *   expired, discarded, or foreign token all produce it with the same message.
 *   A phone that could tell "no such session" from "not yours" would be an
 *   existence oracle over a public origin.
 */
import { z } from "zod";
import { deepFreeze } from "./immutability.js";
import {
  ArtifactIdSchema,
  CapturePhotoIdSchema,
  CaptureSessionIdSchema,
  FingerprintSchema,
  IntakeManifestIdSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  RunIdSchema,
  WorkflowIdSchema,
} from "./ids.js";
import { sha256Hex } from "./sha256.js";
import {
  CaptureIngressModeSchema,
  CaptureSessionIngressSchema,
  CaptureSessionStateSchema,
} from "./capture.js";

/* ── the token ───────────────────────────────────────────────────────────── */

/**
 * 32 bytes of randomness, base64url. Long enough that guessing is not a threat
 * model, short enough to survive a QR at a phone-camera distance.
 */
export const CaptureTokenSchema = z.string().regex(
  /^[A-Za-z0-9_-]{43}$/,
  "a capture token is 43 base64url characters (32 random bytes)",
);
export type CaptureToken = z.infer<typeof CaptureTokenSchema>;

/** The header the phone presents the token in. Never a path or a query value. */
export const CAPTURE_TOKEN_HEADER = "x-capture-token";

/** The fragment key the QR payload carries the token in. */
export const CAPTURE_TOKEN_FRAGMENT_KEY = "t";

/**
 * Domain-separated so a capture token digest can never collide with any other
 * fingerprint in authority, and so the raw token is not recoverable from the
 * durable row.
 */
export function deriveCaptureTokenDigest(token: string): string {
  return FingerprintSchema.parse(sha256Hex(`hrauto:capture-token:v1\0${CaptureTokenSchema.parse(token)}`));
}

/** The URL the QR encodes. The token is in the fragment, deliberately. */
export function capturePhoneUrl(origin: string, token: string): string {
  const base = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  return `${base}${CAPTURE_PHONE_ASSET_ENTRY}#${CAPTURE_TOKEN_FRAGMENT_KEY}=${CaptureTokenSchema.parse(token)}`;
}

/* ── the closed phone-route union ────────────────────────────────────────── */

/** The one asset path the ingress serves; its chunk closure comes with it. */
export const CAPTURE_PHONE_ASSET_ENTRY = "/capture.html";

export const CapturePhoneRouteSchema = z.strictObject({
  method: z.enum(["GET", "POST", "PUT", "DELETE"]),
  path: z.string().startsWith("/api/v1/capture/phone/"),
  /** What the route does, for the operator-facing scope explanation. */
  purpose: z.string().min(1),
});
export type CapturePhoneRoute = z.infer<typeof CapturePhoneRouteSchema>;

/**
 * Ref operator-trust §7's exhaustive list: "assets/status/upload/replace/reorder/delete/
 * finalize". `retry-finalize` and `discard` are the same closed ref data-intake-and-edit-data §5.1
 * command set the operator's own surface drives, and `photos/:photoId/bytes`
 * is what makes Review and Reorder show the photograph rather than a box —
 * a read of bytes the phone itself just uploaded, scoped to its own session.
 *
 * Adding a route here is a contract change in ref data-intake-and-edit-data §5.1, not an edit.
 */
export const CAPTURE_PHONE_ROUTES: readonly CapturePhoneRoute[] = deepFreeze([
  { method: "GET", path: "/api/v1/capture/phone/session", purpose: "read this session's own state" },
  { method: "POST", path: "/api/v1/capture/phone/photos", purpose: "upload one photograph" },
  { method: "GET", path: "/api/v1/capture/phone/photos/:photoId/bytes", purpose: "read back one of this session's photographs" },
  { method: "PUT", path: "/api/v1/capture/phone/photos/:photoId", purpose: "replace one photograph" },
  { method: "DELETE", path: "/api/v1/capture/phone/photos/:photoId", purpose: "delete one photograph" },
  { method: "POST", path: "/api/v1/capture/phone/order", purpose: "reorder the photographs" },
  { method: "POST", path: "/api/v1/capture/phone/finalize", purpose: "finalize the bundle" },
  { method: "POST", path: "/api/v1/capture/phone/retry-finalize", purpose: "retry a failed finalization" },
  { method: "POST", path: "/api/v1/capture/phone/discard", purpose: "discard the session" },
].map((route) => CapturePhoneRouteSchema.parse(route)));

/** The route table as `METHOD path`, which is how the ingress allowlist reads. */
export const CAPTURE_PHONE_ROUTE_KEYS: readonly string[] = deepFreeze(
  CAPTURE_PHONE_ROUTES.map((route) => `${route.method} ${route.path}`),
);

/**
 * The ingress allowlist, DERIVED from the union above rather than restated
 * (ref clock-config-secrets: "its route allowlist is generated from the same capture-route
 * schema"). A `:param` segment matches one segment and never a `/`, so
 * `/api/v1/capture/phone/photos/x/../../../runs` cannot walk out of the scope.
 */
export function matchesCapturePhoneRoute(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  return CAPTURE_PHONE_ROUTES.some((route) => {
    if (route.method !== upper) return false;
    const pattern = route.path
      .split("/")
      .map((segment) => (segment.startsWith(":")
        ? "[^/]+"
        : segment.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)))
      .join("/");
    return new RegExp(`^${pattern}$`).test(path);
  });
}

/**
 * Everything else the ingress may serve: the phone page itself, and only the
 * assets that page's own build reaches. An operator route is never in here,
 * and neither is a catch-all.
 */
export function isCapturePhoneAsset(path: string, phoneAssetPaths: ReadonlySet<string>): boolean {
  return path === CAPTURE_PHONE_ASSET_ENTRY || phoneAssetPaths.has(path);
}

/* ── the ingress ─────────────────────────────────────────────────────────── */

export function deriveCaptureOriginDigest(origin: string): string {
  return FingerprintSchema.parse(sha256Hex(`hrauto:capture-origin:v1\0${origin}`));
}

/**
 * Why Start Capture could not produce a reachable phone origin. Every arm is a
 * NAMED configuration result, never a silent fall back to loopback: a QR
 * pointing at `127.0.0.1` scans cleanly and then fails on the phone with a
 * network error that explains nothing.
 */
export const CaptureIngressRefusalCodeSchema = z.enum([
  "ingress-disabled",
  "ingress-credential-missing",
  "ingress-not-built",
]);
export type CaptureIngressRefusalCode = z.infer<typeof CaptureIngressRefusalCodeSchema>;

export const CaptureIngressResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("ready"),
    mode: CaptureIngressModeSchema,
    origin: z.string().min(1),
    originDigest: FingerprintSchema,
  }),
  z.strictObject({
    state: z.literal("refused"),
    code: CaptureIngressRefusalCodeSchema,
    message: z.string().min(1),
    remediation: z.string().min(1),
  }),
]);
export type CaptureIngressResolution = z.infer<typeof CaptureIngressResolutionSchema>;

/* ── the phone's refusal vocabulary ──────────────────────────────────────── */

/**
 * `unknown-session` is the ONE answer to every failure of token resolution.
 * The others describe a session the caller demonstrably holds the token for,
 * so naming them leaks nothing.
 */
export const CapturePhoneRefusalCodeSchema = z.enum([
  "unknown-session",
  "unsupported-media-type",
  "empty-upload",
  "upload-too-large",
  "invalid-state",
  "unknown-photo",
]);
export type CapturePhoneRefusalCode = z.infer<typeof CapturePhoneRefusalCodeSchema>;

/** One sentence, identical for every unresolvable token. */
export const CAPTURE_UNKNOWN_SESSION_MESSAGE =
  "this capture link is not open — ask the operator for a new one";

/* ── what the phone and the operator may see ─────────────────────────────── */

export const CAPTURE_PHOTO_MEDIA_TYPES = ["image/jpeg", "image/png"] as const;
export const CaptureUploadMediaTypeSchema = z.enum(CAPTURE_PHOTO_MEDIA_TYPES);

/*
 * There is deliberately no size constant here. `config.capture.maxPhotoBytes`
 * and `maxPhotos` already own those limits, and a second copy in the domain
 * would be a value that could disagree with the one actually enforced.
 */

export const CapturePhotoWireSchema = z.strictObject({
  photoId: CapturePhotoIdSchema,
  ordinal: PositiveIntSchema,
  mediaType: CaptureUploadMediaTypeSchema,
  bytes: z.number().int().nonnegative(),
  artifactId: ArtifactIdSchema,
});
export type CapturePhotoWire = z.infer<typeof CapturePhotoWireSchema>;

/**
 * The handoff, as the phone reads it. `failed` carries the projector's own
 * message: the operator holding the phone is the person who has to decide
 * between Retry and Discard, and "something went wrong" decides nothing.
 */
export const CaptureHandoffWireSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("pending") }),
  z.strictObject({ state: z.literal("enqueued"), runId: RunIdSchema, intakeManifestId: IntakeManifestIdSchema }),
  z.strictObject({ state: z.literal("failed"), message: z.string().min(1) }),
]);
export type CaptureHandoffWire = z.infer<typeof CaptureHandoffWireSchema>;

/**
 * Deliberately WITHOUT `tokenDigest`. A digest is not a credential, but it is
 * also not the phone's business, and a wire that never carries it cannot leak
 * it through a screenshot, a bundle, or a log line.
 */
export const CaptureSessionWireSchema = z.strictObject({
  wireVersion: z.literal(1),
  sessionId: CaptureSessionIdSchema,
  workflow: WorkflowIdSchema,
  formType: z.string().min(1).optional(),
  contextHint: z.string().min(1).optional(),
  state: CaptureSessionStateSchema,
  photos: z.array(CapturePhotoWireSchema),
  finalArtifact: z.strictObject({ artifactId: ArtifactIdSchema, sha256: FingerprintSchema, bytes: z.number().int().nonnegative() }).optional(),
  handoff: CaptureHandoffWireSchema,
  finalizationGeneration: z.number().int().nonnegative(),
  version: PositiveIntSchema,
  createdAt: IsoInstantSchema,
  connectedAt: IsoInstantSchema.optional(),
  expiresAt: IsoInstantSchema,
  ingress: CaptureSessionIngressSchema.optional(),
});
export type CaptureSessionWire = z.infer<typeof CaptureSessionWireSchema>;

/**
 * What Start Capture hands the operator. The raw token appears HERE and
 * nowhere else, ever — this response is the single moment it exists outside
 * the phone, which is why the operator surface must render the QR from it
 * rather than storing it.
 */
export const CaptureStartResultSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("started"),
    session: CaptureSessionWireSchema,
    token: CaptureTokenSchema,
    phoneUrl: z.string().min(1),
    ingressMode: CaptureIngressModeSchema,
  }),
  z.strictObject({
    state: z.literal("refused"),
    code: CaptureIngressRefusalCodeSchema,
    message: z.string().min(1),
    remediation: z.string().min(1),
  }),
]);
export type CaptureStartResult = z.infer<typeof CaptureStartResultSchema>;
