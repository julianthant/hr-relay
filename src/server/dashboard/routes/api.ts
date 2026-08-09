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
  readonly hub: DashboardStreamHub;
  readonly storage: StorageQueryDeps;
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

export function createDashboardApp(deps: DashboardAppDeps): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    const { status, body } = failureStatus(error);
    return c.json(body, status);
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

  app.post("/api/v1/commands", async (c) => {
    const body: unknown = await c.req.json();
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
