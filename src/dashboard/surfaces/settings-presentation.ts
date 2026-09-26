import type { EditableSettingsLeafWire } from "../../domain/dashboard/settings-editor.js";
import { timeoutSetting } from "./settings-timeouts-model.js";

const TITLES: Readonly<Record<string, string>> = {
  "actor.label": "Operator label",
  "browser.headless": "Browser headless",
  "features.debugScreenshots": "Debug screenshots",
  "features.duoWebAuthn": "Duo WebAuthn",
  "display.screenWidth": "Screen width",
  "display.screenHeight": "Screen height",
};
const NOTES: Readonly<Record<string, string>> = {
  "actor.label": "Name shown in new run records",
  "browser.headless": "Run browser sessions without a visible window",
  "features.debugScreenshots": "Capture extra diagnostic images",
  "features.duoWebAuthn": "Use WebAuthn for Duo sign-in",
};

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/\b(ms|dir|url|ocr|ukg|crm|i9|ai)\b/giu, word => ({
    ms: "ms", dir: "directory", url: "URL", ocr: "OCR", ukg: "UKG", crm: "CRM", i9: "I-9", ai: "AI",
  })[word.toLowerCase()] ?? word).replace(/^./u, first => first.toUpperCase());
}

export function settingObjectFieldTitle(name: string): string {
  return ({
    timeoutMs: "Timeout (ms)",
    concurrency: "Concurrent requests",
    requestsPerMinute: "Requests per minute",
    dailyRequestLimit: "Daily request limit",
    costLimitUsdMicros: "Cost limit (USD micros)",
  } as Record<string, string>)[name] ?? humanize(name);
}

export function settingTitle(leaf: EditableSettingsLeafWire): string {
  const timeout = timeoutSetting(leaf.path);
  if (timeout !== undefined) return timeout.title;
  if (TITLES[leaf.path] !== undefined) return TITLES[leaf.path];
  if (leaf.control.input === "object" && leaf.path.startsWith("providers.")) return `${humanize(leaf.path.split(".")[1] ?? "Provider")} budget`;
  if (!leaf.label.includes(" · ")) return leaf.label;
  const segment = leaf.path.split(".").at(-1) ?? leaf.label;
  const title = humanize(segment);
  if (leaf.path.startsWith("timeouts.") && segment.endsWith("Ms")) return `${title.replace(/ ms$/u, "")} timeout`;
  if (leaf.path.startsWith("providers.") && segment === "models") {
    return `${humanize(leaf.path.split(".")[1] ?? "")} model order`;
  }
  return title;
}

export function settingNote(leaf: EditableSettingsLeafWire): string | undefined {
  const timeout = timeoutSetting(leaf.path);
  if (timeout !== undefined) return timeout.description;
  return NOTES[leaf.path] ?? (leaf.description === leaf.label ? undefined : leaf.description);
}
