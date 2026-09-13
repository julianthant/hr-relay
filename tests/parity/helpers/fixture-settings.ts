import { manualClock } from "../../../src/domain/clock.js";
import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../src/domain/config/resolve.js";
import { EditableSettingsWireSchema } from "../../../src/domain/dashboard/settings-editor.js";
import {
type SettingsFactsWire
} from "../../../src/domain/dashboard/settings.js";
import { buildSettingsFacts } from "../../../src/server/dashboard/queries/settings.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";
import { CONFIG_FINGERPRINT,FIXTURE_NOW } from "./fixture-identity.js";


/* ── settings facts ──────────────────────────────────────────────────────── */

/**
 * `GET /api/v1/settings/facts` — BUILT by the production fold, never authored.
 *
 * `buildSettingsFacts` is the server's own projection of the resolved config
 * and the descriptor tuple (D274 item 6). Hand-writing a host list or a
 * capability row here would photograph the fixture's opinion of those
 * derivations instead of the derivations — the same reason `fixture-gate.ts`
 * builds its packet rather than spelling one.
 *
 * The inputs are the DEFAULTS and the day corpus's one descriptor: an empty
 * env and empty settings resolve to `ConfigSchema`'s shipped hosts, so the
 * System hosts table is the deployment every developer starts from, and the
 * capability row joins the single `workflows[]` entry the bootstrap above
 * serves. `manualClock` pins the resolution instant so nothing here can be
 * dated by the wall clock.
 */
export const FIXTURE_SETTINGS_FACTS: SettingsFactsWire = buildSettingsFacts({
  config: resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date(FIXTURE_NOW))).config,
  descriptors: [personLookupDescriptor],
});


/** DCC3's deterministic server-issued editor document for the Settings parity states. */
export const FIXTURE_EDITABLE_SETTINGS = EditableSettingsWireSchema.parse({
  revision: 1,
  settingsSchemaHash: "a".repeat(64),
  settingsFingerprint: "b".repeat(64),
  activeConfigFingerprint: CONFIG_FINGERPRINT,
  runtimeStatus: { state: "current", identity: { settingsRevision: 1, settingsSchemaHash: "a".repeat(64), settingsFingerprint: "b".repeat(64), configFingerprint: CONFIG_FINGERPRINT } },
  sections: [
    { id: "general", label: "General", description: "The operator identity this runtime reports.", leaves: [{ path: "actor.label", input: "text", label: "Operator label", description: "The local operator label in dashboard and command evidence.", effectiveValue: "Local operator", defaultValue: "Local operator", source: "default", editable: true }] },
    { id: "display", label: "Display", description: "The viewport assumptions used when browser work is composed.", leaves: [
      { path: "display.screenWidth", input: "number", label: "Screen width", description: "The composed browser viewport width.", effectiveValue: 2560, defaultValue: 2560, source: "default", editable: true, minimum: 1, unit: "px" },
      { path: "display.screenHeight", input: "number", label: "Screen height", description: "The composed browser viewport height.", effectiveValue: 1440, defaultValue: 1440, source: "default", editable: true, minimum: 1, unit: "px" },
    ] },
    { id: "performance", label: "Performance", description: "Concurrency and wait budgets. Changes take effect after restart.", leaves: [
      { path: "ocr.pageConcurrency", input: "number", label: "OCR page concurrency", description: "Pages OCR may process concurrently; zero leaves provider admission to its own limit.", effectiveValue: 0, defaultValue: 0, source: "default", editable: true, minimum: 0 },
      { path: "ocr.maxValidationRetries", input: "number", label: "OCR validation retries", description: "Additional validation attempts after the first OCR answer.", effectiveValue: 1, defaultValue: 1, source: "default", editable: true, minimum: 0 },
      { path: "timeouts.duoApprovalSeconds", input: "number", label: "Duo approval timeout", description: "How long an authenticated browser may wait for the Duo ceremony.", effectiveValue: 180, defaultValue: 180, source: "default", editable: true, minimum: 1, unit: "seconds" },
      { path: "concurrency.defaultWorkers", input: "number", label: "Default workers", description: "Workers proposed for a newly planned pool.", effectiveValue: 2, defaultValue: 2, source: "default", editable: true, minimum: 1, hazard: "Changes worker admission after restart; verify pool capacity before saving." },
    ] },
    { id: "paths", label: "Paths", description: "The durable report destination. Changes take effect after restart.", leaves: [{ path: "paths.reportsDir", input: "text", label: "Reports directory", description: "Absolute directory where report artifacts are written.", effectiveValue: "/tmp/reports", defaultValue: "/tmp/reports", source: "default", editable: true }] },
  ],
});
