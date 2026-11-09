import { Fragment } from 'react';
import { Check } from 'lucide-react';
import { Select } from '../../../ds/ui.js';

export interface ColumnNeed { readonly key: string; readonly label: string; readonly required: boolean }

export function ColumnMapping({ needs, headers, samples, values, onChange }: { needs: readonly ColumnNeed[]; headers: readonly string[]; samples: (header: string) => string; values: Readonly<Record<string, string>>; onChange: (key: string, header: string) => void }) {
  return <div className="grid grid-cols-[72px_minmax(0,200px)_minmax(0,1fr)] items-center gap-x-4 gap-y-3">{needs.map(need => {
    const value = values[need.key] ?? '';
    return <Fragment key={need.key}>
      <span className="text-body">{need.label}</span>
      <div className="flex min-w-0 items-center gap-2"><Select aria-label={`${need.label} column`} className="min-w-0 flex-1" value={value} onChange={event => onChange(need.key, event.target.value)}>{(value === '' || !need.required) && <option value="">{need.required ? 'Choose a column' : 'None'}</option>}{headers.map(header => <option key={header} value={header}>{header}</option>)}</Select>{value !== '' && <Check size={14} aria-hidden className="shrink-0 text-ui-muted" />}</div>
      <span className="min-w-0 truncate text-caption text-ui-muted">{value !== '' ? samples(value) : ''}</span>
    </Fragment>;
  })}</div>;
}
