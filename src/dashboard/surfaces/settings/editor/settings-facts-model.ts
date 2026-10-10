import { useEffect,useState } from "react";
import {
type SettingsFactsWire
} from "../../../../models/dashboard/settings.js";
import { observeResource } from "../../../state/async-resource.js";
import { useSettingsClient as useDashboardClient } from "./settings-client.js";


/** ── the two READ-ONLY status sections ─────────────────────────────────── */

export type SettingsFactsState =
  | { readonly state: "loading" }
  | { readonly state: "loaded"; readonly facts: SettingsFactsWire }
  | { readonly state: "failed"; readonly message: string };


/** Reads `GET /api/v1/settings/facts` once, when a section that needs it opens.
 * Three states, all of them drawn. A refusal is NOT an empty */
export function useSettingsFacts(): SettingsFactsState {
  const client = useDashboardClient();
  const [state, setState] = useState<SettingsFactsState>({ state: "loading" });
  useEffect(() => {
    return observeResource(() => client.settingsFacts(),
      (facts) => setState({ state: "loaded", facts }),
      (caught) => setState({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) }));
  }, [client]);
  return state;
}
