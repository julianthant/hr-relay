
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { REPO_ROOT, repoRelative, walkFiles } from "../../support/helpers/guard-files.js";

/* ── 1. the declared exception manifest ───────────────────────────────────── */

export const PendingWireBindingSchema = z.strictObject({
  /** `<Schema>#<arm>` or `route:<METHOD> <path>`. */
  binding: z.string().min(1),
  direction: z.enum(["declared-unserved", "served-unconsumed"]),
  decision: z.string().regex(/^D\d+[a-z]?$/, "decision must name a ref decisions decision id"),
  note: z.string().min(1),
});

export const PendingWireBindingsFileSchema = z.strictObject({
  milestone: z.string().min(1),
  reason: z.string().min(1),
  bindings: z.array(PendingWireBindingSchema),
});

export type PendingWireBinding = z.infer<typeof PendingWireBindingSchema>;

export const PENDING_WIRE_BINDINGS_PATH = "docs/rebuild/migrations/legacy/pending-wire-bindings.json";

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

// Treat each interpolation as one opaque route segment; query and fragment do not affect matching.
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


export function routeMatches(pattern: string, clientPath: string): boolean {
  const patternSegments = pattern.split("/");
  const clientSegments = clientPath.split("/");
  if (patternSegments.length !== clientSegments.length) return false;
  return patternSegments.every((segment, index) => (
    segment.startsWith(":") || segment === clientSegments[index]
  ));
}

/* ── 4. complete two-direction route accounting ──────────────────────────── */

/** The complete two-way route accounting, shared by the real audit and its controls. */
export function routeConnectivityProblems(input: {
  readonly routes: readonly ServedRoute[];
  readonly references: readonly ClientRouteReference[];
  readonly pending: readonly PendingWireBinding[];
  readonly apiRoutesFile: string;
  readonly clientRoots: readonly string[];
}): readonly string[] {
  const { routes, references, pending, apiRoutesFile, clientRoots } = input;
  const declared = new Map(
    pending.filter(({ binding }) => binding.startsWith("route:")).map((entry) => [entry.binding.slice("route:".length), entry]),
  );
  const problems: string[] = [];
  for (const reference of references) {
    if (routes.some(({ path }) => routeMatches(path, reference.path))) continue;
    problems.push(
      `${reference.file} calls ${reference.path}, which ${apiRoutesFile} does not register`,
    );
  }
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    const called = references.some(({ path }) => routeMatches(route.path, path));
    if (called && declared.has(key)) {
      problems.push(
        `${PENDING_WIRE_BINDINGS_PATH} declares route:${key} unconsumed, but a client now calls it`,
      );
    }
    if (!called && !declared.has(key)) {
      problems.push(
        `${apiRoutesFile} serves ${key} and no client under ${clientRoots.join(", ")} calls it. `
        + `Either wire a caller or add {"binding": "route:${key}", "direction": "served-unconsumed", …} `
        + `to ${PENDING_WIRE_BINDINGS_PATH} naming the consumer that will`,
      );
    }
  }
  for (const key of declared.keys()) {
    if (!routes.some((route) => `${route.method} ${route.path}` === key)) {
      problems.push(`${PENDING_WIRE_BINDINGS_PATH} declares route:${key}, which ${apiRoutesFile} does not serve`);
    }
  }
  return problems;
}

/* ── 5. served-descriptor producers ───────────────────────────────────────── */


const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
/** An `ActionDescriptorWire` literal names its verb as `command:` or `key:`. */
const DESCRIPTOR_COMMAND = /\b(?:command|key)\s*:\s*"([a-z-]+)"/g;

// Strip comments before finding producer verbs; prose cannot make a command reachable.
export function projectedCommandKeys(source: string): readonly string[] {
  const code = source.replaceAll(COMMENTS, " ");
  return [...new Set([...code.matchAll(DESCRIPTOR_COMMAND)].map(([, key]) => key ?? ""))].sort();
}
