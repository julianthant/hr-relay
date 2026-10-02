import type { EditableSettingsLeafWire } from "../../models/dashboard/settings-editor.js";
import { timeoutSetting } from "./settings-timeouts-model.js";

export const PERFORMANCE_GROUPS = ["Navigation", "Work", "Sign-in & Duo", "Worker scheduling", "Retry & termination", "OCR processing", "Browser recovery", "Other limits"] as const;
export type PerformanceGroup = typeof PERFORMANCE_GROUPS[number];

const PRESENTATION: Readonly<Record<string, { title: string; group: PerformanceGroup; unit: string }>> = {
  "concurrency.defaultWorkers": { title: "Default workers", group: "Worker scheduling", unit: "workers" },
  "daemon.idleMs": { title: "Idle interval", group: "Worker scheduling", unit: "seconds" },
  "daemon.idleRepollMs": { title: "Idle repoll interval", group: "Worker scheduling", unit: "seconds" },
  "performance.navigationRetries": { title: "Navigation retries", group: "Retry & termination", unit: "attempts" },
  "performance.separationTerminationWindowDays": { title: "Separation termination window", group: "Retry & termination", unit: "days" },
  "ocr.secondOpinionMax": { title: "Second opinion limit", group: "OCR processing", unit: "attempts" },
  "ocr.pageMaxWaitMs": { title: "Page maximum wait", group: "OCR processing", unit: "seconds" },
  "ocr.tier1PatienceMs": { title: "Tier 1 patience", group: "OCR processing", unit: "seconds" },
  "ocr.pageConcurrency": { title: "Page concurrency", group: "OCR processing", unit: "pages" },
  "ocr.disambigConcurrency": { title: "Disambiguation concurrency", group: "OCR processing", unit: "requests" },
  "ocr.suggestConcurrency": { title: "Suggestion concurrency", group: "OCR processing", unit: "requests" },
  "ocr.backoffBaseMs": { title: "Backoff base", group: "OCR processing", unit: "seconds" },
  "ocr.backoffCapMs": { title: "Backoff cap", group: "OCR processing", unit: "seconds" },
  "ocr.maxValidationRetries": { title: "Validation retries", group: "OCR processing", unit: "attempts" },
  "browserHealth.monitorTickMs": { title: "Monitor interval", group: "Browser recovery", unit: "seconds" },
  "browserHealth.maxAutoRefresh": { title: "Automatic refresh limit", group: "Browser recovery", unit: "attempts" },
  "browserHealth.maxReopen": { title: "Reopen limit", group: "Browser recovery", unit: "attempts" },
  "browser.closeProofMs": { title: "Close proof timeout", group: "Browser recovery", unit: "seconds" },
};

export function performancePresentation(path: string) { return PRESENTATION[path]; }

export function performanceSectionGroups(leaves: readonly EditableSettingsLeafWire[]) {
  const groups = new Map<PerformanceGroup, EditableSettingsLeafWire[]>();
  for (const leaf of leaves) {
    const group = performancePresentation(leaf.path)?.group ?? timeoutSetting(leaf.path)?.group ?? "Other limits";
    const members = groups.get(group) ?? [];
    members.push(leaf);
    groups.set(group, members);
  }
  return PERFORMANCE_GROUPS.filter(group => groups.has(group)).map(title => ({ title, leaves: groups.get(title)! }));
}
