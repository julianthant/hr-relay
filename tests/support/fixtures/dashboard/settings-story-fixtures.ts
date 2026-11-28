/** Settings fixtures for the state gallery: an in-page server that answers the Settings reads and the save commands, so the real
 * page, editor and command executor run unchanged. Browser-safe. */
import { createDashboardClient, createRowStore, type DashboardClient, type RowStoreWriter } from "../../../../src/dashboard/client/index.js";
import { mergeSettingsPatch, derivePersistedSettingsFingerprint, type SettingsPatch } from "../../../../src/models/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, type ProtectedSettingsName } from "../../../../src/models/config/protected-settings.js";
import { EditableSettingsWireSchema, type EditableSettingsWire } from "../../../../src/models/dashboard/settings-editor.js";
import { SettingsCommandRequestSchema, ProtectedSettingsCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import baseDocument from "./settings-story-document.json" with { type: "json" };

/** The editable settings of a fresh install at revision 2, written by `fixtureSettingsDocument({}, 2)` (a test keeps the two equal).
 * The server code cannot run in the page, so the page starts from this copy and applies saves to it. */
const BASE = EditableSettingsWireSchema.parse(baseDocument);
type Overrides = Parameters<typeof mergeSettingsPatch>[0];

const BASE_URL = "http://relay.story.test";
const UPDATED_AT = "2026-09-13T12:00:00.000Z";
const CREDENTIAL_IDS: Readonly<Record<ProtectedSettingsName, string>> = {
  ucpathUserId: "a1111111-1111-4111-8111-111111111111",
  ucpathPassword: "a2222222-2222-4222-8222-222222222222",
  sharepointOnboardingRosterUrl: "a3333333-3333-4333-8333-333333333333",
};

/** How the page's first read of the editable settings goes. `fail-once` fails the first read and answers every later one; `hold-later` answers the first and holds every later one until the page calls `releaseSettingsRead`. */
export type SettingsRead = "answer" | "never" | "fail" | "fail-once" | "hold-later";
/** What the page's next save command comes back as. `restart` lands and says Relay must restart; `replayed` says it was already saved. */
export type SettingsSave = "applied" | "restart" | "replayed" | "conflict" | "rejected" | "lost" | "never";
export type SettingsCredentials = "saved" | "empty" | "unavailable";

export interface SettingsStoryServerOptions {
  readonly read?: SettingsRead;
  readonly save?: SettingsSave;
  /** The runtime status the first document carries. */
  readonly runtime?: "current" | "restart-required";
  readonly credentials?: SettingsCredentials;
}

export interface SettingsStoryServer {
  readonly client: DashboardClient;
  /** Every command the page sent, as parsed JSON. */
  readonly commands: readonly unknown[];
  /** The stream's rows: each applied ordinary save delivers its settings row here before its reply, as the server's hub does. */
  readonly rows: RowStoreWriter;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const never = (): Promise<Response> => new Promise<Response>(() => undefined);

/** One settings authority held in memory: a revision, the saved overrides and the credential store. */
export function settingsStoryServer(options: SettingsStoryServerOptions = {}): SettingsStoryServer {
  const { read = "answer", save = "applied", credentials = "saved" } = options;
  let settings: Overrides = {};
  const saved = new Map<string, unknown>();
  let revision = 2;
  let restart = options.runtime === "restart-required";
  let credentialRevision = 2;
  const stored = new Map<ProtectedSettingsName, string>(credentials === "saved" ? [["ucpathUserId", "jordan.lee"], ["ucpathPassword", "story-password"]] : []);
  let reads = 0;
  let answered = false;
  const commands: unknown[] = [];
  const rows = createRowStore();

  const document = (): EditableSettingsWire => {
    const entry = (name: ProtectedSettingsName) => ({ valueId: CREDENTIAL_IDS[name], updatedAt: UPDATED_AT });
    const protectedSettings = credentials === "unavailable"
      ? { state: "unknown" as const, rows: BASE.protectedSettings.rows, reason: "credential-store-unavailable" as const }
      : { state: "available" as const, rows: BASE.protectedSettings.rows, protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
        readback: { revision: credentialRevision, entries: Object.fromEntries((Object.keys(CREDENTIAL_IDS) as ProtectedSettingsName[]).map(name =>
          [name, stored.has(name) ? { present: true, ...entry(name) } : { present: false }])) },
        entries: Object.fromEntries([...stored].map(([name, value]) => [name, { ...entry(name), value }])) };
    const settingsFingerprint = derivePersistedSettingsFingerprint(settings);
    const identity = { settingsRevision: revision, settingsSchemaHash: BASE.settingsSchemaHash, settingsFingerprint, configFingerprint: BASE.activeConfigFingerprint };
    const sections = BASE.sections.map(section => ({ ...section, leaves: section.leaves.map(leaf => {
      if (!saved.has(leaf.path)) return leaf;
      const value = saved.get(leaf.path);
      return { ...leaf, source: "settings", settingsValue: value, activeValue: value, effectiveValue: value };
    }) }));
    return EditableSettingsWireSchema.parse({ ...BASE, revision, settingsFingerprint, sections, protectedSettings,
      runtimeStatus: restart ? { state: "restart-required", active: { ...identity, settingsRevision: 2, settingsFingerprint: BASE.settingsFingerprint }, persisted: identity } : { state: "current", identity } });
  };

  const record = (patch: SettingsPatch): void => {
    settings = mergeSettingsPatch(settings, patch);
    for (const [path, operation] of Object.entries(patch)) { if ("set" in operation) saved.set(path, operation.set); else saved.delete(path); }
  };

  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/settings/editable") {
      reads += 1;
      if (read === "never") return never();
      if (read === "fail" || (read === "fail-once" && reads === 1)) return json({ code: "SETTINGS_READ_UNAVAILABLE" }, 500);
      if (read === "hold-later" && answered) return new Promise<Response>(answer => { Reflect.set(globalThis, "releaseSettingsRead", () => { answer(json(document())); }); });
      answered = true;
      return json(document());
    }
    if (pathname === "/api/v1/commands" && typeof init?.body === "string") {
      const body: unknown = JSON.parse(init.body);
      commands.push(body);
      if (save === "never") return never();
      if (save === "lost") throw new TypeError("Failed to fetch");
      const ordinary = SettingsCommandRequestSchema.safeParse(body);
      const protectedRequest = ProtectedSettingsCommandRequestSchema.safeParse(body);
      const commandId = ordinary.success ? ordinary.data.commandId : protectedRequest.success ? protectedRequest.data.commandId : undefined;
      if (commandId === undefined) return json({ code: "COMMAND_INVALID" }, 422);
      if (save === "conflict") return json({ state: "conflict", commandId, currentVersion: revision + 1, message: "Settings changed elsewhere." }, 409);
      if (save === "rejected") return json({ state: "rejected", commandId, code: "not-editable", message: "This setting cannot be changed." }, 422);
      if (ordinary.success) {
        record(ordinary.data.payload.patch);
        revision += 1;
        restart = restart || save === "restart";
        rows.apply([{ model: "settings", key: "editable", value: { state: "available", value: document() } }]);
        return json({ state: save === "replayed" ? "already-applied" : "applied", commandId, affectedTargets: [{ family: "settings", revision }],
          restartRequired: restart, settingsRevision: revision, settingsFingerprint: derivePersistedSettingsFingerprint(settings) });
      }
      if (protectedRequest.success) {
        for (const [name, operation] of Object.entries(protectedRequest.data.payload.entries) as [ProtectedSettingsName, { set: unknown } | { clear: true }][]) {
          if ("clear" in operation) stored.delete(name); else stored.set(name, String(operation.set));
        }
        credentialRevision += 1;
        return json({ state: "applied", commandId, affectedTargets: [{ family: "protected-settings", revision: credentialRevision }], restartRequired: false,
          revision: credentialRevision, entries: Object.fromEntries((Object.keys(CREDENTIAL_IDS) as ProtectedSettingsName[]).map(name =>
            [name, stored.has(name) ? { present: true, valueId: CREDENTIAL_IDS[name], updatedAt: UPDATED_AT } : { present: false }])) });
      }
    }
    return json({ code: "NOT_SERVED" }, 404);
  };
  if (read === "answer" || read === "hold-later") rows.apply([{ model: "settings", key: "editable", value: { state: "available", value: document() } }]);
  return { client: createDashboardClient({ baseUrl: BASE_URL, fetchImpl }), commands, rows };
}
