/**
 * The wire-connectivity audit's mechanical half (doc 13 §8.8).
 *
 * D107's `pending-impl-bindings.json` proves a descriptor's contracts are
 * bound in BOTH directions. This is the same idea one layer up: a schema arm,
 * a command key, and a route are each one half of a connection, and this tree
 * has twice shipped the other half missing with every gate green — a
 * `captures` section arm no `availableSections` could return, and a
 * `"degraded"` stream arm nothing could emit.
 *
 * Everything here is DERIVED, never listed. Section arms come from walking the
 * zod union at runtime (a regex over the source would go stale the moment
 * somebody reformats it, and would happily agree with a schema that no longer
 * parses), the reachable set comes from CALLING `availableSections` over
 * synthesized records covering every lifecycle state, and command keys come
 * from walking the kernel's own request union. Only the exceptions are written
 * down, and an exception that stops being true fails too.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { REPO_ROOT, repoRelative, walkFiles } from "./guard-files.js";

/* ── 1. the declared exception manifest ───────────────────────────────────── */

export const PendingWireBindingSchema = z.strictObject({
  /** `<Schema>#<arm>` or `route:<METHOD> <path>`. */
  binding: z.string().min(1),
  direction: z.enum(["declared-unserved", "served-unconsumed"]),
  decision: z.string().regex(/^D\d+[a-z]?$/, "decision must name a doc 04 decision id"),
  note: z.string().min(1),
});

export const PendingWireBindingsFileSchema = z.strictObject({
  milestone: z.string().min(1),
  reason: z.string().min(1),
  bindings: z.array(PendingWireBindingSchema),
});

export type PendingWireBinding = z.infer<typeof PendingWireBindingSchema>;

export const PENDING_WIRE_BINDINGS_PATH = "config/pending-wire-bindings.json";

export function readPendingWireBindings(
  path = join(REPO_ROOT, PENDING_WIRE_BINDINGS_PATH),
): readonly PendingWireBinding[] {
  const parsed = PendingWireBindingsFileSchema.parse(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
  return parsed.bindings;
}

/* ── 2. zod union introspection ───────────────────────────────────────────── */

interface UnionLike {
  readonly options?: readonly unknown[];
  readonly shape?: Readonly<Record<string, unknown>>;
}

function asUnionLike(node: unknown): UnionLike {
  return typeof node === "object" && node !== null ? node : {};
}

/**
 * The literal (or enum member) values a discriminant key takes across a union.
 *
 * It walks NESTED unions because the kernel's request schema is a union of
 * per-family discriminated unions, and it accepts both a `z.literal` and a
 * `z.enum` on the discriminant because the kernel writes `type: z.enum([...])`
 * wherever several verbs share a target shape. Reading only literals would
 * have silently missed `retry`/`cancel`/`bump` — the three that
 * matter most here.
 */
export function discriminantValues(schema: unknown, key: string): readonly string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    const union = asUnionLike(node);
    if (Array.isArray(union.options)) {
      for (const option of union.options) visit(option);
      return;
    }
    const field = union.shape?.[key];
    if (field === undefined) return;
    const leaf = asUnionLike(field) as { value?: unknown; options?: readonly unknown[] };
    if (typeof leaf.value === "string") {
      found.push(leaf.value);
      return;
    }
    for (const member of leaf.options ?? []) {
      if (typeof member === "string") found.push(member);
    }
  };
  visit(schema);
  return [...new Set(found)].sort();
}

/**
 * The schema at `<discriminant> === <value>`'s `<field>`, refused by name when
 * the union no longer has that arm. It is untyped on purpose: the callers
 * compare two schemas structurally, and reaching a member of a refined
 * discriminated union through the type system costs more narrowing than the
 * comparison is worth — a missing arm has to fail loudly either way.
 */
