import { DeleteProfileAccountRequestSchema, type DeleteProfileAccountRequest, CancelProfileOnboardingDuoRequestSchema, type CancelProfileOnboardingDuoRequest, CompleteProfileOnboardingRequestSchema, CancelProfileOnboardingRequestSchema, StartProfileOnboardingDuoRequestSchema, ConfirmProfileOnboardingDuoRequestSchema, type CompleteProfileOnboardingRequest, type CancelProfileOnboardingRequest, type StartProfileOnboardingDuoRequest, type ConfirmProfileOnboardingDuoRequest, ProfileLoginRequestSchema, ProfileSignUpRequestSchema, PublicProfileStateSchema, type ProfileLoginRequest, type ProfileSignUpRequest, type PublicProfileState } from "../../models/profiles/public-profile.js";
import { debugFailureOutcome, DashboardErrorReportSchema, type DashboardErrorReport } from "../../models/events/debug-report.js";
import { invalidatePreflightReadiness } from "./queries/preflight-state.js";
/** The ONE typed dashboard client (ref frontend-backend-integration) */
import { createDashboardCommands, type DashboardCommands } from "./commands.js";
import { createDashboardQueries, type DashboardQueries } from "./queries.js";
import {
  subscribeDashboardDay,
  type DashboardDaySubscription,
  type DashboardDaySubscriptionDeps,
} from "./subscriptions/subscription.js";
import { WIRE_ERROR_BODY, DashboardClientError, DashboardReportDeliveryError, dashboardErrorReported } from "./errors.js";
import { createDashboardTransport, type FetchLike } from "./transport.js";
import { OcrSourceUploadSchema } from "../../models/ocr/review.js";
import { RunIdSchema, PositiveIntSchema } from "../../rules/identity/ids.js";
import { OcrCommandResultWireSchema } from "../../models/dashboard/run-detail.js";
import { ERROR_CATALOG } from "../../models/failures/error-catalog.js";

export type { ApplicationLifecycle } from "../../models/dashboard/application-lifecycle.js";
export { DashboardClientError };
export { applyDashboardDayPatch } from "./queries/day-state.js";
export type { SubscriptionState } from "./subscriptions/subscription.js";
export type { StartPlanResponse } from "./commands.js";
export type { OperatorXlsxClientDownload } from "./commands.js";
export type { OperatorXlsxExportRequest } from "../../models/dashboard/xlsx-export.js";
export type { IntakeUploadRequest, IntakeUploadResult } from "./queries.js";
export type {
  CrossDateSearchPage,
  CrossDateSearchQuery,
  CrossDateSearchQueryInput,
} from "../../models/dashboard/search.js";

export interface DashboardClient extends DashboardQueries, DashboardCommands {
  uploadOcrSource(request: Readonly<{ fileName: string; bytes: Uint8Array }>, signal?: AbortSignal): Promise<ReturnType<typeof OcrSourceUploadSchema.parse>>;
  ocrSourcePageUrl(runId: string, revision: number, sourcePage: number): string;
  ocrCommandResult(runId: string, commandId: string, signal?: AbortSignal): Promise<ReturnType<typeof OcrCommandResultWireSchema.parse>>;
  readProfileSession(): Promise<PublicProfileState>;
  signInProfile(request: ProfileLoginRequest): Promise<PublicProfileState>;
  resumeProfile(): Promise<PublicProfileState>;
  signUpProfile(request: ProfileSignUpRequest): Promise<PublicProfileState>;
  logOutProfile(): Promise<PublicProfileState>;
  deleteProfileAccount(request: DeleteProfileAccountRequest): Promise<PublicProfileState>;
  completeProfileOnboarding(request: CompleteProfileOnboardingRequest): Promise<PublicProfileState>;
  cancelProfileOnboardingDuo(request: CancelProfileOnboardingDuoRequest): Promise<PublicProfileState>;
  cancelProfileOnboarding(request: CancelProfileOnboardingRequest): Promise<PublicProfileState>;
  showProfileOnboardingBrowser(request: CompleteProfileOnboardingRequest): Promise<PublicProfileState>;
  openProfileOnboardingPortal(request: CompleteProfileOnboardingRequest): Promise<PublicProfileState>;
  startProfileOnboardingDuo(request: StartProfileOnboardingDuoRequest): Promise<PublicProfileState>;
  confirmProfileOnboardingDuo(request: ConfirmProfileOnboardingDuoRequest): Promise<PublicProfileState>;
  reportError(report: DashboardErrorReport): Promise<void>;
  subscribeDay(
    input: Omit<DashboardDaySubscriptionDeps, "transport">,
  ): DashboardDaySubscription;
}

