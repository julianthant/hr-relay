/**
 * The BFF's static byte path for the built dashboard (ref frontend-backend-integration §6.9,
 * D189 amended by D294): in `built-bundle` mode the operator's own machine serves
 * `dist/dashboard` from the same loopback process that serves the API, replacing
 * the Vite dev server that sat beside it. "Production" here is LOCAL (D193);
 * nothing about this path is hosting.
 *
 * Ported with provenance from the parity lane's `serveStatic`
 * (tests/parity/helpers/fixture-bff.ts, 2026-09-03) and hardened: the fixture
 * refused only lexical escape from the dist directory; this handler also
 * refuses malformed encoding, forbidden characters, dot segments, symlinks
 * that leave the bundle, non-regular files and unlisted extensions, and it
 * never answers `application/octet-stream` for a byte it cannot name.
 *
 * Decision first, I/O second: `decideStaticBundlePath` is a pure function over
 * the request path so the whole refusal table is pinned without a socket, and
 * the handler does exactly what the decision says.
 */
import { open, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { MiddlewareHandler } from "hono";
import { wireError } from "./routes/failure-status.js";

export interface StaticBundle {
  /** The realpath of `dist/dashboard`; every served byte resolves strictly inside it. */
  readonly distRoot: string;
}

/** Extension → media type. Closed on purpose: an unlisted extension is a 404, never a guessed type. */
const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
});

/** Vite content-hashes everything under `assets/`; only those bytes may be cached forever. */
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const NO_CACHE = "no-cache";

export type StaticBundleRefusal = "malformed-encoding" | "forbidden-character" | "dot-segment" | "outside-bundle";

/** The app's own route prefixes: never the bundle's, decoded or not. */
const RESERVED_PREFIXES: readonly string[] = Object.freeze(["/api", "/events", "/artifacts"]);

function reserved(path: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * A filesystem failure while serving the bundle. The message is fixed and the
 * original error rides on `cause`: `failureStatus` puts an error's message on
 * the wire as `INTERNAL_FAILURE`, and a raw fs message carries the absolute
 * bundle path plus the requested name.
 */
export class StaticBundleReadError extends Error {
  constructor(stage: "resolve" | "inspect" | "read", cause: unknown) {
    super(`the static bundle could not ${stage} the requested file`, { cause });
    this.name = "StaticBundleReadError";
  }
}

export type StaticBundleDecision =
  | Readonly<{ kind: "pass-through" }>
  | Readonly<{ kind: "refused"; reason: StaticBundleRefusal }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "file"; relativeSegments: readonly string[]; contentType: string; cacheControl: string }>
  | Readonly<{ kind: "spa-fallback" }>;

/**
 * The lexical half of the decision: what this path MEANS before any filesystem
 * read. `pass-through` hands the request to the app's own routes and 404
 * (API, events, other methods); `spa-fallback` serves `index.html` for a
 * route the browser app owns; `file` names the bundle-relative segments to
 * open, which the handler then proves stay inside the bundle physically too.
 */
export function decideStaticBundlePath(input: Readonly<{ method: string; rawPath: string }>): StaticBundleDecision {
  const method = input.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return { kind: "pass-through" };
  if (reserved(input.rawPath)) return { kind: "pass-through" };
  let decoded: string;
  try {
    decoded = decodeURIComponent(input.rawPath);
  } catch {
    return { kind: "refused", reason: "malformed-encoding" };
  }
  // Decided on the DECODED path too: `/api%2Fv1/x` is not a bundle route.
  if (reserved(decoded)) return { kind: "pass-through" };
  if (decoded.includes("\0") || decoded.includes("\\")) return { kind: "refused", reason: "forbidden-character" };
  if (!decoded.startsWith("/")) return { kind: "refused", reason: "outside-bundle" };
  const trimmed = decoded.length > 1 && decoded.endsWith("/") ? decoded.slice(0, -1) : decoded;
  if (trimmed === "/") {
    return { kind: "file", relativeSegments: ["index.html"], contentType: CONTENT_TYPES[".html"] ?? "", cacheControl: NO_CACHE };
  }
  const segments = trimmed.slice(1).split("/");
  for (const segment of segments) {
    if (segment === "" ) return { kind: "refused", reason: "outside-bundle" };
    if (segment === "." || segment === "..") return { kind: "refused", reason: "dot-segment" };
  }
  const last = segments[segments.length - 1] ?? "";
  const extension = extname(last).toLowerCase();
  const underAssets = segments[0] === "assets";
  if (extension === "") {
    // A browser-app route: the SPA owns it. An extension-less name under the
    // content-hashed assets tree is nothing Vite ever emits.
    return underAssets ? { kind: "not-found" } : { kind: "spa-fallback" };
  }
  const contentType = CONTENT_TYPES[extension];
  if (contentType === undefined) return { kind: "not-found" };
  return {
    kind: "file",
    relativeSegments: segments,
    contentType,
    cacheControl: underAssets ? IMMUTABLE_CACHE : NO_CACHE,
  };
}

