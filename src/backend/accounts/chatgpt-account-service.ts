import { AssistantCallUsageSchema } from "../../models/dashboard/assistant-usage.js";
import { AssistantModelPreferenceSchema, type AssistantModelPreference } from "../../models/config/assistant-model-preference.js";
import { ASSISTANT_CONTEXT_MEDIA_MAX_BYTES, ASSISTANT_REQUEST_MAX_BYTES, AssistantInferenceRequestSchema, AssistantInferenceResultSchema, AssistantModelCatalogSchema, assistantInputMedia, assistantUserParts, type AssistantInferenceRequest } from "../../models/dashboard/assistant.js";
import { ChatGptAccountStatusSchema, type ChatGptAccountStatus, type ChatGptAccountState, type ChatGptSignInRequest, type ChatGptSignedOut } from "../../models/dashboard/chatgpt-account.js";
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import type { Clock } from "../../rules/time/clock.js";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import { privateEqual } from "../../rules/validation/private-equal.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { type RuntimeAdmission } from "../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../storage/admission/admission-identity.js";
import { createChatGptCredentialRepository, ChatGptCredentialError, type ChatGptCredentialRecord, type ChatGptCredentialRepositoryOptions, type ChatGptCredentialTransaction } from "../storage/configuration/chatgpt-credential-repository.js";
import { hasUnprovedSourceClosure } from "../storage/source-closure.js";
import { ERROR_CATALOG, type ErrorCatalogCode } from "../../models/failures/error-catalog.js";
import { ChatGptInferenceDiagnosticSchema, ChatGptStreamEventTypeSchema, ChatGptShapeKeySchema, type ChatGptInferenceDiagnostic, type DebugEventSchema } from "../../models/events/timeline.js";

const AUTH = "https://auth.openai.com", RESOURCE = "https://api.openai.com/v1";
const MODEL_CATALOG_MAX_BYTES = 2 * 1024 * 1024;
const PLAN_SCOPES = ["offline_access", "resource.invoke", "chatgpt.tokens.use.direct"];
type ChatGptAccountCode = Exclude<Extract<ErrorCatalogCode, `CHATGPT_${string}`>, `CHATGPT_CREDENTIAL_${string}`>;
export class ChatGptAccountError extends Error {
  constructor(readonly code: ChatGptAccountCode) { super(ERROR_CATALOG[code].text); this.name = "ChatGptAccountError"; }
}
export class ChatGptResourceClosureUnprovedError extends ChatGptAccountError {
  constructor(cause: unknown) { super("CHATGPT_RESOURCE_CLOSURE_UNPROVED"); this.name = "ChatGptResourceClosureUnprovedError"; this.cause = cause; }
}
/** The Responses POST may have reached the provider, and neither a complete answer nor a provider refusal came back. */
export class ChatGptDeliveryUncertainError extends ChatGptAccountError {
  constructor(code: ChatGptAccountCode) { super(code); }
}
const fault = (code: ChatGptAccountCode) => new ChatGptAccountError(code);
export interface ChatGptAuthorization {
  readonly authorizationUrl: string;
  readonly expiresAt: string;
  readonly completion: Promise<ChatGptAccountState>;
  cancel(): Promise<void>;
}
export const ChatGptOcrRequestSchema = z.strictObject({
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u), instruction: z.string().min(1).max(100_000),
  input: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("image"), mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]), base64: z.string().min(1).max(28_000_000) }),
    z.strictObject({ kind: z.literal("pdf"), filename: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}\.pdf$/u), base64: z.string().min(1).max(28_000_000) }),
  ]),
});
export type ChatGptOcrRequest = z.infer<typeof ChatGptOcrRequestSchema>;
export interface ChatGptAccountAuthority {
  readonly revision: number | null;
  readonly attemptGeneration: number;
  readonly availability: "available" | "signed-out" | "expired" | "pending" | "closed" | "unavailable" | "disabled" | "limit-reached";
}
export interface ChatGptAccountServiceOptions {
  readonly admission: RuntimeAdmission;
  readonly stateRoot: string;
  readonly clock: Clock;
  readonly fetch?: typeof fetch;
  readonly credentialHooks?: Pick<ChatGptCredentialRepositoryOptions, "afterRename">;
}
const DiscoverySchema = z.object({ issuer: z.literal(AUTH), jwks_uri: z.url(), revocation_endpoint: z.url(), id_token_signing_alg_values_supported: z.array(z.string()) });
const TokenSchema = z.object({ access_token: z.string().min(1).max(16_384), refresh_token: z.string().min(1).max(16_384).optional(),
  id_token: z.string().min(1).max(16_384), token_type: z.literal("Bearer"), expires_in: z.number().int().positive().max(86_400),
  scope: z.string().max(4096), earliest_refresh_at: z.number().int().nonnegative().optional() });
const ClaimsSchema = z.object({ iss: z.literal(AUTH), aud: z.union([z.string(), z.array(z.string())]), sub: z.string().min(1).max(256),
  exp: z.number().int(), iat: z.number().int(), nonce: z.string().optional(), name: z.string().min(1).max(256), email: z.email(),
  nbf: z.number().int().optional(), azp: z.string().optional() });
