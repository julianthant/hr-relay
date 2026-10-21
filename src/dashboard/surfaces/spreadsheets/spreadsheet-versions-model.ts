import { useEffect, useMemo, useState } from 'react';
import type { SavedWorkbook } from '../../../models/dashboard/workbooks.js';
export function useSpreadsheetVersions(libraryId: string | null, read: (id: string) => Promise<readonly SavedWorkbook[]>) {
  const request = useMemo(() => ({ libraryId, read }), [libraryId, read]);
  const [settled, setSettled] = useState<{ request: typeof request; state: 'loaded'; records: readonly SavedWorkbook[] } | { request: typeof request; state: 'failed'; message: string }>();
  useEffect(() => {
    if (libraryId === null) return;
    let active = true;
    void read(libraryId).then(records => { if (active) setSettled({ request, state: 'loaded', records }); }, error => { if (active) setSettled({ request, state: 'failed', message: error instanceof Error ? error.message : String(error) }); });
    return () => { active = false; };
  }, [libraryId, read, request]);
  return settled?.request === request ? settled : { state: 'loading' as const };
}