function insideBundle(distRoot: string, candidate: string): boolean {
  return candidate === distRoot || candidate.startsWith(distRoot + sep);
}

/**
 * Validate `dist/dashboard` BEFORE anything listens: a dashboard that would
 * answer 404 for its own app must never look started (fail loud, D189).
 */
export async function openStaticBundle(distDir: string): Promise<StaticBundle> {
  let distRoot: string;
  try {
    distRoot = await realpath(distDir);
  } catch (error: unknown) {
    if (isNoEntry(error)) throw new Error(`the built dashboard is not at ${distDir}; run \`npm run web:build\` first`, { cause: error });
    throw new Error(`the built dashboard at ${distDir} could not be resolved`, { cause: error });
  }
  const bundle: StaticBundle = Object.freeze({ distRoot });
  // The same physical proof the handler applies to every request: `index.html`
  // must be a regular file that stays inside the bundle after symlinks resolve,
  // or the dashboard would print "listening" and then refuse its own app.
  const index = await locate(bundle, ["index.html"]);
  if (index.kind === "not-found") throw new Error(`the built dashboard at ${distRoot} has no index.html; run \`npm run web:build\` first`);
  if (index.kind === "outside-bundle") throw new Error(`the built dashboard's index.html at ${distRoot} resolves outside the bundle`);
  return bundle;
}

type Physical =
  | Readonly<{ kind: "file"; path: string; size: number }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "outside-bundle" }>;

/** The physical half: the named bytes must exist, be a regular file, and stay inside the bundle after symlinks resolve. */
async function locate(bundle: StaticBundle, relativeSegments: readonly string[]): Promise<Physical> {
  const lexical = resolve(bundle.distRoot, ...relativeSegments);
  if (!insideBundle(bundle.distRoot, lexical)) return { kind: "outside-bundle" };
  let real: string;
  try {
    real = await realpath(lexical);
  } catch (error: unknown) {
    // A name too long for the filesystem or a symlink cycle names nothing the
    // bundle holds; anything else is a real fault and stays loud, but typed.
    if (isNoEntry(error) || hasCode(error, "ENAMETOOLONG") || hasCode(error, "ELOOP")) return { kind: "not-found" };
    throw new StaticBundleReadError("resolve", error);
  }
  if (!insideBundle(bundle.distRoot, real)) return { kind: "outside-bundle" };
  let info;
  try {
    info = await stat(real);
  } catch (error: unknown) {
    if (isNoEntry(error)) return { kind: "not-found" };
    throw new StaticBundleReadError("inspect", error);
  }
  if (!info.isFile()) return { kind: "not-found" };
  return { kind: "file", path: real, size: info.size };
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

function isNoEntry(error: unknown): boolean {
  return hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR");
}

async function readAll(path: string): Promise<Uint8Array<ArrayBuffer>> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error: unknown) {
    throw new StaticBundleReadError("read", error);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("static bundle path stopped being a regular file between resolution and read");
    const bytes = new Uint8Array(new ArrayBuffer(info.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead === 0) throw new Error("static bundle file shrank while being read");
      offset += bytesRead;
    }
    return bytes;
  } catch (error: unknown) {
    throw error instanceof StaticBundleReadError ? error : new StaticBundleReadError("read", error);
  } finally {
    await handle.close();
  }
}

/**
 * The handler, registered LAST in the app so every API/events/artifact route
 * wins by registration order; `pass-through`, `not-found` and a missing file
 * all fall to the app's own JSON 404. Refusals are typed wire errors with a
 * fixed message: the offending path is never echoed.
 */
export function staticBundleHandler(bundle: StaticBundle): MiddlewareHandler {
  return async (context, next) => {
    const decision = decideStaticBundlePath({ method: context.req.method, rawPath: context.req.path });
    if (decision.kind === "pass-through" || decision.kind === "not-found") return next();
    if (decision.kind === "refused") {
      return context.json(
        wireError("STATIC_PATH_REFUSED", `the requested path is not a bundle path (${decision.reason})`, false),
        400,
      );
    }
    const target = decision.kind === "spa-fallback"
      ? { relativeSegments: ["index.html"], contentType: CONTENT_TYPES[".html"] ?? "", cacheControl: NO_CACHE }
      : decision;
    const physical = await locate(bundle, target.relativeSegments);
    if (physical.kind === "outside-bundle") {
      return context.json(wireError("STATIC_PATH_REFUSED", "the requested path is not a bundle path (outside-bundle)", false), 400);
    }
    if (physical.kind === "not-found") return next();
    const headers = (length: number) => ({
      "content-type": target.contentType,
      "content-length": String(length),
      "cache-control": target.cacheControl,
      "x-content-type-options": "nosniff",
    });
    if (context.req.method.toUpperCase() === "HEAD") return new Response(null, { status: 200, headers: headers(physical.size) });
    // The length is the body's own, so a rebuild between inspection and read
    // can never send a header that disagrees with the bytes.
    const bytes = await readAll(physical.path);
    return new Response(bytes, { status: 200, headers: headers(bytes.byteLength) });
  };
}
