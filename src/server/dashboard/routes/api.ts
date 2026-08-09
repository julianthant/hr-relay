/**
 * The dashboard BFF routes (doc 13 §0/§3.6) — thin parse/dispatch boundaries
 * over the queries, the command service, and the stream hub. A handler here
 * parses input, calls one service, parses output, and returns it; no
 * projection logic, no workflow switches, no second count path.
 *
 * Every failure leaves as a typed `WireError` body: schema failures are 400,
 * a named-target miss is 404, an unavailable section/capability is 409, and
 * anything else is a 500 that carries the real message — never a silent 200
 * with a plausible body.
 */
import { Hono } from "hono";
import { z } from "zod";
import { WireErrorSchema } from "../../../domain/dashboard/primitives.js";
import type { DashboardStreamEnvelope } from "../../../domain/dashboard/subscription.js";
import type { DashboardCommandService } from "../commands/command-service.js";
import type { IntakeService } from "../commands/intake-service.js";
import { CaptureRefusal, type CaptureService } from "../commands/capture-service.js";
import {
  CAPTURE_TOKEN_HEADER,
  isCapturePhoneAsset,
  matchesCapturePhoneRoute,
} from "../../../domain/capture-surface.js";
import type { StartPlanService } from "../commands/start-plan-service.js";
import { buildBootstrap, type BootstrapQueryDeps } from "../queries/bootstrap.js";
import { buildStorageDoctor, type StorageQueryDeps } from "../queries/storage.js";
import { buildRunDetail, buildRunSection, type RunDetailQueryDeps } from "../queries/run-detail.js";
import type { RunQueueProjection } from "../projectors/run-queue-projection.js";
import type { DashboardStreamHub } from "../subscriptions/dashboard-stream.js";
import { errorText } from "../support.js";

export interface DashboardAppDeps {
  readonly bootstrap: BootstrapQueryDeps;
  readonly projection: RunQueueProjection;
  readonly runDetail: RunDetailQueryDeps;
  readonly commands: DashboardCommandService;
  readonly startPlans: StartPlanService;
  readonly intake: IntakeService;
  readonly capture: CaptureService;
  readonly hub: DashboardStreamHub;
  readonly storage: StorageQueryDeps;
  /**
   * The Host a capture ingress forwards under, when one is configured. A
   * request arriving on it is a PHONE request and may reach nothing outside
   * doc 06 §5.1's closed union — doc 12 §7's single exception to loopback-only,
   * enforced here rather than trusted to the tunnel (D174).
   */
  readonly capturePhoneHost?: string;
  /** Asset paths the phone page's own build reaches; nothing else is served. */
  readonly capturePhoneAssetPaths?: ReadonlySet<string>;
}

const NOT_FOUND_MARKERS = [
  "is not registered",
  "does not exist",
  "has no span fold",
  "not in authority",
] as const;

function wireError(code: string, message: string, retryable: boolean): Record<string, unknown> {
  return WireErrorSchema.parse({ state: "error", code, message, retryable });
}

function failureStatus(error: unknown): { status: 400 | 404 | 409 | 500; body: Record<string, unknown> } {
  if (error instanceof z.ZodError) {
    return { status: 400, body: wireError("SCHEMA_INVALID", z.prettifyError(error), false) };
  }
  const message = errorText(error);
  if (NOT_FOUND_MARKERS.some((marker) => message.includes(marker))) {
    return { status: 404, body: wireError("TARGET_NOT_FOUND", message, false) };
  }
  if (message.includes("is not available")) {
    return { status: 409, body: wireError("SECTION_UNAVAILABLE", message, false) };
  }
  if (message.includes("degraded")) {
    return { status: 500, body: wireError("PROJECTION_DEGRADED", message, true) };
  }
  return { status: 500, body: wireError("INTERNAL_FAILURE", message, false) };
}

const DayQuerySchema = z.iso.date();
const TOPICS_PATTERN = /^dashboard-day:(\d{4}-\d{2}-\d{2})$/;

function sseSerialize(envelope: DashboardStreamEnvelope): string {
  const id = "cursor" in envelope ? `id: ${envelope.cursor}\n` : "";
  return `${id}data: ${JSON.stringify(envelope)}\n\n`;
}

/**
 * Every phone failure leaves as the same shaped body. `unknown-session` is a
 * 404 with ONE message (D174's fail-closed enumeration); the rest are 422,
 * because the caller has already proven it holds the session's token and a
 * named reason tells it what to do next.
 */
function captureRefusalResponse(refusal: CaptureRefusal): {
  status: 404 | 422;
  body: Record<string, unknown>;
} {
  const code = `CAPTURE_${refusal.code.toUpperCase().replaceAll("-", "_")}`;
  return refusal.code === "unknown-session"
    ? { status: 404, body: wireError(code, refusal.message, false) }
    : { status: 422, body: wireError(code, refusal.message, false) };
}

