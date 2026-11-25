import { useSyncExternalStore } from "react";
import { mockParam } from "../../app/mock-surfaces.js";
import type { AssistantModelPreference } from "../../../models/config/assistant-model-preference.js";

/** Settings > General > Permissions > Full access: when on, the composer's approval menu offers Full access. `assistantFullAccess=1` starts it on. */
let allowed: boolean | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Read on first use: the mock harness sets its flag after the modules load. */
const current = () => allowed ??= mockParam("assistantFullAccess") === "1";

export function setFullAccessAllowed(next: boolean): void {
  allowed = next;
  for (const listener of listeners) listener();
}

export function useFullAccessAllowed(): boolean {
  return useSyncExternalStore(subscribe, current, () => false);
}

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
