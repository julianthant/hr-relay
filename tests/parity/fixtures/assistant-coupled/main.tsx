import { ChatGptAccountContext, createServedChatGptAccountPort } from '../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js';
import { useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Dialog, DialogBody, DialogFooter, DialogContent, TooltipProvider, ToastProvider } from '../../../../src/dashboard/ds/ui.js';
import { createDashboardClient } from '../../../../src/dashboard/client/index.js';
import { AssistantPanel } from '../../../../src/dashboard/surfaces/assistant/assistant-panel.js';
import { useAssistantController } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import { SessionPanel } from '../../../../src/dashboard/surfaces/sessions/session-panel.js';
import { buildWorkflowCatalog } from '../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js';
import { servedFixtureSources } from '../../helpers/workflow-composition.js';
import '../assistant/style.css';

const client = createDashboardClient({ baseUrl: location.origin });
const account = createServedChatGptAccountPort(client, { nowMs: () => Date.parse('2026-10-12T12:00:00Z') });
window.addEventListener('pagehide', () => account.dispose());
const catalog = buildWorkflowCatalog([], true, servedFixtureSources([]));
const selection = '00410041-0041-4041-8041-004100410041';
function CoupledScene() {
  const [authority, setAuthority] = useState(0), [sessions, setSessions] = useState(false), [modal, setModal] = useState(false);
  const assistant = useAssistantController(client, authority, selection);
  return <div data-app-root="" data-demo-theme="dark" className="flex h-screen min-h-[var(--ds-h-desktop-min)] min-w-[var(--ds-w-desktop-min)] flex-col overflow-hidden bg-[color:var(--ds-surface-page)] text-[color:var(--ds-fg)]" style={{ '--ds-toast-inset-bottom': 'calc(var(--ds-h-bar) + var(--ds-space-loose))' } as CSSProperties}>
    <TooltipProvider><ToastProvider>
      <main className="min-h-0 flex-1 p-[var(--ds-space-section)]"><h1>Assistant coupled synthetic proof</h1><p>Explicit synthetic operator selection: Avery Synthetic. Actual client, HTTP, account parser and planner; no live systems.</p>
        <Button onClick={() => setAuthority(value => value + 1)}>Invalidate selected authority</Button><Button onClick={() => setModal(true)}>Open proof modal</Button>
      </main>
      <AssistantPanel {...assistant} onOpenSettings={() => setModal(true)} />
      <SessionPanel catalog={catalog} source="mock" open={sessions} onOpenChange={setSessions} />
      <Dialog open={modal} onOpenChange={setModal}><DialogContent title="Synthetic modal"><DialogBody>Overlay interaction proof. No account sign-in or HR writes.</DialogBody><DialogFooter><Button onClick={() => setModal(false)}>Close proof modal</Button></DialogFooter></DialogContent></Dialog>
    </ToastProvider></TooltipProvider>
  </div>;
}
const root = document.getElementById('assistant-coupled');
if (!root) throw new Error('assistant-coupled-root-missing');
createRoot(root).render(<ChatGptAccountContext.Provider value={account}><CoupledScene /></ChatGptAccountContext.Provider>);
