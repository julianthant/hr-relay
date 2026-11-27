import { z } from "zod";
import { ReopenProfileOnboardingBrowserRequestSchema, type ReopenProfileOnboardingBrowserRequest, DeleteProfileAccountRequestSchema, type DeleteProfileAccountRequest, CancelProfileOnboardingDuoRequestSchema, type CancelProfileOnboardingDuoRequest, CompleteProfileOnboardingRequestSchema, CancelProfileOnboardingRequestSchema, StartProfileOnboardingDuoRequestSchema, ConfirmProfileOnboardingDuoRequestSchema, type CompleteProfileOnboardingRequest, type CancelProfileOnboardingRequest, type StartProfileOnboardingDuoRequest, type ConfirmProfileOnboardingDuoRequest, ProfileLoginRequestSchema, ProfileSignUpRequestSchema, ProfilePasswordChangeRequestSchema, ProfileUsernameChangeRequestSchema, ProfileLoginChangeResultSchema, ProfileDetailsChangeRequestSchema, ProfileDetailsChangeResultSchema, DuoReenrolStateSchema, PROFILE_ONBOARDING_STATE, PublicProfileStateSchema, type DuoReenrolState, type ProfileLoginRequest, type ProfileSignUpRequest, type PublicProfileState } from "../../models/profiles/public-profile.js";
type ProfilePasswordChangeRequest = z.infer<typeof ProfilePasswordChangeRequestSchema>;
type ProfileUsernameChangeRequest = z.infer<typeof ProfileUsernameChangeRequestSchema>;
type ProfileLoginChangeResult = z.infer<typeof ProfileLoginChangeResultSchema>;
type ProfileDetailsChangeRequest = z.infer<typeof ProfileDetailsChangeRequestSchema>;
type ProfileDetailsChangeResult = z.infer<typeof ProfileDetailsChangeResultSchema>;
import { DASHBOARD_REQUEST_REPORT_MESSAGE, debugFailureOutcome, DashboardErrorReportSchema, type DashboardErrorReport } from "../../models/events/debug-report.js";
import { parseOrThrow } from "./queries/query-parse.js";
import { invalidatePreflightReadiness } from "./queries/preflight-state.js";
/** The ONE typed dashboard client (ref frontend-backend-integration) */
import { createDashboardCommands, type DashboardCommands } from "./commands.js";
import { createDashboardQueries, type DashboardQueries } from "./queries.js";
import {
  subscribeDashboardDay,
  type DashboardDaySubscription,
  type DashboardDaySubscriptionDeps,
} from "./subscriptions/subscription.js";
import { WIRE_ERROR_BODY, DashboardClientError, DashboardReportDeliveryError, dashboardErrorReported, schemaError } from "./errors.js";
import { createDashboardTransport, type FetchLike } from "./transport.js";
import { OcrSourceUploadSchema } from "../../models/ocr/review.js";
import { RunIdSchema, PositiveIntSchema } from "../../rules/identity/ids.js";
import { OcrCommandResultWireSchema } from "../../models/dashboard/run-detail.js";
import { WorkerCommandResultWireSchema, type WorkerCommandResultWire } from "../../models/dashboard/worker-command-result.js";
import { ERROR_CATALOG, ErrorCatalogCodeSchema } from "../../models/failures/error-catalog.js";
import { ProfileDuoKeyChangeRequestSchema, ProfileDuoKeyChangeResponseSchema, ProfileDuoKeysReadSchema, ProfileDuoKeysScopeSchema,
  type DuoKeyChangeResult, type DuoKeysSnapshot } from "../../models/profiles/public-profile.js";

type DuoKeysScope = z.infer<typeof ProfileDuoKeysScopeSchema>;
type DuoKeyChangeRequest = z.infer<typeof ProfileDuoKeyChangeRequestSchema>;
const DUO_KEYS_PATH = "/api/v1/profile/account/duo-keys";

