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
import { restrictedJpegDiagnosticFixture } from "./diagnostic-jpeg-fixture.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import {
  DashboardStreamEnvelopeSchema,
  type DashboardStreamEnvelope,
} from "../../../src/domain/dashboard/subscription.js";
import type { FrontendBootstrapWire } from "../../../src/domain/dashboard/bootstrap.js";
import type { DashboardDayWire } from "../../../src/domain/dashboard/projection.js";
import type { CommandResult } from "../../../src/domain/commands.js";
import type { StartPlanResponse } from "../../../src/dashboard/client/commands.js";
import { WireErrorSchema } from "../../../src/domain/dashboard/primitives.js";
import { ArchivedCaptureResourceWireSchema } from "../../../src/domain/dashboard/archive.js";
import {
  FIXTURE_BOOTSTRAP,
  FIXTURE_COMMAND_RESULTS,
  FIXTURE_DAY,
  FIXTURE_DAY_WIRE,
  FIXTURE_DIAGNOSTIC_BUNDLE,
  FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,
  FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES,
  FIXTURE_DESCRIPTOR_HASH,
  FIXTURE_IDS,
  FIXTURE_RUN_DETAILS,
  FIXTURE_SECTIONS,
  FIXTURE_SETTINGS_FACTS,
  FIXTURE_START_PLAN,
} from "./fixture-day.js";
import { FIXTURE_INTAKE_MAPPING, FIXTURE_INTAKE_SESSIONS } from "./fixture-intake.js";
import { FIXTURE_EXPLORER_WIRE, FIXTURE_UI_CATALOG_WIRE } from "./fixture-explorer.js";
import {
  FIXTURE_ACTIVITY_REPORT,
  FIXTURE_ARCHIVE_INDEX,
  FIXTURE_ARCHIVED_RUN,
} from "./fixture-archive.js";
import {
  archiveEvidenceResponseBody,
  FIXTURE_ARCHIVE_EVIDENCE_BYTES,
  FIXTURE_ARCHIVE_EVIDENCE_CAPTURE,
  FIXTURE_ARCHIVE_EVIDENCE_RUN,
  FIXTURE_ARCHIVE_EVIDENCE_INDEX,
} from "./fixture-archive-evidence.js";
import { FIXTURE_RUN_CAPTURE_DAY, FIXTURE_RUN_CAPTURE_DETAILS, FIXTURE_RUN_CAPTURE_RECEIPTS, FIXTURE_RUN_CAPTURE_SECTIONS,
  FIXTURE_RUN_CAPTURE_REFS, runCaptureFixtureBytes } from "./fixture-run-captures.js";
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
  FIXTURE_CAPTURE_OPERATOR,
  FIXTURE_CAPTURE_OPERATOR_LIST,
  FIXTURE_CAPTURE_PHOTO_BYTES,
  FIXTURE_CAPTURE_START,
} from "./fixture-capture.js";

/* ── SSE envelopes ───────────────────────────────────────────────────────── */

export interface FixtureDashboardProfile {
  /** Every bootstrap fact the browser reads before it selects a route. */
  readonly bootstrap: FrontendBootstrapWire;
  /** The corresponding day snapshot, including the same descriptor-set hash. */
  readonly day: DashboardDayWire;
  readonly descriptorHash: string;
  /** An optional exact plan for an interaction-specific fixture profile. */
  readonly startPlan?: StartPlanResponse;
  /** An optional exact command receipt for an interaction-specific profile. */
  readonly commandResult?: CommandResult;
}

const DEFAULT_DASHBOARD_PROFILE: FixtureDashboardProfile = Object.freeze({
  bootstrap: FIXTURE_BOOTSTRAP,
  day: FIXTURE_DAY_WIRE,
  descriptorHash: FIXTURE_DESCRIPTOR_HASH,
});

export function fixtureHelloEnvelope(profile: FixtureDashboardProfile = DEFAULT_DASHBOARD_PROFILE): DashboardStreamEnvelope {
  return DashboardStreamEnvelopeSchema.parse({
    type: "hello",
    wireVersion: 1,
    descriptorHash: profile.descriptorHash,
    projectionGeneration: 1,
    cursor: "pc:1",
  });
}

