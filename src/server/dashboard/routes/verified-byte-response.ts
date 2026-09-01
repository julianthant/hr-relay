import type { VerifiedByteLease } from "../../../infra/artifacts/server-verified-artifact-reader.js";

function primaryFirstAggregate(primary: unknown, cleanup: unknown, message: string): AggregateError {
  return new AggregateError([primary, cleanup], message, { cause: primary });
}

export type VerifiedByteRouteProfile = "generic" | "bundle" | "archive";

export interface VerifiedByteResponseInput {
  readonly lease: VerifiedByteLease;
  readonly method: string;
  readonly range: string | undefined;
  readonly profile: VerifiedByteRouteProfile;
}

function successHeaders(input: VerifiedByteResponseInput): Headers {
  const headers = new Headers({
    "content-type": input.lease.ref.mediaType,
    "content-length": String(input.lease.ref.bytes),
    "cache-control": "no-store",
  });
  if (input.profile === "archive") {
    headers.set("content-disposition", `attachment; filename="archive-${input.lease.ref.id}"`);
    headers.set("x-content-type-options", "nosniff");
  }
  return headers;
}

/** D291: one lease owner for GET/HEAD/verified-Range while route authority remains outside. */
export async function verifiedByteResponse(input: VerifiedByteResponseInput): Promise<Response> {
  if (input.range !== undefined) {
    await input.lease.dispose();
    return new Response(null, {
      status: 416,
      headers: {
        "content-range": `bytes */${String(input.lease.ref.bytes)}`,
        "cache-control": "no-store",
      },
    });
  }
  if (input.method === "HEAD") {
    await input.lease.dispose();
    return new Response(null, { status: 200, headers: successHeaders(input) });
  }
  try {
    return new Response(await input.lease.takeBody(), {
      status: 200,
      headers: successHeaders(input),
    });
  } catch (error: unknown) {
    try {
      await input.lease.dispose();
    } catch (cleanup: unknown) {
      throw primaryFirstAggregate(error, cleanup, "verified byte response and lease cleanup both failed");
    }
    throw error;
  }
}
