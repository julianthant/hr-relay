/**
 * Typed query surface: every response parses through its owning wire schema
 * before a caller sees it. A response outside the contract is a schema error
 * with the route named — never a cast.
 */
import { z } from "zod";
import { FrontendBootstrapWireSchema, type FrontendBootstrapWire } from "../../domain/dashboard/bootstrap.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../domain/dashboard/projection.js";
import {
  RunDetailSectionResponseSchema,
  RunDetailWireSchema,
  type RunDetailSectionResponse,
  type RunDetailWire,
} from "../../domain/dashboard/run-detail.js";
import { StorageDoctorWireSchema, type StorageDoctorWire } from "../../domain/dashboard/storage.js";
import { SettingsFactsWireSchema, type SettingsFactsWire } from "../../domain/dashboard/settings.js";
import {
  DiagnosticBundleWireSchema,
  type DiagnosticBundleWire,
} from "../../domain/dashboard/diagnostic-bundle.js";
import { DiagnosticBundleIdSchema } from "../../domain/ids.js";
import { RunAdvisoryWireSchema, type RunAdvisoryWire } from "../../domain/dashboard/advisory.js";
import {
  ArchiveIndexWireSchema,
  ArchivedRunDetailWireSchema,
  type ArchiveIndexWire,
  type ArchivedRunDetailWire,
} from "../../domain/dashboard/archive.js";
import { ActivityReportWireSchema, type ActivityReportWire } from "../../domain/dashboard/activity.js";
import {
  UiCatalogWireSchema,
  WorkflowExplorerWireSchema,
  type UiCatalogWire,
  type WorkflowExplorerWire,
} from "../../domain/dashboard/explorer.js";
import { CaptureStartResultSchema, type CaptureStartResult } from "../../domain/capture-surface.js";
import {
  CaptureOperatorSessionListWireSchema,
  CaptureOperatorSessionWireSchema,
  type CaptureOperatorSessionListWire,
  type CaptureOperatorSessionWire,
} from "../../domain/capture-operator.js";
import { IntakeSessionWireSchema, type IntakeSessionWire } from "../../domain/intake/wire.js";
import {
  WIRE_ERROR_BODY,
  diagnosticBundleIdentityError,
  httpError,
  schemaError,
} from "./errors.js";
import type { DashboardTransport } from "./transport.js";

function parseOrThrow<Schema extends z.ZodType>(schema: Schema, context: string, body: unknown): z.output<Schema> {
  try {
    return schema.parse(body);
  } catch (error) {
    throw schemaError(context, error);
  }
}

/**
 * What an intake upload did — the one place the response STATUS is the answer.
 *
 * `POST /api/v1/intake/files` returns the same session wire whether it minted a
 * session (`201`) or joined the open one those exact bytes already have
 * (`200`), and the difference is the whole message to the operator: "we read
 * your file" against "you already had this file open, with your mapping still
 * on it". A refusal (`422`) carries the parser's own code and words, which are
 * rendered verbatim rather than translated.
 *
 * Any other status is a fault, not an outcome: it throws through `httpError`
 * like every other route, because a surface that quietly treated an unexpected
 * status as "refused" would report a server bug as an operator problem.
 */
export type IntakeUploadResult =
  | Readonly<{ state: "created" | "joined"; session: IntakeSessionWire }>
  | Readonly<{ state: "refused"; code: string; message: string }>;

export interface IntakeUploadRequest {
  readonly workflowId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: ArrayBuffer;
}

