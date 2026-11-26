import { randomUUID } from "node:crypto";

type SerializedRead = { body: string; etag: string };
const serialize = (wire: object): SerializedRead => ({ body: JSON.stringify(wire), etag: `"${randomUUID()}"` });
function response(entry: SerializedRead, cacheControl: string): Response {
  return new Response(entry.body, { headers: {
    "Content-Type": "application/json",
    "Cache-Control": cacheControl,
    ETag: entry.etag,
  } });
}

type ReadPosition = number | object;
export type PositionedRead<Wire extends object> = (position: ReadPosition | undefined, read: () => Wire) => Response;

/** Called inside the owner's snapshot with its current revision and a builder bound to that snapshot. */
export function createPositionedReadResponse<Wire extends object>(cacheControl: string, validate: (wire: Wire) => object = wire => wire): PositionedRead<Wire> {
  let saved: { position: ReadPosition; entry: SerializedRead } | undefined;
  return (position, read) => {
    if (saved !== undefined && saved.position === position) return response(saved.entry, cacheControl);
    const entry = serialize(validate(read()));
    if (position !== undefined) saved = { position, entry };
    return response(entry, cacheControl);
  };
}