export type { ApplicationLifecycle } from "../../models/dashboard/application-lifecycle.js";
export { DashboardClientError };
export { applyDashboardDayPatch } from "./queries/day-state.js";
export type { SubscriptionState } from "./subscriptions/subscription.js";
export { createRowStore, type RowStore, type RowStoreWriter } from "./subscriptions/row-store.js";
export type { StartPlanResponse } from "./commands.js";
export type { OperatorXlsxClientDownload } from "./commands.js";
export type { OperatorXlsxExportRequest } from "../../models/dashboard/xlsx-export.js";
export type {
  CrossDateSearchPage,
  CrossDateSearchQuery,
  CrossDateSearchQueryInput,
} from "../../models/dashboard/search.js";

export interface DashboardClient extends DashboardQueries, DashboardCommands {
  fetchAuthenticatedResource(url: string, signal: AbortSignal): Promise<Readonly<{ url: string; release(): void }>>;
  uploadOcrSource(request: Readonly<{ fileName: string; bytes: Uint8Array }>, signal?: AbortSignal): Promise<ReturnType<typeof OcrSourceUploadSchema.parse>>;
  ocrSourcePageUrl(runId: string, revision: number, sourcePage: number): string;
  ocrCommandResult(runId: string, commandId: string, signal?: AbortSignal): Promise<ReturnType<typeof OcrCommandResultWireSchema.parse>>;
  workerCommandResult(commandId: string, signal?: AbortSignal): Promise<WorkerCommandResultWire>;
  readProfileSession(): Promise<PublicProfileState>;
  subscribeProfileSessionStale(listener: () => void): () => void;
  signInProfile(request: ProfileLoginRequest): Promise<PublicProfileState>;
  resumeProfile(): Promise<PublicProfileState>;
  signUpProfile(request: ProfileSignUpRequest): Promise<PublicProfileState>;
  logOutProfile(): Promise<PublicProfileState>;
  changeProfilePassword(request: ProfilePasswordChangeRequest): Promise<ProfileLoginChangeResult>;
  changeProfileUsername(request: ProfileUsernameChangeRequest): Promise<ProfileLoginChangeResult>;
  changeProfileDetails(request: ProfileDetailsChangeRequest): Promise<ProfileDetailsChangeResult>;
  readProfileDuoKeys(scope: DuoKeysScope): Promise<DuoKeysSnapshot>;
  changeProfileDuoKey(request: DuoKeyChangeRequest): Promise<DuoKeyChangeResult>;
  deleteProfileAccount(request: DeleteProfileAccountRequest): Promise<PublicProfileState>;
  completeProfileOnboarding(request: CompleteProfileOnboardingRequest): Promise<PublicProfileState>;
  cancelProfileOnboardingDuo(request: CancelProfileOnboardingDuoRequest): Promise<PublicProfileState>;
  cancelProfileOnboarding(request: CancelProfileOnboardingRequest): Promise<PublicProfileState>;
  showProfileOnboardingBrowser(request: CompleteProfileOnboardingRequest): Promise<PublicProfileState>;
  reopenProfileOnboardingBrowser(request: ReopenProfileOnboardingBrowserRequest): Promise<PublicProfileState>;
  openProfileOnboardingPortal(request: CompleteProfileOnboardingRequest): Promise<PublicProfileState>;
  startProfileOnboardingDuo(request: StartProfileOnboardingDuoRequest): Promise<PublicProfileState>;
  confirmProfileOnboardingDuo(request: ConfirmProfileOnboardingDuoRequest): Promise<PublicProfileState>;
  beginProfileDuoReenrol(): Promise<DuoReenrolState>;
  readProfileDuoReenrol(request: CompleteProfileOnboardingRequest): Promise<DuoReenrolState>;
  showProfileDuoReenrolBrowser(request: CompleteProfileOnboardingRequest): Promise<DuoReenrolState>;
  reopenProfileDuoReenrolBrowser(request: ReopenProfileOnboardingBrowserRequest): Promise<DuoReenrolState>;
  openProfileDuoReenrolPortal(request: CompleteProfileOnboardingRequest): Promise<DuoReenrolState>;
  startProfileDuoReenrol(request: StartProfileOnboardingDuoRequest): Promise<DuoReenrolState>;
  confirmProfileDuoReenrol(request: ConfirmProfileOnboardingDuoRequest): Promise<DuoReenrolState>;
  cancelProfileDuoReenrolAttempt(request: CancelProfileOnboardingDuoRequest): Promise<DuoReenrolState>;
  cancelProfileDuoReenrol(request: CompleteProfileOnboardingRequest): Promise<PublicProfileState>;
  commitProfileDuoReenrol(request: CompleteProfileOnboardingRequest): Promise<PublicProfileState>;
  reportError(report: DashboardErrorReport): Promise<void>;
  subscribeDay(
    input: Omit<DashboardDaySubscriptionDeps, "transport">,
  ): DashboardDaySubscription;
}

