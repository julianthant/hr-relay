import { ASSISTANT_MODEL_COMMAND, ASSISTANT_DEFAULT_MODEL, ASSISTANT_DEFAULT_EFFORT, AssistantModelPreferenceViewSchema, type AssistantModelPreferenceView, type AssistantRequest, type AssistantRespondEnvelope, type AssistantResult } from '../../../../src/models/dashboard/assistant.js';
import { CommandExecutor, type CommandExecutionScope, type CommandOutcome } from '../../../../src/dashboard/app/commands/command-executor.js';
import { AssistantModelPreferenceCommandRequestSchema, CommandResultSchema, type CommandResult } from '../../../../src/rules/commands/commands.js';
import { LOCAL_OPERATOR_ACTOR_ID } from '../../../../src/rules/identity/ids.js';
import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { assistantProposalDigest, createAssistantController, ASSISTANT_CONFIRM_HOLD } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import { ASSISTANT_UNKNOWN_NOTICE } from '../../../../src/dashboard/surfaces/assistant/assistant-model.js';
import { assistantModelLabel } from '../../../../src/models/config/assistant-model-preference.js';
import { ASSISTANT_PAUSE_PROPOSAL, ASSISTANT_START_PROPOSAL } from '../../../support/fixtures/dashboard/assistant-start.js';
import { resultClient } from '../../../support/helpers/dashboard/assistant-served-client.js';
import { createAssistantHistory } from '../../../../src/dashboard/surfaces/assistant/assistant-history-model.js';
import { assistantHistoryServer } from '../../../support/helpers/dashboard/assistant-history-server.js';


function pending() {
  let settle: (result: AssistantResult) => void = () => { throw new Error('pending-uninitialized'); };
  const promise = new Promise<AssistantResult>(resolve => { settle = resolve; });
  return { promise, settle };
}

it('keeps monotonic identity across New Chat and ignores late replies after cancellation, edits and authority changes', async () => {
  for (const action of ['new-chat', 'cancel', 'edit', 'binding'] as const) {
    const reply = pending(); let signal: AbortSignal | undefined;
    const c = createAssistantController(resultClient({ assistantRespond: async (_request, abort) => { signal = abort; return reply.promise; } }), { authority: 'a', subjectRef: 'one' });
    c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
    if (action === 'binding') c.bind({ authority: 'b', subjectRef: 'two' });
    else c.action(action === 'edit' ? { type: 'edit', value: 'Changed' } : { type: action });
    assert.equal(signal?.aborted, true);
    if (action !== 'new-chat') {
      assert.equal(c.snapshot().turn.state, 'unknown');
      const sequence = c.snapshot().sequence; c.action({ type: 'retry' }); c.action({ type: 'send' }); assert.equal(c.snapshot().sequence, sequence);
    }
    reply.settle({ state: 'answered', text: 'Late' }); await reply.promise; await Promise.resolve();
    assert.equal(c.snapshot().messages.some(message => message.text === 'Late'), false);
    assert.equal(c.snapshot().sequence, 1);
    if (action === 'new-chat') assert.deepEqual(c.snapshot().messages, []);
    c.action({ type: 'new-chat' }); c.action({ type: 'edit', value: 'Next' }); c.action({ type: 'send' }); assert.equal(c.snapshot().sequence, 2);
    c.abort();
  }
});
it('settles actual answer presentation and never interprets Confirm as a request', async () => {
  let calls = 0;
  const c = createAssistantController(resultClient({ async assistantRespond() { calls++; return { state: 'answered', text: 'Explanation' }; } }), { authority: 'a' });
  c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'idle'));
  assert.equal(c.snapshot().messages.at(-1)?.text, 'Explanation');
  c.action({ type: 'confirm' }); assert.equal(calls, 1); assert.match(ASSISTANT_CONFIRM_HOLD, /before preparation/u);
});
it('does not retry an ambiguously lost response or let an edited draft redispatch it', async () => {
  let calls = 0;
  const c = createAssistantController(resultClient({ async assistantRespond() { calls++; throw new Error('private transport reason'); } }), { authority: 'a' });
  c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'unknown'));
  c.action({ type: 'retry' }); c.action({ type: 'send' });
  assert.equal(calls, 1); assert.equal(c.snapshot().sequence, 1);
  c.action({ type: 'edit', value: 'Changed' }); c.action({ type: 'retry' }); c.action({ type: 'send' }); assert.equal(calls, 1);
  assert.equal(JSON.stringify(c.snapshot()).includes('private transport'), false);
  assert.equal(JSON.stringify(c.snapshot()).includes('actionId'), false);
});

