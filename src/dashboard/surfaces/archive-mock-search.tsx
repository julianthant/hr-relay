import { FileText } from 'lucide-react';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { ArchiveBrowseState } from '../app/archive-route-model.js';
import { SearchInput, StatusPill, dsIcon } from '../ds/ui.js';
import { mockArchiveSearchHref, type MockArchiveRun } from './archive-mock-model.js';

export function ArchiveMockSearch({ value, onChange, inputRef, resultsRef, onOpenFirst }: {
 value: string; onChange: (value: string) => void; inputRef: RefObject<HTMLInputElement | null>;
 resultsRef: RefObject<HTMLElement | null>; onOpenFirst?: () => void;
}) {
 return <SearchInput ref={inputRef} type="text" className="mock-archive-search" aria-label="Search saved reports" placeholder="Search archived reports" value={value}
  aria-controls={value.trim() ? 'archive-search-results' : undefined}
  onChange={event => onChange(event.target.value)} onClear={() => onChange('')}
  onKeyDown={event => {
   if (event.nativeEvent.isComposing) return;
   if (event.key === 'ArrowDown' && resultsRef.current?.querySelector('a')) { event.preventDefault(); resultsRef.current.querySelector<HTMLElement>('a')?.focus(); }
   if (event.key === 'Enter' && onOpenFirst) { event.preventDefault(); onOpenFirst(); }
  }} />;
}

export function MockArchiveSearchResults({ rows, browse, onSelection, resultsRef, inputRef, restoreRunId }: {
 rows: readonly MockArchiveRun[]; browse: ArchiveBrowseState; onSelection: (id: string) => void;
 resultsRef: RefObject<HTMLElement | null>; inputRef: RefObject<HTMLInputElement | null>; restoreRunId?: string;
}) {
 const initialRunId = useRef(restoreRunId);
 useLayoutEffect(() => {
  if (initialRunId.current === undefined) return;
  const link = [...resultsRef.current?.querySelectorAll<HTMLElement>('a') ?? []].find(node => node.dataset.archiveRunId === initialRunId.current);
  (link ?? inputRef.current)?.focus({ preventScroll: true });
 }, [inputRef, resultsRef]);
 return <section id="archive-search-results" ref={resultsRef} aria-label="Archived run search results" className="mock-archive-search-results"
  onKeyDown={event => {
   if (event.nativeEvent.isComposing || event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
   const links = [...resultsRef.current?.querySelectorAll<HTMLElement>('a') ?? []];
   const current = links.indexOf(document.activeElement as HTMLElement);
   if (current < 0) return;
   event.preventDefault();
   if (event.key === 'ArrowUp' && current === 0) inputRef.current?.focus();
   else links[Math.min(links.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))]?.focus();
  }}>
  <header><h2>Search results</h2><p role="status">{rows.length} {rows.length === 1 ? 'run' : 'runs'} found across all archives</p></header>
  {rows.length === 0 ? <p className="mock-archive-search-empty">No archived runs match. Try another name, run ID or document, or clear a filter.</p>
   : <div className="mock-archive-search-result-list">{rows.map(row => <a key={row.id} data-archive-run-id={row.id} href={mockArchiveSearchHref(row, browse)} className="mock-archive-search-result ds-focus"
    onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onSelection(row.id); }}>
    <FileText aria-hidden className={dsIcon.md} />
    <span className="mock-archive-search-copy"><strong>{row.title}</strong><small>{row.workflowLabel} · {row.dashboard === 'unrecorded' ? 'Dashboard version not recorded' : `Dashboard ${row.dashboard}`} · {row.workflowVersion === 'Not recorded' ? 'Workflow version not recorded' : `Workflow ${row.workflowVersion}`}</small><small>Run {row.number} · {row.employeeId} · {row.document}</small></span>
    <StatusPill status={row.outcome} />
   </a>)}</div>}
 </section>;
}
