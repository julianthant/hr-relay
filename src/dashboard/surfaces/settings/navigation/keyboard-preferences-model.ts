import { useContext } from "react";
import { NEUTRAL_PERSON_PREFERENCES, ShortcutPreferencesSchema, type ShortcutPreferences } from "../../../../models/config/person-preferences.js";
import { PersonPreferencesContext, usePersonPreferences, type PersonPreferencesPort } from "../../../lib/person-preferences.js";

export const SHORTCUT_ACTIONS = [
  { id: 'search', title: 'Search runs', defaults: ['/'] },
  { id: 'start', title: 'Start a run', defaults: ['r'] },
  { id: 'next', title: 'Next run', defaults: ['j', 'ArrowDown'] },
  { id: 'previous', title: 'Previous run', defaults: ['k', 'ArrowUp'] },
  { id: 'attention', title: 'Next run needing you', defaults: ['n'] },
] as const;
export type ShortcutAction = typeof SHORTCUT_ACTIONS[number]['id'];
/** The assistant composer's send key; Command and Ctrl both count as the modifier. */
export const SEND_SHORTCUT_OPTIONS = [{ value: 'enter', label: 'Enter' }, { value: 'mod-enter', label: '⌘Enter' }] as const;
export const SEND_SHORTCUT_TERMS = 'send shortcut';
export { type ShortcutPreferences } from "../../../../models/config/person-preferences.js";
export const DEFAULT_SHORTCUT_PREFERENCES = NEUTRAL_PERSON_PREFERENCES.shortcuts;
/** A refused shortcut change, carrying the one sentence the operator reads. */
export class ShortcutRefusedError extends Error {
  constructor(readonly sentence: string) { super(sentence); this.name = "ShortcutRefusedError"; }
}
export function validateShortcutPreferences(value: unknown): ShortcutPreferences {
  const parsed = ShortcutPreferencesSchema.safeParse(value);
  if (!parsed.success) throw new ShortcutRefusedError(parsed.error.issues[0]?.message ?? "That shortcut isn't allowed.");
  return parsed.data;
}
export async function saveShortcutPreferences(value: ShortcutPreferences, port: PersonPreferencesPort): Promise<boolean | "recovered"> {
  const validated = validateShortcutPreferences(value);
  const patch = { "preferences.shortcuts.numberMode": { set: validated.numberMode },
    ...Object.fromEntries(Object.entries(validated.bindings).map(([action, keys]) => [`preferences.shortcuts.bindings.${action}`, { set: [...keys] }])) };
  return port.change(patch);
}
export function useShortcutPreferences(): ShortcutPreferences { return usePersonPreferences().value.shortcuts; }
export function useSaveShortcutPreferences() {
  const port = useContext(PersonPreferencesContext);
  return (value: ShortcutPreferences): Promise<boolean | "recovered"> => port === undefined ? Promise.resolve(false) : saveShortcutPreferences(value, port);
}
export function shortcutChord(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift', 'Dead', 'Unidentified'].includes(event.key)) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return [event.metaKey ? 'Meta' : '', event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey && (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1 || /[a-z]/i.test(event.key)) ? 'Shift' : '', key].filter(Boolean).join('+');
}
export function shortcutActionForEvent(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, preferences: ShortcutPreferences): ShortcutAction | undefined {
  const chord = shortcutChord(event);
  return SHORTCUT_ACTIONS.find(action => chord !== null && preferences.bindings[action.id].includes(chord))?.id;
}
export function shortcutLabel(chord: string): string {
  return chord.replaceAll('Meta+', '⌘').replaceAll('Ctrl+', '⌃').replaceAll('Alt+', '⌥').replaceAll('Shift+', '⇧').replace('ArrowDown', '↓').replace('ArrowUp', '↑').replace(' ', 'Space');
}