export function fixtureSnapshotEnvelope(
  dayWire: DashboardDayWire = FIXTURE_DAY_WIRE,
  cursor = "pc:1",
): DashboardStreamEnvelope {
  return DashboardStreamEnvelopeSchema.parse({
    type: "snapshot",
    topic: "dashboard-day",
    cursor,
    payload: dayWire,
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

export function createFixtureBff(
  input: Readonly<{
    profile?: FixtureDashboardProfile;
    dayWire?: DashboardDayWire;
    archiveScenario?: "evidence";
    diagnosticFixture?: "restricted-jpeg";
    runCaptureScenario?: "evidence";
  }> = {},
): { app: Hono } {
  const app = new Hono();
  const profile = input.profile ?? DEFAULT_DASHBOARD_PROFILE;
  const runCaptureEvidence = input.runCaptureScenario === "evidence";
  const dayWire = input.dayWire ?? (runCaptureEvidence ? FIXTURE_RUN_CAPTURE_DAY : profile.day);
  const archiveEvidence = input.archiveScenario === "evidence";
  const archivedRun = archiveEvidence ? FIXTURE_ARCHIVE_EVIDENCE_RUN : FIXTURE_ARCHIVED_RUN;
  if (input.diagnosticFixture !== undefined && input.diagnosticFixture !== "restricted-jpeg") {
    throw new Error(`unknown diagnostic fixture ${String(input.diagnosticFixture)}`);
  }
  const diagnostic = input.diagnosticFixture === "restricted-jpeg" ? restrictedJpegDiagnosticFixture() : {
    bundle: FIXTURE_DIAGNOSTIC_BUNDLE,
    manifest: FIXTURE_DIAGNOSTIC_BUNDLE_MANIFEST,
    screenshotBytes: FIXTURE_DIAGNOSTIC_SCREENSHOT_BYTES,
  };

  app.get("/api/v1/bootstrap", (c) => c.json(profile.bootstrap as unknown));

  app.get("/api/v1/dashboard", (c) => {
    const day = c.req.query("day");
    if (day !== FIXTURE_DAY) {
      return c.json(wireError("TARGET_NOT_FOUND", `the fixture corpus serves only day ${FIXTURE_DAY}`), 404);
    }
    return c.json(dayWire as unknown);
  });

  app.get("/api/v1/runs/:runId", (c) => {
    const runId = c.req.param("runId");
    const detail = runCaptureEvidence && FIXTURE_RUN_CAPTURE_DETAILS[runId] !== undefined
      ? FIXTURE_RUN_CAPTURE_DETAILS[runId] : FIXTURE_RUN_DETAILS[runId];
    if (detail === undefined) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture run detail for ${c.req.param("runId")}`), 404);
    }
    return c.json(detail as unknown);
  });

  app.get("/api/v1/runs/:runId/:section", (c) => {
    if (runCaptureEvidence && c.req.param("section") === "receipt") {
      const receipt = FIXTURE_RUN_CAPTURE_RECEIPTS[c.req.param("runId")];
      if (receipt !== undefined) return c.json(receipt);
    }
    if (runCaptureEvidence && c.req.param("section") === "captures") {
      const captures = FIXTURE_RUN_CAPTURE_SECTIONS[c.req.param("runId")];
      if (captures !== undefined) return c.json(captures);
    }
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
    if (c.req.param("bundleId") !== diagnostic.bundle.bundleId) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture diagnostic bundle ${c.req.param("bundleId")}`), 404);
    }
    return c.json(diagnostic.bundle as unknown);
  });
  app.get("/api/v1/diagnostic-bundles/:bundleId/manifest", (c) => {
    if (c.req.param("bundleId") !== diagnostic.bundle.bundleId) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture diagnostic bundle ${c.req.param("bundleId")}`), 404);
    }
    return new Response(canonicalJsonStringify(diagnostic.manifest), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${diagnostic.bundle.bundleId}.json"`,
      },
    });
  });
  app.get("/api/v1/diagnostic-bundles/:bundleId/attachments/:artifactId", (c) => {
    if (c.req.param("bundleId") !== diagnostic.bundle.bundleId) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture diagnostic bundle ${c.req.param("bundleId")}`), 404);
    }
    const screenshot = diagnostic.bundle.contents.find((content) => content.kind === "screenshot");
    if (screenshot === undefined || c.req.param("artifactId") !== screenshot.artifactId) {
      return c.json(wireError("TARGET_NOT_FOUND", `no fixture diagnostic attachment ${c.req.param("artifactId")}`), 404);
    }
    const responseBytes = Uint8Array.from(diagnostic.screenshotBytes);
    return new Response(responseBytes.buffer, {
      status: 200,
      headers: {
        "content-type": screenshot.mediaType,
        "content-length": String(diagnostic.screenshotBytes.byteLength),
        "cache-control": "no-store",
      },
    });
  });

  app.post("/api/v1/start-plans", (c) => c.json((profile.startPlan ?? FIXTURE_START_PLAN) as unknown));

  /**
   * The Settings takeover's two read-only status panes (D274 item 6). The
   * corpus served this route not at all, so `useSettingsFacts` could only ever
   * resolve its `failed` arm here — which is why the Settings page had to be
   * photographed with the sections it renders actually behind it.
   */
  app.get("/api/v1/settings/facts", (c) => c.json(FIXTURE_SETTINGS_FACTS as unknown));

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
  app.get("/api/v1/archive", (c) => c.json((archiveEvidence ? FIXTURE_ARCHIVE_EVIDENCE_INDEX : FIXTURE_ARCHIVE_INDEX) as unknown));
  app.get("/api/v1/archive/:runId/captures/:artifactId/resource", (c) => {
    const runId = c.req.param("runId");
    const artifactId = c.req.param("artifactId");
    if (!archiveEvidence || runId !== archivedRun.runId || artifactId !== FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId) {
      return c.json(wireError("ARCHIVE_CAPTURE_UNKNOWN", `no frozen fixture capture ${artifactId} for archived run ${runId}`), 404);
    }
    return c.json(ArchivedCaptureResourceWireSchema.parse({
      runId,
      artifactId,
      resource: { state: "available", downloadUrl: `/artifacts/v1/archive/${runId}/${artifactId}` },
    }));
  });
  app.get("/api/v1/archive/:runId", (c) => {
    if (c.req.param("runId") !== archivedRun.runId) {
      return c.json(wireError("ARCHIVE_RUN_UNKNOWN", `no fixture archived run ${c.req.param("runId")}`), 404);
    }
    return c.json(archivedRun as unknown);
  });
  app.get("/artifacts/v1/archive/:runId/:artifactId", (c) => {
    const { runId, artifactId } = c.req.param();
    if (!archiveEvidence || runId !== archivedRun.runId || artifactId !== FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId) {
      return c.json(wireError("ARCHIVE_CAPTURE_UNKNOWN", `no frozen fixture capture ${artifactId} for archived run ${runId}`), 404);
    }
    return new Response(archiveEvidenceResponseBody(FIXTURE_ARCHIVE_EVIDENCE_BYTES), {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="archive-${FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.artifactId}"`,
        "content-length": String(FIXTURE_ARCHIVE_EVIDENCE_BYTES.byteLength),
        "content-type": FIXTURE_ARCHIVE_EVIDENCE_CAPTURE.mediaType,
        "x-content-type-options": "nosniff",
      },
    });
  });
  app.get("/artifacts/v1/:artifactId", (c) => {
    const artifactId = c.req.param("artifactId");
    const ref = FIXTURE_RUN_CAPTURE_REFS[artifactId];
    const bytes = runCaptureEvidence ? runCaptureFixtureBytes(artifactId) : undefined;
    if (ref === undefined || bytes === undefined) {
      return c.json(wireError("TARGET_NOT_FOUND", `no generic fixture artifact ${artifactId}`), 404);
    }
    return new Response(bytes, { status: 200, headers: {
      "content-type": ref.mediaType, "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="capture-${artifactId}"`,
      "cache-control": "no-store", "x-content-type-options": "nosniff",
    } });
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
    if (profile.commandResult !== undefined) return c.json(profile.commandResult as unknown);
    const runId = body.target?.runId;
    if (runId === FIXTURE_IDS.conflictRun) return c.json(FIXTURE_COMMAND_RESULTS.conflict as unknown, 409);
    if (runId === FIXTURE_IDS.rejectedRun) return c.json(FIXTURE_COMMAND_RESULTS.rejected as unknown, 422);
    return c.json(FIXTURE_COMMAND_RESULTS.applied as unknown);
  });

  /* ── capture: the operator's start, and the phone's closed union (2i-F) ─── */

  app.post("/api/v1/capture/sessions", (c) => c.json(FIXTURE_CAPTURE_START as unknown, 201));

  /**
   * The OPERATOR's two reads (D274 item 7). Both are GET and both are scoped by
   * nothing but the session id, exactly as the real routes are — the desktop is
   * on the loopback side of the ingress and needs no token, which is the whole
   * reason the phone's union is closed and these two are not in it.
   *
   * An id this fixture does not hold answers 404 rather than the operator
   * session it does hold: a fixture that served one session for every id would
   * make the panel's "could not be read" arm unreachable.
   */
  app.get("/api/v1/capture/sessions", (c) => c.json(FIXTURE_CAPTURE_OPERATOR_LIST as unknown));

  app.get("/api/v1/capture/sessions/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");
    if (sessionId !== FIXTURE_CAPTURE_OPERATOR.sessionId) {
      return c.json(wireError("TARGET_NOT_FOUND", `capture session ${sessionId} is not in authority`), 404);
    }
    return c.json(FIXTURE_CAPTURE_OPERATOR as unknown);
  });

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

