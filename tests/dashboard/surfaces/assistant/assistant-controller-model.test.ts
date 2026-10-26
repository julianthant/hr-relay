import { ASSISTANT_VERIFY_COMMAND, ASSISTANT_MODEL_COMMAND, ASSISTANT_DEFAULT_MODEL, ASSISTANT_DEFAULT_EFFORT, AssistantModelPreferenceViewSchema, type AssistantModelPreferenceView, type AssistantRequest, type AssistantResult } from '../../../../src/models/dashboard/assistant.js';
import { CommandExecutor, type CommandExecutionScope, type CommandOutcome } from '../../../../src/dashboard/app/commands/command-executor.js';
import { AssistantModelPreferenceCommandRequestSchema, CommandResultSchema, type CommandResult } from '../../../../src/rules/commands/commands.js';
import { LOCAL_OPERATOR_ACTOR_ID } from '../../../../src/rules/identity/ids.js';
import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { createAssistantController, ASSISTANT_CONFIRM_HOLD } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';


function pending() {
  let settle: (result: AssistantResult) => void = () => { throw new Error('pending-uninitialized'); };
  const promise = new Promise<AssistantResult>(resolve => { settle = resolve; });
  return { promise, settle };
}
it('keeps monotonic identity across New Chat and ignores late replies after cancellation, edits and authority changes', async () => {
  for (const action of ['new-chat', 'cancel', 'edit', 'binding'] as const) {
    const reply = pending(); let signal: AbortSignal | undefined;
    const c = createAssistantController({ assistantRespond: async (_request, abort) => { signal = abort; return reply.promise; } }, { authority: 'a', subjectRef: 'one' });
    c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
    if (action === 'binding') c.bind({ authority: 'b', subjectRef: 'two' });
    else c.action(action === 'edit' ? { type: 'edit', value: 'Changed' } : { type: action });
    assert.equal(signal?.aborted, true);
    if (action !== 'new-chat') {
      assert.equal(c.snapshot().turn.state, 'unknown');
      const sequence = c.snapshot().sequence; c.action({ type: 'retry' }); c.action({ type: 'send' }); assert.equal(c.snapshot().sequence, sequence);
    }
    reply.settle({ state: 'answered', text: 'Late', citations: [] }); await reply.promise; await Promise.resolve();
    assert.equal(c.snapshot().messages.some(message => message.text === 'Late'), false);
    assert.equal(c.snapshot().sequence, 1);
    if (action === 'new-chat') assert.deepEqual(c.snapshot().messages, []);
    c.action({ type: 'new-chat' }); c.action({ type: 'edit', value: 'Next' }); c.action({ type: 'send' }); assert.equal(c.snapshot().sequence, 2);
    c.abort();
  }
});
it('settles actual answer/refusal/citation presentation and never interprets Confirm as a request', async () => {
  let calls = 0;
  const c = createAssistantController({ async assistantRespond() { calls++; return { state: 'answered', text: 'Explanation', citations: [{ path: 'docs/rebuild/example.md', revision: 'a'.repeat(40), startLine: 1, endLine: 1, quote: 'Exact source' }] }; } }, { authority: 'a' });
  c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'idle'));
  assert.equal(c.snapshot().messages.at(-1)?.sources?.[0].excerpt, 'Exact source');
  assert.equal(c.snapshot().messages.at(-1)?.sources?.[0].url, undefined);
  c.action({ type: 'confirm' }); assert.equal(calls, 1); assert.match(ASSISTANT_CONFIRM_HOLD, /before preparation/u);
});
it('does not retry an ambiguously lost response or let an edited draft redispatch it', async () => {
  let calls = 0;
  const c = createAssistantController({ async assistantRespond() { calls++; throw new Error('private transport reason'); } }, { authority: 'a' });
  c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'unknown'));
  c.action({ type: 'retry' }); c.action({ type: 'send' });
  assert.equal(calls, 1); assert.equal(c.snapshot().sequence, 1);
  c.action({ type: 'edit', value: 'Changed' }); c.action({ type: 'retry' }); c.action({ type: 'send' }); assert.equal(calls, 1);
  assert.equal(JSON.stringify(c.snapshot()).includes('private transport'), false);
  assert.equal(JSON.stringify(c.snapshot()).includes('actionId'), false);
});

