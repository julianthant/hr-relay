// Use a namespaced SHA-256 seed in a UUID v5 shape; this is deterministic identity, not a random UUID.
import { createHash } from "node:crypto";
import { NodeIdSchema, TraceIdSchema } from "../../../rules/identity/ids.js";

export function deterministicUuid(seed: string): string {
  const digest = createHash("sha256").update("hrauto:server-derived-id:v1\0").update(seed).digest("hex");
  const variant = "89ab"[Number.parseInt(digest[16], 16) % 4];
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


export function nodeIdOfTaskSpanPath(spanPath: string): string | undefined {
  const segments = spanPath.split("/");
  const segment = segments.at(-1);
  if (segment !== undefined && segment.includes("#")) return segment.slice(0, segment.lastIndexOf("#"));
  if (segments.length !== 3 || !["probe", "prepare", "commit", "verify"].includes(segments[2] ?? "")) return undefined;
  return TraceIdSchema.safeParse(segments[0]).success && NodeIdSchema.safeParse(segments[1]).success
    ? segments[1] : undefined;
}

// Malformed browser span identities refuse; silently losing a live-session card would misreport ownership.
export function browserSessionOfSpanPath(
  spanPath: string,
  declaredSystem?: string,
): { readonly sessionId: string; readonly system: string } {
  const segment = spanPath.split("/").at(-1);
  const marker = segment === undefined ? -1 : segment.lastIndexOf("#");
  if (segment === undefined || !segment.startsWith("browser:") || marker <= "browser:".length) {
    throw new Error(
      `browser span path ${spanPath} does not name a session; `
      + "expected worker/<workflow>/<worker>/browser:<system>#<sessionId>",
    );
  }
  const system = segment.slice("browser:".length, marker);
  if (declaredSystem !== undefined && declaredSystem !== system) {
    throw new Error(
      `browser span ${spanPath} declares system ${declaredSystem} while its own path names ${system}`,
    );
  }
  return { sessionId: segment.slice(marker + 1), system };
}
