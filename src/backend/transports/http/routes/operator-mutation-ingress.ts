import type { MiddlewareHandler } from "hono";
import { wireError } from "./failure-status.js";

function allowedLoopbackOrigin(host: string | undefined): string | undefined {
  if (host === undefined) return undefined;
  const candidate = `http://${host}`;
  if (!URL.canParse(candidate)) return undefined;
  const url = new URL(candidate);
  if ((url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== "") {
    return undefined;
  }
  return url.origin;
}

// Host and Origin must pass loopback admission before handler or body effects.
export type OperatorIngressBodyPolicy = "json" | "opaque";

export function operatorIngressAdmission(body: OperatorIngressBodyPolicy): MiddlewareHandler {
  return async (context, next) => {
    const origin = context.req.header("origin");
    const allowedOrigin = allowedLoopbackOrigin(context.req.header("host"));
    if (allowedOrigin === undefined || origin !== allowedOrigin) {
      return context.json(wireError(
        "OPERATOR_MUTATION_ORIGIN_REFUSED",
        "operator mutations require an exact same-origin loopback Origin and Host",
        false,
      ), 403);
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
