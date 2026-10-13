import { useSyncExternalStore } from 'react';
import { z } from 'zod';

export const SHORTCUT_ACTIONS = [
  { id: 'search', title: 'Search runs', description: 'Find a run by name, subject, workflow or status.', defaults: ['/'] },
  { id: 'start', title: 'Start a run', description: 'Start a new run from any available workflow.', defaults: ['r'] },
  { id: 'next', title: 'Next run', description: 'Move down the visible queue.', defaults: ['j', 'ArrowDown'] },
  { id: 'previous', title: 'Previous run', description: 'Move up the visible queue.', defaults: ['k', 'ArrowUp'] },
  { id: 'attention', title: 'Next run needing you', description: 'Jump to the next run waiting for a decision.', defaults: ['n'] },
] as const;
export type ShortcutAction = typeof SHORTCUT_ACTIONS[number]['id'];
export type ShortcutPreferences = Readonly<{ numberMode: 'runs' | 'workflows'; bindings: Readonly<Record<ShortcutAction, readonly string[]>> }>;
export const DEFAULT_SHORTCUT_PREFERENCES: ShortcutPreferences = Object.freeze({ numberMode: 'runs', bindings: Object.freeze(Object.fromEntries(SHORTCUT_ACTIONS.map(action => [action.id, Object.freeze([...action.defaults])])) as Record<ShortcutAction, readonly string[]>) });
const binding = z.array(z.string().min(1)).max(8);
const schema = z.strictObject({ numberMode: z.enum(['runs', 'workflows']), bindings: z.strictObject({ search: binding, start: binding, next: binding, previous: binding, attention: binding }) });
const storageKey = 'hr-gpt-shortcuts-v1';
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cached: ShortcutPreferences = DEFAULT_SHORTCUT_PREFERENCES;

export function validateShortcutPreferences(value: unknown): ShortcutPreferences {
  const parsed = schema.parse(value);
  const seen = new Set<string>();
  for (const keys of Object.values(parsed.bindings)) for (const chord of keys) {
    if (chord === 'Escape' || /^(Meta|Ctrl)\+[1-9]$/.test(chord)) throw new Error('This shortcut is reserved.');
    if (seen.has(chord)) throw new Error('This shortcut is already assigned to another action.');
    seen.add(chord);
  }
  return parsed;
}
function snapshot(): ShortcutPreferences {
  if (typeof window === 'undefined') return DEFAULT_SHORTCUT_PREFERENCES;
  const raw = window.localStorage.getItem(storageKey);
  if (raw !== cachedRaw) { cached = raw === null ? DEFAULT_SHORTCUT_PREFERENCES : validateShortcutPreferences(JSON.parse(raw)); cachedRaw = raw; }
  return cached;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
}
export function saveShortcutPreferences(value: ShortcutPreferences): void {
  const validated = validateShortcutPreferences(value);
  window.localStorage.setItem(storageKey, JSON.stringify(validated));
  listeners.forEach(listener => listener());
}
export function useShortcutPreferences(): ShortcutPreferences {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_SHORTCUT_PREFERENCES);
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
