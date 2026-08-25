/**
 * The fixture BFF (ref frontend-backend-integration §7.2, test-only adapter #1): serves the parity
 * fixture corpus on the EXACT v1 route surface the real BFF exposes, plus the
 * built React bundle as static files, so the same production app renders from
 * deterministic fixtures over real HTTP/SSE. Every payload — including every
 * SSE envelope — parses its owning strict schema before it is written; a
 * fixture route can never emit what the contract would refuse.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { assertServedBundle, type ParityBundleProof } from "./bundle.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import {
  DashboardStreamEnvelopeSchema,
  type DashboardStreamEnvelope,
} from "../../../src/domain/dashboard/subscription.js";
import { WireErrorSchema } from "../../../src/domain/dashboard/primitives.js";
import {
  FIXTURE_BOOTSTRAP,
  FIXTURE_COMMAND_RESULTS,
  FIXTURE_DAY,
  FIXTURE_DAY_WIRE,
  FIXTURE_DIAGNOSTIC_BUNDLE,
  FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,
  FIXTURE_DESCRIPTOR_HASH,
  FIXTURE_IDS,
  FIXTURE_RUN_DETAILS,
  FIXTURE_SECTIONS,
  FIXTURE_START_PLAN,
} from "./fixture-day.js";
import { FIXTURE_INTAKE_MAPPING, FIXTURE_INTAKE_SESSIONS } from "./fixture-intake.js";
import { FIXTURE_EXPLORER_WIRE, FIXTURE_UI_CATALOG_WIRE } from "./fixture-explorer.js";
import {
  FIXTURE_ACTIVITY_REPORT,
  FIXTURE_ARCHIVE_INDEX,
  FIXTURE_ARCHIVED_RUN,
  FIXTURE_ARCHIVED_RUN_ID,
} from "./fixture-archive.js";
import {
  activityReportCsv,
  activityReportCsvFileName,
} from "../../../src/server/dashboard/queries/activity-export.js";
import {
  CAPTURE_TOKEN_HEADER,
  CAPTURE_UNKNOWN_SESSION_MESSAGE,
  CaptureSessionWireSchema,
  type CaptureSessionWire,
} from "../../../src/domain/capture-surface.js";
import {
  FIXTURE_CAPTURE_BY_TOKEN,
  FIXTURE_CAPTURE_PHOTO_BYTES,
  FIXTURE_CAPTURE_START,
} from "./fixture-capture.js";

/* ── SSE envelopes ───────────────────────────────────────────────────────── */

export function fixtureHelloEnvelope(): DashboardStreamEnvelope {
  return DashboardStreamEnvelopeSchema.parse({
    type: "hello",
    wireVersion: 1,
    descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    projectionGeneration: 1,
    cursor: "pc:1",
  });
}

export function fixtureSnapshotEnvelope(): DashboardStreamEnvelope {
  return DashboardStreamEnvelopeSchema.parse({
    type: "snapshot",
    topic: "dashboard-day",
    cursor: "pc:1",
    payload: FIXTURE_DAY_WIRE,
  });
}

export function fixtureHealthEnvelope(): DashboardStreamEnvelope {
  return DashboardStreamEnvelopeSchema.parse({ type: "health", state: "live" });
}

function sseSerialize(envelope: DashboardStreamEnvelope): string {
  const id = "cursor" in envelope ? `id: ${envelope.cursor}\n` : "";
  return `${id}data: ${JSON.stringify(envelope)}\n\n`;
}

/* ── the API app ─────────────────────────────────────────────────────────── */

function wireError(code: string, message: string): unknown {
  return WireErrorSchema.parse({ state: "error", code, message, retryable: false });
}

const CommandBodyProbeSchema = z.looseObject({
  target: z.looseObject({ runId: z.string().optional() }).optional(),
});

const CaptureOrderProbeSchema = z.looseObject({
  orderedPhotoIds: z.array(z.string().min(1)).min(1),
});

