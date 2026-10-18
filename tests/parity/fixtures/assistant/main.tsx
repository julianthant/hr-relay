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
    <header className="assistant-scene-header"><strong>Relay</strong><span>Assistant · Mock review</span></header>
    <section className="assistant-scene-copy">
      <h1>Review the assistant</h1>
      <p>Open the bottom-right launcher to review a proposal, inspect its sources, or keep a conversation open while you work.</p>
      <p>All subjects, replies, plans, and public source examples are synthetic. Confirm records one local callback. Nothing is sent to a backend.</p>
      <nav aria-label="Mock scenes">{['proposal', 'dry-run', 'waiting', 'failed', 'unavailable', 'stale', 'empty', 'long'].map(name => <a key={name} href={`?scene=${name}&theme=${theme}`}>{name}</a>)}</nav>
      <div className="assistant-scene-tools"><Button onClick={() => setRevision('demo-context-8')}>Invalidate plan</Button><a href={`?scene=${scene}&theme=${theme === 'dark' ? 'light' : 'dark'}`}>Switch theme</a></div>
      <output aria-label="Mock callback count">Mock confirmations: {receipts.length}</output>
      {receipts.length > 0 && <p>Recorded {receipts.at(-1)?.id}. No run was started.</p>}
    </section>
    <AssistantPanel state={state} revision={revision} accountAvailable={scene !== 'unavailable'} onAction={dispatch} onMockConfirm={proposal => setReceipts(previous => [...previous, proposal])} defaultOpen={query.get('open') !== 'false'} />
  </main>;
}
const root = document.getElementById('assistant-preview');
if (!root) throw new Error('assistant-preview-root-missing');
createRoot(root).render(<TooltipProvider><AssistantScene /></TooltipProvider>);
