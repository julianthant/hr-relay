import { useEffect,useSyncExternalStore } from "react";
import {
type SettingsFactsWire
} from "../../../../models/dashboard/settings.js";
import { useSettingsRead } from "../../../state/settings-read-model.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { useSettingsClient as useDashboardClient } from "./settings-client.js";


/** ── the two READ-ONLY status sections ─────────────────────────────────── */

export type SettingsFactsState =
  | { readonly state: "loading" }
  | { readonly state: "loaded"; readonly facts: SettingsFactsWire }
  | { readonly state: "failed"; readonly message: string; readonly facts?: SettingsFactsWire };


/** Reads `GET /api/v1/settings/facts` once, when a section that needs it opens.
 * Three states, all of them drawn. A refusal is NOT an empty */
export function useSettingsFacts(): SettingsFactsState {
  const client = useDashboardClient();
  const resource = useSettingsRead<SettingsFactsWire>(client, "facts");
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  useEffect(() => { void resource.read(() => client.settingsFacts(), "SETTINGS_INITIAL_READ_UNAVAILABLE").catch(() => undefined); }, [client, resource]);
  if (state.state === "failed") return { state: "failed", message: ERROR_CATALOG.SETTINGS_INITIAL_READ_UNAVAILABLE.text, facts: state.value };
  return state.value !== undefined ? { state: "loaded", facts: state.value } : { state: "loading" };
}
