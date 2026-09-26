import { z } from "zod";
import { BrowserSystemIdSchema, type BrowserSystemId } from "../ids.js";
import type { Config } from "./schema.js";

/** Historical records can still name test; new run resolution refuses it. */
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

function entryUrl(config: Config, system: BrowserSystemId): string {
  switch (system) {
    case "ucpath": return config.urls.ucpath.prod.smartHr;
    case "crm": return config.urls.crm.prod.entry;
    case "onbase": return config.urls.onbase.prod.entry;
    case "kuali": return config.urls.kuali.prod.entry;
    case "servicenow": return config.urls.servicenow.prod.entry;
    case "i9": return config.urls.i9.prod.entry;
    case "new-kronos": return config.urls.newKronos.prod.entry;
    case "old-kronos": return config.urls.oldKronos.prod.entry;
    case "sharepoint": return config.urls.sharepoint.prod.entry;
  }
}

/** Compatibility projection for the retired System hosts read. */
export function listSystemEntryHosts(config: Config) {
  return BrowserSystemIdSchema.options.map(system => Object.freeze({
    system,
    prod: entryUrl(config, system),
    test: { state: "not-provisioned" as const },
  }));
}

/** Test targeting is rejected even when a historical request still parses. */
export function resolveSystemEntryUrl(
  config: Config,
  system: BrowserSystemId,
  instance: RuntimeInstance,
  context: string,
): string {
  if (instance !== "prod") throw new Error(`${context} requested a retired test instance for ${system}`);
  return entryUrl(config, system);
}

/** UCPath login enters through its portal before navigating a task route. */
export function resolveSystemLoginUrl(
  config: Config,
  system: BrowserSystemId,
  instance: RuntimeInstance,
  context: string,
): string {
  if (instance !== "prod") throw new Error(`${context} requested a retired test instance for ${system}`);
  return system === "ucpath" ? config.urls.ucpath.prod.login : entryUrl(config, system);
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
  if (Object.values(requested).some(instance => instance === "test")) {
    throw new Error(`run ${runId} requested a retired test instance`);
  }
  const requestedKeys = Object.keys(requested);
  const extra = requestedKeys.filter(system => !systems.includes(BrowserSystemIdSchema.parse(system)));
  if (extra.length > 0) throw new Error(`run ${runId} requested instances for undeclared systems: ${extra.join(", ")}`);
  const resolved = Object.fromEntries(systems.map(system => {
    resolveSystemEntryUrl(config, system, "prod", runId);
    return [system, "prod"];
  }));
  return ResolvedInstanceSchema.parse(resolved);
}
