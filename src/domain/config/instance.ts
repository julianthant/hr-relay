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

export function resolveSystemEntryUrl(
  config: Config,
  system: BrowserSystemId,
  instance: RuntimeInstance,
  runId: string,
): string {
  const urls = entryUrls(config, system);
  if (instance === "prod") return urls.prod;
  if (urls.test === undefined || urls.test === urls.prod) {
    throw new Error(
      `run ${runId} requested TEST instance for ${system} but no distinct test URL is configured; refusing production fallback`,
    );
  }
  return urls.test;
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
