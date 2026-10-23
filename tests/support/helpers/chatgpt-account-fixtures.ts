import { generateKeyPairSync, sign } from "node:crypto";
import type { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { createChatGptAccountService, type ChatGptAuthorization } from "../../../src/backend/accounts/chatgpt-account-service.js";
import { manualClock } from "../../../src/rules/time/clock.js";

import { createBoundProfileFixture } from "./admission-fixture.js";

export function chatGptFixture(ownedAdmission?: RuntimeAdmission) {
  const profile = ownedAdmission === undefined ? createBoundProfileFixture() : undefined;
  const admission = ownedAdmission ?? profile?.admission;
  if (admission === undefined) throw new Error("actual profile fixture admission required");
  const root = admission.stateRoot;
  const clock = manualClock(new Date("2026-10-12T12:00:00.000Z"));
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid: "fixture-key", alg: "RS256", use: "sig" };
  let nonce = "", count = 0;
  const calls: { url: string; init: RequestInit }[] = [];
  let claimsPatch: { [key: string]: unknown } = {}, grantedScopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
  let sse = completedOcrStream("Synthetic form");
  let models: unknown = { models: [{ slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol", visibility: "list" }] };
  let modelsHook: (() => Promise<Response>) | undefined;
  let revocationStatus = 200, discoveryPatch: { [key: string]: unknown } = {};
  let tokenHook: (() => Promise<void>) | undefined, tokenPatch: { [key: string]: unknown } = {}, tokenStatus = 200, tokenError = "invalid_grant", tamperSignature = false;
  let responseHook: ((init: RequestInit) => Response) | undefined;
  function idToken() {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture-key" })).toString("base64url");
    const claims = Buffer.from(JSON.stringify({ iss: "https://auth.openai.com", aud: "oaiapp_fixture", sub: "synthetic-subject", name: "Synthetic Operator",
      email: "synthetic@example.com", exp: clock.nowMs() / 1000 + 3600, iat: clock.nowMs() / 1000, nonce, ...claimsPatch })).toString("base64url");
    return `${header}.${claims}.${tamperSignature ? "AAAA" : sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), keys.privateKey).toString("base64url")}`;
  }
  const transport: typeof fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; calls.push({ url, init });
    if (url.endsWith("/.well-known/openid-configuration")) return Response.json({ issuer: "https://auth.openai.com", jwks_uri: "https://auth.openai.com/jwks",
      revocation_endpoint: "https://auth.openai.com/revoke", id_token_signing_alg_values_supported: ["RS256"], ...discoveryPatch });
    if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/oauth/token")) {
      await tokenHook?.(); count++;
      if (tokenStatus !== 200) return Response.json({ error: tokenError }, { status: tokenStatus });
      return Response.json({ access_token: `synthetic-access-${String(count)}`, refresh_token: `synthetic-refresh-${String(count)}`, id_token: idToken(),
        token_type: "Bearer", expires_in: 3600, scope: grantedScopes, ...tokenPatch });
    }
    if (url.endsWith("/revoke")) return new Response(revocationStatus === 200 ? "" : "synthetic-unavailable", { status: revocationStatus });
    if (url.endsWith("/models")) return modelsHook === undefined ? Response.json(models) : modelsHook();
    if (url.endsWith("/responses")) return responseHook?.(init) ?? new Response(sse, { headers: { "Content-Type": "text/event-stream" } });
    throw new Error("Unexpected synthetic URL");
  };
  const service = createChatGptAccountService({ admission, stateRoot: root, clock, fetch: transport });
  async function callback(attempt: ChatGptAuthorization, patch: { [key: string]: string | null } = {}) {
    const authorize = new URL(attempt.authorizationUrl); nonce = authorize.searchParams.get("nonce") ?? "";
    const callback = new URL(authorize.searchParams.get("redirect_uri") ?? "");
    callback.searchParams.set("code", "synthetic-code"); callback.searchParams.set("state", authorize.searchParams.get("state") ?? "");
    if (authorize.searchParams.get("client_id") === "dynamic_agent_client") callback.searchParams.set("client_id", "oaiapp_fixture");
    for (const [key, value] of Object.entries(patch)) { if (value === null) callback.searchParams.delete(key); else callback.searchParams.set(key, value); }
    return fetch(callback);
  }
  async function connected(usePlan = true) { const attempt = await service.signIn({ usePlan }); await callback(attempt); return attempt.completion; }
  async function cleanup() {
    await service.close();
    profile?.close();
  }
  return { root, admission, clock, service, transport, calls, callback, connected, cleanup,
    setClaims(patch: { [key: string]: unknown }) { claimsPatch = patch; },
    setModels(value: unknown) { models = value; }, setModelsHook(hook: () => Promise<Response>) { modelsHook = hook; },
    setScopes(scopes: string) { grantedScopes = scopes; }, setSse(value: string) { sse = value; },
    setRevocation(status: number) { revocationStatus = status; }, setDiscovery(patch: { [key: string]: unknown }) { discoveryPatch = patch; },
    setTokenHook(hook: () => Promise<void>) { tokenHook = hook; },
    setToken(patch: { [key: string]: unknown }) { tokenPatch = patch; },
    setTokenStatus(status: number, error = "invalid_grant") { tokenStatus = status; tokenError = error; }, tamperSignature() { tamperSignature = true; },
    setResponse(hook: (init: RequestInit) => Response) { responseHook = hook; },
  };
}

export function completedOcrStream(text: string, model = "gpt-6.1-sol"): string {
  return `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text, output_index: 0, content_index: 0 })}\n\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_synthetic", model, status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }] } })}\n\n`;
}