function serveSse(
  res: ServerResponse,
  open: Set<ServerResponse>,
  profile: FixtureDashboardProfile,
  dayWire: DashboardDayWire,
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(sseSerialize(fixtureHelloEnvelope(profile)));
  res.write(sseSerialize(fixtureSnapshotEnvelope(dayWire)));
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

export interface FixtureArtifactExchange {
  readonly method: string;
  readonly pathname: string;
  readonly status: number;
}

export interface FixtureServer {
  readonly port: number;
  readonly baseUrl: string;
  artifactExchanges(): readonly Readonly<FixtureArtifactExchange>[];
  publish(envelope: DashboardStreamEnvelope): void;
  close(): Promise<void>;
}

export async function startFixtureServer(
  input: Readonly<{
    distDir: string;
    bundle: ParityBundleProof;
    profile?: FixtureDashboardProfile;
    dayWire?: DashboardDayWire;
    archiveScenario?: "evidence";
    diagnosticFixture?: "restricted-jpeg";
    runCaptureScenario?: "evidence";
  }>,
): Promise<FixtureServer> {
  // Ref frontend-backend-integration §7: a served bundle must provably be a build of the working tree.
  // Asserted BEFORE a port is bound, so a stale `dist/dashboard` can never be
  // reached over HTTP — and never leaks a listening socket on refusal.
  assertServedBundle(input.distDir, input.bundle);
  const profile = input.profile ?? DEFAULT_DASHBOARD_PROFILE;
  const dayWire = input.dayWire ?? (input.runCaptureScenario === "evidence" ? FIXTURE_RUN_CAPTURE_DAY : profile.day);
  const { app } = createFixtureBff({ profile, dayWire,
    ...(input.archiveScenario === undefined ? {} : { archiveScenario: input.archiveScenario }),
    ...(input.diagnosticFixture === undefined ? {} : { diagnosticFixture: input.diagnosticFixture }),
    ...(input.runCaptureScenario === undefined ? {} : { runCaptureScenario: input.runCaptureScenario }),
  });
  const openStreams = new Set<ServerResponse>();
  const artifactExchanges: FixtureArtifactExchange[] = [];

  const server: Server = createServer((req, res) => {
    void (async (): Promise<void> => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/events/v1") {
        serveSse(res, openStreams, profile, dayWire);
        return;
      }
      // Byte lookups never fall back to static success. Keep Archive's exact
      // route independent; generic UUID descendants and extensionless invalid
      // lookups reach the app's 404. Named static files (archive-help.html,
      // archive-notes/readme.json) remain outside this generic identity lane.
      const archiveCapture = /^\/artifacts\/v1\/archive\/[^/]+\/[^/]+$/u.test(url.pathname);
      const genericCapture = /^\/artifacts\/v1\/(?!archive(?:\/|$))[^/.]+(?:\/[^/.]+)*$/u.test(url.pathname)
        || /^\/artifacts\/v1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[/.]|$)/iu.test(url.pathname);
      if (url.pathname.startsWith("/api/") || archiveCapture || genericCapture) {
        const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
        const response = await app.fetch(new Request(`http://127.0.0.1${url.pathname}${url.search}`, {
          method: req.method ?? "GET",
          headers: Object.fromEntries(
            Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          ),
          ...(body === undefined ? {} : { body: new Uint8Array(body) }),
        }));
        if (archiveCapture || genericCapture) {
          artifactExchanges.push(Object.freeze({
            method: req.method ?? "GET",
            pathname: url.pathname,
            status: response.status,
          }));
        }
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
    artifactExchanges: () => Object.freeze(artifactExchanges.map(exchange => Object.freeze({ ...exchange }))),
    publish(envelope: DashboardStreamEnvelope): void {
      if (openStreams.size === 0) throw new Error("the fixture server has no open SSE stream to publish to");
      const serialized = sseSerialize(DashboardStreamEnvelopeSchema.parse(envelope));
      for (const stream of openStreams) stream.write(serialized);
    },
    close: async (): Promise<void> => {
      for (const stream of openStreams) stream.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error === undefined ? resolvePromise() : rejectPromise(error)));
      });
    },
  });
}