const actionProposal = { state: 'action-proposal', proposal: ASSISTANT_PAUSE_PROPOSAL } satisfies AssistantResult;
it('confirms the actual issued action identity once; a lost run start or run action is unknown and nothing retries', async () => {
  const start = { state: 'action-proposal', proposal: ASSISTANT_START_PROPOSAL } satisfies AssistantResult;
  for (const [result, lost, settled] of [[actionProposal, false, 'confirmed'], [actionProposal, true, 'unknown'], [start, true, 'unknown']] as const) {
    let calls = 0;
    const c = createAssistantController(resultClient({ assistantRespond: async () => result,
      assistantDecide: async identity => { calls++; assert.deepEqual(identity, { chatId: result.proposal.chatId, actionId: result.proposal.actionId, revision: result.proposal.revision, decision: 'confirm',
        reviewedDigest: await assistantProposalDigest(result.proposal) });
        if (lost) throw new Error('synthetic transport lost'); return { state: 'applied', actionId: identity.actionId }; } }), { authority: 'current' });
    c.action({ type: 'edit', value: 'pause it' }); c.action({ type: 'send' }); await Promise.resolve(); await Promise.resolve();
    const initial = c.snapshot().turn; assert.equal(initial.state, 'proposal');
    if (initial.state === 'proposal' && result === actionProposal) { assert.equal(initial.proposal.mode, 'local-change'); assert.deepEqual(initial.proposal.issued, actionProposal.proposal); }
    c.action({ type: 'confirm' }); c.action({ type: 'confirm' });
    await vi.waitFor(() => { const turn = c.snapshot().turn; assert.ok(turn.state === 'proposal' && turn.disposition === settled, String(lost)); });
    if (lost) assert.equal(c.snapshot().messages.at(-1)?.text, ASSISTANT_UNKNOWN_NOTICE);
    c.action({ type: 'confirm' }); c.action({ type: 'retry' }); assert.equal(calls, 1);
  }
});
it('holds issued action confirmation after edits, selection changes or cancel without fabricating workflow subjects', async () => {
  for (const change of ['edit', 'selection', 'cancel'] as const) {
    let confirmations = 0, cancellations = 0;
    const c = createAssistantController(resultClient({ assistantRespond: async () => actionProposal,
      assistantDecide: async input => { if (input.decision === 'confirm') confirmations++; else cancellations++; return { state: 'cancelled', actionId: input.actionId }; } }), { authority: 'one' });
    c.action({ type: 'edit', value: 'mark notifications read' }); c.action({ type: 'send' }); await Promise.resolve(); await Promise.resolve();
    if (change === 'edit') c.action({ type: 'edit', value: 'changed' });
    if (change === 'selection') c.bind({ authority: 'two', subjectRef: 'new-subject' });
    if (change === 'cancel') { c.action({ type: 'cancel' }); await Promise.resolve(); await Promise.resolve(); }
    c.action({ type: 'confirm' }); assert.equal(confirmations, 0);
    if (change === 'cancel') assert.equal(cancellations, 1);
  }
});

it('holds an issued automatic unknown card without Confirm, Retry, or another request', async () => {
  let requests = 0, decisions = 0;
  const action = ASSISTANT_PAUSE_PROPOSAL;
  const c = createAssistantController(resultClient({ async assistantRespond() { requests++; return { state: 'unknown', actionId: action.actionId, action }; },
    async assistantDecide() { decisions++; return { state: 'applied', actionId: action.actionId }; } }), { authority: 'current' });
  c.action({ type: 'edit', value: 'mark notifications read' }); c.action({ type: 'send' });
  await vi.waitFor(() => { const turn = c.snapshot().turn; assert.equal(turn.state, 'proposal'); if (turn.state === 'proposal') assert.equal(turn.disposition, 'unknown'); });
  c.action({ type: 'confirm' }); c.action({ type: 'retry' }); c.action({ type: 'send' }); c.action({ type: 'cancel' });
  assert.equal(requests, 1); assert.equal(decisions, 0);
  const turn = c.snapshot().turn; assert.equal(turn.state, 'proposal'); if (turn.state === 'proposal') assert.deepEqual(turn.proposal.action, { chatId: action.chatId, actionId: action.actionId, revision: action.revision });
});