export interface DashboardQueries {
  bootstrap(): Promise<FrontendBootstrapWire>;
  dashboardDay(day: string): Promise<DashboardDayWire>;
  runDetail(runId: string): Promise<RunDetailWire>;
  runSection(runId: string, section: string, cursor?: string): Promise<RunDetailSectionResponse>;
  /** One D137 bundle, read by its exact durable id only after the operator asks. */
  diagnosticBundle(bundleId: string): Promise<DiagnosticBundleWire>;
  /** The browser downloads the server's canonical durable manifest; no UI reconstruction. */
  diagnosticBundleManifestUrl(bundleId: string): string;
  /** Ref dashboard-surfaces §2.5's read-only doctor, run on demand from Settings (2i-D). */
  storageDoctor(): Promise<StorageDoctorWire>;
  /**
   * D274 item 6 — Settings' System hosts + Workflow capabilities, read-only.
   *
   * There is deliberately no mutating counterpart on this interface, for the
   * same reason `workflowExplorer` has none: the settings WRITE family is
   * deferred (doc 04), so the surface cannot offer what the wire will not take.
   */
  settingsFacts(): Promise<SettingsFactsWire>;
  /** Ref data-intake-and-edit-data §2.2 step 1 — the bytes go up, a durable session comes back (2i-E3). */
  uploadIntakeFile(request: IntakeUploadRequest): Promise<IntakeUploadResult>;
  /** The durable session joined with its re-derived parse view and hints. */
  intakeSession(intakeSessionId: string): Promise<IntakeSessionWire>;
  /**
   * Ref data-intake-and-edit-data §5.1 — mint a phone capture session (2i-F, D175).
   *
   * `201` carries the ONE raw token that ever exists outside the phone; `409`
   * carries a NAMED ingress refusal with its remediation. Both are outcomes the
   * operator acts on, so both parse into `CaptureStartResult` rather than one
   * of them throwing — and every other status still throws, because a server
   * fault must never render as "capture is misconfigured".
   */
  startCaptureSession(request: CaptureStartRequest): Promise<CaptureStartResult>;
  /**
   * D274 item 7 (ledger 3 CP2) — the ACTIVE capture sessions, as the operator's
   * picker reads them.
   *
   * `open`/`finalizing`/`failed` only, oldest first: the server drops a session
   * whose window has closed, durably, as it reads the set. So a session leaving
   * this list is a real transition and never a filter the client applied — which
   * is why the panel keeps reading a departed session by id rather than
   * inferring anything from its absence here.
   */
  activeCaptureSessions(): Promise<CaptureOperatorSessionListWire>;
  /**
   * D274 item 7 (ledger 3 CP6–CP16, CP21) — ONE capture session, as the DESKTOP
   * is served it: the phase, the expiry, and every page that has landed with the
   * bundler's own verdict on its recorded bytes.
   *
   * Works for any state, not only an active one. That is deliberate: a capture
   * that finalized while the operator was watching leaves the active list, and a
   * panel that lost it at that exact moment would blank the one screen that says
   * the capture worked.
   */
  captureSession(sessionId: string): Promise<CaptureOperatorSessionWire>;
  /**
   * Ref operator-trust §5.2's read-only explorer projection (2i-G, D176).
   *
   * There is deliberately no mutating counterpart on this interface: Phase A
   * has no draft, no validate and no apply, so the surface cannot offer one.
   */
  workflowExplorer(): Promise<WorkflowExplorerWire>;
  /** The committed `generated/ui-catalog.json`, served read-only (2i-G, D177). */
  uiCatalog(): Promise<UiCatalogWire>;
  /**
   * Ref operator-trust §4.4's on-demand failure advisory (2i-G, D178).
   *
   * It is a METHOD an operator action calls, never a section the panel
   * prefetches: it spends a provider budget, so nothing may invoke it as a
   * side effect of opening a run. The three §4.4 outcomes all arrive as a
   * `200` document — `unavailable` and `invalid-response` are answers, not
   * transport faults — so only a real fault throws.
   */
  requestFailureAdvisory(runId: string): Promise<RunAdvisoryWire>;
  /**
   * The read-only Archive index plus the LIVE version-bump state (2i-G, D179).
   *
   * The version state is re-derived per request rather than read off a stored
   * plan: a plan is a review copy and it goes stale the moment a run is
   * enqueued, so a surface that showed the plan's copy would invite an apply
   * whose blocker list the operator had already been shown as empty.
   */
  archiveIndex(): Promise<ArchiveIndexWire>;
  /** ONE archived run, whole. Nothing on this path resolves a descriptor. */
  archivedRun(runId: string): Promise<ArchivedRunDetailWire>;
  /**
   * The Activity report over an explicit range (2i-G, D180). Both bounds are
   * required — an aggregate over a window the caller never named is a number
   * nobody asked for.
   */
  activityReport(from: string, to: string): Promise<ActivityReportWire>;
  /**
   * Where the same report's CSV lives (D240). A URL rather than a promise of
   * bytes: the browser downloads it from a link, so nothing here holds the
   * artifact in memory, and the export refuses a missing bound exactly as the
   * report route does — which is why both bounds are required here too.
   */
  activityExportUrl(from: string, to: string): string;
}