export function createDashboardClient(input: Readonly<{
  baseUrl: string;
  fetchImpl?: FetchLike;
  surface?: () => string;
}>): DashboardClient {
  const surface = input.surface;
  const clientId = crypto.randomUUID();
  const reportFailure = (failure: NonNullable<ReturnType<typeof debugFailureOutcome>> & { route: string }): void => {
    if (surface === undefined) return;
    void client.reportError({ reportId: crypto.randomUUID(), clientId, release: "dashboard",
      route: failure.route, surface: surface(), code: failure.code, reason: failure.reason,
      message: "Dashboard request did not complete successfully" })
      .catch(() => { window.reportError(new DashboardReportDeliveryError()); });
  };
  const transport = createDashboardTransport({ ...input, ...(surface === undefined ? {} : { onFailure: reportFailure }) });
  const queries = createDashboardQueries(transport);
  const commands = createDashboardCommands(transport);
  const client: DashboardClient = {
    async ocrCommandResult(runId, commandId, signal) {
      const result = OcrCommandResultWireSchema.parse(await transport.requestJson(`/api/v1/runs/${encodeURIComponent(RunIdSchema.parse(runId))}/ocr/commands/${encodeURIComponent(commandId)}`,
        signal === undefined ? undefined : { signal }));
      if (result.state === "recorded" && (result.request.commandId !== commandId || result.request.target.runId !== runId)) throw new DashboardClientError({ kind: "schema", code: "OCR_REVIEW_REFUSED", message: ERROR_CATALOG.OCR_REVIEW_REFUSED.text });
      return result;
    },
    async uploadOcrSource(request, signal) {
      const source = OcrSourceUploadSchema.parse(await transport.requestJson("/api/v1/ocr/files", {
        method: "POST", headers: { "content-type": "application/pdf", "x-relay-file-name": encodeURIComponent(request.fileName) }, body: new Uint8Array(request.bytes).buffer,
        ...(signal === undefined ? {} : { signal }),
      }));
      const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(request.bytes).buffer);
      const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
      if (source.artifact.bytes !== request.bytes.byteLength || source.artifact.sha256 !== digest) throw new DashboardClientError({ kind: "schema", code: "OCR_SOURCE_REFUSED", message: ERROR_CATALOG.OCR_SOURCE_REFUSED.text });
      return source;
    },
    ocrSourcePageUrl(runId, revision, sourcePage) {
      return transport.resolveUrl(`/api/v1/runs/${encodeURIComponent(RunIdSchema.parse(runId))}/ocr/pages/${PositiveIntSchema.parse(sourcePage)}?revision=${PositiveIntSchema.parse(revision)}`);
    },
    async readProfileSession() {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/state")).body);
    },
    async signInProfile(request: ProfileLoginRequest) {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/sign-in", {
        method: "POST", body: JSON.stringify(ProfileLoginRequestSchema.parse(request)),
      })).body);
    },
    async resumeProfile() {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/resume", { method: "POST", body: "{}" })).body);
    },
    async signUpProfile(request: ProfileSignUpRequest) {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/sign-up", {
        method: "POST", body: JSON.stringify(ProfileSignUpRequestSchema.parse(request)),
      })).body);
    },
    async deleteProfileAccount(request) {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/delete-account", {
        method: "POST", body: JSON.stringify(DeleteProfileAccountRequestSchema.parse(request)),
      })).body);
    },
    async logOutProfile() {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/logout", { method: "POST", body: "{}" })).body);
    },
    async completeProfileOnboarding(request) {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/onboarding/complete", {
        method: "POST", body: JSON.stringify(CompleteProfileOnboardingRequestSchema.parse(request)),
      })).body);
    },
    async cancelProfileOnboardingDuo(request) {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/onboarding/duo/cancel", {
        method: "POST", body: JSON.stringify(CancelProfileOnboardingDuoRequestSchema.parse(request)),
      })).body);
    },
    async cancelProfileOnboarding(request) {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/onboarding/cancel", {
        method: "POST", body: JSON.stringify(CancelProfileOnboardingRequestSchema.parse(request)),
      })).body);
    },
    async showProfileOnboardingBrowser(request) {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/onboarding/duo/browser", {
        method: "POST", body: JSON.stringify(CompleteProfileOnboardingRequestSchema.parse(request)),
      })).body);
    },
    async openProfileOnboardingPortal(request) {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/onboarding/duo/portal", {
        method: "POST", body: JSON.stringify(CompleteProfileOnboardingRequestSchema.parse(request)),
      })).body);
    },
    async startProfileOnboardingDuo(request) {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/onboarding/duo/start", {
        method: "POST", body: JSON.stringify(StartProfileOnboardingDuoRequestSchema.parse(request)),
      })).body);
    },
    async confirmProfileOnboardingDuo(request) {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/onboarding/duo/confirm", {
        method: "POST", body: JSON.stringify(ConfirmProfileOnboardingDuoRequestSchema.parse(request)),
      })).body);
    },
    async reportError(report: DashboardErrorReport) {
      await transport.requestJson("/api/v1/debug/errors", { method: "POST", body: JSON.stringify(DashboardErrorReportSchema.parse(report)) });
    },
    ...queries,
    ...commands,
    async applySettings(request: unknown) {
      try { return await commands.applySettings(request); }
      finally { invalidatePreflightReadiness(client); }
    },
    async executeCommand(request: unknown) {
      try { return await commands.executeCommand(request); }
      finally { invalidatePreflightReadiness(client); }
    },
    subscribeDay: (subscriptionInput: Omit<DashboardDaySubscriptionDeps, "transport">): DashboardDaySubscription =>
      subscribeDashboardDay({ ...subscriptionInput, transport }),
  };
  if (surface !== undefined) {
    const reportSchemaFailure = (error: unknown, method: keyof DashboardClient): never => {
      if (dashboardErrorReported(error)) throw error;
      if (!(error instanceof DashboardClientError) || error.kind === "schema" || error.kind === "protocol") {
        const failure = debugFailureOutcome({ state: "error", code: error instanceof DashboardClientError ? error.code : undefined });
        if (failure !== undefined) reportFailure({ ...failure, route: `client:${method}` });
      }
      throw error;
    };
    for (const key of Object.keys(client) as (keyof DashboardClient)[]) {
      if (key === "reportError") continue;
      const method = client[key]?.bind(client);
      if (method === undefined) continue;
      Object.defineProperty(client, key, { value: (...args: unknown[]): unknown => {
        try {
          const result: unknown = Reflect.apply(method, client, args);
          return result instanceof Promise ? result.catch(error => reportSchemaFailure(error, key)) : result;
        } catch (error) { return reportSchemaFailure(error, key); }
      } });
    }
  }
  return Object.freeze(client);
}

export type { NotificationQueries } from "./queries/notification-queries.js";

export type { RerunQueries } from "./queries/rerun-queries.js";

export { StartPlanRefusalError } from "./commands/start-commands.js";

export type { WorkbookLibraryQueries } from "./queries/workbook-library-queries.js";

export type { AssistantQueries } from "./queries/assistant-queries.js";
export type { AssistantModelPreferenceView, AssistantRequest, AssistantResult, AssistantSubject } from "../../models/dashboard/assistant.js";

function parseProfileState(body: unknown): PublicProfileState {
  const wire = WIRE_ERROR_BODY.safeParse(body);
  return PublicProfileStateSchema.parse(wire.success ? { state: "refused", code: wire.data.code } : body);
}
