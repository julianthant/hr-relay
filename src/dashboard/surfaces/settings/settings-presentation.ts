import type { EditableSettingsLeafWire } from "../../../models/dashboard/settings-editor.js";
import { timeoutSetting } from "./general/settings-timeouts-model.js";
import { performancePresentation } from "./general/settings-performance-model.js";

const TITLES: Readonly<Record<string, string>> = {
  "actor.label": "Operator label",
  "browser.headless": "Run without a browser window",
  "features.debugScreenshots": "Debug screenshots",
  "features.duoWebAuthn": "Duo WebAuthn",
  "display.screenWidth": "Width",
  "display.screenHeight": "Height",
  "paths.reportsDir": "Reports",
  "paths.downloadsDir": "Downloads",
  "paths.onboardingDocsDir": "Documents",
  "paths.i9CheckTrackerPath": "I-9 check tracker",
  "paths.browserProfileRoot": "Browser profile folder",
  "paths.duoExtensionDir": "Duo extension folder",
};
const NOTES: Readonly<Record<string, string>> = {
  "concurrency.defaultWorkers": "Configured default worker count for this runtime.",
  "daemon.idleMs": "Configured idle duration for the daemon.",
  "daemon.idleRepollMs": "Maximum time between worker queue checks while idle.",
  "performance.navigationRetries": "Configured limit for navigation retry attempts.",
  "performance.separationTerminationWindowDays": "Configured separation termination window in days.",
  "ocr.secondOpinionMax": "Configured limit for OCR second opinions.",
  "ocr.pageMaxWaitMs": "Configured maximum wait for one OCR page.",
  "ocr.tier1PatienceMs": "Configured patience for the first OCR provider tier.",
  "ocr.pageConcurrency": "Configured number of concurrent OCR pages.",
  "ocr.disambigConcurrency": "Configured concurrent disambiguation requests.",
  "ocr.suggestConcurrency": "Configured concurrent suggestion requests.",
  "ocr.backoffBaseMs": "Configured starting delay for OCR retry backoff.",
  "ocr.backoffCapMs": "Configured maximum delay for OCR retry backoff.",
  "ocr.maxValidationRetries": "Configured limit for OCR validation retries.",
  "browserHealth.monitorTickMs": "Configured interval for browser health monitoring.",
  "browserHealth.maxAutoRefresh": "Configured limit for automatic browser refreshes.",
  "browserHealth.maxReopen": "Configured limit for browser reopen attempts.",
  "browser.closeProofMs": "Time allowed to verify a browser session closed.",
  "actor.label": "Name shown in new run records.",
  "browser.headless": "Use headless browser sessions.",
  "features.debugScreenshots": "Capture extra diagnostic images.",
  "features.duoWebAuthn": "Use WebAuthn for Duo sign-in.",
  "paths.reportsDir": "CSV and XLSX exports.",
  "paths.downloadsDir": "Files downloaded during runs.",
  "paths.onboardingDocsDir": "Onboarding documents.",
  "paths.i9CheckTrackerPath": "Workbook used to track I-9 checks.",
  "paths.browserProfileRoot": "Fresh folder for browser sessions in new runs.",
  "paths.duoExtensionDir": "Unpacked Duo browser extension for new runs.",
};

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/\b(ms|dir|url|ocr|ukg|crm|i9|ai)\b/giu, word => ({
    ms: "ms", dir: "directory", url: "URL", ocr: "OCR", ukg: "UKG", crm: "CRM", i9: "I-9", ai: "AI",
  })[word.toLowerCase()] ?? word).replace(/^./u, first => first.toUpperCase());
}

export function settingPlaceholderCopy(path: string): { label: string; description?: string } {
  const label = TITLES[path];
  if (label === undefined) throw new Error(`settings-placeholder-copy-missing:${path}`);
  return { label, description: NOTES[path] };
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
  if (timeout !== undefined) return timeout.description ?? NOTES[leaf.path];
  if (leaf.path.endsWith(".jobEndDate")) return "Default end date for job records.";
  if (leaf.path.endsWith(".kronosDefaultEndDate")) return "Default end date for Kronos reports";
  if (leaf.path.endsWith(".kronosDefaultStartDate")) return "Default start date for Kronos reports";
  return NOTES[leaf.path] ?? (leaf.description === leaf.label ? undefined : leaf.description);
}
