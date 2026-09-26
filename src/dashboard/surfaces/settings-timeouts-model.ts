import type { EditableSettingsLeafWire } from "../../domain/dashboard/settings-editor.js";

type TimeoutSetting = Readonly<{
  title: string;
  description: string;
  group: "Navigation" | "Work" | "Sign-in & Duo";
  storedUnit: "milliseconds" | "seconds";
}>;

const TIMEOUT_SETTINGS: Readonly<Record<string, TimeoutSetting>> = {
  "timeouts.navigationMs": { title: "Standard navigation", description: "Maximum wait for a regular page change.", group: "Navigation", storedUnit: "milliseconds" },
  "timeouts.longNavigationMs": { title: "Long navigation", description: "Maximum wait for a page known to load slowly.", group: "Navigation", storedUnit: "milliseconds" },
  "timeouts.ukgNavigationMs": { title: "UKG navigation", description: "Maximum wait for a UKG page change.", group: "Navigation", storedUnit: "milliseconds" },
  "timeouts.taskMs": { title: "Task", description: "Maximum time for one worker task after a session is ready.", group: "Work", storedUnit: "milliseconds" },
  "timeouts.transactionMs": { title: "Transaction", description: "Maximum time allowed for a transaction operation.", group: "Work", storedUnit: "milliseconds" },
  "timeouts.retryDelayMs": { title: "Retry delay", description: "Wait before retrying an eligible operation.", group: "Work", storedUnit: "milliseconds" },
  "timeouts.sessionAcquireMs": { title: "Session acquisition", description: "Maximum time to open a browser session and sign in.", group: "Sign-in & Duo", storedUnit: "milliseconds" },
  "timeouts.duoCeremonyLeaseGraceMs": { title: "Duo lease grace", description: "Extra time reserved for Duo session cleanup.", group: "Sign-in & Duo", storedUnit: "milliseconds" },
  "timeouts.duoApprovalSeconds": { title: "Duo approval", description: "Maximum wait for a standard Duo approval.", group: "Sign-in & Duo", storedUnit: "seconds" },
  "timeouts.duoApprovalCrmSeconds": { title: "CRM Duo approval", description: "Maximum wait for Duo approval during CRM sign-in.", group: "Sign-in & Duo", storedUnit: "seconds" },
};

export function timeoutSetting(path: string): TimeoutSetting | undefined {
  const setting = TIMEOUT_SETTINGS[path];
  if (path.startsWith("timeouts.") && setting === undefined) throw new Error("settings-timeout-presentation-missing");
  return setting;
}

function millisecondsPerDisplayedSecond(leaf: EditableSettingsLeafWire): number {
  const setting = timeoutSetting(leaf.path);
  if (setting === undefined) throw new Error("settings-timeout-unknown");
  return setting.storedUnit === "milliseconds" ? 1_000 : 1;
}

export function timeoutInput(leaf: EditableSettingsLeafWire, value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("settings-timeout-value-invalid");
  const factor = BigInt(millisecondsPerDisplayedSecond(leaf));
  const thousandths = BigInt(value) * 1_000n / factor;
  if ((BigInt(value) * 1_000n) % factor !== 0n) throw new Error("settings-timeout-display-inexact");
  const whole = thousandths / 1_000n;
  const fraction = thousandths % 1_000n;
  return fraction === 0n ? String(whole) : `${String(whole)}.${String(fraction).padStart(3, "0").replace(/0+$/u, "")}`;
}

export function timeoutReadableValue(leaf: EditableSettingsLeafWire, value: unknown): string {
  if (typeof value !== "number") throw new Error("settings-timeout-value-invalid");
  return `${timeoutInput(leaf, value)} seconds`;
}

export function timeoutValue(leaf: EditableSettingsLeafWire, raw: string): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(raw);
  if (match === null) throw new Error("settings-timeout-input-invalid");
  const fractional = match[2] ?? "";
  const divisor = 10n ** BigInt(fractional.length);
  const numerator = BigInt(match[1]) * divisor + BigInt(fractional || "0");
  const scaled = numerator * BigInt(millisecondsPerDisplayedSecond(leaf));
  if (scaled % divisor !== 0n) throw new Error("settings-timeout-input-inexact");
  const value = scaled / divisor;
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("settings-timeout-input-out-of-range");
  return Number(value);
}