export function createDashboardApp(deps: DashboardAppDeps): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof CaptureRefusal) {
      const { status, body } = captureRefusalResponse(error);
      return c.json(body, status);
    }
    const { status, body } = failureStatus(error);
    return c.json(body, status);
  });

  /**
   * Doc 12 §7's scope, enforced before any handler runs. A request that
   * arrived over the capture ingress may reach the phone page, that page's own
   * assets, and doc 06 §5.1's closed route union — nothing else, including
   * every catch-all. The refusal is byte-identical to an unrouted path so the
   * ingress cannot be used to enumerate what the operator's dashboard serves.
   */
  app.use("*", async (c, next) => {
    const phoneHost = deps.capturePhoneHost;
    if (phoneHost === undefined) return next();
    const host = c.req.header("host");
    if (host === undefined || host.toLowerCase() !== phoneHost.toLowerCase()) return next();
    const path = c.req.path;
    const allowed = matchesCapturePhoneRoute(c.req.method, path)
      || isCapturePhoneAsset(path, deps.capturePhoneAssetPaths ?? new Set());
    if (!allowed) {
      return c.json(
        wireError("ROUTE_NOT_FOUND", `no route serves ${c.req.method} ${path}`, false),
        404,
      );
    }
    return next();
  });

  app.get("/api/v1/bootstrap", (c) => c.json(buildBootstrap(deps.bootstrap)));

  // Doc 03 §2.5's read-only doctor, on demand from the Settings surface.
  app.get("/api/v1/storage/doctor", async (c) => c.json(await buildStorageDoctor(deps.storage)));

  app.get("/api/v1/dashboard", (c) => {
    const day = DayQuerySchema.parse(c.req.query("day"));
    return c.json(deps.projection.buildDashboardDayWire(day));
  });

  app.get("/api/v1/runs/:runId", (c) => c.json(buildRunDetail(deps.runDetail, c.req.param("runId"))));

  app.get("/api/v1/runs/:runId/:section", (c) => {
    const cursor = c.req.query("cursor");
    return c.json(buildRunSection(
      deps.runDetail,
      c.req.param("runId"),
      c.req.param("section"),
      ...(cursor === undefined ? [] : [cursor]),
    ));
  });

  app.post("/api/v1/start-plans", async (c) => {
    const body: unknown = await c.req.json();
    return c.json(deps.startPlans.plan(body));
  });

  /**
   * Doc 06 §2.2's upload (D170). The ROUTE creates the session because
   * creation carries bytes, and bytes do not belong in a journaled command
   * envelope. A re-upload of the same digest JOINS its open session — the same
   * `200` either way, with the operator's existing mapping still on it.
   *
   * `filename` is required (D171): the durable manifest must name the file it
   * ran, and a content-addressed artifact carries a digest rather than a name,
   * so this request is the only place that fact is ever observed.
   */
  app.post("/api/v1/intake/files", async (c) => {
    const workflow = z.string().min(1).parse(c.req.query("workflow"));
    const fileName = z.string().min(1).parse(c.req.query("filename"));
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const outcome = await deps.intake.upload({
      workflow,
      mediaType: c.req.header("content-type") ?? "",
      fileName,
      bytes,
    });
    if (outcome.state === "refused") {
      return c.json(wireError(`INTAKE_${outcome.code.toUpperCase().replaceAll("-", "_")}`, outcome.message, false), 422);
    }
    return c.json(outcome.session, outcome.state === "created" ? 201 : 200);
  });

  app.get("/api/v1/intake/:sessionId", async (c) => c.json(await deps.intake.read(c.req.param("sessionId"))));

  /* ── capture: the operator's two loopback routes (doc 06 §5.1, D174) ────── */

  const CaptureStartBodySchema = z.strictObject({
    workflow: z.string().min(1),
    formType: z.string().min(1).optional(),
    contextHint: z.string().min(1).max(200).optional(),
  });

  app.post("/api/v1/capture/sessions", async (c) => {
    const body = CaptureStartBodySchema.parse(await c.req.json());
    const result = await deps.capture.start(body);
    // A refused ingress is a CONFIGURATION answer, not a server fault: the
    // dashboard renders its remediation beside the button that asked.
    return c.json(result, result.state === "refused" ? 409 : 201);
  });

  app.get("/api/v1/capture/sessions/:sessionId", (c) =>
    c.json(deps.capture.readSession(c.req.param("sessionId"))));

  /* ── capture: the closed phone union (doc 12 §7) ────────────────────────── */

  /** The token is a credential, so it rides a header — never a path or query. */
  const captureToken = (c: { req: { header: (name: string) => string | undefined } }): string =>
    c.req.header(CAPTURE_TOKEN_HEADER) ?? "";

  const CaptureCommandFactsSchema = z.strictObject({
    commandId: z.string().min(1),
    expectedVersion: z.coerce.number().int().positive(),
  });

  app.get("/api/v1/capture/phone/session", (c) => c.json(deps.capture.readByToken(captureToken(c))));

  app.post("/api/v1/capture/phone/photos", async (c) => {
    const facts = CaptureCommandFactsSchema.parse({
      commandId: c.req.query("commandId"),
      expectedVersion: c.req.query("expectedVersion"),
    });
    return c.json(await deps.capture.uploadPhoto(captureToken(c), {
      ...facts,
      photoId: z.string().min(1).parse(c.req.query("photoId")),
      mediaType: c.req.header("content-type") ?? "",
      bytes: new Uint8Array(await c.req.arrayBuffer()),
    }));
  });

  app.put("/api/v1/capture/phone/photos/:photoId", async (c) => {
    const facts = CaptureCommandFactsSchema.parse({
      commandId: c.req.query("commandId"),
      expectedVersion: c.req.query("expectedVersion"),
    });
    return c.json(await deps.capture.replacePhoto(captureToken(c), {
      ...facts,
      photoId: c.req.param("photoId"),
      mediaType: c.req.header("content-type") ?? "",
      bytes: new Uint8Array(await c.req.arrayBuffer()),
    }));
  });

  app.get("/api/v1/capture/phone/photos/:photoId/bytes", async (c) => {
    const photo = await deps.capture.readPhotoBytes(captureToken(c), c.req.param("photoId"));
    // `.slice()` re-homes the view onto a plain ArrayBuffer, which is what
    // `BodyInit` accepts; handing the raw view through fails to typecheck
    // rather than being coerced silently.
    return new Response(photo.bytes.slice().buffer, {
      status: 200,
      headers: { "content-type": photo.mediaType, "cache-control": "no-store" },
    });
  });

  app.delete("/api/v1/capture/phone/photos/:photoId", (c) => {
    const facts = CaptureCommandFactsSchema.parse({
      commandId: c.req.query("commandId"),
      expectedVersion: c.req.query("expectedVersion"),
    });
    return c.json(deps.capture.deletePhoto(captureToken(c), c.req.param("photoId"), facts));
  });

  const CaptureOrderBodySchema = z.strictObject({
    commandId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    orderedPhotoIds: z.array(z.string().min(1)).min(1),
  });

  app.post("/api/v1/capture/phone/order", async (c) => {
    const body = CaptureOrderBodySchema.parse(await c.req.json());
    return c.json(deps.capture.reorder(captureToken(c), body.orderedPhotoIds, body));
  });

  const CaptureVerbBodySchema = z.strictObject({
    commandId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
  });

  app.post("/api/v1/capture/phone/finalize", async (c) =>
    c.json(await deps.capture.finalize(captureToken(c), CaptureVerbBodySchema.parse(await c.req.json()))));

  app.post("/api/v1/capture/phone/retry-finalize", async (c) =>
    c.json(await deps.capture.retryFinalize(captureToken(c), CaptureVerbBodySchema.parse(await c.req.json()))));

  app.post("/api/v1/capture/phone/discard", async (c) =>
    c.json(deps.capture.discard(captureToken(c), CaptureVerbBodySchema.parse(await c.req.json()))));

  app.post("/api/v1/commands", async (c) => {
    const body: unknown = await c.req.json();
    // Warm the seams a synchronous authority transaction cannot await. Today
    // that is exactly the intake parse (D170); every other family is a no-op.
    await deps.intake.prepare(body);
    const result = deps.commands.execute(body);
    const status = result.state === "conflict" ? 409 : result.state === "rejected" ? 422 : 200;
    return c.json(result, status);
  });

  app.get("/events/v1", (c) => {
    const topics = z.string()
      .regex(TOPICS_PATTERN, "topics must be dashboard-day:<YYYY-MM-DD>")
      .parse(c.req.query("topics"));
    const match = TOPICS_PATTERN.exec(topics);
    if (match === null) throw new Error(`topics ${topics} passed its schema but did not match; refusing to subscribe`);
    const lastEventId = c.req.header("Last-Event-ID") ?? c.req.query("cursor");
    const connection = deps.hub.connect({
      day: match[1],
      ...(lastEventId === undefined ? {} : { lastEventId }),
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        for (const envelope of connection.initial) {
          controller.enqueue(encoder.encode(sseSerialize(envelope)));
        }
        connection.subscribe((envelope) => {
          controller.enqueue(encoder.encode(sseSerialize(envelope)));
        });
      },
      cancel(): void {
        connection.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  });

  app.notFound((c) => c.json(wireError("ROUTE_NOT_FOUND", `no route serves ${c.req.method} ${c.req.path}`, false), 404));

  return app;
}
