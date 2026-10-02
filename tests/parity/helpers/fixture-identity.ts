import { descriptorSetHash } from "../../../src/backend/app/dashboard/compose.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";


/* ── identity helpers (aligned with tests/helpers/backend/dashboard-harness.ts) ── */

export function uuidOf(seed: number): string {
  const digits = String(seed).padStart(12, "0");
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-4000-8000-${digits}`;
}


export function traceOf(seed: number): string {
  const tick = String(seed % 60).padStart(2, "0");
  return `pl-09${tick}${tick}-${String(seed % 10000).padStart(4, "0")}`;
}


export const FIXTURE_DAY = "2026-08-03";

/** The pinned browser clock for parity captures — everything below is in its past. */
export const FIXTURE_NOW = "2026-08-03T10:05:00.000-07:00";

export const FIXTURE_APP_VERSION = "0.1.0";


export const CONTRACT_FINGERPRINT = personLookupDescriptor.contractFingerprint;

export const FIXTURE_DESCRIPTOR_HASH = descriptorSetHash([CONTRACT_FINGERPRINT]);

export const CONFIG_FINGERPRINT = "b".repeat(64);

export const WORKFLOW_ID = personLookupDescriptor.id;


export const at = (minute: number, second = 0): string =>
  `2026-08-03T09:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000-07:00`;
