import { useViewState } from "../../../app/navigation/view-route-model.js";
import { useState } from 'react';
import { Pencil, Trash2, Undo2 } from 'lucide-react';
import { Banner, Button, Dialog, DialogBody, DialogContent, DialogFooter, FormGroup, IconButton, Input, Kbd, PageHeading, ResultRow, SearchInput, Select, dsIcon } from '../../../ds/ui.js';
import { usePersonPreferences } from "../../../lib/person-preferences.js";
import type { SettingsSaveListener } from "../editor/settings-attempt-model.js";
import { DEFAULT_SHORTCUT_PREFERENCES, SEND_SHORTCUT_OPTIONS, SEND_SHORTCUT_TERMS, SHORTCUT_ACTIONS, useSaveShortcutPreferences, shortcutChord, shortcutLabel, useShortcutPreferences, type ShortcutAction } from './keyboard-preferences-model.js';

export function KeyboardSection({ onSaved }: { onSaved?: SettingsSaveListener }) {
  const preferences = useShortcutPreferences();
  const saveShortcutPreferences = useSaveShortcutPreferences();
  const [query, setQuery] = useViewState('keyboardQuery', '', 'replace');
  const [editing, setEditing] = useState<{ id: ShortcutAction; index: number } | null>(null);
  const [captured, setCaptured] = useState('');
  const [error, setError] = useState('');
  const person = usePersonPreferences();
  const sendShown = SEND_SHORTCUT_TERMS.includes(query.toLowerCase());
  const actions = SHORTCUT_ACTIONS.filter(action => `${action.title} ${action.description} ${preferences.bindings[action.id].join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const edit = (id: ShortcutAction, index: number) => { setEditing({ id, index }); setCaptured(preferences.bindings[id][index] ?? ''); setError(''); };
  const save = async () => {
    if (!editing || !captured) return;
    const next = [...preferences.bindings[editing.id]];
    next[editing.index] = captured;
    try { if (!await saveShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, [editing.id]: next } })) return; setEditing(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); return; }
    onSaved?.({ title: `Saved ${SHORTCUT_ACTIONS.find(action => action.id === editing.id)!.title} shortcut` });
  };
  return <section className="settings-compact-page settings-keyboard-page">
    <PageHeading title="Keyboard" actions={<Button variant="muted" onClick={() => saveShortcutPreferences(DEFAULT_SHORTCUT_PREFERENCES)}>Reset all to defaults</Button>} />
    <SearchInput variant="field" aria-label="Search shortcuts" placeholder="Search shortcuts" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} />
    <FormGroup label="Keyboard bindings">
      {actions.map(action => {
        const chords = preferences.bindings[action.id];
        const defaults: readonly string[] = SHORTCUT_ACTIONS.find(item => item.id === action.id)!.defaults;
        const changed = chords.length !== defaults.length || chords.some((chord, position) => chord !== defaults[position]);
        const save = (next: readonly string[]) => saveShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, [action.id]: [...next] } });
        const reset = changed ? <IconButton label={`Reset ${action.title} shortcut`} icon={<Undo2 className={dsIcon.md} />} onClick={() => save(defaults)} /> : null;
        const pencil = (index: number) => <IconButton label={`Edit ${action.title} shortcut ${index + 1}`} icon={<Pencil className={dsIcon.md} />} onClick={() => edit(action.id, index)} />;
        return <ResultRow key={action.id} label={action.title} description={action.description} controlWidth={chords.length > 1 ? "wide" : "standard"} value={<div className="flex items-center justify-end gap-3">
          {chords.length === 0
            ? <span className="inline-flex items-center justify-end gap-3"><span className="text-ui-muted">Unassigned</span>{pencil(0)}</span>
            : chords.map((chord, index) => <span key={index} className="inline-flex items-center justify-end gap-3">
              {index === 0 && reset}<Kbd>{shortcutLabel(chord)}</Kbd>{pencil(index)}
              <IconButton label={`Remove ${action.title} shortcut ${index + 1}`} icon={<Trash2 className={dsIcon.md} />} onClick={() => save(chords.filter((_, position) => index !== position))} />
            </span>)}
        </div>} />;
      })}
      {sendShown && <ResultRow label="Send shortcut" description="Choose which keys send a message in the assistant." value={<Select aria-label="Send shortcut" value={person.value.sendShortcut} disabled={person.change === undefined || person.state === 'saving'}
        onChange={event => { void person.change?.({ 'preferences.sendShortcut': { set: event.target.value } }).then(saved => { if (saved) onSaved?.({ title: 'Saved Send shortcut' }); }); }}>
        {SEND_SHORTCUT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>} />}
      {actions.length === 0 && !sendShown && <p role="status" className="p-5 text-ui-muted">No shortcuts match your search.</p>}
    </FormGroup>
    <p className="m-0 text-caption text-ui-muted">Shortcuts pause in text fields and dialogs. Changes are saved in this browser.</p>
    <Dialog open={editing !== null} onOpenChange={open => { if (!open) setEditing(null); }}><DialogContent title="Edit shortcut" description="Press a key or key combination, then save." size="sm"><DialogBody>{error && <Banner className="mb-[var(--ds-space-heading-content)]" tone="danger" title="Shortcut unavailable">{error}</Banner>}<Input name="shortcutKeys" autoComplete="off" autoFocus readOnly aria-label="Shortcut keys" value={captured ? shortcutLabel(captured) : ''} placeholder="Press shortcut…" onKeyDown={event => { if (event.key === 'Escape' || event.key === 'Tab') return; event.preventDefault(); const chord = shortcutChord(event.nativeEvent); if (chord) { setCaptured(chord); setError(''); } }} /></DialogBody><DialogFooter><Button variant="muted" onClick={() => setEditing(null)}>Cancel</Button><Button disabled={!captured} onClick={save}>Save shortcut</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
