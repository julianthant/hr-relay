import type { RuntimeAdmission } from "./admission.js";

const issued = new WeakSet<RuntimeAdmission>();

export function registerRuntimeAdmission(admission: RuntimeAdmission): void {
  issued.add(admission);
}

export function requireRuntimeAdmission(value: RuntimeAdmission | undefined): RuntimeAdmission {
  if (value === undefined || !issued.has(value)) throw new Error("runtime-admission: required");
  value.assertLive();
  return value;
}
