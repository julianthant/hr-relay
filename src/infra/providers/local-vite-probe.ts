import { timingSafeEqual } from "node:crypto";
import type { Clock } from "../../domain/clock.js";
import {
  DASHBOARD_FRONTEND_OWNER_PATH,
  DashboardLaunchNonceSchema,
} from "../../domain/dashboard-frontend-owner.js";

/**
 * Each identity endpoint carries its own ceiling: a nonce and a dev index are tiny, while Vite's
 * own client bundle is legitimately large (204,724 bytes on Vite 8.2.2, verified 2026-08-31), so a
 * single flat cap either refuses the real dev server or lets a hostile one stream unbounded bytes.
 */
const VITE_PROBE_OWNER_MAX_RESPONSE_BYTES = 1024;
const VITE_PROBE_INDEX_MAX_RESPONSE_BYTES = 64 * 1024;
const VITE_PROBE_CLIENT_MAX_RESPONSE_BYTES = 1024 * 1024;

export type OwnedViteProbeResult = Readonly<
  | { state: "owned" }
  | {
      state: "not-owned";
      reason:
        | "owner-proof-unconfigured"
        | "probe-deadline-expired"
        | "probe-request-failed"
        | "owner-endpoint-refused"
        | "owner-proof-invalid"
        | "index-identity-invalid"
        | "vite-client-identity-invalid"
        | "probe-response-invalid"
        | "probe-response-too-large";
    }
>;

type ProbeTextResult = Readonly<
  | { state: "available"; text: string }
  | { state: "unavailable"; reason: Exclude<OwnedViteProbeResult, { state: "owned" }>["reason"] }
>;

function requestFailureReason(signal: AbortSignal): Exclude<OwnedViteProbeResult, { state: "owned" }>["reason"] {
  return signal.aborted ? "probe-deadline-expired" : "probe-request-failed";
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<ProbeTextResult> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null
    && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    return { state: "unavailable", reason: "probe-response-too-large" };
  }
  if (response.body === null) return { state: "unavailable", reason: "probe-response-invalid" };
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let body = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel("Vite identity response exceeded its byte limit");
        return { state: "unavailable", reason: "probe-response-too-large" };
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return { state: "available", text: body };
  } catch (error) {
    return {
      state: "unavailable",
      reason: error instanceof TypeError ? "probe-response-invalid" : "probe-request-failed",
    };
  } finally {
    reader.releaseLock();
  }
}

async function fetchProbeText(url: string, signal: AbortSignal, maxBytes: number): Promise<ProbeTextResult> {
  let response: Response;
  try {
    response = await fetch(url, { signal, redirect: "error" });
  } catch {
    return { state: "unavailable", reason: requestFailureReason(signal) };
  }
  if (!response.ok) return { state: "unavailable", reason: "owner-endpoint-refused" };
  return readBoundedResponseText(response, maxBytes);
}

export async function probeOwnedViteServer(input: Readonly<{
  port: number;
  signal: AbortSignal;
  deadlineMonotonicMs: number;
  clock: Clock;
  ownerNonce: string | undefined;
}>): Promise<OwnedViteProbeResult> {
  if (input.ownerNonce === undefined) return { state: "not-owned", reason: "owner-proof-unconfigured" };
  const remainingMs = Math.floor(input.deadlineMonotonicMs - input.clock.monotonicMs());
  if (remainingMs <= 0 || input.signal.aborted) {
    return { state: "not-owned", reason: "probe-deadline-expired" };
  }
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(remainingMs)]);
  const origin = `http://127.0.0.1:${String(input.port)}`;

  const owner = await fetchProbeText(
    `${origin}${DASHBOARD_FRONTEND_OWNER_PATH}`,
    signal,
    VITE_PROBE_OWNER_MAX_RESPONSE_BYTES,
  );
  if (owner.state === "unavailable") return { state: "not-owned", reason: owner.reason };
  const observedNonce = DashboardLaunchNonceSchema.safeParse(owner.text);
  if (!observedNonce.success
    || !timingSafeEqual(Buffer.from(observedNonce.data, "hex"), Buffer.from(input.ownerNonce, "hex"))) {
    return { state: "not-owned", reason: "owner-proof-invalid" };
  }

  const index = await fetchProbeText(`${origin}/`, signal, VITE_PROBE_INDEX_MAX_RESPONSE_BYTES);
  if (index.state === "unavailable") return { state: "not-owned", reason: index.reason };
  if (!index.text.includes("<title>HR Automation — rebuild</title>")
    || !index.text.includes('src="/app/main.tsx"')) {
    return { state: "not-owned", reason: "index-identity-invalid" };
  }

  const client = await fetchProbeText(`${origin}/@vite/client`, signal, VITE_PROBE_CLIENT_MAX_RESPONSE_BYTES);
  if (client.state === "unavailable") return { state: "not-owned", reason: client.reason };
  if (!client.text.includes("createHotContext") || !client.text.toLowerCase().includes("vite")) {
    return { state: "not-owned", reason: "vite-client-identity-invalid" };
  }
  return { state: "owned" };
}
