import { PreflightSelectionSchema, PreflightRerunCommandRequestSchema } from "../../../../models/preflight/preflight-contract.js";
import { assertRequestActor } from "../request-identity.js";
import { inspectLoopbackOrigin, isLoopbackHost } from "./loopback.js";
import { wireError } from "./failure-status.js";
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

import type { DashboardApp } from "./api-types.js";
import type { SettingsPreflightRouteDeps } from "./settings-preflight-types.js";

export function registerSettingsPreflightRoutes(app: DashboardApp, deps: SettingsPreflightRouteDeps): void {
  app.get("/api/v1/preflight", c => {
    const raw = c.req.query("selection");
    const selection = raw === undefined ? undefined : PreflightSelectionSchema.parse(JSON.parse(raw) as unknown);
    return c.json(deps.preflight.read?.(selection) ?? { state: "unavailable", reason: "Preflight report reader is unavailable." });
  });
  const preflightStarts: number[] = [];
  let preflightActive = false;
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
    const now = deps.clock.monotonicMs();
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

}
