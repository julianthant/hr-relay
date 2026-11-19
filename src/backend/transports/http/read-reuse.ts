import { randomUUID } from "node:crypto";

/** A reader returns the same deeply frozen wire only while its sources remain current. */
export function createReadResponse() {
  const serialized = new WeakMap<object, { body: string; etag: string }>();
  return (wire: object): Response => {
    let entry = serialized.get(wire);
    if (entry === undefined) {
      entry = { body: JSON.stringify(wire), etag: `"${randomUUID()}"` };
      if (Object.isFrozen(wire)) serialized.set(wire, entry);
    }
    return new Response(entry.body, { headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-cache",
      ETag: entry.etag,
    } });
  };
}
