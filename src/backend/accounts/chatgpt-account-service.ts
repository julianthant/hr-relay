import { type ChatGptAccountState, type ChatGptSignInRequest, type ChatGptSignedOut } from "../../models/dashboard/chatgpt-account.js";
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import type { Clock } from "../../rules/time/clock.js";
import { IsoInstantSchema } from "../../rules/identity/ids.js";
import { privateEqual } from "../../rules/validation/private-equal.js";
import type { RuntimeAdmission } from "../storage/admission/admission.js";
import { createChatGptCredentialRepository, ChatGptCredentialError, type ChatGptCredentialRecord, type ChatGptCredentialRepositoryOptions } from "../storage/configuration/credential-store.js";
import { ERROR_CATALOG, type ErrorCatalogCode } from "../../models/failures/error-catalog.js";

const AUTH = "https://auth.openai.com", RESOURCE = "https://api.openai.com/v1";
const PLAN_SCOPES = ["offline_access", "resource.invoke", "chatgpt.tokens.use.direct"];
type ChatGptAccountCode = Exclude<Extract<ErrorCatalogCode, `CHATGPT_${string}`>, `CHATGPT_CREDENTIAL_${string}`>;
export class ChatGptAccountError extends Error {
  constructor(readonly code: ChatGptAccountCode) { super(ERROR_CATALOG[code].text); this.name = "ChatGptAccountError"; }
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
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || response.body === null) { await response.body?.cancel(); throw fault("CHATGPT_AUTH_UNAVAILABLE"); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  let outcome: { readonly kind: "value"; readonly value: unknown } | { readonly kind: "error"; readonly error: unknown };
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
      if (size > 64_000) throw fault("CHATGPT_AUTH_INVALID"); chunks.push(chunk.value); }
    try { outcome = { kind: "value", value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown }; }
    catch { outcome = { kind: "error", error: fault("CHATGPT_AUTH_INVALID") }; }
  } catch (error) { outcome = { kind: "error", error }; }
  try { await reader.cancel(); } catch { outcome = { kind: "error", error: fault("CHATGPT_AUTH_UNAVAILABLE") }; }
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
  if (record?.session == null || record.registration === null) return { state: "signed-out" };
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

