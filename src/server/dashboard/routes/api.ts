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
import type { DashboardCommandService } from "../commands/command-service.js";
import {
  createOperatorCommandIngress,
  type BulkCommandAcceptanceAuthority,
} from "../commands/operator-command-ingress.js";
import type { CommandRequest } from "../../../domain/commands.js";
import type { IntakeService } from "../commands/intake-service.js";
import type { StartPlanService } from "../commands/start-plan-service.js";
import type { ExplorerEditService } from "../commands/explorer-edit-service.js";
import { buildBootstrap, type BootstrapQueryDeps } from "../queries/bootstrap.js";
import { buildStorageDoctor, type StorageQueryDeps } from "../queries/storage.js";
import { buildSettingsFacts, type SettingsQueryDeps } from "../queries/settings.js";
import { buildSettingsEditor, type SettingsEditorQueryDeps } from "../queries/settings-editor.js";
import { buildWorkflowExplorer, type ExplorerQueryDeps } from "../queries/explorer.js";
import { buildUiCatalogWire, type UiCatalogQueryDeps } from "../queries/ui-catalog.js";
import { readRunDetail, readRunSection, type RunDetailQueryDeps } from "../queries/run-detail.js";
import { buildRunAdvisory, type AdvisoryQueryDeps } from "../queries/advisory.js";
import {
  readDiagnosticBundle,
  readDiagnosticBundleAttachment,
  type DiagnosticBundleQueryDeps,
} from "../queries/diagnostic-bundle.js";
import {
  IndexedArtifactBytesMissingError,
  prepareDiagnosticArtifactLease,
  type ArtifactBytesQueryDeps,
} from "../queries/artifact-bytes.js";
import {
  ArchivedCaptureReadError,
  buildArchiveIndex,
  buildArchivedCaptureResource,
  buildArchivedRunDetail,
  prepareArchivedCaptureLease,
  type ArchiveQueryDeps,
} from "../queries/archive.js";
import { activityReportCsv, activityReportCsvFileName } from "../queries/activity-export.js";
import type { CrossDateSearchQueryService } from "../queries/search.js";
import type { RunQueueProjection } from "../projectors/run-queue-projection.js";
import type { OperatorXlsxExportService } from "../exports/operator-xlsx-export-service.js";
import type { DashboardStreamHub } from "../subscriptions/dashboard-stream.js";
import { dashboardEventStreamBody } from "../subscriptions/sse-response.js";
import { staticBundleHandler, type StaticBundle } from "../static-bundle.js";
import { DiagnosticBundleBytesMissingError, SectionUnavailableError } from "../../failures.js";
import { PositiveIntSchema, ProjectionCursorSchema } from "../../../domain/ids.js";
import { BulkRunCommandRequestSchema, CommandRequestSchema } from "../../../domain/commands.js";
import { PreflightRerunCommandRequestSchema } from "../../../domain/preflight-contract.js";
import { operatorMutationIngressGuard, operatorOpaqueIngressGuard } from "./operator-mutation-ingress.js";
import type { createPreflightAuthority } from "../../../domain/preflight.js";
import { parseCrossDateSearchRouteQuery } from "./search-schema.js";
import {
  assertRequestActor,
  type RequestIdentityCheckpoint,
} from "../request-identity.js";
import { failureStatus, wireError } from "./failure-status.js";
import { verifiedByteResponse } from "./verified-byte-response.js";