export function createFixtureBff(): { app: Hono } {
  const app = new Hono();

  app.get("/api/v1/bootstrap", (c) => c.json(FIXTURE_BOOTSTRAP as unknown));

  app.get("/api/v1/dashboard", (c) => {
    const day = c.req.query("day");
    if (day !== FIXTURE_DAY) {
      return c.json(wireError("TARGET_NOT_FOUND", `the fixture corpus serves only day ${FIXTURE_DAY}`), 404);
    }
    return c.json(FIXTURE_DAY_WIRE as unknown);
  });

  app.get("/api/v1/runs/:runId", (c) => {
    const detail = FIXTURE_RUN_DETAILS[c.req.param("runId")];
    if (detail === undefined) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture run detail for ${c.req.param("runId")}`), 404);
    }
    return c.json(detail as unknown);
  });

  app.get("/api/v1/runs/:runId/:section", (c) => {
    const sections = FIXTURE_SECTIONS[c.req.param("runId")];
    const section = sections?.[c.req.param("section")];
    if (section === undefined) {
      return c.json(
        wireError("SECTION_UNAVAILABLE", `no fixture ${c.req.param("section")} section for ${c.req.param("runId")}`),
        404,
      );
    }
    return c.json(section as unknown);
  });

  /** E29's fixture is exact-id only, just like the production route. */
  app.get("/api/v1/diagnostic-bundles/:bundleId", (c) => {
    if (c.req.param("bundleId") !== FIXTURE_DIAGNOSTIC_BUNDLE.bundleId) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture diagnostic bundle ${c.req.param("bundleId")}`), 404);
    }
    return c.json(FIXTURE_DIAGNOSTIC_BUNDLE as unknown);
  });
  app.get("/api/v1/diagnostic-bundles/:bundleId/manifest", (c) => {
    if (c.req.param("bundleId") !== FIXTURE_DIAGNOSTIC_BUNDLE.bundleId) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture diagnostic bundle ${c.req.param("bundleId")}`), 404);
    }
    return new Response(canonicalJsonStringify(FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${FIXTURE_DIAGNOSTIC_BUNDLE.bundleId}.json"`,
      },
    });
  });

  app.post("/api/v1/start-plans", (c) => c.json(FIXTURE_START_PLAN as unknown));

  /**
   * The two read-only reference routes (2i-G). Both serve the REAL projection
   * — see `fixture-explorer.ts` for why these fixtures are not hand-written.
   */
  app.get("/api/v1/explorer", (c) => c.json(FIXTURE_EXPLORER_WIRE as unknown));
  app.get("/api/v1/ui-catalog", (c) => c.json(FIXTURE_UI_CATALOG_WIRE as unknown));

  /**
   * The Archive and Activity pair (2i-G, D179/D180). The archived detail is
   * served by exact run id: a fixture that answered any id with the same
   * record would let a surface pass while addressing the wrong run.
   */
  app.get("/api/v1/archive", (c) => c.json(FIXTURE_ARCHIVE_INDEX as unknown));
  app.get("/api/v1/archive/:runId", (c) => {
    if (c.req.param("runId") !== FIXTURE_ARCHIVED_RUN_ID) {
      return c.json(wireError("ARCHIVE_RUN_UNKNOWN", `no fixture archived run ${c.req.param("runId")}`), 404);
    }
    return c.json(FIXTURE_ARCHIVED_RUN as unknown);
  });
  app.get("/api/v1/reports/activity", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (from === undefined || to === undefined) {
      return c.json(wireError("ACTIVITY_RANGE_REQUIRED", "an activity report requires from= and to="), 400);
    }
    return c.json(FIXTURE_ACTIVITY_REPORT as unknown);
  });
  /**
   * D240's export, over the SAME fixture payload. The parity lane never clicks
   * it, and it is here anyway: a fixture server that answered the report and
   * 404'd its export would make the Export button dead in the one environment
   * the surface is photographed in, which is a surface state nobody would
   * notice until an operator pressed it.
   */
  app.get("/api/v1/reports/activity.csv", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (from === undefined || to === undefined) {
      return c.json(wireError("ACTIVITY_RANGE_REQUIRED", "an activity report requires from= and to="), 400);
    }
    return new Response(activityReportCsv(FIXTURE_ACTIVITY_REPORT), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition":
          `attachment; filename="${activityReportCsvFileName(FIXTURE_ACTIVITY_REPORT)}"`,
      },
    });
  });

  /**
   * The intake pair (2i-E3). The upload answers `201` with the mid-mapping
   * session, which is what a real first upload of these bytes returns — the
   * status is the contract here, so serving `200` would have the app report a
   * JOINED session for a file it had never seen.
   */
  app.post("/api/v1/intake/files", (c) => {
    const fileName = c.req.query("filename");
    if (fileName === undefined || fileName.length === 0) {
      return c.json(wireError("SCHEMA_INVALID", "the intake upload route requires ?filename="), 400);
    }
    return c.json(FIXTURE_INTAKE_MAPPING as unknown, 201);
  });

  app.get("/api/v1/intake/:sessionId", (c) => {
    const session = FIXTURE_INTAKE_SESSIONS[c.req.param("sessionId")];
    if (session === undefined) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture intake session ${c.req.param("sessionId")}`), 404);
    }
    return c.json(session as unknown);
  });

  app.post("/api/v1/commands", async (c) => {
    const body = CommandBodyProbeSchema.parse(await c.req.json());
    const runId = body.target?.runId;
    if (runId === FIXTURE_IDS.conflictRun) return c.json(FIXTURE_COMMAND_RESULTS.conflict as unknown, 409);
    if (runId === FIXTURE_IDS.rejectedRun) return c.json(FIXTURE_COMMAND_RESULTS.rejected as unknown, 422);
    return c.json(FIXTURE_COMMAND_RESULTS.applied as unknown);
  });

  /* ── capture: the operator's start, and the phone's closed union (2i-F) ─── */

  app.post("/api/v1/capture/sessions", (c) => c.json(FIXTURE_CAPTURE_START as unknown, 201));

  /**
   * The phone addresses its session by the TOKEN in `X-Capture-Token` — never
   * by an id in a path — so the fixture resolves it exactly the way the real
   * service does, and an unknown token gets the ONE fail-closed sentence rather
   * than a fixture-specific message that would let a reference document an
   * enumeration oracle that does not exist.
   */
  const sessionByToken = (c: { req: { header: (name: string) => string | undefined } }): CaptureSessionWire | undefined =>
    FIXTURE_CAPTURE_BY_TOKEN[c.req.header(CAPTURE_TOKEN_HEADER) ?? ""];

  const unknownSession = (): Response =>
    Response.json(
      wireError("CAPTURE_UNKNOWN_SESSION", CAPTURE_UNKNOWN_SESSION_MESSAGE),
      { status: 404 },
    );

  app.get("/api/v1/capture/phone/session", (c) => {
    const session = sessionByToken(c);
    return session === undefined ? unknownSession() : c.json(session as unknown);
  });

  app.get("/api/v1/capture/phone/photos/:photoId/bytes", (c) => {
    const session = sessionByToken(c);
    if (session === undefined) return unknownSession();
    const photoId = c.req.param("photoId");
    const bytes = session.photos.some((photo) => String(photo.photoId) === photoId)
      ? FIXTURE_CAPTURE_PHOTO_BYTES.get(photoId)
      : undefined;
    if (bytes === undefined) {
      return c.json(wireError("CAPTURE_UNKNOWN_PHOTO", `this capture holds no photograph ${photoId}`), 422);
    }
    return new Response(bytes.slice().buffer, {
      status: 200,
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  });

  /**
   * Reorder is the one phone verb the reference lane EXERCISES rather than
   * merely photographs, so it re-derives the ordinals from the submitted order
   * instead of echoing the session back. A fixture that ignored the request
   * would let a broken move control screenshot perfectly.
   */
  app.post("/api/v1/capture/phone/order", async (c) => {
    const session = sessionByToken(c);
    if (session === undefined) return unknownSession();
    const body = CaptureOrderProbeSchema.parse(await c.req.json());
    const byId = new Map(session.photos.map((photo) => [String(photo.photoId), photo]));
    const photos = body.orderedPhotoIds.map((photoId, index) => {
      const photo = byId.get(photoId);
      if (photo === undefined) {
        throw new Error(`the fixture capture session holds no photograph ${photoId}`);
      }
      return { ...photo, ordinal: index + 1 };
    });
    return c.json(CaptureSessionWireSchema.parse({
      ...session,
      photos,
      version: session.version + 1,
    }) as unknown);
  });

  app.all("/api/*", (c) => c.json(wireError("ROUTE_NOT_FOUND", `no fixture route serves ${c.req.method} ${c.req.path}`), 404));

  return { app };
}

/* ── the HTTP server (API + SSE + static bundle) ─────────────────────────── */

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(distDir: string, pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname === "/" ? "/index.html" : pathname;
  const target = normalize(join(distDir, relative));
  if (!target.startsWith(normalize(distDir))) {
    res.writeHead(404).end("not found");
    return;
  }
  try {
    const body = await readFile(target);
    const type = CONTENT_TYPES[extname(target)];
    res.writeHead(200, type === undefined ? {} : { "content-type": type }).end(body);
  } catch {
    // A missing asset is a 404, never a silent empty 200 — the parity spec
    // fails loudly on a blank page rather than capturing one.
    res.writeHead(404).end("not found");
  }
}

function serveSse(res: ServerResponse, open: Set<ServerResponse>): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(sseSerialize(fixtureHelloEnvelope()));
  res.write(sseSerialize(fixtureSnapshotEnvelope()));
  res.write(sseSerialize(fixtureHealthEnvelope()));
  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 15_000);
  open.add(res);
  res.on("close", () => {
    clearInterval(heartbeat);
    open.delete(res);
  });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export interface FixtureServer {
  readonly port: number;
  readonly baseUrl: string;
  close(): Promise<void>;
}

export async function startFixtureServer(
  input: Readonly<{ distDir: string; bundle: ParityBundleProof }>,
): Promise<FixtureServer> {
  // Ref frontend-backend-integration §7: a served bundle must provably be a build of the working tree.
  // Asserted BEFORE a port is bound, so a stale `dist/dashboard` can never be
  // reached over HTTP — and never leaks a listening socket on refusal.
  assertServedBundle(input.distDir, input.bundle);
  const { app } = createFixtureBff();
  const openStreams = new Set<ServerResponse>();

  const server: Server = createServer((req, res) => {
    void (async (): Promise<void> => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/events/v1") {
        serveSse(res, openStreams);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
        const response = await app.fetch(new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
          method: req.method ?? "GET",
          headers: Object.fromEntries(
            Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          ),
          ...(body === undefined ? {} : { body: new Uint8Array(body) }),
        }));
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      await serveStatic(input.distDir, url.pathname, res);
    })().catch((error: unknown) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify(wireError("INTERNAL_FAILURE", error instanceof Error ? error.message : String(error))));
    });
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture server bound no TCP address");
  }
  return Object.freeze({
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async (): Promise<void> => {
      for (const stream of openStreams) stream.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error === undefined ? resolvePromise() : rejectPromise(error)));
      });
    },
  });
}
