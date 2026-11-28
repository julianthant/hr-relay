import { z } from "zod";
import { SETTINGS_CATALOG } from "../../../../models/config/catalog.js";
import { SETTINGS_SCHEMA_HASH, SettingsPatchSchema, deriveRawSettingsPatchFingerprint, isRetiredSettingsPath } from "../../../../models/config/settings.js";
import { SettingsCommandRequestSchema } from "../../../../rules/commands/commands.js";
import { JsonValueSchema, canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { settingsLabel } from "../../../runs/queries/settings-editor.js";
import { editValueSpellings, observeEdit, operatorEditSource, requireEditRead, requireOperatorEdit, requireOperatorSource } from "../../applied-edits.js";
import { AssistantChangeOutput, AssistantToolRefusal, type AssistantPlugin } from "../plugin.js";
import type { AssistantPluginDeps } from "../registry.js";

const KEYS = SETTINGS_CATALOG.filter(row => row.sourceClass === "ordinary-settings" && row.sensitivity === "ordinary"
  && row.editability === "operator" && !isRetiredSettingsPath(row.key)).map(row => row.key);
const matchesKey = (key: string) => KEYS.some(candidate => candidate === key
  || candidate === key.replace(/^annualDates\.FY\d{4}\./u, "annualDates.*."));
const EditInput = z.strictObject({ key: z.string().min(1).max(160),
  operation: z.enum(["set-text", "set-json", "enable", "disable", "clear"]), source: z.string().min(1).max(2000).nullable() });

function settingCommands(key: string, operation: z.infer<typeof EditInput>["operation"], source: string): readonly string[] {
  const label = settingsLabel(key);
  const targets = [key, label, label.toLowerCase(), ...(key === "browser.headless" ? ["headless mode", "headless browser mode"] : [])];
  const word = source.toLowerCase();
  return targets.flatMap(target => {
    switch (operation) {
      case "set-text": return editValueSpellings(source).map(value => `set ${target} to ${value}`);
      case "set-json": return [`set ${target} to ${source}`];
      case "clear": return word === "default" ? [`reset ${target} to ${source}`] : [`${word} ${target}`];
      default:
        if (word === "enable" || word === "disable") return [`${word} ${target}`];
        return word === "on" || word === "off" ? [`turn ${target} ${source}`, `set ${target} to ${source}`] : [`set ${target} to ${source}`];
    }
  });
}

function at(settings: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => typeof node === "object" && node !== null ? Reflect.get(node, part) : undefined, settings);
}

const display = (value: unknown): string => value === undefined ? "Unset"
  : value === true ? "On" : value === false ? "Off" : typeof value === "string" && value.length > 0 ? value : canonicalJsonStringify(value);

export function settingsPlugin(deps: Pick<AssistantPluginDeps, "settings" | "settingsRecord" | "edits">): AssistantPlugin {
  const parameters = z.strictObject({ key: z.string().min(1).max(160).nullable() });
  const Output = z.strictObject({ settings: z.array(z.strictObject({ key: z.string().regex(/^[A-Za-z0-9.*-]+$/u),
    value: z.union([z.boolean(), z.number(), z.enum(["set", "unset"])]) })) });
  const tools: AssistantPlugin["tools"][number][] = [{
    kind: "read", tier: "read", name: "read_settings",
    description: "Read ordinary settings (key null lists keys). Shows booleans and numbers, otherwise set or unset.",
    parameters, output: Output, privacy: [],
    async invoke(value, context) {
      const { key } = parameters.parse(value);
      if (key !== null && !matchesKey(key)) throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED");
      const record = deps.settingsRecord?.(), settings = record === undefined ? deps.settings() : record.settings;
      context.assertCurrent();
      return JsonValueSchema.parse({ settings: (key === null ? KEYS : [key]).map(path => {
        const current = at(settings, path);
        if (record !== undefined) observeEdit(context, `settings:${path}`, record.revision);
        return { key: path, value: typeof current === "boolean" || typeof current === "number" ? current : current === undefined || current === null ? "unset" : "set" };
      }) });
    },
  }];
  const { edits, settingsRecord } = deps;
  if (edits !== undefined && settingsRecord !== undefined) tools.push({
    kind: "change", tier: "write-local", name: "change_settings",
    description: "Edit one read setting only on an explicit Set, Turn, Enable, Disable or Reset request naming it. Quote the exact operator value as source or pass null. Use set-json for numbers and JSON.",
    parameters: EditInput, output: AssistantChangeOutput, privacy: [],
    async change(input, context) {
      const { key, operation, source } = EditInput.parse(input);
      if (!matchesKey(key) || key.includes("*") || key === "preferences.assistantFullAccess") throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED");
      const supplied = requireOperatorSource(context, source);
      const words = { enable: /^(?:enable|on|true)$/iu, disable: /^(?:disable|off|false)$/iu, clear: /^(?:clear|reset|default|unset)$/iu };
      if (operation !== "set-text" && operation !== "set-json" && !words[operation].test(supplied)) {
        throw new AssistantToolRefusal("ASSISTANT_VALUE_NEEDS_SOURCE");
      }
      requireOperatorEdit(context, settingCommands(key, operation, supplied));
      let value: unknown = operation === "enable" ? true : operation === "disable" ? false : supplied;
      if (operation === "set-json") {
        try { value = JSON.parse(supplied) as unknown; } catch { throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED"); }
      }
      const parsed = SettingsPatchSchema.safeParse({ [key]: operation === "clear" ? { clear: true } : { set: value } });
      if (!parsed.success) throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED");
      return () => edits.apply(context, owner => {
        const current = settingsRecord();
        requireEditRead(context, `settings:${key}`, current.revision);
        const before = at(current.settings, key);
        const patch = parsed.data;
        const result = owner.execute(SettingsCommandRequestSchema.parse({ commandId: owner.id, requestedAt: owner.at, requestedBy: context.actorId, source: "assistant",
          family: "settings", type: "apply-settings", target: { expectedRevision: current.revision },
          payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveRawSettingsPatchFingerprint(patch), patch } }));
        if (result.state !== "applied") throw new AssistantToolRefusal("ASSISTANT_EDIT_REFUSED");
        const saved = settingsRecord(), after = at(saved.settings, key);
        if (saved.revision !== result.settingsRevision || saved.revision !== current.revision + 1) throw new Error("assistant-edit-settings-readback-mismatch");
        const next = after === undefined ? { clear: true as const } : { set: JsonValueSchema.parse(after) };
        return { details: { kind: "settings", command: "apply-settings", path: key, revision: saved.revision,
          prior: before === undefined ? { clear: true } : { set: JsonValueSchema.parse(before) }, next },
          label: `Changed ${settingsLabel(key)}`, before: display(before), after: display(after), source: operatorEditSource(context, JsonValueSchema.parse(next)) };
      });
    },
  });
  return { domain: "settings", tools };
}
