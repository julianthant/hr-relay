import type { DashboardApp, DashboardAppDeps } from "./api-types.js";
export type { DashboardApp, DashboardAppDeps } from "./api-types.js";
import { registerDataRoutes } from "./data.js";
import { registerTrustRoutes } from "./trust.js";
import { registerOperatorRoutes } from "./operator.js";
import { composeDataQueries } from "../compose/data.js";
/**
 * The dashboard BFF routes (ref frontend-backend-integration §0/§3.6) — thin parse/dispatch boundaries
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
import {
  createOperatorCommandIngress,
} from "../commands/operator-command-ingress.js";
import { buildBootstrap } from "../queries/bootstrap.js";
import { buildWorkflowExplorer } from "../queries/explorer.js";
import { buildUiCatalogWire } from "../queries/ui-catalog.js";
import { buildRunAdvisory } from "../queries/advisory.js";

import {
  ArchivedCaptureReadError,
} from "../queries/archive.js";
import { dashboardEventStreamBody } from "../subscriptions/sse-response.js";
import { staticBundleHandler } from "../static-bundle.js";
import { SectionUnavailableError } from "../../failures.js";
import { PositiveIntSchema, ProjectionCursorSchema } from "../../../domain/ids.js";
import { BulkRunCommandRequestSchema, CommandRequestSchema } from "../../../domain/commands.js";
import { PreflightRerunCommandRequestSchema } from "../../../domain/preflight-contract.js";
import { operatorMutationIngressGuard, operatorOpaqueIngressGuard } from "./operator-mutation-ingress.js";
import { parseCrossDateSearchRouteQuery } from "./search-schema.js";
import {
  assertRequestActor,
  type RequestIdentityCheckpoint,
} from "../request-identity.js";
import { failureStatus, wireError } from "./failure-status.js";

const TOPICS_PATTERN = /^dashboard-day:(\d{4}-\d{2}-\d{2})$/;
const StreamResumeSchema = z.strictObject({
  lastEventId: ProjectionCursorSchema.optional(),
  lastProjectionGeneration: PositiveIntSchema.optional(),
}).superRefine((resume, context) => {
  if (resume.lastProjectionGeneration !== undefined && resume.lastEventId === undefined) {
    context.addIssue({
      code: "custom",
      path: ["lastProjectionGeneration"],
      message: "a projection generation can resume only the cursor it qualifies",
    });
  }
});

function isLoopbackHost(value: string | undefined): boolean {
  if (value === undefined) return false;
  const match = /^(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?$/iu.exec(value);
  if (match === null) return false;
  const port = match[1];
  return port === undefined || (Number(port) >= 1 && Number(port) <= 65_535);
}

type LoopbackOriginInspection = Readonly<
  | { state: "allowed" }
  | { state: "malformed" }
  | { state: "forbidden" }
>;

function inspectLoopbackOrigin(value: string | undefined): LoopbackOriginInspection {
  if (value === undefined) return { state: "allowed" };
  if (!URL.canParse(value)) return { state: "malformed" };
  const origin = new URL(value);
  return (origin.protocol === "http:" || origin.protocol === "https:")
    && (origin.hostname === "127.0.0.1" || origin.hostname === "localhost")
    && origin.username === ""
    && origin.password === ""
    && origin.pathname === "/"
    && origin.search === ""
    && origin.hash === ""
    ? { state: "allowed" }
    : { state: "forbidden" };
}

const PREFLIGHT_RERUN_BODY_MAX_BYTES = 4096;
const PREFLIGHT_RERUN_WINDOW_MS = 60_000;
const PREFLIGHT_RERUN_WINDOW_LIMIT = 6;

type PreflightBodyRead = Readonly<
  { state: "parsed"; value: unknown }
  | { state: "too-large" }
  | { state: "invalid-content-type" }
  | { state: "invalid-content-length" }
  | { state: "missing-body" }
  | { state: "read-failed" }
  | { state: "invalid-utf8" }
  | { state: "invalid-json" }
>;

async function readPreflightBody(request: Request): Promise<PreflightBodyRead> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return { state: "invalid-content-type" };
  const declaredText = request.headers.get("content-length");
  if (declaredText !== null) {
    if (!/^(?:0|[1-9]\d*)$/u.test(declaredText)) return { state: "invalid-content-length" };
    const declared = Number(declaredText);
    if (!Number.isSafeInteger(declared)) return { state: "invalid-content-length" };
    if (declared > PREFLIGHT_RERUN_BODY_MAX_BYTES) return { state: "too-large" };
  }
  if (request.body === null) return { state: "missing-body" };
  const reader = request.body.getReader();
  let bytesRead = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > PREFLIGHT_RERUN_BODY_MAX_BYTES) {
        await reader.cancel("preflight rerun body exceeded its byte limit");
        return { state: "too-large" };
      }
      chunks.push(chunk.value);
    }
  } catch {
    return { state: "read-failed" };
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { state: "invalid-utf8" };
  }
  try {
    return { state: "parsed", value: JSON.parse(text) as unknown };
  } catch {
    return { state: "invalid-json" };
  }
}

export function createDashboardApp(deps: DashboardAppDeps): DashboardApp {
  const app = new Hono<{
    Variables: { requestActorId: ReturnType<RequestIdentityCheckpoint["identify"]> };
  }>();
  const preflightStarts: number[] = [];
  let preflightActive = false;
  const operatorCommands = createOperatorCommandIngress({
    clock: deps.bootstrap.clock,
    journal: deps.commandJournal,
    protectedCommandAcceptedAt: deps.protectedCommandAcceptedAt,
    bulkAcceptances: deps.bulkCommandAcceptances,
  });

  app.onError((error, c) => {
    if (error instanceof ArchivedCaptureReadError) {
      return c.json(wireError(error.code, error.message, false), 500);
    }
    const { status, body } = failureStatus(error);
    return c.json(body, status);
  });

  app.use("*", async (c, next) => {
    c.set("requestActorId", deps.requestIdentity.identify(c.req.raw));
    return next();
  });

  // Every browser-reachable POST that can touch durable authority, spend a
  // constrained provider, or create a session is admitted HERE, before its
  // handler reads a byte (ref frontend-backend-integration §3.4, D75). The
  // architecture guard `operator-mutation-admission` pins this table: a new
  // POST route without a row below is a red gate, not a quiet exposure.
  app.use("/api/v1/commands", operatorMutationIngressGuard);
  app.use("/api/v1/commands/bulk", operatorMutationIngressGuard);
  app.use("/api/v1/exports/xlsx", operatorMutationIngressGuard);
  app.use("/api/v1/start-plans", operatorMutationIngressGuard);
  app.use("/api/v1/explorer/validate", operatorMutationIngressGuard);
  // Intake bytes travel under the file's own media type (D170) and the advisory
  // carries no body: Host/Origin gate both; the body contract stays the route's.
  app.use("/api/v1/intake/files", operatorOpaqueIngressGuard);
  app.use("/api/v1/runs/:runId/advisory", operatorOpaqueIngressGuard);

  registerDataRoutes(app, () => deps.data ?? composeDataQueries(deps.runDetail));
  registerOperatorRoutes(app, deps);
  registerTrustRoutes(app, deps);

  app.get("/api/v1/bootstrap", (c) => c.json(buildBootstrap(deps.bootstrap)));

  app.post("/api/v1/preflight/rerun", async (c) => {
    const origin = inspectLoopbackOrigin(c.req.header("origin"));
    if (origin.state === "malformed") {
      return c.json(wireError(
        "PREFLIGHT_ORIGIN_INVALID",
        "preflight rerun Origin must be one absolute HTTP(S) origin",
        false,
      ), 400);
    }
    if (!isLoopbackHost(c.req.header("host")) || origin.state === "forbidden") {
      return c.json(wireError(
        "PREFLIGHT_INGRESS_FORBIDDEN",
        "preflight reruns require a loopback Host and, when present, a loopback Origin",
        false,
      ), 403);
    }
    const body = await readPreflightBody(c.req.raw);
    if (body.state === "too-large") {
      return c.json(wireError(
        "PREFLIGHT_BODY_TOO_LARGE",
        `preflight rerun bodies may not exceed ${String(PREFLIGHT_RERUN_BODY_MAX_BYTES)} bytes`,
        false,
      ), 413);
    }
    if (body.state !== "parsed") {
      const failure = {
        "invalid-content-type": ["PREFLIGHT_CONTENT_TYPE_INVALID", "preflight reruns require application/json"],
        "invalid-content-length": ["PREFLIGHT_CONTENT_LENGTH_INVALID", "preflight rerun Content-Length must be a bounded decimal byte count"],
        "missing-body": ["PREFLIGHT_BODY_MISSING", "preflight reruns require a JSON request body"],
        "read-failed": ["PREFLIGHT_BODY_READ_FAILED", "the preflight rerun request body could not be read"],
        "invalid-utf8": ["PREFLIGHT_BODY_UTF8_INVALID", "the preflight rerun request body must be valid UTF-8"],
        "invalid-json": ["PREFLIGHT_BODY_JSON_INVALID", "the preflight rerun request body must be valid JSON"],
      } as const satisfies Record<Exclude<PreflightBodyRead["state"], "parsed" | "too-large">, readonly [string, string]>;
      const [code, message] = failure[body.state];
      return c.json(wireError(
        code,
        message,
        false,
      ), 400);
    }
    const command = PreflightRerunCommandRequestSchema.safeParse(body.value);
    if (command.success) assertRequestActor(c.get("requestActorId"), command.data.requestedBy);
    if (preflightActive) {
      return c.json(wireError(
        "PREFLIGHT_RERUN_ACTIVE",
        "one preflight rerun is already active",
        true,
      ), 429);
    }
    const now = deps.bootstrap.clock.monotonicMs();
    while (preflightStarts[0] !== undefined
      && preflightStarts[0] <= now - PREFLIGHT_RERUN_WINDOW_MS) preflightStarts.shift();
    if (preflightStarts.length >= PREFLIGHT_RERUN_WINDOW_LIMIT) {
      return c.json(wireError(
        "PREFLIGHT_RATE_LIMITED",
        `preflight reruns are limited to ${String(PREFLIGHT_RERUN_WINDOW_LIMIT)} starts per minute`,
        true,
      ), 429);
    }
    preflightStarts.push(now);
    preflightActive = true;
    try {
      return c.json(await deps.preflight.execute(body.value, c.req.raw.signal));
    } finally {
      preflightActive = false;
    }
  });

  app.get("/api/v1/search", (c) =>
    c.json(deps.search.search(parseCrossDateSearchRouteQuery(c.req.url))));

  /**
   * DCR5's narrow operator workbook command. This is deliberately NOT an
   * artifact-id byte reader: the command composes, persists, verifies and
   * serves only the workbook it just generated from one strict selection.
   */
  app.post("/api/v1/exports/xlsx", async (c) => {
    if (deps.xlsxExports === undefined) {
      throw new SectionUnavailableError("operator XLSX export is unavailable: no export authority is composed");
    }
    const download = await deps.xlsxExports.export(c.get("requestActorId"), await c.req.json());
    return new Response(Uint8Array.from(download.bytes), {
      status: 200,
      headers: {
        "content-type": download.mediaType,
        "content-disposition": download.contentDisposition,
        "content-length": String(download.bytes.byteLength),
        etag: `"${download.evidence.download.sha256}"`,
        "x-operator-export-id": download.evidence.exportId,
        "cache-control": "no-store",
      },
    });
  });

  /** Ref operator-trust §5.2–§5.4: exact graph read plus strict safe-edit draft validation. */
  app.get("/api/v1/explorer", (c) => c.json(buildWorkflowExplorer(deps.explorer)));
  app.post("/api/v1/explorer/validate", async (c) => {
    if (deps.explorerEdits === undefined) {
      throw new SectionUnavailableError("Explorer safe-edit authority is not composed in this process");
    }
    const result = deps.explorerEdits.validate(await c.req.json());
    const status = result.state === "conflict" ? 409
      : result.state === "ready-to-apply" ? 200 : 422;
    return c.json(result, status);
  });

  app.get("/api/v1/ui-catalog", (c) => c.json(buildUiCatalogWire(deps.uiCatalog)));

  /**
   * Ref operator-trust §4.4's on-demand failure advisory (D178). It is a POST because it
   * SPENDS a provider budget — a GET the surface could prefetch would make a
   * model call every time an operator opened a failed run — and it is
   * deliberately NOT part of the command family: it journals nothing, changes
   * nothing, and returns advice the operator may ignore.
   */
  app.post("/api/v1/runs/:runId/advisory", async (c) => {
    if (deps.advisory === undefined) {
      throw new SectionUnavailableError(
        "the failure advisory is not available: no ai.advisory provider is composed",
      );
    }
    return c.json(await buildRunAdvisory(deps.advisory, c.req.param("runId")));
  });

  app.post("/api/v1/start-plans", async (c) => {
    const body: unknown = await c.req.json();
    return c.json(deps.startPlans.plan(body));
  });

  /**
   * Ref data-intake-and-edit-data §2.2's upload (D170). The ROUTE creates the session because
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

  app.post("/api/v1/commands", async (c) => {
    const body: unknown = await c.req.json();
    const command = CommandRequestSchema.safeParse(body);
    if (command.success) assertRequestActor(c.get("requestActorId"), command.data.requestedBy);
    const result = await operatorCommands.submit(body, async (accepted) => {
      // Warm the seams a synchronous authority transaction cannot await. Today
      // that is exactly the intake parse (D170); every other family is a no-op.
      await deps.intake.prepare(accepted);
      // W3: `submit` routes the worker-browser family through the kernel's
      // async pool seam (the process effect settles before the reply) and every
      // other family through the same synchronous path as before.
      return deps.commands.submit(accepted);
    });
    const status = result.state === "conflict" ? 409 : result.state === "rejected" ? 422 : 200;
    return c.json(result, status);
  });

  /**
   * D235 — the bulk door. It is a SECOND route rather than a mode of the one
   * above because the two answer different shapes: one command answers one
   * `CommandResult`, and N commands answer N of them. Folding a vector into the
   * single-result union would have made every existing consumer parse a shape
   * it can never receive, and would have given the collapse-into-"Done" defect
   * a place to hide.
   *
   * No `intake.prepare` warm-up: the bulk vocabulary is the three run verbs,
   * none of which reaches an async seam.
   */
  app.post("/api/v1/commands/bulk", async (c) => {
    const body: unknown = await c.req.json();
    const command = BulkRunCommandRequestSchema.safeParse(body);
    if (command.success) assertRequestActor(c.get("requestActorId"), command.data.requestedBy);
    const result = await operatorCommands.executeBulk(
      body,
      (accepted) => deps.commands.executeBulk(accepted),
    );
    return c.json(result, result.state === "refused" ? 422 : 200);
  });

  app.get("/events/v1", async (c) => {
    const topics = z.string()
      .regex(TOPICS_PATTERN, "topics must be dashboard-day:<YYYY-MM-DD>")
      .parse(c.req.query("topics"));
    const match = TOPICS_PATTERN.exec(topics);
    if (match === null) throw new Error(`topics ${topics} passed its schema but did not match; refusing to subscribe`);
    const rawLastEventId = c.req.header("Last-Event-ID") ?? c.req.query("cursor");
    const rawLastProjectionGeneration = c.req.header("Dashboard-Projection-Generation")
      ?? c.req.query("projectionGeneration");
    const resume = StreamResumeSchema.parse({
      ...(rawLastEventId === undefined ? {} : { lastEventId: rawLastEventId }),
      ...(rawLastProjectionGeneration === undefined
        ? {}
        : { lastProjectionGeneration: Number(rawLastProjectionGeneration) }),
    });
    const connection = await deps.hub.connect({
      day: match[1],
      ...resume,
    });
    const stream = dashboardEventStreamBody(connection);
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  });

  if (deps.staticBundle !== undefined) app.use("*", staticBundleHandler(deps.staticBundle));

  app.notFound((c) => c.json(wireError("ROUTE_NOT_FOUND", `no route serves ${c.req.method} ${c.req.path}`, false), 404));

  return app;
}