export interface DashboardAppDeps {
  /** D75: the one server-owned actor derivation every BFF request crosses. */
  readonly requestIdentity: RequestIdentityCheckpoint;
  readonly bootstrap: BootstrapQueryDeps;
  /** Read-only strict preflight authority; no command-kernel mutation or journal row is produced. */
  readonly preflight: Pick<ReturnType<typeof createPreflightAuthority>, "execute">;
  readonly projection: RunQueueProjection;
  /** D283: bounded cross-date reads from exact durable run authority. */
  readonly search: CrossDateSearchQueryService;
  /** DCR5's dedicated command; it persists exact attachment evidence before returning bytes. */
  readonly xlsxExports?: OperatorXlsxExportService;
  readonly runDetail: RunDetailQueryDeps;
  /** D137 bundle readback; exact-id routes verify durable row and bytes before serving. */
  readonly diagnosticBundles?: DiagnosticBundleQueryDeps & ArtifactBytesQueryDeps;
  /** Ref dashboard-surfaces §10.2's read-only Archive + the live version-bump state (2i-G, D179). */
  readonly archive: ArchiveQueryDeps;
  readonly commands: DashboardCommandService;
  readonly commandJournal: Readonly<{
    get(commandId: string): CommandRequest | undefined;
  }>;
  readonly bulkCommandAcceptances: BulkCommandAcceptanceAuthority;
  readonly protectedCommandAcceptedAt: (commandId: string) => string | undefined;
  readonly startPlans: StartPlanService;
  readonly intake: IntakeService;
  readonly hub: DashboardStreamHub;
  readonly storage: StorageQueryDeps;
  /** D274 item 6 / ledger 3 SE40–SE42 — the two READ-ONLY Settings status sections. */
  readonly settings: SettingsQueryDeps;
  /** DCC3's closed, resolver-owned editable Settings inventory and current readback. */
  readonly settingsEditor: SettingsEditorQueryDeps;
  /** Ref operator-trust §5.2's read-only explorer projection (2i-G, D176). */
  readonly explorer: ExplorerQueryDeps;
  /** D186/D283 safe-edit authority; production always composes it. */
  readonly explorerEdits?: Pick<ExplorerEditService, "validate">;
  /** The committed semantic UI catalog, served read-only (2i-G, D177). */
  readonly uiCatalog: UiCatalogQueryDeps;
  /**
   * Ref operator-trust §4.4's advisory seam (2i-G, D178). Absent when no `ai.advisory`
   * adapter is composed — the route then refuses by NAME rather than the
   * composition root wiring a producer that answers nothing.
   */
  readonly advisory?: AdvisoryQueryDeps;
  /**
   * The built dashboard bundle, present only in `built-bundle` mode (ref
   * frontend-backend-integration §6.9): its handler is registered last so every route
   * above wins, and it serves `dist/dashboard` from this same loopback process.
   */
  readonly staticBundle?: StaticBundle;
}

export type DashboardApp = Hono<{
  Variables: { requestActorId: ReturnType<RequestIdentityCheckpoint["identify"]> };
}>;

