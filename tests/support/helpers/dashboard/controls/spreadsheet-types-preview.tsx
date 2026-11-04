import { useRef, useState } from 'react';
import { Button, ToastProvider } from '../../../../../src/dashboard/ds/ui.js';
import { SpreadsheetTypeDialog } from '../../../../../src/dashboard/surfaces/spreadsheets/spreadsheets.js';
import { SpreadsheetEditor } from '../../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor.js';
import { newEditableWorkbook } from '../../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import '../../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-library.css';

export function ControlPreview() {
  const [open, setOpen] = useState(new URLSearchParams(location.search).get('state') !== 'values');
  const trigger = useRef<HTMLButtonElement>(null);
  const [document, setDocument] = useState(() => ({ ...newEditableWorkbook(), name: 'Synthetic roster.xlsx', libraryId: 'synthetic', unsupportedMetadata: true }));
  return <ToastProvider><main className="p-6"><Button ref={trigger} onClick={() => setOpen(true)}>Create type</Button>
    <SpreadsheetTypeDialog key={String(open)} open={open} onOpenChange={setOpen} returnFocus={trigger} workbook={document} onSave={async () => ({ state: 'confirmed' })} />
    <SpreadsheetEditor onSaveValues={async () => ({ state: 'confirmed' })} document={document} dirty onDocument={next => { if (next) setDocument({ ...next, libraryId: 'synthetic', unsupportedMetadata: true }); }} onSave={async () => ({ state: 'refused', reason: 'This workbook has formatting Relay cannot preserve.' })} />
  </main></ToastProvider>;
}
