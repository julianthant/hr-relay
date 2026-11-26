import { z } from "zod";
import { LogPageCursorSchema } from "../../../../models/dashboard/run-detail.js";

export const PositiveIntegerTextSchema = z.string().regex(/^[1-9]\d*$/u).transform(Number);

export const RunSectionQuerySchema = z.strictObject({ cursor: LogPageCursorSchema.optional() });

export function rawRouteQuery(url: string): Record<string, string | string[]> {
  const query = new Map<string, string | string[]>();
  for (const [key, value] of new URL(url).searchParams) {
    const previous = query.get(key);
    if (Array.isArray(previous)) previous.push(value);
    else query.set(key, previous === undefined ? value : [previous, value]);
  }
  return Object.fromEntries(query);
}
