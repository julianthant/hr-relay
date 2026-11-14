import { z } from "zod";
import { SETTINGS_CATALOG } from "../../../../models/config/catalog.js";
import { isRetiredSettingsPath } from "../../../../models/config/settings.js";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";
import type { AssistantPlugin } from "../plugin.js";
import type { AssistantPluginDeps } from "../registry.js";

const KEYS = SETTINGS_CATALOG.filter(row => row.sourceClass === "ordinary-settings" && row.sensitivity === "ordinary" && row.editability === "operator" && !isRetiredSettingsPath(row.key)).map(row => row.key);

function at(settings: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => typeof node === "object" && node !== null ? Reflect.get(node, part) : undefined, settings);
}

export function settingsPlugin(deps: AssistantPluginDeps): AssistantPlugin {
  const parameters = z.strictObject({ key: z.enum(KEYS as [string, ...string[]]).nullable() });
  const Output = z.strictObject({ settings: z.array(z.strictObject({ key: z.enum(KEYS as [string, ...string[]]), value: z.union([z.boolean(), z.number(), z.enum(["set", "unset"])]) })) });
  return { domain: "settings", tools: [{
    kind: "read", tier: "read", name: "read_settings",
    description: "Read one ordinary setting by key, or all of them with key null: on/off and number values as they are, other values only as set or unset. Changes are made in Settings by the operator.",
    parameters, output: Output, privacy: [],
    async invoke(value, context) {
      const { key: only } = parameters.parse(value);
      const settings = deps.settings();
      context.assertCurrent();
      return JsonValueSchema.parse({ settings: KEYS.filter(key => only === null || key === only).map(key => {
        const current = at(settings, key);
        return { key, value: typeof current === "boolean" || typeof current === "number" ? current : current === undefined || current === null ? "unset" : "set" };
      }) });
    },
  }] };
}
