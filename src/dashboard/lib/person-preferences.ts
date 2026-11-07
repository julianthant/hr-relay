import { createContext, useContext, useSyncExternalStore } from "react";
import { NEUTRAL_PERSON_PREFERENCES, type PersonPreferences } from "../../models/config/person-preferences.js";
import type { SettingsPatch } from "../../models/config/settings.js";
export interface PersonPreferencesState {
  readonly value: PersonPreferences;
  readonly state: "signed-out" | "loading" | "ready" | "saving" | "failed" | "uncertain";
  readonly problem?: string;
}
export interface PersonPreferencesPort {
  snapshot(this: void): PersonPreferencesState;
  subscribe(this: void, listener: () => void): () => void;
  change(this: void, patch: SettingsPatch): Promise<boolean>;
}
export const PersonPreferencesContext = createContext<PersonPreferencesPort | undefined>(undefined);
const neutral: PersonPreferencesState = { value: NEUTRAL_PERSON_PREFERENCES, state: "signed-out" };
const subscribeNeutral = () => () => {};
const readNeutral = () => neutral;
export function usePersonPreferences(override?: PersonPreferencesPort) {
  const inherited = useContext(PersonPreferencesContext);
  const port = override ?? inherited;
  const snapshot = useSyncExternalStore(port?.subscribe ?? subscribeNeutral, port?.snapshot ?? readNeutral, readNeutral);
  return { ...snapshot, change: port?.change };
}
