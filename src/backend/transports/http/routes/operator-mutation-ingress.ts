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

/**
 * What a browser-reachable operator mutation must carry before its handler may
 * read a byte of body, query, authority or provider (ref frontend-backend-integration
 * §3.4, D75). The Host/Origin pair is the whole admission; the media-type arm is
 * per policy because the doors differ in what their body IS:
 *
 * - `json` — the body is a strict JSON envelope (commands, bulk, XLSX export,
 *   start plans, Explorer validation). A hostile page can send a JSON-shaped
 *   body as `text/plain` through a simple no-CORS POST, and Hono's `c.req.json()`
 *   parses it regardless, so the media type is part of the admission.
 * - `opaque` — the route owns its media-type contract (intake bytes travel as
 *   themselves under the file's own type).
 *   Origin/Host still gate it; nothing about the body is assumed here.
 */
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