const DayQuerySchema = z.iso.date();
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

  // Ref dashboard-surfaces §2.5's read-only doctor, on demand from the Settings surface.
  app.get("/api/v1/storage/doctor", async (c) => c.json(await buildStorageDoctor(deps.storage)));

  /**
   * D274 item 6 — System hosts + Workflow capabilities, read-only.
   *
   * GET-only by construction, and that remains the ruling: DCC3's separate
   * resolver-owned Settings editor does not make host/capability facts mutable.
   * Item 6's rejected option C was coupling these reads to the write family.
   */
  app.get("/api/v1/settings/facts", (c) => c.json(buildSettingsFacts(deps.settings)));

  // DCC3: values, provenance and editability are server-owned; this route has no mutation arm.
  app.get("/api/v1/settings/editable", (c) => c.json(buildSettingsEditor(deps.settingsEditor)));

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
  /* ── archive + activity (D179/D180, ref frontend-backend-integration §3.6) ───────────────────────── */
  app.get("/api/v1/archive", (c) => c.json(buildArchiveIndex(deps.archive)));
  app.get("/api/v1/archive/:runId/captures/:artifactId/resource", async (c) => {
    c.header("cache-control", "no-store");
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError("archived capture bytes are not available: no artifact store is composed");
    }
    return c.json(await buildArchivedCaptureResource(
      { authority: deps.archive.authority, artifactReader: deps.diagnosticBundles.artifactReader },
      c.req.param("runId"),
      c.req.param("artifactId"),
      c.req.raw.signal,
    ));
  });
  app.get("/api/v1/archive/:runId", (c) =>
    c.json(buildArchivedRunDetail(deps.archive, c.req.param("runId"))));

  app.get("/artifacts/v1/archive/:runId/:artifactId", async (c) => {
    c.header("cache-control", "no-store");
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError("archived capture bytes are not available: no artifact store is composed");
    }
    const artifact = await prepareArchivedCaptureLease(
      { authority: deps.archive.authority, artifactReader: deps.diagnosticBundles.artifactReader },
      c.req.param("runId"),
      c.req.param("artifactId"),
      c.req.raw.signal,
    );
    return verifiedByteResponse({
      lease: artifact.lease,
      method: c.req.method,
      range: c.req.header("range"),
      profile: "archive",
    });
  });
  app.get("/api/v1/reports/activity", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (from === undefined || to === undefined) {
      // A missing range is NOT "today" or "this month": an aggregate over a
      // window the caller never named is a number nobody asked for.
      throw new Error("an activity report requires both from= and to= as YYYY-MM-DD");
    }
    return c.json(deps.projection.buildActivityReportWire(from, to));
  });

  /**
   * The same report as a file (D240). It refuses a missing bound in the SAME
   * words as the JSON route above — an export is the one copy that gets mailed
   * on, so a window it defaulted silently would travel further than a page that
   * did. The artifact carries its own caveats; see `activity-export.ts`.
   */
  app.get("/api/v1/reports/activity.csv", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (from === undefined || to === undefined) {
      throw new Error("an activity report requires both from= and to= as YYYY-MM-DD");
    }
    const report = deps.projection.buildActivityReportWire(from, to);
    return new Response(activityReportCsv(report), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${activityReportCsvFileName(report)}"`,
        "cache-control": "no-store",
      },
    });
  });
  app.get("/api/v1/ui-catalog", (c) => c.json(buildUiCatalogWire(deps.uiCatalog)));

  app.get("/api/v1/dashboard", (c) => {
    const day = DayQuerySchema.parse(c.req.query("day"));
    return c.json(deps.projection.buildDashboardDayWire(day));
  });

  app.get("/api/v1/runs/:runId", async (c) =>
    c.json(await readRunDetail(deps.runDetail, c.req.param("runId"), c.req.raw.signal)));

  // Failure responses are private evidence too. Install after the capture Host
  // gate so a phone request still receives the byte-identical unrouted refusal.
  app.use("/api/v1/diagnostic-bundles/*", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
    c.header("x-content-type-options", "nosniff");
  });

  app.get("/api/v1/diagnostic-bundles/:bundleId", async (c) => {
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError("diagnostic bundle readback is not available: no diagnostic bundle authority is composed");
    }
    const bundle = await readDiagnosticBundle(
      deps.diagnosticBundles,
      c.req.param("bundleId"),
      undefined,
      c.req.raw.signal,
    );
    return c.json(bundle.wire);
  });

  app.get("/api/v1/diagnostic-bundles/:bundleId/manifest", async (c) => {
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError("diagnostic bundle readback is not available: no diagnostic bundle authority is composed");
    }
    const bundle = await readDiagnosticBundle(
      deps.diagnosticBundles,
      c.req.param("bundleId"),
      undefined,
      c.req.raw.signal,
    );
    return new Response(bundle.manifest, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${bundle.wire.bundleId}.json"`,
        "cache-control": "no-store",
      },
    });
  });

  /** A screenshot resource stays bound to the exact inspected bundle, not only its global artifact id. */
  app.get("/api/v1/diagnostic-bundles/:bundleId/attachments/:artifactId", async (c) => {
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError(
        "diagnostic attachment readback is not available: no diagnostic attachment authority is composed",
      );
    }
    const attachment = await readDiagnosticBundleAttachment(
      deps.diagnosticBundles,
      c.req.param("bundleId"),
      c.req.param("artifactId"),
      c.req.raw.signal,
    );
    return verifiedByteResponse({
      lease: attachment.lease,
      method: c.req.method,
      range: c.req.header("range"),
      profile: "bundle",
    });
  });

  app.get("/artifacts/v1/:artifactId", async (c) => {
    if (deps.diagnosticBundles === undefined) {
      throw new SectionUnavailableError(
        "diagnostic artifact readback is not available: no diagnostic attachment authority is composed",
      );
    }
    let artifact: Awaited<ReturnType<typeof prepareDiagnosticArtifactLease>>;
    try {
      artifact = await prepareDiagnosticArtifactLease(
        {
          authority: deps.diagnosticBundles.authority,
          artifactReader: deps.diagnosticBundles.artifactReader,
        },
        c.req.param("artifactId"),
        c.req.raw.signal,
      );
    } catch (error: unknown) {
      if (error instanceof IndexedArtifactBytesMissingError) {
        throw new DiagnosticBundleBytesMissingError(error.message, { cause: error });
      }
      throw error;
    }
    return verifiedByteResponse({
      lease: artifact.lease,
      method: c.req.method,
      range: c.req.header("range"),
      profile: "generic",
    });
  });

  app.get("/api/v1/runs/:runId/:section", async (c) => {
    const cursor = c.req.query("cursor");
    return c.json(await readRunSection(
      deps.runDetail,
      c.req.param("runId"),
      c.req.param("section"),
      cursor,
      c.req.raw.signal,
    ));
  });

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
