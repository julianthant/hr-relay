import type { EditableSettingsLeafWire } from "../../domain/dashboard/settings-editor.js";

export type TimeoutUnit = "seconds" | "minutes";
type TimeoutSetting = Readonly<{
  title: string;
  description: string;
  group: "Navigation" | "Work" | "Sign-in & Duo";
  preferredUnit: TimeoutUnit;
  storedUnit: "milliseconds" | "seconds";
}>;

const TIMEOUT_SETTINGS: Readonly<Record<string, TimeoutSetting>> = {
  "timeouts.navigationMs": { title: "Standard navigation", description: "Maximum wait for a regular page change.", group: "Navigation", preferredUnit: "seconds", storedUnit: "milliseconds" },
  "timeouts.longNavigationMs": { title: "Long navigation", description: "Maximum wait for a page known to load slowly.", group: "Navigation", preferredUnit: "seconds", storedUnit: "milliseconds" },
  "timeouts.ukgNavigationMs": { title: "UKG navigation", description: "Maximum wait for a UKG page change.", group: "Navigation", preferredUnit: "seconds", storedUnit: "milliseconds" },
  "timeouts.taskMs": { title: "Task", description: "Maximum time for one worker task after a session is ready.", group: "Work", preferredUnit: "minutes", storedUnit: "milliseconds" },
  "timeouts.transactionMs": { title: "Transaction", description: "Maximum time allowed for a transaction operation.", group: "Work", preferredUnit: "minutes", storedUnit: "milliseconds" },
  "timeouts.retryDelayMs": { title: "Retry delay", description: "Wait before retrying an eligible operation.", group: "Work", preferredUnit: "seconds", storedUnit: "milliseconds" },
  "timeouts.sessionAcquireMs": { title: "Session acquisition", description: "Maximum time to open a browser session and sign in.", group: "Sign-in & Duo", preferredUnit: "seconds", storedUnit: "milliseconds" },
  "timeouts.duoCeremonyLeaseGraceMs": { title: "Duo lease grace", description: "Extra time reserved for Duo session cleanup.", group: "Sign-in & Duo", preferredUnit: "seconds", storedUnit: "milliseconds" },
  "timeouts.duoApprovalSeconds": { title: "Duo approval", description: "Maximum wait for a standard Duo approval.", group: "Sign-in & Duo", preferredUnit: "minutes", storedUnit: "seconds" },
  "timeouts.duoApprovalCrmSeconds": { title: "CRM Duo approval", description: "Maximum wait for Duo approval during CRM sign-in.", group: "Sign-in & Duo", preferredUnit: "seconds", storedUnit: "seconds" },
};

export function timeoutSetting(path: string): TimeoutSetting | undefined {
  const setting = TIMEOUT_SETTINGS[path];
  if (path.startsWith("timeouts.") && setting === undefined) throw new Error("settings-timeout-presentation-missing");
  return setting;
}

function storedValue(leaf: EditableSettingsLeafWire): number {
  if (typeof leaf.effectiveValue !== "number" || !Number.isSafeInteger(leaf.effectiveValue) || leaf.effectiveValue <= 0) {
    throw new Error("settings-timeout-value-invalid");
  }
  return leaf.effectiveValue;
}

export function timeoutDisplayUnit(leaf: EditableSettingsLeafWire): TimeoutUnit {
  const setting = timeoutSetting(leaf.path);
  if (setting === undefined) throw new Error("settings-timeout-unknown");
  const value = storedValue(leaf);
  const minuteFactor = setting.storedUnit === "milliseconds" ? 60_000 : 60;
  return setting.preferredUnit === "minutes" && BigInt(value) * 1_000n % BigInt(minuteFactor) === 0n ? "minutes" : "seconds";
}

function displayFactor(leaf: EditableSettingsLeafWire, unit?: TimeoutUnit): number {
  const setting = timeoutSetting(leaf.path);
  if (setting === undefined) throw new Error("settings-timeout-unknown");
  const displayUnit = unit ?? timeoutDisplayUnit(leaf);
  if (displayUnit === "minutes") return setting.storedUnit === "milliseconds" ? 60_000 : 60;
  return setting.storedUnit === "milliseconds" ? 1_000 : 1;
}

export function timeoutInput(leaf: EditableSettingsLeafWire, value: number, unit?: TimeoutUnit): string {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("settings-timeout-value-invalid");
  const factor = BigInt(displayFactor(leaf, unit));
  const scaled = BigInt(value) * 1_000n;
  if (scaled % factor !== 0n) throw new Error("settings-timeout-display-inexact");
  const thousandths = scaled / factor;
  const whole = thousandths / 1_000n;
  const fraction = thousandths % 1_000n;
  return fraction === 0n ? String(whole) : `${String(whole)}.${String(fraction).padStart(3, "0").replace(/0+$/u, "")}`;
}

export function timeoutReadableValue(leaf: EditableSettingsLeafWire, value: unknown): string {
  if (typeof value !== "number") throw new Error("settings-timeout-value-invalid");
  return `${timeoutInput(leaf, value)} ${timeoutDisplayUnit(leaf)}`;
}

export function timeoutValue(leaf: EditableSettingsLeafWire, raw: string, unit?: TimeoutUnit): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(raw);
  if (match === null) throw new Error("settings-timeout-input-invalid");
  const fractional = match[2] ?? "";
  const divisor = 10n ** BigInt(fractional.length);
  const numerator = BigInt(match[1]) * divisor + BigInt(fractional || "0");
  const scaled = numerator * BigInt(displayFactor(leaf, unit));
  if (scaled % divisor !== 0n) throw new Error("settings-timeout-input-inexact");
  const value = scaled / divisor;
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("settings-timeout-input-out-of-range");
  return Number(value);
}