export interface CaptureStartRequest {
  readonly workflowId: string;
  readonly formType?: string;
  readonly contextHint?: string;
}

export function createDashboardQueries(transport: DashboardTransport): DashboardQueries {
  return Object.freeze({
    async bootstrap(): Promise<FrontendBootstrapWire> {
      return parseOrThrow(FrontendBootstrapWireSchema, "GET /api/v1/bootstrap", await transport.requestJson("/api/v1/bootstrap"));
    },
    async dashboardDay(day: string): Promise<DashboardDayWire> {
      const parsedDay = z.iso.date().parse(day);
      return parseOrThrow(
        DashboardDayWireSchema,
        "GET /api/v1/dashboard",
        await transport.requestJson(`/api/v1/dashboard?day=${parsedDay}`),
      );
    },
    async runDetail(runId: string): Promise<RunDetailWire> {
      return parseOrThrow(
        RunDetailWireSchema,
        `GET /api/v1/runs/${runId}`,
        await transport.requestJson(`/api/v1/runs/${encodeURIComponent(runId)}`),
      );
    },
    async runSection(runId: string, section: string, cursor?: string): Promise<RunDetailSectionResponse> {
      const query = cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`;
      return parseOrThrow(
        RunDetailSectionResponseSchema,
        `GET /api/v1/runs/${runId}/${section}`,
        await transport.requestJson(`/api/v1/runs/${encodeURIComponent(runId)}/${encodeURIComponent(section)}${query}`),
      );
    },
    async diagnosticBundle(bundleId: string): Promise<DiagnosticBundleWire> {
      const parsedBundleId = DiagnosticBundleIdSchema.parse(bundleId);
      const path = `/api/v1/diagnostic-bundles/${encodeURIComponent(parsedBundleId)}`;
      const bundle = parseOrThrow(
        DiagnosticBundleWireSchema,
        `GET ${path}`,
        await transport.requestJson(path),
      );
      if (bundle.bundleId !== parsedBundleId) {
        throw diagnosticBundleIdentityError(`GET ${path}`, parsedBundleId);
      }
      return bundle;
    },
    diagnosticBundleManifestUrl(bundleId: string): string {
      const parsedBundleId = DiagnosticBundleIdSchema.parse(bundleId);
      return transport.resolveUrl(
        `/api/v1/diagnostic-bundles/${encodeURIComponent(parsedBundleId)}/manifest`,
      );
    },
    async storageDoctor(): Promise<StorageDoctorWire> {
      return parseOrThrow(
        StorageDoctorWireSchema,
        "GET /api/v1/storage/doctor",
        await transport.requestJson("/api/v1/storage/doctor"),
      );
    },
    async settingsFacts(): Promise<SettingsFactsWire> {
      return parseOrThrow(
        SettingsFactsWireSchema,
        "GET /api/v1/settings/facts",
        await transport.requestJson("/api/v1/settings/facts"),
      );
    },
    async uploadIntakeFile(request: IntakeUploadRequest): Promise<IntakeUploadResult> {
      const path = `/api/v1/intake/files?workflow=${encodeURIComponent(request.workflowId)}`
        + `&filename=${encodeURIComponent(request.fileName)}`;
      const response = await transport.requestJsonResponse(path, {
        method: "POST",
        body: request.bytes,
        // The route reads the media type off this header and the size cap off
        // the body, so both travel as themselves rather than as JSON fields.
        headers: { "content-type": request.mediaType },
      });
      if (response.status === 422) {
        const refusal = WIRE_ERROR_BODY.safeParse(response.body);
        if (!refusal.success) throw schemaError(`POST ${path}`, refusal.error);
        return Object.freeze({ state: "refused" as const, code: refusal.data.code, message: refusal.data.message });
      }
      // Anything outside {201, 200, 422} is a fault. Falling through to
      // "refused" would report a server defect as the operator's bad file.
      if (response.status !== 201 && response.status !== 200) {
        throw httpError(response.status, response.body);
      }
      return Object.freeze({
        state: response.status === 201 ? ("created" as const) : ("joined" as const),
        session: parseOrThrow(IntakeSessionWireSchema, `POST ${path}`, response.body),
      });
    },
    async intakeSession(intakeSessionId: string): Promise<IntakeSessionWire> {
      const path = `/api/v1/intake/${encodeURIComponent(intakeSessionId)}`;
      return parseOrThrow(IntakeSessionWireSchema, `GET ${path}`, await transport.requestJson(path));
    },

    async startCaptureSession(request: CaptureStartRequest): Promise<CaptureStartResult> {
      const path = "/api/v1/capture/sessions";
      const response = await transport.requestJsonResponse(path, {
        method: "POST",
        body: JSON.stringify({
          workflow: request.workflowId,
          ...(request.formType === undefined ? {} : { formType: request.formType }),
          ...(request.contextHint === undefined ? {} : { contextHint: request.contextHint }),
        }),
      });
      // 201 = started (with the token), 409 = a named ingress refusal. Both are
      // the contract; anything else is a fault and leaves as one.
      if (response.status !== 201 && response.status !== 409) {
        throw httpError(response.status, response.body);
      }
      return parseOrThrow(CaptureStartResultSchema, `POST ${path}`, response.body);
    },

    async activeCaptureSessions(): Promise<CaptureOperatorSessionListWire> {
      const path = "/api/v1/capture/sessions";
      return parseOrThrow(CaptureOperatorSessionListWireSchema, `GET ${path}`, await transport.requestJson(path));
    },
    async captureSession(sessionId: string): Promise<CaptureOperatorSessionWire> {
      const path = `/api/v1/capture/sessions/${encodeURIComponent(sessionId)}`;
      return parseOrThrow(CaptureOperatorSessionWireSchema, `GET ${path}`, await transport.requestJson(path));
    },

    async archiveIndex(): Promise<ArchiveIndexWire> {
      return parseOrThrow(
        ArchiveIndexWireSchema,
        "GET /api/v1/archive",
        await transport.requestJson("/api/v1/archive"),
      );
    },
    async archivedRun(runId: string): Promise<ArchivedRunDetailWire> {
      const path = `/api/v1/archive/${encodeURIComponent(runId)}`;
      return parseOrThrow(ArchivedRunDetailWireSchema, `GET ${path}`, await transport.requestJson(path));
    },
    async activityReport(from: string, to: string): Promise<ActivityReportWire> {
      const path = `/api/v1/reports/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      return parseOrThrow(ActivityReportWireSchema, `GET ${path}`, await transport.requestJson(path));
    },
    activityExportUrl(from: string, to: string): string {
      return transport.resolveUrl(
        `/api/v1/reports/activity.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
    },
    async workflowExplorer(): Promise<WorkflowExplorerWire> {
      return parseOrThrow(
        WorkflowExplorerWireSchema,
        "GET /api/v1/explorer",
        await transport.requestJson("/api/v1/explorer"),
      );
    },
    async requestFailureAdvisory(runId: string): Promise<RunAdvisoryWire> {
      const path = `/api/v1/runs/${encodeURIComponent(runId)}/advisory`;
      return parseOrThrow(
        RunAdvisoryWireSchema,
        `POST ${path}`,
        await transport.requestJson(path, { method: "POST" }),
      );
    },
    async uiCatalog(): Promise<UiCatalogWire> {
      return parseOrThrow(
        UiCatalogWireSchema,
        "GET /api/v1/ui-catalog",
        await transport.requestJson("/api/v1/ui-catalog"),
      );
    },
  });
}