function authUrl(value: string): string {
  const url = new URL(value);
  if (url.origin !== AUTH || url.username !== "" || url.password !== "" || url.hash !== "") throw fault("CHATGPT_AUTH_INVALID");
  return url.href;
}
async function boundedJson(response: Response, diagnostic?: ChatGptInferenceDiagnostic, invalidCode: ChatGptAccountCode = "CHATGPT_AUTH_INVALID", maxBytes = 64_000): Promise<unknown> {
  if (!response.ok || response.body === null) { if (diagnostic !== undefined) diagnostic.jsonFailure = "missing-body"; await response.body?.cancel(); throw fault(invalidCode === "CHATGPT_AUTH_INVALID" ? "CHATGPT_AUTH_UNAVAILABLE" : invalidCode); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  let outcome: { readonly kind: "value"; readonly value: unknown } | { readonly kind: "error"; readonly error: unknown }, readError: unknown;
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
      if (size > maxBytes) { if (diagnostic !== undefined) diagnostic.jsonFailure = "too-large"; throw fault(invalidCode); } chunks.push(chunk.value); }
    if (diagnostic !== undefined) diagnostic.jsonFailure = "decode";
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    if (diagnostic !== undefined) diagnostic.jsonFailure = "parse";
    try { outcome = { kind: "value", value: JSON.parse(text) as unknown }; }
    catch { outcome = { kind: "error", error: fault(invalidCode) }; }
    if (outcome.kind === "value" && diagnostic !== undefined) delete diagnostic.jsonFailure;
  } catch (error) { readError = error; if (diagnostic !== undefined) diagnostic.jsonFailure ??= "read"; outcome = { kind: "error", error: error instanceof ChatGptAccountError ? error : fault(invalidCode) }; }
  // An errored stream's cancel repeats the read's own error: the stream is already closed.
  try { await reader.cancel(); } catch (error) { if (readError === undefined || error !== readError) outcome = { kind: "error", error: error instanceof ChatGptResourceClosureUnprovedError ? error : fault("CHATGPT_AUTH_UNAVAILABLE") }; }
  reader.releaseLock();
  if (outcome.kind === "error") throw outcome.error;
  return outcome.value;
}
async function boundedEmptyResponse(response: Response): Promise<boolean> {
  if (response.body === null) return true;
  const reader = response.body.getReader();
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) return true; if (chunk.value.length > 0) return false; } }
  finally { await reader.cancel(); reader.releaseLock(); }
}
function publicState(record: ChatGptCredentialRecord | undefined, now: number): ChatGptAccountState {
  if (record?.session == null || record.registration === null) return { state: "signed-out", ...(record?.registration == null ? {} : { account: { email: record.registration.email } }) };
  if (Date.parse(record.session.expiresAt) <= now) return { state: "expired" };
  if (record.session.usage === "unavailable") return { state: "unavailable", code: "CHATGPT_USAGE_UNAVAILABLE", message: ERROR_CATALOG.CHATGPT_USAGE_UNAVAILABLE.text };
  return { state: "connected", name: record.registration.name, email: record.registration.email, expiresAt: record.session.expiresAt,
    planUsage: !record.session.usePlan || !PLAN_SCOPES.every(scope => record.session?.scopes.includes(scope)) ? "disabled"
      : record.session.usage === "limit-reached" ? "limit-reached" : "enabled" };
}
async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(fault("CHATGPT_AUTH_UNAVAILABLE"))));
}
async function interruptible<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => { throw fault("CHATGPT_OCR_CANCELLED"); };
  const cancelled = new Promise<never>((_, reject) => { abort = () => reject(fault("CHATGPT_OCR_CANCELLED")); });
  signal.addEventListener("abort", abort, { once: true });
  try { if (signal.aborted) abort(); return await Promise.race([operation, cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}
function inferenceContentType(headers: Headers): ChatGptInferenceDiagnostic["contentType"] {
  const contentType = headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const parsed = ChatGptInferenceDiagnosticSchema.shape.contentType.exclude(["missing", "other"]).safeParse(contentType);
  return contentType === undefined ? "missing" : parsed.success ? parsed.data : "other";
}
function inferenceShapeKey(key: PropertyKey): z.infer<typeof ChatGptShapeKeySchema> {
  if (typeof key === "number") return "[]";
  const parsed = ChatGptShapeKeySchema.safeParse(key);
  return parsed.success ? parsed.data : "*";
}
function inferenceTerminalShape(value: unknown): NonNullable<ChatGptInferenceDiagnostic["terminalShape"]> {
  const shape: NonNullable<ChatGptInferenceDiagnostic["terminalShape"]> = { fields: [], truncated: false };
  const visit = (value: unknown, path: z.infer<typeof ChatGptShapeKeySchema>[]): void => {
    if (shape.fields.length === 128 || path.length > 8) { shape.truncated = true; return; }
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    if (type !== "object" && type !== "array" && type !== "null" && type !== "string" && type !== "number" && type !== "boolean") return;
    shape.fields.push({ path, type });
    if (value === null || typeof value !== "object") return;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      visit((value as Record<string, unknown>)[key], [...path, Array.isArray(value) ? "[]" : inferenceShapeKey(key)]);
      if (shape.truncated) break;
    }
  };
  visit(value, []);
  return shape;
}

export function createChatGptAccountService(options: ChatGptAccountServiceOptions) {
  const credentialRepository = createChatGptCredentialRepository({ admission: options.admission, stateRoot: options.stateRoot, ...options.credentialHooks });
  const transport = options.fetch ?? fetch, clock = options.clock;
  let debugEvents: { emit(event: Omit<z.input<typeof DebugEventSchema>, "build" | "pid">): void } | undefined;
  function setDebugEvents(writer: NonNullable<typeof debugEvents>): void { debugEvents = writer; }
  function recordFailure(error: unknown, diagnostic: ChatGptInferenceDiagnostic, http: { method: "GET" | "POST"; route: string } | undefined = undefined): void {
    try {
      debugEvents?.emit({ category: "http", phase: "failed", correlationId: randomUUID(), area: "chatgpt-inference", reason: diagnostic.path,
        ...http, status: diagnostic.transport?.status, chatGptInference: diagnostic,
        code: error instanceof ChatGptAccountError || error instanceof ChatGptCredentialError ? error.code : http?.route === "/v1/responses" ? "CHATGPT_OCR_FAILED" : "CHATGPT_AUTH_UNAVAILABLE" });
    } catch (cause) {
      if (error instanceof ChatGptResourceClosureUnprovedError) throw new ChatGptResourceClosureUnprovedError(new AggregateError([error, cause], "ChatGPT response closure and diagnostics failed"));
      throw fault("CHATGPT_DIAGNOSTICS_UNAVAILABLE");
    }
  }
  const requests = new Set<AbortController>();
  const accesses = new Set<Promise<ChatGptCredentialRecord>>();
  const inferenceLifetimes = new Set<Promise<void>>();
  const closureFailures = new Map<Error, readonly unknown[]>();
  function retainResourceClosure(error: Error, ...owners: readonly unknown[]): void {
    closureFailures.set(error, [...(closureFailures.get(error) ?? []), ...owners]);
  }
  function retainCredentialClosure(error: unknown): void {
    if (error instanceof Error && hasUnprovedSourceClosure(error)) retainResourceClosure(error, credentialRepository, options.admission);
  }
  function assertResourceClosure(): void {
    if (closureFailures.size > 0) throw new ChatGptResourceClosureUnprovedError(new AggregateError([...closureFailures.keys()], "ChatGPT resource closure is unproved"));
  }
  const repository = {
    read(): ChatGptCredentialRecord | undefined {
      try { return credentialRepository.read(); }
      catch (error) { retainCredentialClosure(error); throw error; }
    },
    async withLock<T>(operation: (transaction: ChatGptCredentialTransaction) => Promise<T>): Promise<T> {
      try { return await credentialRepository.withLock(operation); }
      catch (error) { retainCredentialClosure(error); throw error; }
    },
  };
  let closed = false, generation = 0;
  let rejectedSessionToken: string | undefined;
  let planFailureToken: string | undefined;
  let pending: { cancel(): Promise<void> } | undefined;
  let signOutLifetime: Promise<ChatGptSignedOut> | undefined;
  let refreshingAccount: Promise<ChatGptAccountState> | undefined;
  function active(): void { if (closed) throw fault("CHATGPT_SERVICE_CLOSED"); options.admission.assertLive(); }
  async function request(url: string, init: RequestInit, signal?: AbortSignal, diagnostic?: ChatGptInferenceDiagnostic): Promise<Response> {
    active();
    const controller = new AbortController(); requests.add(controller);
    const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000), ...(signal === undefined ? [] : [signal])]);
    try {
      const response = await interruptible(transport(url, { ...init, signal: combined, redirect: "error" }), combined);
      if (diagnostic !== undefined) diagnostic.transport = { source: options.fetch === undefined ? "native" : "injected", status: response.status,
        contentType: inferenceContentType(response.headers), hasBody: response.body !== null, redirected: response.redirected,
        target: response.url === "" ? "missing" : response.url === url ? "expected" : "other" };
      if (diagnostic !== undefined) { diagnostic.contentType = inferenceContentType(response.headers); diagnostic.hasBody = response.body !== null; }
      if (response.body === null) { requests.delete(controller); return response; }
      const reader = response.body.getReader();
      let readerClosure: Promise<void> | undefined;
      function closeReader(cancel: boolean): Promise<void> {
        readerClosure ??= (async () => {
          const failures: unknown[] = [];
          // A stream errored by this request's own abort is already closed; cancel only reports that stored reason.
          if (cancel) try { await reader.cancel(); } catch (cause) { if (!combined.aborted || cause !== combined.reason) failures.push(cause); }
          try { reader.releaseLock(); } catch (cause) { failures.push(cause); }
          requests.delete(controller);
          if (failures.length !== 0) {
            const error = new ChatGptResourceClosureUnprovedError(new AggregateError(failures, "ChatGPT transport closure failed"));
            retainResourceClosure(error, reader, response, controller); throw error;
          }
        })();
        return readerClosure;
      }
      const body = new ReadableStream<Uint8Array>({
        async pull(target) {
          try {
            const chunk = await interruptible(reader.read(), combined);
            if (chunk.done) { await closeReader(false); target.close(); }
            else target.enqueue(chunk.value);
          } catch (cause) {
            let error = cause instanceof ChatGptResourceClosureUnprovedError ? cause : fault(combined.aborted ? "CHATGPT_OCR_CANCELLED" : "CHATGPT_AUTH_UNAVAILABLE");
            try { await closeReader(true); } catch (cleanup) {
              if (!(cleanup instanceof ChatGptResourceClosureUnprovedError)) throw cleanup;
              error = cleanup;
            }
            target.error(error);
          }
        },
        cancel: () => closeReader(true),
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    catch (error) { retainCredentialClosure(error); requests.delete(controller); throw fault(signal?.aborted === true || controller.signal.aborted ? "CHATGPT_OCR_CANCELLED" : "CHATGPT_AUTH_UNAVAILABLE"); }
  }
  async function discovery(signal?: AbortSignal, diagnostic?: ChatGptInferenceDiagnostic) {
    if (diagnostic !== undefined) diagnostic.path = "auth-discovery";
    const result = DiscoverySchema.safeParse(await boundedJson(await request(`${AUTH}/.well-known/openid-configuration`, {}, signal, diagnostic), diagnostic));
    if (!result.success || !result.data.id_token_signing_alg_values_supported.includes("RS256")) throw fault("CHATGPT_AUTH_INVALID");
    return { jwks: authUrl(result.data.jwks_uri), revocation: authUrl(result.data.revocation_endpoint) };
  }
  async function verifiedClaims(token: string, clientId: string, nonce: string | undefined, signal?: AbortSignal, diagnostic?: ChatGptInferenceDiagnostic) {
    try {
      if (diagnostic !== undefined) diagnostic.path = "auth-id-token-header";
      const parts = token.split("."); if (parts.length !== 3) throw fault("CHATGPT_AUTH_INVALID");
      const [headerPart, claimsPart, signaturePart] = parts;
      if (headerPart === undefined || claimsPart === undefined || signaturePart === undefined) throw fault("CHATGPT_AUTH_INVALID");
      const header = z.object({ alg: z.literal("RS256"), kid: z.string().min(1) }).parse(JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")));
      const discovered = await discovery(signal, diagnostic);
      if (diagnostic !== undefined) diagnostic.path = "auth-jwks";
      const jwks = z.object({ keys: z.array(z.object({ kty: z.literal("RSA"), kid: z.string(), n: z.string(), e: z.string(), use: z.literal("sig").optional(), alg: z.literal("RS256").optional() })).max(32) })
        .parse(await boundedJson(await request(discovered.jwks, {}, signal, diagnostic), diagnostic));
      const keys = jwks.keys.filter(key => key.kid === header.kid);
      if (keys.length !== 1 || keys[0] === undefined) throw fault("CHATGPT_AUTH_INVALID");
      const key = createPublicKey({ key: keys[0], format: "jwk" });
      if (diagnostic !== undefined) diagnostic.path = "auth-id-token-signature";
      if (!verify("RSA-SHA256", Buffer.from(`${headerPart}.${claimsPart}`), key, Buffer.from(signaturePart, "base64url"))) throw fault("CHATGPT_AUTH_INVALID");
      if (diagnostic !== undefined) diagnostic.path = "auth-id-token-claims";
      const claims = ClaimsSchema.parse(JSON.parse(Buffer.from(claimsPart, "base64url").toString("utf8")));
      const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud, seconds = clock.nowMs() / 1000;
      if (diagnostic !== undefined) diagnostic.path = "auth-id-token-audience";
      if (!audiences.includes(clientId) || audiences.length > 1 && claims.azp !== clientId || claims.azp !== undefined && claims.azp !== clientId) throw fault("CHATGPT_AUTH_INVALID");
      if (diagnostic !== undefined) diagnostic.path = "auth-id-token-time";
      if (claims.exp <= seconds || claims.iat > seconds || claims.nbf !== undefined && claims.nbf > seconds) throw fault("CHATGPT_AUTH_INVALID");
      if (diagnostic !== undefined) diagnostic.path = "auth-id-token-nonce";
      if (nonce !== undefined && (claims.nonce === undefined || !privateEqual(claims.nonce, nonce))) throw fault("CHATGPT_AUTH_INVALID");
      return claims;
    } catch (error) { if (error instanceof ChatGptAccountError) throw error; throw fault("CHATGPT_AUTH_INVALID"); }
  }
  async function token(form: URLSearchParams, clientId: string, usePlan: boolean, nonce?: string, signal?: AbortSignal, diagnostic?: ChatGptInferenceDiagnostic) {
    if (diagnostic !== undefined) diagnostic.path = "auth-token-http";
    const response = await request(`${AUTH}/api/accounts/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form }, signal, diagnostic);
    if (response.status === 400 || response.status === 401) {
      if (diagnostic !== undefined) diagnostic.path = "auth-token-body";
      const error = z.object({ error: z.string() }).safeParse(await boundedJson(new Response(response.body, { status: 200 }), diagnostic));
      if (diagnostic !== undefined) recordProviderCode(diagnostic, error.success ? error.data.error : undefined);
      throw fault(error.success && ["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_reused", "refresh_token_invalidated"].includes(error.data.error)
        ? "CHATGPT_ACCOUNT_EXPIRED" : "CHATGPT_AUTH_UNAVAILABLE");
    }
    if (diagnostic !== undefined) diagnostic.path = "auth-token-body";
    const body = await boundedJson(response, diagnostic);
    if (diagnostic !== undefined) diagnostic.path = "auth-token-schema";
    const parsed = TokenSchema.safeParse(body); if (!parsed.success) throw fault("CHATGPT_AUTH_INVALID");
    const claims = await verifiedClaims(parsed.data.id_token, clientId, nonce, signal, diagnostic);
    return { registration: { subject: claims.sub, name: claims.name, email: claims.email }, session: {
      accessToken: parsed.data.access_token, refreshToken: parsed.data.refresh_token ?? null, idToken: parsed.data.id_token,
      expiresAt: IsoInstantSchema.parse(new Date(clock.nowMs() + parsed.data.expires_in * 1000).toISOString()), earliestRefreshAt: parsed.data.earliest_refresh_at ?? null,
      scopes: parsed.data.scope.split(/\s+/u).filter(Boolean), usePlan, usage: "available" as const,
    } };
  }
  const authorityViews = new WeakSet<ChatGptAccountAuthority>();
  function assertAuthorityAdmission(expectedAdmission: RuntimeAdmission): void {
    requireRuntimeAdmission(expectedAdmission);
    expectedAdmission.assertStateRoot(options.stateRoot);
    if (expectedAdmission.stateRoot !== options.stateRoot || expectedAdmission !== options.admission && options.admission.stateRoot !== options.stateRoot) throw fault("CHATGPT_AUTH_INVALID");
  }
  function currentAuthority(expectedAdmission: RuntimeAdmission): ChatGptAccountAuthority {
    assertAuthorityAdmission(expectedAdmission);
    const current = repository.read();
    const state = current?.session != null && rejectedSessionToken !== undefined && privateEqual(current.session.accessToken, rejectedSessionToken)
      ? { state: "expired" as const }
      : current?.session != null && planFailureToken !== undefined && privateEqual(current.session.accessToken, planFailureToken)
        ? { state: "unavailable" as const } : publicState(current, clock.nowMs());
    const availability = closed ? "closed" : pending !== undefined || signOutLifetime !== undefined ? "pending"
      : state.state === "connected" ? state.planUsage === "enabled" ? "available" : state.planUsage === "disabled" ? "disabled" : "limit-reached"
        : state.state;
    return Object.freeze({ revision: current === undefined ? null : current.revision, attemptGeneration: generation, availability });
  }
  async function readAuthority(expectedAdmission: RuntimeAdmission = options.admission): Promise<ChatGptAccountAuthority> {
    assertAuthorityAdmission(expectedAdmission);
    const view = currentAuthority(expectedAdmission);
    authorityViews.add(view);
    return view;
  }
  function revalidateAuthority(captured: ChatGptAccountAuthority, expectedAdmission: RuntimeAdmission = options.admission): boolean {
    if (!authorityViews.has(captured)) return false;
    const current = currentAuthority(expectedAdmission);
    return current.availability === "available" && captured.availability === "available"
      && current.revision === captured.revision && current.attemptGeneration === captured.attemptGeneration;
  }
  function readAccount(): ChatGptAccountState {
    active();
    if (signOutLifetime !== undefined) return { state: "unavailable", code: "CHATGPT_AUTH_BUSY", message: ERROR_CATALOG.CHATGPT_AUTH_BUSY.text };
    try {
      const record = repository.read();
      if (record?.session != null && rejectedSessionToken !== undefined && privateEqual(record.session.accessToken, rejectedSessionToken)) return { state: "expired" };
      if (record?.session != null && planFailureToken !== undefined && privateEqual(record.session.accessToken, planFailureToken))
        return { state: "unavailable", code: "CHATGPT_PLAN_DISABLED", message: ERROR_CATALOG.CHATGPT_PLAN_DISABLED.text };
      return publicState(record, clock.nowMs());
    }
    catch (error) {
      if (error instanceof ChatGptCredentialError) return { state: "unavailable", code: error.code, message: error.message };
      throw error;
    }
  }
  async function signIn(input: ChatGptSignInRequest): Promise<ChatGptAuthorization> {
    active(); if (pending !== undefined || signOutLifetime !== undefined) throw fault("CHATGPT_AUTH_BUSY");
    if (typeof input.usePlan !== "boolean") throw fault("CHATGPT_AUTH_INVALID");
    const attemptGeneration = ++generation;
    let startupComplete = false, finishStartup!: () => void;
    let cancelAttempt: (() => Promise<void>) | undefined;
    const startup = new Promise<void>(resolve => { finishStartup = resolve; });
    const reservation = { cancel: async () => {
      if (attemptGeneration === generation) ++generation;
      await startup; await cancelAttempt?.();
      if (pending === reservation) pending = undefined;
    } };
    pending = reservation;
    try {
      const record = await repository.withLock(async transaction => {
        if (attemptGeneration !== generation || closed) throw fault("CHATGPT_AUTH_CANCELLED");
        const current = transaction.read(); if (current !== undefined) return current;
        const initial: ChatGptCredentialRecord = { schemaVersion: 1, revision: 1, hostId: `urn:uuid:${randomUUID()}`, clientId: null, registration: null, session: null };
        transaction.replace(initial, null); return initial;
      });
      if (attemptGeneration !== generation || closed) throw fault("CHATGPT_AUTH_CANCELLED");
      const state = randomBytes(32).toString("base64url"), nonce = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
      const expiresAt = new Date(clock.nowMs() + 300_000).toISOString();
      type CompletionOutcome = { readonly state: "completed"; readonly account: ChatGptAccountState } | { readonly state: "failed"; readonly error: unknown };
      let resolveCompletion: (outcome: CompletionOutcome) => void = () => { throw fault("CHATGPT_AUTH_INVALID"); };
      const completionOutcome = new Promise<CompletionOutcome>(resolve => { resolveCompletion = resolve; });
      let completion: Promise<ChatGptAccountState> | undefined;
      let settled = false, exchanging = false;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let redirectUri = "";
      const server = createServer((req, res) => {
        res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Type", "text/plain; charset=utf-8");
        const address = server.address();
        if (typeof address !== "object" || address === null || req.method !== "GET" || req.headers.host !== `127.0.0.1:${String(address.port)}`
          || req.socket.remoteAddress !== "127.0.0.1" || req.url === undefined || !req.url.startsWith("/auth/callback?")) { res.writeHead(400).end("Invalid callback."); return; }
        const callback = new URL(req.url, redirectUri), params = callback.searchParams;
        if ([...params.keys()].some(key => params.getAll(key).length !== 1) || !privateEqual(params.get("state"), state) || settled || exchanging) { res.writeHead(400).end("Invalid callback."); return; }
        if (clock.nowMs() >= Date.parse(expiresAt)) { res.writeHead(400).end("Sign-in expired."); void finish(fault("CHATGPT_AUTH_EXPIRED")); return; }
        if (params.has("error")) { res.writeHead(400).end("Sign-in refused."); void finish(fault(params.get("error") === "access_denied" ? "CHATGPT_AUTH_CANCELLED" : "CHATGPT_AUTH_INVALID")); return; }
        const code = params.get("code"), callbackClient = params.get("client_id"), clientId = record.clientId ?? callbackClient;
        if (code === null || code.length === 0 || code.length > 8192 || clientId === null || clientId === undefined || !/^oaiapp_[A-Za-z0-9_-]+$/u.test(clientId)
          || record.clientId !== null && callbackClient !== null && callbackClient !== record.clientId) {
          res.writeHead(400).end("Invalid callback."); void finish(fault("CHATGPT_AUTH_INVALID")); return;
        }
        exchanging = true; res.writeHead(200).end("Sign-in received. Return to Relay.");
        void (async () => {
          try {
            const registered = await repository.withLock(async transaction => {
              if (attemptGeneration !== generation || settled) throw fault("CHATGPT_AUTH_CANCELLED");
              if (record.clientId !== null) return record;
              const next = { ...record, clientId, revision: record.revision + 1 };
              transaction.replace(next, record.revision); return next;
            });
            const result = await token(new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: RESOURCE }), clientId, input.usePlan, nonce, controller.signal);
            if (record.registration !== null && result.registration.subject !== record.registration.subject || attemptGeneration !== generation || settled) throw fault("CHATGPT_AUTH_INVALID");
            await repository.withLock(async transaction => {
              if (attemptGeneration !== generation || settled) throw fault("CHATGPT_AUTH_CANCELLED");
              transaction.replace({ ...registered, ...result, revision: registered.revision + 1 }, registered.revision);
            });
            await finish(undefined, readAccount());
          } catch (error) { await finish(error instanceof ChatGptAccountError || error instanceof ChatGptCredentialError ? error : fault("CHATGPT_AUTH_INVALID")); }
        })();
      });
      async function finish(error?: unknown, result?: ChatGptAccountState): Promise<void> {
        if (settled) return; settled = true; controller.abort(); if (timer !== undefined) clearTimeout(timer);
        try { await closeServer(server); } catch { error = fault("CHATGPT_AUTH_UNAVAILABLE"); }
        if (attemptGeneration === generation) pending = undefined;
        if (error !== undefined) resolveCompletion({ state: "failed", error });
        else if (result !== undefined) resolveCompletion({ state: "completed", account: result });
        else resolveCompletion({ state: "failed", error: fault("CHATGPT_AUTH_INVALID") });
      }
      cancelAttempt = () => finish(fault("CHATGPT_AUTH_CANCELLED"));
      try {
        await new Promise<void>((resolve, reject) => { server.once("error", () => reject(fault("CHATGPT_AUTH_UNAVAILABLE"))); server.listen(0, "127.0.0.1", resolve); });
        if (attemptGeneration !== generation || closed) throw fault("CHATGPT_AUTH_CANCELLED");
        const address = server.address(); if (typeof address !== "object" || address === null) throw fault("CHATGPT_AUTH_UNAVAILABLE");
        redirectUri = `http://127.0.0.1:${String(address.port)}/auth/callback`;
        timer = setTimeout(() => { void finish(fault("CHATGPT_AUTH_EXPIRED")); }, 300_000); timer.unref();
        const url = new URL(`${AUTH}/api/accounts/authorize`);
        const parameters = { client_id: record.clientId === null ? "dynamic_agent_client" : record.clientId, ext_agent_host_id: record.hostId, response_type: "code", redirect_uri: redirectUri,
          scope: ["openid", "profile", "email", ...(input.usePlan ? PLAN_SCOPES : [])].join(" "), resource: RESOURCE, state, nonce,
          code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") };
        for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
        if (record.clientId === null) url.searchParams.set("agent_name_hint", "Relay");
        if (record.registration !== null) url.searchParams.set("login_hint", record.registration.email);
        if (input.usePlan && record.session !== null && (!record.session.usePlan || !PLAN_SCOPES.every(scope => record.session?.scopes.includes(scope))))
          url.searchParams.set("prompt", "consent");
        startupComplete = true;
        return { authorizationUrl: url.href, expiresAt, get completion() {
          if (completion === undefined) completion = completionOutcome.then(outcome => {
            if (outcome.state === "failed") throw outcome.error;
            return outcome.account;
          });
          return completion;
        }, cancel: reservation.cancel };
      } catch (error) { await finish(error); throw error; }
    } finally {
      if (!startupComplete && pending === reservation) pending = undefined;
      finishStartup();
    }
  }
  async function disconnect(forget: boolean): Promise<ChatGptSignedOut> {
    active(); if (signOutLifetime !== undefined) throw fault("CHATGPT_AUTH_BUSY");
    const epoch = ++generation;
    const assertCurrent = () => { active(); if (epoch !== generation) throw fault("CHATGPT_AUTH_CANCELLED"); };
    const operation = (async (): Promise<ChatGptSignedOut> => {
      const attempt = pending; rejectedSessionToken = undefined; planFailureToken = undefined;
      statusCheck?.controller.abort();
      for (const controller of requests) controller.abort();
      await attempt?.cancel(); if (pending === attempt) pending = undefined; assertCurrent();
      await Promise.allSettled([...accesses]); assertCurrent();
      await Promise.all([...inferenceLifetimes]); assertCurrent(); assertResourceClosure();
      return repository.withLock(async transaction => {
        assertCurrent();
        const current = transaction.read(); if (current === undefined || current.registration === null || !forget && (current.session === null || current.clientId === null)) return { state: "signed-out", remoteRevocation: "not-needed" };
        let remoteRevocation: "confirmed" | "unconfirmed" | "not-needed" = current.session?.refreshToken == null ? "not-needed" : "unconfirmed";
        try { if (current.session?.refreshToken != null && current.clientId !== null) {
          const discovered = await discovery(); assertCurrent();
          const response = await request(discovered.revocation, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: current.session.refreshToken, token_type_hint: "refresh_token", client_id: current.clientId }) });
          try {
            assertCurrent();
            if (response.status === 200 && await boundedEmptyResponse(response)) remoteRevocation = "confirmed";
          } finally { await response.body?.cancel(); }
          assertCurrent();
        }
        } catch (error) {
          retainCredentialClosure(error); assertResourceClosure(); assertCurrent(); remoteRevocation = "unconfirmed";
        }
        assertCurrent(); assertResourceClosure();
        transaction.replace({ ...current, revision: current.revision + 1, session: null, ...(forget ? { hostId: `urn:uuid:${randomUUID()}`, clientId: null, registration: null } : {}) }, current.revision);
        return { state: "signed-out", remoteRevocation };
      });
    })();
    signOutLifetime = operation;
    try { return await operation; }
    finally { if (signOutLifetime === operation) signOutLifetime = undefined; }
  }
  function needsRefresh(record: ChatGptCredentialRecord): boolean {
    return record.session !== null && (rejectedSessionToken !== undefined && privateEqual(record.session.accessToken, rejectedSessionToken)
      || Date.parse(record.session.expiresAt) <= clock.nowMs() + 60_000);
  }
  async function renewCredentials(transaction: ChatGptCredentialTransaction, assertCurrent: () => void, signal?: AbortSignal, diagnostic?: ChatGptInferenceDiagnostic): Promise<ChatGptCredentialRecord> {
    const epoch = generation;
    assertCurrent();
    let current = transaction.read();
    if (current?.session == null || current.registration === null || current.clientId === null) throw fault("CHATGPT_ACCOUNT_EXPIRED");
    if (needsRefresh(current)) {
      if (diagnostic !== undefined) diagnostic.path = "auth-refresh";
      if (current.session.refreshToken === null) throw fault("CHATGPT_ACCOUNT_EXPIRED");
      if (current.session.earliestRefreshAt !== null && clock.nowMs() / 1000 < current.session.earliestRefreshAt) throw fault("CHATGPT_ACCOUNT_EXPIRED");
      let result;
      try { result = await token(new URLSearchParams({ grant_type: "refresh_token", client_id: current.clientId, refresh_token: current.session.refreshToken, resource: RESOURCE }), current.clientId, current.session.usePlan, undefined, signal, diagnostic); }
      catch (error) {
        assertCurrent();
        if (error instanceof ChatGptAccountError && error.code === "CHATGPT_ACCOUNT_EXPIRED" && epoch === generation && !closed)
          transaction.replace({ ...current, revision: current.revision + 1, session: null }, current.revision);
        throw error;
      }
      assertCurrent();
      if (epoch !== generation || closed) throw fault("CHATGPT_OCR_CANCELLED");
      if (diagnostic !== undefined) diagnostic.path = "auth-refresh-rotation";
      if (result.session.refreshToken === null) throw fault("CHATGPT_AUTH_INVALID");
      if (diagnostic !== undefined) diagnostic.path = "auth-refresh-subject";
      if (result.registration.subject !== current.registration.subject) throw fault("CHATGPT_AUTH_INVALID");
      current = { ...current, ...result, session: { ...result.session, usage: current.session.usage }, revision: current.revision + 1 };
      transaction.replace(current, current.revision - 1);
    }
    return current;
  }
  async function access(signal: AbortSignal | undefined, expected: ChatGptAccountAuthority, assertCurrent: () => void, diagnostic?: ChatGptInferenceDiagnostic): Promise<ChatGptCredentialRecord> {
    assertCurrent();
    if (!inferenceAuthorityCurrent(expected)) throw fault("CHATGPT_OCR_CANCELLED");
    const observed = repository.read();
    assertCurrent();
    if (!inferenceAuthorityCurrent(expected)) throw fault("CHATGPT_OCR_CANCELLED");
    if (observed?.session != null && observed.registration !== null && observed.clientId !== null
      && !needsRefresh(observed)) return observed;
    const check = () => {
      assertCurrent();
      if (!inferenceAuthorityCurrent(expected)) throw fault("CHATGPT_OCR_CANCELLED");
    };
    const operation = repository.withLock(transaction => renewCredentials(transaction, check, signal, diagnostic));
    accesses.add(operation);
    try { return await operation; } finally { accesses.delete(operation); }
  }
  function refreshAccount(): Promise<ChatGptAccountState> {
    if (refreshingAccount !== undefined) return refreshingAccount;
    const epoch = generation;
    const diagnostic: ChatGptInferenceDiagnostic = { operation: "account", path: "auth-account", contentType: "missing", providerCode: "none" };
    const check = () => { active(); options.admission.assertProfileRuntime(); if (epoch !== generation || pending !== undefined || signOutLifetime !== undefined) throw fault("CHATGPT_OCR_CANCELLED"); };
    const reading = (async (): Promise<ChatGptAccountState> => {
      try {
        active(); assertResourceClosure();
        if (pending !== undefined || signOutLifetime !== undefined) return readAccount();
        const observed = repository.read();
        if (observed?.session == null || observed.session.refreshToken === null || !needsRefresh(observed)) return readAccount();
        if (observed.session.earliestRefreshAt !== null && clock.nowMs() / 1000 < observed.session.earliestRefreshAt) {
          if (Date.parse(observed.session.expiresAt) > clock.nowMs()) return readAccount();
          throw fault("CHATGPT_AUTH_UNAVAILABLE");
        }
        check();
        const operation = repository.withLock(transaction => renewCredentials(transaction, check, undefined, diagnostic));
        accesses.add(operation);
        try { await operation; } finally { accesses.delete(operation); }
        check(); assertResourceClosure();
        return readAccount();
      } catch (error) {
        try { assertResourceClosure(); }
        catch (closure) { diagnostic.path = "resource-closure"; recordFailure(closure, diagnostic); throw closure; }
        recordFailure(error, diagnostic);
        if (error instanceof ChatGptAccountError && error.code === "CHATGPT_ACCOUNT_EXPIRED") return { state: "expired" };
        throw error;
      }
    })().finally(() => { if (refreshingAccount === reading) refreshingAccount = undefined; });
    refreshingAccount = reading;
    return reading;
  }
  async function extractBoundText(operation: InferenceOperation, input: ChatGptOcrRequest, signal?: AbortSignal): Promise<{ readonly text: string; readonly model: string; readonly responseId: string }> {
    const cancelled = () => signal?.aborted === true;
    operation.assertCurrent(); if (cancelled()) throw fault("CHATGPT_OCR_CANCELLED");
    const parsed = ChatGptOcrRequestSchema.safeParse(input); if (!parsed.success) throw fault("CHATGPT_OCR_INVALID");
    const document = parsed.data.input;
    if (Buffer.from(document.base64, "base64").toString("base64") !== document.base64) throw fault("CHATGPT_OCR_INVALID");
    const content = document.kind === "image" ? { type: "input_image", image_url: `data:${document.mediaType};base64,${document.base64}`, detail: "high" }
      : { type: "input_file", filename: document.filename, file_data: `data:application/pdf;base64,${document.base64}` };
    return responseText(parsed.data.model, [{ role: "user", content: [{ type: "input_text", text: parsed.data.instruction }, content] }], result => result, signal, 4_000_000, operation);
  }
  interface InferenceOperation {
    readonly credentials: ChatGptCredentialRecord;
    readonly epoch: number;
    readonly authority: ChatGptAccountAuthority;
    assertCurrent(this: void): void;
    advance(record: ChatGptCredentialRecord): void;
    close(): void;
  }
  async function beginInference(signal?: AbortSignal, assertCurrent: () => void = () => options.admission.assertProfileRuntime(), kind: "ocr" | "assistant" | "account" = "ocr"): Promise<InferenceOperation> {
    const cancelled = () => signal?.aborted === true;
    active();
    const completion = Promise.withResolvers<void>();
    inferenceLifetimes.add(completion.promise);
    const finish = () => { inferenceLifetimes.delete(completion.promise); completion.resolve(); };
    const diagnostic: ChatGptInferenceDiagnostic = { operation: kind, path: "auth-account", contentType: "missing", providerCode: "none" };
    try {
      assertCurrent();
      if (cancelled()) throw fault("CHATGPT_OCR_CANCELLED");
      const epoch = generation, entry = repository.read();
      const before = await readAuthority();
      assertCurrent();
      if (entry === undefined || entry.session === null) throw fault("CHATGPT_ACCOUNT_EXPIRED");
      if (before.revision !== entry.revision || before.availability === "pending") throw fault("CHATGPT_OCR_CANCELLED");
      if (cancelled() || epoch !== generation || !inferenceAuthorityCurrent(before)) throw fault("CHATGPT_OCR_CANCELLED");
      const credentials = await access(signal, before, assertCurrent, diagnostic), session = credentials.session;
      assertCurrent();
      if (session === null || !session.usePlan || !PLAN_SCOPES.every(scope => session.scopes.includes(scope))) throw fault("CHATGPT_PLAN_DISABLED");
      let authority = await inferenceAuthority(credentials, epoch), live = true;
      const operation: InferenceOperation = {
        credentials, epoch,
        get authority() { return authority; },
        assertCurrent() {
          active(); assertCurrent();
          if (!live || signal?.aborted === true || epoch !== generation || !inferenceAuthorityCurrent(authority)) throw fault("CHATGPT_OCR_CANCELLED");
        },
        advance(record) {
          const state = publicState(record, clock.nowMs());
          authority = Object.freeze({ revision: record.revision, attemptGeneration: epoch,
            availability: state.state === "connected" ? state.planUsage === "enabled" ? "available" : state.planUsage === "disabled" ? "disabled" : "limit-reached" : state.state });
          authorityViews.add(authority);
        },
        close() { live = false; finish(); },
      };
      operation.assertCurrent();
      return operation;
    } catch (error) { finish(); recordFailure(error, diagnostic); throw error; }
  }
  async function withOcrOperation<T>(readPage: (operation: Readonly<{
    assertCurrent(this: void): void;
    extractText(input: ChatGptOcrRequest, signal?: AbortSignal): Promise<{ readonly text: string; readonly model: string; readonly responseId: string }>;
  }>) => Promise<T>, signal?: AbortSignal, assertCurrent?: () => void): Promise<T> {
    const operation = await beginInference(signal, assertCurrent);
    let used = false;
    try {
      operation.assertCurrent();
      const result = await readPage(Object.freeze({ assertCurrent: operation.assertCurrent,
        extractText: (input: ChatGptOcrRequest, requestSignal?: AbortSignal) => {
          operation.assertCurrent();
          if (used) throw fault("CHATGPT_OCR_CANCELLED");
          used = true;
          return extractBoundText(operation, input, requestSignal ?? signal);
        } }));
      operation.assertCurrent();
      return result;
    } catch (error) {
      if (error instanceof ChatGptResourceClosureUnprovedError) retainResourceClosure(error, operation);
      throw error;
    } finally { operation.close(); }
  }
  async function extractText(input: ChatGptOcrRequest, signal?: AbortSignal) {
    active();
    if (signal?.aborted === true) throw fault("CHATGPT_OCR_CANCELLED");
    if (!ChatGptOcrRequestSchema.safeParse(input).success || Buffer.from(input.input.base64, "base64").toString("base64") !== input.input.base64) throw fault("CHATGPT_OCR_INVALID");
    return withOcrOperation(operation => operation.extractText(input, signal), signal);
  }
  async function persistPlanUsage(operation: InferenceOperation, usage: "available" | "limit-reached" | "unavailable") {
    operation.assertCurrent();
    const observed = repository.read();
    operation.assertCurrent();
    if (observed?.session?.usage === usage && !(usage === "available" && planFailureToken !== undefined
      && operation.credentials.session !== null && privateEqual(operation.credentials.session.accessToken, planFailureToken))) return;
    await repository.withLock(async transaction => {
      operation.assertCurrent();
      const current = transaction.read();
      if (current?.session == null || operation.credentials.session === null || current.clientId !== operation.credentials.clientId
        || !privateEqual(current.session.accessToken, operation.credentials.session.accessToken)) throw fault("CHATGPT_OCR_CANCELLED");
      let next = current;
      if (current.session.usage !== usage) {
        next = { ...current, revision: current.revision + 1, session: { ...current.session, usage } };
        transaction.replace(next, current.revision);
      }
      const clearFailure = usage === "available" && planFailureToken !== undefined && privateEqual(operation.credentials.session.accessToken, planFailureToken);
      if (clearFailure) planFailureToken = undefined;
      if (next !== current || clearFailure) operation.advance(next);
      operation.assertCurrent();
    });
    operation.assertCurrent();
  }
  async function rejectProviderCode(code: string | undefined, operation: InferenceOperation): Promise<void> {
    if (code === "subscription_sharing_usage_limit_exceeded") { await persistPlanUsage(operation, "limit-reached"); throw fault("CHATGPT_USAGE_LIMIT"); }
    if (code === "subscription_sharing_usage_unavailable") { await persistPlanUsage(operation, "unavailable"); throw fault("CHATGPT_USAGE_UNAVAILABLE"); }
    if (code === "model_not_found") throw fault("CHATGPT_MODEL_UNAVAILABLE");
    if (code === "rate_limit_exceeded") throw fault("CHATGPT_RATE_LIMITED");
    if (code === "insufficient_quota") throw fault("CHATGPT_USAGE_LIMIT");
    if (code !== undefined && ["subscription_sharing_unsupported_capability", "subscription_sharing_route_not_supported", "invalid_request_error",
      "unsupported_value", "unsupported_parameter", "missing_required_parameter", "invalid_value", "invalid_type"].includes(code)) throw fault("CHATGPT_REQUEST_REJECTED");
  }
  function recordProviderCode(diagnostic: ChatGptInferenceDiagnostic, code: string | undefined): void {
    const parsed = ChatGptInferenceDiagnosticSchema.shape.providerCode.exclude(["none", "unknown"]).safeParse(code);
    diagnostic.providerCode = code === undefined ? "none" : parsed.success ? parsed.data : "unknown";
  }
  async function rejectPlanResponse(response: Response, operation: InferenceOperation, diagnostic?: ChatGptInferenceDiagnostic, failureCode: ChatGptAccountCode = "CHATGPT_OCR_FAILED"): Promise<never> {
    operation.assertCurrent();
    const invokedAccessToken = operation.credentials.session?.accessToken;
    if (invokedAccessToken === undefined) throw fault("CHATGPT_PLAN_DISABLED");
    let code: string | undefined;
    if (diagnostic !== undefined) diagnostic.path = "http-error-body";
    try {
      const body = z.object({ detail: z.union([z.string(), z.object({ code: z.string().nullish() })]).optional(), error: z.object({ code: z.string().nullish() }).nullish() })
        .parse(await boundedJson(new Response(response.body, { status: 200 })));
      code = body.error?.code ?? (typeof body.detail === "object" ? body.detail.code : undefined) ?? undefined;
    } catch (error) {
      if (error instanceof ChatGptResourceClosureUnprovedError) throw error;
      operation.assertCurrent(); throw fault(failureCode);
    }
    operation.assertCurrent();
    if (diagnostic !== undefined) { diagnostic.path = "http-error"; recordProviderCode(diagnostic, code); }
    await rejectProviderCode(code, operation);
    if (response.status === 401) { rejectedSessionToken = invokedAccessToken; throw fault("CHATGPT_ACCOUNT_EXPIRED"); }
    if (response.status === 403 && (code === undefined || ["subscription_sharing_user_not_eligible", "chatpass_v2_scope_not_authorized", "chatpass_v2_invalid_authorization_context"].includes(code))) {
      planFailureToken = invokedAccessToken; throw fault("CHATGPT_PLAN_DISABLED");
    }
    if (response.status === 503) throw fault("CHATGPT_USAGE_UNAVAILABLE");
    if (response.status === 400 || response.status === 422) throw fault("CHATGPT_REQUEST_REJECTED");
    throw fault(failureCode);
  }
  async function inferenceAuthority(credentials: ChatGptCredentialRecord, epoch: number): Promise<ChatGptAccountAuthority> {
    const authority = await readAuthority(), current = repository.read();
    if (epoch !== generation || closed || !["available", "limit-reached", "unavailable"].includes(authority.availability) || current?.session == null || credentials.session === null
      || current.revision !== credentials.revision || current.clientId !== credentials.clientId || !privateEqual(current.session.accessToken, credentials.session.accessToken)) throw fault("CHATGPT_OCR_CANCELLED");
    return authority;
  }
  function inferenceAuthorityCurrent(authority: ChatGptAccountAuthority): boolean {
    if (!authorityViews.has(authority)) return false;
    const current = currentAuthority(options.admission);
    return current.revision === authority.revision && current.attemptGeneration === authority.attemptGeneration && current.availability === authority.availability;
  }
  async function consumeInferenceResponse<T>(response: Response, consume: () => Promise<T>): Promise<T> {
    let outcome: { readonly kind: "value"; readonly value: T } | { readonly kind: "error"; readonly error: unknown };
    try { outcome = { kind: "value", value: await consume() }; }
    catch (error) { outcome = { kind: "error", error }; }
    try {
      if (response.body?.locked === true) throw new Error("ChatGPT response reader remains owned");
      await response.body?.cancel();
    } catch (cause) {
      // The transport emits cancellation only after its reader closes.
      if (outcome.kind === "error" && outcome.error === cause
        && cause instanceof ChatGptAccountError && cause.code === "CHATGPT_OCR_CANCELLED") throw cause;
      const error = new ChatGptResourceClosureUnprovedError(outcome.kind === "value" ? cause
        : new AggregateError([outcome.error, cause], "ChatGPT response and closure failed"));
      retainResourceClosure(error, response); outcome = { kind: "error", error };
    }
    if (outcome.kind === "error") throw outcome.error;
    return outcome.value;
  }
  async function readModelCatalog(operation: InferenceOperation, signal?: AbortSignal, purpose: "assistant" | "account" = "assistant") {
    const failureCode = purpose === "account" ? "CHATGPT_CONNECTION_FAILED" : "CHATGPT_MODELS_UNAVAILABLE";
    const diagnostic: ChatGptInferenceDiagnostic = { operation: purpose, path: "catalog-request", contentType: "missing", providerCode: "none" };
    try {
      operation.assertCurrent();
      const session = operation.credentials.session;
      if (session === null) throw fault("CHATGPT_PLAN_DISABLED");
      const response = await request(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${session.accessToken}` } }, signal, diagnostic);
      return await consumeInferenceResponse(response, async () => {
        operation.assertCurrent();
        if (!response.ok) await rejectPlanResponse(response, operation, diagnostic, purpose === "account" ? failureCode : "CHATGPT_OCR_FAILED");
        diagnostic.path = "catalog-body";
        const body = await boundedJson(response, diagnostic, failureCode, MODEL_CATALOG_MAX_BYTES);
        diagnostic.path = "catalog-schema";
        const parsed = z.object({ models: z.array(z.object({ slug: AssistantInferenceRequestSchema.shape.model,
          display_name: z.string().min(1).max(256), visibility: z.string().min(1).max(64) })).max(256) }).safeParse(body);
        if (!parsed.success) throw fault(failureCode);
        const catalog = parsed.data;
        operation.assertCurrent();
        const visible = AssistantModelCatalogSchema.safeParse({ models: catalog.models.filter(model => model.visibility === "list")
          .map(model => ({ slug: model.slug, displayName: model.display_name })) });
        if (!visible.success) throw fault(failureCode);
        return visible.data;
      });
    } catch (error) { if (error instanceof ChatGptResourceClosureUnprovedError) diagnostic.path = "resource-closure"; recordFailure(error, diagnostic, { method: "GET", route: "/v1/models" }); throw error; }
  }
  async function checkedConnection(signal?: AbortSignal, entryAuthority?: ChatGptAccountAuthority) {
    let operation: InferenceOperation | undefined, authority = entryAuthority;
    try {
      assertResourceClosure();
      operation = await beginInference(signal, undefined, "account");
      authority = operation.authority;
      await readModelCatalog(operation, signal, "account");
      assertResourceClosure();
      operation.assertCurrent();
      authority = operation.authority;
      return { state: "completed" as const, checkedAt: IsoInstantSchema.parse(clock.now().toISOString()), authority };
    } catch (error) {
      authority = operation?.authority ?? authority;
      return { state: "failed" as const, error: error instanceof ChatGptAccountError && error.code === "CHATGPT_OCR_CANCELLED"
        ? fault("CHATGPT_CONNECTION_CANCELLED") : error, authority };
    } finally { operation?.close(); }
  }
  async function checkConnection(signal?: AbortSignal): Promise<{ readonly checkedAt: string }> {
    const result = await checkedConnection(signal);
    if (result.state === "failed") throw result.error;
    return Object.freeze({ checkedAt: result.checkedAt });
  }
  const statusKey = (authority: ChatGptAccountAuthority): string => JSON.stringify([authority.revision, authority.attemptGeneration, authority.availability]);
  let cachedStatus: { key: string; value: ChatGptAccountStatus } | undefined;
  interface StatusCheck {
    readonly key: string;
    readonly controller: AbortController;
    readonly result: Promise<ChatGptAccountStatus>;
    readers: number;
  }
  let statusCheck: StatusCheck | undefined;
  function statusAuthority(): ChatGptAccountAuthority {
    active(); options.admission.assertProfileRuntime(); assertResourceClosure();
    return currentAuthority(options.admission);
  }
  async function readStatus(signal?: AbortSignal): Promise<ChatGptAccountStatus> {
    const isCancelled = () => signal?.aborted === true;
    if (isCancelled()) throw fault("CHATGPT_CONNECTION_CANCELLED");
    const before = statusAuthority(), key = statusKey(before);
    const age = cachedStatus === undefined ? NaN : clock.nowMs() - Date.parse(cachedStatus.value.connection.checkedAt);
    if (cachedStatus?.key === key && Number.isFinite(age) && age >= 0 && age <= 300_000) return ChatGptAccountStatusSchema.parse(cachedStatus.value);
    let shared = statusCheck;
    if (shared === undefined || shared.key !== key || shared.controller.signal.aborted) {
      const controller = new AbortController();
      const check: StatusCheck = { key, controller, readers: 0, result: (async (): Promise<ChatGptAccountStatus> => {
        let connection: ChatGptAccountStatus["connection"];
        const checked = before.availability === "pending"
          ? { state: "failed" as const, error: fault("CHATGPT_AUTH_BUSY"), authority: before }
          : await checkedConnection(controller.signal, before);
        const settled = checked.authority;
        if (checked.state === "completed") {
          connection = { state: "completed", checkedAt: checked.checkedAt, failureCode: null };
        } else {
          const error = checked.error;
          if (controller.signal.aborted || error instanceof ChatGptAccountError && ["CHATGPT_CONNECTION_CANCELLED", "CHATGPT_OCR_CANCELLED"].includes(error.code)) throw fault("CHATGPT_CONNECTION_CANCELLED");
          const known = error instanceof ChatGptAccountError || error instanceof ChatGptCredentialError;
          const code = known ? error.code : "CHATGPT_CONNECTION_FAILED";
          connection = ChatGptAccountStatusSchema.shape.connection.parse({ state: !known || code === "CHATGPT_CREDENTIAL_UNCERTAIN" || code === "CHATGPT_RESOURCE_CLOSURE_UNPROVED" ? "uncertain" : "refused",
            checkedAt: clock.now().toISOString(), failureCode: code });
        }
        const current = statusAuthority();
        if (controller.signal.aborted || settled === undefined || current.attemptGeneration !== before.attemptGeneration
          || current.revision !== settled.revision || current.attemptGeneration !== settled.attemptGeneration) throw fault("CHATGPT_CONNECTION_CANCELLED");
        const rejectedAvailability = checked.state === "failed" && checked.error instanceof ChatGptAccountError
          && (checked.error.code === "CHATGPT_ACCOUNT_EXPIRED" && current.availability === "expired"
            || checked.error.code === "CHATGPT_PLAN_DISABLED" && current.availability === "unavailable");
        if (statusKey(current) !== statusKey(settled) && !rejectedAvailability) throw fault("CHATGPT_CONNECTION_CANCELLED");
        const availability = current.availability;
        const usage: ChatGptAccountStatus["usage"] = availability === "available" || availability === "limit-reached"
          ? { state: availability, resetAt: null } : { state: "unavailable", reason: availability };
        const account = connection.state !== "completed" && ["CHATGPT_AUTH_UNAVAILABLE", "CHATGPT_AUTH_INVALID", "CHATGPT_CREDENTIAL_UNAVAILABLE", "CHATGPT_CREDENTIAL_UNCERTAIN"].includes(connection.failureCode)
          ? { state: "unavailable", code: connection.failureCode, message: ERROR_CATALOG[connection.failureCode].text } : readAccount();
        const value = ChatGptAccountStatusSchema.parse({ account, connection, usage });
        cachedStatus = { key: statusKey(current), value };
        return value;
      })() };
      statusCheck = check;
      const clearCheck = () => { if (statusCheck === check) statusCheck = undefined; };
      void check.result.then(clearCheck, clearCheck);
      shared = check;
    }
    shared.readers++;
    let abort: () => void = () => undefined;
    const cancelled = new Promise<never>((_, reject) => { abort = () => reject(fault("CHATGPT_CONNECTION_CANCELLED")); });
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (isCancelled()) abort();
      const result = await Promise.race([shared.result, cancelled]);
      if (isCancelled()) throw fault("CHATGPT_CONNECTION_CANCELLED");
      const current = statusAuthority();
      if (cachedStatus?.value !== result || cachedStatus.key !== statusKey(current)) throw fault("CHATGPT_CONNECTION_CANCELLED");
      return ChatGptAccountStatusSchema.parse(result);
    } finally {
      signal?.removeEventListener("abort", abort);
      if (--shared.readers === 0) shared.controller.abort();
    }
  }
  async function listAssistantModels(signal?: AbortSignal) {
    const cancelled = () => signal?.aborted === true;
    active();
    if (cancelled()) throw fault("CHATGPT_OCR_CANCELLED");
    const operation = await beginInference(signal, undefined, "assistant");
    try {
      const session = operation.credentials.session;
      if (session === null) throw fault("CHATGPT_PLAN_DISABLED");
      const authority = await inferenceAuthority(operation.credentials, operation.epoch);
      if (!revalidateAuthority(authority)) throw fault(authority.availability === "limit-reached" ? "CHATGPT_USAGE_LIMIT" : "CHATGPT_USAGE_UNAVAILABLE");
      const catalog = await readModelCatalog(operation, signal);
      operation.assertCurrent();
      return Object.freeze({ catalog, authority });
    } finally { operation.close(); }
  }
  async function inferBoundAssistant(input: AssistantInferenceRequest, signal?: AbortSignal, operation?: InferenceOperation) {
    active();
    const parsed = AssistantInferenceRequestSchema.safeParse(input);
    if (!parsed.success) throw fault("CHATGPT_OCR_INVALID");
    // Attachment Base64 is exempt from the 160,000-byte structure budget; it has its own decoded-media and whole-request bounds.
    const media = assistantInputMedia(parsed.data.input), bytes = Buffer.byteLength(JSON.stringify(parsed.data));
    if (bytes - media.base64Chars > 160_000 || bytes > ASSISTANT_REQUEST_MAX_BYTES || media.bytes > ASSISTANT_CONTEXT_MEDIA_MAX_BYTES
      || !parsed.data.input.every(canonicalMedia)) throw fault("CHATGPT_OCR_INVALID");
    return responseStream(parsed.data.model, parsed.data.input, (terminal, text, textOutputIndex, argumentDeltas) => {
      const providerUsage = z.object({ input_tokens: z.unknown(), output_tokens: z.unknown(), total_tokens: z.unknown() }).safeParse(terminal.usage);
      const measured = providerUsage.success ? AssistantCallUsageSchema.safeParse({ state: "measured", inputTokens: providerUsage.data.input_tokens,
        outputTokens: providerUsage.data.output_tokens, totalTokens: providerUsage.data.total_tokens }) : undefined;
      const usage = measured?.success ? measured.data : { state: "unavailable", reason: terminal.usage === undefined || terminal.usage === null ? "missing" : "invalid" };
      const result = AssistantInferenceResultSchema.parse({ responseId: terminal.id, model: terminal.model, output: terminal.output, usage });
      if (result.model !== parsed.data.model) throw fault("CHATGPT_OCR_INCOMPLETE");
      const calls = result.output.filter(item => item.type === "function_call"), messages = result.output.filter(item => item.type === "message");
      if (calls.length > 1 || messages.length > 1 || calls.length === 1 && messages.length !== 0 || calls.length === 0 && messages.length !== 1) throw fault("CHATGPT_OCR_INCOMPLETE");
      const message = messages[0], content = message?.content.map(part => part.text).join("") ?? "";
      if (text !== "" && text !== content || textOutputIndex !== undefined && (message === undefined || result.output.indexOf(message) !== textOutputIndex)) throw fault("CHATGPT_OCR_INCOMPLETE");
      for (const call of calls) {
        const namespace = parsed.data.tools.find(tool => tool.name === call.namespace);
        if (namespace?.tools.filter(tool => tool.name === call.name).length !== 1) throw fault("CHATGPT_OCR_INCOMPLETE");
        const argumentsValue: unknown = JSON.parse(call.arguments);
        if (argumentsValue === null || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) throw fault("CHATGPT_OCR_INCOMPLETE");
      }
      for (const [index, delta] of argumentDeltas) {
        const item = result.output[index];
        if (item?.type !== "function_call" || item.arguments !== delta) throw fault("CHATGPT_OCR_INCOMPLETE");
      }
      return result;
    }, signal, 160_000, { reasoning: parsed.data.reasoning, tools: parsed.data.tools, parallel_tool_calls: false, include: ["reasoning.encrypted_content"] }, operation);
  }
  /** `assertCurrent` fences every credential await, the provider POST and each stream chunk; this caller owns the operation's close. */
  async function inferAssistant(input: AssistantInferenceRequest, signal?: AbortSignal, assertCurrent: () => void = () => {}) {
    const operation = await beginInference(signal, () => { options.admission.assertProfileRuntime(); assertCurrent(); }, "assistant");
    try { return await inferBoundAssistant(input, signal, operation); }
    finally { operation.close(); }
  }
  function assertAssistantCurrent(check: () => true): void {
    const current: unknown = check();
    if (current instanceof Promise) void current.catch(() => {});
    if (current !== true) throw fault('CHATGPT_ASSISTANT_REFUSED');
  }
  async function prepareAssistantModelPreference(input: AssistantModelPreference, check: () => true, signal?: AbortSignal): Promise<() => true> {
    active();
    const choice = Object.freeze(AssistantModelPreferenceSchema.parse(input));
    const assertSelectionCurrent = (): true => {
      assertAssistantCurrent(check);
      if (signal?.aborted === true) throw fault("CHATGPT_OCR_CANCELLED");
      return true;
    };
    assertSelectionCurrent();
    if (closureFailures.size !== 0) throw new ChatGptResourceClosureUnprovedError(new AggregateError([...closureFailures.keys()], 'chatgpt-assistant-resource-closure-unproved'));
    const operation = await beginInference(signal, assertSelectionCurrent, "assistant");
    let authority: ChatGptAccountAuthority;
    try {
      const catalog = await readModelCatalog(operation, signal);
      operation.assertCurrent();
      if (!catalog.models.some(model => model.slug === choice.slug)) throw fault('CHATGPT_ASSISTANT_REFUSED');
      authority = await inferenceAuthority(operation.credentials, operation.epoch);
      operation.assertCurrent();
    } finally { operation.close(); }
    const assertPreparedCurrent = (): true => {
      active(); assertSelectionCurrent();
      if (closureFailures.size !== 0) throw new ChatGptResourceClosureUnprovedError(new AggregateError([...closureFailures.keys()], 'chatgpt-assistant-resource-closure-unproved'));
      if (!inferenceAuthorityCurrent(authority)) throw fault("CHATGPT_OCR_CANCELLED");
      return true;
    };
    assertPreparedCurrent();
    return assertPreparedCurrent;
  }
  async function responseText<T>(model: string, input: readonly unknown[], accept: (result: { readonly text: string; readonly model: string; readonly responseId: string }) => T,
    signal?: AbortSignal, streamLimit = 4_000_000, operation?: InferenceOperation): Promise<T> {
    return responseStream(model, input, (terminal, output, textOutputIndex, argumentDeltas) => {
      const parsed = z.object({ output: z.array(z.discriminatedUnion("type", [
        z.object({ type: z.literal("reasoning"), id: z.string().min(1), status: z.literal("completed").optional(),
          summary: z.array(z.object({ type: z.literal("summary_text"), text: z.string() })) }),
        z.object({ type: z.literal("message"), role: z.literal("assistant"), status: z.literal("completed"),
          content: z.tuple([z.object({ type: z.literal("output_text"), text: z.string().min(1) })]) }),
      ])).min(1).max(32) }).parse(terminal);
      const messages = parsed.output.filter(item => item.type === "message");
      if (messages.length !== 1 || argumentDeltas.size !== 0) throw fault("CHATGPT_OCR_INCOMPLETE");
      const message = messages[0], text = message.content[0].text;
      if (output !== "" && output !== text || textOutputIndex !== undefined && parsed.output.indexOf(message) !== textOutputIndex) throw fault("CHATGPT_OCR_INCOMPLETE");
      return accept({ text, model: terminal.model, responseId: terminal.id });
    }, signal, streamLimit, undefined, operation);
  }
  async function responseStream<T>(model: string, input: readonly unknown[],
    accept: (terminal: { id: string; model: string; output: unknown[]; usage?: unknown }, text: string, textOutputIndex: number | undefined, argumentDeltas: ReadonlyMap<number, string>) => T,
    signal: AbortSignal | undefined, streamLimit: number,
    assistant?: Readonly<{ reasoning: AssistantInferenceRequest["reasoning"]; tools: AssistantInferenceRequest["tools"]; parallel_tool_calls: false; include: readonly ["reasoning.encrypted_content"] }>, capturedOperation?: InferenceOperation): Promise<T> {
    const cancelled = () => signal?.aborted === true;
    active(); if (cancelled()) throw fault("CHATGPT_OCR_CANCELLED");
    const operation = capturedOperation ?? await beginInference(signal, undefined, assistant === undefined ? "ocr" : "assistant");
    const diagnostic: ChatGptInferenceDiagnostic = { operation: assistant === undefined ? "ocr" : "assistant", path: "transport", contentType: "missing", providerCode: "none" };
    // After the POST only a provider refusal or terminal event is a definite outcome; any other failure leaves delivery uncertain.
    let posted = false, definite = false;
    try {
      operation.assertCurrent();
      const { credentials, epoch } = operation, session = credentials.session;
      if (session === null) throw fault("CHATGPT_PLAN_DISABLED");
      const persistUsage = (usage: "available" | "limit-reached" | "unavailable") => persistPlanUsage(operation, usage);
      posted = true;
      const response = await request(`${RESOURCE}/responses`, { method: "POST", headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, store: false, stream: true, input, ...assistant }) }, signal, diagnostic);
      diagnostic.contentType = inferenceContentType(response.headers);
      diagnostic.hasBody = response.body !== null;
      return await consumeInferenceResponse(response, async () => {
        operation.assertCurrent();
        if (!response.ok) { definite = true; await rejectPlanResponse(response, operation, diagnostic); }
        diagnostic.path = "content-type";
        // Headerless subscription replies still require validated SSE and completed output below.
        if (response.body === null || diagnostic.contentType !== "text/event-stream" && diagnostic.contentType !== "missing") { await response.body?.cancel(); throw fault("CHATGPT_OCR_FAILED"); }
        const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
        let buffer = "", completed = false, total = 0;
        const textDeltas = new Map<string, string>();
        let textOutputIndex: number | undefined;
        let result: T | undefined;
        const argumentDeltas = new Map<number, string>();
        const indexSchema = z.number().int().min(0).max(31), idSchema = z.string().min(1).max(256);
        const itemSchema = z.object({ id: idSchema, type: z.enum(["message", "reasoning", "function_call"]), status: z.literal("completed").optional() }).passthrough();
        const addedItemSchema = itemSchema.omit({ status: true });
        const addedItems = new Map<number, z.infer<typeof addedItemSchema>>();
        const doneItems = new Map<number, z.infer<typeof itemSchema>>();
        const addedParts = new Map<string, string>();
        const doneText = new Map<string, { item_id: string; output_index: number; content_index: number; text: string }>();
        const doneArguments = new Map<number, { item_id: string; name?: string; arguments: string }>();
        const doneParts = new Map<string, { output_index: number; content_index: number; part: unknown }>();
        let responseIdentity: { id: string; model: string } | undefined;
        const assertMember = (index: number, id: string, type?: string): void => {
          const added = addedItems.get(index);
          if (added?.id !== id || type !== undefined && added.type !== type || doneItems.has(index)) throw fault("CHATGPT_OCR_INCOMPLETE");
        };
        let outcome: { readonly kind: "value"; readonly value: T } | { readonly kind: "error"; readonly error: unknown };
        try {
          for (;;) {
            diagnostic.path = "stream-read";
            const chunk = await reader.read(); if (chunk.done) break;
            operation.assertCurrent();
            if (cancelled()) throw fault("CHATGPT_OCR_CANCELLED");
            diagnostic.path = "stream-incomplete";
            total += chunk.value.length; if (total > streamLimit) throw fault("CHATGPT_OCR_INCOMPLETE");
            diagnostic.path = "stream-decode";
            buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/gu, "\n");
            let end = buffer.indexOf("\n\n");
            while (end !== -1) {
              const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
              const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
              if (data !== "" && data !== "[DONE]") {
                diagnostic.path = "stream-json";
                const value: unknown = JSON.parse(data);
                const events = diagnostic.events ??= { types: [], truncated: false };
                const eventType = ChatGptStreamEventTypeSchema.safeParse(typeof value === "object" && value !== null && "type" in value ? value.type : undefined);
                if (events.types.length < 256) events.types.push(eventType.success ? eventType.data : "unknown");
                else events.truncated = true;
                if (eventType.success && eventType.data === "response.completed") diagnostic.terminalShape = inferenceTerminalShape(value);
                diagnostic.path = "stream-schema";
                const event = z.object({ type: z.string(), delta: z.string().optional(), output_index: z.number().optional(), content_index: z.number().optional(),
                  code: z.string().nullish(), error: z.object({ code: z.string().nullish() }).nullish(),
                  response: z.object({ error: z.object({ code: z.string().nullish() }).nullish() }).passthrough().optional() }).parse(value);
                diagnostic.path = "stream-incomplete";
                if (completed) throw fault("CHATGPT_OCR_INCOMPLETE");
                const failureCode = event.response?.error?.code ?? event.error?.code ?? event.code ?? undefined;
                if (event.type === "error" || event.type === "response.failed" || event.type === "response.incomplete") {
                  definite = true;
                  diagnostic.path = event.type === "error" ? "stream-error" : event.type === "response.failed" ? "response-failed" : "response-incomplete";
                  recordProviderCode(diagnostic, failureCode);
                  await rejectProviderCode(failureCode, operation);
                }
                if (event.type.includes("refusal")) diagnostic.path = "stream-refusal";
                if (event.type === "error" || event.type.includes("refusal")) throw fault(assistant !== undefined && event.type.includes("refusal") ? "CHATGPT_ASSISTANT_REFUSED" : "CHATGPT_OCR_FAILED");
                if (event.type === "response.created" || event.type === "response.in_progress") {
                  diagnostic.path = "stream-schema";
                  const identity = z.object({ id: idSchema, model: ChatGptOcrRequestSchema.shape.model }).parse(event.response);
                  if (responseIdentity !== undefined && (identity.id !== responseIdentity.id || identity.model !== responseIdentity.model)) throw fault("CHATGPT_OCR_INCOMPLETE");
                  responseIdentity = identity;
                }
                if (event.type === "response.output_item.added") {
                  diagnostic.path = "stream-done";
                  const added = z.object({ output_index: indexSchema, item: addedItemSchema }).parse(value);
                  if (added.output_index !== addedItems.size || [...addedItems.values()].some(item => item.id === added.item.id)) throw fault("CHATGPT_OCR_INCOMPLETE");
                  addedItems.set(added.output_index, added.item);
                }
                if (event.type === "response.content_part.added") {
                  diagnostic.path = "stream-done";
                  const added = z.object({ output_index: indexSchema, item_id: idSchema, content_index: z.number().int().min(0).max(7), part: z.object({ type: z.string() }) }).parse(value);
                  assertMember(added.output_index, added.item_id, "message");
                  const key = `${added.output_index}:${added.content_index}`;
                  if (addedParts.has(key) || added.content_index > 0 && !addedParts.has(`${added.output_index}:${added.content_index - 1}`)) throw fault("CHATGPT_OCR_INCOMPLETE");
                  addedParts.set(key, added.part.type);
                }
                if (event.type === "response.output_text.delta") {
                  diagnostic.path = "stream-delta";
                  const delta = z.object({ output_index: indexSchema, item_id: idSchema, content_index: z.number().int().min(0).max(7), delta: z.string() }).parse(value);
                  assertMember(delta.output_index, delta.item_id, "message");
                  const key = `${delta.output_index}:${delta.content_index}`;
                  if (addedParts.get(key) !== "output_text" || doneText.has(key) || doneParts.has(key)
                    || textOutputIndex !== undefined && delta.output_index !== textOutputIndex) throw fault("CHATGPT_OCR_INCOMPLETE");
                  textOutputIndex ??= delta.output_index;
                  textDeltas.set(key, (textDeltas.get(key) ?? "") + delta.delta);
                }
                if (event.type === "response.function_call_arguments.delta") {
                  diagnostic.path = "stream-delta";
                  const delta = z.object({ output_index: indexSchema, item_id: idSchema }).parse(value);
                  assertMember(delta.output_index, delta.item_id, "function_call");
                  if (doneArguments.has(delta.output_index)) throw fault("CHATGPT_OCR_INCOMPLETE");
                  if (assistant === undefined || event.delta === undefined || event.output_index === undefined || !Number.isInteger(event.output_index) || event.output_index < 0 || event.output_index >= 32) throw fault("CHATGPT_OCR_INCOMPLETE");
                  argumentDeltas.set(event.output_index, (argumentDeltas.get(event.output_index) ?? "") + event.delta);
                }
                if (event.type === "response.output_text.done" || event.type === "response.content_part.done") {
                  diagnostic.path = "stream-done";
                  const done = z.object({ output_index: indexSchema, item_id: idSchema, content_index: z.number().int().min(0).max(7) }).parse(value);
                  assertMember(done.output_index, done.item_id, "message");
                  const key = `${done.output_index}:${done.content_index}`;
                  if (!addedParts.has(key)) throw fault("CHATGPT_OCR_INCOMPLETE");
                  if (event.type === "response.output_text.done") {
                    const text = z.object({ text: z.string().min(1) }).parse(value);
                    if (doneText.has(key)) throw fault("CHATGPT_OCR_INCOMPLETE");
                    doneText.set(key, { ...done, text: text.text });
                  } else {
                    const part = z.object({ part: z.unknown().refine(value => value !== undefined) }).parse(value);
                    if (doneParts.has(key)) throw fault("CHATGPT_OCR_INCOMPLETE");
                    doneParts.set(key, { ...done, part: part.part });
                  }
                }
                if (event.type === "response.function_call_arguments.done") {
                  diagnostic.path = "stream-done";
                  const done = z.object({ output_index: indexSchema, item_id: idSchema, name: z.string().min(1).max(64).optional(), arguments: z.string().max(32_000) }).parse(value);
                  assertMember(done.output_index, done.item_id, "function_call");
                  if (doneArguments.has(done.output_index)) throw fault("CHATGPT_OCR_INCOMPLETE");
                  doneArguments.set(done.output_index, done);
                }
                if (event.type === "response.output_item.done") {
                  diagnostic.path = "stream-done";
                  const done = z.object({ output_index: indexSchema, item: itemSchema }).parse(value);
                  assertMember(done.output_index, done.item.id, done.item.type);
                  const added = addedItems.get(done.output_index);
                  for (const key of ["role", "call_id", "namespace", "name"]) if (added?.[key] !== undefined && added[key] !== done.item[key]) throw fault("CHATGPT_OCR_INCOMPLETE");
                  doneItems.set(done.output_index, done.item);
                }
                if (event.type === "response.completed") {
                  definite = true;
                  diagnostic.path = "terminal-schema";
                  const parsedTerminal = z.object({ id: z.string().min(1).max(256), model: ChatGptOcrRequestSchema.shape.model,
                    status: z.literal("completed").optional(), error: z.null().optional(), incomplete_details: z.null().optional(), output: z.array(z.unknown()).max(32), usage: z.unknown().optional(),
                  }).safeParse(event.response);
                  if (!parsedTerminal.success) {
                    diagnostic.terminalIssues = { issues: parsedTerminal.error.issues.slice(0, 16).map(issue => ({ path: [inferenceShapeKey("response"), ...issue.path.map(inferenceShapeKey)].slice(0, 8), code: issue.code })),
                      truncated: parsedTerminal.error.issues.length > 16 || parsedTerminal.error.issues.some(issue => issue.path.length > 7) };
                    throw fault("CHATGPT_OCR_INCOMPLETE");
                  }
                  diagnostic.path = "output-schema";
                  const items = [...doneItems.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
                  if (items.length === 0 || doneItems.size !== addedItems.size || doneParts.size !== addedParts.size || items.some((_, index) => !doneItems.has(index))
                    || parsedTerminal.data.model !== model || responseIdentity !== undefined && (responseIdentity.id !== parsedTerminal.data.id || responseIdentity.model !== parsedTerminal.data.model)
                    || parsedTerminal.data.output.length > 0 && canonicalJsonStringify(parsedTerminal.data.output) !== canonicalJsonStringify(items)) throw fault("CHATGPT_OCR_INCOMPLETE");
                  const terminal = { ...parsedTerminal.data, output: items };
                  if (assistant !== undefined && terminal.output.some(item => "content" in item && Array.isArray(item.content)
                    && item.content.some((part: unknown) => typeof part === "object" && part !== null && "type" in part && part.type === "refusal"))) {
                    diagnostic.path = "stream-refusal"; throw fault("CHATGPT_ASSISTANT_REFUSED");
                  }
                  for (const [index, item] of doneItems) {
                    if (item.type === "message") {
                      const message = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).min(1).max(8) }).parse(item);
                      for (const [contentIndex, part] of message.content.entries()) {
                        const key = `${index}:${contentIndex}`, done = doneText.get(key);
                        if (addedParts.get(key) !== part.type) throw fault("CHATGPT_OCR_INCOMPLETE");
                        if (part.type === "output_text" && (done?.item_id !== item.id || done.text !== part.text
                          || textDeltas.has(key) && textDeltas.get(key) !== part.text)) throw fault("CHATGPT_OCR_INCOMPLETE");
                      }
                    }
                    if (item.type === "function_call") {
                      const done = doneArguments.get(index);
                      if (done?.item_id !== item.id || done.name !== undefined && done.name !== item.name || done.arguments !== item.arguments) throw fault("CHATGPT_OCR_INCOMPLETE");
                    }
                  }
                  for (const done of doneParts.values()) {
                    const message = z.object({ type: z.literal("message"), content: z.array(z.unknown()) }).parse(doneItems.get(done.output_index));
                    if (canonicalJsonStringify(message.content[done.content_index]) !== canonicalJsonStringify(done.part)) throw fault("CHATGPT_OCR_INCOMPLETE");
                  }
                  diagnostic.path = "output-schema";
                  const output = textOutputIndex === undefined ? "" : [...doneText.values()]
                    .filter(done => done.output_index === textOutputIndex).sort((a, b) => a.content_index - b.content_index).map(done => done.text).join("");
                  result = accept(terminal, output, textOutputIndex, argumentDeltas); completed = true;
                }
                if (event.type === "response.failed" || event.type === "response.incomplete") {
                  throw fault(event.type === "response.failed" ? "CHATGPT_OCR_FAILED" : "CHATGPT_OCR_INCOMPLETE");
                }
              }
              end = buffer.indexOf("\n\n");
            }
          }
          diagnostic.path = "stream-decode";
          decoder.decode();
          diagnostic.path = "stream-incomplete";
          if (!completed || result === undefined || buffer.trim() !== "" || epoch !== generation) throw fault("CHATGPT_OCR_INCOMPLETE");
          operation.assertCurrent();
          diagnostic.path = "usage-persistence";
          await persistUsage("available");
          operation.assertCurrent();
          if (cancelled()) throw fault("CHATGPT_OCR_CANCELLED");
          outcome = { kind: "value", value: result };
        } catch (error) { outcome = { kind: "error", error: error instanceof ChatGptAccountError || error instanceof ChatGptCredentialError
          ? error : fault(cancelled() ? "CHATGPT_OCR_CANCELLED" : "CHATGPT_OCR_INCOMPLETE") }; }
        const provedCancellation = (cause: unknown): boolean => outcome.kind === "error"
          && outcome.error instanceof ChatGptAccountError && outcome.error.code === "CHATGPT_OCR_CANCELLED"
          && cause instanceof ChatGptAccountError && cause.code === "CHATGPT_OCR_CANCELLED";
        const failedClosure = (cause: unknown): void => {
          const error = new ChatGptResourceClosureUnprovedError(outcome.kind === "value" ? cause
            : new AggregateError([outcome.error, cause], "ChatGPT response and closure failed"));
          retainResourceClosure(error, reader, response, operation); outcome = { kind: "error", error };
        };
        let readerReleased = false;
        try { await reader.cancel(); readerReleased = true; }
        catch (cause) { if (provedCancellation(cause)) readerReleased = true; else failedClosure(cause); }
        try { reader.releaseLock(); readerReleased = true; }
        catch (cause) { if (!readerReleased) failedClosure(cause); }
        if (outcome.kind === "error") throw outcome.error;
        operation.assertCurrent();
        return outcome.value;
      });
    } catch (error) {
      if (error instanceof ChatGptResourceClosureUnprovedError) diagnostic.path = "resource-closure";
      recordFailure(error, diagnostic, { method: "POST", route: "/v1/responses" });
      if (posted && !definite && error instanceof ChatGptAccountError && !(error instanceof ChatGptResourceClosureUnprovedError)) throw new ChatGptDeliveryUncertainError(error.code);
      throw error;
    } finally { if (capturedOperation === undefined) operation.close(); }
  }
  async function close(): Promise<void> {
    const attempt = pending, signOut = signOutLifetime;
    closed = true; ++generation; rejectedSessionToken = undefined; planFailureToken = undefined;
    await attempt?.cancel(); if (pending === attempt) pending = undefined;
    statusCheck?.controller.abort();
    for (const controller of requests) controller.abort();
    await Promise.allSettled([...accesses]);
    await Promise.all([...inferenceLifetimes]);
    let signOutFailure: unknown;
    try { await signOut; }
    catch (error) {
      if (!(error instanceof ChatGptAccountError) || !["CHATGPT_SERVICE_CLOSED", "CHATGPT_AUTH_CANCELLED", "CHATGPT_OCR_CANCELLED"].includes(error.code)) signOutFailure = error;
    }
    assertResourceClosure();
    if (signOutFailure instanceof Error) throw signOutFailure;
    if (signOutFailure !== undefined) throw new Error("ChatGPT sign-out failed", { cause: signOutFailure });
  }
  return Object.freeze({ setDebugEvents, readAccount, refreshAccount, readStatus, checkConnection, readAuthority, revalidateAuthority, signIn, signOut: () => disconnect(false), forgetAccount: () => disconnect(true), extractText, withOcrOperation, listAssistantModels, prepareAssistantModelPreference, inferAssistant, close });
}
export type ChatGptAccountService = ReturnType<typeof createChatGptAccountService>;

/** Media parts must carry canonical Base64, so decoded lengths are exact. */
function canonicalMedia(item: AssistantInferenceRequest["input"][number]): boolean {
  return assistantUserParts(item).every(part => {
    if (part.type === "input_text") return true;
    const url = part.type === "input_image" ? part.image_url : part.file_data, payload = url.slice(url.indexOf(",") + 1);
    return Buffer.from(payload, "base64").toString("base64") === payload;
  });
}
