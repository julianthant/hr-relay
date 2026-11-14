import { operatorFailureSentence } from "../../models/failures/error-catalog.js";
import { EditableSettingsWireSchema, type EditableSettingsWire } from "../../models/dashboard/settings-editor.js";
import { PersonPreferencesSchema, NEUTRAL_PERSON_PREFERENCES, resolvePersonPreferences, type PersonPreferences } from "../../models/config/person-preferences.js";
import { deriveSettingsPatchFingerprint, mergeSettingsPatch, type SettingsPatch } from "../../models/config/settings.js";
import { SettingsCommandRequestSchema } from "../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import type { DashboardCommandBinding } from "../app/dashboard-app-model.js";
import type { DashboardClient } from "../client/index.js";
import type { PersonPreferencesPort, PersonPreferencesState } from "../lib/person-preferences.js";
import { ordinaryReadbackState, checkedSettingsResult } from "../surfaces/settings/editor/settings-attempt-model.js";
import { clearSettingsReads, settingsReadResource } from "./settings-read-model.js";

type PreferencesBinding = Pick<DashboardCommandBinding, "scope" | "executor"> & { authority: Pick<DashboardCommandBinding["authority"], "epoch" | "nowIso"> };

type SendShortcut = PersonPreferences["sendShortcut"];
export const isMacPlatform = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const sendShortcutLabel = (shortcut: SendShortcut, mac: boolean) => shortcut === "enter" ? "Enter" : mac ? "⌘Enter" : "Ctrl+Enter";
/** Whether a composer key press sends under the person's send shortcut; IME composition never sends. */
export function sendsMessage(shortcut: SendShortcut, key: Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey" | "isComposing">, mac: boolean): boolean {
  if (key.key !== "Enter" || key.isComposing || key.shiftKey) return false;
  const mod = mac ? key.metaKey : key.ctrlKey;
  return shortcut === "enter" ? !mod : mod;
}

export function preferencesFromSettings(document: EditableSettingsWire) {
  const patch = Object.fromEntries(document.sections.flatMap(section => section.leaves)
    .filter(leaf => leaf.path.startsWith("preferences.")).map(leaf => [leaf.path, { set: leaf.effectiveValue }]));
  return resolvePersonPreferences(mergeSettingsPatch({}, patch).preferences);
}

/** One renderer owner per person/epoch, including reads already in flight at logout. */
export function createPersonPreferences(mode: "person" | "preview" | "signed-out", preview = NEUTRAL_PERSON_PREFERENCES) {
  let state: PersonPreferencesState = { value: mode === "preview" ? PersonPreferencesSchema.parse(preview) : NEUTRAL_PERSON_PREFERENCES, state: mode === "preview" ? "ready" : mode === "person" ? "loading" : "signed-out" };
  let generation = 0;
  let connection: { client: DashboardClient; binding: PreferencesBinding; current: () => PreferencesBinding } | undefined;
  let document: EditableSettingsWire | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: PersonPreferencesState) => { state = next; for (const listener of listeners) listener(); };
  const fail = (problem: string, uncertain = false) => publish({ ...state, state: uncertain ? "uncertain" : "failed", problem });
  const port: PersonPreferencesPort = {
    snapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async change(patch: SettingsPatch): Promise<boolean> {
      if (!Object.keys(patch).every(path => path.startsWith("preferences."))) throw new Error("person-preferences-path-invalid");
      if (mode === "preview") {
        const value = resolvePersonPreferences(mergeSettingsPatch({ preferences: state.value }, patch).preferences);
        publish({ value, state: "ready" }); return true;
      }
      if (state.state !== "ready" || connection === undefined || document === undefined) return false;
      const active = connection;
      const started = generation;
      const binding = active.current();
      const command = SettingsCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: binding.authority.nowIso,
        requestedBy: binding.scope.actorId, source: "person-preferences", family: "settings", type: "apply-settings",
        target: { expectedRevision: document.revision }, payload: { settingsSchemaHash: document.settingsSchemaHash,
          patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
      resolvePersonPreferences(mergeSettingsPatch({ preferences: state.value }, patch).preferences);
      publish({ ...state, state: "saving" });
      let readback: EditableSettingsWire | undefined;
      const outcome = await binding.executor.execute(command, { scope: binding.scope,
        readback: async (_request, reply) => {
          const result = checkedSettingsResult(command, reply);
          readback = EditableSettingsWireSchema.parse(await active.client.editableSettings());
          const verification = ordinaryReadbackState(command, result, readback);
          return { state: verification === "confirmed" ? "matched" : verification === "superseded" ? "conflict" : "mismatch", evidence: readback };
        } });
      if (started !== generation) return false;
      if (outcome.kind !== "confirmed" || readback === undefined) {
        fail(outcome.kind === "confirmed" ? operatorFailureSentence("COMMAND_OUTCOME_UNCERTAIN") : outcome.feedback.text, outcome.kind === "uncertain");
        return false;
      }
      document = readback;
      publish({ value: preferencesFromSettings(readback), state: "ready" });
      const resource = settingsReadResource<EditableSettingsWire>(active.client, active.binding.authority.epoch,
        canonicalJsonStringify([binding.scope.actorId, binding.authority.epoch.bootstrap.descriptorHash]), "editor");
      resource.accept(readback);
      return true;
    },
  };
  return Object.assign(port, {
    connect(client: DashboardClient, binding: PreferencesBinding, current: () => PreferencesBinding): () => void {
      if (mode !== "person") return () => {};
      const started = ++generation;
      connection = { client, binding, current };
      const resource = settingsReadResource<EditableSettingsWire>(client, binding.authority.epoch,
        canonicalJsonStringify([binding.scope.actorId, binding.authority.epoch.bootstrap.descriptorHash]), "editor");
      const accept = () => {
        if (started !== generation || state.state === "saving" || state.state === "uncertain") return;
        const observed = resource.snapshot();
        if (observed.state !== "loaded") return;
        document = observed.value;
        publish({ value: preferencesFromSettings(document), state: "ready" });
      };
      const unsubscribe = resource.subscribe(accept);
      accept();
      void resource.read(async () => EditableSettingsWireSchema.parse(await client.editableSettings()), "SETTINGS_INITIAL_READ_UNAVAILABLE")
        .catch(() => { if (started === generation) fail(operatorFailureSentence("SETTINGS_INITIAL_READ_UNAVAILABLE")); });
      return () => { unsubscribe(); generation += 1; connection = undefined; document = undefined; resource.reset();
        if (state.state === "saving") fail(operatorFailureSentence("DASHBOARD_AUTHORITY_REPLACED"), true); };
    },
    clear() { generation += 1; if (connection !== undefined) clearSettingsReads(connection.client); connection = undefined; document = undefined; state = { value: NEUTRAL_PERSON_PREFERENCES, state: "signed-out" }; },
  });
}
export type PersonPreferencesOwner = ReturnType<typeof createPersonPreferences>;
