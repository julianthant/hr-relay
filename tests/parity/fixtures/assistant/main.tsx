import { useEffect, useReducer, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, TooltipProvider } from '../../../../src/dashboard/ds/ui.js';
import { AssistantPanel } from '../../../../src/dashboard/surfaces/assistant/assistant-panel.js';
import { assistantReducer, type AssistantMockProposal } from '../../../../src/dashboard/surfaces/assistant/assistant-model.js';
import { ASSISTANT_MOCK_REVISION, ASSISTANT_MOCK_SOURCE, assistantMockProposal, assistantMockState } from '../../../../src/dashboard/surfaces/assistant/assistant-mock-model.js';
import './style.css';

const query = new URLSearchParams(location.search);
const scene = query.get('scene') ?? 'proposal';
const theme = query.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.setAttribute('data-demo-theme', theme);
document.body.setAttribute('data-demo-theme', theme);

function AssistantScene() {
  const [state, dispatch] = useReducer(assistantReducer, scene, assistantMockState);
  const [revision, setRevision] = useState(scene === 'stale' ? 'demo-context-8' : ASSISTANT_MOCK_REVISION);
  const [receipts, setReceipts] = useState<readonly AssistantMockProposal[]>([]);
  useEffect(() => {
    const turn = state.turn;
    if (turn.state !== 'waiting' || scene === 'waiting') return;
    const timer = setTimeout(() => dispatch(query.get('reply') === 'failed' ? { type: 'fail', requestId: turn.requestId } : {
      type: 'reply', requestId: turn.requestId,
      proposal: assistantMockProposal(turn.prompt, revision, `demo-plan-${turn.requestId + 1}`),
      message: { id: `reply-${turn.requestId}`, role: 'assistant', text: 'Review this exact proposal before confirming. This is a scripted mock response.', sources: [ASSISTANT_MOCK_SOURCE] },
    }), 650);
    return () => clearTimeout(timer);
  }, [state.turn, revision]);
  return <main className="assistant-scene" data-mock-confirmations={receipts.length} data-last-mock-proposal={JSON.stringify(receipts.at(-1))}>
    <div className="assistant-scene-backdrop" aria-hidden="true">
      <aside className="assistant-scene-sidebar"><strong>Relay</strong><span>WORKSPACE</span><b>Queue</b><p>Explorer</p><p>Records</p><p>Analytics</p><p className="assistant-scene-settings">Settings</p></aside>
      <div className="assistant-scene-workspace"><header><span>Workspace</span><span>Local preview</span></header><section><div className="assistant-scene-title"><div><p>WORKFLOWS</p><h1>Queue</h1></div><span>3 synthetic runs</span></div><div className="assistant-scene-tabs"><b>All runs <small>3</small></b><span>Needs review</span><span>Completed</span></div><div className="assistant-scene-table"><div className="assistant-scene-table-head"><span>Subject</span><span>Workflow</span><span>Status</span></div>{[
        ['Avery Sample', 'DEMO-001', 'Person Lookup', 'Read only'],
        ['Morgan Example', 'DEMO-002', 'Person Lookup', 'Ready for review'],
        ['Taylor Demo', 'DEMO-003', 'Emergency Contact', 'Draft'],
      ].map(([name,id,workflow,status]) => <div key={id} className="assistant-scene-table-row"><div><strong>{name}</strong><small>{id}</small></div><span>{workflow}</span><span className="assistant-scene-row-status">{status}</span></div>)}</div><p className="assistant-scene-caption">Synthetic workspace · No connected systems</p></section></div>
    </div>
    <section className="assistant-scene-controls" aria-label="Mock scene controls">
      <span>Assistant design preview</span><label>Scene<select value={scene} onChange={event => { location.search = `?scene=${event.target.value}&theme=${theme}`; }}>{['proposal','dry-run','waiting','failed','unavailable','stale','empty','long','launcher-closed'].map(name => <option key={name}>{name}</option>)}</select></label>
      <Button size="sm" variant="ghost" onClick={() => setRevision('demo-context-8')}>Invalidate plan</Button><a href={`?scene=${scene}&theme=${theme === 'dark' ? 'light' : 'dark'}`}>Switch theme</a><output aria-label="Mock callback count">Mock confirmations: {receipts.length}</output>
    </section>
    <AssistantPanel state={state} revision={revision} accountAvailable={scene !== 'unavailable'} onAction={dispatch} onMockConfirm={proposal => setReceipts(previous => [...previous, proposal])} defaultOpen={scene !== 'launcher-closed' && query.get('open') !== 'false'} />
  </main>;
}
const root = document.getElementById('assistant-preview');
if (!root) throw new Error('assistant-preview-root-missing');
createRoot(root).render(<TooltipProvider><AssistantScene /></TooltipProvider>);