export function createChatGptAccountService(options: ChatGptAccountServiceOptions) {
  const repository = createChatGptCredentialRepository({ admission: options.admission, stateRoot: options.stateRoot, ...options.credentialHooks });
  const transport = options.fetch ?? fetch, clock = options.clock;
  const requests = new Set<AbortController>();
  const accesses = new Set<Promise<ChatGptCredentialRecord>>();
  let closed = false, generation = 0;
  let pending: { cancel(): Promise<void> } | undefined;
  function active(): void { if (closed) throw fault("CHATGPT_SERVICE_CLOSED"); options.admission.assertLive(); }
  async function request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    active();
    const controller = new AbortController(); requests.add(controller);
    const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000), ...(signal === undefined ? [] : [signal])]);
    try {
      const response = await interruptible(transport(url, { ...init, signal: combined, redirect: "error" }), combined);
      if (response.body === null) { requests.delete(controller); return response; }
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(target) {
          try {
            const chunk = await interruptible(reader.read(), combined);
            if (chunk.done) { requests.delete(controller); reader.releaseLock(); target.close(); }
            else target.enqueue(chunk.value);
          } catch { requests.delete(controller); target.error(fault(combined.aborted ? "CHATGPT_OCR_CANCELLED" : "CHATGPT_AUTH_UNAVAILABLE")); }
        },
        async cancel() { requests.delete(controller); try { await reader.cancel(); } catch { throw fault("CHATGPT_AUTH_UNAVAILABLE"); } finally { reader.releaseLock(); } },
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    catch { requests.delete(controller); throw fault(signal?.aborted === true || controller.signal.aborted ? "CHATGPT_OCR_CANCELLED" : "CHATGPT_AUTH_UNAVAILABLE"); }
  }
  async function discovery(signal?: AbortSignal) {
    const result = DiscoverySchema.safeParse(await boundedJson(await request(`${AUTH}/.well-known/openid-configuration`, {}, signal)));
    if (!result.success || !result.data.id_token_signing_alg_values_supported.includes("RS256")) throw fault("CHATGPT_AUTH_INVALID");
    return { jwks: authUrl(result.data.jwks_uri), revocation: authUrl(result.data.revocation_endpoint) };
  }
  async function verifiedClaims(token: string, clientId: string, nonce: string | undefined, signal?: AbortSignal) {
    try {
      const parts = token.split("."); if (parts.length !== 3) throw fault("CHATGPT_AUTH_INVALID");
      const [headerPart, claimsPart, signaturePart] = parts;
      if (headerPart === undefined || claimsPart === undefined || signaturePart === undefined) throw fault("CHATGPT_AUTH_INVALID");
      const header = z.object({ alg: z.literal("RS256"), kid: z.string().min(1) }).parse(JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")));
      const discovered = await discovery(signal);
      const jwks = z.object({ keys: z.array(z.object({ kty: z.literal("RSA"), kid: z.string(), n: z.string(), e: z.string(), use: z.literal("sig").optional(), alg: z.literal("RS256").optional() })).max(32) })
        .parse(await boundedJson(await request(discovered.jwks, {}, signal)));
      const keys = jwks.keys.filter(key => key.kid === header.kid);
      if (keys.length !== 1 || keys[0] === undefined) throw fault("CHATGPT_AUTH_INVALID");
      const key = createPublicKey({ key: keys[0], format: "jwk" });
      if (!verify("RSA-SHA256", Buffer.from(`${headerPart}.${claimsPart}`), key, Buffer.from(signaturePart, "base64url"))) throw fault("CHATGPT_AUTH_INVALID");
      const claims = ClaimsSchema.parse(JSON.parse(Buffer.from(claimsPart, "base64url").toString("utf8")));
      const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud, seconds = clock.nowMs() / 1000;
      if (!audiences.includes(clientId) || audiences.length > 1 && claims.azp !== clientId || claims.azp !== undefined && claims.azp !== clientId
        || claims.exp <= seconds || claims.iat > seconds || claims.nbf !== undefined && claims.nbf > seconds
        || nonce !== undefined && (claims.nonce === undefined || !privateEqual(claims.nonce, nonce))) throw fault("CHATGPT_AUTH_INVALID");
      return claims;
    } catch (error) { if (error instanceof ChatGptAccountError) throw error; throw fault("CHATGPT_AUTH_INVALID"); }
  }
  async function token(form: URLSearchParams, clientId: string, usePlan: boolean, nonce?: string, signal?: AbortSignal) {
    const response = await request(`${AUTH}/api/accounts/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form }, signal);
    if (response.status === 400 || response.status === 401) { await response.body?.cancel(); throw fault("CHATGPT_ACCOUNT_EXPIRED"); }
    const parsed = TokenSchema.safeParse(await boundedJson(response)); if (!parsed.success) throw fault("CHATGPT_AUTH_INVALID");
    const claims = await verifiedClaims(parsed.data.id_token, clientId, nonce, signal);
    return { registration: { subject: claims.sub, name: claims.name, email: claims.email }, session: {
      accessToken: parsed.data.access_token, refreshToken: parsed.data.refresh_token ?? null, idToken: parsed.data.id_token,
      expiresAt: IsoInstantSchema.parse(new Date(clock.nowMs() + parsed.data.expires_in * 1000).toISOString()), earliestRefreshAt: parsed.data.earliest_refresh_at ?? null,
      scopes: parsed.data.scope.split(/\s+/u).filter(Boolean), usePlan, usage: "available" as const,
    } };
  }
  function readAccount(): ChatGptAccountState {
    active();
    try { return publicState(repository.read(), clock.nowMs()); }
    catch (error) {
      if (error instanceof ChatGptCredentialError) return { state: "unavailable", code: error.code, message: error.message };
      throw error;
    }
  }
  async function signIn(input: ChatGptSignInRequest): Promise<ChatGptAuthorization> {
    active(); if (pending !== undefined) throw fault("CHATGPT_AUTH_BUSY");
    if (typeof input.usePlan !== "boolean") throw fault("CHATGPT_AUTH_INVALID");
    const attemptGeneration = ++generation;
    let startupComplete = false, finishStartup!: () => void;
    let cancelAttempt: (() => Promise<void>) | undefined;
    const startup = new Promise<void>(resolve => { finishStartup = resolve; });
    const reservation = { cancel: async () => {
      await startup; await cancelAttempt?.();
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
  async function signOut(): Promise<ChatGptSignedOut> {
    active(); const attempt = pending; ++generation; await attempt?.cancel(); if (pending === attempt) pending = undefined;
    for (const controller of requests) controller.abort();
    await Promise.allSettled([...accesses]);
    return repository.withLock(async transaction => {
      const current = transaction.read(); if (current === undefined || current.session === null || current.registration === null || current.clientId === null) return { state: "signed-out", remoteRevocation: "not-needed" };
      let remoteRevocation: "confirmed" | "unconfirmed" | "not-needed" = current.session.refreshToken === null ? "not-needed" : "unconfirmed";
      try { if (current.session.refreshToken !== null) {
        const discovered = await discovery();
        const response = await request(discovered.revocation, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: current.session.refreshToken, token_type_hint: "refresh_token", client_id: current.clientId }) });
        if (response.status === 200 && await boundedEmptyResponse(response)) remoteRevocation = "confirmed";
        else await response.body?.cancel();
      }
      } catch { remoteRevocation = "unconfirmed"; }
      transaction.replace({ ...current, revision: current.revision + 1, session: null }, current.revision);
      return { state: "signed-out", remoteRevocation };
    });
  }
  async function access(signal?: AbortSignal): Promise<ChatGptCredentialRecord> {
    const epoch = generation;
    const operation = repository.withLock(async transaction => {
      let current = transaction.read();
      if (current?.session == null || current.registration === null || current.clientId === null) throw fault("CHATGPT_ACCOUNT_EXPIRED");
      if (Date.parse(current.session.expiresAt) <= clock.nowMs() + 60_000) {
        if (current.session.refreshToken === null) throw fault("CHATGPT_ACCOUNT_EXPIRED");
        if (current.session.earliestRefreshAt !== null && clock.nowMs() / 1000 < current.session.earliestRefreshAt) throw fault("CHATGPT_ACCOUNT_EXPIRED");
        const result = await token(new URLSearchParams({ grant_type: "refresh_token", client_id: current.clientId, refresh_token: current.session.refreshToken, resource: RESOURCE }), current.clientId, current.session.usePlan, undefined, signal);
        if (epoch !== generation || closed) throw fault("CHATGPT_OCR_CANCELLED");
        if (result.session.refreshToken === null) throw fault("CHATGPT_AUTH_INVALID");
        if (result.registration.subject !== current.registration.subject) throw fault("CHATGPT_AUTH_INVALID");
        current = { ...current, ...result, revision: current.revision + 1 }; transaction.replace(current, current.revision - 1);
      }
      return current;
    });
    accesses.add(operation);
    try { return await operation; } finally { accesses.delete(operation); }
  }
  async function extractText(input: ChatGptOcrRequest, signal?: AbortSignal): Promise<{ readonly text: string }> {
    const cancelled = () => signal?.aborted === true;
    active(); if (cancelled()) throw fault("CHATGPT_OCR_CANCELLED");
    const parsed = ChatGptOcrRequestSchema.safeParse(input); if (!parsed.success) throw fault("CHATGPT_OCR_INVALID");
    const document = parsed.data.input;
    if (Buffer.from(document.base64, "base64").toString("base64") !== document.base64) throw fault("CHATGPT_OCR_INVALID");
    const epoch = generation, credentials = await access(signal), session = credentials.session;
    if (session === null || !session.usePlan || !PLAN_SCOPES.every(scope => session.scopes.includes(scope))) throw fault("CHATGPT_PLAN_DISABLED");
    if (epoch !== generation || closed) throw fault("CHATGPT_OCR_CANCELLED");
    const content = document.kind === "image" ? { type: "input_image", image_url: `data:${document.mediaType};base64,${document.base64}`, detail: "high" }
      : { type: "input_file", filename: document.filename, file_data: `data:application/pdf;base64,${document.base64}` };
    const response = await request(`${RESOURCE}/responses`, { method: "POST", headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: parsed.data.model, store: false, stream: true, input: [{ role: "user", content: [{ type: "input_text", text: parsed.data.instruction }, content] }] }) }, signal);
    if (!response.ok || response.body === null || !response.headers.get("content-type")?.startsWith("text/event-stream")) { await response.body?.cancel(); throw fault("CHATGPT_OCR_FAILED"); }
    const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
    let buffer = "", output = "", completed = false, total = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        if (epoch !== generation || closed || cancelled()) throw fault("CHATGPT_OCR_CANCELLED");
        total += chunk.value.length; if (total > 4_000_000) throw fault("CHATGPT_OCR_INCOMPLETE");
        buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/gu, "\n");
        let end = buffer.indexOf("\n\n");
        while (end !== -1) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
          if (data !== "" && data !== "[DONE]") {
            const event = z.object({ type: z.string(), delta: z.string().optional(), response: z.object({ error: z.object({ code: z.string() }).nullish() }).optional() }).parse(JSON.parse(data));
            if (completed) throw fault("CHATGPT_OCR_INCOMPLETE");
            if (event.type === "response.output_text.delta") { if (event.delta === undefined) throw fault("CHATGPT_OCR_INCOMPLETE"); output += event.delta; }
            if (event.type === "response.completed") completed = true;
            if (event.type === "response.failed" || event.type === "response.incomplete") {
              const code = event.response?.error?.code;
              if (code === "subscription_sharing_usage_limit_exceeded" || code === "subscription_sharing_usage_unavailable") {
                await repository.withLock(async transaction => { const current = transaction.read();
                  if (current?.session !== null && current?.session !== undefined && current.clientId === credentials.clientId && epoch === generation)
                    transaction.replace({ ...current, revision: current.revision + 1, session: { ...current.session, usage: code === "subscription_sharing_usage_limit_exceeded" ? "limit-reached" : "unavailable" } }, current.revision);
                });
                throw fault(code === "subscription_sharing_usage_limit_exceeded" ? "CHATGPT_USAGE_LIMIT" : "CHATGPT_USAGE_UNAVAILABLE");
              }
              throw fault(event.type === "response.failed" ? "CHATGPT_OCR_FAILED" : "CHATGPT_OCR_INCOMPLETE");
            }
          }
          end = buffer.indexOf("\n\n");
        }
      }
      decoder.decode();
      if (!completed || buffer.trim() !== "" || output.length === 0 || epoch !== generation) throw fault("CHATGPT_OCR_INCOMPLETE");
      return { text: output };
    } catch (error) { if (error instanceof ChatGptAccountError || error instanceof ChatGptCredentialError) throw error; throw fault(cancelled() ? "CHATGPT_OCR_CANCELLED" : "CHATGPT_OCR_INCOMPLETE"); }
    finally { await reader.cancel(); reader.releaseLock(); }
  }
  async function close(): Promise<void> {
    const attempt = pending; closed = true; ++generation; await attempt?.cancel(); if (pending === attempt) pending = undefined;
    for (const controller of requests) controller.abort(); await Promise.allSettled([...accesses]);
  }
  return Object.freeze({ readAccount, signIn, signOut, extractText, close });
}
export type ChatGptAccountService = ReturnType<typeof createChatGptAccountService>;
