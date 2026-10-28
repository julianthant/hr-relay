import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
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

export class ProfileBrowserRootRefusalError extends Error {
  readonly code = "PROFILE_BROWSER_ROOT_REFUSED";
  constructor() { super(ERROR_CATALOG.PROFILE_BROWSER_ROOT_REFUSED.text); this.name = "ProfileBrowserRootRefusalError"; }
}
