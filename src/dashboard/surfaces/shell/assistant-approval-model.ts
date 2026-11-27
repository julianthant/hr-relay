import { useSyncExternalStore } from "react";
import type { AssistantModelPreference } from "../../../models/config/assistant-model-preference.js";

export interface AssistantModelChoice {
  readonly preference: AssistantModelPreference;
  readonly models: ReadonlyArray<{ readonly slug: string }>;
  readonly choose: (preference: AssistantModelPreference) => Promise<void>;
}
let modelChoice: AssistantModelChoice | undefined;
const choiceListeners = new Set<() => void>();
const subscribeChoice = (listener: () => void) => { choiceListeners.add(listener); return () => { choiceListeners.delete(listener); }; };

/** The shell publishes the served model, its catalog and the save command; the composer's model menu reads them. */
export function publishAssistantModelChoice(next: AssistantModelChoice | undefined): void {
  modelChoice = next;
  for (const listener of choiceListeners) listener();
}

export function useAssistantModelChoice(): AssistantModelChoice | undefined {
  return useSyncExternalStore(subscribeChoice, () => modelChoice, () => undefined);
}
