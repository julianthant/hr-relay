import type { EditableSettingsLeafWire } from "../../domain/dashboard/settings-editor.js";
import { timeoutSetting } from "./settings-timeouts-model.js";
import { performancePresentation } from "./settings-performance-model.js";

const TITLES: Readonly<Record<string, string>> = {
  "actor.label": "Operator label",
  "browser.headless": "Run without a browser window",
  "features.debugScreenshots": "Debug screenshots",
  "features.duoWebAuthn": "Duo WebAuthn",
  "display.screenWidth": "Width",
  "display.screenHeight": "Height",
  "paths.reportsDir": "Reports directory",
  "paths.downloadsDir": "Downloads directory",
  "paths.onboardingDocsDir": "Onboarding documents",
  "paths.i9CheckTrackerPath": "I-9 check tracker",
  "paths.browserProfileRoot": "Browser profile folder",
  "paths.duoCredential": "Duo credential file",
  "paths.duoExtensionDir": "Duo extension folder",
};
const NOTES: Readonly<Record<string, string>> = {
  "actor.label": "Name shown in new run records.",
  "browser.headless": "Use headless browser sessions.",
  "features.debugScreenshots": "Capture extra diagnostic images.",
  "features.duoWebAuthn": "Use WebAuthn for Duo sign-in.",
  "paths.reportsDir": "Where generated reports are written.",
  "paths.downloadsDir": "Where browser downloads are kept.",
  "paths.onboardingDocsDir": "Folder containing onboarding documents.",
  "paths.i9CheckTrackerPath": "Workbook used to track I-9 checks.",
  "paths.browserProfileRoot": "Fresh folder for browser sessions in new runs.",
  "paths.duoCredential": "Existing private Duo credential file; independent of the profile folder.",
  "paths.duoExtensionDir": "Unpacked Duo browser extension for new runs.",
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
  const performance = performancePresentation(leaf.path);
  if (performance !== undefined) return performance.title;
  const timeout = timeoutSetting(leaf.path);
  if (timeout !== undefined) return timeout.title;
  if (leaf.path.endsWith(".jobEndDate")) return "Job end date";
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
  if (leaf.path.endsWith(".jobEndDate")) return "Default end date for job records.";
  if (leaf.path.endsWith(".kronosDefaultEndDate")) return "Default end date for Kronos reports";
  if (leaf.path.endsWith(".kronosDefaultStartDate")) return "Default start date for Kronos reports";
  return NOTES[leaf.path] ?? (leaf.description === leaf.label ? undefined : leaf.description);
}