export function createDashboardClient(input: Readonly<{
  baseUrl: string;
  fetchImpl?: FetchLike;
  surface?: () => string;
  runId?: () => DashboardErrorReport["runId"];
}>): DashboardClient {
  const surface = input.surface;
  const origin = new URL(input.baseUrl).origin;
  const browser = typeof window !== "undefined" && window.location?.origin === origin ? window : undefined;
  const resumeKey = "relay.profile.resume", draftKey = "relay.profile.draft";
  const endingKey = "relay.profile.ending";
  let session = browser?.sessionStorage.getItem(endingKey) ?? null;
  let memoryProof: string | null = null, memoryDraft: string | null = null;
  const resumeProof = () => browser === undefined ? memoryProof : browser.localStorage.getItem(resumeKey);
  const draft = () => browser === undefined ? memoryDraft : browser.sessionStorage.getItem(draftKey);
  const saveDraft = (value: string | null) => {
    memoryDraft = value;
    if (value === null) browser?.sessionStorage.removeItem(draftKey);
    else browser?.sessionStorage.setItem(draftKey, value);
  };
  const saveProof = (value: string | null) => {
    memoryProof = value;
    if (value === null) browser?.localStorage.removeItem(resumeKey);
    else browser?.localStorage.setItem(resumeKey, value);
  };
  const clientId = crypto.randomUUID();
  const profileSessionListeners = new Set<Readonly<{ listener: () => void }>>();
  let profileAuthority: Readonly<Pick<Extract<PublicProfileState, { state: "active" }>, "profileId" | "epoch">> | undefined;
  let activation = { pending: false };
  const reportFailure = (failure: NonNullable<ReturnType<typeof debugFailureOutcome>> & { route: string }): void => {
    if (surface === undefined || profileAuthority === undefined) return;
    void client.reportError({ reportId: crypto.randomUUID(), clientId, release: "dashboard",
      route: failure.route, surface: surface(), code: failure.code, reason: failure.reason,
      message: DASHBOARD_REQUEST_REPORT_MESSAGE })
      .catch(() => { window.reportError(new DashboardReportDeliveryError()); });
  };
  const transport = createDashboardTransport({ ...input, profileHeaders(path) {
    const state = path === "/api/v1/profile/state";
    const credential = /^\/api\/v1\/profile\/onboarding\//u.test(path) ? draft() : session ?? (state ? draft() : null);
    const proof = state || path === "/api/v1/profile/resume" ? resumeProof() : null;
    const headers: Record<string, string> = {};
    if (credential !== null) headers["x-relay-session"] = credential;
    if (proof !== null) headers["x-relay-resume"] = proof;
    return headers;
  }, captureProfileSessionStale: () => {
    const dispatchedAuthority = profileAuthority, recipients = [...profileSessionListeners];
    return () => {
      if (dispatchedAuthority !== profileAuthority) return;
      profileAuthority = undefined;
      for (const recipient of recipients) if (profileSessionListeners.has(recipient)) recipient.listener();
    };
  },
    ...(surface === undefined ? {} : { onFailure: reportFailure }) });
  const withProofLock = async <T>(run: () => T | Promise<T>): Promise<T> =>
    browser === undefined ? run() : await browser.navigator.locks.request(resumeKey, run);
  const activateProfile = async (path: string, init: RequestInit): Promise<PublicProfileState> => {
    const rotating = path === "/api/v1/profile/resume";
    const request = { pending: true }; activation = request;
    const dispatch = async (): Promise<PublicProfileState> => {
      if (activation !== request) return { state: "refused", code: "PROFILE_SESSION_STALE" };
      const predecessor = resumeProof();
      const response = await transport.requestJsonResponse(path, init);
      const state = parseProfileState(response.body);
      const settle = (): PublicProfileState => {
        const currentProof = resumeProof();
        const joined = state.state === "active" && currentProof !== null && currentProof === response.headers.get("x-relay-resume");
        if (activation !== request || predecessor !== currentProof && !joined) return { state: "refused", code: "PROFILE_SESSION_STALE" };
        if (state.state === "active") {
          const next = response.headers.get("x-relay-session"), proof = response.headers.get("x-relay-resume");
          if (next === null || proof === null) throw schemaError(path, "missing profile credential");
          saveProof(proof);
          session = next;
          browser?.sessionStorage.removeItem(endingKey);
          profileAuthority = { profileId: state.profileId, epoch: state.epoch };
        } else if (state.state === PROFILE_ONBOARDING_STATE) {
          const next = response.headers.get("x-relay-session");
          if (next === null) throw schemaError(path, "missing onboarding credential");
          saveDraft(next);
        } else if (state.state === "signed-out") {
          session = null;
          browser?.sessionStorage.removeItem(endingKey);
          saveDraft(null);
          saveProof(null);
          profileAuthority = undefined;
        }
        return state;
      };
      return rotating ? settle() : withProofLock(settle);
    };
    // Other tabs may discover or resume only after the successor proof is visible in origin storage.
    try { return await (rotating ? withProofLock(dispatch) : dispatch()); }
    finally { request.pending = false; }
  };
  const endProfile = (path: string, body: unknown) => {
    if (session !== null) browser?.sessionStorage.setItem(endingKey, session);
    profileAuthority = undefined;
    return activateProfile(path, { method: "POST", body: JSON.stringify(body) });
  };
  const queries = createDashboardQueries(transport);
  const commands = createDashboardCommands(transport);
  const acceptReenrol = (response: { status: number; body: unknown }, operationId?: string): DuoReenrolState => {
    const failure = codedReenrolFailure(response.status, response.body);
    if (failure !== undefined) throw failure;
    const state = parseOrThrow(DuoReenrolStateSchema, "POST /api/v1/profile/duo/reenrol", response.body);
    if (operationId !== undefined && state.operationId !== operationId) throw schemaError("POST /api/v1/profile/duo/reenrol", "re-enrolment operation identity mismatch");
    if (profileAuthority !== undefined && state.profileId !== profileAuthority.profileId) throw schemaError("POST /api/v1/profile/duo/reenrol", "re-enrolment profile identity mismatch");
    return state;
  };
  const acceptProfileCompletion = (body: unknown): PublicProfileState => {
    const state = parseProfileState(body);
    if (profileAuthority !== undefined && state.state === "active" && state.profileId !== profileAuthority.profileId) throw schemaError("POST /api/v1/profile/duo/reenrol", "re-enrolment profile identity mismatch");
    return state;
  };
  const duoKeysAuthority = (scope: DuoKeysScope) => {
    const owner = profileAuthority;
    if (owner === undefined || owner.profileId !== scope.profileId || owner.epoch !== scope.epoch) throw schemaError(DUO_KEYS_PATH, "Duo key session changed");
    return (identity: DuoKeysScope) => {
      if (owner !== profileAuthority || identity.profileId !== scope.profileId || identity.epoch !== scope.epoch) throw schemaError(DUO_KEYS_PATH, "Duo key session changed");
    };
  };
  const client: DashboardClient = {
    async fetchAuthenticatedResource(url, signal) {
      const target = new URL(url, origin);
      if (target.origin !== origin || target.username || target.password || !/^\/(?:api\/v1|artifacts)\//u.test(target.pathname)) throw schemaError("GET resource", "invalid dashboard resource");
      const owner = profileAuthority, proof = resumeProof(), dispatched = activation;
      const { bytes, headers } = await transport.requestBinary(target.pathname + target.search, { signal, headers: { accept: "*/*" } });
      signal.throwIfAborted();
      if (owner !== profileAuthority || dispatched !== activation || proof !== resumeProof()) throw schemaError("GET resource", "resource session changed");
      const mediaType = headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
      const type = mediaType !== undefined && /^image\/(?:png|jpeg|gif|webp)$/u.test(mediaType) ? mediaType : "application/octet-stream";
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type }));
      return { url: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
    },
    subscribeProfileSessionStale(listener) {
      const recipient = { listener };
      profileSessionListeners.add(recipient);
      return () => { profileSessionListeners.delete(recipient); };
    },
    async ocrCommandResult(runId, commandId, signal) {
      const result = OcrCommandResultWireSchema.parse(await transport.requestJson(`/api/v1/runs/${encodeURIComponent(RunIdSchema.parse(runId))}/ocr/commands/${encodeURIComponent(commandId)}`,
        signal === undefined ? undefined : { signal }));
      if (result.state === "recorded" && (result.request.commandId !== commandId || result.request.target.runId !== runId)) throw new DashboardClientError({ kind: "schema", code: "OCR_REVIEW_REFUSED", message: ERROR_CATALOG.OCR_REVIEW_REFUSED.text });
      return result;
    },
    async workerCommandResult(commandId, signal) {
      const path = `/api/v1/worker-commands/${encodeURIComponent(commandId)}`;
      const result = parseOrThrow(WorkerCommandResultWireSchema, `GET ${path}`, await transport.requestJson(path, signal === undefined ? undefined : { signal }));
      if (result.state === "recorded" && result.request.commandId !== commandId) throw schemaError(`GET ${path}`, "worker command result identity mismatch");
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
      const dispatchedAuthority = profileAuthority, requestedActivation = activation;
      const response = await withProofLock(() => transport.requestJsonResponse("/api/v1/profile/state"));
      const state = parseProfileState(response.body);
      if (dispatchedAuthority === profileAuthority && requestedActivation === activation && !activation.pending) {
        if (state.state !== "active") profileAuthority = undefined;
        else if (state.profileId !== profileAuthority?.profileId || state.epoch !== profileAuthority.epoch) profileAuthority = { profileId: state.profileId, epoch: state.epoch };
      }
      return state;
    },
    async signInProfile(request: ProfileLoginRequest) {
      return activateProfile("/api/v1/profile/sign-in", {
        method: "POST", body: JSON.stringify(ProfileLoginRequestSchema.parse(request)),
      });
    },
    async resumeProfile() {
      return activateProfile("/api/v1/profile/resume", { method: "POST", body: "{}" });
    },
    async signUpProfile(request: ProfileSignUpRequest) {
      return activateProfile("/api/v1/profile/sign-up", {
        method: "POST", body: JSON.stringify(ProfileSignUpRequestSchema.parse(request)),
      });
    },
    async deleteProfileAccount(request) {
      return endProfile("/api/v1/profile/delete-account", DeleteProfileAccountRequestSchema.parse(request));
    },
    async logOutProfile() {
      return endProfile("/api/v1/profile/logout", {});
    },
    async changeProfilePassword(request) {
      return parseLoginChange((await transport.requestJsonResponse("/api/v1/profile/account/password", {
        method: "POST", body: JSON.stringify(ProfilePasswordChangeRequestSchema.parse(request)),
      })).body);
    },
    async changeProfileUsername(request) {
      return parseLoginChange((await transport.requestJsonResponse("/api/v1/profile/account/username", {
        method: "POST", body: JSON.stringify(ProfileUsernameChangeRequestSchema.parse(request)),
      })).body);
    },
    async changeProfileDetails(request) {
      return parseDetailsChange((await transport.requestJsonResponse("/api/v1/profile/account/details", {
        method: "POST", body: JSON.stringify(ProfileDetailsChangeRequestSchema.parse(request)),
      })).body);
    },
    async readProfileDuoKeys(scope) {
      const assertOwner = duoKeysAuthority(ProfileDuoKeysScopeSchema.parse(scope));
      const result = parseOrThrow(ProfileDuoKeysReadSchema, DUO_KEYS_PATH, await transport.requestJson(DUO_KEYS_PATH));
      assertOwner(result);
      return result.snapshot;
    },
    async changeProfileDuoKey(request) {
      const parsed = ProfileDuoKeyChangeRequestSchema.parse(request), assertOwner = duoKeysAuthority(parsed);
      const result = parseOrThrow(ProfileDuoKeyChangeResponseSchema, DUO_KEYS_PATH,
        await transport.requestJson(DUO_KEYS_PATH, { method: "POST", body: JSON.stringify(parsed) }));
      assertOwner(result);
      if (result.commandId !== parsed.change.commandId) throw schemaError(DUO_KEYS_PATH, "Duo key command identity changed");
      return result.result;
    },
    async completeProfileOnboarding(request) {
      return activateProfile("/api/v1/profile/onboarding/complete", {
        method: "POST", body: JSON.stringify(CompleteProfileOnboardingRequestSchema.parse(request)),
      });
    },
    async cancelProfileOnboardingDuo(request) {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/onboarding/duo/cancel", {
        method: "POST", body: JSON.stringify(CancelProfileOnboardingDuoRequestSchema.parse(request)),
      })).body);
    },
    async cancelProfileOnboarding(request) {
      return activateProfile("/api/v1/profile/onboarding/cancel", {
        method: "POST", body: JSON.stringify(CancelProfileOnboardingRequestSchema.parse(request)),
      });
    },
    async showProfileOnboardingBrowser(request) {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/onboarding/duo/browser", {
        method: "POST", body: JSON.stringify(CompleteProfileOnboardingRequestSchema.parse(request)),
      })).body);
    },
    async reopenProfileOnboardingBrowser(request) {
      return parseProfileState((await transport.requestJsonResponse("/api/v1/profile/onboarding/duo/reopen", {
        method: "POST", body: JSON.stringify(ReopenProfileOnboardingBrowserRequestSchema.parse(request)),
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
    async beginProfileDuoReenrol() {
      return acceptReenrol(await transport.requestJsonResponse("/api/v1/profile/duo/reenrol/begin", { method: "POST", body: "{}" }));
    },
    async readProfileDuoReenrol(request) {
      const parsed = CompleteProfileOnboardingRequestSchema.parse(request);
      return acceptReenrol(await transport.requestJsonResponse("/api/v1/profile/duo/reenrol/read", {
        method: "POST", body: JSON.stringify(parsed),
      }), parsed.operationId);
    },
    async showProfileDuoReenrolBrowser(request) {
      const parsed = CompleteProfileOnboardingRequestSchema.parse(request);
      return acceptReenrol(await transport.requestJsonResponse("/api/v1/profile/duo/reenrol/browser", {
        method: "POST", body: JSON.stringify(parsed),
      }), parsed.operationId);
    },
    async reopenProfileDuoReenrolBrowser(request) {
      const parsed = ReopenProfileOnboardingBrowserRequestSchema.parse(request);
      return acceptReenrol(await transport.requestJsonResponse("/api/v1/profile/duo/reenrol/reopen", {
        method: "POST", body: JSON.stringify(parsed),
      }), parsed.operationId);
    },
    async openProfileDuoReenrolPortal(request) {
      const parsed = CompleteProfileOnboardingRequestSchema.parse(request);
      return acceptReenrol(await transport.requestJsonResponse("/api/v1/profile/duo/reenrol/portal", {
        method: "POST", body: JSON.stringify(parsed),
      }), parsed.operationId);
    },
    async startProfileDuoReenrol(request) {
      const parsed = StartProfileOnboardingDuoRequestSchema.parse(request);
      return acceptReenrol(await transport.requestJsonResponse("/api/v1/profile/duo/reenrol/start", {
        method: "POST", body: JSON.stringify(parsed),
      }), parsed.operationId);
    },
    async confirmProfileDuoReenrol(request) {
      const parsed = ConfirmProfileOnboardingDuoRequestSchema.parse(request);
      return acceptReenrol(await transport.requestJsonResponse("/api/v1/profile/duo/reenrol/confirm", {
        method: "POST", body: JSON.stringify(parsed),
      }), parsed.operationId);
    },
    async cancelProfileDuoReenrolAttempt(request) {
      const parsed = CancelProfileOnboardingDuoRequestSchema.parse(request);
      return acceptReenrol(await transport.requestJsonResponse("/api/v1/profile/duo/reenrol/cancel-attempt", {
        method: "POST", body: JSON.stringify(parsed),
      }), parsed.operationId);
    },
    async cancelProfileDuoReenrol(request) {
      return acceptProfileCompletion((await transport.requestJsonResponse("/api/v1/profile/duo/reenrol/cancel", {
        method: "POST", body: JSON.stringify(CompleteProfileOnboardingRequestSchema.parse(request)),
      })).body);
    },
    async commitProfileDuoReenrol(request) {
      return acceptProfileCompletion((await transport.requestJsonResponse("/api/v1/profile/duo/reenrol/commit", {
        method: "POST", body: JSON.stringify(CompleteProfileOnboardingRequestSchema.parse(request)),
      })).body);
    },
    async reportError(report: DashboardErrorReport) {
      if (profileAuthority === undefined) return;
      const runId = report.runId ?? input.runId?.();
      await transport.requestJson("/api/v1/debug/errors", { method: "POST", body: JSON.stringify(DashboardErrorReportSchema.parse({ ...report, ...(runId === undefined ? {} : { runId }) })) });
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
        const reason = error instanceof z.ZodError || error instanceof DashboardClientError && error.kind === "schema" ? "response-schema-invalid"
          : error instanceof DashboardClientError ? "response-protocol-invalid" : "client-exception";
        if (failure !== undefined) reportFailure({ ...failure, reason, route: `client:${method}` });
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
export type { AssistantModelPreferenceView, AssistantM1Request } from "../../models/dashboard/assistant.js";

function parseLoginChange(body: unknown): ProfileLoginChangeResult {
  const wire = WIRE_ERROR_BODY.safeParse(body);
  return ProfileLoginChangeResultSchema.parse(wire.success ? { state: "refused", code: wire.data.code } : body);
}
function parseDetailsChange(body: unknown): ProfileDetailsChangeResult {
  const wire = WIRE_ERROR_BODY.safeParse(body);
  return ProfileDetailsChangeResultSchema.parse(wire.success ? { state: "refused", code: wire.data.code } : body);
}
function parseProfileState(body: unknown): PublicProfileState {
  const wire = WIRE_ERROR_BODY.safeParse(body);
  return PublicProfileStateSchema.parse(wire.success ? { state: "refused", code: wire.data.code } : body);
}
function codedReenrolFailure(status: number, body: unknown): DashboardClientError | undefined {
  const wire = WIRE_ERROR_BODY.safeParse(body);
  if (wire.success) {
    const code = ErrorCatalogCodeSchema.safeParse(wire.data.code);
    if (!code.success) return undefined;
    return new DashboardClientError({ kind: "http", status, code: code.data, message: wire.data.message, retryable: wire.data.retryable });
  }
  const parsed = PublicProfileStateSchema.safeParse(body);
  if (!parsed.success) return undefined;
  if (parsed.data.state === "refused") return new DashboardClientError({ kind: "http", status, code: parsed.data.code, message: ERROR_CATALOG[parsed.data.code].text });
  if (parsed.data.state !== "error") return undefined;
  const code = ErrorCatalogCodeSchema.safeParse(parsed.data.code);
  if (!code.success) return undefined;
  return new DashboardClientError({ kind: "http", status, code: code.data, message: ERROR_CATALOG[code.data].text });
}
