import { z } from "zod";
import { BrowserSystemIdSchema, type BrowserSystemId } from "../ids.js";
import type { Config } from "./schema.js";

export const RuntimeInstanceSchema = z.enum(["prod", "test"]);
export const RequestedInstanceSchema = z.strictObject({
  ucpath: RuntimeInstanceSchema.optional(),
  crm: RuntimeInstanceSchema.optional(),
  onbase: RuntimeInstanceSchema.optional(),
  kuali: RuntimeInstanceSchema.optional(),
  servicenow: RuntimeInstanceSchema.optional(),
  i9: RuntimeInstanceSchema.optional(),
  "new-kronos": RuntimeInstanceSchema.optional(),
  "old-kronos": RuntimeInstanceSchema.optional(),
  sharepoint: RuntimeInstanceSchema.optional(),
});
export const ResolvedInstanceSchema = RequestedInstanceSchema;

export type RuntimeInstance = z.infer<typeof RuntimeInstanceSchema>;
export type RequestedInstance = z.infer<typeof RequestedInstanceSchema>;
export type ResolvedInstance = z.infer<typeof ResolvedInstanceSchema>;

function entryUrls(config: Config, system: BrowserSystemId): { readonly prod: string; readonly test?: string } {
  switch (system) {
    case "ucpath": return { prod: config.urls.ucpath.prod.smartHr, test: config.urls.ucpath.test?.smartHr };
    case "crm": return { prod: config.urls.crm.prod.entry, test: config.urls.crm.test?.entry };
    case "onbase": return { prod: config.urls.onbase.prod.entry, test: config.urls.onbase.test?.entry };
    case "kuali": return { prod: config.urls.kuali.prod.entry, test: config.urls.kuali.test?.entry };
    case "servicenow": return { prod: config.urls.servicenow.prod.entry, test: config.urls.servicenow.test?.entry };
    case "i9": return { prod: config.urls.i9.prod.entry, test: config.urls.i9.test?.entry };
    case "new-kronos": return { prod: config.urls.newKronos.prod.entry, test: config.urls.newKronos.test?.entry };
    case "old-kronos": return { prod: config.urls.oldKronos.prod.entry, test: config.urls.oldKronos.test?.entry };
    case "sharepoint": return { prod: config.urls.sharepoint.prod.entry, test: config.urls.sharepoint.test?.entry };
  }
}

/**
 * The ONE distinctness rule every reader of a configured test URL applies: a
 * `test` entry that is absent, or byte-identical to `prod`, is not a usable
 * test URL. `listSystemEntryHosts`, `resolveSystemEntryUrl` and
 * `resolveSystemLoginUrl` each used to restate this comparison — three
 * `!== undefined && !== prod` checks with docstrings claiming they agreed —
 * so a change to one could silently stop matching the other two. There is
 * exactly one comparison now, and all three call it (unit F11b finding 1).
 */
function distinctTestUrl(urls: { readonly prod: string; readonly test?: string }): string | undefined {
  return urls.test !== undefined && urls.test !== urls.prod ? urls.test : undefined;
}

/**
 * One system's configured entry hosts, as a READ states them (never as a run
 * resolves them). Neither this nor `SystemEntryTestHost` is exported: they are
 * the shape of `listSystemEntryHosts`'s return and nothing else names them,
 * and an exported type at a boundary owes a zod schema
 * (`strict-boundary-schemas`). The value that crosses a wire is
 * `SystemHostWireSchema` in `domain/dashboard/settings.ts`, which is that
 * schema — `SystemHostTestWireSchema` there is this type's wire counterpart.
 *
 * `test`'s three states, told apart by SHAPE: a deployment can leave the test
 * host unset, set it to something not distinct from production (refused at
 * run time, see `resolveSystemEntryUrl`), or set it to a real, distinct
 * sandbox. Collapsing the first two into one `undefined` is exactly the
 * defect unit F11b finding 2 named: a test host configured IDENTICAL to
 * production rendered as `none provisioned`, indistinguishable from a
 * deployment that never configured one at all — one is a config mistake an
 * operator would want surfaced, the other is an ordinary unconfigured system.
 */
type SystemEntryTestHost =
  | { readonly state: "not-provisioned" }
  | { readonly state: "not-distinct" }
  | { readonly state: "provisioned"; readonly url: string };

interface SystemEntryHosts {
  readonly system: BrowserSystemId;
  readonly prod: string;
  readonly test: SystemEntryTestHost;
}

