import { useEffect,useState } from "react";
import {
type SettingsFactsWire
} from "../../domain/dashboard/settings.js";
import { observeResource } from "../state/async-resource.js";
import { useSettingsClient as useDashboardClient } from "../state/settings-client.js";


/* ── the two READ-ONLY status sections (D274 item 6, ledger 3 SE40–SE42) ──── */

export type SettingsFactsState =
  | { readonly state: "loading" }
  | { readonly state: "loaded"; readonly facts: SettingsFactsWire }
  | { readonly state: "failed"; readonly message: string };


/**
 * Reads `GET /api/v1/settings/facts` once, when a section that needs it opens.
 *
 * Three states, all of them drawn (D275 item 4). A refusal is NOT an empty
 * table: "no host is configured" and "we could not ask" are different sentences
 * and only one of them is ever true, so the failed arm carries the transport's
 * own message rather than falling back to a plausible blank page.
 */
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