function preferenceControls() {
  let view = AssistantModelPreferenceViewSchema.parse({ profileId: crypto.randomUUID(), epoch: 2, revision: 3,
    preference: { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT } });
  const sent: unknown[] = [], replies: AssistantRequest[] = [], signals: (AbortSignal | undefined)[] = [], feedback: CommandOutcome[] = [];
  let reads = 0, lostResponse = false, gate: Promise<void> | undefined, answer = 'Done';
  let reader: (signal?: AbortSignal) => Promise<AssistantModelPreferenceView> = async () => view;
  const client = {
    async assistantRespond(input: AssistantRequest): Promise<AssistantRespondEnvelope> { replies.push(input); return { kind: 'result', result: { state: 'answered', text: answer } }; },
    async assistantModelPreference(signal?: AbortSignal) { reads++; signals.push(signal); return reader(signal); },
    async executeCommand(input: unknown): Promise<CommandResult> {
      const command = AssistantModelPreferenceCommandRequestSchema.parse(input); sent.push(command);
      await gate;
      view = AssistantModelPreferenceViewSchema.parse({ ...view, revision: command.target.expectedRevision + 1, preference: command.payload });
      if (lostResponse) throw new Error('lost-after-commit');
      return CommandResultSchema.parse({ state: 'applied', commandId: command.commandId,
        affectedTargets: [{ family: "assistant-model-preference", profileId: command.target.profileId, revision: view.revision }] });
    },
    async executeBulkCommand(): Promise<never> { throw new Error('unexpected-bulk'); },
  };
  const scope: CommandExecutionScope = { actorId: LOCAL_OPERATOR_ACTOR_ID, client, authority: {}, dayRequest: {} };
  let currentScope = scope;
  const executor = new CommandExecutor(() => currentScope);
  const commands = { executor, scope, feedback: (value: CommandOutcome) => { feedback.push(value); } };
  const binding = { authority: 'selected', subjectRef: 'fixture-subject', commands };
  const c = createAssistantController(client, binding);
  return { c, binding, commands, executor, sent, replies, signals, feedback, scope,
    get view() { return view; }, get reads() { return reads; },
    setReader(value: typeof reader) { reader = value; }, setGate(value: Promise<void>) { gate = value; },
    loseResponse() { lostResponse = true; }, changeScope() { currentScope = { ...scope, authority: {} }; },
    answer(value: string) { answer = value; },
  };
}
function sendControl(c: ReturnType<typeof createAssistantController>, text: string) {
  c.action({ type: "edit", value: text }); c.action({ type: "send" });
}
it('shows the served preference and dispatches the explicit choice through the shared executor', async () => {
  const f = preferenceControls(), initial = f.view;
  sendControl(f.c, ASSISTANT_MODEL_COMMAND);
  await vi.waitFor(() => assert.notEqual(f.c.snapshot().turn.state, "waiting"));
  assert.ok(f.c.snapshot().messages.at(-1)?.text.includes(assistantModelLabel(initial.preference.slug)));
  assert.equal(f.sent.length, 0); assert.equal(f.replies.length, 0);
  sendControl(f.c, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  await vi.waitFor(() => assert.equal(f.feedback.length, 1));
  const command = AssistantModelPreferenceCommandRequestSchema.parse(f.sent[0]);
  assert.deepEqual(command.target, { profileId: initial.profileId, epoch: initial.epoch, expectedRevision: initial.revision });
  assert.deepEqual(command.payload, { slug: 'fixture-selected', effort: ASSISTANT_DEFAULT_EFFORT });
  assert.equal(command.requestedBy, LOCAL_OPERATOR_ACTOR_ID); assert.equal(command.source, 'dashboard-assistant-model-preference');
  assert.equal(f.feedback[0]?.kind, "confirmed"); assert.equal(f.reads, 3);
  assert.ok(f.c.snapshot().messages.at(-1)?.text.includes(assistantModelLabel(f.view.preference.slug)));
  assert.equal(f.executor.retainedAttempts()[0]?.scope.client, f.scope.client);
});
it('saves a picker choice through the shared executor without a chat turn', async () => {
  const f = preferenceControls(), initial = f.view;
  await f.c.choose({ slug: initial.preference.slug, effort: 'max' });
  const command = AssistantModelPreferenceCommandRequestSchema.parse(f.sent[0]);
  assert.deepEqual(command.target, { profileId: initial.profileId, epoch: initial.epoch, expectedRevision: initial.revision });
  assert.deepEqual(command.payload, { slug: initial.preference.slug, effort: 'max' });
  assert.equal(f.feedback[0]?.kind, "confirmed"); assert.equal(f.view.preference.effort, 'max');
  assert.deepEqual(f.c.snapshot().messages, []); assert.equal(f.replies.length, 0);
});
it('rejects malformed setup arguments without an inference call or command', async () => {
  for (const text of [ASSISTANT_MODEL_COMMAND + ' fixture-selected', ASSISTANT_MODEL_COMMAND + ' fixture-selected unsupported', ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT + ' extra']) {
    const f = preferenceControls(); sendControl(f.c, text);
    await vi.waitFor(() => assert.notEqual(f.c.snapshot().turn.state, "waiting"));
    assert.equal(f.reads, 0); assert.equal(f.sent.length, 0); assert.equal(f.replies.length, 0);
  }
});
it('keeps an after-dispatch loss unknown without automatic retry or invented success', async () => {
  const f = preferenceControls(); f.loseResponse();
  sendControl(f.c, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  await vi.waitFor(() => assert.equal(f.c.snapshot().turn.state, "unknown"));
  assert.equal(f.sent.length, 1); assert.equal(f.view.preference.slug, 'fixture-selected');
  assert.equal(f.executor.retainedAttempts()[0]?.outcome?.kind, "uncertain");
  f.c.action({ type: "retry" }); await Promise.resolve();
  assert.equal(f.sent.length, 1); assert.equal(f.reads, 1);
});
it('discards a superseded preference read before any command and rejects a foreign readback', async () => {
  const f = preferenceControls(), held = Promise.withResolvers<AssistantModelPreferenceView>();
  f.setReader(() => held.promise);
  sendControl(f.c, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  assert.equal(f.reads, 1); f.c.bind({ authority: 'next', commands: f.commands });
  held.resolve(f.view); await held.promise; await Promise.resolve();
  assert.equal(f.sent.length, 0); assert.equal(f.signals[0]?.aborted, true);
  const foreign = preferenceControls();
  foreign.setReader(async () => foreign.reads === 1 ? foreign.view : { ...foreign.view, profileId: crypto.randomUUID() });
  sendControl(foreign.c, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  await vi.waitFor(() => assert.equal(foreign.c.snapshot().turn.state, "unknown"));
  assert.equal(foreign.sent.length, 1); assert.equal(foreign.feedback[0]?.kind, "uncertain");
});
it('retains a command whose scope changes after dispatch and never runs returned model text as an operator command', async () => {
  const f = preferenceControls(), held = Promise.withResolvers<void>(); f.setGate(held.promise);
  sendControl(f.c, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  await vi.waitFor(() => assert.equal(f.sent.length, 1)); f.changeScope(); f.c.bind({ authority: 'next', commands: f.commands });
  held.resolve(); await vi.waitFor(() => assert.equal(f.executor.retainedAttempts()[0]?.outcome?.kind, "uncertain"));
  assert.equal(f.c.snapshot().messages.some(message => message.text.includes('Assistant model:')), false);
  const model = preferenceControls(); model.answer(ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  sendControl(model.c, 'ordinary request'); await vi.waitFor(() => assert.notEqual(model.c.snapshot().turn.state, "waiting"));
  assert.equal(model.replies.length, 1); assert.equal(model.reads, 0); assert.equal(model.sent.length, 0);
});

it('preserves an in-flight read when only the outer command binding container changes', async () => {
  const f = preferenceControls(), held = Promise.withResolvers<AssistantModelPreferenceView>();
  f.setReader(() => held.promise);
  sendControl(f.c, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  f.c.bind({ ...f.binding, commands: { ...f.commands } });
  assert.equal(f.signals[0]?.aborted, false);
  f.setReader(async () => f.view); held.resolve(f.view);
  await vi.waitFor(() => assert.equal(f.feedback.length, 1));
  assert.equal(f.sent.length, 1); assert.equal(f.feedback[0]?.kind, "confirmed");
});

it('does not infer or choose a local default when the preference query is not wired', async () => {
  let inferences = 0;
  const c = createAssistantController(resultClient({ async assistantRespond(): Promise<AssistantResult> { inferences++; return { state: 'answered', text: 'Unexpected' }; } }), { authority: 'selected' });
  sendControl(c, ASSISTANT_MODEL_COMMAND);
  await vi.waitFor(() => assert.notEqual(c.snapshot().turn.state, "waiting"));
  assert.equal(inferences, 0); assert.equal(c.snapshot().messages.length, 2);
});
it('binds selected-run workflow proposals to the current selection and confirms only through the typed action client', async () => {
  let confirms = 0;
  const proposal = ASSISTANT_START_PROPOSAL;
  const c = createAssistantController(resultClient({ assistantRespond: async request => {
    assert.equal(request.subjectRef, 'run_selected_1'); return { state: 'action-proposal', proposal };
  }, assistantDecide: async input => { confirms++; return { state: 'applied', actionId: input.actionId }; } }),
  { authority: 'current', subjectRef: 'run_selected_1' });
  c.action({ type: 'edit', value: 'start selected workflow' }); c.action({ type: 'send' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(confirms, 0);
  const turn = c.snapshot().turn; assert.equal(turn.state, 'proposal');
  if (turn.state === 'proposal') {
    assert.equal(turn.proposal.mode, 'read-only');
    assert.equal(turn.proposal.values[0].value, 'EID 10101010 · Person Lookup');
    assert.deepEqual(turn.proposal.values.slice(1, 5), [
      { label: 'Runs', value: '1' }, { label: 'Mode', value: 'Live read' },
      { label: 'Browser', value: 'Headed' }, { label: 'Captures', value: 'On' },
    ]);
    assert.deepEqual(turn.proposal.issued, proposal);
  }
  c.action({ type: 'confirm' }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(confirms, 1);
  c.action({ type: 'confirm' }); assert.equal(confirms, 1);
});


it('stores a setup reply before publishing it, so the first automatic rename of a New chat uses the current revision', async () => {
  const server = assistantHistoryServer();
  try {
    const store = await createAssistantHistory(server.client, { getItem: () => null, removeItem() {} }, server.profileId, new AbortController().signal);
    const [chat] = store.chats.read(); assert.ok(chat); assert.equal(chat.title, 'New chat');
    const view = AssistantModelPreferenceViewSchema.parse({ profileId: server.profileId, epoch: 1, revision: 0, preference: { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT } });
    const client = resultClient({ async assistantRespond(): Promise<AssistantResult> { throw new Error('setup commands send nothing to the model'); } });
    const c = createAssistantController({ ...client, ...server.client, async assistantModelPreference() { return view; } }, { authority: 'selected' }, {
      conversationId: chat.id, read: () => store.read(chat.id), retain: state => { store.retain(chat.id, state); }, revision: () => store.revision(chat.id),
      receipt: receipt => { store.receipt(receipt); }, local: text => store.local(chat.id, text), outcome: id => store.outcome(chat.id, id),
      decision: id => store.decision(chat.id, id), unsaved: () => { store.unsaved(); } });
    // The panel renames as soon as the first reply is published; do the same here.
    let rename: Promise<void> | undefined;
    c.subscribe(() => { if (rename === undefined && c.snapshot().messages.some(message => message.role === 'assistant')) rename = store.chats.rename(chat.id, ASSISTANT_MODEL_COMMAND); });
    c.action({ type: 'edit', value: ASSISTANT_MODEL_COMMAND }); c.action({ type: 'send' });
    await vi.waitFor(() => assert.ok(rename));
    await rename;
    assert.equal(store.chats.read().find(row => row.id === chat.id)?.title, ASSISTANT_MODEL_COMMAND);
    assert.equal(store.notice(), '');
  } finally { server.close(); }
});
