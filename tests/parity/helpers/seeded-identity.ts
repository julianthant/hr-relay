import { personLookupDescriptor } from "../../helpers/registered-workflows.js";


/* ── the pinned instant (aligned with the fixture corpus) ────────────────── */

export const SEEDED_DAY = "2026-08-03";

export const SEEDED_AT = new Date("2026-08-03T10:00:00.000-07:00");

export const SEEDED_NOW = SEEDED_AT.toISOString();

export const SEEDED_APP_VERSION = "0.1.0";


export const WORKFLOW_ID = personLookupDescriptor.id;

export const CONTRACT_FINGERPRINT = personLookupDescriptor.contractFingerprint;

export const CONFIG_FINGERPRINT = "b".repeat(64);

export const INGRESS_SCHEMA_HASH = "a".repeat(64);

export const FAILURE_FINGERPRINT = "c".repeat(64);

export const CONFIG_SNAPSHOT_ID = "44444444-4444-4444-8444-444444444444";