it('refuses ambiguity without presenting candidates as operator selection', async () => {
  const c = createAssistantController({ async assistantRespond() { return { state: 'resolution-required', candidates: [{ subjectRef: 'candidate', displayName: 'Synthetic Candidate', employeeId: '10812345' }] }; } }, { authority: 'a' });
  c.action({ type: 'edit', value: 'Propose' }); c.action({ type: 'send' });
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'idle'));
  assert.equal(c.snapshot().messages.at(-1)?.text, 'Select an unambiguous subject before preparing a proposal.');
  assert.equal(JSON.stringify(c.snapshot()).includes('Synthetic Candidate'), false);
});

const actionProposal = { state: 'action-proposal', proposal: { chatId: '00000000-0000-4000-8000-000000000001',
  actionId: '00000000-0000-4000-8000-000000000002', revision: 1, expiresAt: '2099-01-01T00:00:00Z', label: 'Mark a notification read',
  targetLabel: 'Local notification', subject: 'none', effect: 'local-write' } } satisfies AssistantResult;
it('confirms the actual issued action identity once and keeps a lost response unknown without retry', async () => {
  for (const lost of [false, true]) {
    let calls = 0;
    const c = createAssistantController({ assistantRespond: async () => actionProposal,
      assistantDecide: async identity => { calls++; assert.deepEqual(identity, { chatId: actionProposal.proposal.chatId, actionId: actionProposal.proposal.actionId, revision: 1, decision: 'confirm' });
        if (lost) throw new Error('synthetic transport lost'); return { state: 'applied', actionId: identity.actionId }; } }, { authority: 'current' });
    c.action({ type: 'edit', value: 'mark notifications read' }); c.action({ type: 'send' }); await Promise.resolve(); await Promise.resolve();
    const initial = c.snapshot().turn; assert.equal(initial.state, 'proposal');
    if (initial.state === 'proposal') { assert.equal(initial.proposal.mode, 'local-change'); assert.deepEqual(initial.proposal.subjects, []); }
    c.action({ type: 'confirm' }); c.action({ type: 'confirm' }); await Promise.resolve(); await Promise.resolve();
    const settled = c.snapshot().turn; assert.equal(settled.state, 'proposal');
    if (settled.state === 'proposal') assert.equal(settled.disposition, lost ? 'unknown' : 'confirmed');
    c.action({ type: 'confirm' }); c.action({ type: 'retry' }); assert.equal(calls, 1);
  }
});
it('holds issued action confirmation after edits, selection changes or cancel without fabricating workflow subjects', async () => {
  for (const change of ['edit', 'selection', 'cancel'] as const) {
    let confirmations = 0, cancellations = 0;
    const c = createAssistantController({ assistantRespond: async () => actionProposal,
      assistantDecide: async input => { if (input.decision === 'confirm') confirmations++; else cancellations++; return { state: 'cancelled', actionId: input.actionId }; } }, { authority: 'one' });
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
  const action = { chatId: '00000000-0000-4000-8000-000000000001', actionId: '00000000-0000-4000-8000-000000000002', revision: 1,
    expiresAt: '2099-01-01T00:00:00Z', label: 'Mark 25 current notifications read', targetLabel: '25 current notifications', subject: 'none' as const, effect: 'local-write' as const };
  const c = createAssistantController({ async assistantRespond() { requests++; return { state: 'unknown', actionId: action.actionId, action }; },
    async assistantDecide() { decisions++; return { state: 'applied', actionId: action.actionId }; } }, { authority: 'current' });
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
  let reads = 0, refreshes = 0, lostResponse = false, gate: Promise<void> | undefined, answer = 'Done';
  let reader: (signal?: AbortSignal) => Promise<AssistantModelPreferenceView> = async () => view;
  const client = {
    async assistantRespond(input: AssistantRequest): Promise<AssistantResult> { replies.push(input); return { state: 'answered', text: answer, citations: [] }; },
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
  const binding = { authority: 'selected', subjectRef: 'fixture-subject', commands,
    refreshAccount: async () => { refreshes++; } };
  const c = createAssistantController(client, binding);
  return { c, binding, commands, executor, sent, replies, signals, feedback, scope,
    get view() { return view; }, get reads() { return reads; }, get refreshes() { return refreshes; },
    setReader(value: typeof reader) { reader = value; }, setGate(value: Promise<void>) { gate = value; },
    loseResponse() { lostResponse = true; }, changeScope() { currentScope = { ...scope, authority: {} }; },
    answer(value: string) { answer = value; },
  };
}
function sendControl(c: ReturnType<typeof createAssistantController>, text: string) {
  c.action({ type: "edit", value: text }); c.action({ type: "send" });
}
it('verifies only on explicit send, omits subject context and refreshes the actual account once', async () => {
  const f = preferenceControls(); await Promise.resolve();
  assert.equal(f.replies.length, 0); assert.equal(f.refreshes, 0);
  f.c.action({ type: "edit", value: ASSISTANT_VERIFY_COMMAND }); await Promise.resolve();
  assert.equal(f.replies.length, 0);
  f.c.action({ type: "send" });
  await vi.waitFor(() => assert.equal(f.refreshes, 1));
  assert.deepEqual(f.replies, [{ message: ASSISTANT_VERIFY_COMMAND }]);
  assert.equal(f.sent.length, 0); assert.equal(f.reads, 0);
  sendControl(f.c, 'ordinary request');
  await vi.waitFor(() => assert.equal(f.replies.length, 2));
  assert.equal(f.refreshes, 1);
});
it('shows the served preference and dispatches the explicit choice through the shared executor', async () => {
  const f = preferenceControls(), initial = f.view;
  sendControl(f.c, ASSISTANT_MODEL_COMMAND);
  await vi.waitFor(() => assert.notEqual(f.c.snapshot().turn.state, "waiting"));
  assert.ok(f.c.snapshot().messages.at(-1)?.text.includes(initial.preference.slug));
  assert.equal(f.sent.length, 0); assert.equal(f.replies.length, 0);
  sendControl(f.c, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT);
  await vi.waitFor(() => assert.equal(f.feedback.length, 1));
  const command = AssistantModelPreferenceCommandRequestSchema.parse(f.sent[0]);
  assert.deepEqual(command.target, { profileId: initial.profileId, epoch: initial.epoch, expectedRevision: initial.revision });
  assert.deepEqual(command.payload, { slug: 'fixture-selected', effort: ASSISTANT_DEFAULT_EFFORT });
  assert.equal(command.requestedBy, LOCAL_OPERATOR_ACTOR_ID); assert.equal(command.source, 'dashboard-assistant-model-preference');
  assert.equal(f.feedback[0]?.kind, "confirmed"); assert.equal(f.reads, 3);
  assert.ok(f.c.snapshot().messages.at(-1)?.text.includes(f.view.preference.slug));
  assert.equal(f.executor.retainedAttempts()[0]?.scope.client, f.scope.client);
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
  const c = createAssistantController({ async assistantRespond(): Promise<AssistantResult> { inferences++; return { state: 'answered', text: 'Unexpected', citations: [] }; } }, { authority: 'selected' });
  sendControl(c, ASSISTANT_MODEL_COMMAND);
  await vi.waitFor(() => assert.notEqual(c.snapshot().turn.state, "waiting"));
  assert.equal(inferences, 0); assert.equal(c.snapshot().messages.length, 2);
});
it('does not refresh or publish a superseded explicit verification settlement', async () => {
  const held = Promise.withResolvers<AssistantResult>(); let refreshes = 0;
  const c = createAssistantController({ assistantRespond: () => held.promise }, { authority: 'first', refreshAccount: async () => { refreshes++; } });
  sendControl(c, ASSISTANT_VERIFY_COMMAND);
  c.bind({ authority: 'second' }); held.resolve({ state: 'answered', text: 'Stale verification', citations: [] });
  await held.promise; await Promise.resolve(); await Promise.resolve();
  assert.equal(refreshes, 0); assert.equal(c.snapshot().messages.some(message => message.text === 'Stale verification'), false);
});