/**
 * Every browser system's configured entry hosts (Settings → System hosts, SE40).
 *
 * It reads `entryUrls` — the SAME table `resolveSystemEntryUrl` reads — and
 * applies that function's own distinctness rule (`distinctTestUrl`), so a
 * `test` host this returns as `provisioned` is a host a run would actually
 * navigate to. A `test` entry configured identical to `prod` is reported as
 * `not-distinct` rather than `provisioned`, for the same reason it throws in
 * `resolveSystemEntryUrl`: a session that believes it is hitting a sandbox may
 * never silently land on production, and a page advertising a test host every
 * run asking for it would be refused from is the same lie one screen earlier.
 * It is NOT collapsed into `not-provisioned`: "configured wrong" and "never
 * configured" are different facts about the same deployment.
 *
 * It is a READ, so it refuses nothing and throws nothing: every verdict is a
 * value, never an exception.
 */
export function listSystemEntryHosts(config: Config): readonly SystemEntryHosts[] {
  return BrowserSystemIdSchema.options.map((system) => {
    const urls = entryUrls(config, system);
    const distinct = distinctTestUrl(urls);
    const test: SystemEntryTestHost = distinct !== undefined
      ? { state: "provisioned", url: distinct }
      : urls.test !== undefined
        ? { state: "not-distinct" }
        : { state: "not-provisioned" };
    return Object.freeze({ system, prod: urls.prod, test });
  });
}

/** `context` names the requester (a run id, or a worker/system session label). */
export function resolveSystemEntryUrl(
  config: Config,
  system: BrowserSystemId,
  instance: RuntimeInstance,
  context: string,
): string {
  const urls = entryUrls(config, system);
  if (instance === "prod") return urls.prod;
  const distinct = distinctTestUrl(urls);
  if (distinct === undefined) {
    throw new Error(
      `${context} requested TEST instance for ${system} but no distinct test URL is configured; refusing production fallback`,
    );
  }
  return distinct;
}

/**
 * The URL a LOGIN starts at, per system and resolved instance.
 *
 * For every system except UCPath the login entry is the same route a task
 * navigates to. UCPath is different and this is live-verified legacy knowledge:
 * the deep PeopleSoft `smartHr` route is not reachable unauthenticated, so the
 * flow enters at the UCPath portal (`urls.ucpath.<instance>.login`) and rides
 * the "Log in to UCPath" → campus-discovery → Shibboleth hop chain. Ported from
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 * `src/infra/auth/login.ts` (`ucpathNavigateAndFill`).
 *
 * The prod/test rule is §4's, unchanged: `prod` is always the production
 * literal, and `test` throws unless a DISTINCT test URL is configured — a
 * session that believes it is hitting a sandbox can never silently land on
 * production.
 */
export function resolveSystemLoginUrl(
  config: Config,
  system: BrowserSystemId,
  instance: RuntimeInstance,
  context: string,
): string {
  if (system !== "ucpath") return resolveSystemEntryUrl(config, system, instance, context);
  const prod = config.urls.ucpath.prod.login;
  if (instance === "prod") return prod;
  const distinct = distinctTestUrl({ prod, test: config.urls.ucpath.test?.login });
  if (distinct === undefined) {
    throw new Error(
      `${context} requested TEST instance for ucpath but no distinct test login URL is configured; refusing production fallback`,
    );
  }
  return distinct;
}

export function resolveInstances(
  config: Config,
  systemsInput: readonly BrowserSystemId[],
  requestedInput: unknown,
  runId: string,
): ResolvedInstance {
  const systems = z.array(BrowserSystemIdSchema).min(1).superRefine((values, context) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: "systems must be unique" });
  }).parse(systemsInput);
  const requested = RequestedInstanceSchema.optional().default({}).parse(requestedInput);
  const requestedKeys = Object.keys(requested);
  const extra = requestedKeys.filter((system) => !systems.includes(BrowserSystemIdSchema.parse(system)));
  if (extra.length > 0) throw new Error(`run ${runId} requested instances for undeclared systems: ${extra.join(", ")}`);

  const resolved = Object.fromEntries(systems.map((system) => {
    const instance = requested[system] ?? "prod";
    resolveSystemEntryUrl(config, system, instance, runId);
    return [system, instance];
  }));
  return ResolvedInstanceSchema.parse(resolved);
}
