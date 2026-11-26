import type { MiddlewareHandler } from "hono";
import { wireError } from "./failure-status.js";

function allowedLoopbackOrigin(host: string | undefined): string | undefined {
  if (host === undefined) return undefined;
  const match = /^(?:localhost|127\.0\.0\.1)(?::(\d{1,5}))?$/u.exec(host.toLowerCase());
  if (match === null) return undefined;
  const port = match[1];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65_535)) return undefined;
  return new URL(`http://${host}`).origin;
}

const defaultOriginRefusal = {
  status: 403,
  code: "OPERATOR_MUTATION_ORIGIN_REFUSED",
  message: "operator mutations require an exact same-origin loopback Origin and Host",
} as const;

// Host and Origin must pass loopback admission before handler or body effects.
export type OperatorIngressBodyPolicy = "json" | "opaque";

export function operatorIngressAdmission(
  body: OperatorIngressBodyPolicy,
  refuseOrigin: (origin: string | undefined) => { status: 400 | 403; code: string; message: string } = () => defaultOriginRefusal,
): MiddlewareHandler {
  return async (context, next) => {
    if (context.req.method === "GET" || context.req.method === "HEAD") return next();
    const origin = context.req.header("origin");
    const allowedOrigin = allowedLoopbackOrigin(context.req.header("host"));
    if (allowedOrigin === undefined || origin !== allowedOrigin) {
      const { status, code, message } = refuseOrigin(origin);
      return context.json(wireError(code, message, false), status);
    }
    if (body === "json") {
      const mediaType = context.req.header("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (mediaType !== "application/json") {
        return context.json(wireError(
          "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED",
          "operator mutations require Content-Type application/json",
          false,
        ), 415);
      }
    }
    return next();
  };
}

/** Reject browser-reachable operator JSON writes unless Origin names this exact loopback Host. */
export const operatorMutationIngressGuard: MiddlewareHandler = operatorIngressAdmission("json");

/** The same Host/Origin door for a mutation whose body is not a JSON envelope. */
export const operatorOpaqueIngressGuard: MiddlewareHandler = operatorIngressAdmission("opaque");

// Preflight's bounded reader owns the JSON media type and its existing diagnostics.
export const preflightRerunIngressGuard = operatorIngressAdmission("opaque", origin =>
  origin !== undefined && !URL.canParse(origin)
    ? { status: 400, code: "PREFLIGHT_ORIGIN_INVALID", message: "preflight rerun Origin must be one absolute HTTP(S) origin" }
    : { status: 403, code: "PREFLIGHT_INGRESS_FORBIDDEN", message: "preflight reruns require an exact same-origin loopback Origin and Host" });