export function armField(
  schema: unknown,
  discriminant: string,
  value: string,
  field: string,
): z.ZodType {
  const options = asUnionLike(schema).options ?? [];
  for (const option of options) {
    const shape = asUnionLike(option).shape;
    const marker = asUnionLike(shape?.[discriminant]) as { value?: unknown };
    if (marker.value !== value) continue;
    const found = shape?.[field];
    if (!(found instanceof z.ZodType)) {
      throw new Error(`the ${discriminant}=${value} arm carries no ${field} schema`);
    }
    return found;
  }
  throw new Error(`no ${discriminant}=${value} arm was found; the union moved`);
}

/* ── 3. route ↔ client path extraction ────────────────────────────────────── */

export interface ServedRoute {
  readonly method: string;
  readonly path: string;
}

export interface ClientRouteReference {
  readonly file: string;
  readonly path: string;
}

const ROUTE_REGISTRATION = /\bapp\.(get|post|put|delete|patch)\(\s*"([^"]+)"/g;
/** A string OR template literal whose first character starts a served path. */
const CLIENT_PATH = /["'`](\/(?:api|events)\/[^"'`]*)["'`]/g;

export function servedRoutes(source: string): readonly ServedRoute[] {
  return [...source.matchAll(ROUTE_REGISTRATION)].map(([, method, path]) => ({
    method: (method ?? "").toUpperCase(),
    path: path ?? "",
  }));
}

/**
 * A client reference, reduced to the shape a router matches on.
 *
 * Every `${…}` interpolation becomes one opaque segment marker and the query
 * and fragment are dropped — a client path is only ever compared against a
 * route PATTERN, so preserving the interpolated expression would just make
 * every parameterised call look unserved.
 */
export function normalizeClientPath(raw: string): string {
  const withMarkers = raw.replaceAll(/\$\{[^}]*\}/g, "\u0000");
  const [pathOnly = ""] = withMarkers.split(/[?#]/);
  return pathOnly;
}

export function clientRouteReferences(roots: readonly string[]): readonly ClientRouteReference[] {
  const references: ClientRouteReference[] = [];
  const files = roots.flatMap((root) => (
    root.endsWith(".ts") || root.endsWith(".tsx") ? [root] : walkFiles(root)
  ));
  for (const file of files) {
    for (const [, raw] of readFileSync(file, "utf8").matchAll(CLIENT_PATH)) {
      if (raw === undefined) continue;
      references.push({ file: repoRelative(file), path: normalizeClientPath(raw) });
    }
  }
  return references;
}

/**
 * Does a served route PATTERN match a client path? Segment counts must agree
 * and a `:param` route segment matches any single client segment — including
 * the opaque interpolation marker, which is the only honest verdict for a
 * value the scan cannot evaluate.
 */
export function routeMatches(pattern: string, clientPath: string): boolean {
  const patternSegments = pattern.split("/");
  const clientSegments = clientPath.split("/");
  if (patternSegments.length !== clientSegments.length) return false;
  return patternSegments.every((segment, index) => (
    segment.startsWith(":") || segment === clientSegments[index]
  ));
}

/* ── 5. served-descriptor producers ───────────────────────────────────────── */

/** Block and line comments, removed before a producer scan. */
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
/** An `ActionDescriptorWire` literal names its verb as `command:` or `key:`. */
const DESCRIPTOR_COMMAND = /\b(?:command|key)\s*:\s*"([a-z-]+)"/g;

/**
 * The command verbs a served-descriptor producer can actually EMIT.
 *
 * Comments are stripped first, and that is the load-bearing half: the verb this
 * check was written for (`unhide`) appeared in the projector only inside the
 * prose explaining why it is never served, and a scan that counted prose would
 * have called the dead key healthy.
 *
 * A stripper bug is fail-CLOSED here — deleting real code makes a live key look
 * unprojected, which fails the arm loudly rather than passing it quietly.
 */
export function projectedCommandKeys(source: string): readonly string[] {
  const code = source.replaceAll(COMMENTS, " ");
  return [...new Set([...code.matchAll(DESCRIPTOR_COMMAND)].map(([, key]) => key ?? ""))].sort();
}
